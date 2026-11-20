import { Queryable } from '../db/db.service';
import { isSigned } from '../workflow/stages';
import { normalizeIdNumber } from '../templates/validate';

const today = () => new Date().toISOString().slice(0, 10);
const money = (n: any, currency = 'RWF') => `${Number(n).toLocaleString('en-US')} ${currency}`;

export interface CaseCtx {
  id: string; request_no: string; project: string | null; budget_line_id: string | null; budget_code: string | null;
  requested_by: string; requester_name: string; required_by: string | null;
  selected_supplier_id: string | null; approved_amount: string | null; currency: string | null; delivery: any;
}

export async function loadCaseCtx(q: Queryable, caseId: string): Promise<CaseCtx | null> {
  const r = await q.query(
    `SELECT c.id, c.request_no, c.project, c.budget_line_id, b.code AS budget_code, c.requested_by, u.full_name AS requester_name,
            c.required_by::text, c.selected_supplier_id, c.approved_amount, c.currency, c.delivery
     FROM cases c JOIN users u ON u.id = c.requested_by LEFT JOIN budget_lines b ON b.id = c.budget_line_id WHERE c.id = $1`, [caseId]);
  return r.rows[0] ?? null;
}

async function latest(q: Queryable, caseId: string, type: string, signedOnly = false) {
  const r = await q.query(
    `SELECT id, data, state FROM documents WHERE case_id = $1 AND doc_type = $2 AND state <> 'cancelled' ${signedOnly ? "AND state IN ('signed','archived')" : ''} ORDER BY created_at DESC LIMIT 1`, [caseId, type]);
  return r.rows[0] as { id: string; data: any; state: string } | undefined;
}

const supplierOf = async (q: Queryable, id: string | null) =>
  id ? (await q.query('SELECT * FROM suppliers WHERE id = $1', [id])).rows[0] : null;

