import { applyComputed } from '../src/templates/computed';
import { idDocumentError, validateData, withoutFillAt } from '../src/templates/validate';
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
