import { FlatBlock, InlineCtx, PaperCell, Piece, inlinePieces } from '../templates/paper-layout';

/**
 * Draws the printed layout of a form (templates/definitions/layouts.ts) with pdfkit: headings, paragraphs and bordered grids
 * whose cells hold text, filled-in values, check boxes, blank lines and signatures.
 */

type Doc = PDFKit.PDFDocument;

export interface SigImage { image: Buffer | null; text: string | null }

export interface BlockEnv {
  pdf: Doc;
  x: number;
  width: number;
  /** current y; the renderer moves it down */
  y: number;
  /** start a new page when `h` points do not fit; returns true when a page was added */
  need: (h: number) => boolean;
  ctx: InlineCtx;
  sigs: Map<string, SigImage>;
}

export const INK = '#1f3a68';
const LINE = '#555555', GREY = '#f2f2f2', BLUE = '#dbe9f5', NOTE = '#fff2cc', GREEN = '#d8e4bc', HEAD_BLUE = '#2e74b5';
const FILL: Record<string, string> = { label: GREY, head: BLUE, note: NOTE, green: GREEN };

// ---------------------------------------------------------------- inline flow

interface Item { w: number; h: number; draw: (x: number, bottom: number) => void; space?: boolean; br?: boolean; glue?: boolean }
interface Line { items: { item: Item; x: number }[]; w: number; h: number }

const font = (bold: boolean, italic: boolean) => (bold ? (italic ? 'Helvetica-BoldOblique' : 'Helvetica-Bold') : italic ? 'Helvetica-Oblique' : 'Helvetica');

function items(env: BlockEnv, pieces: Piece[], size: number, dots: boolean, italic = false): Item[] {
  const { pdf } = env;
  const out: Item[] = [];
  const word = (s: string, f: string, color: string) => {
    pdf.font(f).fontSize(size);
    const w = pdf.widthOfString(s);
    out.push({ w, h: size * 1.3, space: /^\s+$/.test(s), draw: (x, b) => { pdf.font(f).fontSize(size).fillColor(color).text(s, x, b - size * 1.12, { lineBreak: false }); } });
  };
  const words = (s: string, f: string, color: string) => { for (const m of s.match(/\s+|\S+/g) ?? []) word(m, f, color); };
  for (const p of pieces) {
    if (p.k === 'br') out.push({ w: 0, h: size * 1.3, br: true, draw: () => undefined });
    else if (p.k === 'text') words(p.s, font(p.bold, p.italic || italic), '#000');
    else if (p.k === 'value') words(p.s, font(p.bold, false), INK);
    else if (p.k === 'box') {
      const s = size * 0.82;
      out.push({ w: s + 1.5, h: size * 1.3, glue: true, draw: (x, b) => {
        const top = b - size * 0.98;
        pdf.lineWidth(0.6).rect(x, top, s, s).stroke('#000');
        if (p.on) pdf.lineWidth(0.9).moveTo(x + s * 0.18, top + s * 0.52).lineTo(x + s * 0.42, top + s * 0.8).lineTo(x + s * 0.85, top + s * 0.18).stroke(INK);
      } });
    } else if (p.k === 'blank') {
      if (p.date) {
        const seg = size * 1.9;
        pdf.font('Helvetica').fontSize(size);
        const sl = pdf.widthOfString('/');
        const w = seg * 3 + sl * 2 + 2;
        out.push({ w, h: size * 1.3, draw: (x, b) => {
          const ly = b - size * 0.22;
          let cx = x;
          for (let i = 0; i < 3; i++) {
            const len = i === 2 ? seg * 1.2 : seg * 0.9;
            dash(pdf, dots); pdf.lineWidth(0.5).moveTo(cx, ly).lineTo(cx + len, ly).stroke('#777'); pdf.undash();
            cx += len;
            if (i < 2) { pdf.font('Helvetica').fontSize(size).fillColor('#000').text('/', cx + 1, b - size * 1.12, { lineBreak: false }); cx += sl + 2; }
          }
        } });
      } else {
        const w = Math.max(16, p.n * size * 0.5);
        out.push({ w, h: size * 1.3, draw: (x, b) => { dash(pdf, dots); pdf.lineWidth(0.5).moveTo(x, b - size * 0.22).lineTo(x + w, b - size * 0.22).stroke('#777'); pdf.undash(); } });
      }
    } else if (p.k === 'sig') {
      const sig = env.sigs.get(p.slot);
      if (sig?.image) {
        try {
          // openImage exists in pdfkit but is missing from its type definitions
          const img = (pdf as unknown as { openImage: (b: Buffer) => { width: number; height: number } }).openImage(sig.image);
          const h = 26, w = Math.min(110, (img.width / img.height) * h);
          out.push({ w, h: h + 2, draw: (x, b) => { pdf.image(img as unknown as Buffer, x, b - h - 1, { fit: [w, h] }); } });
          continue;
        } catch { /* unreadable image: fall back to the name */ }
      }
      const s = sig?.text ?? env.ctx.slots.get(p.slot)?.name ?? '';
      if (s) {
        pdf.font('Times-Italic').fontSize(13);
        const w = pdf.widthOfString(s);
        out.push({ w, h: 17, draw: (x, b) => { pdf.font('Times-Italic').fontSize(13).fillColor(INK).text(s, x, b - 15, { lineBreak: false }); } });
      }
    } else if (p.k === 'status') {
      if (p.status === 'declined' || p.status === 'skipped') {
        out.push({ w: 0, h: size * 1.3, br: true, draw: () => undefined });
        words(p.status === 'declined' ? '(declined)' : '(not required)', 'Helvetica-Oblique', '#a00');
      }
    }
  }
  return out;
}

