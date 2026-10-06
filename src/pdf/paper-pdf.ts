import PDFDocument from 'pdfkit';
import { Field, PaperMeta, Section } from '../templates/types';
import { CONTRACT_CLAUSES } from '../templates/definitions/standalone';

/**
 * Draws a document the way the printed AfS-Rwanda form looks (see /temp): logo, header box, lettered sections,
 * shaded label cells, item tables, Name / Signature / Date sign-off grid, notes, footer. Driven only by the template.
 */

export interface PaperCtx {
  title: string;
  paper: PaperMeta;
  sections: Section[];
  data: Record<string, any>;
  slots: { slot_key: string; label: string; declaration: string | null; status: string; signer_name: string | null; signed_at: Date | null; method: string | null; signature_text: string | null; image: Buffer | null; position: string | null }[];
  fmt: (f: Field, v: any) => string;
  logo: Buffer | null;
  dateText: string;
  draft: boolean;
  requestNo: string | null;
}

const BLUE = '#dbe9f5', GREY = '#f2f2f2', LINE = '#6b6b6b', HEAD = '#1f4e79', GREEN = '#0b6b3a';
const M = 36, W = 595.28 - 2 * M, TOP = 36, BOTTOM = 56;
const ddmmyyyy = (d: Date | string | null) => { if (!d) return ''; const x = new Date(d); return `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}/${x.getUTCFullYear()}`; };

