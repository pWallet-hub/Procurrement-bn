import { TemplateDef } from '../types';
import { f, req, when } from './dsl';

const travel = when('request_types', { includes: 'local_travel_or_field_work' });
const goods = when('request_types', { includes: 'office_supplies' });

export const GR06: TemplateDef = {
  code: 'GR-06', version: 1, title: 'General Requisition and Activity Support Request',
  description: 'Authorization request for activity support. Does not replace procurement procedures where thresholds or competitive sourcing apply.',
  schema: { sections: [
    { key: 'request', title: 'A. Request Information', fields: [
      f.text('project_activity', 'Project / Activity', req), f.budget('budget_line', 'Budget Line / Cost Centre', req),
      f.textarea('purpose_justification', 'Purpose / Justification', req),
    ] },
    { key: 'type', title: 'B. Type of Request — Tick the applicable category', fields: [
      f.checks('request_types', 'Type of request', [['office_supplies', 'Office supplies'], ['incidental_fees', 'Incidental fees'], ['accommodation', 'Accommodation'], ['per_diems', 'Per diems'], ['local_travel_or_field_work', 'Local travel / field work'], ['international_travel', 'International travel']], { ...req, allow_other: true }),
      f.textarea('noted_details', 'Noted Details'),
      f.money('estimated_total', 'Estimated Total amount', { ...req, hint: 'Enter the total expected cost. It must cover the items in section C.' }),
    ] },
    { key: 'items', title: 'C. Office Supplies / Fees Details — Complete where applicable', fields: [
      f.table('items', 'Items / fees', [
        f.text('description', 'Item / Fee Description', req), f.text('specification_purpose', 'Specification / Purpose'),
        f.number('qty', 'Qty', { ...req, min: 0, exclusive_min: true }), f.money('unit_cost', 'Unit Cost', req),
        f.computed('est_total', 'Estimated Total', { op: 'mul', fields: ['qty', 'unit_cost'] }, { format: 'money' }),
      ], 1, 50, { required_if: goods, hint: 'You ticked Office supplies: add at least one item with the "Add row" button.' }),
    ] },
    { key: 'travel', title: 'D. Travel / Transport Budget Request — Complete where applicable', visible_if: when('request_types', { includes: 'local_travel_or_field_work' }), fields: [
      f.radio('travel_category', 'Travel Category', [['within_30_km', 'Within 30 km radius of office'], ['beyond_70_km', 'Beyond 70 km radius of office']], { required_if: travel, help: 'Distance control: select the category that reflects the approved official journey. Where a journey falls between 30 km and 70 km, the approving authority should classify it under the applicable travel rule that includes accommodation where applicable before authorization.' }),
      f.textarea('travelers', 'Traveler(s) NAME', { required_if: travel }), f.file('team_list_file', 'List of Traveling Team Attached'),
      f.text('destination', 'Destination', { required_if: travel }),
      f.date('departure_date', 'Departure Date', { required_if: travel }), f.time('departure_time', 'Departure Time', { required_if: travel }),
      f.checks('transport', 'Transport Requested', [['office_vehicle', 'Office vehicle'], ['taxi_ride', 'Taxi Ride'], ['public_transport', 'Public transport'], ['hired_vehicle', 'Hired vehicle'], ['motorcycle', 'Motorcycle'], ['mileage_or_fuel_support', 'Mileage/fuel support']], { allow_other: true, required_if: travel }),
    ] },
    { key: 'funds', title: 'F. Finance / Administration Action', fields: [
      f.checks('funds_action', 'Funds Service Issued', [['cash_advance', 'Cash advance'], ['direct_payment', 'Direct payment'], ['vehicle_fuel_transport_arranged', 'Vehicle/Fuel/Transport Arranged'], ['supplier_s_invoice_cover', "Supplier's Invoice Cover"]], { fill_at: 'processed_by', required: true }),
    ] },
  ] },
  signature_slots: [
    { key: 'prepared_by', label: 'Requested / Prepared by', role: 'requesting_staff', seq: 1, declaration: 'I confirm this request is accurate.', assign: 'creator' },
    { key: 'accountant_budget_check', label: 'Accountant — Budget & Control Check', role: 'accountant', seq: 2, declaration: 'I checked the budget line.' },
    { key: 'director_activity_review', label: 'Director of Department — Activity Reviewer', role: 'director_dept', seq: 3, declaration: 'I reviewed the activity.' },
    { key: 'pi_final_authorization', label: 'PI — Final Authorization', role: 'pi', seq: 4, declaration: 'I authorize this request.' },
    { key: 'processed_by', label: 'Processed By', role: 'accountant', seq: 5, declaration: 'I processed the finance action recorded above.' },
  ],
  workflow: { guards_on_submit: ['template_valid'], guards_on_sign: ['frozen_after_sign', 'no_duplicate_signature', 'distance_notice'], requires_conflict_confirmation: false,
    footer_note: 'This form is an authorization request and does not replace procurement procedures where thresholds or competitive sourcing apply.' },
};

