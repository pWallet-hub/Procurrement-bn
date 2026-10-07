import { TemplateDef } from '../types';
import { f, req, when } from './dsl';

const travel = when('request_types', { includes: 'local_travel_or_field_work' });
const goods = when('request_types', { includes: 'office_supplies' });

export const GR06: TemplateDef = {
  code: 'GR-06', version: 1, title: 'General Requisition and Activity Support Request',
  description: 'Authorization request for activity support. Does not replace procurement procedures where thresholds or competitive sourcing apply.',
  schema: { sections: [
    { key: 'request', title: 'A. Request Information', fields: [
      f.text('project_activity', 'Project / activity', req), f.budget('budget_line', 'Budget line / cost centre', req),
      f.textarea('purpose_justification', 'Purpose / justification', req),
    ] },
    { key: 'type', title: 'B. Type of Request — Tick the applicable category', fields: [
      f.checks('request_types', 'Type of request', ['Office supplies', 'Incidental fees', 'Accommodation', 'Per diems', 'Local travel or field work', 'International travel'], { ...req, allow_other: true }),
      f.textarea('noted_details', 'Noted details'),
      f.money('estimated_total', 'Estimated total', req),
    ] },
    { key: 'items', title: 'C. Office Supplies / Fees Details — Complete where applicable', fields: [
      f.table('items', 'Items', [
        f.text('description', 'Description', req), f.text('specification_purpose', 'Specification / purpose'),
        f.number('qty', 'Qty', { ...req, min: 0, exclusive_min: true }), f.money('unit_cost', 'Unit cost', req),
        f.computed('est_total', 'Est. total', { op: 'mul', fields: ['qty', 'unit_cost'] }, { format: 'money' }),
      ], 1, 50, { required_if: goods }),
    ] },
    { key: 'travel', title: 'D. Travel / Transport Budget Request — Complete where applicable', visible_if: when('request_types', { includes: 'local_travel_or_field_work' }), fields: [
      f.radio('travel_category', 'Distance', ['Within 30 km', 'Beyond 70 km'], { required_if: travel, help: 'Journeys between 30 and 70 km: the approver sees the distance control note before authorizing.' }),
      f.textarea('travelers', 'Traveling team', { required_if: travel }), f.file('team_list_file', 'Team list (attachment)'),
      f.text('destination', 'Destination', { required_if: travel }),
      f.date('departure_date', 'Departure date', { required_if: travel }), f.time('departure_time', 'Departure time', { required_if: travel }),
      f.checks('transport', 'Transport', ['Office vehicle', 'Taxi ride', 'Public transport', 'Hired vehicle', 'Motorcycle', 'Mileage or fuel support'], { allow_other: true, required_if: travel }),
    ] },
    { key: 'funds', title: 'F. Finance / Administration Action', fields: [
      f.checks('funds_action', 'Funds action', ['Cash advance', 'Direct payment', 'Vehicle / fuel / transport arranged', "Supplier's invoice cover"], { fill_at: 'processed_by', required: true }),
    ] },
  ] },
  signature_slots: [
    { key: 'prepared_by', label: 'Prepared by', role: 'requesting_staff', seq: 1, declaration: 'I confirm this request is accurate.', assign: 'creator' },
    { key: 'accountant_budget_check', label: 'Budget check (Accountant)', role: 'accountant', seq: 2, declaration: 'I checked the budget line.' },
    { key: 'director_activity_review', label: 'Activity review (Director of Department)', role: 'director_dept', seq: 3, declaration: 'I reviewed the activity.' },
    { key: 'pi_final_authorization', label: 'Final authorization (PI)', role: 'pi', seq: 4, declaration: 'I authorize this request.' },
    { key: 'processed_by', label: 'Processed by (finance action)', role: 'accountant', seq: 5, declaration: 'I processed the finance action recorded above.' },
  ],
  workflow: { guards_on_submit: ['template_valid'], guards_on_sign: ['frozen_after_sign', 'no_duplicate_signature', 'distance_notice'], requires_conflict_confirmation: false,
    footer_note: 'This form is an authorization request and does not replace procurement procedures where thresholds or competitive sourcing apply.' },
};

