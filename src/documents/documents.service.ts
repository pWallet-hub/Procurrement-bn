import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { Db, Queryable } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth';
import { AppError, badRequest, forbidden, guardError, notFound, validationError } from '../common/errors';
import { canonical, documentHash, randomToken, sha256 } from '../common/hash';
import { accessParams, docVisible } from '../common/access';
import { TemplatesService, TemplateRow } from '../templates/templates.service';
import { applyComputed } from '../templates/computed';
import { collectFileIds, pickKnown, validateData } from '../templates/validate';
import { SlotDef } from '../templates/types';
import { runGuards } from '../workflow/guards';
import { WorkflowService } from '../workflow/workflow.service';
import { CASE_DOC_TYPES, EDIT_PERM, STANDALONE_DOC_TYPES, STAGE_DOCS, isSigned } from '../workflow/stages';
import { NotificationsService } from '../notifications/notifications.service';
import { QueueService } from '../notifications/queue.service';
import { StorageService } from '../attachments/storage.service';
import { config } from '../config/config';
import { CaseCtx, deriveAuto, loadCaseCtx, prefill } from './prefill';

export interface Actor { userId: string | null; name: string; ip: string | null; ua: string | null; user?: AuthUser }

const DATA_URL = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/;

@Injectable()
export class DocumentsService {
  constructor(
    private db: Db, private audit: AuditService, private templates: TemplatesService, private wf: WorkflowService,
    private notify: NotificationsService, private queue: QueueService, private storage: StorageService,
  ) {}

  // ---------- loading and DTO ----------

  private async loadVisible(q: Queryable, id: string, user: AuthUser, lock = false) {
    const r = await q.query(
      `SELECT d.* FROM documents d LEFT JOIN cases c ON c.id = d.case_id WHERE d.id = $5 AND ${docVisible('d', 'c')} ${lock ? 'FOR UPDATE OF d' : ''}`,
      [...accessParams(user), id]);
    if (!r.rows[0]) throw notFound('document');
    return r.rows[0];
  }

  private canEditDraft(doc: any, user: AuthUser) {
    return doc.created_by === user.id || (EDIT_PERM[doc.doc_type] ? user.permissions.includes(EDIT_PERM[doc.doc_type]) : false);
  }

  private eligible(slot: any, user: AuthUser) {
    if (slot.status !== 'pending' || slot.external_email) return false;
    return slot.assigned_user_id ? slot.assigned_user_id === user.id : user.roles.includes(slot.role_code);
  }

  private async slotsOf(q: Queryable, docId: string, includeVoided = false) {
    return (await q.query(
      `SELECT s.*, au.full_name AS assigned_name, g.signer_name, g.signed_at, g.method, g.signature_image_key, g.slot_data, g.signer_user_id
       FROM signature_slots s LEFT JOIN users au ON au.id = s.assigned_user_id LEFT JOIN signatures g ON g.slot_id = s.id
       WHERE s.document_id = $1 ${includeVoided ? '' : 'AND s.voided_at IS NULL'} ORDER BY s.seq, s.slot_key`, [docId])).rows;
  }

  /** data as shown to clients: frozen data plus fields filled at earlier signature slots */
  private mergedData(doc: any, slots: any[]) {
    let out = { ...doc.data };
    for (const s of slots.filter((x) => x.slot_data && x.status === 'signed').sort((a, b) => +new Date(a.signed_at) - +new Date(b.signed_at))) out = { ...out, ...Object.fromEntries(Object.entries(s.slot_data).filter(([k]) => !k.startsWith('_'))) };
    return out;
  }

  async dto(doc: any, user: AuthUser | null, validation?: Record<string, string>) {
    const tpl = await this.templates.byId(doc.template_id);
    const slots = await this.slotsOf(this.db, doc.id);
    const creator = await this.db.one('SELECT id, full_name FROM users WHERE id = $1', [doc.created_by]);
    const cs = doc.case_id ? await this.db.one('SELECT request_no FROM cases WHERE id = $1', [doc.case_id]) : null;
    const data = this.mergedData(doc, slots);
    const signedAny = slots.some((s) => s.status === 'signed');
    const sign = user ? slots.filter((s) => this.eligible(s, user)).map((s) => s.slot_key) : [];
    const editor = user ? this.canEditDraft(doc, user) : false;
    const out: any = {
      id: doc.id, case_id: doc.case_id, request_no: cs?.request_no ?? null, doc_type: doc.doc_type, title: tpl.title, state: doc.state,
      version: doc.version, data, content_hash: doc.content_hash, template: { code: tpl.code, version: tpl.version },
      created_by: creator, created_at: doc.created_at, updated_at: doc.updated_at, returned_reason: doc.returned_reason,
      pdf_available: !!doc.pdf_object_key,
      slots: slots.map((s) => ({
        slot_key: s.slot_key, label: s.label, role_code: s.role_code, seq: s.seq, group: s.grp, status: s.status, declaration: s.declaration,
        external: !!s.external_email,
        assigned_user: s.assigned_user_id ? { id: s.assigned_user_id, full_name: s.assigned_name } : null,
        signature: s.signed_at ? { signer_name: s.signer_name, signed_at: s.signed_at, method: s.method, image_url: s.signature_image_key ? `/api/v1/documents/${doc.id}/slots/${s.slot_key}/signature.png` : undefined } : null,
      })),
      can: {
        edit: editor && doc.state === 'draft', submit: editor && doc.state === 'draft',
        sign, decline: sign, revise: editor && doc.state === 'returned',
        cancel: !!user && ((['draft', 'returned'].includes(doc.state) && editor) || (doc.state === 'in_signing' && !signedAny && doc.created_by === user.id) || (user.roles.includes('admin') && !['archived', 'cancelled'].includes(doc.state))),
        edit_request: !!user && doc.state === 'in_signing' && (doc.created_by === user.id || user.roles.includes('accountant')),
        assign: !!user && doc.state === 'in_signing' && (doc.created_by === user.id || user.roles.includes('accountant') || user.roles.includes('admin')),
      },
    };
    if (validation) out.validation = { errors: validation };
    return out;
  }

