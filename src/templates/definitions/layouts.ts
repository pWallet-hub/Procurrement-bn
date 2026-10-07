import { PaperBlock, PaperCell } from '../paper-layout';

/**
 * Printed layout of each form, copied from the reference forms in docs/reference-forms (the source of truth):
 * same section headings, label wording, row / column arrangement, check boxes and sign-off boxes.
 * Markup of the cell text: see src/templates/paper-layout.ts.
 */

const L = (c: string, o: Partial<PaperCell> = {}): PaperCell => ({ c, label: true, ...o });
const V = (c: string, o: Partial<PaperCell> = {}): PaperCell => ({ c, ...o });
const H = (c: string, o: Partial<PaperCell> = {}): PaperCell => ({ c, head: true, ...o });
const kv = (rows: [string, string][], cols = [32, 68], o: Partial<Extract<PaperBlock, { t: 'grid' }>> = {}): PaperBlock =>
  ({ t: 'grid', cols, rows: rows.map(([l, v]) => [L(l), V(v)]), ...o });
const blue = (text: string): PaperBlock => ({ t: 'heading', text, style: 'blue' });
const caps = (text: string): PaperBlock => ({ t: 'heading', text, style: 'caps' });
const note = (text: string): PaperBlock => ({ t: 'text', text, style: 'note' });

const PR01: PaperBlock[] = [
  kv([
    ['Request No.', '{request_no}'],
    ['Date of Request', 'Date: {date_of_request}'],
    ['Requested By', '{requested_by}'],
    ['Project / Activity', '{project_activity}'],
    ['Required By Date', 'Date: {required_by_date}'],
    ['Budget Line / Cost Centre', '{budget_line}'],
  ]),
  blue('Item / Service Specifications'),
  { t: 'items', field: 'items', rows: 5, cols: [
    { label: 'Detailed description / technical specification', w: 30, c: '{description}' },
    { label: 'Qty', w: 11, c: '{qty}', align: 'right' },
    { label: 'Unit Cost', w: 13, c: '{unit_cost}', align: 'right' },
    { label: 'Est. Unit Cost', w: 13, c: '{est_unit_cost}', align: 'right' },
    { label: 'Est. Total', w: 19, c: '{est_total}', align: 'right' },
  ] },
  { t: 'grid', cols: [24, 21, 55], attach: true, rows: [
    [L('Business Justification'), V('{business_justification:60}', { span: 2, h: 60 })],
    [L('Suggested Supplier (optional)', { span: 2 }), V('{suggested_supplier:40}')],
    [L('Special Conditions', { span: 2 }), V('{special_conditions}')],
  ] },
  blue('Request Review & Sign-off'),
  { t: 'signoff', cells: [
    { slot: 'prepared_by', label: 'Prepared / Requested by' },
    { slot: 'received_checked', label: 'Received & Checked by Accountant' },
    { slot: 'pi_initial', label: 'PI Initial Authorization' },
  ] },
  note('The Accountant should confirm completeness, budget information and that procurement may proceed to quotation collection. This form does not by itself authorize payment.'),
];

const QC02: PaperBlock[] = [
  kv([
    ['Request No.', '{request_no}'],
    ['Quotation Collection Date', 'Date: {collection_date}'],
    ['Item / Service', '{item_service:50}'],
    ['Minimum Requirement', 'At least two comparable supplier quotations must be attached.'],
  ]),
  blue('Quotations Received'),
  { t: 'items', field: 'quotations', rows: 5, cols: [
    { label: 'Supplier', w: 17, c: '{supplier}' },
    { label: 'Contact', w: 21, c: 'Tel: {tel}\nEmail: {email}' },
    { label: 'Quote Ref./Date', w: 12, c: '{quote_ref}\n{quote_date}' },
    { label: 'Total Price', w: 12, c: '{total_price}', align: 'right' },
    { label: 'Delivery', w: 10, c: '{delivery}' },
    { label: 'Validity', w: 10, c: '{validity}' },
    { label: 'Attachment', w: 10, c: '{attachment|*} Yes' },
  ] },
  { t: 'grid', cols: [23, 30, 47], attach: true, rows: [
    [L('Collection Method', { span: 2 }), V('{collection_method}')],
    [L('Conflict / Relationship Declaration', { span: 2 }), V('I confirm that any known relationship or conflict with a quoted supplier has been disclosed:  {conflict_declaration}')],
    [L('Notes'), V('{notes:60}', { span: 2, h: 54 })],
  ] },
  blue('Quotation Collection Sign-off'),
  { t: 'signoff', cells: [
    { slot: 'collected_by', label: 'Prepared / Collected by' },
    { slot: 'checked_by_accountant', label: 'Checked by Accountant' },
    { slot: 'requesting_staff_ack', label: 'Requesting Staff acknowledgement' },
  ] },
  note('Attach all quotations to this register. Quotations should be sufficiently comparable in scope, specifications, taxes, delivery terms and other material conditions.'),
];