export const IM08: TemplateDef = {
  code: 'IM-08', version: 1, title: 'Internal Memorandum: Issue, Recommendation and Management Decision',
  description: 'Does not replace procurement, finance, HR, contracting or safeguarding approvals.',
  schema: { sections: [
    { key: 'memo', title: 'Memo', fields: [
      f.text('memo_reference_name', 'Memo reference / name', req), f.text('department_office', 'Department / office', req),
      f.date('date_submitted', 'Date submitted', { readonly: true }), f.text('version', 'Version', { readonly: true, default: '1.0' }),
      f.textarea('issue_description', 'Issue, background, urgency, operational implication, references', req),
      f.textarea('recommendation', 'Recommendation: proposed solution and reason', req),
    ] },
    { key: 'decision', title: 'C. Superior Guidance and Management Decision', description: 'Filled by the superior when the memo reaches the decision step.', fields: [
      f.textarea('decision_advice', 'Decision / advice', { fill_at: 'superior' }),
      f.radio('decision_status', 'Decision', ['Approved', 'Approved with conditions', 'Further information required', 'Not approved'], { fill_at: 'superior', required: true }),
      f.radio('priority', 'Priority', ['Immediate', 'High', 'Routine'], { fill_at: 'superior', required: true }),
      f.date('target_date', 'Target date', { fill_at: 'superior' }),
      f.checks('action_types', 'Action type', ['Internal administrative action', 'Procurement process', 'Single source justification or approval', 'Consultant or professional expert', 'Service provider', 'Goods or supplies'], { allow_other: true, fill_at: 'superior', required: true }),
      f.file('single_source_justification', 'Single source justification', { fill_at: 'superior', required_if: when('action_types', { includes: 'single_source_justification_or_approval' }), visible_if: when('action_types', { includes: 'single_source_justification_or_approval' }) }),
    ] },
    { key: 'followup', title: 'D. Follow-up Action', fields: [
      f.table('follow_up', 'Follow-up actions', [
        f.user('staff', 'Staff', req), f.text('action_assigned', 'Action assigned', req), f.date('due_date', 'Due date', req),
      ], 1, 3, { ...req, fill_at: 'superior' }),
    ] },
  ] },
  signature_slots: [
    { key: 'originating_staff', label: 'Originating staff', role: 'requesting_staff', seq: 1, declaration: 'I submit this memo.', assign: 'creator' },
    { key: 'superior', label: 'Superior (decision)', role: 'superior', seq: 2, declaration: 'This is my decision on the memo.' },
  ],
  workflow: { guards_on_submit: ['template_valid'], guards_on_sign: ['single_source_requires_justification', 'frozen_after_sign', 'no_duplicate_signature'], requires_conflict_confirmation: false,
    footer_note: 'This memo does not replace procurement, finance, HR, contracting or safeguarding approvals.' },
};

