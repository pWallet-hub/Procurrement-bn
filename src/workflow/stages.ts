export type Stage = 'requisition' | 'quotation' | 'market_check' | 'evaluation' | 'purchase_order' | 'delivery' | 'payment' | 'closed' | 'cancelled';

export const STAGE_ORDER: Stage[] = ['requisition', 'quotation', 'market_check', 'evaluation', 'purchase_order', 'delivery', 'payment', 'closed'];
export const STAGE_LABELS: Record<string, string> = {
  requisition: 'Requisition', quotation: 'Quotations', market_check: 'Market check', evaluation: 'Evaluation',
  purchase_order: 'Purchase order', delivery: 'Delivery', payment: 'Payment', closed: 'Closed', cancelled: 'Cancelled',
};

/** Which document types may be created in each stage, and the permission needed (spec section 8). */
export const STAGE_DOCS: Record<string, { doc: string; perm?: string }[]> = {
  requisition: [{ doc: 'PR-01' }],
  quotation: [{ doc: 'QC-02', perm: 'quotation.manage' }],
  market_check: [{ doc: 'MPV-03', perm: 'mpv.fill' }],
  evaluation: [{ doc: 'QE-03', perm: 'quotation.manage' }],
  purchase_order: [{ doc: 'PO-09', perm: 'po.generate' }, { doc: 'CONTRACT', perm: 'po.generate' }],
  payment: [{ doc: 'PA-04', perm: 'payment.record' }],
};

/** Besides the creator, who may edit a draft of this type */
export const EDIT_PERM: Record<string, string> = {
  'QC-02': 'quotation.manage', 'MPV-03': 'mpv.fill', 'QE-03': 'quotation.manage', 'PO-09': 'po.generate', CONTRACT: 'po.generate', 'PA-04': 'payment.record',
};

export const CASE_DOC_TYPES = ['PR-01', 'QC-02', 'MPV-03', 'QE-03', 'PO-09', 'CONTRACT', 'PA-04'];
export const STANDALONE_DOC_TYPES = ['GR-06', 'IM-08'];
export const isSigned = (state: string) => state === 'signed' || state === 'archived';