const QE03: PaperBlock[] = [
  kv([
    ['Request No.', '{request_no}'],
    ['Evaluation Date', 'Date: {evaluation_date}'],
    ['Item / Service', '{item_service:50}'],
    ['Evaluation Committee', 'Requesting Staff + Director of Communications + PI'],
  ]),
  blue('Compliance & Commercial Comparison'),
  { t: 'items', field: 'comparison', rows: 7, cols: [
    { label: 'Supplier', w: 17, c: '{supplier}' },
    { label: 'Service/Product Name', w: 17, c: '{product_name}' },
    { label: 'Meets Specs?', w: 10, c: '{meets_specs}' },
    { label: 'Price', w: 11, c: '{price}', align: 'right' },
    { label: 'Delivery', w: 11, c: '{delivery}' },
    { label: 'Quality/ Experience & Overall Finding', w: 20, c: '{finding}' },
  ] },
  { t: 'grid', cols: [27, 26, 47], attach: true, rows: [
    [L('Recommended Supplier', { span: 2 }), V('{recommended_supplier:40}')],
    [L('Recommended Amount', { span: 2 }), V('{recommended_amount}')],
    [L('Reason for Selection'), V('{reason_for_selection}', { span: 2 })],
    [L('Evaluation Notes & Authorization to Commit / Order'), V('{evaluation_notes:60}', { span: 2, h: 54 })],
    [L('Conflict of Interest', { span: 2 }), V('Each reviewer confirms no undisclosed conflict of interest with the suppliers evaluated: {@all_signed} Confirmed', { small: true })],
  ] },
  blue('Three-Person Review Committee Approval'),
  { t: 'signoff', cells: [
    { slot: 'reviewer_1', label: 'Requesting Staff / Reviewer 1' },
    { slot: 'reviewer_2', label: 'Director of Communications / Reviewer 2' },
    { slot: 'reviewer_3', label: 'PI / Reviewer 3' },
  ] },
  note('All three reviewers should sign. Where the Director of Communications or PI is also the requesting staff member, AfS-Rwanda should designate another authorized staff member so that the review retains three distinct reviewers.'),
];

const PA04: PaperBlock[] = [
  kv([
    ['Request No.', '{request_no}'],
    ['Selected Supplier', '{selected_supplier:40}'],
    ['Approved Purchase / Service', '{approved_purchase_service:40}'],
    ['Approved Amount', '{approved_amount}'],
    ['Purchase Order / Contract Ref.', '{po_contract_ref:40}'],
    ['Expected Delivery / Completion', 'Date: {expected_delivery_completion}'],
  ]),
  blue('Pre-Purchase Control'),
  { t: 'grid', cols: [53, 15, 32], rows: [
    [H('Control', { small: true }), H('Status', { small: true }), H('Reference / Comment', { small: true })],
    [V('Approved requisition attached'), V('{ctrl_requisition_attached}'), V('{ctrl_requisition_attached_comment?}')],
    [V('At least two quotations attached'), V('{ctrl_two_quotations}'), V('{ctrl_two_quotations_comment?}')],
    [V('Signed quotation evaluation attached'), V('{ctrl_evaluation_signed}'), V('{ctrl_evaluation_signed_comment?}')],
    [V('Budget availability confirmed'), V('{ctrl_budget_confirmed}'), V('{ctrl_budget_confirmed_comment?}')],
    [V('Supplier/payment details verified'), V('{ctrl_supplier_details_verified}'), V('{ctrl_supplier_details_verified_comment?}')],
  ] },
  blue('Goods / Service Receipt & Payment Verification'),
  { t: 'grid', cols: [27, 73], rows: [
    [L('Delivery / Completion Date'), V('Date: {delivery_completion_date}')],
    [L('Invoice No. / Date'), V('{invoice_no:24} / Date: {invoice_date}')],
    [L('Receipt / Delivery Note Ref.'), V('{delivery_note_ref:40}   {delivery_note_file?}')],
    [L('Acceptance'), V('{acceptance|received_in_full_and_conform} Goods/services received in full and conform to approved specifications\n{acceptance|exception_noted} Exception noted: {exception_text:40}')],
    [L('Amount Payable'), V('{amount_payable}')],
    [L('Payment Method / Ref.'), V('{payment_method_ref:40}')],
  ] },
  { t: 'signoff', attach: true, cells: [
    { slot: 'received_verified', label: 'Received / Verified by Requesting Staff' },
    { slot: 'payment_prepared', label: 'Accountant – payment prepared' },
    { slot: 'final_approval', label: 'Chief Finance Manager' },
  ] },
  note('Payment should only be released after verification of delivery/completion and supporting invoice/receipt documentation, except where an approved advance-payment arrangement applies.'),
];

