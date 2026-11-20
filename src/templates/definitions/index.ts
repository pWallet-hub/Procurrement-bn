import { CONTRACT, GR06, IM08, TC10 } from './standalone';
import { MPV03, PA04, PO09, PR01, QC02, QE03 } from './procurement';
import { PAPER } from './paper';
import { Field, TemplateDef } from '../types';

/** Bump this when a form's fields or layout change (a version already used by documents is never rewritten). */
const VERSION = 10;

/**
 * Every editable date starts at today's date and can still be changed: top level dates are filled on new drafts
 * (documents.service createDraft), table rows, dates shown by a condition and dates filled at a signature are filled
 * by the form in the browser when they appear. Read-only dates are left alone.
 */
const todayByDefault = (f: Field): Field => ({
  ...f,
  ...(f.type === 'date' && f.default === undefined && !f.readonly ? { default: 'today' } : {}),
  ...(f.columns ? { columns: f.columns.map(todayByDefault) } : {}),
});

export const ALL_TEMPLATES: TemplateDef[] = [PR01, QC02, MPV03, QE03, PO09, PA04, GR06, IM08, TC10, CONTRACT].map((t) => ({
  ...t, version: VERSION,
  schema: { ...t.schema, sections: t.schema.sections.map((s) => ({ ...s, fields: s.fields.map(todayByDefault) })), paper: PAPER[t.code] },
}));
