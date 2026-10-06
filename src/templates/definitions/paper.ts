import { PaperMeta } from '../types';

const ORG = 'ALLIANCE FOR SCIENCE RWANDA (AfS-Rwanda)';
const GENERIC = 'AfS-Rwanda Procurement System | Controlled Internal Form';
const form = (p: Omit<PaperMeta, 'layout' | 'org' | 'version'> & Partial<PaperMeta>): PaperMeta => ({ layout: 'form', org: ORG, version: '1.0', ...p });

/** Header, footer and sign-off wording copied from the printed forms (AfS-Rwanda_Procurement_Forms 2026, GR-06, IM-08, PO-09, Supply Contract). */
export const PAPER: Record<string, PaperMeta> = {
  'PR-01': form({ form_label: 'AfS-Rwa_PR-01', title: 'PROCUREMENT REQUISITION / PURCHASE OR SERVICE REQUEST', date_label: 'Effective', footer: GENERIC,
    signoff_title: 'Request Review & Sign-off',
    notes: 'The Accountant should confirm completeness, budget information and that procurement may proceed to quotation collection. This form does not by itself authorize payment.' }),
  'QC-02': form({ form_label: 'AfS-Rwa_QC-02', title: 'SUPPLIER QUOTATION COLLECTION REGISTER', date_label: 'Effective', footer: GENERIC,
    signoff_title: 'Review & Sign-off',
    notes: 'Attach all quotations to this register. Quotations should be sufficiently comparable in scope, specifications, taxes and delivery terms.' }),
  'MPV-03': form({ form_label: 'MPV-03', title: 'MARKET PRICE VERIFICATION FORM', date_label: 'Effective Date', footer: GENERIC,
    intro: 'Purpose: To independently verify prevailing market prices and commercial conditions for requested goods/services and compare them with supplier quotations received before final supplier selection.',
    signoff_title: 'E. Verification, Review and Signatures' }),
  'QE-03': form({ form_label: 'AfS-Rwa_QE-03', title: 'QUOTATION EVALUATION, REVIEW, SUPPLIER RECOMMENDATION & PURCHASE ORDER AUTHORIZATION', date_label: 'Date', footer: GENERIC,
    signoff_title: 'Review Committee Sign-off',
    notes: 'Where the Director or PI is also the requester, an authorized staff member signs that slot so that the review retains three distinct reviewers.' }),
  'PO-09': form({ form_label: 'PO-09', title: 'PURCHASE ORDER', date_label: 'Issue Date', footer: 'AfS-Rwanda Procurement & Finance Control | PO-09 | Controlled Internal Form',
    intro: 'This Purchase Order is issued following completion of the applicable AfS-Rwanda requisition, quotation review, market verification where required, and supplier approval process.',
    signoff_title: 'D. AfS-RWANDA AUTHORIZATION' }),
  'PA-04': form({ form_label: 'PA-04', title: 'PURCHASE / SERVICE PAYMENT FINAL COMPLIANCE APPROVAL', date_label: 'Date', footer: GENERIC,
    signoff_title: 'Final Approval',
    notes: 'Payment should be made only after verified delivery and the supporting invoice, unless an approved advance payment arrangement applies.' }),
  'GR-06': form({ form_label: 'GR-06', title: 'GENERAL REQUISITION & ACTIVITY SUPPORT REQUEST', date_label: 'Effective', footer: 'AfS-Rwanda Procurement & Administration Control | GR-06 | Controlled Internal Form',
    intro: 'Use this form to request routine office supplies, incidental activity costs, accommodation and official travel outside the office before the expense is incurred',
    signoff_title: 'E. REVIEW & APPROVAL', signoff_before: 'funds' }),
  'IM-08': form({ form_label: 'IM-08', title: 'INTERNAL MEMORANDUM — ISSUE, RECOMMENDATION & MANAGEMENT DECISION', date_label: 'Date Submitted', footer: 'AfS-Rwanda Internal Administration & Management Control | IM-08 | Controlled Internal Form',
    intro: "Purpose: To formally document an internal operational/workplace issue requiring management attention, the initiating staff member's recommendation, the superior's guidance and decision, and the staff responsible for follow-up action.",
    signoff_title: 'Signatures',
    notes: 'A single-source decision should be supported by the attached justification. This memo does not replace procurement, finance, HR, contracting or safeguarding approvals.' }),
  'TC-10': form({ form_label: 'TC-10', title: 'TRAVEL CLEARANCE', date_label: 'Date', footer: 'Alliance for Science Rwanda | Kigali - Rwanda',
    intro: 'To be completed by AfSRw employee travelling on work mission.', signoff_title: 'Approval', signoff_before: 'host_visa' }),
  CONTRACT: { layout: 'contract', form_label: 'CONTRACT', org: ORG, version: '1.0', date_label: 'Date',
    title: 'FINANCIAL CONTRACT FOR THE PROVISION OF EVENT MANAGEMENT SERVICE TOOLS, COMMUNICATION MATERIALS, AND OTHER SUPPLIES',
    footer: 'Street: KK 655 ST, District: KICUKIRO, City of Kigali | Tel: +250 788 667 469 | Email: rwandaafs@gmail.com | Website: www.afs-rwanda.org',
    signoff_title: 'Signed by' },
};
