import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import { config } from '../config/config';
import { Db } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, USER_SQL } from '../common/auth';
import { AppError, badRequest, unauthorized } from '../common/errors';
import { randomToken, sha256 } from '../common/hash';
import { APPROVER_ROLES } from './permissions';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AuthService {
  constructor(private db: Db, private audit: AuditService, private notify: NotificationsService) {}

  private accessToken(userId: string) {
    return jwt.sign({ sub: userId, typ: 'access' }, config.jwtAccessSecret, { expiresIn: config.accessTtl });
  }

  private async issue(user: any, ip: string | null) {
    const refresh = randomToken();
    await this.db.query('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2, now() + ($3 || \' days\')::interval)', [user.id, sha256(refresh), String(config.refreshTtlDays)]);
    await this.audit.log({ actorId: user.id, ip, action: 'auth.login', objectType: 'user', objectId: user.id });
    return { access_token: this.accessToken(user.id), refresh_token: refresh, user: this.publicUser(user) };
  }

  publicUser(u: any) {
    return { id: u.id, email: u.email, full_name: u.full_name, position: u.position, roles: u.roles, permissions: u.permissions, totp_enabled: u.totp_enabled, has_signature: !!u.has_signature, department: u.department ?? null };
  }

  async me(id: string) {
    const u = await this.db.one(`${USER_SQL} WHERE u.id = $1`, [id]);
    const dep = u?.department_id ? await this.db.one('SELECT id, name FROM departments WHERE id = $1', [u.department_id]) : null;
    return this.publicUser({ ...u, department: dep });
  }

  async login(email: string, password: string, ip: string | null) {
    const row = await this.db.one('SELECT id, password_hash, failed_logins, locked_until, totp_enabled FROM users WHERE email = $1 AND active', [email]);
    const fail = async () => {
      if (row) {
        await this.db.query('UPDATE users SET failed_logins = failed_logins + 1, locked_until = CASE WHEN failed_logins + 1 >= 5 THEN now() + interval \'15 minutes\' ELSE locked_until END WHERE id = $1', [row.id]);
        await this.audit.log({ actorId: row.id, ip, action: 'auth.login_failed', objectType: 'user', objectId: row.id });
      }
      throw new AppError(401, 'auth.invalid_credentials', 'Wrong e-mail or password');
    };
    if (!row || !row.password_hash) return fail();
    if (row.locked_until && new Date(row.locked_until) > new Date()) throw new AppError(423, 'auth.locked', 'Account locked after repeated failures, try again in 15 minutes');
    if (!(await argon2.verify(row.password_hash, password))) return fail();
    await this.db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [row.id]);
    const user = await this.me(row.id);
    const mustTotp = row.totp_enabled || (config.totpRequired && user.roles.some((r: string) => APPROVER_ROLES.includes(r)));
    if (mustTotp && row.totp_enabled) {
      return { requires_totp: true, challenge_token: jwt.sign({ sub: row.id, typ: 'totp' }, config.jwtAccessSecret, { expiresIn: 300 }) };
    }
    return this.issue(user, ip);
  }

  async totp(challenge: string, code: string, ip: string | null) {
    let p: any;
    try { p = jwt.verify(challenge, config.jwtAccessSecret); } catch { throw unauthorized('Challenge expired, sign in again'); }
    if (p.typ !== 'totp') throw unauthorized();
    const row = await this.db.one('SELECT totp_secret FROM users WHERE id = $1 AND active', [p.sub]);
    if (!row?.totp_secret || !authenticator.verify({ token: code, secret: row.totp_secret })) throw new AppError(401, 'auth.invalid_totp', 'Wrong authenticator code');
    return this.issue(await this.me(p.sub), ip);
  }

  async refresh(token: string) {
    const h = sha256(token);
    const row = await this.db.one('SELECT id, user_id FROM refresh_tokens WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()', [h]);
    if (!row) throw unauthorized('Refresh token invalid');
    const u = await this.db.one('SELECT active FROM users WHERE id = $1', [row.user_id]);
    if (!u?.active) throw unauthorized();
    await this.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]); // rotate
    const next = randomToken();
    await this.db.query('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2, now() + ($3 || \' days\')::interval)', [row.user_id, sha256(next), String(config.refreshTtlDays)]);
    return { access_token: this.accessToken(row.user_id), refresh_token: next };
  }

  async logout(token: string | undefined, userId?: string) {
    if (token) await this.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [sha256(token)]);
    if (userId) await this.audit.log({ actorId: userId, action: 'auth.logout', objectType: 'user', objectId: userId });
    return { ok: true };
  }

  /** Create a one time invitation (or reset) link for a user and e-mail it. */
  async createInvite(userId: string, kind: 'invite' | 'reset' = 'invite') {
    const token = randomToken();
    await this.db.query('UPDATE user_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
    await this.db.query('INSERT INTO user_tokens (user_id, kind, token_hash, expires_at) VALUES ($1,$2,$3, now() + ($4 || \' hours\')::interval)', [userId, kind, sha256(token), String(config.inviteHours)]);
    const link = `${config.appUrl}/accept-invite?token=${token}`;
    const u = await this.db.one('SELECT id, email, full_name FROM users WHERE id = $1', [userId]);
    await this.notify.send({ userId, email: u.email, kind: kind === 'invite' ? 'account.invite' : 'account.reset', subject: kind === 'invite' ? 'Your AfS Procurement account' : 'Reset your AfS Procurement password', vars: { signer_name: u.full_name, link, document_title: 'your account' }, inApp: false });
    return link;
  }

  async acceptInvite(token: string, password: string, ip: string | null) {
    if (password.length < 10) throw badRequest('auth.weak_password', 'Password must be at least 10 characters', { password: 'at least 10 characters' });
    const row = await this.db.one('SELECT id, user_id FROM user_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()', [sha256(token)]);
    if (!row) throw new AppError(400, 'auth.invalid_invite', 'This link is invalid or has expired');
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    await this.db.query('UPDATE users SET password_hash = $1, failed_logins = 0, locked_until = NULL WHERE id = $2', [hash, row.user_id]);
    await this.db.query('UPDATE user_tokens SET used_at = now() WHERE id = $1', [row.id]);
    await this.audit.log({ actorId: row.user_id, ip, action: 'auth.password_set', objectType: 'user', objectId: row.user_id });
    return this.issue(await this.me(row.user_id), ip);
  }

  async totpSetup(user: AuthUser) {
    const secret = authenticator.generateSecret();
    await this.db.query('UPDATE users SET totp_secret = $1, totp_enabled = false WHERE id = $2', [secret, user.id]);
    return { secret, otpauth_url: authenticator.keyuri(user.email, 'AfS Procurement', secret) };
  }

  async totpEnable(user: AuthUser, code: string) {
    const row = await this.db.one('SELECT totp_secret FROM users WHERE id = $1', [user.id]);
    if (!row?.totp_secret || !authenticator.verify({ token: code, secret: row.totp_secret })) throw new AppError(400, 'auth.invalid_totp', 'Wrong authenticator code');
    await this.db.query('UPDATE users SET totp_enabled = true WHERE id = $1', [user.id]);
    await this.audit.log({ actorId: user.id, action: 'auth.totp_enabled', objectType: 'user', objectId: user.id });
    return { ok: true };
  }

  async changePassword(user: AuthUser, current: string, next: string, ip: string | null) {
    if (!next || next.length < 10) throw badRequest('auth.weak_password', 'New password must be at least 10 characters', { new_password: 'at least 10 characters' });
    const row = await this.db.one('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!row?.password_hash || !(await argon2.verify(row.password_hash, current ?? ''))) throw new AppError(400, 'auth.invalid_credentials', 'Current password is wrong', { current_password: 'wrong password' });
    if (current === next) throw badRequest('auth.same_password', 'Choose a different password', { new_password: 'must differ from the current one' });
    await this.db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await this.hashPassword(next)]);
    await this.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id]); // sign out other sessions
    await this.audit.log({ actorId: user.id, ip, action: 'auth.password_changed', objectType: 'user', objectId: user.id });
    return { ok: true };
  }

  hashPassword(p: string) { return argon2.hash(p, { type: argon2.argon2id }); }
}
