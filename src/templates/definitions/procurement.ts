import { TemplateDef } from '../types';
import { f, req, when } from './dsl';

const slot = (key: string, label: string, role: string, seq: number, declaration: string, extra: object = {}) => ({ key, label, role, seq, declaration, ...extra });

export const PR01: TemplateDef = {
  code: 'PR-01', version: 1, title: 'Procurement Requisition',
  description: 'AfS-Rwa_PR-01. Starts a procurement case. The form alone does not authorize payment.',
  schema: { sections: [
    { key: 'request', title: 'Request', fields: [
      f.text('request_no', 'Request no.', { readonly: true, help: 'Generated when the case is created' }),
      f.date('date_of_request', 'Date of request', { ...req, default: 'today' }),
      f.user('requested_by', 'Requested by', req),
      f.text('project_activity', 'Project / activity', { ...req, maxLength: 200 }),
      f.date('required_by_date', 'Required by date', req),
      f.budget('budget_line', 'Budget line', req),
    ] },
    { key: 'items', title: 'Items', fields: [
      f.table('items', 'Items requested', [
        f.textarea('description', 'Description and technical specification', req),
        f.number('qty', 'Qty', { ...req, min: 0, exclusive_min: true }),
        f.money('unit_cost', 'Unit cost', req),
        f.money('est_unit_cost', 'Est. unit cost', req),
        f.computed('est_total', 'Est. total', { op: 'mul', fields: ['qty', 'est_unit_cost'] }, { format: 'money' }),
      ], 1, 50, req),
    ] },
    { key: 'justification', title: 'Justification', fields: [
      f.textarea('business_justification', 'Business justification', req),
      f.text('suggested_supplier', 'Suggested supplier (optional)'),
      f.checks('special_conditions', 'Special conditions', ['Delivery', 'Installation', 'Warranty', 'Training'], { allow_other: true }),
    ] },
  ] },
  signature_slots: [
    slot('prepared_by', 'Prepared by (requester)', 'requesting_staff', 1, 'I confirm this requisition is accurate and needed for the activity named above.', { assign: 'creator' }),
    slot('received_checked', 'Received and checked (Accountant)', 'accountant', 2, 'I have checked the request and the budget line.'),
    slot('pi_initial', 'Initial authorization (PI)', 'pi', 3, 'I authorize this requisition to proceed to quotation collection.'),
  ],
  workflow: { guards_on_submit: ['template_valid'], guards_on_sign: ['frozen_after_sign', 'no_duplicate_signature'], requires_conflict_confirmation: false,
    footer_note: 'This requisition alone does not authorize payment.' },
};

export const QC02: TemplateDef = {
  code: 'QC-02', version: 1, title: 'Supplier Quotation Collection Register',
  description: 'AfS-Rwa_QC-02. Minimum two comparable quotations with attached files.',
  schema: { sections: [
    { key: 'general', title: 'General', fields: [
      f.caseRef('request_no', 'Request no.'),
      f.date('collection_date', 'Collection date', { ...req, default: 'today' }),
      f.text('item_service', 'Item / service', req),
    ] },
    { key: 'quotations', title: 'Quotations', description: 'Collect at least two quotations comparable in scope, specifications, taxes and delivery terms.', fields: [
      f.table('quotations', 'Quotations received', [
        f.supplier('supplier', 'Supplier', req),
        f.text('tel', 'Tel', req),
        f.text('email', 'E-mail', req),
        f.text('quote_ref', 'Quotation ref.', req),
        f.date('quote_date', 'Quotation date', req),
        f.money('total_price', 'Total price', req),
        f.text('delivery', 'Delivery', req),
        f.text('validity', 'Validity', req),
        f.file('attachment', 'Quotation file', { ...req, accept: ['application/pdf', 'image/png', 'image/jpeg'] }),
      ], 2, 5, req),
    ] },
    { key: 'method', title: 'Collection', fields: [
      f.checks('collection_method', 'Collection method', ['Email', 'Written quotation', 'Supplier portal'], { ...req, allow_other: true }),
      f.yesno('conflict_declaration', 'Conflict of interest declared (or N/A)', req),
      f.textarea('notes', 'Notes'),
    ] },
  ] },
  signature_slots: [
    slot('collected_by', 'Collected by', 'accountant', 1, 'I collected these quotations and they are as received from the suppliers.'),
    slot('checked_by_accountant', 'Checked by (Accountant)', 'accountant', 2, 'I checked that the quotations are comparable.'),
    slot('requesting_staff_ack', 'Acknowledged (requesting staff)', 'requesting_staff', 3, 'I acknowledge receipt of the quotation register.', { assign: 'case_requester' }),
  ],
  workflow: { guards_on_submit: ['template_valid', 'min_quotations:2'], guards_on_sign: ['conflict_confirmed', 'frozen_after_sign', 'no_duplicate_signature'], requires_conflict_confirmation: true,
    footer_note: 'Quotations should be comparable in scope, specifications, taxes and delivery terms.' },
};

