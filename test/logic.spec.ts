import { applyComputed } from '../src/templates/computed';
import { draftValidation, idDocumentError, validateData, validateFull, withoutFillAt } from '../src/templates/validate';
import { expandBlocks, fieldMap, inlinePieces, LayoutField, PaperBlock } from '../src/templates/paper-layout';
import { LAYOUTS } from '../src/templates/definitions/layouts';
import { canonical, documentHash } from '../src/common/hash';
import { eventHash } from '../src/audit/audit.service';
import { ALL_TEMPLATES } from '../src/templates/definitions';
import { GUARDS } from '../src/workflow/guards';

const tpl = (code: string) => ALL_TEMPLATES.find((t) => t.code === code)!;

describe('templates', () => {
  it('every guard named in a template exists', () => {
    for (const t of ALL_TEMPLATES) for (const g of [...t.workflow.guards_on_submit, ...t.workflow.guards_on_sign]) expect(GUARDS[g.split(':')[0]]).toBeDefined();
  });
  it('slot keys are unique and fill_at targets a real slot', () => {
    for (const t of ALL_TEMPLATES) {
      const keys = t.signature_slots.map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const f of t.schema.sections.flatMap((s) => s.fields)) if (f.fill_at) expect(keys).toContain(f.fill_at);
    }
  });
  it('computes PR-01 row totals and PO-09 totals', () => {
    const d = applyComputed(tpl('PR-01'), { items: [{ qty: 3, est_unit_cost: { amount: 1000, currency: 'RWF' } }] });
    expect(d.items[0].est_total).toEqual({ amount: 3000, currency: 'RWF' });
    const po = applyComputed(tpl('PO-09'), { lines: [{ qty: 2, unit_price: { amount: 500, currency: 'RWF' } }, { qty: 1, unit_price: { amount: 250, currency: 'RWF' } }], tax_vat: { amount: 225, currency: 'RWF' } });
    expect(po.subtotal.amount).toBe(1250);
    expect(po.total_po_value.amount).toBe(1475);
  });
  it('computes MPV-03 variance against the range midpoint', () => {
    const d = applyComputed(tpl('MPV-03'), { price_range_low: { amount: 80, currency: 'RWF' }, price_range_high: { amount: 120, currency: 'RWF' }, comparisons: [{ quotation_amount: { amount: 130, currency: 'RWF' } }] });
    expect(d.comparisons[0].variance.amount).toBe(30);
  });
});

