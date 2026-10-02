import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthUser, ClientIp, CurrentUser, IdemKey, Public, UserAgent, rateLimit } from '../common/auth';
import { DocumentsService } from './documents.service';
import { PdfService } from '../pdf/pdf.service';
import { AuditService } from '../audit/audit.service';
import { Db } from '../db/db.service';
import { accessParams, docVisible } from '../common/access';
import { notFound } from '../common/errors';

@Controller()
export class DocumentsController {
  constructor(private docs: DocumentsService, private pdf: PdfService, private events: AuditService, private db: Db) {}

  @Post('documents') create(@CurrentUser() u: AuthUser, @Body() b: any) { return this.docs.createStandalone(u, String(b?.doc_type), b?.data); }
  @Get('documents') list(@CurrentUser() u: AuthUser, @Query() q: any) {
    return this.docs.list(u, { doc_type: q.doc_type, state: q.state, mine: q.mine === 'true' || q.mine === '1', limit: q.limit ? Number(q.limit) : undefined, cursor: q.cursor });
  }
  @Get('documents/:id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.docs.get(id, u); }
  @Patch('documents/:id') patch(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) { return this.docs.patch(id, u, b); }
  @Post('documents/:id/submit') submit(@CurrentUser() u: AuthUser, @Param('id') id: string, @IdemKey() k: string | null) { return this.docs.submit(id, u, k); }
  @Post('documents/:id/slots/:slot/sign')
  sign(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('slot') slot: string, @Body() b: any, @ClientIp() ip: string | null, @UserAgent() ua: string | null, @IdemKey() k: string | null) {
    return this.docs.signInternal(id, slot, u, b, ip, ua, k);
  }
  @Post('documents/:id/slots/:slot/decline') decline(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('slot') slot: string, @Body() b: any) { return this.docs.decline(id, slot, u, b?.reason); }
  @Post('documents/:id/slots/:slot/assign') assign(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('slot') slot: string, @Body() b: any) { return this.docs.assign(id, slot, u, b?.user_id); }
  @Get('documents/:id/slots/:slot/signature.png')
  async sigImage(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('slot') slot: string, @Res() res: Response) {
    const r = await this.docs.signatureImage(id, slot, u);
    res.setHeader('Content-Type', r.mime); res.send(r.body);
  }
  @Post('documents/:id/edit-request') editRequest(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) { return this.docs.editRequest(id, u, b?.reason); }
  @Post('documents/:id/revise') revise(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.docs.revise(id, u); }
  @Post('documents/:id/cancel') cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) { return this.docs.cancel(id, u, b?.reason); }

  @Get('documents/:id/pdf')
  async pdfFile(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const d = await this.db.one(`SELECT d.id FROM documents d LEFT JOIN cases c ON c.id = d.case_id WHERE d.id = $5 AND ${docVisible('d', 'c')}`, [...accessParams(u), id]);
    if (!d) throw notFound('document');
    const out = await this.pdf.forDownload(id);
    await this.events.log({ actorId: u.id, action: 'document.downloaded', objectType: 'document', objectId: id });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${out.filename}"`);
    res.send(out.body);
  }

  @Get('documents/:id/audit')
  async audit(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.docs.get(id, u); // visibility check
    return { items: await this.events.forObject(id) };
  }

  @Get('signing/tasks') tasks(@CurrentUser() u: AuthUser) { return this.docs.tasks(u); }

  // external supplier signing (no login)
  @Public() @Get('sign/:token') extGet(@Param('token') t: string, @ClientIp() ip: string | null) { rateLimit(`sign:${ip}`, 60, 60_000); rateLimit(`signt:${t.slice(0, 16)}`, 30, 60_000); return this.docs.externalView(t); }
  @Public() @Post('sign/:token') extSign(@Param('token') t: string, @Body() b: any, @ClientIp() ip: string | null, @UserAgent() ua: string | null) {
    rateLimit(`sign:${ip}`, 30, 60_000); rateLimit(`signt:${t.slice(0, 16)}`, 15, 60_000);
    return this.docs.signExternal(t, b ?? {}, ip, ua);
  }
}
