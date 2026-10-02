import { Controller, Get, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, Perm } from '../common/auth';
import { Db } from '../db/db.service';
import { accessParams, caseVisible } from '../common/access';
import { AUDIT_SELECT, auditDto } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private db: Db) {}

  /** audit.read_all sees everything; audit.read_own sees events on cases they can see, or their own actions */
  @Get() @Perm()
  async search(@CurrentUser() u: AuthUser, @Query() q: any) {
    const all = u.permissions.includes('audit.read_all');
    if (!all && !u.permissions.includes('audit.read_own')) return { items: [], next_cursor: null };
    const params: any[] = all ? [] : [...accessParams(u)];
    const where: string[] = [];
    if (!all) where.push(`(e.actor_user_id = $1 OR e.case_id IN (SELECT c.id FROM cases c WHERE ${caseVisible('c')}))`);
    if (q.case_id) { params.push(q.case_id); where.push(`e.case_id = $${params.length}`); }
    if (q.actor) { params.push(q.actor); where.push(`e.actor_user_id = $${params.length}`); }
    if (q.from) { params.push(q.from); where.push(`e.at >= $${params.length}`); }
    if (q.to) { params.push(q.to); where.push(`e.at <= $${params.length}`); }
    if (q.cursor) { params.push(Number(q.cursor)); where.push(`e.id < $${params.length}`); }
    const limit = Math.min(Number(q.limit) || 50, 200);
    params.push(limit + 1);
    const rows = (await this.db.query(`${AUDIT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.id DESC LIMIT $${params.length}`, params)).rows;
    return { items: rows.slice(0, limit).map(auditDto), next_cursor: rows.length > limit ? String(rows[limit - 1].id) : null };
  }
}