const MPV03: PaperBlock[] = [
  kv([
    ['Procurement Request No.', '{procurement_request_no}'],
    ['MPV Date', 'Date: {mpv_date}'],
    ['Project / Activity', '{project_activity:50}'],
    ['Item / Service', '{item_service:50}'],
    ['Requesting Staff', '{requesting_staff:50}'],
    ['Staff Assigned to MPV', '{staff_assigned:50}'],
    ['Market / Location Visited', '{market_location_visited:50}'],
  ], [50, 50]),
  caps('A. Item / Service Specification to be Verified'),
  { t: 'items', field: 'spec_lines', rows: 4, cols: [
    { label: 'Detailed specification / description', w: 34, c: '{description}' },
    { label: 'Qty', w: 18, c: '{qty}', align: 'right' },
    { label: 'Unit', w: 18, c: '{unit}' },
    { label: 'Quoted Price Benchmark', w: 24, c: '{quoted_price_benchmark}', align: 'right' },
  ] },
  caps('B. Physical Market Price Verification'),
  { t: 'items', field: 'market_checks', rows: 4, cols: [
    { label: 'Supplier / Outlet Visited', w: 13, c: '{outlet}' },
    { label: 'Location / Contact', w: 13, c: '{location_contact}' },
    { label: 'Item Available?', w: 11, c: '{item_available|true} Y {item_available|false} N' },
    { label: 'Unit Price', w: 12, c: '{unit_price}', align: 'right' },
    { label: 'Taxes Included?', w: 11, c: '{taxes_included|true} Y {taxes_included|false} N' },
    { label: 'Delivery / Lead Time', w: 11, c: '{lead_time}' },
    { label: 'Evidence / Ref.', w: 10, c: '{evidence?}' },
    { label: 'Remarks', w: 11, c: '{remarks}' },
  ] },
  caps('C. Comparison with Quotations Received'),
  { t: 'items', field: 'comparisons', num: 7, rows: 4, cols: [
    { label: 'Quoted Supplier', w: 15, c: '{quoted_supplier}' },
    { label: 'Quotation Amount', w: 15, c: '{quotation_amount}', align: 'right' },
    { label: 'Verified Market Range', w: 15, c: '{verified_market_range}' },
    { label: 'Variance', w: 14, c: '{variance}', align: 'right' },
    { label: 'Price Reasonable?', w: 14, c: '{price_reasonable|true} Y {price_reasonable|false} N' },
    { label: 'Comment', w: 15, c: '{comment}' },
  ] },
  caps('D. Market Verification Findings'),
  { t: 'grid', cols: [50, 50], rows: [
    [L('Observed Market Price Range'), V('Lowest: {price_range_low:14}   Highest: {price_range_high:14}')],
    [L('Market Availability'), V('{market_availability}')],
    [L('Quotation Assessment'), V('{quotation_assessment}')],
    [L('Finding / Explanation'), V('{finding_explanation:50}', { h: 40 })],
    [L('Recommendation'), V('{recommendation}')],
  ] },
  caps('E. Verification, Review and Signatures'),
  { t: 'signoff', cells: [
    { slot: 'market_verification_officer', label: 'Market Verification Officer' },
    { slot: 'accountant_review', label: 'Accountant – Review / Cross-check' },
    { slot: 'requesting_staff_ack', label: 'Requesting Staff – Acknowledgement' },
  ] },
  { t: 'text', style: 'note', text: '{verifier_declaration|true} **Verifier Declaration:** I confirm that the information recorded above reflects the market prices and conditions observed or directly obtained during this verification. I have disclosed any known conflict of interest and have not requested or accepted any benefit from suppliers contacted.' },
  { t: 'text', style: 'plain', text: '**Attachments / Evidence:**   {attachment_types}' },
];

