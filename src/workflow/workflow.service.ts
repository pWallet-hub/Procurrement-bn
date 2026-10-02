import { Injectable } from '@nestjs/common';
import { Queryable } from '../db/db.service';
import { AuditService } from '../audit/audit.service';
import { amt } from '../templates/computed';
import { isSigned } from './stages';

/**
 * Case stage machine (spec section 8). Called inside the signing transaction when a document becomes fully signed.
 * Each stage has exit guards; PR-01 never reaches the payment stage because no edge leads there from requisition.
 */
@Injectable()
export class WorkflowService {
  constructor(private audit: AuditService) {}

  private async setStage(q: Queryable, caseRow: any, stage: string, actorId: string | null, extra = '') {
    await q.query(`UPDATE cases SET current_stage = $2 ${extra} WHERE id = $1`, [caseRow.id, stage]);
    await this.audit.log({ actorId, action: 'case.stage_changed', objectType: 'case', objectId: caseRow.id, caseId: caseRow.id, detail: { from: caseRow.current_stage, to: stage } }, q);
  }

  private async signedTypes(q: Queryable, caseId: string): Promise<Set<string>> {
    const r = await q.query("SELECT DISTINCT doc_type FROM documents WHERE case_id = $1 AND state IN ('signed','archived')", [caseId]);
    return new Set(r.rows.map((x) => x.doc_type));
  }

  /** returns true when the case just closed (caller queues the purchase file job) */
  async onDocumentSigned(q: Queryable, doc: { id: string; case_id: string | null; doc_type: string; data: any }, actorId: string | null): Promise<{ closed: boolean }> {
    if (!doc.case_id) return { closed: false };
    const c = (await q.query('SELECT * FROM cases WHERE id = $1 FOR UPDATE', [doc.case_id])).rows[0];
    if (!c || c.status !== 'open') return { closed: false };
    const signed = await this.signedTypes(q, c.id);
    signed.add(doc.doc_type);

    switch (doc.doc_type) {
      case 'PR-01':
        if (c.current_stage === 'requisition') await this.setStage(q, c, 'quotation', actorId);
        break;
      case 'QC-02':
        if (c.current_stage === 'quotation') await this.setStage(q, c, c.market_check_required ? 'market_check' : 'evaluation', actorId);
        break;
      case 'MPV-03':
        if (c.current_stage === 'market_check') await this.setStage(q, c, 'evaluation', actorId);
        break;
      case 'QE-03': {
        const d = doc.data;
        await q.query('UPDATE cases SET selected_supplier_id = $2, approved_amount = $3, currency = $4 WHERE id = $1', [c.id, d.recommended_supplier, amt(d.recommended_amount), d.recommended_amount?.currency ?? 'RWF']);
        if (c.current_stage === 'evaluation') await this.setStage(q, c, 'purchase_order', actorId);
        break;
      }
      case 'PO-09':
      case 'CONTRACT':
        if (c.current_stage === 'purchase_order' && signed.has('PO-09') && (!c.contract_required || signed.has('CONTRACT'))) {
          await this.setStage(q, c, 'delivery', actorId);
        }
        break;
      case 'PA-04':
        if (c.current_stage === 'payment') {
          await this.setStage(q, c, 'closed', actorId, ", status = 'closed', closed_at = now()");
          return { closed: true };
        }
        break;
    }
    return { closed: false };
  }
}
export { isSigned };
