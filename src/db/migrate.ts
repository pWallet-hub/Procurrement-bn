import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { config } from '../config/config';

/** Applies db/migrations/*.sql in order, once each. Safe to run on every start. */
export async function runMigrations(): Promise<void> {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(727001)');
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
    const dir = join(__dirname, '../../db/migrations');
    const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      await c.query('BEGIN');
      try {
        await c.query(readFileSync(join(dir, f), 'utf8'));
        await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
        await c.query('COMMIT');
        console.log(`migration applied: ${f}`);
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
    await c.query('SELECT pg_advisory_unlock(727001)');
  } finally {
    c.release();
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}