const CLAUSES = {
  contractor: 'Contractor Alliance for Science Rwanda (AfS -Rwanda), the principal implementer of the Open Forum on Agricultural Biotechnology (OFAB) Rwanda Chapter, hereinafter referred to as "AfS -Rwanda"',
  value: 'The total value of this contract is to be determined based on the services and materials provided and agreed upon by both parties prior to the commencement of work. All payments will be made on a tax-exclusive basis.',
  tax: 'This contract is signed under full tax -exclusive conditions, meaning that the Supplier reserves the rights and obligations to self -declare any applicable consultancy service tax. AfS -Rwanda will not be responsible for withholding or remitting any taxes on behalf of the Supplier. The Service Supplier is solely responsible for complying with all tax obligations, including VAT, income tax, or any other related taxes as required by Rwandan law.',
  payment: 'AfS-Rwanda agrees to pay {advance_percent}% of the total cost of service to the Supplier within {advance_days} of days upon receipt and approval of agreeable quotations via a proforma invoice to be attached to this contract. The rest of {balance_percent}% is to be paid after the final invoice and completion of all deliverables. Invoices must clearly reflect the tax -excluded amounts on all service -related charges and be accompanied by the necessary supporting documents for each corresponding product invoice with a VAT complying invoice on aggregable list of products.',
  delivery: 'The Supplier agrees to deliver all services and materials as per the agreed timeline. Any delays must be communicated to AfS-Rwanda in advance and may be subject to penalties as outlined in a separate service -level agreement, if applicable.',
  liability: 'The Supplier assumes full responsibility for the quality, accuracy, and timeliness of the services and materials provided under this contract. Any damages or losses incurred due to non -compliance with the contract terms will be borne by the Supplier',
  confidentiality: 'The Supplier agrees to maintain confidentiality regarding all information and materials related to this contract, except where disclosure is necessary for the execution of the services.',
  acceptance: 'By signing this contract, the Supplier agrees to the terms and conditions outlined above. This contract becomes effective upon the signature of both parties.',
};
export const CONTRACT_CLAUSES = CLAUSES;

export const CONTRACT: TemplateDef = {
  code: 'CONTRACT', version: 1, title: 'Financial Contract for the Provision of Event Management Service Tools, Communication Materials, and Other Supplies',
  description: 'Generated from the case and approved PO. The supplier signs through a single use link. Clause wording follows the printed template.',
  schema: { sections: [
    { key: 'parties', title: 'Parties', description: `This financial contract is made between ${CLAUSES.contractor}`, fields: [
      f.supplier('supplier', 'Supplier', { ...req, readonly: true }),
      f.caseRef('supplier_address', "Supplier's address"), f.caseRef('supplier_email', "Supplier's e-mail"),
      f.caseRef('supplier_telephone', "Supplier's telephone"), f.caseRef('supplier_tin', 'TIN number or ID no.'),
    ] },
    { key: 'scope', title: 'Scope of Services', description: 'The Supplier agrees to provide the following services and/or materials to AfS-Rwanda:', fields: [
      f.table('scope', 'Scope', [f.text('col1', 'Service / material', req), f.text('col2', 'Description'), f.text('col3', 'Quantity / deliverable')], 1, 50, req),
    ] },
    { key: 'terms', title: 'Terms', fields: [
      f.money('contract_value', 'Contract value', { readonly: true, help: CLAUSES.value }),
      f.number('advance_percent', 'Advance payment %', { ...req, min: 0, max: 100, default: 50 }),
      f.number('advance_days', 'Advance payment within (days)', { ...req, min: 1, default: 2 }),
    ] },
    { key: 'clauses', title: 'Fixed clauses', description: `Tax Declaration: ${CLAUSES.tax}\n\nPayment Terms: ${CLAUSES.payment}\n\nDelivery and Deadlines: ${CLAUSES.delivery}\n\nLiability: ${CLAUSES.liability}\n\nConfidentiality: ${CLAUSES.confidentiality}\n\nAcceptance: ${CLAUSES.acceptance}`, fields: [] },
  ] },
  signature_slots: [
    { key: 'afs_signatory', label: 'For AfS-Rwanda', role: 'pi', seq: 1, declaration: 'I sign this contract on behalf of AfS-Rwanda.' },
    { key: 'supplier_signatory', label: 'For the Supplier', role: 'supplier', seq: 2, declaration: 'By signing this contract, the Supplier agrees to the terms and conditions outlined above.', external: true },
  ],
  workflow: { guards_on_submit: ['template_valid'], guards_on_sign: ['frozen_after_sign', 'no_duplicate_signature'], requires_conflict_confirmation: false },
};

const internal = when('traveller_type', { equals: 'internal_afs_staff' });
const external = when('traveller_type', { equals: 'external' });

