import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import * as jwt from 'jsonwebtoken';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { AppError, unauthorized } from '../common/errors';
import { randomToken, sha256 } from '../common/hash';
import { config } from '../config/config';
import { Db } from '../db/db.service';
import { requireAccess, SsoFailure, setCentralRole } from './afs';

const STATE_COOKIE = 'procurement_sso';
const STATE_TTL_SECONDS = 600;
const CODE_TTL_SECONDS = 60;

const base64url = (b: Buffer) => b.toString('base64url');

/** The name AFS holds for this person, falling back to the email so the account always has a name. */
function displayName(claims: any): string {
  const full = [claims.given_name, claims.family_name].filter((part) => typeof part === 'string' && part.trim()).join(' ');
  return (typeof claims.name === 'string' && claims.name.trim()) || full || String(claims.email);
}

/** Only same-site paths are accepted after sign-in (no open redirect). Anything else goes to the portal's home page. */
export function safeNextPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (/[\r\n\t\0]/.test(value)) return '/';
  return value;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

/** Name and lifetime of the cookie that carries one sign-in attempt. */
export const SSO_STATE = { cookie: STATE_COOKIE, ttlSeconds: STATE_TTL_SECONDS };

interface SavedState {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
}

/**
 * AFS single sign-on: OpenID Connect with PKCE through Keycloak. The browser goes to Keycloak and comes back to the
 * callback, which issues a one-time code. The portal trades that code for Procurement's own tokens, so no Keycloak
 * token and no session token ever appears in a URL.
 *
 * Access rules, in order:
 *  1. The ID token is verified (signature, issuer, audience, expiry, nonce) and the email is verified.
 *  2. AFS Command Center must grant Procurement access with a role. Sign-in alone grants nothing.
 *  3. The Keycloak identity is linked to an existing account with the same verified email. Accounts are not created here.
 *  4. The account must be active.
 */
@Injectable()
export class SsoService {
  constructor(private db: Db, private audit: AuditService, private auth: AuthService) {}

  get enabled() {
    return config.sso !== null;
  }

  /** The Keycloak URL that starts a sign-in, and the signed cookie that holds the state of this attempt. */
  start(next: string, silent: boolean): { url: string; cookie: string } {
    const sso = config.sso!;
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    const state = randomToken();
    const nonce = randomToken();
    const cookie = jwt.sign({ typ: 'sso_state', state, nonce, verifier, next }, config.jwtRefreshSecret, { expiresIn: STATE_TTL_SECONDS });
    const url = new URL(`${sso.issuer}/protocol/openid-connect/auth`);
    url.search = new URLSearchParams({
      client_id: sso.clientId,
      redirect_uri: sso.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      // Silent sign-in completes only if the employee already signed in to AFS in this browser.
      ...(silent ? { prompt: 'none' } : {}),
    }).toString();
    return { url: url.toString(), cookie };
  }

  /** Read and verify the state cookie. Null when it is missing, altered or expired. */
  readState(cookie: string | undefined): SavedState | null {
    if (!cookie) return null;
    try {
      const p = jwt.verify(cookie, config.jwtRefreshSecret) as any;
      return p.typ === 'sso_state' ? (p as SavedState) : null;
    } catch {
      return null;
    }
  }

  /**
   * Complete the Keycloak redirect and return the ID of the signed-in account. Throws SsoFailure with the code the
   * login page shows.
   */
  async finish(query: { code?: string; state?: string; error?: string }, saved: SavedState | null, ip: string | null): Promise<string> {
    if (query.error) {
      // No AFS session for a silent sign-in: the login page shows its own form instead of an error.
      if (query.error === 'login_required' || query.error === 'interaction_required') throw new SsoFailure('silent');
      throw new SsoFailure('cancelled');
    }
    if (!saved || !query.code || query.state !== saved.state) throw new SsoFailure('expired');

    const claims = await this.verifiedClaims(query.code, saved.verifier, saved.nonce);
    if (claims.email_verified !== true) throw new SsoFailure('unverified_email');
    const sub = claims.sub as string;

    // AFS decides first. Nothing is linked for an employee AFS has not assigned.
    const role = await requireAccess(this.db, sub);
    const userId = await this.linkedUserId(sub, String(claims.email), displayName(claims), ip);
    await setCentralRole(this.db, userId, role);
    await this.audit.log({ actorId: userId, ip, action: 'auth.sso_login', objectType: 'user', objectId: userId, detail: { role } });
    return userId;
  }

