import { BadRequestException, Body, Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { randomUUID } from 'crypto';
import { AuthUser, CurrentUser } from '../common/auth';
import { Db } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from './storage.service';
import { config } from '../config/config';
import { sha256 } from '../common/hash';
import { accessParams, caseVisible, docVisible } from '../common/access';
import { badRequest, forbidden, notFound } from '../common/errors';

const ALLOWED = ['application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

@Controller('attachments')
export class AttachmentsController {
  constructor(private db: Db, private storage: StorageService, private audit: AuditService) {}

  @Post() @UseInterceptors(FileInterceptor('file', { limits: { fileSize: config.maxUploadBytes } }))
  async upload(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File, @Body() b: any) {
    if (!file) throw new BadRequestException('file is required');
    if (!ALLOWED.includes(file.mimetype)) throw badRequest('attachment.type', `File type ${file.mimetype} is not allowed`, { file: 'type not allowed' });
    if (b.case_id) {
      const ok = await this.db.one(`SELECT 1 AS ok FROM cases c WHERE c.id = $5 AND ${caseVisible('c')}`, [...accessParams(u), b.case_id]);
      if (!ok) throw forbidden();
    }
    // TODO production: run a malware scan (e.g. ClamAV container) on file.buffer before storing
    const id = randomUUID();
    const safeName = file.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    const key = `attachments/${id}/${safeName}`;
    const hash = sha256(file.buffer);
    await this.storage.put(key, file.buffer, file.mimetype);
    await this.db.query(
      `INSERT INTO attachments (id, case_id, document_id, kind, filename, mime, size_bytes, sha256, object_key, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, b.case_id || null, b.document_id || null, b.kind || null, safeName, file.mimetype, file.size, hash, key, u.id]);
    await this.audit.log({ actorId: u.id, action: 'attachment.uploaded', objectType: 'attachment', objectId: id, caseId: b.case_id || null, detail: { filename: safeName, sha256: hash } });
    return { id, filename: safeName, mime: file.mimetype, size_bytes: file.size, sha256: hash };
  }

  @Get(':id')
  async download(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const a = await this.db.one('SELECT * FROM attachments WHERE id = $1', [id]);
    if (!a) throw notFound('attachment');
    let ok = a.uploaded_by === u.id || u.permissions.includes('case.view_all');
    if (!ok && a.case_id) ok = !!(await this.db.one(`SELECT 1 AS ok FROM cases c WHERE c.id = $5 AND ${caseVisible('c')}`, [...accessParams(u), a.case_id]));
    if (!ok && a.document_id) ok = !!(await this.db.one(`SELECT 1 AS ok FROM documents d LEFT JOIN cases c ON c.id = d.case_id WHERE d.id = $5 AND ${docVisible('d', 'c')}`, [...accessParams(u), a.document_id]));
    if (!ok) {
      // files referenced by a document the user can see (file fields)
      ok = !!(await this.db.one(`SELECT 1 AS ok FROM documents d LEFT JOIN cases c ON c.id = d.case_id WHERE d.data::text LIKE '%' || $5 || '%' AND ${docVisible('d', 'c')} LIMIT 1`, [...accessParams(u), id]));
    }
    if (!ok) throw forbidden();
    await this.audit.log({ actorId: u.id, action: 'attachment.downloaded', objectType: 'attachment', objectId: id, caseId: a.case_id });
    res.setHeader('Content-Type', a.mime ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${a.filename}"`);
    res.send(await this.storage.get(a.object_key));
  }
}
