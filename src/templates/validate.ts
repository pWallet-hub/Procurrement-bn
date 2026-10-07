import { Condition, Field, Section, TemplateDef } from './types';
import { CROSS_CHECKS } from './checks';

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

/** Spaces removed, upper case: how ID / passport numbers are stored and checked */
export const normalizeIdNumber = (v: string) => v.replace(/\s+/g, '').toUpperCase();

/**
 * Rwanda national ID: 16 digits = holder category (1 Rwandan, 2 refugee, 3 foreign resident), birth year (4), gender (8 male, 7 female),
 * then 9 more digits. Passport: 6 to 9 letters/digits with at least one digit (ICAO document number).
 */
export function idDocumentError(type: unknown, value: string): string | null {
  const v = normalizeIdNumber(value);
  if (type === 'passport') return /^(?=.*\d)[A-Z0-9]{6,9}$/.test(v) ? null : 'passport number must be 6 to 9 letters or digits';
  if (type !== 'rwanda_national_id') return 'choose the ID type first';
  if (!/^\d{16}$/.test(v)) return 'a Rwanda national ID has 16 digits';
  if (!'123'.includes(v[0])) return 'a Rwanda national ID starts with 1, 2 or 3';
  const year = Number(v.slice(1, 5));
  if (year < 1900 || year > new Date().getUTCFullYear()) return 'digits 2 to 5 must be a valid birth year';
  if (v[5] !== '7' && v[5] !== '8') return 'the 6th digit must be 7 or 8';
  return null;
}

const isAuto = (f: Field) => f.readonly || f.type === 'computed' || f.type === 'case_ref';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** 7 to 15 digits; spaces, +, -, ( ) and / between numbers allowed (several numbers separated by "/" or ","). */
const phoneOk = (v: string) => v.split(/[,/]/).every((p) => { const d = p.replace(/[\s()+-]/g, ''); return /^\d{7,15}$/.test(d); });

const list = (labels: string[]) => (labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** How to fix a field, by type. A field's own `hint` wins. */
export function hintFor(f: Field, error?: string): string {
  if (f.hint) return f.hint;
  const opts = (f.options ?? []).map((o) => o.label).concat(f.allow_other ? ['Other'] : []);
  if (error?.startsWith('at most') && f.maxLength) return `Shorten the text to ${f.maxLength} characters or fewer.`;
  if (error === 'please specify') return 'You ticked "Other": describe it in the box next to it.';
  switch (f.type) {
    case 'text': return f.check?.rule === 'email' ? 'Enter a full e-mail address, e.g. name@example.com.'
      : f.check?.rule === 'phone' ? 'Enter a phone number with 7 to 15 digits, e.g. +250 788 123 456.'
      : `Type the ${lower(f.label)}.`;
    case 'textarea': return `Write the ${lower(f.label)}.`;
    case 'date': return 'Pick the date from the calendar.';
    case 'time': return 'Enter the time as hours and minutes, e.g. 08:30.';
    case 'number': return f.exclusive_min && f.min === 0 ? 'Enter a number greater than 0.'
      : f.min !== undefined && f.max !== undefined ? `Enter a number from ${f.min} to ${f.max}.`
      : f.min !== undefined ? `Enter a number of at least ${f.min}.` : 'Enter a number.';
    case 'money': return 'Enter the amount (0 or more) and choose the currency: RWF, USD or EUR.';
    case 'select': case 'radio': return `Choose one option: ${list(opts)}.`;
    case 'checkbox_group': return `Tick at least one box: ${list(opts)}.`;
    case 'yes_no': return 'Choose Yes or No.';
    case 'user_ref': return 'Choose the person from the list.';
    case 'supplier_ref': return 'Choose the supplier from the list. If the supplier is missing, ask an administrator to add it.';
    case 'budget_line_ref': return 'Choose the budget line from the list. If it is missing, ask an administrator to add it.';
    case 'file': return `Upload the file${f.accept?.length ? ` (${f.accept.map((m) => m.split('/')[1].toUpperCase()).join(', ')})` : ''}.`;
    case 'table': return f.min_rows ? `Use "Add row" until there are at least ${f.min_rows} row(s), then fill in every row.` : 'Fill in every row.';
    default: return '';
  }
}

function checkType(f: Field, v: any): string | null {
  switch (f.type) {
    case 'text': case 'textarea':
      if (typeof v !== 'string') return 'must be text';
      if (f.maxLength && v.length > f.maxLength) return `at most ${f.maxLength} characters (now ${v.length})`;
      if (f.check?.rule === 'email' && !EMAIL.test(v.trim())) return 'is not a valid e-mail address';
      if (f.check?.rule === 'phone' && !phoneOk(v.trim())) return 'is not a valid phone number';
      return null;
    case 'date':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) ? null : 'is not a valid date';
    case 'time':
      return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? null : 'must be a time (HH:MM)';
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'must be a number';
      if (f.min !== undefined && (f.exclusive_min ? v <= f.min : v < f.min)) return f.exclusive_min ? `must be greater than ${f.min}` : `must be at least ${f.min}`;
      if (f.max !== undefined && v > f.max) return `must be at most ${f.max}`;
      return null;
    case 'money':
      if (!v || typeof v !== 'object' || typeof v.amount !== 'number' || !Number.isFinite(v.amount)) return 'amount is missing';
      if (v.amount < 0) return 'cannot be negative';
      return CURRENCIES.includes(v.currency) ? null : 'currency must be RWF, USD or EUR';
    case 'select': case 'radio': {
      if (typeof v !== 'string') return 'choose one option';
      const ok = (f.options ?? []).some((o) => o.value === v) || (f.allow_other && v === 'other');
      return ok ? null : 'is not one of the options';
    }
    case 'checkbox_group': {
      if (!Array.isArray(v)) return 'must be a list';
      const bad = v.find((x) => !((f.options ?? []).some((o) => o.value === x) || (f.allow_other && x === 'other')));
      return bad === undefined ? null : `"${bad}" is not one of the options`;
    }
    case 'yes_no': return typeof v === 'boolean' ? null : 'must be Yes or No';
    case 'file': return typeof v === 'string' && UUID.test(v) ? null : 'file is missing';
    case 'user_ref': case 'supplier_ref': case 'budget_line_ref':
      return typeof v === 'string' && UUID.test(v) ? null : 'must be chosen from the list';
    default: return null;
  }
}

