import { TemplateDef } from '../types';
import { f, req, when } from './dsl';

const slot = (key: string, label: string, role: string, seq: number, declaration: string, extra: object = {}) => ({ key, label, role, seq, declaration, ...extra });

export const PR01: TemplateDef = {
  code: 'PR-01', version: 1, title: 'Procurement Requisition',
  description: 'AfS-Rwa_PR-01. Starts a procurement case. The form alone does not authorize payment.',
  schema: { sections: [
    { key: 'request', title: 'Request', fields: [
      f.text('request_no', 'Request No.', { readonly: true, help: 'Generated when the case is created' }),
      f.date('date_of_request', 'Date of Request', { ...req, default: 'today' }),
      f.user('requested_by', 'Requested By', req),
      f.text('project_activity', 'Project / Activity', { ...req, maxLength: 200 }),
      f.date('required_by_date', 'Required By Date', { ...req, hint: 'Pick the date by which the goods or service are needed (on or after the date of request).' }),
      f.budget('budget_line', 'Budget Line / Cost Centre', req),
    ] },
    { key: 'items', title: 'Item / Service Specifications', fields: [
      f.table('items', 'Items requested', [
        f.textarea('description', 'Detailed description / technical specification', { ...req, hint: 'Describe the item and its technical specification (size, model, quantity unit ...).' }),
        f.number('qty', 'Qty', { ...req, min: 0, exclusive_min: true }),
        f.money('unit_cost', 'Unit Cost', req),
        f.money('est_unit_cost', 'Est. Unit Cost', req),
        f.computed('est_total', 'Est. Total', { op: 'mul', fields: ['qty', 'est_unit_cost'] }, { format: 'money' }),
      ], 1, 50, req),
    ] },
    { key: 'justification', title: 'Justification and Conditions', fields: [
      f.textarea('business_justification', 'Business Justification', { ...req, hint: 'Explain why the purchase is needed and which activity it supports.' }),
      f.text('suggested_supplier', 'Suggested Supplier (optional)'),
      f.checks('special_conditions', 'Special Conditions', ['Delivery', 'Installation', 'Warranty', 'Training'], { allow_other: true }),
    ] },
  ] },
  signature_slots: [
    slot('prepared_by', 'Prepared / Requested by', 'requesting_staff', 1, 'I confirm this requisition is accurate and needed for the activity named above.', { assign: 'creator' }),
    slot('received_checked', 'Received & Checked by Accountant', 'accountant', 2, 'I have checked the request and the budget line.'),
    slot('pi_initial', 'PI Initial Authorization', 'pi', 3, 'I authorize this requisition to proceed to quotation collection.'),
  ],
  workflow: { guards_on_submit: ['template_valid'], guards_on_sign: ['frozen_after_sign', 'no_duplicate_signature'], requires_conflict_confirmation: false,
    footer_note: 'This requisition alone does not authorize payment.' },
};

