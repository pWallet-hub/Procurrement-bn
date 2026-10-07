import { CONTRACT, GR06, IM08, TC10 } from './standalone';
import { MPV03, PA04, PO09, PR01, QC02, QE03 } from './procurement';
import { PAPER } from './paper';
import { TemplateDef } from '../types';

/** Bump this when a form's fields or layout change (a version already used by documents is never rewritten). */
const VERSION = 9;
export const ALL_TEMPLATES: TemplateDef[] = [PR01, QC02, MPV03, QE03, PO09, PA04, GR06, IM08, TC10, CONTRACT].map((t) => ({
  ...t, version: VERSION, schema: { ...t.schema, paper: PAPER[t.code] },
}));