export const IM08: TemplateDef = {
  code: 'IM-08', version: 1, title: 'Internal Memorandum: Issue, Recommendation and Management Decision',
  description: 'Does not replace procurement, finance, HR, contracting or safeguarding approvals.',
  schema: { sections: [
    { key: 'memo', title: 'A. Memo Originator', fields: [
      f.text('memo_reference_name', 'Memo Reference Name', req), f.text('department_office', 'Department/ Office', req),
      f.date('date_submitted', 'Date Submitted', { readonly: true }), f.text('version', 'Version', { readonly: true, default: '1.0' }),
    ] },
    { key: 'issue', title: 'B. Issue Requiring Attention', fields: [
      f.textarea('issue_description', 'Describe the issue, background, urgency, operational implication, and any relevant facts or supporting references', req),
      f.textarea('recommendation', 'Originating staff recommendation: proposed solution / recommendation and reason for the proposed course of action', req),
    ] },
    { key: 'decision', title: 'C. Superior / Management Review, Advice & Decision', description: 'Filled by the superior when the memo reaches the decision step.', fields: [
      f.textarea('decision_advice', 'Advice / Management Recommendation/ Decision', { fill_at: 'superior' }),
      f.radio('decision_status', 'Decision Status', ['Approved', 'Approved with conditions', 'Further information required', 'Not approved'], { fill_at: 'superior', required: true }),
      f.radio('priority', 'Priority / Required Completion', ['Immediate', 'High', 'Routine'], { fill_at: 'superior', required: true }),
      f.date('target_date', 'Target date', { fill_at: 'superior' }),
      f.checks('action_types', 'Action type', [['internal_administrative_action', 'Internal Administrative Action'], ['procurement_process', 'Procurement Process'], ['single_source_justification_or_approval', 'Single-Source Justification / Approval'], ['consultant_or_professional_expert', 'Consultant / Professional Expert'], ['service_provider', 'Service Provider'], ['goods_or_supplies', 'Goods / Supplies']], { allow_other: true, fill_at: 'superior', required: true }),
      f.file('single_source_justification', 'Single-source justification', { fill_at: 'superior', required_if: when('action_types', { includes: 'single_source_justification_or_approval' }), visible_if: when('action_types', { includes: 'single_source_justification_or_approval' }), hint: 'Upload the written single-source justification (PDF) before approving.' }),
    ] },
    { key: 'followup', title: 'D. Staff to be Notified / Responsible for Next Action', fields: [
      f.table('follow_up', 'Staff to be notified', [
        f.user('staff', 'Name / Position', req), f.text('action_assigned', 'Action / Responsibility Assigned', req), f.date('due_date', 'Notification / Due Date', req),
      ], 1, 3, { ...req, fill_at: 'superior' }),
    ] },
  ] },
  signature_slots: [
    { key: 'originating_staff', label: 'Originating Staff Signature', role: 'requesting_staff', seq: 1, declaration: 'I submit this memo.', assign: 'creator' },
    { key: 'superior', label: 'Superior Staff', role: 'superior', seq: 2, declaration: 'This is my decision on the memo.' },
  ],
  workflow: { guards_on_submit: ['template_valid'], guards_on_sign: ['single_source_requires_justification', 'frozen_after_sign', 'no_duplicate_signature'], requires_conflict_confirmation: false,
    footer_note: 'This memo does not replace procurement, finance, HR, contracting or safeguarding approvals.' },
};

