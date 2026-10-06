import { AuthUser } from '../common/auth';
import { Db } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { validationError } from '../common/errors';
import { CURRENCIES } from '../templates/definitions/dsl';

export const BUDGET_ROW = 'id, code, project, funding_source, funder, baseline::float8 AS baseline, available::float8 AS available, currency, active';

/** Field errors for a budget line body. `create` also requires the code and checks the internal/external rule. */
export function budgetLineErrors(b: any, create: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  if (create && !String(b?.code ?? '').trim()) e.code = 'required';
  if (b?.funding_source && !['internal', 'external'].includes(b.funding_source)) e.funding_source = 'internal or external';
  if (create && b?.funding_source === 'external' && !String(b?.funder ?? '').trim()) e.funder = 'required for an external budget';
  for (const k of ['baseline', 'available']) if (b?.[k] != null && b[k] !== '' && !(Number(b[k]) >= 0)) e[k] = 'must be 0 or more';
  if (b?.currency && !CURRENCIES.includes(b.currency)) e.currency = CURRENCIES.join(' / ');
  return e;
}

/** Shared by the admin page and the inline "new budget line" in form pickers. A new line starts with available = baseline unless given. */
export async function createBudgetLine(db: Db, audit: AuditService, actor: AuthUser, b: any) {
  const errors = budgetLineErrors(b, true);
  if (Object.keys(errors).length) throw validationError(errors);
  if (await db.one('SELECT 1 AS x FROM budget_lines WHERE code = $1', [b.code.trim()])) throw validationError({ code: 'already exists' });
  const external = b.funding_source === 'external';
  const baseline = b.baseline ?? b.available ?? 0;
  const r = await db.one(
    `INSERT INTO budget_lines (code, project, funding_source, funder, baseline, available, currency) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${BUDGET_ROW}`,
    [b.code.trim(), b.project ?? null, external ? 'external' : 'internal', external ? b.funder.trim() : null, baseline, b.available ?? baseline, b.currency || 'RWF']);
  await audit.log({ actorId: actor.id, action: 'budget_line.created', objectType: 'budget_line', objectId: r.id, detail: { code: r.code, funding_source: r.funding_source, baseline: r.baseline } });
  return r;
}