export const MPV03: TemplateDef = {
  code: 'MPV-03', version: 1, title: 'Market Price Verification',
  description: 'Optional step between quotation collection and evaluation.',
  schema: { sections: [
    { key: 'header', title: 'Header', fields: [
      f.caseRef('procurement_request_no', 'Procurement request no.'), f.caseRef('project_activity', 'Project / activity'),
      f.caseRef('item_service', 'Item / service'), f.caseRef('requesting_staff', 'Requesting staff'),
      f.date('mpv_date', 'Date', { ...req, default: 'today' }), f.user('staff_assigned', 'Staff assigned', req),
      f.text('market_location_visited', 'Market / location visited', req),
    ] },
    { key: 'spec', title: 'A. Specification lines', fields: [
      f.table('spec_lines', 'Items to verify', [
        f.text('description', 'Description', req), f.number('qty', 'Qty', { ...req, min: 0, exclusive_min: true }),
        f.text('unit', 'Unit', req), f.money('quoted_price_benchmark', 'Quoted price / benchmark', req),
      ], 1, 4, req),
    ] },
    { key: 'market', title: 'B. Market checks', fields: [
      f.table('market_checks', 'Outlets checked', [
        f.text('outlet', 'Outlet', req), f.text('location_contact', 'Location / contact', req),
        f.yesno('item_available', 'Item available'), f.money('unit_price', 'Unit price', req),
        f.yesno('taxes_included', 'Taxes included'), f.text('lead_time', 'Lead time'),
        f.file('evidence', 'Evidence'), f.text('remarks', 'Remarks'),
      ], 1, 4, req),
    ] },
    { key: 'comparison', title: 'C. Comparison with quotations', fields: [
      f.table('comparisons', 'Comparison', [
        f.text('quoted_supplier', 'Quoted supplier', req), f.money('quotation_amount', 'Quotation amount', req),
        f.text('verified_market_range', 'Verified market range'),
        f.computed('variance', 'Variance (quotation minus range midpoint)', { op: 'variance_mid', fields: ['quotation_amount', 'price_range_low', 'price_range_high'] }, { format: 'money' }),
        f.yesno('price_reasonable', 'Price reasonable'), f.text('comment', 'Comment'),
      ], 1, 4, req),
      f.money('price_range_low', 'Observed price range: low', req), f.money('price_range_high', 'Observed price range: high', req),
    ] },
    { key: 'findings', title: 'Findings', fields: [
      f.radio('market_availability', 'Market availability', ['Readily available', 'Limited availability', 'Special order or customized'], req),
      f.radio('quotation_assessment', 'Quotation assessment', ['Within market range', 'Below market range', 'Above market range', 'Not directly comparable'], req),
      f.textarea('finding_explanation', 'Explanation of findings', req),
      f.radio('recommendation', 'Recommendation', ['Proceed with evaluation', 'Seek clarification or negotiate', 'Obtain additional quotations', 'Repeat verification'], { ...req, allow_other: true }),
      f.checks('attachment_types', 'Attachments', ['Supplier price list', 'Proforma', 'Business card', 'Photo'], { allow_other: true }),
      f.table('attachment_files', 'Attached files', [f.file('file', 'File')], 0, 5),
      f.yesno('verifier_declaration', 'I declare no conflict of interest and that I accepted no benefit', req),
    ] },
  ] },
  signature_slots: [
    slot('market_verification_officer', 'Market Verification Officer', 'market_verifier', 1, 'I verified these prices in person and declare no conflict of interest.'),
    slot('accountant_review', 'Accountant review', 'accountant', 2, 'I reviewed the market price verification.'),
    slot('requesting_staff_ack', 'Acknowledged (requesting staff)', 'requesting_staff', 3, 'I acknowledge the market price verification.', { assign: 'case_requester' }),
  ],
  workflow: { guards_on_submit: ['template_valid', 'price_range_ordered'], guards_on_sign: ['conflict_confirmed', 'frozen_after_sign', 'no_duplicate_signature'], requires_conflict_confirmation: true },
};

