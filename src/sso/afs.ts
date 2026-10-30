import { config } from '../config/config';
import { Db } from '../db/db.service';

/**
 * AFS single sign-on helpers: the access check against AFS Command Center and the role sync that follows it.
 * Command Center is the source of truth for SSO users. Their procurement roles are replaced with the central role
 * on every sign-in and every token refresh.
 */

/** A sign-in that AFS refuses, or that cannot be completed. `code` is what the portal shows (see the login page). */
export class SsoFailure extends Error {
  constructor(public code: string) {
    super(code);
  }
}

interface AccessDecision {
  allowed: boolean;
  external_role: string | null;
  reason: string;
}

/** Ask AFS Command Center whether this Keycloak subject may use Procurement, and with which role. */
async function askCommandCenter(subject: string): Promise<AccessDecision> {
  const sso = config.sso!;
  const url = new URL('/api/internal/access', sso.commandCenterUrl);
  url.search = new URLSearchParams({ application: sso.appSlug, subject }).toString();
  const res = await fetch(url, { headers: { 'X-Service-Token': sso.serviceToken }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`access check failed: HTTP ${res.status}`);
  return (await res.json()) as AccessDecision;
}

/**
 * The central role for this subject. Throws SsoFailure when AFS does not grant access, so no account is linked and no
 * session is started for someone AFS has refused. If AFS cannot be reached, access is refused (fails closed).
 */
export async function requireAccess(db: Db, subject: string): Promise<string> {
  let decision: AccessDecision;
  try {
    decision = await askCommandCenter(subject);
  } catch {
    throw new SsoFailure('unavailable');
  }
  if (!decision.allowed) {
    throw new SsoFailure(decision.reason === 'account disabled' ? 'disabled' : 'not_assigned');
  }
  const role = decision.external_role;
  if (!role || !(await db.one('SELECT 1 FROM roles WHERE code = $1', [role]))) throw new SsoFailure('unknown_role');
  return role;
}

/** Replace the user's procurement roles with the single central role. */
export async function setCentralRole(db: Db, userId: string, role: string): Promise<void> {
  await db.tx(async (c) => {
    await c.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    await c.query('INSERT INTO user_roles (user_id, role_code) VALUES ($1, $2)', [userId, role]);
  });
}
