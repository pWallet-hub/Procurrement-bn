import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth';
import { badRequest, forbidden, guardError, notFound, validationError } from '../common/errors';
import { accessParams, caseVisible } from '../common/access';
import { DocumentsService } from '../documents/documents.service';
import { STAGE_DOCS, STAGE_LABELS, STAGE_ORDER } from '../workflow/stages';

@Injectable()
export class CasesService {
  constructor(private db: Db, private audit: AuditService, private docs: DocumentsService) {}

  private async visible(id: string, user: AuthUser) {
    const r = await this.db.one(`SELECT c.* FROM cases c WHERE c.id = $5 AND ${caseVisible('c')}`, [...accessParams(user), id]);
    if (!r) throw notFound('case');
    return r;
  }

  async dto(c: any) {
    const [bl, rb, sup, docs, actions] = await Promise.all([
      c.budget_line_id ? this.db.one('SELECT id, code FROM budget_lines WHERE id = $1', [c.budget_line_id]) : null,
      this.db.one('SELECT id, full_name FROM users WHERE id = $1', [c.requested_by]),
      c.selected_supplier_id ? this.db.one('SELECT id, name FROM suppliers WHERE id = $1', [c.selected_supplier_id]) : null,
      this.db.query(`SELECT d.id, d.doc_type, d.state, d.version, t.title FROM documents d JOIN form_templates t ON t.id = d.template_id WHERE d.case_id = $1 AND d.state <> 'cancelled' ORDER BY d.created_at`, [c.id]),
      this.db.query(
        `SELECT d.id AS document_id, d.doc_type, s.slot_key, s.label, s.role_code AS role, au.id AS au_id, au.full_name AS au_name
         FROM signature_slots s JOIN documents d ON d.id = s.document_id LEFT JOIN users au ON au.id = s.assigned_user_id
         WHERE d.case_id = $1 AND d.state = 'in_signing' AND s.status = 'pending' AND s.voided_at IS NULL ORDER BY d.created_at, s.seq`, [c.id]),
    ]);
    return {
      id: c.id, request_no: c.request_no, project: c.project, budget_line: bl, requested_by: rb, required_by: c.required_by,
      status: c.status, current_stage: c.current_stage, market_check_required: c.market_check_required, contract_required: c.contract_required,
      advance_arrangement: c.advance_arrangement, selected_supplier: sup, approved_amount: c.approved_amount == null ? null : Number(c.approved_amount),
      currency: c.currency, delivery: c.delivery, created_at: c.created_at, closed_at: c.closed_at,
      documents: docs.rows.map((d) => ({ id: d.id, doc_type: d.doc_type, title: d.title, state: d.state, version: d.version })),
      next_actions: actions.rows.map((a) => ({ document_id: a.document_id, doc_type: a.doc_type, slot_key: a.slot_key, label: a.label, role: a.role, assigned_user: a.au_id ? { id: a.au_id, full_name: a.au_name } : null })),
    };
  }

