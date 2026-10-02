import { Condition, Field, Section, TemplateDef } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCIES = ['RWF', 'USD', 'EUR'];
const blank = (v: any) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

export function cond(c: Condition | undefined, data: Record<string, any>): boolean {
  if (!c) return true;
  const v = data[c.field];
  if (c.equals !== undefined) return v === c.equals;
  if (c.includes !== undefined) return Array.isArray(v) && v.includes(c.includes);
  if (c.truthy !== undefined) return !!v === c.truthy;
  return true;
}

const isAuto = (f: Field) => f.readonly || f.type === 'computed' || f.type === 'case_ref';

function checkType(f: Field, v: any): string | null {
  switch (f.type) {
    case 'text': case 'textarea':
      if (typeof v !== 'string') return 'must be text';
      if (f.maxLength && v.length > f.maxLength) return `at most ${f.maxLength} characters`;
      return null;
    case 'date':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) ? null : 'must be a date (YYYY-MM-DD)';
    case 'time':
      return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? null : 'must be a time (HH:MM)';
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'must be a number';
      if (f.min !== undefined && (f.exclusive_min ? v <= f.min : v < f.min)) return f.exclusive_min ? `must be greater than ${f.min}` : `must be at least ${f.min}`;
      if (f.max !== undefined && v > f.max) return `must be at most ${f.max}`;
      return null;
    case 'money':
      if (!v || typeof v !== 'object' || typeof v.amount !== 'number' || !Number.isFinite(v.amount)) return 'must be an amount';
      if (v.amount < 0) return 'cannot be negative';
      return CURRENCIES.includes(v.currency) ? null : 'currency must be RWF, USD or EUR';
    case 'select': case 'radio': {
      if (typeof v !== 'string') return 'choose one option';
      const ok = (f.options ?? []).some((o) => o.value === v) || (f.allow_other && v === 'other');
      return ok ? null : 'not a valid option';
    }
    case 'checkbox_group': {
      if (!Array.isArray(v)) return 'must be a list';
      const bad = v.find((x) => !((f.options ?? []).some((o) => o.value === x) || (f.allow_other && x === 'other')));
      return bad === undefined ? null : `"${bad}" is not a valid option`;
    }
    case 'yes_no': return typeof v === 'boolean' ? null : 'must be yes or no';
    case 'file': case 'user_ref': case 'supplier_ref': case 'budget_line_ref':
      return typeof v === 'string' && UUID.test(v) ? null : 'must be selected';
    default: return null;
  }
}

function checkField(f: Field, v: any, path: string, data: Record<string, any>, strict: boolean, errors: Record<string, string>) {
  if (f.visible_if && !cond(f.visible_if, data)) return;
  if (isAuto(f)) return;
  const required = f.required || (f.required_if && cond(f.required_if, data));
  if (blank(v)) {
    if (strict && required) errors[path] = 'required';
    if (strict && f.type === 'table' && f.min_rows) errors[path] = `add at least ${f.min_rows} row(s)`;
    return;
  }
  if (f.type === 'table') {
    if (!Array.isArray(v) || v.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) { errors[path] = 'must be a list of rows'; return; }
    if (f.max_rows && v.length > f.max_rows) errors[path] = `at most ${f.max_rows} rows`;
    else if (strict && f.min_rows && v.length < f.min_rows) errors[path] = `add at least ${f.min_rows} row(s)`;
    v.forEach((row: any, i: number) => (f.columns ?? []).forEach((c) => checkField(c, row[c.key], `${path}[${i}].${c.key}`, { ...data, ...row }, strict, errors)));
    return;
  }
  const e = checkType(f, v);
  if (e) errors[path] = e;
  if (f.allow_other && strict && (f.type === 'checkbox_group' ? (v as string[]).includes('other') : v === 'other') && blank(data[`${f.key}_other`]) ) {
    errors[`${path}_other`] = 'please specify';
  }
}

const sectionVisible = (s: Section, data: Record<string, any>) => cond(s.visible_if, data);

/** strict=false (autosave): only type checks. strict=true (submit): required fields, row counts, conditional rules. */
export function validateData(tpl: Pick<TemplateDef, 'schema'>, data: Record<string, any>, strict: boolean, fillAt?: string): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const s of tpl.schema.sections) {
    if (!sectionVisible(s, data)) continue;
    for (const f of s.fields) {
      // fields filled at a later signature slot are skipped at submit and checked (strictly) when that slot signs
      if (fillAt ? f.fill_at !== fillAt : !!f.fill_at && strict) continue;
      checkField(f, data[f.key], f.key, data, strict || !!fillAt, errors);
    }
  }
  return errors;
}

/** attachment ids referenced by file fields (used for the document hash) */
export function collectFileIds(tpl: Pick<TemplateDef, 'schema'>, data: Record<string, any>): string[] {
  const out: string[] = [];
  const walk = (fields: Field[], obj: any) => {
    for (const f of fields) {
      const v = obj?.[f.key];
      if (f.type === 'file' && typeof v === 'string') out.push(v);
      if (f.type === 'table' && Array.isArray(v)) v.forEach((row) => walk(f.columns ?? [], row));
    }
  };
  for (const s of tpl.schema.sections) walk(s.fields, data);
  return out;
}

/** Drop keys that are not in the template so clients cannot smuggle extra data into a signed hash. */
export function pickKnown(tpl: Pick<TemplateDef, 'schema'>, data: Record<string, any>): Record<string, any> {
  const keys = new Set<string>();
  for (const s of tpl.schema.sections) for (const f of s.fields) { keys.add(f.key); if (f.allow_other) keys.add(`${f.key}_other`); }
  return Object.fromEntries(Object.entries(data).filter(([k]) => keys.has(k)));
}