const PO09: PaperBlock[] = [
  caps('A. Purchase Order & Procurement References'),
  { t: 'grid', cols: [22, 28, 22, 28], small: true, rows: [
    [L('PO Number'), V('{po_number}'), L('Requisition No.'), V('{requisition_no}')],
    [L('Project / Activity'), V('{project_activity}'), L('Budget Line / Cost Centre'), V('{budget_line}')],
    [L('Requested By'), V('{requested_by}'), L('Payment Terms', { rspan: 2 }), V('{payment_terms}', { rspan: 2 })],
    [L('Currency'), V('{currency}')],
  ] },
  caps('B. Supplier Details'),
  kv([
    ['Supplier / Company Name', '{supplier_name:50}'],
    ['TIN / Registration No.', '{tin_registration_no:50}'],
    ['Contact Person / Position', '{contact_person_position:50}'],
    ['Telephone / Email', '{telephone_email:30}'],
    ['Supplier Quotation Ref. / Date', '{quotation_ref_date:30}'],
  ], [38, 62]),
  caps('C. Goods / Services Ordered'),
  { t: 'items', field: 'lines', rows: 5, cols: [
    { label: 'Item / Service Description', w: 32, c: '{description}' },
    { label: 'Specification / Scope', w: 21, c: '{specification_scope}' },
    { label: 'Qty', w: 9, c: '{qty}', align: 'right' },
    { label: 'Unit', w: 11, c: '{unit}' },
    { label: 'Unit Price', w: 11, c: '{unit_price}', align: 'right' },
  ] },
  { t: 'grid', cols: [70, 30], attach: true, rows: [
    [L('Subtotal'), V('{subtotal}', { align: 'right' })],
    [L('Tax / VAT'), V('{tax_vat}', { align: 'right' })],
    [L('TOTAL PURCHASE ORDER VALUE'), V('**{total_po_value}**', { align: 'right' })],
  ] },
  caps('D. AfS-Rwanda Authorization'),
  { t: 'signoff', cells: [
    { slot: 'issued_by', label: 'Prepared / Issued by Accountant or Procurement Focal Person', sub: 'I confirm that the PO reflects the approved supplier, specifications and amount.' },
    { slot: 'authorized_by_pi', label: 'Authorized by PI', sub: 'I authorize AfS-Rwanda to place this order subject to the terms stated herein.' },
  ] },
];

