import { amt } from './computed';

/**
 * Rules between fields, per form. They run on every autosave (so the person sees the problem while typing) and at submit.
 * Each problem names the field to fix, what is wrong and how to fix it. Rules only fire when the values they compare are present.
 */
export interface CrossProblem { path: string; error: string; hint: string }
type Check = (d: Record<string, any>) => CrossProblem[];

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const dmy = (iso: string) => iso.split('-').reverse().join('/');
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const money = (v: any) => `${amt(v).toLocaleString('en-US')} ${v?.currency ?? ''}`.trim();
const isMoney = (v: any) => v && typeof v === 'object' && typeof v.amount === 'number';
const rows = (v: unknown): Record<string, any>[] => (Array.isArray(v) ? v : []);

/** `later` must not be before `earlier` */
function order(d: Record<string, any>, earlier: string, later: string, laterLabel: string, earlierLabel: string): CrossProblem[] {
  const a = d[earlier], b = d[later];
  if (!isDate(a) || !isDate(b) || b >= a) return [];
  return [{ path: later, error: `is before the ${earlierLabel} (${dmy(a)})`, hint: `Choose a ${laterLabel} on or after ${dmy(a)}, or correct the ${earlierLabel}.` }];
}

/** All amounts that are added or compared must use one currency. */
function sameCurrency(path: string, values: any[], what: string): CrossProblem[] {
  const cur = [...new Set(values.filter(isMoney).map((v) => v.currency))];
  return cur.length > 1 ? [{ path, error: `mixes currencies (${cur.join(', ')})`, hint: `Use one currency for all ${what}.` }] : [];
}

export const CROSS_CHECKS: Record<string, Check> = {
  'PR-01': (d) => [
    ...order(d, 'date_of_request', 'required_by_date', 'required-by date', 'date of request'),
    ...sameCurrency('items', rows(d.items).flatMap((r) => [r.unit_cost, r.est_unit_cost]), 'item costs'),
  ],

  'QC-02': (d) => {
    const out: CrossProblem[] = [];
    const seen = new Map<string, number>();
    rows(d.quotations).forEach((r, i) => {
      if (!r.supplier) return;
      if (seen.has(r.supplier)) out.push({ path: `quotations[${i}].supplier`, error: `is the same supplier as row ${seen.get(r.supplier)! + 1}`, hint: 'Each quotation must come from a different supplier: choose another supplier or remove this row.' });
      else seen.set(r.supplier, i);
      if (isDate(r.quote_date) && isDate(d.collection_date) && r.quote_date > d.collection_date) {
        out.push({ path: `quotations[${i}].quote_date`, error: `is after the collection date (${dmy(d.collection_date)})`, hint: 'A quotation is dated on or before the day it was collected: check the date on the quotation.' });
      }
    });
    return [...out, ...sameCurrency('quotations', rows(d.quotations).map((r) => r.total_price), 'quotation prices so they can be compared')];
  },

  'MPV-03': (d) => {
    const out: CrossProblem[] = [];
    if (isMoney(d.price_range_low) && isMoney(d.price_range_high)) {
      if (d.price_range_low.amount > d.price_range_high.amount) {
        out.push({ path: 'price_range_low', error: `(${money(d.price_range_low)}) is above the highest price (${money(d.price_range_high)})`, hint: 'Enter the lowest price you found as "Lowest" and the highest as "Highest".' });
      }
      out.push(...sameCurrency('price_range_high', [d.price_range_low, d.price_range_high], 'the observed price range'));
    }
    return out;
  },

  'QE-03': (d) => {
    const compared = rows(d.comparison).map((r) => r.supplier).filter(Boolean);
    if (d.recommended_supplier && compared.length && !compared.includes(d.recommended_supplier)) {
      return [{ path: 'recommended_supplier', error: 'is not one of the suppliers compared above', hint: 'Recommend one of the suppliers in the comparison table, or add that supplier\'s quotation to the table.' }];
    }
    const row = rows(d.comparison).find((r) => r.supplier === d.recommended_supplier);
    if (row && row.meets_specs === false) {
      return [{ path: 'recommended_supplier', error: 'does not meet the specifications (see the comparison table)', hint: 'Recommend a supplier whose quotation meets the specifications, or correct "Meets Specs?" in the table.' }];
    }
    return [];
  },

  'PO-09': (d) => sameCurrency('lines', [...rows(d.lines).map((r) => r.unit_price), d.tax_vat], 'unit prices and the tax'),

  'PA-04': (d) => {
    const today = new Date().toISOString().slice(0, 10);
    const out: CrossProblem[] = [];
    if (isDate(d.delivery_completion_date) && d.delivery_completion_date > today) {
      out.push({ path: 'delivery_completion_date', error: 'is in the future', hint: 'Record the date the goods or service were actually received (today or earlier).' });
    }
    if (isDate(d.invoice_date) && isDate(d.delivery_completion_date) && days(d.delivery_completion_date, d.invoice_date) > 365) {
      out.push({ path: 'invoice_date', error: 'is more than a year after delivery', hint: 'Check the invoice date.' });
    }
    return out;
  },

  'GR-06': (d) => {
    const out: CrossProblem[] = [];
    const items = rows(d.items).filter((r) => isMoney(r.est_total));
    if (items.length && isMoney(d.estimated_total)) {
      const sum = items.reduce((s, r) => s + amt(r.est_total), 0);
      const cur = items[0].est_total.currency;
      if (cur === d.estimated_total.currency && d.estimated_total.amount + 0.01 < sum) {
        out.push({ path: 'estimated_total', error: `(${money(d.estimated_total)}) is less than the items in section C (${sum.toLocaleString('en-US')} ${cur})`, hint: `Enter at least ${sum.toLocaleString('en-US')} ${cur}, or correct the items in section C.` });
      }
    }
    return [...out, ...sameCurrency('items', rows(d.items).map((r) => r.unit_cost), 'item costs')];
  },

  'IM-08': (d) => order(d, 'date_submitted', 'target_date', 'target date', 'date the memo was submitted'),

  'TC-10': (d) => {
    const out = order(d, 'departure_date', 'return_date', 'returning date', 'departure date');
    if (!out.length && isDate(d.departure_date) && isDate(d.return_date) && typeof d.duration_days === 'number') {
      const span = days(d.departure_date, d.return_date);
      // accepted: days counted with both ends (span + 1) or nights (span)
      if (d.duration_days !== span + 1 && d.duration_days !== span) {
        out.push({ path: 'duration_days', error: `(${d.duration_days}) does not match the dates ${dmy(d.departure_date)} to ${dmy(d.return_date)}`, hint: `Enter ${span + 1} (departure and return day both counted), or correct the dates.` });
      }
    }
    out.push(...sameCurrency('transport_cost', [d.allowance_per_day, d.accommodation_per_day, d.transport_cost], 'the mission allowance, accommodation and transport'));
    if (d.traveller_type !== 'external' && d.supervisor && d.supervisor === d.issued_to) {
      out.push({ path: 'supervisor', error: 'is the same person as the traveller', hint: 'Choose the supervisor who proposed the mission; it cannot be the traveller.' });
    }
    return out;
  },
};
