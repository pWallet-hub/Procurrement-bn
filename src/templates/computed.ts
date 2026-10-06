import { Field, TemplateDef } from './types';

export const amt = (v: any): number => (typeof v === 'number' ? v : v && typeof v === 'object' && 'amount' in v ? Number(v.amount) || 0 : Number(v) || 0);
const cur = (v: any): string | undefined => (v && typeof v === 'object' ? v.currency : undefined);
const r2 = (n: number) => Math.round(n * 100) / 100;
const wrap = (n: number, f: Field, currency?: string) => (f.format === 'money' ? { amount: r2(n), currency: currency ?? 'RWF' } : r2(n));

/** Fill every `computed` field on the server. Clients only display these values. */
export function applyComputed(tpl: Pick<TemplateDef, 'schema'>, input: Record<string, any>): Record<string, any> {
  const data: Record<string, any> = { ...input };
  const fields = tpl.schema.sections.flatMap((s) => s.fields);

  // row level first (mul, variance_mid), so top level sums can use them
  for (const t of fields.filter((x) => x.type === 'table' && Array.isArray(data[x.key]))) {
    data[t.key] = (data[t.key] as any[]).map((row) => {
      const out = { ...row };
      for (const c of t.columns ?? []) {
        if (c.type !== 'computed' || !c.computed) continue;
        const sp = c.computed;
        if (sp.op === 'mul') {
          const [a, b] = sp.fields!;
          out[c.key] = wrap(amt(row[a]) * amt(row[b]), c, cur(row[b]) ?? cur(row[a]));
        } else if (sp.op === 'variance_mid') {
          const [col, lo, hi] = sp.fields!;
          const mid = (amt(data[lo]) + amt(data[hi])) / 2;
          out[c.key] = wrap(amt(row[col]) - mid, c, cur(row[col]) ?? cur(data[lo]));
        }
      }
      return out;
    });
  }

  for (const f of fields.filter((x) => x.type === 'computed' && x.computed)) {
    const sp = f.computed!;
    if (sp.op === 'sum_rows') {
      const rows: any[] = data[sp.table!] ?? [];
      data[f.key] = wrap(rows.reduce((a, r) => a + amt(r[sp.field!]), 0), f, cur(rows[0]?.[sp.field!]));
    } else if (sp.op === 'sum_mul') {
      const rows: any[] = data[sp.table!] ?? [];
      const [a, b] = sp.fields!;
      data[f.key] = wrap(rows.reduce((s, r) => s + amt(r[a]) * amt(r[b]), 0), f, cur(rows[0]?.[b]));
    } else if (sp.op === 'add') {
      const vals = sp.fields!.map((k) => data[k]);
      data[f.key] = wrap(vals.reduce((s, v) => s + amt(v), 0), f, vals.map(cur).find(Boolean));
    } else if (sp.op === 'add_times') {
      const vals = sp.fields!.map((k) => data[k]);
      data[f.key] = wrap(vals.reduce((s, v) => s + amt(v), 0) * amt(data[sp.field!]), f, vals.map(cur).find(Boolean));
    }
  }
  return data;
}