  async get(id: string, user: AuthUser) {
    const doc = await this.loadVisible(this.db, id, user);
    const tpl = await this.templates.byId(doc.template_id);
    const validation = doc.state === 'draft' ? validateData(tpl as any, doc.data, false) : undefined;
    return this.dto(doc, user, validation);
  }

  async list(user: AuthUser, f: { doc_type?: string; state?: string; mine?: boolean; limit?: number; cursor?: string }) {
    const limit = Math.min(f.limit ?? 25, 100);
    const offset = f.cursor ? Number(Buffer.from(f.cursor, 'base64').toString()) || 0 : 0;
    const where: string[] = [docVisible('d', 'c')];
    const params: any[] = [...accessParams(user)];
    if (f.doc_type) { params.push(f.doc_type); where.push(`d.doc_type = $${params.length}`); }
    if (f.state) { params.push(f.state); where.push(`d.state = $${params.length}`); }
    if (f.mine) where.push('d.created_by = $1');
    params.push(limit + 1, offset);
    const rows = (await this.db.query(
      `SELECT d.* FROM documents d LEFT JOIN cases c ON c.id = d.case_id WHERE ${where.join(' AND ')} ORDER BY d.updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
    const items = [];
    for (const d of rows.slice(0, limit)) items.push(await this.dto(d, user));
    return { items, next_cursor: rows.length > limit ? Buffer.from(String(offset + limit)).toString('base64') : null };
  }

  // ---------- create / edit ----------

  /** Create a draft. `q` is the caller's transaction client when part of case creation. */
  async createDraft(q: Queryable, docType: string, caseId: string | null, user: AuthUser, initial: Record<string, any> = {}) {
    const tpl = await this.templates.active(docType);
    const c = caseId ? await loadCaseCtx(q, caseId) : null;
    const dep = user.department_id ? (await q.query('SELECT name FROM departments WHERE id = $1', [user.department_id])).rows[0]?.name : null;
    const pre = await prefill(q, docType, c, { id: user.id, department: dep });
    // date fields marked default:"today" start with the creation date (the person can still change it)
    const todayStr = new Date().toISOString().slice(0, 10);
    const dateDefaults = Object.fromEntries(tpl.schema.sections.flatMap((sec: any) => sec.fields).filter((f: any) => f.type === 'date' && f.default === 'today').map((f: any) => [f.key, todayStr]));
    const merged = pickKnown(tpl as any, { ...dateDefaults, ...pre, ...initial });
    const data = applyComputed(tpl as any, await deriveAuto(q, docType, merged, c));
    const doc = (await q.query(
      `INSERT INTO documents (case_id, template_id, doc_type, data, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [caseId, tpl.id, docType, JSON.stringify(data), user.id])).rows[0];
    await this.audit.log({ actorId: user.id, action: 'document.created', objectType: 'document', objectId: doc.id, caseId, detail: { doc_type: docType } }, q);
    return doc;
  }

  async createStandalone(user: AuthUser, docType: string, data: Record<string, any> | undefined) {
    if (!STANDALONE_DOC_TYPES.includes(docType)) throw badRequest('bad_doc_type', 'Only GR-06 and IM-08 can be created outside a case');
    if (!user.permissions.includes('case.create') && !user.permissions.includes('document.edit')) throw forbidden();
    const doc = await this.createDraft(this.db, docType, null, user, data ?? {});
    return this.dto(doc, user, validateData(await this.templates.active(docType) as any, doc.data, false));
  }

  async createForCase(caseId: string, docType: string, user: AuthUser) {
    return this.db.tx(async (c) => {
      const cs = (await c.query('SELECT * FROM cases WHERE id = $1 FOR UPDATE', [caseId])).rows[0];
      if (!cs) throw notFound('case');
      if (cs.status !== 'open') throw guardError('case_not_open', 'This case is closed or cancelled');
      const allowed = STAGE_DOCS[cs.current_stage]?.find((d) => d.doc === docType);
      if (!allowed || !CASE_DOC_TYPES.includes(docType)) throw guardError('wrong_stage', `${docType} cannot be created in the "${cs.current_stage}" stage`);
      const isReq = cs.requested_by === user.id;
      if (allowed.perm ? !(user.permissions.includes(allowed.perm) || (docType === 'QE-03' && isReq)) : !user.permissions.includes('case.create')) throw forbidden();
      const existing = await c.query("SELECT 1 FROM documents WHERE case_id = $1 AND doc_type = $2 AND state <> 'cancelled'", [caseId, docType]);
      if (existing.rowCount) throw guardError('document_exists', `${docType} already exists for this case`);
      if (docType === 'PO-09') await runGuards(['po_from_approved_eval'], { q: c, tpl: { code: docType, schema: null }, doc: { id: '', case_id: caseId, doc_type: docType, state: 'draft', data: {} }, data: {}, caseRow: cs });
      return this.createDraft(c, docType, caseId, user);
    }).then((d) => this.dto(d, user));
  }

  async patch(id: string, user: AuthUser, body: any) {
    if (!body || typeof body.data !== 'object' || Array.isArray(body.data)) throw badRequest('bad_request', 'data object required', { data: 'required' });
    const result = await this.db.tx(async (c) => {
      const doc = await this.loadVisible(c, id, user, true);
      if (doc.state !== 'draft') throw guardError('frozen_after_sign', 'This document is no longer a draft and cannot be changed');
      if (!this.canEditDraft(doc, user)) throw forbidden('You cannot edit this document');
      const tpl = await this.templates.byId(doc.template_id);
      const known = pickKnown(tpl as any, body.data);
      const cc = doc.case_id ? await loadCaseCtx(c, doc.case_id) : null;
      // readonly (server controlled) fields cannot be overwritten by the client
      const ro = new Set(tpl.schema.sections.flatMap((s: any) => s.fields).filter((f: any) => f.readonly || f.type === 'case_ref' || f.type === 'computed').map((f: any) => f.key));
      for (const k of Object.keys(known)) if (ro.has(k)) delete known[k];
      const data = applyComputed(tpl as any, await deriveAuto(c, doc.doc_type, { ...doc.data, ...known }, cc));
      const errors = validateData(tpl as any, data, false);
      const upd = (await c.query('UPDATE documents SET data = $2, updated_at = now() WHERE id = $1 RETURNING *', [id, JSON.stringify(data)])).rows[0];
      return { upd, errors };
    });
    return this.dto(result.upd, user, result.errors);
  }

  // ---------- submit ----------

  async submit(id: string, user: AuthUser, idem: string | null) {
    const res = await this.db.tx(async (c) => {
      const doc = await this.loadVisible(c, id, user, true);
      if (await this.idemGet(c, idem, user.id, `submit:${id}`)) return { done: true };
      if (doc.state !== 'draft') throw guardError('invalid_state', 'Only a draft can be submitted');
      if (!this.canEditDraft(doc, user)) throw forbidden();
      const tpl = await this.templates.byId(doc.template_id);
      const cc = doc.case_id ? await loadCaseCtx(c, doc.case_id) : null;
      const caseRow = doc.case_id ? (await c.query('SELECT * FROM cases WHERE id = $1', [doc.case_id])).rows[0] : null;
      const data = applyComputed(tpl as any, await deriveAuto(c, doc.doc_type, pickKnown(tpl as any, doc.data), cc));
      await runGuards(tpl.workflow.guards_on_submit, { q: c, tpl, doc, data, caseRow, actorId: user.id });

      const fileIds = collectFileIds(tpl as any, data);
      const hashes = await this.attachmentHashes(c, fileIds);
      const hash = documentHash(tpl.code, tpl.version, data, hashes);
      const slotDefs: SlotDef[] = tpl.signature_slots;
      const minSeq = Math.min(...slotDefs.map((s) => s.seq));
      const supplierEmail = data.supplier ? (await c.query('SELECT email FROM suppliers WHERE id = $1', [data.supplier])).rows[0]?.email : null;
      if (slotDefs.some((s) => s.external) && !supplierEmail) throw guardError('supplier_email_required', 'The supplier needs an e-mail address to receive the signing link', { supplier: 'no e-mail on record' });

      const created: any[] = [];
      for (const s of slotDefs) {
        const assigned = s.assign === 'creator' ? doc.created_by : s.assign === 'case_requester' ? (caseRow?.requested_by ?? doc.created_by) : null;
        const r = await c.query(
          `INSERT INTO signature_slots (document_id, slot_key, label, role_code, seq, grp, declaration, assigned_user_id, external_email, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [id, s.key, s.label, s.role, s.seq, s.group ?? null, s.declaration, assigned, s.external ? supplierEmail : null, s.seq === minSeq ? 'pending' : 'waiting']);
        created.push(r.rows[0]);
      }
      await c.query("UPDATE documents SET state = 'in_signing', data = $2, content_hash = $3, returned_reason = NULL, updated_at = now() WHERE id = $1", [id, JSON.stringify(data), hash]);
      await this.audit.log({ actorId: user.id, ip: null, action: 'document.submitted', objectType: 'document', objectId: id, caseId: doc.case_id, detail: { content_hash: hash, version: doc.version } }, c);
      for (const s of created.filter((x) => x.status === 'pending')) await this.activateSlot(c, { ...doc, data }, tpl, s);
      await this.idemPut(c, idem, user.id, `submit:${id}`, { done: true });
      return { done: true };
    });
    void res;
    await this.notify.flush();
    return this.get(id, user);
  }

  private async attachmentHashes(q: Queryable, ids: string[]) {
    if (!ids.length) return [];
    const r = await q.query('SELECT id, sha256 FROM attachments WHERE id = ANY($1::uuid[])', [ids]);
    if (r.rowCount !== new Set(ids).size) throw validationError({ attachment: 'one or more attached files do not exist' });
    return r.rows.map((x) => x.sha256 as string);
  }

  /** notify the people who may sign this slot, or create the single use token for an external signer */
  private async activateSlot(q: Queryable, doc: any, tpl: TemplateRow, slot: any) {
    const title = tpl.title;
    const cs = doc.case_id ? (await q.query('SELECT request_no FROM cases WHERE id = $1', [doc.case_id])).rows[0] : null;
    const vars = { document_title: title, request_no: cs?.request_no ?? '' };
    if (slot.external_email) {
      const token = randomToken();
      await q.query("INSERT INTO signing_tokens (slot_id, token_hash, expires_at) VALUES ($1,$2, now() + ($3 || ' hours')::interval)", [slot.id, sha256(token), String(config.signingTokenHours)]);
      await this.notify.send({ email: slot.external_email, kind: 'external_sign', subject: `Please sign: ${title}`, vars: { ...vars, signer_name: slot.external_email, link: `${config.appUrl}/sign/${token}` }, inApp: false }, q);
      return;
    }
    const people = slot.assigned_user_id
      ? [{ id: slot.assigned_user_id }]
      : (await q.query('SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id WHERE r.role_code = $1 AND u.active', [slot.role_code])).rows;
    for (const p of people) {
      const u = (await q.query('SELECT full_name FROM users WHERE id = $1', [p.id])).rows[0];
      await this.notify.send({ userId: p.id, kind: 'sign_requested', subject: `Signature requested: ${title}`, vars: { ...vars, signer_name: u?.full_name }, path: `/documents/${doc.id}` }, q);
    }
  }

  // ---------- signing ----------

  async signInternal(id: string, slotKey: string, user: AuthUser, body: any, ip: string | null, ua: string | null, idem: string | null) {
    const out = await this.db.tx(async (c) => {
      const doc = await this.loadVisible(c, id, user, true);
      const cached = await this.idemGet(c, idem, user.id, `sign:${id}:${slotKey}`);
      if (cached) return { result: cached, after: {} };
      const slot = (await c.query('SELECT * FROM signature_slots WHERE document_id = $1 AND slot_key = $2 AND voided_at IS NULL FOR UPDATE', [id, slotKey])).rows[0];
      if (!slot) throw notFound('signature slot');
      if (!this.eligible(slot, user)) {
        if (slot.status === 'signed') throw guardError('no_duplicate_signature', 'This slot is already signed');
        throw forbidden(slot.status === 'waiting' ? 'Earlier signatures are still missing' : 'This signature slot is not yours to sign');
      }
      const res = await this.performSign(c, doc, slot, { userId: user.id, name: user.full_name, ip, ua, user }, body);
      await this.idemPut(c, idem, user.id, `sign:${id}:${slotKey}`, res.result);
      return res;
    });
    await this.afterSign(out);
    return out.result;
  }

  async afterSign(out: any) {
    await this.notify.flush();
    if (out?.after?.pdf) await this.queue.add('pdf.render', { documentId: out.after.pdf }, { jobId: `pdf-${out.after.pdf}-${Date.now()}` });
    if (out?.after?.caseFile) await this.queue.add('pdf.case_file', { caseId: out.after.caseFile });
  }

  /** Store `buf` as the account's saved signature (used by method "saved" and the Profile page). */
  async saveUserSignature(q: Queryable, userId: string, buf: Buffer, ext: 'png' | 'jpg') {
    const key = `users/${userId}/signature.${ext}`;
    await this.storage.put(key, buf, `image/${ext === 'png' ? 'png' : 'jpeg'}`);
    await q.query('UPDATE users SET signature_image_key = $2 WHERE id = $1', [userId, key]);
    await this.audit.log({ actorId: userId, action: 'user.signature_saved', objectType: 'user', objectId: userId }, q);
  }

  /** Shared by internal and external signers. Runs inside the caller's transaction. */
  async performSign(c: PoolClient, doc: any, slot: any, actor: Actor, body: any) {
    if (doc.state !== 'in_signing') throw guardError('invalid_state', 'This document is not open for signing');
    if (!body?.content_hash || body.content_hash !== doc.content_hash) throw guardError('hash_mismatch', 'The document changed since you opened it. Reload and review it again.');
    if (body.declaration_accepted !== true) throw guardError('declaration_required', 'Tick the declaration to sign', { declaration_accepted: 'required' });
    const method = body.method;
    if (!['draw', 'type', 'upload', 'saved'].includes(method)) throw badRequest('bad_method', 'method must be draw, type, upload or saved', { method: 'invalid' });
    let imageKey: string | null = null;
    if (method === 'saved') {
      // the signature saved on the signer's account is COPIED into this document, so changing it later never alters past signatures
      const saved = actor.userId ? (await c.query('SELECT signature_image_key FROM users WHERE id = $1', [actor.userId])).rows[0]?.signature_image_key : null;
      if (!saved) throw badRequest('no_saved_signature', 'You have no saved signature yet. Draw or upload one first.', { method: 'no saved signature' });
      const ext = String(saved).endsWith('png') ? 'png' : 'jpg';
      imageKey = `signatures/${doc.id}/${slot.id}.${ext}`;
      await this.storage.put(imageKey, await this.storage.get(saved), `image/${ext === 'png' ? 'png' : 'jpeg'}`);
    } else if (method === 'type') {
      if (!String(body.signature_text ?? '').trim()) throw badRequest('bad_signature', 'Type your name to sign', { signature_text: 'required' });
    } else {
      const m = DATA_URL.exec(body.signature_image ?? '');
      if (!m) throw badRequest('bad_signature', 'Provide the signature as a PNG or JPEG data URL', { signature_image: 'required' });
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 1024 * 1024) throw badRequest('bad_signature', 'Signature image is too large', { signature_image: 'too large' });
      imageKey = `signatures/${doc.id}/${slot.id}.${m[1] === 'png' ? 'png' : 'jpg'}`;
      await this.storage.put(imageKey, buf, `image/${m[1]}`);
      if (body.save_signature === true && actor.userId) await this.saveUserSignature(c, actor.userId, buf, m[1] === 'png' ? 'png' : 'jpg');
    }

    const tpl = await this.templates.byId(doc.template_id);
    const caseRow = doc.case_id ? (await c.query('SELECT * FROM cases WHERE id = $1', [doc.case_id])).rows[0] : null;
    const slots = await this.slotsOf(c, doc.id);
    const merged = this.mergedData(doc, slots);

    // fields filled at this slot (e.g. the IM-08 decision, the GR-06 finance action)
    let slotData: Record<string, any> | null = null;
    const fillFields = tpl.schema.sections.flatMap((s: any) => s.fields).filter((f: any) => f.fill_at === slot.slot_key);
    if (fillFields.length) {
      const incoming = pickKnown(tpl as any, body.data ?? {});
      slotData = applyComputed(tpl as any, Object.fromEntries(fillFields.filter((f: any) => incoming[f.key] !== undefined || incoming[`${f.key}_other`] !== undefined).flatMap((f: any) => [[f.key, incoming[f.key]], [`${f.key}_other`, incoming[`${f.key}_other`]]]).filter(([, v]: any) => v !== undefined)));
      const errors = validateData(tpl as any, { ...merged, ...slotData }, true, slot.slot_key);
      if (Object.keys(errors).length) throw validationError(errors);
    }

    await runGuards(tpl.workflow.guards_on_sign, { q: c, tpl, doc, data: merged, caseRow, actorId: actor.userId, slot, body: { ...body, data: slotData ?? undefined } });
    if (tpl.workflow.requires_conflict_confirmation && body.conflict_confirmed !== true) {
      await runGuards(['conflict_confirmed'], { q: c, tpl, doc, data: merged, caseRow, body });
    }

    const signedAt = new Date();
    await c.query(
      `INSERT INTO signatures (slot_id, signer_user_id, signer_name, method, signature_image_key, signature_text, signed_at, ip, user_agent, document_hash, declaration_text, slot_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [slot.id, actor.userId, actor.name, method, imageKey, body.signature_text ?? null, signedAt, actor.ip, actor.ua, doc.content_hash, slot.declaration,
       slotData || body.signer_position ? JSON.stringify({ ...(slotData ?? {}), ...(body.signer_position ? { _signer_position: String(body.signer_position).slice(0, 120) } : {}) }) : null]);
    await c.query("UPDATE signature_slots SET status = 'signed', assigned_user_id = COALESCE(assigned_user_id, $2) WHERE id = $1", [slot.id, actor.userId]);
    await this.audit.log({
      actorId: actor.userId, ip: actor.ip, action: 'document.signed', objectType: 'document', objectId: doc.id, caseId: doc.case_id,
      detail: { slot_key: slot.slot_key, document_hash: doc.content_hash, method, signer: actor.name, slot_data_hash: slotData ? sha256(canonical(slotData)) : null },
    }, c);

    // advance: open the next sequence group, or finish the document
    const rest = (await c.query("SELECT * FROM signature_slots WHERE document_id = $1 AND voided_at IS NULL ORDER BY seq", [doc.id])).rows;
    const open = rest.filter((s) => s.status !== 'signed');
    const after: any = {};
    let nextSlots: any[] = [];
    let state = 'in_signing';
    if (!open.length) {
      state = 'signed';
      await c.query("UPDATE documents SET state = 'signed', updated_at = now() WHERE id = $1", [doc.id]);
      await this.audit.log({ actorId: actor.userId, action: 'document.completed', objectType: 'document', objectId: doc.id, caseId: doc.case_id }, c);
      const mergedFinal = this.mergedData(doc, await this.slotsOf(c, doc.id));
      const wfres = await this.wf.onDocumentSigned(c, { ...doc, data: { ...doc.data, ...mergedFinal } }, actor.userId);
      after.pdf = doc.id;
      if (wfres.closed) after.caseFile = doc.case_id;
      await this.notifyCompleted(c, doc, tpl);
      if (doc.doc_type === 'IM-08') await this.notifyFollowUps(c, doc, mergedFinal, tpl);
    } else {
      const minOpenSeq = Math.min(...open.map((s) => s.seq));
      const lowerPending = open.some((s) => s.status === 'pending');
      if (!lowerPending) {
        for (const s of open.filter((x) => x.seq === minOpenSeq)) {
          await c.query("UPDATE signature_slots SET status = 'pending' WHERE id = $1", [s.id]);
          await this.activateSlot(c, doc, tpl, { ...s, status: 'pending' });
          nextSlots.push({ slot_key: s.slot_key, label: s.label, role: s.role_code });
        }
      } else {
        nextSlots = open.filter((s) => s.status === 'pending').map((s) => ({ slot_key: s.slot_key, label: s.label, role: s.role_code }));
      }
    }
    return { result: { document_state: state, signed_at: signedAt.toISOString(), next_slots: nextSlots }, after };
  }

  private async notifyCompleted(c: Queryable, doc: any, tpl: TemplateRow) {
    const people = (await c.query(
      `SELECT DISTINCT u.id, u.full_name FROM users u WHERE u.id = $1 OR u.id IN (
         SELECT g.signer_user_id FROM signatures g JOIN signature_slots s ON s.id = g.slot_id WHERE s.document_id = $2 AND g.signer_user_id IS NOT NULL)`, [doc.created_by, doc.id])).rows;
    const cs = doc.case_id ? (await c.query('SELECT request_no FROM cases WHERE id = $1', [doc.case_id])).rows[0] : null;
    for (const p of people) {
      await this.notify.send({ userId: p.id, kind: 'completed', subject: `Fully signed: ${tpl.title}`, vars: { document_title: tpl.title, request_no: cs?.request_no ?? '', signer_name: p.full_name }, path: `/documents/${doc.id}` }, c);
    }
  }

  private async notifyFollowUps(c: Queryable, doc: any, data: any, tpl: TemplateRow) {
    if (!['approved', 'approved_with_conditions'].includes(data.decision_status)) return;
    for (const row of data.follow_up ?? []) {
      if (!row.staff) continue;
      const u = (await c.query('SELECT full_name FROM users WHERE id = $1', [row.staff])).rows[0];
      await this.notify.send({ userId: row.staff, kind: 'followup', subject: `Action assigned: ${data.memo_reference_name}`, vars: { signer_name: u?.full_name, document_title: tpl.title, action: row.action_assigned, due_date: row.due_date }, path: `/documents/${doc.id}` }, c);
    }
  }

  async signExternal(token: string, body: any, ip: string | null, ua: string | null) {
    const out = await this.db.tx(async (c) => {
      const t = (await c.query('SELECT * FROM signing_tokens WHERE token_hash = $1 FOR UPDATE', [sha256(token)])).rows[0];
      if (!t || t.used_at || new Date(t.expires_at) < new Date()) throw new AppError(410, 'sign.invalid_token', 'This signing link is invalid, used or expired');
      const slot = (await c.query('SELECT * FROM signature_slots WHERE id = $1 FOR UPDATE', [t.slot_id])).rows[0];
      const doc = (await c.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [slot.document_id])).rows[0];
      if (slot.status !== 'pending') throw new AppError(410, 'sign.invalid_token', 'This signature is no longer pending');
      const name = String(body.signer_name ?? '').trim();
      if (!name) throw badRequest('bad_request', 'Your name is required', { signer_name: 'required' });
      const res = await this.performSign(c, doc, slot, { userId: null, name, ip, ua }, body);
      await c.query('UPDATE signing_tokens SET used_at = now() WHERE id = $1', [t.id]);
      return res;
    });
    await this.afterSign(out);
    return { ok: true };
  }

  async externalView(token: string) {
    const t = await this.db.one('SELECT * FROM signing_tokens WHERE token_hash = $1', [sha256(token)]);
    if (!t || t.used_at || new Date(t.expires_at) < new Date()) throw new AppError(410, 'sign.invalid_token', 'This signing link is invalid, used or expired');
    const slot = await this.db.one('SELECT * FROM signature_slots WHERE id = $1', [t.slot_id]);
    if (slot.status !== 'pending') throw new AppError(410, 'sign.invalid_token', 'This signature is no longer pending');
    const doc = await this.db.one('SELECT * FROM documents WHERE id = $1', [slot.document_id]);
    return { document: await this.dto(doc, null), template: this.templates.public(await this.templates.byId(doc.template_id)), slot: { slot_key: slot.slot_key, label: slot.label, declaration: slot.declaration }, signer_email: slot.external_email };
  }

  // ---------- decline / return / revise / cancel / assign ----------

  private async voidSlots(c: Queryable, docId: string) {
    await c.query("UPDATE signature_slots SET status = 'skipped' WHERE document_id = $1 AND voided_at IS NULL AND status <> 'declined'", [docId]);
  }

  private async returnDoc(c: PoolClient, doc: any, tpl: TemplateRow, actor: AuthUser, reason: string, action: string, slotKey?: string) {
    await this.voidSlots(c, doc.id);
    await c.query("UPDATE documents SET state = 'returned', returned_reason = $2, updated_at = now() WHERE id = $1", [doc.id, reason]);
    await this.audit.log({ actorId: actor.id, action, objectType: 'document', objectId: doc.id, caseId: doc.case_id, detail: { reason, slot_key: slotKey ?? null, voided_signatures: true } }, c);
    const signers = (await c.query('SELECT DISTINCT g.signer_user_id AS id FROM signatures g JOIN signature_slots s ON s.id = g.slot_id WHERE s.document_id = $1 AND s.voided_at IS NULL AND g.signer_user_id IS NOT NULL', [doc.id])).rows;
    const cs = doc.case_id ? (await c.query('SELECT request_no FROM cases WHERE id = $1', [doc.case_id])).rows[0] : null;
    for (const id of new Set([doc.created_by, ...signers.map((s) => s.id)])) {
      if (id === actor.id) continue;
      await this.notify.send({ userId: id as string, kind: 'returned', subject: `Returned: ${tpl.title}`, vars: { document_title: tpl.title, request_no: cs?.request_no ?? '', reason }, path: `/documents/${doc.id}` }, c);
    }
  }

  async decline(id: string, slotKey: string, user: AuthUser, reason: string) {
    if (!reason?.trim()) throw badRequest('reason_required', 'A reason is required', { reason: 'required' });
    await this.db.tx(async (c) => {
      const doc = await this.loadVisible(c, id, user, true);
      const slot = (await c.query('SELECT * FROM signature_slots WHERE document_id = $1 AND slot_key = $2 AND voided_at IS NULL', [id, slotKey])).rows[0];
      if (!slot || doc.state !== 'in_signing' || !this.eligible(slot, user)) throw forbidden('You cannot decline this slot');
      await c.query("UPDATE signature_slots SET status = 'declined' WHERE id = $1", [slot.id]);
      await this.returnDoc(c, doc, await this.templates.byId(doc.template_id), user, reason.trim(), 'document.declined', slotKey);
    });
    await this.notify.flush();
    return this.get(id, user);
  }

  async editRequest(id: string, user: AuthUser, reason: string) {
    if (!reason?.trim()) throw badRequest('reason_required', 'A reason is required', { reason: 'required' });
    await this.db.tx(async (c) => {
      const doc = await this.loadVisible(c, id, user, true);
      if (doc.state !== 'in_signing') throw guardError('invalid_state', 'Only a document in signing can be sent back for edits');
      if (!(doc.created_by === user.id || user.roles.includes('accountant'))) throw forbidden();
      await this.returnDoc(c, doc, await this.templates.byId(doc.template_id), user, reason.trim(), 'document.edit_requested');
    });
    await this.notify.flush();
    return this.get(id, user);
  }

  async revise(id: string, user: AuthUser) {
    await this.db.tx(async (c) => {
      const doc = await this.loadVisible(c, id, user, true);
      if (doc.state !== 'returned') throw guardError('invalid_state', 'Only a returned document can be revised');
      if (!this.canEditDraft(doc, user)) throw forbidden();
      await c.query('UPDATE signature_slots SET voided_at = now() WHERE document_id = $1 AND voided_at IS NULL', [id]);
      // fields filled at later slots go back into the data so nothing is lost; signatures stay in the audit trail
      await c.query("UPDATE documents SET state = 'draft', version = version + 1, content_hash = NULL, updated_at = now() WHERE id = $1", [id]);
      await this.audit.log({ actorId: user.id, action: 'document.revised', objectType: 'document', objectId: id, caseId: doc.case_id, detail: { version: doc.version + 1 } }, c);
    });
    return this.get(id, user);
  }

  async cancel(id: string, user: AuthUser, reason: string) {
    if (!reason?.trim()) throw badRequest('reason_required', 'A reason is required', { reason: 'required' });
    await this.db.tx(async (c) => {
      const doc = await this.loadVisible(c, id, user, true);
      if (['archived', 'cancelled', 'signed'].includes(doc.state)) throw guardError('invalid_state', 'This document can no longer be cancelled');
      const hasSig = (await c.query("SELECT 1 FROM signature_slots WHERE document_id = $1 AND voided_at IS NULL AND status = 'signed'", [id])).rowCount;
      const creatorOk = doc.created_by === user.id && (doc.state !== 'in_signing' || !hasSig);
      if (!(creatorOk || user.roles.includes('admin'))) throw forbidden();
      await this.voidSlots(c, id);
      await c.query("UPDATE documents SET state = 'cancelled', returned_reason = $2, updated_at = now() WHERE id = $1", [id, reason.trim()]);
      await this.audit.log({ actorId: user.id, action: 'document.cancelled', objectType: 'document', objectId: id, caseId: doc.case_id, detail: { reason } }, c);
    });
    return this.get(id, user);
  }

  /** Assign a delegate to a slot (e.g. QE-03 reviewer when the requester is the Director or PI) */
  async assign(id: string, slotKey: string, user: AuthUser, userId: string) {
    await this.db.tx(async (c) => {
      const doc = await this.loadVisible(c, id, user, true);
      if (doc.state !== 'in_signing') throw guardError('invalid_state', 'Slots can only be reassigned while the document is in signing');
      if (!(doc.created_by === user.id || user.roles.includes('accountant') || user.roles.includes('admin'))) throw forbidden();
      const target = (await c.query('SELECT id FROM users WHERE id = $1 AND active', [userId])).rows[0];
      if (!target) throw notFound('user');
      const slot = (await c.query("SELECT * FROM signature_slots WHERE document_id = $1 AND slot_key = $2 AND voided_at IS NULL AND status IN ('pending','waiting')", [id, slotKey])).rows[0];
      if (!slot || slot.external_email) throw notFound('open signature slot');
      await c.query('UPDATE signature_slots SET assigned_user_id = $2 WHERE id = $1', [slot.id, userId]);
      await this.audit.log({ actorId: user.id, action: 'document.slot_assigned', objectType: 'document', objectId: id, caseId: doc.case_id, detail: { slot_key: slotKey, user_id: userId } }, c);
      if (slot.status === 'pending') await this.activateSlot(c, doc, await this.templates.byId(doc.template_id), { ...slot, assigned_user_id: userId });
    });
    await this.notify.flush();
    return this.get(id, user);
  }

  // ---------- tasks, signature images, idempotency ----------

  async tasks(user: AuthUser) {
    const r = await this.db.query(
      `SELECT d.id AS document_id, d.case_id, c.request_no, d.doc_type, t.title, s.slot_key, s.label, d.updated_at AS created_at
       FROM signature_slots s JOIN documents d ON d.id = s.document_id JOIN form_templates t ON t.id = d.template_id LEFT JOIN cases c ON c.id = d.case_id
       WHERE s.status = 'pending' AND s.voided_at IS NULL AND s.external_email IS NULL AND d.state = 'in_signing'
         AND (s.assigned_user_id = $1 OR (s.assigned_user_id IS NULL AND s.role_code = ANY($2::text[]))) ORDER BY d.updated_at`, [user.id, user.roles]);
    return { items: r.rows };
  }

  async signatureImage(id: string, slotKey: string, user: AuthUser) {
    await this.loadVisible(this.db, id, user);
    const r = await this.db.one(
      `SELECT g.signature_image_key FROM signatures g JOIN signature_slots s ON s.id = g.slot_id WHERE s.document_id = $1 AND s.slot_key = $2 AND s.voided_at IS NULL`, [id, slotKey]);
    if (!r?.signature_image_key) throw notFound('signature');
    return { body: await this.storage.get(r.signature_image_key), mime: r.signature_image_key.endsWith('png') ? 'image/png' : 'image/jpeg' };
  }

  private async idemGet(c: Queryable, key: string | null, userId: string, route: string) {
    if (!key) return null;
    const r = await c.query('SELECT response FROM idempotency_keys WHERE key = $1 AND user_id = $2 AND route = $3', [key, userId, route]);
    return r.rows[0]?.response ?? null;
  }
  private async idemPut(c: Queryable, key: string | null, userId: string, route: string, response: any) {
    if (!key) return;
    await c.query('INSERT INTO idempotency_keys (key, user_id, route, response) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [key, userId, route, JSON.stringify(response)]);
  }
}
export { isSigned };
