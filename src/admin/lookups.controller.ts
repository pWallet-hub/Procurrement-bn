import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthUser, CurrentUser, Perm } from '../common/auth';
import { Db } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { validationError } from '../common/errors';

@Controller('lookups')
export class LookupsController {
  constructor(private db: Db, private audit: AuditService) {}

  @Get('users') async users() {
    const r = await this.db.query(`SELECT u.id, u.full_name, u.position, u.email, COALESCE((SELECT array_agg(role_code) FROM user_roles WHERE user_id = u.id), '{}') AS roles FROM users u WHERE u.active ORDER BY u.full_name`);
    return { items: r.rows };
  }
  @Get('suppliers') async suppliers() { return { items: (await this.db.query('SELECT id, name, tin_or_reg_no, contact_person, phone, email, address FROM suppliers WHERE active ORDER BY name')).rows }; }
  @Get('budget-lines') async budget() { return { items: (await this.db.query('SELECT id, code, project, available::float8 AS available, currency FROM budget_lines WHERE active ORDER BY code')).rows }; }
  @Get('departments') async departments() { return { items: (await this.db.query('SELECT id, name FROM departments ORDER BY name')).rows }; }

  /** QC-02: the Accountant creates a supplier record when a quoting supplier is new */
  @Post('suppliers') @Perm('supplier.manage')
  async createSupplier(@CurrentUser() u: AuthUser, @Body() b: any) {
    if (!String(b?.name ?? '').trim()) throw validationError({ name: 'required' });
    const r = await this.db.one('INSERT INTO suppliers (name, tin_or_reg_no, contact_person, phone, email, address) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, tin_or_reg_no, contact_person, phone, email, address',
      [b.name.trim(), b.tin_or_reg_no ?? null, b.contact_person ?? null, b.phone ?? null, b.email ?? null, b.address ?? null]);
    await this.audit.log({ actorId: u.id, action: 'supplier.created', objectType: 'supplier', objectId: r.id, detail: { name: r.name } });
    return r;
  }
}