export const QC02: TemplateDef = {
  code: 'QC-02', version: 1, title: 'Supplier Quotation Collection Register',
  description: 'AfS-Rwa_QC-02. Minimum two comparable quotations with attached files.',
  schema: { sections: [
    { key: 'general', title: 'Request', fields: [
      f.caseRef('request_no', 'Request No.'),
      f.date('collection_date', 'Quotation Collection Date', { ...req, default: 'today' }),
      f.text('item_service', 'Item / Service', req),
    ] },
    { key: 'quotations', title: 'Quotations Received', description: 'Minimum requirement: at least two comparable supplier quotations must be attached.', fields: [
      f.table('quotations', 'Quotations received', [
        f.supplier('supplier', 'Supplier', req),
        f.text('tel', 'Tel', { ...req, check: { rule: 'phone' } }),
        f.text('email', 'Email', { ...req, check: { rule: 'email' } }),
        f.text('quote_ref', 'Quote Ref.', req),
        f.date('quote_date', 'Quote Date', req),
        f.money('total_price', 'Total Price', req),
        f.text('delivery', 'Delivery', { ...req, hint: 'Enter the delivery time or terms quoted, e.g. "5 days after order".' }),
        f.text('validity', 'Validity', { ...req, hint: 'Enter how long the quotation is valid, e.g. "30 days".' }),
        f.file('attachment', 'Attachment', { ...req, accept: ['application/pdf', 'image/png', 'image/jpeg'], hint: 'Upload the quotation received from this supplier (PDF, PNG or JPEG).' }),
      ], 2, 5, req),
    ] },
    { key: 'method', title: 'Collection Method and Declaration', fields: [
      f.checks('collection_method', 'Collection Method', ['Email', 'Written quotation', 'Supplier portal'], { ...req, allow_other: true }),
      f.radio('conflict_declaration', 'I confirm that any known relationship or conflict with a quoted supplier has been disclosed', [['yes', 'Yes'], ['n_a', 'N/A']], { ...req, hint: 'Choose Yes if a relationship or conflict was disclosed, N/A if there is none.' }),
      f.textarea('notes', 'Notes'),
    ] },
  ] },
  signature_slots: [
    slot('collected_by', 'Prepared / Collected by', 'accountant', 1, 'I collected these quotations and they are as received from the suppliers.'),
    slot('checked_by_accountant', 'Checked by Accountant', 'accountant', 2, 'I checked that the quotations are comparable.'),
    slot('requesting_staff_ack', 'Requesting Staff acknowledgement', 'requesting_staff', 3, 'I acknowledge receipt of the quotation register.', { assign: 'case_requester' }),
  ],
  workflow: { guards_on_submit: ['template_valid', 'min_quotations:2'], guards_on_sign: ['conflict_confirmed', 'frozen_after_sign', 'no_duplicate_signature'], requires_conflict_confirmation: true,
    footer_note: 'Quotations should be comparable in scope, specifications, taxes and delivery terms.' },
};