  async create(user: AuthUser, body: any) {
    const data = body?.data ?? {};
    const project = body?.project ?? data.project_activity ?? null;
    const budget = body?.budget_line_id ?? data.budget_line ?? null;
    const doc = await this.db.tx(async (c) => {
      const seq = (await c.query("SELECT nextval('request_no_seq') AS n")).rows[0].n;
      const requestNo = `AFS-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
      const cs = (await c.query(
        `INSERT INTO cases (request_no, project, budget_line_id, requested_by, department_id, required_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [requestNo, project, budget, user.id, user.department_id, body?.required_by ?? data.required_by_date ?? null])).rows[0];
      await this.audit.log({ actorId: user.id, action: 'case.created', objectType: 'case', objectId: cs.id, caseId: cs.id, detail: { request_no: requestNo } }, c);
      await this.docs.createDraft(c, 'PR-01', cs.id, user, { project_activity: project ?? undefined, budget_line: budget ?? undefined, required_by_date: body?.required_by ?? undefined, ...data });
      return cs;
    });
    return this.dto(doc);
  }

  async list(user: AuthUser, f: { status?: string; stage?: string; q?: string; limit?: number; cursor?: string }) {
    const limit = Math.min(f.limit ?? 25, 100);
    const offset = f.cursor ? Number(Buffer.from(f.cursor, 'base64').toString()) || 0 : 0;
    const params: any[] = [...accessParams(user)];
    const where = [caseVisible('c')];
    if (f.status) { params.push(f.status); where.push(`c.status = $${params.length}`); }
    if (f.stage) { params.push(f.stage); where.push(`c.current_stage = $${params.length}`); }
    if (f.q) { params.push(`%${f.q}%`); where.push(`(c.request_no ILIKE $${params.length} OR c.project ILIKE $${params.length})`); }
    params.push(limit + 1, offset);
    const rows = (await this.db.query(`SELECT c.* FROM cases c WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
    const items = [];
    for (const r of rows.slice(0, limit)) items.push(await this.dto(r));
    return { items, next_cursor: rows.length > limit ? Buffer.from(String(offset + limit)).toString('base64') : null };
  }

  async get(id: string, user: AuthUser) { return this.dto(await this.visible(id, user)); }

  async timeline(id: string, user: AuthUser) {
    const c = await this.visible(id, user);
    const docs = (await this.db.query(`SELECT d.id, d.doc_type, d.state, d.version, t.title FROM documents d JOIN form_templates t ON t.id = d.template_id WHERE d.case_id = $1 AND d.state <> 'cancelled' ORDER BY d.created_at`, [id])).rows;
    const cur = STAGE_ORDER.indexOf(c.current_stage);
    const stages = STAGE_ORDER.map((stage, i) => {
      const types = (STAGE_DOCS[stage] ?? []).map((d) => d.doc);
      let status: string = c.status === 'cancelled' ? (i < cur ? 'done' : 'upcoming') : i < cur ? 'done' : i === cur ? 'current' : 'upcoming';
      if (stage === 'market_check' && !c.market_check_required && !docs.some((d) => d.doc_type === 'MPV-03') && (i < cur || cur === -1 || i > cur)) status = 'skipped';
      if (stage === 'closed' && c.status === 'closed') status = 'done';
      return { stage, label: STAGE_LABELS[stage], status, documents: docs.filter((d) => types.includes(d.doc_type)).map((d) => ({ id: d.id, doc_type: d.doc_type, title: d.title, state: d.state, version: d.version })) };
    });
    const events = (await this.db.query(
      `SELECT e.id, e.at, e.action, e.object_type, e.object_id, e.case_id, e.detail, u.id AS uid, u.full_name FROM audit_events e LEFT JOIN users u ON u.id = e.actor_user_id
       WHERE e.case_id = $1 ORDER BY e.id DESC LIMIT 200`, [id])).rows.map((e) => ({ id: e.id, at: e.at, actor: e.uid ? { id: e.uid, full_name: e.full_name } : null, action: e.action, object_type: e.object_type, object_id: e.object_id, case_id: e.case_id, detail: e.detail }));
    return { stages, events };
  }

  async patch(id: string, user: AuthUser, body: any) {
    const c = await this.visible(id, user);
    if (c.status !== 'open') throw guardError('case_not_open', 'This case is closed or cancelled');
    const sets: string[] = []; const vals: any[] = [id];
    for (const k of ['market_check_required', 'contract_required'] as const) {
      if (body?.[k] !== undefined) { vals.push(!!body[k]); sets.push(`${k} = $${vals.length}`); }
    }
    if (!sets.length) throw badRequest('bad_request', 'Nothing to update');
    await this.db.tx(async (t) => {
      await t.query(`UPDATE cases SET ${sets.join(', ')} WHERE id = $1`, vals);
      await this.audit.log({ actorId: user.id, action: 'case.configured', objectType: 'case', objectId: id, caseId: id, detail: body }, t);
    });
    return this.get(id, user);
  }

  async delivery(id: string, user: AuthUser, body: any) {
    const c = await this.visible(id, user);
    if (c.status !== 'open' || c.current_stage !== 'delivery') throw guardError('wrong_stage', 'Delivery details are recorded in the delivery stage');
    const errors: Record<string, string> = {};
    for (const k of ['delivery_date', 'invoice_no', 'invoice_date', 'delivery_note_ref']) if (!body?.[k]) errors[k] = 'required';
    for (const k of ['delivery_date', 'invoice_date']) if (body?.[k] && !/^\d{4}-\d{2}-\d{2}$/.test(body[k])) errors[k] = 'must be a date (YYYY-MM-DD)';
    if (Object.keys(errors).length) throw validationError(errors);
    if (body.delivery_note_attachment_id) {
      const a = await this.db.one('SELECT 1 AS ok FROM attachments WHERE id = $1', [body.delivery_note_attachment_id]);
      if (!a) throw validationError({ delivery_note_attachment_id: 'file not found' });
    }
    const d = { delivery_date: body.delivery_date, invoice_no: body.invoice_no, invoice_date: body.invoice_date, delivery_note_ref: body.delivery_note_ref, delivery_note_attachment_id: body.delivery_note_attachment_id ?? null };
    await this.db.tx(async (t) => {
      await t.query("UPDATE cases SET delivery = $2, current_stage = 'payment' WHERE id = $1", [id, JSON.stringify(d)]);
      await this.audit.log({ actorId: user.id, action: 'case.delivery_recorded', objectType: 'case', objectId: id, caseId: id, detail: d }, t);
      await this.audit.log({ actorId: user.id, action: 'case.stage_changed', objectType: 'case', objectId: id, caseId: id, detail: { from: 'delivery', to: 'payment' } }, t);
    });
    return this.get(id, user);
  }

  async advance(id: string, user: AuthUser, reason: string) {
    await this.visible(id, user);
    if (!reason?.trim()) throw validationError({ reason: 'required' });
    await this.db.tx(async (t) => {
      await t.query('UPDATE cases SET advance_arrangement = $2 WHERE id = $1', [id, JSON.stringify({ reason: reason.trim(), by: user.id, at: new Date().toISOString() })]);
      await this.audit.log({ actorId: user.id, action: 'case.advance_arrangement', objectType: 'case', objectId: id, caseId: id, detail: { reason } }, t);
    });
    return this.get(id, user);
  }

  async cancel(id: string, user: AuthUser, reason: string) {
    const c = await this.visible(id, user);
    if (!reason?.trim()) throw validationError({ reason: 'required' });
    if (c.status !== 'open') throw guardError('case_not_open', 'This case is already closed or cancelled');
    if (!(c.requested_by === user.id || user.roles.includes('admin') || user.permissions.includes('case.configure'))) throw forbidden();
    await this.db.tx(async (t) => {
      await t.query("UPDATE cases SET status = 'cancelled', current_stage = 'cancelled', cancel_reason = $2, closed_at = now() WHERE id = $1", [id, reason.trim()]);
      await t.query("UPDATE signature_slots SET status = 'skipped' WHERE voided_at IS NULL AND status <> 'signed' AND document_id IN (SELECT id FROM documents WHERE case_id = $1)", [id]);
      await t.query("UPDATE documents SET state = 'cancelled', updated_at = now() WHERE case_id = $1 AND state IN ('draft','in_signing','returned')", [id]);
      await this.audit.log({ actorId: user.id, action: 'case.cancelled', objectType: 'case', objectId: id, caseId: id, detail: { reason: reason.trim() } }, t);
    });
    return this.get(id, user);
  }
}