describe('travel clearance (TC-10)', () => {
  it('total = (allowance + accommodation) per day × duration', () => {
    const d = applyComputed(tpl('TC-10'), { allowance_per_day: { amount: 20000, currency: 'RWF' }, accommodation_per_day: { amount: 30000, currency: 'RWF' }, duration_days: 3 });
    expect(d.total_amount).toEqual({ amount: 150000, currency: 'RWF' });
  });
  it('items 15 to 17 belong to the admin step: skipped at submit, required when the admin signs, never set by the requester', () => {
    const t = tpl('TC-10');
    expect(t.signature_slots.find((x) => x.key === 'admin_costs')?.role).toBe('admin');
    const atSubmit = validateData(t, {}, true);
    expect(atSubmit.allowance_per_day).toBeUndefined();
    expect(atSubmit.program).toBe('required');
    expect(validateData(t, {}, true, 'admin_costs').allowance_per_day).toBe('required');
    expect(withoutFillAt(t, { program: 'p', allowance_per_day: 1, total_amount: 2 })).toEqual({ program: 'p' });
  });
  it('validates a Rwanda national ID or a passport number', () => {
    expect(idDocumentError('rwanda_national_id', '1 1990 8 0012345 6 78')).toBeNull();
    expect(idDocumentError('rwanda_national_id', '1199070012345678')).toBeNull();
    expect(idDocumentError('rwanda_national_id', '119908001234567')).toMatch(/16 digits/);
    expect(idDocumentError('rwanda_national_id', '4199080012345678')).toMatch(/starts with/);
    expect(idDocumentError('rwanda_national_id', '1180080012345678')).toMatch(/birth year/);
    expect(idDocumentError('rwanda_national_id', '1199050012345678')).toMatch(/6th digit/);
    expect(idDocumentError('passport', 'pc 123456')).toBeNull();
    expect(idDocumentError('passport', 'ABCDEFG')).toMatch(/passport/);
    expect(idDocumentError('passport', 'PC12345678901')).toMatch(/passport/);
    const t = tpl('TC-10');
    const base = { traveller_type: 'external', issued_to_name: 'Jane Doe', id_type: 'passport' };
    expect(validateData(t, { ...base, id_number: 'X' }, false).id_number).toMatch(/passport/);
    expect(validateData(t, { ...base, id_number: 'PC1234567' }, false).id_number).toBeUndefined();
    expect(validateData(t, { traveller_type: 'external' }, true).issued_to_name).toBe('required');
    expect(validateData(t, { traveller_type: 'external' }, true).issued_to).toBeUndefined();
  });
  it('rejects a return before departure and a supervisor who is the traveller', () => {
    expect(() => GUARDS.travel_clearance_valid({ data: { departure_date: '2026-10-10', return_date: '2026-10-09' } } as any)).toThrow();
    expect(() => GUARDS.travel_clearance_valid({ data: { issued_to: 'u1', supervisor: 'u1' } } as any)).toThrow();
    expect(() => GUARDS.travel_clearance_valid({ data: { departure_date: '2026-10-10', return_date: '2026-10-10', issued_to: 'u1', supervisor: 'u2' } } as any)).not.toThrow();
  });
});

describe('validation', () => {
  it('flags required fields and bad rows only on strict', () => {
    const lax = validateData(tpl('PR-01'), { items: [{ qty: 0 }] }, false);
    expect(lax['items[0].qty']).toMatch(/greater than 0/);
    expect(lax.project_activity).toBeUndefined();
    const strict = validateData(tpl('PR-01'), { items: [] }, true);
    expect(strict.project_activity).toBe('required');
    expect(strict.items).toMatch(/at least 1/);
  });
  it('QC-02 needs two quotations', () => {
    expect(validateData(tpl('QC-02'), { quotations: [{}] }, true).quotations).toMatch(/at least 2/);
  });
  it('conditional rules: IM-08 decision fields are skipped at submit and enforced at the superior slot', () => {
    const base = { memo_reference_name: 'x', department_office: 'y', issue_description: 'a', recommendation: 'b' };
    expect(validateData(tpl('IM-08'), base, true).decision_status).toBeUndefined();
    expect(validateData(tpl('IM-08'), base, true, 'superior').decision_status).toBe('required');
  });
  it('GR-06 travel fields only required when travel selected', () => {
    const base = { project_activity: 'p', budget_line: '11111111-1111-1111-1111-111111111111', purpose_justification: 'j', request_types: ['accommodation'], estimated_total: { amount: 1, currency: 'RWF' } };
    expect(validateData(tpl('GR-06'), base, true).destination).toBeUndefined();
    expect(validateData(tpl('GR-06'), { ...base, request_types: ['local_travel_or_field_work'] }, true).destination).toBe('required');
  });
});

describe('hashing and audit chain', () => {
  it('canonical json is key-order independent', () => {
    expect(canonical({ b: 1, a: { d: 2, c: [1, { z: 1, y: 2 }] } })).toBe(canonical({ a: { c: [1, { y: 2, z: 1 }], d: 2 }, b: 1 }));
  });
  it('document hash changes when data changes', () => {
    expect(documentHash('PR-01', 1, { a: 1 }, [])).not.toBe(documentHash('PR-01', 1, { a: 2 }, []));
  });
  it('event hash depends on the previous hash', () => {
    const row = { at: '2026-01-01T00:00:00.000Z', actor_user_id: null, action: 'x', object_type: null, object_id: null, case_id: null, detail: null };
    expect(eventHash(null, row)).not.toBe(eventHash('abc', row));
  });
});