export const QE03: TemplateDef = {
  code: 'QE-03', version: 1, title: 'Quotation Evaluation, Supplier Recommendation and PO Authorization',
  description: 'Three different reviewers evaluate the quotations and recommend one supplier.',
  schema: { sections: [
    { key: 'general', title: 'General', fields: [
      f.caseRef('request_no', 'Request no.'), f.caseRef('item_service', 'Item / service'),
      f.date('evaluation_date', 'Evaluation date', { ...req, default: 'today' }),
      f.caseRef('committee', 'Evaluation committee', { help: 'Requesting staff, Director of Communications, PI' }),
    ] },
    { key: 'comparison', title: 'Comparison', description: 'One row per quotation, prefilled from QC-02.', fields: [
      f.table('comparison', 'Quotations compared', [
        f.supplier('supplier', 'Supplier', req), f.text('product_name', 'Product / service', req),
        f.yesno('meets_specs', 'Meets specifications', req), f.money('price', 'Price', req),
        f.text('delivery', 'Delivery', req), f.textarea('finding', 'Quality, experience and overall finding', req),
      ], 1, 7, req),
    ] },
    { key: 'recommendation', title: 'Recommendation', fields: [
      f.supplier('recommended_supplier', 'Recommended supplier', req),
      f.money('recommended_amount', 'Recommended amount', req),
      f.checks('reason_for_selection', 'Reason for selection', ['Lowest compliant price', 'Best value', 'Quality or technical advantage', 'Delivery advantage'], { ...req, allow_other: true }),
      f.textarea('evaluation_notes', 'Evaluation notes and authorization to commit or order', req),
    ] },
  ] },
  signature_slots: [
    slot('reviewer_1', 'Reviewer 1 (requesting staff)', 'requesting_staff', 1, 'I reviewed the quotations and confirm I have no undisclosed conflict of interest.', { group: 'eval', assign: 'case_requester' }),
    slot('reviewer_2', 'Reviewer 2 (Director of Communications)', 'director_comms', 1, 'I reviewed the quotations and confirm I have no undisclosed conflict of interest.', { group: 'eval' }),
    slot('reviewer_3', 'Reviewer 3 (PI)', 'pi', 1, 'I reviewed the quotations and confirm I have no undisclosed conflict of interest.', { group: 'eval' }),
  ],
  workflow: { guards_on_submit: ['template_valid', 'supplier_in_quotations', 'min_quotations:2'], guards_on_sign: ['reviewers_distinct', 'conflict_confirmed', 'frozen_after_sign', 'no_duplicate_signature'], requires_conflict_confirmation: true,
    footer_note: 'All three reviewers must be different people. If the requester is the Director or PI, a delegated authorized staff user signs that slot.' },
};

export const PO09: TemplateDef = {
  code: 'PO-09', version: 1, title: 'Purchase Order',
  description: 'Created only from a fully signed QE-03. Lines and supplier are copied, not retyped.',
  schema: { sections: [
    { key: 'header', title: 'Order', fields: [
      f.text('po_number', 'PO number', { readonly: true }), f.date('issue_date', 'Issue date', { ...req, default: 'today' }),
      f.caseRef('requisition_no', 'Requisition no.'), f.caseRef('project_activity', 'Project / activity'),
      f.caseRef('budget_line', 'Budget line'), f.caseRef('requested_by', 'Requested by'),
      f.radio('currency', 'Currency', ['RWF', 'USD', 'EUR'], { ...req, allow_other: true }),
      f.checks('payment_terms', 'Payment terms', ['Bank transfer', 'Mobile money', 'MoMo pay', 'Cash'], { ...req, allow_other: true }),
    ] },
    { key: 'supplier', title: 'Supplier', fields: [
      f.caseRef('supplier_name', 'Supplier'), f.caseRef('tin_registration_no', 'TIN / registration no.'),
      f.caseRef('contact_person_position', 'Contact person / position'), f.caseRef('telephone_email', 'Telephone / e-mail'),
      f.caseRef('quotation_ref_date', 'Quotation ref. and date'),
    ] },
    { key: 'lines', title: 'Order lines', fields: [
      f.table('lines', 'Lines', [
        f.text('description', 'Description', req), f.text('specification_scope', 'Specification / scope', req),
        f.number('qty', 'Qty', { ...req, min: 0, exclusive_min: true }), f.text('unit', 'Unit', req), f.money('unit_price', 'Unit price', req),
      ], 1, 50, req),
      f.computed('subtotal', 'Subtotal', { op: 'sum_mul', table: 'lines', fields: ['qty', 'unit_price'] }, { format: 'money' }),
      f.money('tax_vat', 'Tax / VAT', req),
      f.computed('total_po_value', 'Total PO value', { op: 'add', fields: ['subtotal', 'tax_vat'] }, { format: 'money' }),
    ] },
  ] },
  signature_slots: [
    slot('issued_by', 'Issued by (Accountant)', 'accountant', 1, 'I confirm this purchase order reflects the approved supplier, specifications and amount.'),
    slot('authorized_by_pi', 'Authorized by (PI)', 'pi', 2, 'I authorize AfS-Rwanda to place this order.'),
  ],
  workflow: { guards_on_submit: ['template_valid', 'po_from_approved_eval', 'amount_matches_evaluation'], guards_on_sign: ['frozen_after_sign', 'no_duplicate_signature'], requires_conflict_confirmation: false },
};

