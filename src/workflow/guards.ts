import { Queryable } from '../db/db.service';
import { guardError, validationError } from '../common/errors';
import { amt } from '../templates/computed';
import { validateFull } from '../templates/validate';
import { isSigned } from './stages';

export interface GuardCtx {
  q: Queryable;
  tpl: { code: string; schema: any };
  doc: { id: string; case_id: string | null; doc_type: string; state: string; data: any };
  data: Record<string, any>;
  caseRow: any | null;
  actorId?: string | null;
  slot?: { id: string; slot_key: string; role_code: string };
  body?: any;
  /** merged data incl. fields filled at earlier slots (sign time) */
}

type Guard = (ctx: GuardCtx, arg?: string) => Promise<void> | void;

async function caseDocData(q: Queryable, caseId: string | null, type: string, onlySigned = false) {
  if (!caseId) return null;
  const r = await q.query(
    `SELECT data, state FROM documents WHERE case_id = $1 AND doc_type = $2 AND state <> 'cancelled' ${onlySigned ? "AND state IN ('signed','archived')" : ''} ORDER BY created_at DESC LIMIT 1`, [caseId, type]);
  return r.rows[0] ?? null;
}

const quotationsWithFile = (data: any) => (data?.quotations ?? []).filter((r: any) => !!r.attachment);

