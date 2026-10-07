/**
 * Paper layout of a form: how a document is drawn so that it looks like the printed AfS-Rwanda form
 * (docs/reference-forms). Used by the PDF renderer (src/pdf/paper-pdf.ts) and, as an identical copy,
 * by the frontend paper view (Procurrement-fn/src/features/paper/layoutCore.ts). Keep the two files the same.
 *
 * A layout is a list of blocks. `items` and `signoff` are shorthands that expand to `grid` blocks, so a renderer
 * only draws three things: headings, text paragraphs and bordered grids (tables with column / row spans).
 *
 * Cell text is plain text with markup:
 *   **bold**            bold on / off            \n   line break
 *   {key}               value of a field (check box fields print every option as a box); blank line when empty
 *   {key?}              value, nothing when empty          {key:30}  blank line of 30 characters when empty
 *   {a/b}               first non empty of the fields a, b
 *   {key|value}         one check box, ticked when the field equals / contains value
 *                       (`true` / `false` for yes-no fields, `*` for "has a value", e.g. an attached file)
 *   {@slot.name}        signer name of a signature slot (also .signature .date .position .status)
 *   {@all_signed}       check box ticked when every signature slot is signed
 */

export type Align = 'left' | 'center' | 'right';

export interface PaperCell {
  c?: string;
  /** second line in small regular type (e.g. the declaration under a sign-off heading) */
  sub?: string;
  span?: number;
  rspan?: number;
  /** shaded label cell, bold */
  label?: boolean;
  /** light blue header cell, bold */
  head?: boolean;
  /** minimum height in points */
  h?: number;
  align?: Align;
  small?: boolean;
  italic?: boolean;
  bold?: boolean;
  tone?: 'note' | 'green';
  /** draw a border around this cell even when the grid has no frame */
  box?: boolean;
  /** set by `items`: the table row the tokens of this cell read from */
  row?: Record<string, unknown>;
  /** set by `items`: key of the table field (its columns describe the row values) */
  table?: string;
  /** set by `items`: empty values print nothing instead of a blank line */
  noblank?: boolean;
}

export interface ItemCol { label: string; w: number; c: string; align?: Align }
export interface SignCell { slot: string; label: string; sub?: string }

export type PaperBlock =
  | { t: 'heading'; text: string; style?: 'caps' | 'blue' }
  | { t: 'text'; text: string; style?: 'intro' | 'note' | 'plain' }
  | { t: 'grid'; cols: number[]; rows: PaperCell[][]; frame?: 'solid' | 'dashed' | 'none'; attach?: boolean; dots?: boolean; small?: boolean }
  /** repeating rows of a table field, numbered, padded with empty rows up to `rows` */
  | { t: 'items'; field: string; cols: ItemCol[]; rows: number; attach?: boolean; num?: number }
  /** Name / Signature / Date boxes, one column per slot */
  | { t: 'signoff'; cells: SignCell[]; cols?: number; attach?: boolean };

export type FlatBlock = Extract<PaperBlock, { t: 'heading' | 'text' | 'grid' }>;

/** Turn `items` and `signoff` blocks into grids. `data` is the document data (for the number of item rows). */
export function expandBlocks(blocks: PaperBlock[], data: Record<string, unknown>): FlatBlock[] {
  const out: FlatBlock[] = [];
  for (const b of blocks) {
    if (b.t === 'items') {
      const list = Array.isArray(data[b.field]) ? (data[b.field] as Record<string, unknown>[]) : [];
      const n = Math.max(b.rows, list.length);
      const rows: PaperCell[][] = [[{ c: '#', head: true, align: 'center', small: true }, ...b.cols.map((c) => ({ c: c.label, head: true, small: true }))]];
      for (let i = 0; i < n; i++) {
        const row = list[i] ?? {};
        rows.push([
          { c: String(i + 1), align: 'center', small: true, h: 19 },
          ...b.cols.map((c) => ({ c: c.c, align: c.align, row, table: b.field, noblank: true, small: true })),
        ]);
      }
      out.push({ t: 'grid', cols: [b.num ?? 4, ...b.cols.map((c) => c.w)], rows, attach: b.attach });
    } else if (b.t === 'signoff') {
      const per = Math.max(1, Math.min(b.cols ?? 3, b.cells.length));
      for (let i = 0; i < b.cells.length; i += per) {
        const part = b.cells.slice(i, i + per);
        out.push({
          t: 'grid', cols: part.map(() => 1), attach: b.attach || i > 0, small: true,
          rows: [
            part.map((s) => ({ c: s.label, sub: s.sub, head: true, small: true })),
            part.map((s) => ({ c: `Name: {@${s.slot}.name}\nSignature: {@${s.slot}.signature}{@${s.slot}.status}`, h: 50 })),
            part.map((s) => ({ c: `Date: {@${s.slot}.date}` })),
          ],
        });
      }
    } else out.push(b);
  }
  return out;
}

// ---------------------------------------------------------------- inline content

export interface LayoutField {
  key: string; type: string; label?: string;
  options?: { value: string; label: string }[]; allow_other?: boolean; columns?: LayoutField[];
}

export interface LayoutSlot {
  status: string;
  name?: string | null;
  position?: string | null;
  /** ISO timestamp of the signature */
  signedAt?: string | Date | null;
  /** name of the person the slot waits for (shown on screen only) */
  assigned?: string | null;
}

export type Piece =
  | { k: 'text'; s: string; bold: boolean; italic: boolean }
  /** a filled in value (printed in "ink") */
  | { k: 'value'; s: string; bold: boolean }
  | { k: 'box'; on: boolean }
  | { k: 'blank'; n: number; date?: boolean }
  | { k: 'sig'; slot: string }
  | { k: 'status'; slot: string; status: string; assigned?: string | null }
  | { k: 'br' };