/** Values copied from the case and earlier documents when a draft is created (spec section 5: `case.*`, copied not retyped). */
export async function prefill(q: Queryable, docType: string, c: CaseCtx | null, actor: { id: string; department?: string | null; position?: string | null }): Promise<Record<string, any>> {
  if (!c) {
    // the requester starts as the person filling the form; they change it when they fill it for someone else
    if (docType === 'IM-08') return { originator: actor.id, date_submitted: today(), version: '1.0', department_office: actor.department ?? undefined };
    if (docType === 'GR-06') return { requested_by: actor.id };
    if (docType === 'TC-10') {
      // the requester is the first traveller, with the details saved from their last clearance
      const p = await staffProfile(q, actor.id);
      const row = { traveller_type: 'internal_afs_staff', staff: actor.id, id_type: p?.id_type ?? 'rwanda_national_id', id_number: p?.id_number ?? undefined,
        account_number: p?.account_number ?? undefined, function: p?.function ?? actor.position ?? undefined };
      return { travellers: [Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined))], funding_source: 'internal', issued_at: 'Kigali' };
    }
    return {};
  }
  const pr = await latest(q, c.id, 'PR-01');
  const prItems: any[] = pr?.data?.items ?? [];
  const itemService = prItems.map((i) => i.description).filter(Boolean).join('; ').slice(0, 200);
  const base = { request_no: c.request_no };
  switch (docType) {
    case 'PR-01':
      return { ...base, date_of_request: today(), requested_by: c.requested_by, project_activity: c.project ?? undefined, required_by_date: c.required_by ?? undefined, budget_line: c.budget_line_id ?? undefined };
    case 'QC-02':
      return { ...base, collection_date: today(), item_service: itemService || undefined };
    case 'MPV-03': {
      const qc = await latest(q, c.id, 'QC-02', true);
      const sup = new Map((await q.query('SELECT id, name FROM suppliers')).rows.map((s: any) => [s.id, s.name]));
      return {
        procurement_request_no: c.request_no, project_activity: c.project ?? '', item_service: itemService, requesting_staff: c.requester_name, mpv_date: today(),
        spec_lines: prItems.map((i) => ({ description: i.description, qty: i.qty, unit: '', quoted_price_benchmark: i.est_unit_cost })),
        comparisons: (qc?.data?.quotations ?? []).map((r: any) => ({ quoted_supplier: sup.get(r.supplier) ?? '', quotation_amount: r.total_price })),
      };
    }
    case 'QE-03': {
      const qc = await latest(q, c.id, 'QC-02', true);
      return {
        ...base, item_service: qc?.data?.item_service ?? itemService, evaluation_date: today(), committee: 'Requesting staff, Director of Communications, PI',
        comparison: (qc?.data?.quotations ?? []).map((r: any) => ({ supplier: r.supplier, product_name: qc?.data?.item_service ?? '', price: r.total_price, delivery: r.delivery })),
      };
    }
    case 'PO-09': {
      const qc = await latest(q, c.id, 'QC-02', true);
      const s = await supplierOf(q, c.selected_supplier_id);
      const quote = (qc?.data?.quotations ?? []).find((r: any) => r.supplier === c.selected_supplier_id);
      const seq = (await q.query("SELECT nextval('po_no_seq') AS n")).rows[0].n;
      return {
        po_number: `PO-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`, issue_date: today(),
        requisition_no: c.request_no, project_activity: c.project ?? '', budget_line: c.budget_code ?? '', requested_by: c.requester_name,
        currency: (c.currency ?? 'RWF').toLowerCase(),
        supplier_name: s?.name ?? '', tin_registration_no: s?.tin_or_reg_no ?? '', contact_person_position: s?.contact_person ?? '',
        telephone_email: [s?.phone, s?.email].filter(Boolean).join(' / '),
        quotation_ref_date: quote ? [quote.quote_ref, quote.quote_date].filter(Boolean).join(' / ') : '',
        lines: prItems.map((i) => ({ description: i.description, specification_scope: i.description, qty: i.qty, unit: 'unit', unit_price: i.est_unit_cost })),
        tax_vat: { amount: 0, currency: c.currency ?? 'RWF' },
      };
    }
    case 'CONTRACT': {
      const s = await supplierOf(q, c.selected_supplier_id);
      const po = await latest(q, c.id, 'PO-09', true);
      return {
        supplier: c.selected_supplier_id ?? undefined, supplier_address: s?.address ?? '', supplier_email: s?.email ?? '', supplier_telephone: s?.phone ?? '', supplier_tin: s?.tin_or_reg_no ?? '',
        contract_value: c.approved_amount != null ? { amount: Number(c.approved_amount), currency: c.currency ?? 'RWF' } : undefined,
        advance_percent: 50, advance_days: 2,
        scope: (po?.data?.lines ?? []).map((l: any) => ({ col1: l.description, col2: l.specification_scope, col3: `${l.qty} ${l.unit ?? ''}`.trim() })),
      };
    }
    case 'PA-04': {
      const po = await latest(q, c.id, 'PO-09', true);
      const qc = await latest(q, c.id, 'QC-02', true);
      const s = await supplierOf(q, c.selected_supplier_id);
      const d = c.delivery ?? {};
      return {
        ...base, selected_supplier: s?.name ?? '', approved_purchase_service: qc?.data?.item_service ?? itemService,
        approved_amount: c.approved_amount != null ? money(c.approved_amount, c.currency ?? 'RWF') : '', po_contract_ref: po?.data?.po_number ?? '',
        delivery_completion_date: d.delivery_date, invoice_no: d.invoice_no, invoice_date: d.invoice_date,
        delivery_note_ref: d.delivery_note_ref, delivery_note_file: d.delivery_note_attachment_id,
        amount_payable: c.approved_amount != null ? { amount: Number(c.approved_amount), currency: c.currency ?? 'RWF' } : undefined,
      };
    }
  }
  return {};
}