const GR06: PaperBlock[] = [
  caps('A. Request Information'),
  { t: 'grid', cols: [16, 34, 14, 36], rows: [
    [L('Project / Activity'), V('{project_activity}'), L('Budget Line / Cost Centre'), V('{budget_line}')],
    [L('Purpose / Justification'), V('{purpose_justification:60}', { span: 3, h: 40 })],
  ] },
  caps('B. Type of Request — Tick the applicable category'),
  { t: 'grid', cols: [20, 26, 25, 29], small: true, rows: [
    [V('{request_types|office_supplies} **OFFICE SUPPLIES**'), V('{request_types|per_diems} **PER DIEMS**'), V('{request_types|other} **OTHER**\nSpecify: {request_types_other:14}'), V('**Noted Details:**\n{noted_details?}', { rspan: 3 })],
    [V('{request_types|incidental_fees} **INCIDENTAL FEES**'), V('{request_types|local_travel_or_field_work} **LOCAL TRAVEL / FIELD WORK**'), V('Estimated Total amount: {estimated_total:10}')],
    [V('{request_types|accommodation} **ACCOMMODATION**'), V('{request_types|international_travel} **INTERNATIONAL TRAVEL**'), V('')],
    [L('Requested / Prepared by'), V('Name: {@prepared_by.name}', { span: 2 }), V('Signature: {@prepared_by.signature}')],
  ] },
  caps('C. Office Supplies / Fees Details — Complete where applicable'),
  { t: 'items', field: 'items', rows: 3, cols: [
    { label: 'Item / Fee Description', w: 25, c: '{description}' },
    { label: 'Specification / Purpose', w: 22, c: '{specification_purpose}' },
    { label: 'Qty', w: 11, c: '{qty}', align: 'right' },
    { label: 'Unit Cost', w: 11, c: '{unit_cost}', align: 'right' },
    { label: 'Estimated Total', w: 15, c: '{est_total}', align: 'right' },
  ] },
  caps('D. Travel / Transport Budget Request — Complete where applicable'),
  { t: 'grid', cols: [14, 34, 13, 39], rows: [
    [L('Travel Category'), V('{travel_category}', { span: 3 })],
    [L('Traveler(s) NAME'), V('{travelers:40}', { span: 2 }), V('{team_list_file|*} List of Traveling Team Attached')],
    [L('Destination'), V('{destination:30}'), L('Departure'), V('Date {departure_date}   Time {departure_time:8}')],
    [L('Transport Requested'), V('{transport}', { span: 3 })],
    [V('**Distance control:** Select the category that reflects the approved official journey. Where a journey falls between 30 km and 70 km, the approving authority should classify it under the organization\'s applicable travel rule that includes accommodation where applicable before authorization. This requisition is an authorization request and does not replace procurement procedures where procurement thresholds or competitive sourcing requirements apply.', { span: 4, tone: 'note', small: true })],
  ] },
  caps('E. Review & Approval'),
  { t: 'signoff', cells: [
    { slot: 'accountant_budget_check', label: 'ACCOUNTANT — BUDGET & CONTROL CHECK' },
    { slot: 'director_activity_review', label: 'DIRECTOR OF DEPARTMENT — ACTIVITY REVIEWER' },
    { slot: 'pi_final_authorization', label: 'PI — FINAL AUTHORIZATION' },
  ] },
  caps('F. Finance / Administration Action'),
  { t: 'grid', cols: [22, 78], rows: [
    [L('Funds Service Issued', { tone: 'green' }), V('{funds_action}')],
    [L('Processed By', { tone: 'green' }), V('Name: {@processed_by.name}   Signature: {@processed_by.signature}   Date: {@processed_by.date}')],
  ] },
];

const IM08_ACTIONS: [string, string, string][] = [
  ['internal_administrative_action', 'Internal Administrative Action', 'Meeting, internal instruction, staff coordination, correction or other internal resolution.'],
  ['procurement_process', 'Procurement Process', 'Initiate applicable requisition, quotations, market verification, evaluation and approval workflow.'],
  ['single_source_justification_or_approval', 'Single-Source Justification / Approval', 'Proceed only where permitted under AfS-Rwanda policy and with documented justification and authorization. {single_source_justification?}'],
  ['consultant_or_professional_expert', 'Consultant / Professional Expert', 'Develop scope/ToR and initiate the applicable engagement and procurement/contracting process.'],
  ['service_provider', 'Service Provider', 'Define required service/specifications and initiate the applicable sourcing/approval process.'],
  ['goods_or_supplies', 'Goods / Supplies', 'Define product specifications and initiate the applicable procurement or store/administrative process.'],
];

