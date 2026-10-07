import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { renderPaper } from './paper-pdf';
import * as QRCode from 'qrcode';
import { PDFDocument as LibDoc } from 'pdf-lib';
import { Db } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../attachments/storage.service';
import { TemplatesService } from '../templates/templates.service';
import { NotificationsService } from '../notifications/notifications.service';
import { config } from '../config/config';
import { sha256 } from '../common/hash';
import { notFound } from '../common/errors';
import { Field } from '../templates/types';


@Injectable()
export class PdfService {
  private log = new Logger('Pdf');
  constructor(private db: Db, private audit: AuditService, private storage: StorageService, private templates: TemplatesService, private notify: NotificationsService) {}

  private async lookups() {
    const [u, s, b, a] = await Promise.all([
      this.db.query('SELECT id, full_name FROM users'), this.db.query('SELECT id, name FROM suppliers'),
      this.db.query('SELECT id, code FROM budget_lines'), this.db.query('SELECT id, filename FROM attachments'),
    ]);
    const m = (rows: any[], k: string) => new Map<string, string>(rows.map((r) => [r.id, r[k]]));
    return { user_ref: m(u.rows, 'full_name'), supplier_ref: m(s.rows, 'name'), budget_line_ref: m(b.rows, 'code'), file: m(a.rows, 'filename') };
  }

  private fmt(f: Field, v: any, lk: Awaited<ReturnType<PdfService['lookups']>>): string {
    if (v === undefined || v === null || v === '') return '-';
    switch (f.type) {
      case 'money': case 'computed': return typeof v === 'object' ? `${Number(v.amount).toLocaleString('en-US')} ${v.currency}` : String(v);
      case 'yes_no': return v ? 'Yes' : 'No';
      case 'select': case 'radio': return f.options?.find((o) => o.value === v)?.label ?? String(v);
      case 'checkbox_group': return (v as string[]).map((x) => f.options?.find((o) => o.value === x)?.label ?? x).join(', ');
      case 'user_ref': case 'supplier_ref': case 'budget_line_ref': case 'file': return lk[f.type].get(v) ?? String(v);
      default: return String(v);
    }
  }

  /** Build the PDF: the paper form (logo, header box, sections, sign-off grid), then an audit page with QR. */
  async build(docId: string, opts: { draft?: boolean } = {}): Promise<Buffer> {
    const doc = await this.db.one('SELECT * FROM documents WHERE id = $1', [docId]);
    if (!doc) throw notFound('document');
    const tpl = await this.templates.byId(doc.template_id);
    const cs = doc.case_id ? await this.db.one('SELECT request_no FROM cases WHERE id = $1', [doc.case_id]) : null;
    const slots = (await this.db.query(
      `SELECT s.*, g.signer_name, g.signed_at, g.ip, g.method, g.signature_image_key, g.signature_text, g.document_hash, g.slot_data,
              COALESCE(g.slot_data->>'_signer_position', su.position) AS signer_position
       FROM signature_slots s LEFT JOIN signatures g ON g.slot_id = s.id LEFT JOIN users su ON su.id = g.signer_user_id WHERE s.document_id = $1 AND s.voided_at IS NULL ORDER BY s.seq, s.slot_key`, [docId])).rows;
    let data = { ...doc.data };
    for (const s of slots.filter((x) => x.slot_data && x.status === 'signed')) data = { ...data, ...Object.fromEntries(Object.entries(s.slot_data).filter(([k]) => !k.startsWith('_'))) };
    const lk = await this.lookups();
    const head = (await this.db.one('SELECT event_hash FROM audit_events ORDER BY id DESC LIMIT 1'))?.event_hash ?? '';
    const qr = await QRCode.toBuffer(`${config.appUrl}/verify/${docId}`, { margin: 1, width: 160 });
    let logo: Buffer | null = null;
    try { logo = readFileSync(join(__dirname, '../../assets/logo.png')); } catch { /* logo is optional */ }
    const fieldOf = new Map<string, Field>(tpl.schema.sections.flatMap((s: any) => s.fields).map((f: Field) => [f.key, f]));
    const sigSlots = [];
    for (const s of slots) {
      let image: Buffer | null = null;
      if (s.signature_image_key) { try { image = await this.storage.get(s.signature_image_key); } catch { image = null; } }
      sigSlots.push({ slot_key: s.slot_key, label: s.label, declaration: s.declaration, status: s.status, signer_name: s.signer_name, signed_at: s.signed_at, method: s.method, signature_text: s.signature_text, image, position: s.signer_position ?? null });
    }
    const dateField = ['issue_date', 'evaluation_date', 'date_of_request', 'collection_date', 'mpv_date', 'date_submitted'].find((k) => data[k]);
    const pdf = await renderPaper({
      title: tpl.title, paper: tpl.schema.paper, sections: tpl.schema.sections, data, slots: sigSlots, logo, requestNo: cs?.request_no ?? null,
      draft: !!opts.draft, dateText: dateField ? String(data[dateField]).split('-').reverse().join('/') : new Date(doc.created_at).toISOString().slice(0, 10).split('-').reverse().join('/'),
      fmt: (f, v) => (f.type === 'date' && typeof v === 'string' ? v.split('-').reverse().join('/') : this.fmt(f, v, lk)),
    });
    void fieldOf;
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((r) => pdf.on('end', () => r(Buffer.concat(chunks))));

    // audit page
    pdf.addPage();
    pdf.fontSize(14).fillColor('#0b6b3a').font('Helvetica-Bold').text('Audit page', 36, 40).fillColor('#000').font('Helvetica');
    pdf.fontSize(8).moveDown().text(`Document id: ${docId}`).text(`Content hash (SHA-256): ${doc.content_hash ?? '(not frozen)'}`).text(`Audit chain head: ${head}`);
    pdf.moveDown();
    for (const s of slots.filter((x) => x.status === 'signed')) {
      pdf.fontSize(8).text(`${s.label}: ${s.signer_name} | ${new Date(s.signed_at).toISOString()} | IP ${s.ip ?? '-'} | method ${s.method} | signed hash ${s.document_hash}`);
    }
    pdf.image(qr, 36, pdf.y + 16, { width: 100 });
    pdf.fontSize(8).text(`Verify: ${config.appUrl}/verify/${docId}`, 150, pdf.y + 60);
    pdf.end();
    return done;
  }

