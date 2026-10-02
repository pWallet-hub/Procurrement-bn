import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../common/auth';
import { Db } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../attachments/storage.service';
import { documentHash, sha256 } from '../common/hash';
import { collectFileIds } from '../templates/validate';
import { TemplatesService } from '../templates/templates.service';
import { notFound } from '../common/errors';

@Controller('verify')
export class VerifyController {
  constructor(private db: Db, private audit: AuditService, private storage: StorageService, private templates: TemplatesService) {}

  /** Recompute the content hash, compare the stored PDF hash, validate the audit chain (spec section 10). Public: the QR code points here. */
  @Public() @Get(':id')
  async verify(@Param('id') id: string) {
    const doc = await this.db.one('SELECT * FROM documents WHERE id = $1', [id]);
    if (!doc) throw notFound('document');
    if (!doc.content_hash) return { ok: false, checks: { content_hash: false, pdf_hash: false, audit_chain: false }, failing: 'document has not been submitted for signing' };
    const tpl = await this.templates.byId(doc.template_id);
    const ids = collectFileIds(tpl as any, doc.data);
    const hashes = ids.length ? (await this.db.query('SELECT sha256 FROM attachments WHERE id = ANY($1::uuid[])', [ids])).rows.map((r) => r.sha256) : [];
    const contentOk = documentHash(tpl.code, tpl.version, doc.data, hashes) === doc.content_hash;
    let pdfOk = true;
    if (doc.pdf_object_key) {
      try { pdfOk = sha256(await this.storage.get(doc.pdf_object_key)) === doc.pdf_sha256; } catch { pdfOk = false; }
    }
    const chain = await this.audit.verifyChain();
    const failing = !contentOk ? 'content_hash' : !pdfOk ? 'pdf_hash' : !chain.ok ? `audit_event ${chain.failing_id}` : undefined;
    return { ok: contentOk && pdfOk && chain.ok, checks: { content_hash: contentOk, pdf_hash: pdfOk, audit_chain: chain.ok }, ...(failing ? { failing } : {}) };
  }
}