const IM08: PaperBlock[] = [
  caps('A. Memo Originator'),
  kv([
    ['Memo Reference Name', '{memo_reference_name:50}'],
    ['Department/ Office', '{department_office:50}'],
  ]),
  caps('B. Issue Requiring Attention'),
  { t: 'grid', cols: [50, 50], rows: [
    [V('**Describe the issue, background, urgency, operational implication, and any relevant facts or supporting references.**', { small: true }),
      V('**ORIGINATING STAFF RECOMMENDATION**', { sub: 'Proposed solution / recommendation and reason for the proposed course of action:' })],
    [V('{issue_description:50}', { h: 90 }), V('{recommendation:50}', { h: 90 })],
    [V('**Originating Staff Signature**\nName: {@originating_staff.name}      Signature: {@originating_staff.signature}\nPosition: {@originating_staff.position}      **Date:** {@originating_staff.date}', { span: 2 })],
  ] },
  caps('C. Superior / Management Review, Advice & Decision'),
  { t: 'grid', cols: [30, 18, 52], rows: [
    [L('Advice / Management Recommendation/ Decision'), V('{decision_advice:60}', { span: 2, h: 40 })],
    [L('Decision Status'), V('{decision_status}', { span: 2 })],
    [L('Priority / Required Completion'), V('{priority}   | Target date: {target_date}', { span: 2 })],
    ...IM08_ACTIONS.map(([v, label, desc]): PaperCell[] => [V(`{action_types|${v}} **${label}**`, { span: 2, small: true }), V(desc, { small: true })]),
    [V('{action_types|other} **Other**', { span: 2, small: true }), V('Specify: {action_types_other:40}', { small: true })],
    [L('Superior Staff Name / Position'), V('Name: {@superior.name}    Position: {@superior.position}\nSignature: {@superior.signature}    Date: {@superior.date}', { span: 2 })],
  ] },
  caps('D. Staff to be Notified / Responsible for Next Action'),
  { t: 'items', field: 'follow_up', rows: 3, cols: [
    { label: 'Name / Position', w: 38, c: '{staff}' },
    { label: 'Action / Responsibility Assigned', w: 32, c: '{action_assigned}' },
    { label: 'Notification / Due Date', w: 22, c: '**Date:** {due_date}' },
  ] },
  { t: 'text', style: 'note', text: '**Control note:** This memo documents management direction but does not replace any procurement, finance, HR, contracting, safeguarding, or other mandatory approval procedure triggered by the decision. A single-source decision should be supported by the applicable written justification and authorization.' },
];

const TC10: PaperBlock[] = [
  { t: 'grid', cols: [100], frame: 'dashed', dots: true, rows: [
    [V('**Issued to Mr/Mrs/Ms:** {issued_to/issued_to_name:60}\n**ID:** {id_number:60}\n**Account number:** {account_number:60}\n**Function :** {function:60}', { h: 92 })],
  ] },
  { t: 'grid', cols: [30, 16, 19, 35], dots: true, rows: [
    [V('5. **Program:** {program:24}', { span: 2, h: 30 }), V('6. **Funding:** {funding:24}', { span: 2 })],
    [V('7. **Expected results:**\n{expected_results:90}', { span: 4, h: 62 })],
    [V('8. **Purpose of the mission:**\n{purpose:90}', { span: 4, h: 62 })],
    [V('9. **Supervisor who proposed the mission:** {supervisor:50}  {@supervisor.signature?}', { span: 4, h: 30 })],
    [V('10. **Destination:** {destination:26}', { span: 2 }), V('11. **Date and place of departure:** {departure_date}\n{departure_place:40}', { span: 2 })],
    [V('12. **Returning date:** {return_date}', { span: 2 }), V('13. **Duration:** {duration_days:6} (days)'), V('14. **Means of transport :**\n{transport}')],
    [V('15. **Mission allowance per day :**\n{allowance_per_day:26}'), V('16. **Accommodation & Incidental per day :**\n{accommodation_per_day:26}', { span: 2 }), V('17. **Total Amount** :\n{total_amount:26}')],
  ] },
  { t: 'grid', cols: [58, 42], frame: 'none', dots: true, rows: [
    [V('Issued at {issued_at:18} On {@approved_by.date}\n\n**Approved By:** {@approved_by.name}\n{@approved_by.signature?}\n\n**Authorized Signature & Stamp**', { h: 110 }),
      V('**Visa of Hosting Institution**\n(Authorized Name, Signature & Stamp)\n{host_authorized?}\n\n**Arrival date** {host_arrival_date:20}\n\n**Departure date** {host_departure_date:20}', { box: true, h: 110 })],
  ] },
  { t: 'heading', text: 'Internal approval record', style: 'blue' },
  { t: 'signoff', cols: 4, cells: [
    { slot: 'traveller', label: 'Traveller (requested by)' },
    { slot: 'supervisor', label: 'Supervisor who proposed the mission' },
    { slot: 'admin_costs', label: 'Costs entered by (Administrator)' },
    { slot: 'funding_check', label: 'Funding checked by (Accountant)' },
  ] },
];

export const LAYOUTS: Record<string, PaperBlock[]> = {
  'PR-01': PR01, 'QC-02': QC02, 'QE-03': QE03, 'PA-04': PA04, 'MPV-03': MPV03, 'PO-09': PO09, 'GR-06': GR06, 'IM-08': IM08, 'TC-10': TC10,
};