export const MPV03: TemplateDef = {
  code: 'MPV-03', version: 1, title: 'Market Price Verification',
  description: 'Optional step between quotation collection and evaluation.',
  schema: { sections: [
    { key: 'header', title: 'Verification Details', fields: [
      f.caseRef('procurement_request_no', 'Procurement Request No.'), f.date('mpv_date', 'MPV Date', { ...req, default: 'today' }),
      f.caseRef('project_activity', 'Project / Activity'), f.caseRef('item_service', 'Item / Service'), f.caseRef('requesting_staff', 'Requesting Staff'),
      f.user('staff_assigned', 'Staff Assigned to MPV', req),
      f.text('market_location_visited', 'Market / Location Visited', req),
    ] },
    { key: 'spec', title: 'A. Item / Service Specification to be Verified', fields: [
      f.table('spec_lines', 'Items to verify', [
        f.text('description', 'Detailed specification / description', req), f.number('qty', 'Qty', { ...req, min: 0, exclusive_min: true }),
        f.text('unit', 'Unit', { ...req, hint: 'Enter the unit of measure, e.g. pcs, box, kg, day.' }), f.money('quoted_price_benchmark', 'Quoted Price Benchmark', req),
      ], 1, 4, req),
    ] },
    { key: 'market', title: 'B. Physical Market Price Verification', fields: [
      f.table('market_checks', 'Outlets visited', [
        f.text('outlet', 'Supplier / Outlet Visited', req), f.text('location_contact', 'Location / Contact', req),
        f.yesno('item_available', 'Item Available?'), f.money('unit_price', 'Unit Price', req),
        f.yesno('taxes_included', 'Taxes Included?'), f.text('lead_time', 'Delivery / Lead Time'),
        f.file('evidence', 'Evidence / Ref.'), f.text('remarks', 'Remarks'),
      ], 1, 4, req),
    ] },
    { key: 'comparison', title: 'C. Comparison with Quotations Received', fields: [
      f.table('comparisons', 'Comparison', [
        f.text('quoted_supplier', 'Quoted Supplier', req), f.money('quotation_amount', 'Quotation Amount', req),
        f.text('verified_market_range', 'Verified Market Range'),
        f.computed('variance', 'Variance', { op: 'variance_mid', fields: ['quotation_amount', 'price_range_low', 'price_range_high'] }, { format: 'money', help: 'Quotation amount minus the middle of the observed market range' }),
        f.yesno('price_reasonable', 'Price Reasonable?'), f.text('comment', 'Comment'),
      ], 1, 4, req),
    ] },
    { key: 'findings', title: 'D. Market Verification Findings', fields: [
      f.money('price_range_low', 'Observed Market Price Range: Lowest', req), f.money('price_range_high', 'Observed Market Price Range: Highest', req),
      f.radio('market_availability', 'Market Availability', [['readily_available', 'Readily available'], ['limited_availability', 'Limited availability'], ['special_order_or_customized', 'Special order / customized']], req),
      f.radio('quotation_assessment', 'Quotation Assessment', ['Within market range', 'Below market range', 'Above market range', 'Not directly comparable'], req),
      f.textarea('finding_explanation', 'Finding / Explanation', req),
      f.radio('recommendation', 'Recommendation', [['proceed_with_evaluation', 'Proceed with quotation evaluation'], ['seek_clarification_or_negotiate', 'Seek clarification / negotiate price'], ['obtain_additional_quotations', 'Obtain additional quotation(s)'], ['repeat_verification', 'Repeat market verification']], { ...req, allow_other: true }),
      f.checks('attachment_types', 'Attachments / Evidence', [['supplier_price_list', 'Supplier price list'], ['proforma', 'Pro-forma / written quote'], ['business_card', 'Business card/contact'], ['photo', 'Photo (where permitted)']], { allow_other: true }),
      f.table('attachment_files', 'Attached files', [f.file('file', 'File')], 0, 5),
      f.yesno('verifier_declaration', 'Verifier Declaration: I confirm that the information recorded above reflects the market prices and conditions observed or directly obtained during this verification. I have disclosed any known conflict of interest and have not requested or accepted any benefit from suppliers contacted.', { ...req, hint: 'Choose Yes to make the verifier declaration. If you cannot, do not submit and tell the Accountant.' }),
    ] },
  ] },
  signature_slots: [
    slot('market_verification_officer', 'Market Verification Officer', 'market_verifier', 1, 'I verified these prices in person and declare no conflict of interest.'),
    slot('accountant_review', 'Accountant – Review / Cross-check', 'accountant', 2, 'I reviewed the market price verification.'),
    slot('requesting_staff_ack', 'Requesting Staff – Acknowledgement', 'requesting_staff', 3, 'I acknowledge the market price verification.', { assign: 'case_requester' }),
  ],
  workflow: { guards_on_submit: ['template_valid', 'price_range_ordered'], guards_on_sign: ['conflict_confirmed', 'frozen_after_sign', 'no_duplicate_signature'], requires_conflict_confirmation: true },
};

export const QE03: TemplateDef = {
  code: 'QE-03', version: 1, title: 'Quotation Evaluation, Supplier Recommendation and PO Authorization',
  description: 'Three different reviewers evaluate the quotations and recommend one supplier.',
  schema: { sections: [
    { key: 'general', title: 'Request', fields: [
      f.caseRef('request_no', 'Request No.'), f.date('evaluation_date', 'Evaluation Date', { ...req, default: 'today' }),
      f.caseRef('item_service', 'Item / Service'),
      f.caseRef('committee', 'Evaluation Committee', { help: 'Requesting Staff + Director of Communications + PI' }),
    ] },
    { key: 'comparison', title: 'Compliance & Commercial Comparison', description: 'One row per quotation, prefilled from QC-02.', fields: [
      f.table('comparison', 'Quotations compared', [
        f.supplier('supplier', 'Supplier', { ...req, hint: 'Choose a supplier listed in the signed quotation register (QC-02).' }), f.text('product_name', 'Service/Product Name', req),
        f.yesno('meets_specs', 'Meets Specs?', req), f.money('price', 'Price', req),
        f.text('delivery', 'Delivery', req), f.textarea('finding', 'Quality/ Experience & Overall Finding', req),
      ], 1, 7, req),
    ] },
    { key: 'recommendation', title: 'Recommendation', fields: [
      f.supplier('recommended_supplier', 'Recommended Supplier', { ...req, hint: 'Choose one of the suppliers compared in the table above.' }),
      f.money('recommended_amount', 'Recommended Amount', req),
      f.checks('reason_for_selection', 'Reason for Selection', [['lowest_compliant_price', 'Lowest compliant price'], ['best_value', 'Best value'], ['quality_or_technical_advantage', 'Quality/technical advantage'], ['delivery_advantage', 'Delivery advantage']], { ...req, allow_other: true }),
      f.textarea('evaluation_notes', 'Evaluation Notes & Authorization to Commit / Order', req),
    ] },
  ] },
  signature_slots: [
    slot('reviewer_1', 'Requesting Staff / Reviewer 1', 'requesting_staff', 1, 'I reviewed the quotations and confirm I have no undisclosed conflict of interest.', { group: 'eval', assign: 'case_requester' }),
    slot('reviewer_2', 'Director of Communications / Reviewer 2', 'director_comms', 1, 'I reviewed the quotations and confirm I have no undisclosed conflict of interest.', { group: 'eval' }),
    slot('reviewer_3', 'PI / Reviewer 3', 'pi', 1, 'I reviewed the quotations and confirm I have no undisclosed conflict of interest.', { group: 'eval' }),
  ],
  workflow: { guards_on_submit: ['template_valid', 'supplier_in_quotations', 'min_quotations:2'], guards_on_sign: ['reviewers_distinct', 'conflict_confirmed', 'frozen_after_sign', 'no_duplicate_signature'], requires_conflict_confirmation: true,
    footer_note: 'All three reviewers must be different people. If the requester is the Director or PI, a delegated authorized staff user signs that slot.' },
};

