import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthUser, CurrentUser, Perm } from '../common/auth';
import { DocumentsService } from '../documents/documents.service';
import { CasesService } from './cases.service';
import { Db } from '../db/db.service';
import { StorageService } from '../attachments/storage.service';
import { notFound } from '../common/errors';

@Controller('cases')
export class CasesController {
  constructor(private cases: CasesService, private docs: DocumentsService, private db: Db, private storage: StorageService) {}

  @Post() @Perm('case.create') create(@CurrentUser() u: AuthUser, @Body() b: any) { return this.cases.create(u, b); }
  @Get() list(@CurrentUser() u: AuthUser, @Query() q: any) { return this.cases.list(u, { ...q, limit: q.limit ? Number(q.limit) : undefined }); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.cases.get(id, u); }
  @Get(':id/timeline') timeline(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.cases.timeline(id, u); }
  @Patch(':id') @Perm('case.configure') patch(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) { return this.cases.patch(id, u, b); }
  @Post(':id/documents') createDoc(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) { return this.docs.createForCase(id, String(b?.doc_type), u); }
  @Post(':id/delivery') @Perm('payment.record') delivery(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) { return this.cases.delivery(id, u, b); }
  @Post(':id/advance-arrangement') @Perm('case.advance_arrangement') advance(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) { return this.cases.advance(id, u, b?.reason); }
  @Post(':id/cancel') cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) { return this.cases.cancel(id, u, b?.reason); }

  /** merged PDF of every signed document and PDF attachment, built when the case closes */
  @Get(':id/purchase-file') async file(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    await this.cases.get(id, u); // visibility
    const a = await this.db.one("SELECT object_key FROM attachments WHERE case_id = $1 AND kind = 'purchase_file'", [id]);
    if (!a) throw notFound('purchase file (it is built after the case closes)');
    res.setHeader('Content-Type', 'application/pdf');
    res.send(await this.storage.get(a.object_key));
  }
}