export interface InlineCtx {
  data: Record<string, unknown>;
  fields: Map<string, LayoutField>;
  slots: Map<string, LayoutSlot>;
  /** printable text of a scalar value (dates dd/mm/yyyy, money, user / supplier / budget line names ...) */
  fmt: (f: LayoutField, v: unknown) => string;
}

const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const ddmmyyyy = (d: string | Date) => {
  const x = new Date(d);
  return isNaN(+x) ? '' : `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}/${x.getUTCFullYear()}`;
};

/** Split cell text into pieces a renderer can draw. */
export function inlinePieces(text: string, cell: Pick<PaperCell, 'row' | 'table' | 'noblank'>, ctx: InlineCtx, baseBold = false, baseItalic = false): Piece[] {
  const out: Piece[] = [];
  let bold = baseBold;
  const rowFields = cell.table ? new Map((ctx.fields.get(cell.table)?.columns ?? []).map((f) => [f.key, f])) : null;
  const lookup = (key: string): { f: LayoutField; v: unknown } => {
    if (cell.row && rowFields) {
      const f = rowFields.get(key);
      if (f || key in cell.row) return { f: f ?? { key, type: 'text' }, v: cell.row[key] };
    }
    return { f: ctx.fields.get(key) ?? { key, type: 'text' }, v: ctx.data[key] };
  };
  const pushText = (s: string, asValue = false) => {
    s.split('\n').forEach((line, i) => {
      if (i > 0) out.push({ k: 'br' });
      if (line) out.push(asValue ? { k: 'value', s: line, bold } : { k: 'text', s: line, bold, italic: baseItalic });
    });
  };
  const blank = (n: number, date = false) => { if (!cell.noblank) out.push({ k: 'blank', n, date }); };

  const re = /\*\*|\{([^}]+)\}/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    pushText(text.slice(last, m.index));
    last = re.lastIndex;
    if (m[0] === '**') { bold = !bold; continue; }
    let tok = m[1].trim();

    if (tok.startsWith('@')) {
      if (tok === '@all_signed') { out.push({ k: 'box', on: ctx.slots.size > 0 && [...ctx.slots.values()].every((s) => s.status === 'signed') }); continue; }
      const optional = tok.endsWith('?');
      const [slotKey, part = 'name'] = tok.slice(1).replace(/\?$/, '').split('.');
      const s = ctx.slots.get(slotKey);
      const signed = s?.status === 'signed';
      if (part === 'signature') { if (signed) out.push({ k: 'sig', slot: slotKey }); else if (!optional) blank(22); }
      else if (part === 'status') { if (s && !signed) out.push({ k: 'status', slot: slotKey, status: s.status, assigned: s.assigned }); }
      else {
        const v = !signed ? '' : part === 'date' ? (s?.signedAt ? ddmmyyyy(s.signedAt) : '') : part === 'position' ? s?.position ?? '' : s?.name ?? '';
        if (v) pushText(v, true); else if (!optional) blank(part === 'date' ? 0 : 22, part === 'date');
      }
      continue;
    }

    // {key|value}: one check box
    const bar = tok.indexOf('|');
    if (bar > 0) {
      const { v } = lookup(tok.slice(0, bar));
      const want = tok.slice(bar + 1);
      const on = want === '*' ? !empty(v) : want === 'true' ? v === true : want === 'false' ? v === false
        : Array.isArray(v) ? v.includes(want) : v === want;
      out.push({ k: 'box', on });
      continue;
    }

    let width = 18;
    const colon = /^(.*):(\d+)$/.exec(tok);
    if (colon) { tok = colon[1]; width = Number(colon[2]); }
    const optional = tok.endsWith('?');
    tok = tok.replace(/\?$/, '');
    const keys = tok.split('/');
    const hit = keys.map(lookup).find((x) => !empty(x.v)) ?? lookup(keys[0]);
    const { f, v } = hit;

    if (f.type === 'checkbox_group' || f.type === 'radio') {
      const sel = Array.isArray(v) ? (v as string[]) : empty(v) ? [] : [String(v)];
      (f.options ?? []).forEach((o, i) => {
        if (i > 0) out.push({ k: 'text', s: '   ', bold: false, italic: false });
        out.push({ k: 'box', on: sel.includes(o.value) }, { k: 'text', s: ` ${o.label}`, bold: false, italic: false });
      });
      if (f.allow_other) {
        const other = cell.row ? cell.row[`${f.key}_other`] : ctx.data[`${f.key}_other`];
        out.push({ k: 'text', s: '   ', bold: false, italic: false }, { k: 'box', on: sel.includes('other') }, { k: 'text', s: ' Other: ', bold: false, italic: false });
        if (!empty(other)) pushText(String(other), true); else blank(10);
      }
      continue;
    }
    if (f.type === 'yes_no') {
      out.push({ k: 'box', on: v === true }, { k: 'text', s: ' Yes   ', bold: false, italic: false }, { k: 'box', on: v === false }, { k: 'text', s: ' No', bold: false, italic: false });
      continue;
    }
    if (f.type === 'file') {
      if (!empty(v)) out.push({ k: 'box', on: true }, { k: 'value', s: ' Attached', bold });
      else if (!optional) blank(width);
      continue;
    }
    if (empty(v)) { if (!optional) blank(f.type === 'date' ? 0 : width, f.type === 'date'); continue; }
    pushText(ctx.fmt(f, v), true);
  }
  pushText(text.slice(last));
  return out;
}

/** Fields of a template keyed by key (top level; table columns are reached through their table field). */
export function fieldMap(sections: { fields: LayoutField[] }[]): Map<string, LayoutField> {
  return new Map(sections.flatMap((s) => s.fields).map((f) => [f.key, f]));
}
