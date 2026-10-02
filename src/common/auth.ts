import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { config } from '../config/config';
import { Db } from '../db/db.service';
import { AppError, forbidden, unauthorized } from './errors';

export interface AuthUser {
  id: string; email: string; full_name: string; position: string | null;
  department_id: string | null; roles: string[]; permissions: string[];
}

export const Public = () => SetMetadata('public', true);
/** Require ALL listed permission codes (deny by default: endpoints without @Public still need a signed-in user) */
export const Perm = (...p: string[]) => SetMetadata('perms', p);
export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
export const ClientIp = createParamDecorator((_d, ctx: ExecutionContext): string | null => {
  const r = ctx.switchToHttp().getRequest();
  return (r.headers['x-forwarded-for']?.toString().split(',')[0] ?? r.ip ?? null)?.replace('::ffff:', '') ?? null;
});
export const UserAgent = createParamDecorator((_d, ctx: ExecutionContext): string | null => ctx.switchToHttp().getRequest().headers['user-agent'] ?? null);
export const IdemKey = createParamDecorator((_d, ctx: ExecutionContext): string | null => ctx.switchToHttp().getRequest().headers['idempotency-key'] ?? null);

export const USER_SQL = `
  SELECT u.id, u.email, u.full_name, u.position, u.department_id, u.active, u.totp_enabled,
    COALESCE((SELECT array_agg(role_code ORDER BY role_code) FROM user_roles WHERE user_id = u.id), '{}') AS roles,
    COALESCE((SELECT array_agg(DISTINCT rp.permission) FROM user_roles ur JOIN role_permissions rp ON rp.role_code = ur.role_code WHERE ur.user_id = u.id), '{}') AS permissions
  FROM users u`;

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private db: Db) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>('public', targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (!m) throw unauthorized();
    let payload: any;
    try {
      payload = jwt.verify(m[1], config.jwtAccessSecret);
    } catch {
      throw unauthorized('Session expired');
    }
    if (payload.typ !== 'access') throw unauthorized();
    const u = await this.db.one(`${USER_SQL} WHERE u.id = $1`, [payload.sub]);
    if (!u || !u.active) throw unauthorized('Account is not active');
    req.user = u as AuthUser;
    const need = this.reflector.getAllAndOverride<string[]>('perms', targets) ?? [];
    for (const p of need) if (!u.permissions.includes(p)) throw forbidden();
    return true;
  }
}

/** Tiny in-memory limiter for public endpoints (login, external signing). One VPS = one process; use Redis if you scale out. */
const hits = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (arr.length > max) throw new AppError(429, 'rate_limited', 'Too many attempts, try again later');
}