export const PO09: TemplateDef = {
  code: 'PO-09', version: 1, title: 'Purchase Order',
  description: 'Created only from a fully signed QE-03. Lines and supplier are copied, not retyped.',
  schema: { sections: [
    { key: 'header', title: 'A. Purchase Order & Procurement References', fields: [
      f.text('po_number', 'PO Number', { readonly: true }), f.date('issue_date', 'Issue Date', { ...req, default: 'today' }),
      f.caseRef('requisition_no', 'Requisition No.'), f.caseRef('project_activity', 'Project / Activity'),
      f.caseRef('budget_line', 'Budget Line / Cost Centre'), f.caseRef('requested_by', 'Requested By'),
      f.radio('currency', 'Currency', ['RWF', 'USD', 'EUR'], { ...req, allow_other: true }),
      f.checks('payment_terms', 'Payment Terms', [['bank_transfer', 'Bank Transfer'], ['mobile_money', 'Mobile Money'], ['momo_pay', 'MoMo Pay'], ['cash', 'Cash']], { ...req, allow_other: true }),
    ] },
    { key: 'supplier', title: 'B. Supplier Details', fields: [
      f.caseRef('supplier_name', 'Supplier / Company Name'), f.caseRef('tin_registration_no', 'TIN / Registration No.'),
      f.caseRef('contact_person_position', 'Contact Person / Position'), f.caseRef('telephone_email', 'Telephone / Email'),
      f.caseRef('quotation_ref_date', 'Supplier Quotation Ref. / Date'),
    ] },
    { key: 'lines', title: 'C. Goods / Services Ordered', fields: [
      f.table('lines', 'Goods / services ordered', [
        f.text('description', 'Item / Service Description', req), f.text('specification_scope', 'Specification / Scope', req),
        f.number('qty', 'Qty', { ...req, min: 0, exclusive_min: true }), f.text('unit', 'Unit', { ...req, hint: 'Enter the unit of measure, e.g. pcs, box, kg, day.' }), f.money('unit_price', 'Unit Price', req),
      ], 1, 50, req),
      f.computed('subtotal', 'Subtotal', { op: 'sum_mul', table: 'lines', fields: ['qty', 'unit_price'] }, { format: 'money' }),
      f.money('tax_vat', 'Tax / VAT', { ...req, hint: 'Enter the tax amount (0 if the quotation is tax exclusive or exempt).' }),
      f.computed('total_po_value', 'TOTAL PURCHASE ORDER VALUE', { op: 'add', fields: ['subtotal', 'tax_vat'] }, { format: 'money' }),
    ] },
  ] },
  signature_slots: [
    slot('issued_by', 'Prepared / Issued by Accountant or Procurement Focal Person', 'accountant', 1, 'I confirm this purchase order reflects the approved supplier, specifications and amount.'),
    slot('authorized_by_pi', 'Authorized by PI', 'pi', 2, 'I authorize AfS-Rwanda to place this order subject to the terms stated herein.'),
  ],
  workflow: { guards_on_submit: ['template_valid', 'po_from_approved_eval', 'amount_matches_evaluation'], guards_on_sign: ['frozen_after_sign', 'no_duplicate_signature'], requires_conflict_confirmation: false },
};

