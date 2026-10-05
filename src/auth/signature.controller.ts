import { Body, Controller, Delete, Get, Put, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthUser, CurrentUser } from '../common/auth';
import { Db } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../attachments/storage.service';
import { DocumentsService } from '../documents/documents.service';
import { badRequest, notFound } from '../common/errors';

const DATA_URL = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/;

/** The signature image saved on the account, so it can be reused with one click when signing. */
@Controller('me/signature')
export class SignatureController {
  constructor(private db: Db, private storage: StorageService, private audit: AuditService, private docs: DocumentsService) {}

  @Get() async get(@CurrentUser() u: AuthUser, @Res() res: Response) {
    const r = await this.db.one('SELECT signature_image_key AS k FROM users WHERE id = $1', [u.id]);
    if (!r?.k) throw notFound('saved signature');
    res.setHeader('Content-Type', String(r.k).endsWith('png') ? 'image/png' : 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(await this.storage.get(r.k));
  }

  @Put() async put(@CurrentUser() u: AuthUser, @Body() b: any) {
    const m = DATA_URL.exec(b?.signature_image ?? '');
    if (!m) throw badRequest('bad_signature', 'Provide the signature as a PNG or JPEG data URL', { signature_image: 'required' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 1024 * 1024) throw badRequest('bad_signature', 'Signature image is too large (max 1 MB)', { signature_image: 'too large' });
    await this.docs.saveUserSignature(this.db, u.id, buf, m[1] === 'png' ? 'png' : 'jpg');
    return { ok: true };
  }

  @Delete() async remove(@CurrentUser() u: AuthUser) {
    await this.db.query('UPDATE users SET signature_image_key = NULL WHERE id = $1', [u.id]);
    await this.audit.log({ actorId: u.id, action: 'user.signature_removed', objectType: 'user', objectId: u.id });
    return { ok: true };
  }
}
