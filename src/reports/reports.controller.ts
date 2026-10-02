import { Controller, Get } from '@nestjs/common';
import { Perm } from '../common/auth';
import { Db } from '../db/db.service';

@Controller('reports')
export class ReportsController {
  constructor(private db: Db) {}

  @Get('open-cases') @Perm('reports.view')
  async open() {
    const r = await this.db.query(
      `SELECT c.request_no, c.project, c.current_stage, u.full_name AS requested_by, c.created_at,
              EXTRACT(DAY FROM now() - c.created_at)::int AS age_days, c.approved_amount, c.currency
       FROM cases c JOIN users u ON u.id = c.requested_by WHERE c.status = 'open' ORDER BY c.created_at`);
    return { rows: r.rows };
  }

  @Get('cycle-time') @Perm('reports.view')
  async cycle() {
    const r = await this.db.query(
      `SELECT c.request_no, c.project, c.created_at, c.closed_at, ROUND(EXTRACT(EPOCH FROM c.closed_at - c.created_at) / 86400, 1) AS days
       FROM cases c WHERE c.status = 'closed' ORDER BY c.closed_at DESC`);
    const avg = r.rows.length ? Math.round((r.rows.reduce((a, x) => a + Number(x.days), 0) / r.rows.length) * 10) / 10 : null;
    return { rows: r.rows, average_days: avg };
  }

  @Get('spend') @Perm('reports.view')
  async spend() {
    const r = await this.db.query(
      `SELECT COALESCE(b.code, '(none)') AS budget_line, c.currency, COUNT(*)::int AS cases, SUM(c.approved_amount) AS approved_total
       FROM cases c LEFT JOIN budget_lines b ON b.id = c.budget_line_id WHERE c.approved_amount IS NOT NULL AND c.status <> 'cancelled'
       GROUP BY b.code, c.currency ORDER BY approved_total DESC`);
    return { rows: r.rows };
  }
}