export function renderPaper(c: PaperCtx): Promise<PDFKit.PDFDocument> {
  const pdf = new PDFDocument({ size: 'A4', margins: { top: TOP, bottom: BOTTOM, left: M, right: M }, bufferPages: true, info: { Title: c.title, Author: 'AfS-Rwanda' } });
  let y = TOP;
  const limit = () => pdf.page.height - BOTTOM;
  const need = (h: number) => { if (y + h > limit()) { pdf.addPage(); y = TOP; } };
  const text = (t: string, x: number, yy: number, o: PDFKit.Mixins.TextOptions & { size?: number; bold?: boolean; italic?: boolean; color?: string } = {}) => {
    pdf.font(o.bold ? 'Helvetica-Bold' : o.italic ? 'Helvetica-Oblique' : 'Helvetica').fontSize(o.size ?? 8).fillColor(o.color ?? '#000');
    pdf.text(t, x, yy, { lineBreak: o.lineBreak ?? true, ...o });
  };
  const h = (t: string, w: number, size = 8, bold = false) => { pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size); return pdf.heightOfString(t || ' ', { width: w }); };
  const cell = (x: number, yy: number, w: number, hh: number, fill?: string) => { pdf.lineWidth(0.6).rect(x, yy, w, hh); fill ? pdf.fillAndStroke(fill, LINE) : pdf.stroke(LINE); };

  // ---- logo + header box
  if (c.logo) { try { pdf.image(c.logo, (595.28 - 250) / 2, y, { width: 250 }); y += 250 * 164 / 1008 + 6; } catch { y += 6; } }
  const isContract = c.paper.layout === 'contract';
  const lw = W * 0.62, rw = W - lw;
  if (isContract) { const th = h(c.paper.title, W, 12, true); text(c.paper.title, M, y, { size: 12, bold: true, width: W, align: 'center' }); y += th + 10; } else {
  const t1 = h(c.paper.org, lw - 10, 9.5, true) + 8, t2 = h(c.paper.title, lw - 10, 11, true) + 10;
  const r2 = Math.max(t2, 34);
  cell(M, y, lw, t1, BLUE); text(c.paper.org, M + 5, y + 4, { size: 9.5, bold: true, width: lw - 10 });
  cell(M + lw, y, rw, t1, BLUE); text(`FORM: ${c.paper.form_label}`, M + lw + 5, y + 4, { size: 9, bold: true, width: rw - 10, align: 'center' });
  y += t1;
  cell(M, y, lw, r2); text(c.paper.title, M + 5, y + 5, { size: 11, bold: true, width: lw - 10 });
  cell(M + lw, y, rw, r2);
  text(`Version: ${c.paper.version}`, M + lw + 5, y + 4, { size: 8, width: rw - 10 });
  text(`${c.paper.date_label}: ${c.dateText}`, M + lw + 5, y + 16, { size: 8, width: rw - 10 });
  if (c.requestNo) text(`Request No: ${c.requestNo}`, M + lw + 5, y + 27, { size: 8, bold: true, width: rw - 10 });
  y += Math.max(r2, c.requestNo ? 40 : 0) + 4;
  }
  if (c.paper.intro) { const hh = h(c.paper.intro, W, 7.5); need(hh + 4); text(c.paper.intro, M, y, { size: 7.5, width: W }); y += hh + 6; }

  // ---- checkbox line
  const checks = (f: Field, selected: string[], x: number, yy: number, w: number): number => {
    let cx = x, cy = yy;
    const all = [...(f.options ?? []), ...(f.allow_other ? [{ value: 'other', label: 'Other' }] : [])];
    for (const o of all) {
      const label = o.value === 'other' && selected.includes('other') && c.data[`${f.key}_other`] ? `Other: ${c.data[`${f.key}_other`]}` : o.label;
      const lw2 = h(label, 1000, 8) && pdf.widthOfString(label);
      if (cx + 14 + lw2 > x + w && cx > x) { cx = x; cy += 13; }
      pdf.lineWidth(0.7).rect(cx, cy + 1, 7, 7).stroke('#000');
      if (selected.includes(o.value)) pdf.lineWidth(1).moveTo(cx + 1.5, cy + 4.5).lineTo(cx + 3.2, cy + 7).lineTo(cx + 6, cy + 2).stroke('#000');
      text(label, cx + 10, cy, { size: 8, lineBreak: false });
      cx += 10 + lw2 + 12;
    }
    return cy + 12 - yy;
  };

  const valueHeight = (f: Field, v: any, w: number) => {
    if (f.type === 'checkbox_group' || (f.type === 'radio' && f.options)) {
      const sel = f.type === 'radio' ? (v ? [v] : []) : (v ?? []);
      let cx = 0, rows = 1;
      for (const o of [...(f.options ?? []), ...(f.allow_other ? [{ value: 'other', label: 'Other' }] : [])]) {
        const lw2 = pdf.font('Helvetica').fontSize(8).widthOfString(o.label) + 22;
        if (cx + lw2 > w && cx > 0) { rows++; cx = 0; } cx += lw2;
      }
      void sel; return rows * 13;
    }
    return h(c.fmt(f, v), w, 8) + 2;
  };

  const fieldRow = (f: Field) => {
    const v = c.data[f.key];
    const lw3 = W * 0.3, vw = W - lw3;
    const lh = h(f.label, lw3 - 10, 8, true);
    const vh = valueHeight(f, v, vw - 10);
    // an empty read-only text box is filled by hand on the printout (e.g. the TC-10 host stamp): leave room for it
    const hh = Math.max(lh, vh, f.type === 'textarea' && f.readonly && !v ? 70 : 0) + 8;
    need(hh);
    cell(M, y, lw3, hh, GREY); text(f.label, M + 5, y + 4, { size: 8, bold: true, width: lw3 - 10 });
    cell(M + lw3, y, vw, hh);
    if (f.type === 'checkbox_group') checks(f, v ?? [], M + lw3 + 5, y + 4, vw - 10);
    else if (f.type === 'radio') checks(f, v ? [v] : [], M + lw3 + 5, y + 4, vw - 10);
    else text(c.fmt(f, v) === '-' ? '' : c.fmt(f, v), M + lw3 + 5, y + 4, { size: 8, width: vw - 10 });
    y += hh;
  };

  const tableField = (f: Field) => {
    const cols = (f.columns ?? []);
    const weight = (k: Field) => (k.type === 'textarea' ? 3 : k.type === 'money' || k.type === 'computed' ? 1.4 : k.key === 'description' || k.key === 'item_service' ? 2.5 : 1);
    const num = 14, total = cols.reduce((a, k) => a + weight(k), 0), cw = cols.map((k) => ((W - num) * weight(k)) / total);
    text(f.label, M, y, { size: 8, bold: true, width: W }); y += 12;
    const hh = Math.max(...cols.map((k, i) => h(k.label, cw[i] - 6, 7, true))) + 8;
    need(hh + 20);
    cell(M, y, num, hh, BLUE); text('#', M + 3, y + 4, { size: 7, bold: true, width: num });
    let x = M + num; cols.forEach((k, i) => { cell(x, y, cw[i], hh, BLUE); text(k.label, x + 3, y + 4, { size: 7, bold: true, width: cw[i] - 6 }); x += cw[i]; });
    y += hh;
    const rows: any[] = Array.isArray(c.data[f.key]) && c.data[f.key].length ? c.data[f.key] : Array.from({ length: Math.min(f.min_rows ?? 1, 3) }, () => ({}));
    rows.forEach((row, ri) => {
      const rh = Math.max(24, ...cols.map((k, i) => h(c.fmt(k, row[k.key]) === '-' ? '' : c.fmt(k, row[k.key]), cw[i] - 6, 7.5) + 8));
      need(rh);
      cell(M, y, num, rh); text(String(ri + 1), M + 3, y + 4, { size: 7.5, width: num });
      let xx = M + num; cols.forEach((k, i) => { cell(xx, y, cw[i], rh); const t = c.fmt(k, row[k.key]); text(t === '-' ? '' : t, xx + 3, y + 4, { size: 7.5, width: cw[i] - 6 }); xx += cw[i]; });
      y += rh;
    });
    y += 6;
  };

  // ---- body
  const visible = (cond: any) => !cond || (cond.equals !== undefined ? c.data[cond.field] === cond.equals : cond.includes !== undefined ? (c.data[cond.field] ?? []).includes(cond.includes) : true);
  if (c.paper.layout === 'contract') contract(); else {
    let signed = false;
    for (const s of c.sections) {
      if (c.paper.signoff_before === s.key && !signed) { signoff(); signed = true; }
      if (!visible(s.visible_if) || (!s.fields.length && !s.description)) continue;
      need(40);
      text(/^[A-Z]\./.test(s.title) ? s.title.toUpperCase() : s.title, M, y, { size: 9, bold: true, color: HEAD, width: W }); y += 14;
      if (s.description) { const hh = h(s.description, W, 7.5); need(hh); text(s.description, M, y, { size: 7.5, italic: true, color: '#444', width: W }); y += hh + 4; }
      const flat = s.fields.filter((f) => visible(f.visible_if) && !(f.type === 'case_ref' && !c.data[f.key]));
      for (const f of flat) f.type === 'table' ? tableField(f) : fieldRow(f);
      y += 6;
    }
    if (!signed) signoff();
  }

  function signoff() {
    need(135);
    text(c.paper.signoff_title, M, y, { size: 9, bold: true, color: HEAD, width: W }); y += 14;
    const per = Math.min(3, Math.max(1, c.slots.length)), cw = W / per;
    for (let i = 0; i < c.slots.length; i += per) {
      const row = c.slots.slice(i, i + per), rh = 96;
      need(rh);
      row.forEach((s, j) => {
        const x = M + j * cw;
        cell(x, y, cw, 16, BLUE); text(s.label, x + 4, y + 4, { size: 7, bold: true, width: cw - 8, align: 'center' });
        cell(x, y + 16, cw, rh - 16);
        const done = s.status === 'signed';
        text(`Name: ${done ? s.signer_name + (s.position ? `, ${s.position}` : '') : '______________________'}`, x + 5, y + 21, { size: 7.5, width: cw - 10 });
        text('Signature:', x + 5, y + 36, { size: 7.5, lineBreak: false });
        if (done && s.image) { try { pdf.image(s.image, x + 48, y + 30, { fit: [cw - 56, 28] }); } catch { /* unreadable image */ } }
        else if (done && s.signature_text) text(s.signature_text, x + 48, y + 34, { size: 12, italic: true, width: cw - 56 });
        else if (!done) { text(s.status === 'waiting' || s.status === 'pending' ? '' : `(${s.status})`, x + 48, y + 36, { size: 7, color: '#a00', lineBreak: false }); pdf.moveTo(x + 48, y + 46).lineTo(x + cw - 8, y + 46).lineWidth(0.4).stroke('#888'); }
        text(`Date: ${done ? ddmmyyyy(s.signed_at) : '____/____/______'}`, x + 5, y + 66, { size: 7.5, width: cw - 10 });
        if (done && s.signed_at) text(`${new Date(s.signed_at).toISOString().slice(11, 16)} UTC`, x + 5, y + 77, { size: 6, color: '#666', width: cw - 10 });
      });
      y += rh;
    }
    y += 6;
    if (c.paper.notes) { const hh = h(c.paper.notes, W, 7.5); need(hh); text(c.paper.notes, M, y, { size: 7.5, italic: true, width: W }); y += hh + 4; }
  }

  function contract() {
    const d = c.data;
    const P = (t: string, o: any = {}) => { const hh = h(t, W, o.size ?? 9.5, o.bold) + (o.gap ?? 5); need(hh); text(t, M, y, { size: o.size ?? 9.5, bold: o.bold, width: W, align: o.align }); y += hh; };
    y += 4;
    P('This financial contract is made between', { gap: 3 });
    P(CONTRACT_CLAUSES.contractor, { gap: 8 });
    const f = (k: string) => c.fmt({ key: k, type: 'case_ref', label: '' } as Field, d[k]);
    P(`Supplier\nSupplier's Name: ${d.supplier_name ?? c.fmt({ key: 'supplier', type: 'supplier_ref', label: '' } as Field, d.supplier)}\nSupplier's Address: ${f('supplier_address')}\nSupplier's Email: ${f('supplier_email')}\nSupplier's Telephone: ${f('supplier_telephone')}\nTIN Number OR ID No: ${f('supplier_tin')}`, { gap: 8 });
    P('Scope of Services: The Supplier agrees to provide the following services and/or materials to AfS-Rwanda:', { bold: true, gap: 3 });
    const rows: any[] = d.scope ?? [];
    for (let i = 0; i < Math.max(8, rows.length); i++) { const r = rows[i] ?? {}; P(`${i + 1}. ${[r.col1, r.col2, r.col3].filter(Boolean).join('   |   ') || '_______________________________________________'}`, { gap: 2 }); }
    y += 4;
    const val = d.contract_value?.amount ? `${Number(d.contract_value.amount).toLocaleString('en-US')} ${d.contract_value.currency}. ` : '';
    const adv = d.advance_percent ?? 50, days = d.advance_days ?? 2;
    P('Contract Value:', { bold: true, gap: 1 }); P(val + CONTRACT_CLAUSES.value);
    P('Tax Declaration:', { bold: true, gap: 1 }); P(CONTRACT_CLAUSES.tax);
    P('Payment Terms:', { bold: true, gap: 1 }); P(CONTRACT_CLAUSES.payment.replace('{advance_percent}', adv).replace('{advance_days}', days).replace('{balance_percent}', String(100 - adv)));
    P('Delivery and Deadlines:', { bold: true, gap: 1 }); P(CONTRACT_CLAUSES.delivery);
    P('Liability:', { bold: true, gap: 1 }); P(CONTRACT_CLAUSES.liability);
    P('Confidentiality:', { bold: true, gap: 1 }); P(CONTRACT_CLAUSES.confidentiality);
    P('Acceptance:', { bold: true, gap: 1 }); P(CONTRACT_CLAUSES.acceptance);
    need(120); P('Signed by:', { bold: true, gap: 4 });
    const cw = W / 2, y0 = y;
    c.slots.forEach((s, j) => {
      const x = M + j * cw, done = s.status === 'signed';
      text(j === 0 ? 'For AfS-Rwanda:' : "For Supplier's Name:", x, y0, { size: 9, bold: true, width: cw - 10 });
      text(`Name: ${done ? s.signer_name : '___________________________'}`, x, y0 + 16, { size: 9, width: cw - 10 });
      text(`Position: ${done ? (s.position ?? '') : '_________________________'}`, x, y0 + 30, { size: 9, width: cw - 10 });
      if (done && s.image) { try { pdf.image(s.image, x, y0 + 44, { fit: [cw - 30, 34] }); } catch { /* ignore */ } }
      else if (done && s.signature_text) text(s.signature_text, x, y0 + 48, { size: 14, italic: true, width: cw - 10 });
      text(`Date: ${done ? ddmmyyyy(s.signed_at) : '____________________________'}`, x, y0 + 84, { size: 9, width: cw - 10 });
    });
    y = y0 + 104;
  }

  // ---- footer (+ page numbers, DRAFT mark) on every page
  const range = pdf.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    pdf.switchToPage(i);
    const bm = pdf.page.margins.bottom; pdf.page.margins.bottom = 0;
    if (c.draft) { pdf.save(); pdf.rotate(-35, { origin: [300, 420] }); pdf.opacity(0.08).font('Helvetica-Bold').fontSize(90).fillColor('#000').text('DRAFT', 110, 380, { lineBreak: false }); pdf.restore(); }
    const fy = pdf.page.height - 38;
    pdf.font('Helvetica').fontSize(c.paper.layout === 'contract' ? 7 : 7.5).fillColor('#444').text(c.paper.footer, M, fy, { width: W, align: 'center', lineBreak: true });
    pdf.fontSize(7).fillColor('#888').text(`Page ${i - range.start + 1} of ${range.count}`, M, fy + 18, { width: W, align: 'center', lineBreak: false });
    pdf.page.margins.bottom = bm;
  }
  void GREEN;
  return Promise.resolve(pdf);
}
