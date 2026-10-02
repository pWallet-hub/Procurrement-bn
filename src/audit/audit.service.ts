import { Injectable } from '@nestjs/common';
import { Db, Queryable } from '../db/db.service';
import { canonical, sha256 } from '../common/hash';

export interface AuditInput {
  actorId?: string | null; ip?: string | null; action: string;
  objectType?: string; objectId?: string | null; caseId?: string | null; detail?: any;
}

export function eventHash(prev: string | null, row: { at: string; actor_user_id: string | null; action: string; object_type: string | null; object_id: string | null; case_id: string | null; detail: any }) {
  return sha256((prev ?? '') + canonical(row));
}

@Injectable()
export class AuditService {
  constructor(private db: Db) {}

  /** Append one chained event. Pass the transaction client so it commits with the change it describes. */
  async log(e: AuditInput, q: Queryable = this.db): Promise<void> {
    await q.query('SELECT pg_advisory_xact_lock(727002)'); // serialise chain writes
    const prev = (await q.query('SELECT event_hash FROM audit_events ORDER BY id DESC LIMIT 1')).rows[0]?.event_hash ?? null;
    const at = new Date().toISOString();
    const row = {
      at, actor_user_id: e.actorId ?? null, action: e.action, object_type: e.objectType ?? null,
      object_id: e.objectId ?? null, case_id: e.caseId ?? null, detail: e.detail ?? null,
    };
    await q.query(
      `INSERT INTO audit_events (at, actor_user_id, actor_ip, action, object_type, object_id, case_id, detail, prev_hash, event_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [at, row.actor_user_id, e.ip ?? null, row.action, row.object_type, row.object_id, row.case_id, row.detail === null ? null : JSON.stringify(row.detail), prev, eventHash(prev, row)],
    );
  }

  /** Recompute the whole chain. Returns the id of the first broken row, or null when intact. */
  async verifyChain(q: Queryable = this.db): Promise<{ ok: boolean; failing_id?: number; checked: number }> {
    const { rows } = await q.query('SELECT * FROM audit_events ORDER BY id');
    let prev: string | null = null;
    for (const r of rows) {
      const expect = eventHash(prev, {
        at: new Date(r.at).toISOString(), actor_user_id: r.actor_user_id, action: r.action, object_type: r.object_type,
        object_id: r.object_id, case_id: r.case_id, detail: r.detail,
      });
      if (r.prev_hash !== prev || r.event_hash !== expect) return { ok: false, failing_id: Number(r.id), checked: rows.length };
      prev = r.event_hash;
    }
    return { ok: true, checked: rows.length };
  }
}
