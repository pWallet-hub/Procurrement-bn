import { Db } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth';
import { badRequest, notFound, validationError } from '../common/errors';

export async function createProgram(db: Db, audit: AuditService, u: AuthUser, b: any) {
  const name = String(b?.name ?? '').trim();
  if (!name) throw validationError({ name: 'required' });
  if (name.length > 120) throw validationError({ name: 'at most 120 characters' });
  const r = await db.one('INSERT INTO programs (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET active = true RETURNING id, name, active', [name]);
  await audit.log({ actorId: u.id, action: 'program.created', objectType: 'program', objectId: r.id, detail: { name } });
  return r;
}

export async function updateProgram(db: Db, audit: AuditService, u: AuthUser, id: string, b: any) {
  const name = b?.name === undefined ? null : String(b.name).trim();
  if (name === '') throw validationError({ name: 'required' });
  if (name === null && b?.active === undefined) throw badRequest('bad_request', 'Nothing to update');
  const r = await db.one('UPDATE programs SET name = COALESCE($2, name), active = COALESCE($3, active) WHERE id = $1 RETURNING id, name, active', [id, name, b?.active ?? null]);
  if (!r) throw notFound('program');
  await audit.log({ actorId: u.id, action: 'program.updated', objectType: 'program', objectId: id, detail: { name, active: b?.active ?? null } });
  return r;
}
