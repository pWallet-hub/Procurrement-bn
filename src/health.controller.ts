import { Controller, Get } from '@nestjs/common';
import { Public } from './common/auth';
import { Db } from './db/db.service';

@Controller('health')
export class HealthController {
  constructor(private db: Db) {}
  @Public() @Get() async health() {
    await this.db.query('SELECT 1');
    return { status: 'ok', time: new Date().toISOString() };
  }
}