describe('printed layouts (docs/reference-forms)', () => {
  /** every {token} of a layout names a real field, option value or signature slot */
  it('only refers to fields, options and slots that exist', () => {
    for (const t of ALL_TEMPLATES.filter((x) => x.schema.paper?.blocks)) {
      const fields = fieldMap(t.schema.sections as unknown as { fields: LayoutField[] }[]);
      const slots = new Set(t.signature_slots.map((s) => s.key));
      const texts: { text: string; table?: string }[] = [];
      for (const b of t.schema.paper!.blocks as PaperBlock[]) {
        if (b.t === 'grid') b.rows.flat().forEach((c) => texts.push({ text: `${c.c ?? ''} ${c.sub ?? ''}` }));
        if (b.t === 'text') texts.push({ text: b.text });
        if (b.t === 'items') { expect(fields.get(b.field)?.type).toBe('table'); b.cols.forEach((c) => texts.push({ text: c.c, table: b.field })); }
        if (b.t === 'signoff') b.cells.forEach((c) => expect(slots).toContain(c.slot));
      }
      for (const { text, table } of texts) {
        for (const [, raw] of text.matchAll(/\{([^}]+)\}/g)) {
          const where = `${t.code}: {${raw}}`;
          if (raw.startsWith('@')) {
            if (raw === '@all_signed') continue;
            const [slot, part] = raw.slice(1).replace(/\?$/, '').split('.');
            expect([where, slots.has(slot)]).toEqual([where, true]);
            expect([where, ['name', 'signature', 'date', 'position', 'status'].includes(part)]).toEqual([where, true]);
            continue;
          }
          const [keyPart, option] = raw.split('|');
          const cols = table ? new Map((fields.get(table)!.columns ?? []).map((c) => [c.key, c])) : null;
          for (const key of keyPart.replace(/:\d+$/, '').replace(/\?$/, '').split('/')) {
            const base = key.endsWith('_other') ? key.slice(0, -6) : key;
            const f = cols?.get(key) ?? cols?.get(base) ?? fields.get(key) ?? fields.get(base);
            expect([where, !!f]).toEqual([where, true]);
            if (option && f && !['*', 'true', 'false'].includes(option)) {
              expect([where, [...(f.options ?? []).map((o) => o.value), ...(f.allow_other ? ['other'] : [])].includes(option)]).toEqual([where, true]);
            }
          }
        }
      }
    }
  });
  it('every form except the contract has a printed layout', () => {
    expect(Object.keys(LAYOUTS).sort()).toEqual(ALL_TEMPLATES.map((t) => t.code).filter((c) => c !== 'CONTRACT').sort());
  });
  it('items pad to the printed number of rows; sign-off boxes print name, signature and date', () => {
    const flat = expandBlocks(LAYOUTS['PR-01'], { items: [{ description: 'a' }] });
    const items = flat.find((b) => b.t === 'grid' && b.rows[0][1]?.c?.startsWith('Detailed'));
    expect(items && items.t === 'grid' && items.rows.length).toBe(6); // header + 5 rows as on the form
    const sign = flat.filter((b) => b.t === 'grid' && b.rows[1]?.[0]?.c?.includes('{@prepared_by.name}'));
    expect(sign).toHaveLength(1);
  });
  it('prints values, check boxes, blanks and signer details', () => {
    const f = new Map<string, LayoutField>([
      ['terms', { key: 'terms', type: 'checkbox_group', options: [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }], allow_other: true }],
      ['d', { key: 'd', type: 'date' }],
    ]);
    const ctx = { data: { terms: ['bank', 'other'], terms_other: 'Cheque' }, fields: f, slots: new Map([['pi', { status: 'signed', name: 'P. I.', signedAt: '2026-10-07T10:00:00Z' }]]), fmt: (_: LayoutField, v: unknown) => String(v) };
    const p = inlinePieces('**Terms:** {terms} | {d} | {@pi.name} {@pi.date} | {terms|cash}', {}, ctx);
    expect(p.filter((x) => x.k === 'box').map((x) => (x as { on: boolean }).on)).toEqual([false, true, true, false]);
    expect(p).toContainEqual({ k: 'value', s: 'Cheque', bold: false });
    expect(p).toContainEqual({ k: 'blank', n: 0, date: true });
    expect(p).toContainEqual({ k: 'value', s: 'P. I.', bold: false });
    expect(p).toContainEqual({ k: 'value', s: '07/10/2026', bold: false });
    expect(p[0]).toEqual({ k: 'text', s: 'Terms:', bold: true, italic: false });
  });
});