function dash(pdf: Doc, dots: boolean) { if (dots) pdf.dash(0.8, { space: 1.6 }); }

function wrap(list: Item[], width: number, minH: number): Line[] {
  const lines: Line[] = [];
  let cur: Line = { items: [], w: 0, h: minH };
  const push = () => { lines.push(cur); cur = { items: [], w: 0, h: minH }; };
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (it.br) { push(); continue; }
    if (it.space && cur.items.length === 0) continue; // no leading spaces on a wrapped line
    // a check box stays with the first word of its label
    let need = it.w;
    if (it.glue) for (let j = i + 1; j < list.length && !list[j].br; j++) { need += list[j].w; if (!list[j].space && j > i + 1) break; }
    if (cur.w + need > width && cur.items.length > 0 && !it.space) push();
    cur.items.push({ item: it, x: cur.w });
    cur.w += it.w;
    cur.h = Math.max(cur.h, it.h);
  }
  lines.push(cur);
  return lines;
}

/** Lay out inline pieces in a box `width` wide. Returns the height and a function that draws them at (x, y). */
export function flow(env: BlockEnv, pieces: Piece[], width: number, size: number, o: { dots?: boolean; italic?: boolean; align?: string } = {}) {
  const lines = wrap(items(env, pieces, size, !!o.dots, o.italic), width, size * 1.3);
  const height = lines.reduce((a, l) => a + l.h, 0);
  return {
    height,
    draw: (x: number, y: number) => {
      let yy = y;
      for (const l of lines) {
        const trail = [...l.items].reverse().find((i) => !i.item.space);
        const used = trail ? trail.x + trail.item.w : 0;
        const dx = o.align === 'right' ? width - used : o.align === 'center' ? (width - used) / 2 : 0;
        for (const { item, x: ix } of l.items) item.draw(x + dx + ix, yy + l.h);
        yy += l.h;
      }
    },
  };
}

// ---------------------------------------------------------------- blocks

const PAD_X = 4, PAD_Y = 3.5;

function cellSize(cell: PaperCell, gridSmall?: boolean) { return cell.small || gridSmall ? 7.3 : 8; }

export function drawBlocks(env: BlockEnv, blocks: FlatBlock[]) {
  const { pdf } = env;
  blocks.forEach((b, i) => {
    if (b.t === 'heading') {
      const text = b.style === 'caps' ? b.text.toUpperCase() : b.text;
      pdf.font('Helvetica-Bold').fontSize(9.5);
      const h = pdf.heightOfString(text, { width: env.width });
      env.need(h + 40);
      env.y += 6;
      pdf.fillColor(b.style === 'blue' ? HEAD_BLUE : '#000').text(text, env.x, env.y, { width: env.width, lineBreak: true });
      env.y += h + 2;
    } else if (b.t === 'text') {
      const size = b.style === 'note' ? 7.4 : 8;
      const f = flow(env, inlinePieces(b.text, {}, env.ctx, false, b.style === 'note'), env.width, size, { italic: b.style === 'note' });
      env.need(f.height + 4);
      env.y += 3;
      f.draw(env.x, env.y);
      env.y += f.height + 2;
    } else {
      const attach = b.attach && i > 0 && blocks[i - 1].t === 'grid';
      if (!attach) env.y += 3;
      drawGrid(env, b);
    }
  });
}