  /** Job: stamp and store the PDF of a fully signed document, then archive it. */
  async renderAndStore(docId: string) {
    const doc = await this.db.one('SELECT * FROM documents WHERE id = $1', [docId]);
    if (!doc || !['signed', 'archived'].includes(doc.state)) return;
    const body = await this.build(docId);
    const key = `documents/${docId}/v${doc.version}.pdf`;
    const hash = sha256(body);
    await this.storage.put(key, body, 'application/pdf');
    await this.db.tx(async (c) => {
      await c.query("UPDATE documents SET pdf_object_key = $2, pdf_sha256 = $3, state = 'archived', updated_at = now() WHERE id = $1", [docId, key, hash]);
      await this.audit.log({ action: 'document.archived', objectType: 'document', objectId: docId, caseId: doc.case_id, detail: { pdf_sha256: hash, object_key: key } }, c);
    });
    this.log.log(`archived ${docId}`);
  }

  async forDownload(docId: string): Promise<{ body: Buffer; filename: string }> {
    const doc = await this.db.one('SELECT d.*, t.code FROM documents d JOIN form_templates t ON t.id = d.template_id WHERE d.id = $1', [docId]);
    if (!doc) throw notFound('document');
    const filename = `${doc.code}-${docId.slice(0, 8)}.pdf`;
    if (doc.pdf_object_key) return { body: await this.storage.get(doc.pdf_object_key), filename };
    return { body: await this.build(docId, { draft: true }), filename };
  }

  /** Job: merge every signed PDF and PDF attachment of a closed case into one purchase file. */
  async buildCaseFile(caseId: string) {
    const docs = (await this.db.query("SELECT id, pdf_object_key FROM documents WHERE case_id = $1 AND pdf_object_key IS NOT NULL ORDER BY created_at", [caseId])).rows;
    const atts = (await this.db.query("SELECT object_key FROM attachments WHERE case_id = $1 AND mime = 'application/pdf' AND COALESCE(kind,'') <> 'purchase_file' ORDER BY uploaded_at", [caseId])).rows;
    const out = await LibDoc.create();
    for (const k of [...docs.map((d) => d.pdf_object_key), ...atts.map((a) => a.object_key)]) {
      try {
        const src = await LibDoc.load(await this.storage.get(k), { ignoreEncryption: true });
        for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
      } catch (e: any) { this.log.warn(`skipped ${k}: ${e.message}`); }
    }
    const body = Buffer.from(await out.save());
    const key = `cases/${caseId}/purchase-file.pdf`;
    await this.storage.put(key, body, 'application/pdf');
    await this.db.query("DELETE FROM attachments WHERE case_id = $1 AND kind = 'purchase_file'", [caseId]);
    await this.db.query(`INSERT INTO attachments (case_id, kind, filename, mime, size_bytes, sha256, object_key) VALUES ($1,'purchase_file','purchase-file.pdf','application/pdf',$2,$3,$4)`, [caseId, body.length, sha256(body), key]);
    await this.audit.log({ action: 'case.purchase_file_built', objectType: 'case', objectId: caseId, caseId, detail: { sha256: sha256(body) } });
  }
}