describe('validation feedback', () => {
  it('every problem comes with a hint on how to fix it', () => {
    for (const t of ALL_TEMPLATES) {
      const { errors, hints } = validateFull(t, {}, true);
      for (const path of Object.keys(errors)) expect([t.code, path, !!hints[path]]).toEqual([t.code, path, true]);
    }
  });
  it('type problems name the issue and the fix', () => {
    const { errors, hints } = validateFull(tpl('QC-02'), { quotations: [{ email: 'not-an-email', tel: '12' }] }, false);
    expect(errors['quotations[0].email']).toBe('is not a valid e-mail address');
    expect(hints['quotations[0].email']).toMatch(/name@example.com/);
    expect(errors['quotations[0].tel']).toBe('is not a valid phone number');
  });
  it('drafts report what is still missing before submit, separately from typing errors', () => {
    const v = draftValidation(tpl('PR-01'), { project_activity: 'x'.repeat(201) });
    expect(v.errors.project_activity).toMatch(/at most 200 characters/);
    expect(v.missing.business_justification).toBe('required');
    expect(v.missing.project_activity).toBeUndefined();
    expect(v.hints.business_justification).toBeTruthy();
  });
  it('checks between fields run while typing: dates in order, duplicate suppliers, price range, totals', () => {
    expect(validateFull(tpl('PR-01'), { date_of_request: '2026-10-07', required_by_date: '2026-10-01' }, false).errors.required_by_date).toMatch(/before the date of request/);
    const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
    const qc = validateFull(tpl('QC-02'), { collection_date: '2026-10-07', quotations: [{ supplier: A }, { supplier: A, quote_date: '2026-10-09' }] }, false);
    expect(qc.errors['quotations[1].supplier']).toMatch(/same supplier as row 1/);
    expect(qc.errors['quotations[1].quote_date']).toMatch(/after the collection date/);
    const mpv = validateFull(tpl('MPV-03'), { price_range_low: { amount: 9, currency: 'RWF' }, price_range_high: { amount: 5, currency: 'RWF' } }, false);
    expect(mpv.hints.price_range_low).toMatch(/Lowest/);
    const gr = validateFull(tpl('GR-06'), { estimated_total: { amount: 100, currency: 'RWF' }, items: [{ qty: 2, unit_cost: { amount: 80, currency: 'RWF' }, est_total: { amount: 160, currency: 'RWF' } }] }, false);
    expect(gr.hints.estimated_total).toMatch(/at least 160 RWF/);
    const tc = validateFull(tpl('TC-10'), { departure_date: '2026-11-02', return_date: '2026-11-04', duration_days: 7 }, false);
    expect(tc.hints.duration_days).toMatch(/Enter 3/);
    expect(validateFull(tpl('TC-10'), { departure_date: '2026-11-02', return_date: '2026-11-04', duration_days: 3 }, false).errors.duration_days).toBeUndefined();
    const qe = validateFull(tpl('QE-03'), { comparison: [{ supplier: A }], recommended_supplier: B }, false);
    expect(qe.errors.recommended_supplier).toMatch(/not one of the suppliers compared/);
  });
});
