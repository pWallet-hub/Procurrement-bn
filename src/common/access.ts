import { AuthUser } from './auth';

/**
 * Object level access rule (spec section 4). A user sees a case if they created it, are a current or past signer,
 * belong to the owning department, or hold a global permission (case.view_all).
 * All SQL below uses fixed params: $1 user id, $2 roles text[], $3 view_all boolean, $4 department uuid. Extra params start at $5.
 */
export const accessParams = (u: AuthUser) => [u.id, u.roles, u.permissions.includes('case.view_all'), u.department_id];

export const caseVisible = (c: string) => `(
  $3::boolean OR ${c}.requested_by = $1
  OR (${c}.department_id IS NOT NULL AND ${c}.department_id = $4::uuid)
  OR (${c}.current_stage = 'market_check' AND 'market_verifier' = ANY($2::text[]))
  OR EXISTS (SELECT 1 FROM documents dd WHERE dd.case_id = ${c}.id AND dd.created_by = $1)
  OR EXISTS (SELECT 1 FROM documents dd JOIN signature_slots ss ON ss.document_id = dd.id AND ss.voided_at IS NULL
      WHERE dd.case_id = ${c}.id AND (ss.assigned_user_id = $1 OR (ss.assigned_user_id IS NULL AND ss.status IN ('pending','waiting') AND ss.role_code = ANY($2::text[]))))
  OR EXISTS (SELECT 1 FROM documents dd JOIN signature_slots ss ON ss.document_id = dd.id JOIN signatures g ON g.slot_id = ss.id
      WHERE dd.case_id = ${c}.id AND g.signer_user_id = $1))`;

export const docVisible = (d: string, c: string) => `(
  $3::boolean OR ${d}.created_by = $1
  OR EXISTS (SELECT 1 FROM signature_slots ss WHERE ss.document_id = ${d}.id AND ss.voided_at IS NULL
      AND (ss.assigned_user_id = $1 OR (ss.assigned_user_id IS NULL AND ss.status IN ('pending','waiting') AND ss.role_code = ANY($2::text[]))))
  OR EXISTS (SELECT 1 FROM signature_slots ss JOIN signatures g ON g.slot_id = ss.id WHERE ss.document_id = ${d}.id AND g.signer_user_id = $1)
  OR (${d}.case_id IS NOT NULL AND ${caseVisible(c)}))`;