const CLAUSES = {
  contractor: 'Contractor Alliance for Science Rwanda (AfS-Rwanda), the principal implementer of the Open Forum on Agricultural Biotechnology (OFAB) Rwanda Chapter, hereinafter referred to as "AfS-Rwanda"',
  value: 'The total value of this contract is to be determined based on the services and materials provided and agreed upon by both parties prior to the commencement of work. All payments will be made on a tax-exclusive basis.',
  tax: 'This contract is signed under full tax-exclusive conditions, meaning that the Supplier reserves the rights and obligations to self-declare any applicable consultancy service tax. AfS-Rwanda will not be responsible for withholding or remitting any taxes on behalf of the Supplier. The Service Supplier is solely responsible for complying with all tax obligations, including VAT, income tax, or any other related taxes as required by Rwandan law.',
  payment: 'AfS-Rwanda agrees to pay {advance_percent}% of the total cost of service to the Supplier within {advance_days} of days upon receipt and approval of agreeable quotations via a proforma invoice to be attached to this contract. The rest of {balance_percent}% is to be paid after the final invoice and completion of all deliverables. Invoices must clearly reflect the tax-excluded amounts on all service-related charges and be accompanied by the necessary supporting documents for each corresponding product invoice with a VAT complying invoice on aggregable list of products.',
  delivery: 'The Supplier agrees to deliver all services and materials as per the agreed timeline. Any delays must be communicated to AfS-Rwanda in advance and may be subject to penalties as outlined in a separate service-level agreement, if applicable.',
  liability: 'The Supplier assumes full responsibility for the quality, accuracy, and timeliness of the services and materials provided under this contract. Any damages or losses incurred due to non-compliance with the contract terms will be borne by the Supplier',
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
      f.money('contract_value', 'Contract Value', { readonly: true, help: CLAUSES.value }),
      f.number('advance_percent', 'Advance payment %', { ...req, min: 0, max: 100, default: 50 }),
      f.number('advance_days', 'Advance payment within (days)', { ...req, min: 1, default: 2 }),
    ] },
    { key: 'clauses', title: 'Fixed clauses', description: `Payment Terms: ${CLAUSES.payment}\n\nTax Declaration: ${CLAUSES.tax}\n\nDelivery and Deadlines: ${CLAUSES.delivery}\n\nLiability: ${CLAUSES.liability}\n\nConfidentiality: ${CLAUSES.confidentiality}\n\nAcceptance: ${CLAUSES.acceptance}`, fields: [] },
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
      f.text('id_number', 'ID', { ...req, maxLength: 30, check: { rule: 'id_document', type_field: 'id_type' }, help: 'Rwanda national ID: 16 digits. Passport: 6 to 9 letters or digits.' }),
      f.text('account_number', 'Account number', { ...req, hint: 'Enter the bank account number the mission allowance is paid to.' }), f.text('function', 'Function', req),
    ] },
    { key: 'mission', title: 'Mission', fields: [
      f.text('program', '5. Program', req), f.budget('funding', '6. Funding (budget line)', req),
      f.textarea('expected_results', '7. Expected results', req), f.textarea('purpose', '8. Purpose of the mission', req),
      f.user('supervisor', '9. Supervisor who proposed the mission', { ...req, help: 'This person confirms the mission after you submit.' }),
      f.text('destination', '10. Destination', req),
      f.date('departure_date', '11. Date of departure', req), f.text('departure_place', '11. Place of departure', req),
      f.date('return_date', '12. Returning date', req),
      f.number('duration_days', '13. Duration (days)', { ...req, min: 1, hint: 'Count the days from departure to return, both included.' }),
      f.checks('transport', '14. Means of transport', ['Office vehicle', 'Public transport', 'Hired vehicle', 'Taxi ride', 'Air travel'], { ...req, allow_other: true }),
      f.text('issued_at', 'Issued at', req),
    ] },
    { key: 'costs', title: 'Mission Costs', description: 'Filled by an administrator only: while creating the clearance, or at the costs step after the supervisor confirms the mission.', fields: [
      f.money('allowance_per_day', '15. Mission allowance per day', { required: true, fill_at: 'admin_costs' }),
      f.money('accommodation_per_day', '16. Accommodation & incidental per day', { required: true, fill_at: 'admin_costs' }),
      f.money('transport_cost', 'Transport cost (whole mission)', { required: true, fill_at: 'admin_costs', help: 'Fares, fuel or vehicle hire for the whole trip, there and back.', hint: 'Enter the total transport cost of the trip. Enter 0 when the office vehicle is used at no extra cost.' }),
      f.text('transport_details', 'Transport details', { fill_at: 'admin_costs', maxLength: 200, help: 'e.g. bus fare Kigali–Musanze return ×2, fuel for the office vehicle' }),
      f.computed('total_amount', '17. Total amount', { op: 'add_times', fields: ['allowance_per_day', 'accommodation_per_day'], field: 'duration_days', plus: ['transport_cost'] }, { format: 'money', help: '(15 + 16) × duration + transport', fill_at: 'admin_costs' }),
    ] },
    { key: 'host_visa', title: 'Visa of Hosting Institution', description: 'Left blank: the hosting institution fills this in by hand and stamps the printed clearance.', fields: [
      f.textarea('host_authorized', 'Authorized Name, Signature & Stamp', { readonly: true }),
      f.text('host_arrival_date', 'Arrival date', { readonly: true }), f.text('host_departure_date', 'Departure date', { readonly: true }),
    ] },
  ] },
  signature_slots: [
    { key: 'traveller', label: 'Traveller (requested by)', role: 'requesting_staff', seq: 1, declaration: 'I request this travel clearance and confirm the details are accurate.', assign: 'creator' },
    { key: 'supervisor', label: 'Supervisor who proposed the mission', role: 'director_dept', seq: 2, declaration: 'I proposed this mission and confirm its purpose.', assign: 'field:supervisor' },
    { key: 'admin_costs', label: 'Costs entered by (Administrator)', role: 'admin', seq: 3, declaration: 'I entered the mission allowance, accommodation and transport costs (items 15 to 17).', draft_fill: true },
    { key: 'funding_check', label: 'Funding checked by (Accountant)', role: 'accountant', seq: 4, declaration: 'I checked the funding line and the amounts.' },
    { key: 'approved_by', label: 'Approved By', role: 'pi', seq: 5, declaration: 'I approve this mission.' },
  ],
  workflow: { guards_on_submit: ['template_valid', 'travel_clearance_valid'], guards_on_sign: ['frozen_after_sign', 'no_duplicate_signature'], requires_conflict_confirmation: false },
};