/** Problems by path (`items[0].qty`) and, for the same paths, how to fix them. */
export interface Problems { errors: Record<string, string>; hints: Record<string, string> }

function checkField(f: Field, v: any, path: string, data: Record<string, any>, strict: boolean, out: Problems) {
  const set = (p: string, e: string, hint = hintFor(f, e)) => { out.errors[p] = e; if (hint) out.hints[p] = hint; };
  if (f.visible_if && !cond(f.visible_if, data)) return;
  if (isAuto(f)) return;
  const required = f.required || (f.required_if && cond(f.required_if, data));
  if (blank(v)) {
    if (strict && f.type === 'table' && f.min_rows) set(path, `add at least ${f.min_rows} row(s)`);
    else if (strict && required) set(path, 'required');
    return;
  }
  if (f.type === 'table') {
    if (!Array.isArray(v) || v.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) { set(path, 'must be a list of rows'); return; }
    if (f.max_rows && v.length > f.max_rows) set(path, `has ${v.length} rows, at most ${f.max_rows} allowed`, `Remove rows until there are ${f.max_rows} or fewer.`);
    else if (strict && f.min_rows && v.length < f.min_rows) set(path, `has ${v.length} row(s), at least ${f.min_rows} needed`);
    v.forEach((row: any, i: number) => (f.columns ?? []).forEach((c) => checkField(c, row[c.key], `${path}[${i}].${c.key}`, { ...data, ...row }, strict, out)));
    return;
  }
  const typeErr = checkType(f, v);
  if (typeErr) set(path, typeErr);
  else if (f.check?.rule === 'id_document') {
    const idType = data[f.check.type_field];
    const e = idDocumentError(idType, v);
    if (e) set(path, e, idType === 'passport' ? 'Enter the passport number exactly as printed (6 to 9 letters or digits).'
      : idType === 'rwanda_national_id' ? 'Enter the 16 digits of the national ID card, without spaces.' : 'Choose the ID type first, then enter the number.');
  }
  if (f.allow_other && strict && (f.type === 'checkbox_group' ? (v as string[]).includes('other') : v === 'other') && blank(data[`${f.key}_other`]) ) {
    set(`${path}_other`, 'please specify');
  }
}

const sectionVisible = (s: Section, data: Record<string, any>) => cond(s.visible_if, data);

type Tpl = Pick<TemplateDef, 'schema'> & { code?: string };

/**
 * strict=false (autosave): type checks and checks between fields. strict=true (submit): also required fields and row counts.
 * Returns each problem with a hint that tells the person how to fix it.
 */
export function validateFull(tpl: Tpl, data: Record<string, any>, strict: boolean, fillAt?: string): Problems {
  const out: Problems = { errors: {}, hints: {} };
  for (const s of tpl.schema.sections) {
    if (!sectionVisible(s, data)) continue;
    for (const f of s.fields) {
      // fields filled at a later signature slot are skipped at submit and checked (strictly) when that slot signs
      if (fillAt ? f.fill_at !== fillAt : !!f.fill_at && strict) continue;
      checkField(f, data[f.key], f.key, data, strict || !!fillAt, out);
    }
  }
  // rules between fields (dates in order, totals, ...) for the fields that are themselves valid
  if (!fillAt && tpl.code && CROSS_CHECKS[tpl.code]) {
    for (const p of CROSS_CHECKS[tpl.code](data)) {
      if (out.errors[p.path]) continue;
      out.errors[p.path] = p.error;
      out.hints[p.path] = p.hint;
    }
  }
  return out;
}

export function validateData(tpl: Tpl, data: Record<string, any>, strict: boolean, fillAt?: string): Record<string, string> {
  return validateFull(tpl, data, strict, fillAt).errors;
}

/** Draft feedback: problems in what was typed, plus what is still missing before submit (with hints for both). */
export function draftValidation(tpl: Tpl, data: Record<string, any>) {
  const now = validateFull(tpl, data, false);
  const atSubmit = validateFull(tpl, data, true);
  const missing = Object.fromEntries(Object.entries(atSubmit.errors).filter(([p]) => !(p in now.errors)));
  return { errors: now.errors, missing, hints: { ...atSubmit.hints, ...now.hints } };
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

/** Drop fields filled at a later signature slot (and their "other" text): only that slot's signer sets them, at signing. */
export function withoutFillAt(tpl: Pick<TemplateDef, 'schema'>, data: Record<string, any>): Record<string, any> {
  const later = new Set<string>();
  for (const s of tpl.schema.sections) for (const f of s.fields) if (f.fill_at) { later.add(f.key); later.add(`${f.key}_other`); }
  return Object.fromEntries(Object.entries(data).filter(([k]) => !later.has(k)));
}