function drawGrid(env: BlockEnv, g: Extract<FlatBlock, { t: 'grid' }>) {
  const { pdf } = env;
  const total = g.cols.reduce((a, c) => a + c, 0);
  const colX: number[] = [];
  let acc = env.x;
  for (const c of g.cols) { colX.push(acc); acc += (c / total) * env.width; }
  colX.push(env.x + env.width);

  // place cells: skip columns taken by row spans from above
  interface Placed { cell: PaperCell; r: number; c: number; span: number; rspan: number; layout: ReturnType<typeof layoutCell> }
  const taken = new Set<string>();
  const placed: Placed[] = [];
  g.rows.forEach((row, r) => {
    let c = 0;
    for (const cell of row) {
      while (taken.has(`${r}:${c}`)) c++;
      const span = Math.min(cell.span ?? 1, g.cols.length - c), rspan = cell.rspan ?? 1;
      for (let rr = r; rr < r + rspan; rr++) for (let cc = c; cc < c + span; cc++) taken.add(`${rr}:${cc}`);
      const w = colX[c + span] - colX[c];
      placed.push({ cell, r, c, span, rspan, layout: layoutCell(env, cell, w, g) });
      c += span;
    }
  });

  // row heights: single-row cells first, then stretch the last row of a span when the spanning cell needs more room
  const rowH = g.rows.map(() => 0);
  for (const p of placed) if (p.rspan === 1) rowH[p.r] = Math.max(rowH[p.r], p.layout.height);
  for (const p of placed.filter((x) => x.rspan > 1)) {
    const sum = rowH.slice(p.r, p.r + p.rspan).reduce((a, h) => a + h, 0);
    if (sum < p.layout.height) rowH[p.r + p.rspan - 1] += p.layout.height - sum;
  }

  // draw in chunks of rows that are joined by row spans, so a page break never cuts a cell;
  // a table that continues on a new page repeats its header row
  const headRow = g.rows[0]?.every((c) => c.head) ? 0 : -1;
  const drawRows = (from: number, to: number) => {
    const yAt = (r: number) => env.y + rowH.slice(from, r).reduce((a, x) => a + x, 0);
    for (const p of placed.filter((x) => x.r >= from && x.r < to)) {
      const x = colX[p.c], w = colX[p.c + p.span] - x;
      const y = yAt(p.r), ch = rowH.slice(p.r, p.r + p.rspan).reduce((a, v) => a + v, 0);
      const fill = p.cell.tone ? FILL[p.cell.tone] : p.cell.head ? FILL.head : p.cell.label ? FILL.label : null;
      if (fill) pdf.rect(x, y, w, ch).fill(fill);
      if ((g.frame ?? 'solid') === 'solid' || p.cell.box) pdf.lineWidth(0.6).rect(x, y, w, ch).stroke(LINE);
      const top = p.cell.h ? y + PAD_Y : y + (ch - p.layout.height) / 2 + PAD_Y;
      p.layout.draw(x + PAD_X, top);
    }
    env.y += rowH.slice(from, to).reduce((a, x) => a + x, 0);
  };
  let r0 = 0;
  let pageTop = env.y;
  while (r0 < g.rows.length) {
    let r1 = r0 + 1;
    for (let changed = true; changed;) {
      changed = false;
      for (const p of placed) if (p.r >= r0 && p.r < r1 && p.r + p.rspan > r1) { r1 = p.r + p.rspan; changed = true; }
    }
    const h = rowH.slice(r0, r1).reduce((a, x) => a + x, 0);
    // keep the header row with the first data row
    const withHead = r0 === headRow ? rowH[r1] ?? 0 : 0;
    if (env.need(h + withHead)) {
      pageTop = env.y;
      if (headRow === 0 && r0 > 0) drawRows(0, 1);
    }
    drawRows(r0, r1);
    r0 = r1;
  }
  if (g.frame === 'dashed') {
    pdf.save().lineWidth(0.8).dash(3, { space: 2 }).rect(env.x, pageTop, env.width, env.y - pageTop).stroke('#8fbf6a').undash().restore();
  }
}

function layoutCell(env: BlockEnv, cell: PaperCell, w: number, g: Extract<FlatBlock, { t: 'grid' }>) {
  const size = cellSize(cell, g.small);
  const bold = !!(cell.label || cell.head || cell.bold);
  const inner = w - PAD_X * 2;
  const main = flow(env, inlinePieces(cell.c ?? '', cell, env.ctx, bold, !!cell.italic), inner, size, { dots: g.dots, align: cell.align });
  const sub = cell.sub ? flow(env, inlinePieces(cell.sub, cell, env.ctx), inner, 6.8) : null;
  const content = main.height + (sub ? sub.height + 1 : 0);
  return {
    height: Math.max(content + PAD_Y * 2, cell.h ?? 0, 17),
    draw: (x: number, y: number) => { main.draw(x, y); sub?.draw(x, y + main.height + 1); },
  };
}
