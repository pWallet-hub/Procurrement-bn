import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { AuthUser, CurrentUser, Perm } from '../common/auth';
import { Db } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { badRequest, notFound, validationError } from '../common/errors';
import { ROLES } from '../auth/permissions';
import { config } from '../config/config';
import { TemplatesService } from '../templates/templates.service';

const USER_ROW = `u.id, u.email, u.full_name, u.position, u.department_id, u.active, u.totp_enabled, (u.password_hash IS NOT NULL) AS has_password,
  COALESCE((SELECT array_agg(role_code ORDER BY role_code) FROM user_roles WHERE user_id = u.id), '{}') AS roles`;

@Controller('admin') @Perm('admin.manage')
export class AdminController {
  constructor(private db: Db, private audit: AuditService, private auth: AuthService, private templates: TemplatesService) {}

  // ----- users -----
  @Get('users') async users() { return { items: (await this.db.query(`SELECT ${USER_ROW} FROM users u ORDER BY u.full_name`)).rows }; }

  @Post('users')
  async createUser(@CurrentUser() admin: AuthUser, @Body() b: any) {
    const errors: Record<string, string> = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b?.email ?? '')) errors.email = 'valid e-mail required';
    if (!String(b?.full_name ?? '').trim()) errors.full_name = 'required';
    const roles: string[] = Array.isArray(b?.roles) ? b.roles : [];
    if (!roles.length || roles.some((r) => !ROLES[r])) errors.roles = 'choose valid roles';
    if (Object.keys(errors).length) throw validationError(errors);
    const id = await this.db.tx(async (c) => {
      const u = (await c.query('INSERT INTO users (email, full_name, position, department_id) VALUES ($1,$2,$3,$4) RETURNING id', [b.email.trim().toLowerCase(), b.full_name.trim(), b.position ?? null, b.department_id ?? null])).rows[0];
      for (const r of roles) await c.query('INSERT INTO user_roles (user_id, role_code) VALUES ($1,$2)', [u.id, r]);
      await this.audit.log({ actorId: admin.id, action: 'admin.user_created', objectType: 'user', objectId: u.id, detail: { email: b.email, roles } }, c);
      return u.id as string;
    });
    const link = await this.auth.createInvite(id);
    const user = await this.db.one(`SELECT ${USER_ROW} FROM users u WHERE u.id = $1`, [id]);
    return { user, ...(config.isProd ? {} : { invite_link: link }) };
  }

  @Patch('users/:id')
  async updateUser(@CurrentUser() admin: AuthUser, @Param('id') id: string, @Body() b: any) {
    if (b?.roles && (!Array.isArray(b.roles) || b.roles.some((r: string) => !ROLES[r]))) throw validationError({ roles: 'invalid roles' });
    await this.db.tx(async (c) => {
      if (!(await c.query('SELECT 1 FROM users WHERE id = $1', [id])).rowCount) throw notFound('user');
      const sets: string[] = []; const vals: any[] = [id];
      for (const k of ['full_name', 'position', 'department_id', 'active'] as const) if (b?.[k] !== undefined) { vals.push(b[k]); sets.push(`${k} = $${vals.length}`); }
      if (sets.length) await c.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, vals);
      if (b?.roles) { await c.query('DELETE FROM user_roles WHERE user_id = $1', [id]); for (const r of b.roles) await c.query('INSERT INTO user_roles (user_id, role_code) VALUES ($1,$2)', [id, r]); }
      if (b?.active === false) await c.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
      await this.audit.log({ actorId: admin.id, action: 'admin.user_updated', objectType: 'user', objectId: id, detail: b }, c);
    });
    return this.db.one(`SELECT ${USER_ROW} FROM users u WHERE u.id = $1`, [id]);
  }

  @Post('users/:id/reset-password')
  async resetPassword(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    if (!(await this.db.one('SELECT 1 AS x FROM users WHERE id = $1', [id]))) throw notFound('user');
    const link = await this.auth.createInvite(id, 'reset');
    await this.audit.log({ actorId: admin.id, action: 'admin.password_reset', objectType: 'user', objectId: id });
    return { ok: true, ...(config.isProd ? {} : { invite_link: link }) };
  }

  @Post('users/:id/reset-totp')
  async resetTotp(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    await this.db.query('UPDATE users SET totp_secret = NULL, totp_enabled = false WHERE id = $1', [id]);
    await this.audit.log({ actorId: admin.id, action: 'admin.totp_reset', objectType: 'user', objectId: id });
    return { ok: true };
  }

  // ----- departments, budget lines, suppliers -----
  @Get('departments') async deps() { return { items: (await this.db.query('SELECT id, name, head_user_id FROM departments ORDER BY name')).rows }; }
  @Post('departments') async addDep(@CurrentUser() a: AuthUser, @Body() b: any) {
    if (!b?.name) throw validationError({ name: 'required' });
    const r = await this.db.one('INSERT INTO departments (name, head_user_id) VALUES ($1,$2) RETURNING *', [b.name, b.head_user_id ?? null]);
    await this.audit.log({ actorId: a.id, action: 'admin.department_created', objectType: 'department', objectId: r.id }); return r;
  }
  @Patch('departments/:id') async patchDep(@CurrentUser() a: AuthUser, @Param('id') id: string, @Body() b: any) {
    const r = await this.db.one('UPDATE departments SET name = COALESCE($2, name), head_user_id = COALESCE($3, head_user_id) WHERE id = $1 RETURNING *', [id, b?.name ?? null, b?.head_user_id ?? null]);
    if (!r) throw notFound('department');
    await this.audit.log({ actorId: a.id, action: 'admin.department_updated', objectType: 'department', objectId: id }); return r;
  }

  @Get('budget-lines') async bl() { return { items: (await this.db.query('SELECT id, code, project, available::float8 AS available, currency, active FROM budget_lines ORDER BY code')).rows }; }
  @Post('budget-lines') async addBl(@CurrentUser() a: AuthUser, @Body() b: any) {
    if (!b?.code) throw validationError({ code: 'required' });
    const r = await this.db.one('INSERT INTO budget_lines (code, project, available, currency) VALUES ($1,$2,$3,$4) RETURNING id, code, project, available::float8 AS available, currency, active', [b.code, b.project ?? null, b.available ?? 0, b.currency ?? 'RWF']);
    await this.audit.log({ actorId: a.id, action: 'admin.budget_line_created', objectType: 'budget_line', objectId: r.id }); return r;
  }
  @Patch('budget-lines/:id') async patchBl(@CurrentUser() a: AuthUser, @Param('id') id: string, @Body() b: any) {
    const r = await this.db.one('UPDATE budget_lines SET project = COALESCE($2, project), available = COALESCE($3, available), currency = COALESCE($4, currency), active = COALESCE($5, active) WHERE id = $1 RETURNING id, code, project, available::float8 AS available, currency, active', [id, b?.project ?? null, b?.available ?? null, b?.currency ?? null, b?.active ?? null]);
    if (!r) throw notFound('budget line');
    await this.audit.log({ actorId: a.id, action: 'admin.budget_line_updated', objectType: 'budget_line', objectId: id, detail: b }); return r;
  }

  @Get('suppliers') async sup() { return { items: (await this.db.query('SELECT * FROM suppliers ORDER BY name')).rows }; }
  @Post('suppliers') async addSup(@CurrentUser() a: AuthUser, @Body() b: any) {
    if (!b?.name) throw validationError({ name: 'required' });
    const r = await this.db.one('INSERT INTO suppliers (name, tin_or_reg_no, contact_person, phone, email, address) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [b.name, b.tin_or_reg_no ?? null, b.contact_person ?? null, b.phone ?? null, b.email ?? null, b.address ?? null]);
    await this.audit.log({ actorId: a.id, action: 'admin.supplier_created', objectType: 'supplier', objectId: r.id }); return r;
  }
  @Patch('suppliers/:id') async patchSup(@CurrentUser() a: AuthUser, @Param('id') id: string, @Body() b: any) {
    if (!b || !Object.keys(b).length) throw badRequest('bad_request', 'Nothing to update');
    const r = await this.db.one(
      `UPDATE suppliers SET name = COALESCE($2, name), tin_or_reg_no = COALESCE($3, tin_or_reg_no), contact_person = COALESCE($4, contact_person), phone = COALESCE($5, phone), email = COALESCE($6, email), address = COALESCE($7, address), active = COALESCE($8, active) WHERE id = $1 RETURNING *`,
      [id, b.name ?? null, b.tin_or_reg_no ?? null, b.contact_person ?? null, b.phone ?? null, b.email ?? null, b.address ?? null, b.active ?? null]);
    if (!r) throw notFound('supplier');
    await this.audit.log({ actorId: a.id, action: 'admin.supplier_updated', objectType: 'supplier', objectId: id }); return r;
  }

  @Get('templates') async tpls() { return { items: (await this.templates.list()).map((t) => ({ ...this.templates.public(t), active: t.active })) }; }
}
