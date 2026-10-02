import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';
import { notFound } from '../common/errors';

export interface TemplateRow {
  id: string; code: string; version: number; title: string; description: string;
  schema: any; signature_slots: any[]; workflow: any; active: boolean;
}

@Injectable()
export class TemplatesService {
  constructor(private db: Db) {}

  async list() {
    return (await this.db.query<TemplateRow>('SELECT * FROM form_templates WHERE active ORDER BY code')).rows;
  }
  async active(code: string): Promise<TemplateRow> {
    const t = await this.db.one<TemplateRow>('SELECT * FROM form_templates WHERE code = $1 AND active', [code]);
    if (!t) throw notFound(`template ${code}`);
    return t;
  }
  async byId(id: string): Promise<TemplateRow> {
    const t = await this.db.one<TemplateRow>('SELECT * FROM form_templates WHERE id = $1', [id]);
    if (!t) throw notFound('template');
    return t;
  }
  public(t: TemplateRow) {
    return { code: t.code, version: t.version, title: t.title, description: t.description, schema: t.schema, signature_slots: t.signature_slots, workflow: t.workflow };
  }
}

import { Controller, Get, Param } from '@nestjs/common';
@Controller('templates')
export class TemplatesController {
  constructor(private t: TemplatesService) {}
  @Get() async list() { return { items: (await this.t.list()).map((x) => this.t.public(x)) }; }
  @Get(':code') async one(@Param('code') code: string) { return this.t.public(await this.t.active(code)); }
}