/** Server controlled values re-derived on every save and at submit (controls, case references). */
export async function deriveAuto(q: Queryable, docType: string, data: Record<string, any>, c: CaseCtx | null): Promise<Record<string, any>> {
  const out = docType === 'TC-10' ? travelClearanceAuto(data) : { ...data };
  if (!c) return out;
  if (['QC-02', 'QE-03', 'PA-04', 'PR-01'].includes(docType)) out.request_no = c.request_no;
  if (docType === 'PA-04') {
    const pr = await latest(q, c.id, 'PR-01');
    const qc = await latest(q, c.id, 'QC-02');
    const qe = await latest(q, c.id, 'QE-03');
    out.ctrl_requisition_attached = !!pr && isSigned(pr.state);
    out.ctrl_two_quotations = (qc?.data?.quotations ?? []).filter((r: any) => !!r.attachment).length >= 2;
    out.ctrl_evaluation_signed = !!qe && isSigned(qe.state);
    if (c.approved_amount != null) out.approved_amount = money(c.approved_amount, c.currency ?? 'RWF');
  }
  if (docType === 'PO-09' && c.approved_amount != null) out.currency = out.currency ?? (c.currency ?? 'RWF').toLowerCase();
  if (docType === 'CONTRACT' && c.approved_amount != null) out.contract_value = { amount: Number(c.approved_amount), currency: c.currency ?? 'RWF' };
  return out;
}

const staffProfile = async (q: Queryable, userId: string) =>
  (await q.query('SELECT id_type, id_number, account_number, function FROM traveller_profiles WHERE user_id = $1 AND active', [userId])).rows[0] as
    { id_type: string | null; id_number: string | null; account_number: string | null; function: string | null } | undefined;

/** One traveller row with only the fields of its kind kept (staff member or external name) and the ID normalised. */
export function cleanTraveller(r: Record<string, any>): Record<string, any> {
  const row = { ...r };
  if (typeof row.id_number === 'string') row.id_number = normalizeIdNumber(row.id_number);
  if (typeof row.email === 'string') row.email = row.email.trim().toLowerCase();
  if (row.traveller_type === 'external') delete row.staff; else { delete row.name; delete row.email; }
  return row;
}

/** The printed traveller of a clearance (issued to, ID, account, function) taken from a traveller row. */
export function travellerFields(row: Record<string, any> | undefined): Record<string, any> {
  if (!row) return {};
  const external = row.traveller_type === 'external';
  return {
    traveller_type: row.traveller_type, ...(external ? { issued_to_name: row.name, traveller_email: row.email } : { issued_to: row.staff }),
    id_type: row.id_type, id_number: row.id_number, account_number: row.account_number, function: row.function,
  };
}

const TRAVELLER_KEYS = ['traveller_type', 'issued_to', 'issued_to_name', 'traveller_email', 'id_type', 'id_number', 'account_number', 'function'];
const COST_KEYS = ['allowance_per_day', 'accommodation_per_day', 'transport_cost', 'transport_details', 'total_amount'];

/**
 * TC-10 values the server controls: traveller rows cleaned, the first traveller printed on the clearance, and only the
 * funding of the chosen kind kept (an externally funded mission has no budget line and no costs).
 */
export function travelClearanceAuto(data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...data };
  if (!Array.isArray(out.travellers)) {
    // drafts of the form before version 11: one traveller entered directly
    if (typeof out.id_number === 'string') out.id_number = normalizeIdNumber(out.id_number);
    if (out.traveller_type === 'external') delete out.issued_to; else if (out.traveller_type) delete out.issued_to_name;
    return out;
  }
  for (const k of TRAVELLER_KEYS) delete out[k];
  out.travellers = out.travellers.map((r: any) => (r && typeof r === 'object' && !Array.isArray(r) ? cleanTraveller(r) : r));
  Object.assign(out, Object.fromEntries(Object.entries(travellerFields(out.travellers[0])).filter(([, v]) => v !== undefined && v !== null && v !== '')));
  if (out.funding_source === 'external') { delete out.funding; for (const k of COST_KEYS) delete out[k]; }
  else if (out.funding_source === 'internal') delete out.external_funder;
  return out;
}