export const PA04: TemplateDef = {
  code: 'PA-04', version: 1, title: 'Purchase / Service Payment Final Compliance Approval',
  description: 'Payment only after verified delivery and a supporting invoice, except an approved advance arrangement.',
  schema: { sections: [
    { key: 'order', title: 'Order', fields: [
      f.caseRef('request_no', 'Request no.'), f.caseRef('selected_supplier', 'Selected supplier'),
      f.caseRef('approved_purchase_service', 'Approved purchase / service'), f.caseRef('approved_amount', 'Approved amount'),
      f.caseRef('po_contract_ref', 'PO / contract ref.'), f.date('expected_delivery_completion', 'Expected delivery / completion', req),
    ] },
    { key: 'controls', title: 'Compliance controls', fields: [
      f.yesno('ctrl_requisition_attached', 'Requisition attached and signed', { readonly: true }),
      f.yesno('ctrl_two_quotations', 'Two or more quotations on file', { readonly: true }),
      f.yesno('ctrl_evaluation_signed', 'Evaluation fully signed', { readonly: true }),
      f.yesno('ctrl_budget_confirmed', 'Budget availability confirmed (Accountant)', req), f.text('ctrl_budget_confirmed_comment', 'Comment'),
      f.yesno('ctrl_supplier_details_verified', 'Supplier details verified (Accountant)', req), f.text('ctrl_supplier_details_verified_comment', 'Comment'),
    ] },
    { key: 'delivery', title: 'Delivery and invoice', fields: [
      f.date('delivery_completion_date', 'Delivery / completion date', req),
      f.text('invoice_no', 'Invoice no.', req), f.date('invoice_date', 'Invoice date', req),
      f.text('delivery_note_ref', 'Delivery note ref.', req), f.file('delivery_note_file', 'Delivery note file', req),
      f.radio('acceptance', 'Acceptance', ['Received in full and conform', 'Exception noted'], req),
      f.textarea('exception_text', 'Exception', { required_if: when('acceptance', { equals: 'exception_noted' }), visible_if: when('acceptance', { equals: 'exception_noted' }) }),
    ] },
    { key: 'payment', title: 'Payment', fields: [
      f.money('amount_payable', 'Amount payable', req), f.text('payment_method_ref', 'Payment method / ref.', req),
    ] },
  ] },
  signature_slots: [
    slot('received_verified', 'Received and verified (requesting staff)', 'requesting_staff', 1, 'I confirm the goods or services were received as described.', { assign: 'case_requester' }),
    slot('payment_prepared', 'Payment prepared (Accountant)', 'accountant', 2, 'I prepared this payment and confirm the controls above.'),
    slot('final_approval', 'Final approval (CFM)', 'cfm', 3, 'I approve this payment.'),
  ],
  workflow: { guards_on_submit: ['template_valid', 'budget_confirmed', 'amount_within_approved'], guards_on_sign: ['payment_after_delivery', 'frozen_after_sign', 'no_duplicate_signature'], requires_conflict_confirmation: false,
    footer_note: 'Payment only after verified delivery and supporting invoice, except an approved advance arrangement.' },
};
