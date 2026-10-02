import { Queryable } from '../db/db.service';
import { isSigned } from '../workflow/stages';

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
export async function prefill(q: Queryable, docType: string, c: CaseCtx | null, actor: { id: string; department?: string | null }): Promise<Record<string, any>> {
  if (!c) {
    if (docType === 'IM-08') return { date_submitted: today(), version: '1.0', department_office: actor.department ?? undefined };
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
        scope: (po?.data?.lines ?? []).slice(0, 8).map((l: any) => ({ col1: l.description, col2: l.specification_scope, col3: `${l.qty} ${l.unit ?? ''}`.trim() })),
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
  const out = { ...data };
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
