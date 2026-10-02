import { Pool } from 'pg';
import * as argon2 from 'argon2';
import { config } from '../config/config';
import { ROLES, ROLE_PERMISSIONS } from '../auth/permissions';
import { ALL_TEMPLATES } from '../templates/definitions';

/** Idempotent seed: roles, permissions, templates always; demo users, departments, budget lines, suppliers only in non-production. */
export async function seed(): Promise<void> {
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    for (const [code, description] of Object.entries(ROLES)) {
      await pool.query('INSERT INTO roles (code, description) VALUES ($1,$2) ON CONFLICT (code) DO UPDATE SET description = $2', [code, description]);
    }
    await pool.query('DELETE FROM role_permissions');
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) for (const p of perms) await pool.query('INSERT INTO role_permissions (role_code, permission) VALUES ($1,$2)', [role, p]);

    for (const t of ALL_TEMPLATES) {
      // a template version already used by documents is never rewritten: bump `version` to change a live form
      const used = await pool.query('SELECT 1 FROM documents d JOIN form_templates f ON f.id = d.template_id WHERE f.code = $1 AND f.version = $2 LIMIT 1', [t.code, t.version]);
      if (used.rowCount) continue;
      await pool.query('UPDATE form_templates SET active = false WHERE code = $1 AND version <> $2', [t.code, t.version]);
      await pool.query(
        `INSERT INTO form_templates (code, version, title, description, schema, signature_slots, workflow, active) VALUES ($1,$2,$3,$4,$5,$6,$7,true)
         ON CONFLICT (code, version) DO UPDATE SET title = $3, description = $4, schema = $5, signature_slots = $6, workflow = $7, active = true`,
        [t.code, t.version, t.title, t.description, JSON.stringify(t.schema), JSON.stringify(t.signature_slots), JSON.stringify(t.workflow)]);
    }

    if (!config.isProd) {
      const deps: Record<string, string> = {};
      for (const name of ['Communications', 'Finance', 'Programs', 'Administration']) {
        deps[name] = (await pool.query('INSERT INTO departments (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = $1 RETURNING id', [name])).rows[0].id;
      }
      const hash = await argon2.hash(config.seedPassword, { type: argon2.argon2id });
      const users: [string, string, string, string, string[]][] = [
        ['admin@afs.local', 'Ada Admin', 'System Administrator', 'Administration', ['admin']],
        ['staff@afs.local', 'Agape Staff', 'Communications Officer', 'Communications', ['requesting_staff']],
        ['accountant@afs.local', 'Alice Accountant', 'Accountant', 'Finance', ['accountant']],
        ['director.comms@afs.local', 'David Comms', 'Director of Communications', 'Communications', ['director_comms']],
        ['director.dept@afs.local', 'Diane Dept', 'Director of Department', 'Programs', ['director_dept']],
        ['pi@afs.local', 'Patrick PI', 'Principal Investigator', 'Programs', ['pi']],
        ['cfm@afs.local', 'Chantal CFM', 'Chief Finance Manager', 'Finance', ['cfm']],
        ['verifier@afs.local', 'Victor Verifier', 'Market Verification Officer', 'Administration', ['market_verifier']],
        ['superior@afs.local', 'Sandra Superior', 'Superior Staff', 'Programs', ['superior']],
      ];
      for (const [email, name, position, dep, roles] of users) {
        const u = await pool.query(
          `INSERT INTO users (email, full_name, position, department_id, password_hash) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (email) DO UPDATE SET full_name = $2, position = $3 RETURNING id`, [email, name, position, deps[dep], hash]);
        for (const r of roles) await pool.query('INSERT INTO user_roles (user_id, role_code) VALUES ($1,$2) ON CONFLICT DO NOTHING', [u.rows[0].id, r]);
      }
      for (const [code, project, available] of [['BL-001', 'OFAB Rwanda Chapter', 25_000_000], ['BL-002', 'Communications Campaign', 12_000_000], ['BL-003', 'Field Activities', 8_000_000]] as const) {
        await pool.query('INSERT INTO budget_lines (code, project, available) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING', [code, project, available]);
      }
      if (!(await pool.query('SELECT 1 FROM suppliers LIMIT 1')).rowCount) {
        for (const s of [['Kigali Print House Ltd', '102345678', 'Jean Mugabo', '+250788000001', 'sales@kigaliprint.example', 'KN 4 Ave, Kigali'], ['Umubano Supplies', '102998877', 'Grace Uwase', '+250788000002', 'info@umubano.example', 'KG 11 Ave, Kigali'], ['Hills Events & Media', '103112233', 'Eric Habimana', '+250788000003', 'hello@hills.example', 'KK 15 Rd, Kigali']]) {
          await pool.query('INSERT INTO suppliers (name, tin_or_reg_no, contact_person, phone, email, address) VALUES ($1,$2,$3,$4,$5,$6)', s);
        }
      }
    }
    console.log('seed complete');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  seed().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}