  /** Exchange the code at Keycloak (server to server, so the client secret never reaches the browser) and verify the ID token. */
  private async verifiedClaims(code: string, verifier: string, nonce: string) {
    const sso = config.sso!;
    let idToken: string;
    try {
      const res = await fetch(`${sso.internalIssuer}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', code, redirect_uri: sso.redirectUri, client_id: sso.clientId,
          client_secret: sso.clientSecret, code_verifier: verifier,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status}`);
      idToken = ((await res.json()) as { id_token: string }).id_token;
    } catch {
      throw new SsoFailure('token');
    }
    try {
      // Keys come over the internal network; the issuer is the public one that Keycloak writes into tokens.
      const jwks = createRemoteJWKSet(new URL(`${sso.internalIssuer}/protocol/openid-connect/certs`));
      const { payload } = await jwtVerify(idToken, jwks, { issuer: sso.issuer, audience: sso.clientId, algorithms: ['RS256'] });
      if (typeof payload.sub !== 'string' || payload.nonce !== nonce) throw new Error('nonce or subject mismatch');
      return payload;
    } catch {
      throw new SsoFailure('invalid_token');
    }
  }

  /**
   * The account linked to this identity. Otherwise the existing account with the same verified email is linked, or, if
   * there is none, an account is created from the AFS identity. AFS has already granted access by this point, so every
   * account that reaches here belongs to someone AFS has assigned to Procurement.
   */
  private async linkedUserId(sub: string, email: string, name: string, ip: string | null): Promise<string> {
    const byIdentity = await this.db.one('SELECT id, active FROM users WHERE external_id = $1', [sub]);
    if (byIdentity) {
      if (!byIdentity.active) throw new SsoFailure('disabled');
      return byIdentity.id;
    }
    const normalized = email.trim().toLowerCase();
    const byEmail = await this.db.one('SELECT id, active, external_id FROM users WHERE email = $1', [normalized]);
    if (byEmail?.external_id) throw new SsoFailure('no_account');
    if (byEmail) {
      if (!byEmail.active) throw new SsoFailure('disabled');
      await this.db.query('UPDATE users SET external_id = $1 WHERE id = $2', [sub, byEmail.id]);
      await this.audit.log({ actorId: byEmail.id, ip, action: 'auth.sso_link', objectType: 'user', objectId: byEmail.id });
      return byEmail.id;
    }
    const created = await this.db.one('INSERT INTO users (email, full_name, external_id) VALUES ($1, $2, $3) RETURNING id', [normalized, name, sub]);
    await this.audit.log({ actorId: created.id, ip, action: 'auth.sso_provision', objectType: 'user', objectId: created.id });
    return created.id;
  }

  /** A one-time code for the portal. Only its hash is stored. */
  async issueCode(userId: string): Promise<string> {
    const code = randomToken();
    await this.db.query(`INSERT INTO sso_codes (code_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' seconds')::interval)`, [sha256(code), userId, String(CODE_TTL_SECONDS)]);
    return code;
  }

  /** Trade a one-time code for Procurement's own tokens. A code works once and only within its lifetime. */
  async exchange(code: string, ip: string | null) {
    const row = await this.db.one('UPDATE sso_codes SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id', [sha256(code)]);
    if (!row) throw new AppError(400, 'auth.invalid_sso_code', 'This sign-in link is invalid or has expired. Sign in again.');
    const user = await this.db.one('SELECT active FROM users WHERE id = $1', [row.user_id]);
    if (!user?.active) throw unauthorized('Account is not active');
    return this.auth.issueFor(row.user_id, ip);
  }
}