export const PA04: TemplateDef = {
  code: 'PA-04', version: 1, title: 'Purchase / Service Payment Final Compliance Approval',
  description: 'Payment only after verified delivery and a supporting invoice, except an approved advance arrangement.',
  schema: { sections: [
    { key: 'order', title: 'Purchase / Service', fields: [
      f.caseRef('request_no', 'Request No.'), f.caseRef('selected_supplier', 'Selected Supplier'),
      f.caseRef('approved_purchase_service', 'Approved Purchase / Service'), f.caseRef('approved_amount', 'Approved Amount'),
      f.caseRef('po_contract_ref', 'Purchase Order / Contract Ref.'), f.date('expected_delivery_completion', 'Expected Delivery / Completion', req),
    ] },
    { key: 'controls', title: 'Pre-Purchase Control', fields: [
      f.yesno('ctrl_requisition_attached', 'Approved requisition attached', { readonly: true }), f.text('ctrl_requisition_attached_comment', 'Reference / Comment'),
      f.yesno('ctrl_two_quotations', 'At least two quotations attached', { readonly: true }), f.text('ctrl_two_quotations_comment', 'Reference / Comment'),
      f.yesno('ctrl_evaluation_signed', 'Signed quotation evaluation attached', { readonly: true }), f.text('ctrl_evaluation_signed_comment', 'Reference / Comment'),
      f.yesno('ctrl_budget_confirmed', 'Budget availability confirmed', { ...req, hint: 'The Accountant checks the budget line and chooses Yes when funds are available.' }), f.text('ctrl_budget_confirmed_comment', 'Reference / Comment'),
      f.yesno('ctrl_supplier_details_verified', 'Supplier/payment details verified', req), f.text('ctrl_supplier_details_verified_comment', 'Reference / Comment'),
    ] },
    { key: 'delivery', title: 'Goods / Service Receipt & Payment Verification', fields: [
      f.date('delivery_completion_date', 'Delivery / Completion Date', req),
      f.text('invoice_no', 'Invoice No.', req), f.date('invoice_date', 'Invoice Date', req),
      f.text('delivery_note_ref', 'Receipt / Delivery Note Ref.', req), f.file('delivery_note_file', 'Receipt / delivery note file', req),
      f.radio('acceptance', 'Acceptance', [['received_in_full_and_conform', 'Goods/services received in full and conform to approved specifications'], ['exception_noted', 'Exception noted']], req),
      f.textarea('exception_text', 'Exception noted', { required_if: when('acceptance', { equals: 'exception_noted' }), visible_if: when('acceptance', { equals: 'exception_noted' }), hint: 'Describe what was missing, late or not as specified.' }),
      f.money('amount_payable', 'Amount Payable', req), f.text('payment_method_ref', 'Payment Method / Ref.', req),
    ] },
  ] },
  signature_slots: [
    slot('received_verified', 'Received / Verified by Requesting Staff', 'requesting_staff', 1, 'I confirm the goods or services were received as described.', { assign: 'case_requester' }),
    slot('payment_prepared', 'Accountant – payment prepared', 'accountant', 2, 'I prepared this payment and confirm the controls above.'),
    slot('final_approval', 'Chief Finance Manager', 'cfm', 3, 'I approve this payment.'),
  ],
  workflow: { guards_on_submit: ['template_valid', 'budget_confirmed', 'amount_within_approved'], guards_on_sign: ['payment_after_delivery', 'frozen_after_sign', 'no_duplicate_signature'], requires_conflict_confirmation: false,
    footer_note: 'Payment only after verified delivery and supporting invoice, except an approved advance arrangement.' },
};