export const TC10: TemplateDef = {
  code: 'TC-10', version: 1, title: 'Travel Clearance',
  description: 'Completed by an AfS-Rwanda employee travelling on a work mission. The hosting institution stamps the printed clearance on arrival and departure.',
  schema: { sections: [
    { key: 'traveller', title: 'Traveller', fields: [
      f.radio('traveller_type', 'Traveller', ['Internal (AfS staff)', 'External'], { ...req, default: 'internal_afs_staff' }),
      f.user('issued_to', 'Issued to Mr/Mrs/Ms', { required_if: internal, visible_if: internal }),
      f.text('issued_to_name', 'Issued to Mr/Mrs/Ms (full name)', { required_if: external, visible_if: external, maxLength: 120 }),
      f.radio('id_type', 'ID type', ['Rwanda national ID', 'Passport'], req),
      f.text('id_number', 'ID / passport number', { ...req, maxLength: 30, check: { rule: 'id_document', type_field: 'id_type' }, help: 'Rwanda national ID: 16 digits. Passport: 6 to 9 letters or digits.' }),
      f.text('account_number', 'Account number', req), f.text('function', 'Function', req),
    ] },
    { key: 'mission', title: 'Mission', fields: [
      f.text('program', '5. Program', req), f.budget('funding', '6. Funding (budget line)', req),
      f.textarea('expected_results', '7. Expected results', req), f.textarea('purpose', '8. Purpose of the mission', req),
      f.user('supervisor', '9. Supervisor who proposed the mission', { ...req, help: 'This person confirms the mission after you submit.' }),
      f.text('destination', '10. Destination', req),
      f.date('departure_date', '11. Date of departure', req), f.text('departure_place', '11. Place of departure', req),
      f.date('return_date', '12. Returning date', req),
      f.number('duration_days', '13. Duration (days)', { ...req, min: 1 }),
      f.checks('transport', '14. Means of transport', ['Office vehicle', 'Public transport', 'Hired vehicle', 'Taxi ride', 'Air travel'], { ...req, allow_other: true }),
      f.text('issued_at', 'Issued at', req),
    ] },
    { key: 'costs', title: 'Costs', description: 'Filled by the administrator at the costs step, after the supervisor confirms the mission.', fields: [
      f.money('allowance_per_day', '15. Mission allowance per day', { required: true, fill_at: 'admin_costs' }),
      f.money('accommodation_per_day', '16. Accommodation & incidental per day', { required: true, fill_at: 'admin_costs' }),
      f.computed('total_amount', '17. Total amount', { op: 'add_times', fields: ['allowance_per_day', 'accommodation_per_day'], field: 'duration_days' }, { format: 'money', help: '(15 + 16) × duration', fill_at: 'admin_costs' }),
    ] },
    { key: 'host_visa', title: 'Visa of Hosting Institution', description: 'Left blank: the hosting institution fills this in by hand and stamps the printed clearance.', fields: [
      f.textarea('host_authorized', 'Authorized name, signature & stamp', { readonly: true }),
      f.text('host_arrival_date', 'Arrival date', { readonly: true }), f.text('host_departure_date', 'Departure date', { readonly: true }),
    ] },
  ] },
  signature_slots: [
    { key: 'traveller', label: 'Requested by', role: 'requesting_staff', seq: 1, declaration: 'I request this travel clearance and confirm the details are accurate.', assign: 'creator' },
    { key: 'supervisor', label: 'Supervisor who proposed the mission', role: 'director_dept', seq: 2, declaration: 'I proposed this mission and confirm its purpose.', assign: 'field:supervisor' },
    { key: 'admin_costs', label: 'Costs (Administrator)', role: 'admin', seq: 3, declaration: 'I entered the mission allowance and accommodation rates (items 15 to 17).' },
    { key: 'funding_check', label: 'Funding check (Accountant)', role: 'accountant', seq: 4, declaration: 'I checked the funding line and the amounts.' },
    { key: 'approved_by', label: 'Approved by', role: 'pi', seq: 5, declaration: 'I approve this mission.' },
  ],
  workflow: { guards_on_submit: ['template_valid', 'travel_clearance_valid'], guards_on_sign: ['frozen_after_sign', 'no_duplicate_signature'], requires_conflict_confirmation: false },
};