export const GUARDS: Record<string, Guard> = {
  /** All required fields filled, types and ranges valid (JSON template validation on the server) */
  template_valid: ({ tpl, data }) => {
    const { errors, hints } = validateFull(tpl as any, data, true);
    if (Object.keys(errors).length) throw validationError(errors, hints);
  },

  /** QC-02: at least N quotation rows with an attached file. QE-03 checks the signed QC-02 of the case. */
  min_quotations: async (ctx, arg = '2') => {
    const n = Number(arg);
    const data = ctx.doc.doc_type === 'QC-02' ? ctx.data : (await caseDocData(ctx.q, ctx.doc.case_id, 'QC-02', true))?.data;
    const have = quotationsWithFile(data).length;
    if (have < n) {
      if (ctx.doc.doc_type === 'QC-02') throw guardError('min_quotations', `At least ${n} quotations with an attached file are required (${have} so far)`, { quotations: `${have} of ${n} quotations have a file` }, { quotations: `Add ${n - have} more quotation row(s) and upload the quotation file in the "Attachment" column of each row.` });
      throw guardError('min_quotations', `The signed quotation register (QC-02) has ${have} quotation(s) with a file; at least ${n} are needed`, undefined, { _form: 'Ask the Accountant to complete and sign the quotation register (QC-02) first.' });
    }
  },

  /** QE-03: the recommended supplier (and every compared supplier) must come from QC-02 */
  supplier_in_quotations: async (ctx) => {
    const qc = await caseDocData(ctx.q, ctx.doc.case_id, 'QC-02', true);
    const ids = new Set((qc?.data?.quotations ?? []).map((r: any) => r.supplier));
    if (!ids.has(ctx.data.recommended_supplier)) throw guardError('supplier_in_quotations', 'The recommended supplier must be one of the suppliers in the quotation register', { recommended_supplier: 'is not in the quotation register (QC-02)' }, { recommended_supplier: 'Choose a supplier that sent a quotation recorded in the signed QC-02.' });
    const bad = (ctx.data.comparison ?? []).findIndex((r: any) => !ids.has(r.supplier));
    if (bad >= 0) throw guardError('supplier_in_quotations', 'Every compared supplier must come from the quotation register', { [`comparison[${bad}].supplier`]: 'is not in the quotation register (QC-02)' }, { [`comparison[${bad}].supplier`]: 'Choose a supplier from the signed QC-02, or remove this row.' });
  },

  /** QE-03 sign: a person cannot fill two reviewer slots (use a delegate when requester is director or PI) */
  reviewers_distinct: async ({ q, doc, actorId, slot }) => {
    if (!actorId) return;
    const r = await q.query(
      `SELECT 1 FROM signatures g JOIN signature_slots s ON s.id = g.slot_id
       WHERE s.document_id = $1 AND s.voided_at IS NULL AND g.signer_user_id = $2 AND s.slot_key <> $3`, [doc.id, actorId, slot?.slot_key]);
    if (r.rowCount) throw guardError('reviewers_distinct', 'You already signed another reviewer box on this evaluation. The three reviewers must be different people: ask the requester or the Accountant to assign a delegate to this box.');
    // also forbid an assigned delegate that is already assigned to another reviewer slot
    const dup = await q.query(
      `SELECT 1 FROM signature_slots WHERE document_id = $1 AND voided_at IS NULL AND slot_key <> $3 AND assigned_user_id = $2 AND status <> 'skipped'`, [doc.id, actorId, slot?.slot_key]);
    if (dup.rowCount) throw guardError('reviewers_distinct', 'You are assigned to another reviewer box on this evaluation. The three reviewers must be different people: ask the requester or the Accountant to assign a different delegate.');
  },

  /** Conflict of interest / verifier declaration ticked on the signing request */
  conflict_confirmed: ({ body }) => {
    if (body?.conflict_confirmed !== true) throw guardError('conflict_confirmed', 'Confirm that you have no undisclosed conflict of interest before signing', { conflict_confirmed: 'required' }, { conflict_confirmed: 'Tick the conflict of interest box in the signing panel. If you have a conflict, decline instead and explain why.' });
  },

  /** PO can only be created from a fully signed QE-03 */
  po_from_approved_eval: async ({ q, doc }) => {
    const qe = await caseDocData(q, doc.case_id, 'QE-03', true);
    if (!qe) throw guardError('po_from_approved_eval', 'A purchase order needs a fully signed evaluation (QE-03). Wait until all three reviewers have signed the evaluation.');
  },

  /** PO total must not exceed the evaluation amount */
  amount_matches_evaluation: ({ data, caseRow }) => {
    if (caseRow?.approved_amount == null) return;
    const total = amt(data.total_po_value);
    if (total > Number(caseRow.approved_amount) + 0.01) {
      const approved = Number(caseRow.approved_amount);
      throw guardError('amount_matches_evaluation', `The PO total (${total.toLocaleString('en-US')}) is above the approved evaluation amount (${approved.toLocaleString('en-US')})`,
        { total_po_value: `is ${(total - approved).toLocaleString('en-US')} above the approved amount` },
        { total_po_value: `Lower the quantities, unit prices or tax so the total is at most ${approved.toLocaleString('en-US')}. A higher amount needs a new evaluation.` });
    }
  },

  budget_confirmed: ({ data }) => {
    if (data.ctrl_budget_confirmed !== true) throw guardError('budget_confirmed', 'The Accountant must confirm budget availability', { ctrl_budget_confirmed: 'must be Yes before submitting' }, { ctrl_budget_confirmed: 'Check the budget line; choose Yes when funds are available. If they are not, do not submit: raise it with the PI.' });
  },

  /** PA-04: payable amount not above approved unless an exception is recorded */
  amount_within_approved: ({ data, caseRow }) => {
    if (caseRow?.approved_amount == null) return;
    const exception = data.acceptance === 'exception_noted' && String(data.exception_text ?? '').trim() !== '';
    if (amt(data.amount_payable) > Number(caseRow.approved_amount) + 0.01 && !exception) {
      throw guardError('amount_within_approved', 'Amount payable is above the approved amount', { amount_payable: `is above the approved amount (${Number(caseRow.approved_amount).toLocaleString('en-US')})` },
        { amount_payable: `Enter at most ${Number(caseRow.approved_amount).toLocaleString('en-US')}, or choose "Exception noted" under Acceptance and explain the difference.` });
    }
  },

  /** PA-04 cannot be signed before delivery, invoice and delivery note exist, unless the CFM set the advance arrangement flag */
  payment_after_delivery: ({ caseRow, doc }) => {
    if (doc.doc_type !== 'PA-04' || !caseRow) return;
    if (caseRow.advance_arrangement) return;
    const d = caseRow.delivery;
    if (!d?.delivery_date || !d?.invoice_no || !(d?.delivery_note_attachment_id || d?.delivery_note_ref)) {
      const missing = [!d?.delivery_date && 'delivery date', !d?.invoice_no && 'invoice number', !(d?.delivery_note_attachment_id || d?.delivery_note_ref) && 'delivery note'].filter(Boolean).join(', ');
      throw guardError('payment_after_delivery', `Payment cannot be signed yet: the case has no ${missing}. Record the delivery on the case page first, or ask the CFM to approve an advance-payment arrangement.`);
    }
  },

  /** IM-08: single source option needs the uploaded justification before approval */
  single_source_requires_justification: ({ slot, body, data }) => {
    if (slot?.slot_key !== 'superior') return;
    const merged = { ...data, ...(body?.data ?? {}) };
    const single = (merged.action_types ?? []).includes('single_source_justification_or_approval');
    if (single && !merged.single_source_justification && ['approved', 'approved_with_conditions'].includes(merged.decision_status)) {
      throw guardError('single_source_requires_justification', 'Upload the single source justification before approving', { single_source_justification: 'required when approving a single-source action' }, { single_source_justification: 'Upload the written justification, or untick "Single-Source Justification / Approval".' });
    }
  },

  /** MPV-03: observed price range low must not exceed high */
  price_range_ordered: ({ data }) => {
    if (amt(data.price_range_low) > amt(data.price_range_high)) throw guardError('price_range_ordered', 'The lowest observed price is above the highest', { price_range_low: 'is above the highest price' }, { price_range_low: 'Enter the lowest price you found as "Lowest" and the highest as "Highest".' });
  },

  /** TC-10: return not before departure; the proposing supervisor is someone other than the traveller */
  travel_clearance_valid: ({ data }) => {
    if (data.return_date && data.departure_date && data.return_date < data.departure_date) throw guardError('travel_clearance_valid', 'The returning date cannot be before the departure date', { return_date: 'is before the departure date' }, { return_date: 'Choose a returning date on or after the departure date.' });
    if (data.traveller_type !== 'external' && data.supervisor && data.supervisor === data.issued_to) throw guardError('travel_clearance_valid', 'The supervisor who proposed the mission must be someone other than the traveller', { supervisor: 'is the same person as the traveller' }, { supervisor: 'Choose the supervisor who proposed the mission; it cannot be the traveller.' });
  },

  /** Enforced by the data layer (documents.state check), listed so templates stay self documenting */
  frozen_after_sign: () => undefined,
  no_duplicate_signature: () => undefined,
  /** GR-06: shown to the approver in the UI (30-70 km), no server check */
  distance_notice: () => undefined,
};

export async function runGuards(names: string[], ctx: GuardCtx) {
  for (const n of names) {
    const [name, arg] = n.split(':');
    const g = GUARDS[name];
    if (!g) throw new Error(`unknown guard ${n}`);
    await g(ctx, arg);
  }
}
export { isSigned };
