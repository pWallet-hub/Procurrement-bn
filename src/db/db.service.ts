import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from '../config/config';

/** Anything that can run a query: the pool or a transaction client. */
export interface Queryable {
  query<R extends QueryResultRow = any>(text: string, params?: any[]): Promise<{ rows: R[]; rowCount: number | null }>;
}

@Injectable()
export class Db implements Queryable, OnModuleDestroy {
  readonly pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

  query<R extends QueryResultRow = any>(text: string, params?: any[]) {
    return this.pool.query<R>(text, params);
  }

  async one<R extends QueryResultRow = any>(text: string, params?: any[], q: Queryable = this): Promise<R | null> {
    const r = await q.query<R>(text, params);
    return r.rows[0] ?? null;
  }

  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  onModuleDestroy() {
    return this.pool.end();
  }
}
