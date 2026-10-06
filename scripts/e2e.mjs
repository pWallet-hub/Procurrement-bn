// End-to-end smoke test: runs a full procurement case and an IM-08 memo against a running API.
//   API=http://localhost:3000/api/v1 node scripts/e2e.mjs
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
const API = process.env.API ?? 'http://localhost:3000/api/v1';
const REMOTE = process.env.E2E_REMOTE === '1'; // against a deployed server: skip steps that need local Mailpit/Docker
const PASSWORD = process.env.SEED_PASSWORD ?? 'Passw0rd!dev';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let passed = 0;
const failures = [];
const SOFT = process.env.E2E_SOFT === '1'; // keep going after a failed check and summarise at the end
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); if (!SOFT) process.exit(1); failures.push(m); return; } passed++; console.log('  ok', m); };

async function call(method, path, token, body, raw = false) {
  const res = await fetch(API + path, { method, headers: { ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Idempotency-Key': randomUUID() }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  if (raw) return res;
  const json = await res.json().catch(() => ({}));
  return { ...json, http: res.status };
}
const login = async (u) => (await call('POST', '/auth/login', null, { email: `${u}@afs.local`, password: PASSWORD })).access_token;
const must = (r, status, label) => { if (r.http !== status) { console.error('FAIL:', label, r.http, JSON.stringify(r).slice(0, 600)); process.exit(1); } passed++; console.log('  ok', label); return r; };
const money = (amount) => ({ amount, currency: 'RWF' });

const T = {};
for (const u of ['admin', 'verifier', 'staff', 'accountant', 'director.comms', 'pi', 'cfm', 'superior']) { T[u] = await login(u); if (!T[u]) { console.error('login failed for', u); process.exit(1); } }
ok(true, 'logged in 8 seeded users');

async function sign(docId, slot, token, doc, extra = {}) {
  return call('POST', `/documents/${docId}/slots/${slot}/sign`, token, { content_hash: doc.content_hash, declaration_accepted: true, conflict_confirmed: true, method: 'draw', signature_image: PNG, ...extra });
}
const getDoc = async (id, t) => (await call('GET', `/documents/${id}`, t));

console.log('\n== guards & access');
must(await call('GET', '/cases'), 401, 'unauthenticated is rejected');
must(await call('GET', '/admin/users', T.staff), 403, 'staff cannot use admin');

console.log('\n== PR-01 requisition');
const bl = (await call('GET', '/lookups/budget-lines', T.staff)).items[0];
const sup = (await call('GET', '/lookups/suppliers', T.staff)).items;
const me = await call('GET', '/me', T.staff);
const created = must(await call('POST', '/cases', T.staff, { project: 'OFAB Rwanda Chapter', budget_line_id: bl.id }), 201, 'create case');
const caseId = created.id;
let pr = await getDoc(created.documents[0].id, T.staff);
ok(pr.state === 'draft' && pr.data.request_no === created.request_no, `PR-01 draft with request no ${created.request_no}`);
const early = await call('POST', `/documents/${pr.id}/submit`, T.staff);
ok(early.http === 422 && early.error.fields.items, 'submit of an empty PR-01 is rejected with field errors');
pr = must(await call('PATCH', `/documents/${pr.id}`, T.staff, { data: { items: [{ description: 'Event banners', qty: 10, unit_cost: money(10000), est_unit_cost: money(10000) }], business_justification: 'Needed for the OFAB event', required_by_date: '2026-12-01', special_conditions: ['delivery'] } }), 200, 'autosave PR-01');
ok(pr.data.items[0].est_total.amount === 100000, 'server computed est_total = 100000');
const sub = must(await call('POST', `/documents/${pr.id}/submit`, T.staff), 201, 'submit PR-01');
ok(sub.state === 'in_signing' && /^[0-9a-f]{64}$/.test(sub.content_hash), 'frozen with sha256 content hash');
const frozen = await call('PATCH', `/documents/${pr.id}`, T.staff, { data: { project_activity: 'tamper' } });
ok(frozen.http === 422 && frozen.error.code === 'guard.frozen_after_sign', 'frozen_after_sign blocks edits');
const tasks0 = await call('GET', '/signing/tasks', T.staff);
ok(tasks0.items.some((t) => t.document_id === pr.id && t.slot_key === 'prepared_by'), 'requester sees the prepared_by task');
const wrong = await sign(pr.id, 'received_checked', T.accountant, sub);
ok(wrong.http === 403, 'accountant cannot sign out of order');
must(await sign(pr.id, 'prepared_by', T.staff, sub, { content_hash: 'bad' }), 422, 'wrong content_hash is rejected');
must(await sign(pr.id, 'prepared_by', T.staff, sub), 201, 'requester signs');
must(await sign(pr.id, 'received_checked', T.accountant, sub), 201, 'accountant signs');
const last = must(await sign(pr.id, 'pi_initial', T.pi, sub), 201, 'PI signs');
ok(last.document_state === 'signed', 'PR-01 fully signed');
let c = await call('GET', `/cases/${caseId}`, T.staff);
ok(c.current_stage === 'quotation', 'case moved to quotation stage');
must(await call('PATCH', `/cases/${caseId}`, T.staff, { market_check_required: true }), 403, 'staff cannot configure the case');
must(await call('PATCH', `/cases/${caseId}`, T.accountant, { market_check_required: true, contract_required: !REMOTE }), 200, REMOTE ? 'accountant requires a market check' : 'accountant requires market check and a contract');

console.log('\n== QC-02 quotations');
must(await call('POST', `/cases/${caseId}/documents`, T.staff, { doc_type: 'QC-02' }), 403, 'staff cannot create QC-02');
const qc0 = must(await call('POST', `/cases/${caseId}/documents`, T.accountant, { doc_type: 'QC-02' }), 201, 'accountant creates QC-02');
const upload = async (name) => { const f = new FormData(); f.append('file', new Blob([`%PDF-1.4 quotation ${name}`], { type: 'application/pdf' }), `${name}.pdf`); f.append('case_id', caseId); return (await call('POST', '/attachments', T.accountant, f)); };
const a1 = must(await upload('quote-a'), 201, 'upload quotation file A'); const a2 = must(await upload('quote-b'), 201, 'upload quotation file B');
const q = (s, a, price) => ({ supplier: s.id, tel: s.phone, email: s.email, quote_ref: 'Q-1', quote_date: '2026-10-05', total_price: money(price), delivery: '7 days', validity: '30 days', attachment: a.id });
await call('PATCH', `/documents/${qc0.id}`, T.accountant, { data: { quotations: [q(sup[0], a1, 95000), q(sup[1], a2, 110000)], collection_method: ['email'], conflict_declaration: false } });
const qc = must(await call('POST', `/documents/${qc0.id}/submit`, T.accountant), 201, 'submit QC-02 (2 quotations with files)');
must(await sign(qc.id, 'collected_by', T.accountant, qc), 201, 'collected_by signs');
must(await sign(qc.id, 'checked_by_accountant', T.accountant, qc), 201, 'checked_by_accountant signs');
const noConflict = await call('POST', `/documents/${qc.id}/slots/requesting_staff_ack/sign`, T.staff, { content_hash: qc.content_hash, declaration_accepted: true, method: 'type', signature_text: 'Agape' });
ok(noConflict.http === 422 && noConflict.error.code === 'guard.conflict_confirmed', 'conflict confirmation is required');
must(await sign(qc.id, 'requesting_staff_ack', T.staff, qc, { method: 'type', signature_text: 'Agape Staff', signature_image: undefined }), 201, 'requester acknowledges (typed signature)');
c = await call('GET', `/cases/${caseId}`, T.staff);
ok(c.current_stage === 'market_check', 'case moved to market_check');

console.log('\n== MPV-03 market price verification');
const mp0 = must(await call('POST', `/cases/${caseId}/documents`, T.verifier, { doc_type: 'MPV-03' }), 201, 'market verifier creates MPV-03 (can see the case at this stage)');
ok(mp0.data.comparisons.length === 2 && mp0.data.spec_lines.length === 1, 'MPV-03 prefilled from PR-01 and QC-02');
await call('PATCH', `/documents/${mp0.id}`, T.verifier, { data: {
  staff_assigned: (await call('GET', '/lookups/users', T.verifier)).items.find((u) => u.email === 'verifier@afs.local').id, market_location_visited: 'Nyabugogo market',
  spec_lines: mp0.data.spec_lines.map((l) => ({ ...l, unit: 'pcs' })),
  market_checks: [{ outlet: 'Shop A', location_contact: 'KN 3', item_available: true, unit_price: money(9800), taxes_included: true, lead_time: '3 days' }],
  comparisons: mp0.data.comparisons.map((r) => ({ ...r, verified_market_range: '9,000-10,000', price_reasonable: true })),
  price_range_low: money(90000), price_range_high: money(100000), market_availability: 'readily_available', quotation_assessment: 'within_market_range',
  finding_explanation: 'Prices are in range', recommendation: 'proceed_with_evaluation', verifier_declaration: true } });
const mp = must(await call('POST', `/documents/${mp0.id}/submit`, T.verifier), 201, 'submit MPV-03');
ok(mp.data.comparisons[0].variance.amount === 0 && mp.data.comparisons[1].variance.amount === 15000, 'variance computed against the range midpoint (95,000)');
must(await sign(mp.id, 'market_verification_officer', T.verifier, mp), 201, 'verifier signs');
must(await sign(mp.id, 'accountant_review', T.accountant, mp), 201, 'accountant reviews');
must(await sign(mp.id, 'requesting_staff_ack', T.staff, mp), 201, 'requester acknowledges');
c = await call('GET', `/cases/${caseId}`, T.staff);
ok(c.current_stage === 'evaluation', 'case in evaluation after the market check');

console.log('\n== QE-03 evaluation (3 distinct reviewers)');
const qe0 = must(await call('POST', `/cases/${caseId}/documents`, T.accountant, { doc_type: 'QE-03' }), 201, 'create QE-03 (prefilled from QC-02)');
ok(qe0.data.comparison.length === 2, 'comparison prefilled with 2 quotations');
const rows = qe0.data.comparison.map((r) => ({ ...r, meets_specs: true, finding: 'Meets requirements' }));
await call('PATCH', `/documents/${qe0.id}`, T.accountant, { data: { comparison: rows, recommended_supplier: sup[0].id, recommended_amount: money(95000), reason_for_selection: ['lowest_compliant_price'], evaluation_notes: 'Recommend the lowest compliant quotation' } });
const qe = must(await call('POST', `/documents/${qe0.id}/submit`, T.accountant), 201, 'submit QE-03');
must(await sign(qe.id, 'reviewer_3', T.pi, qe), 201, 'reviewer 3 (PI) signs first (parallel group)');
const dup = await sign(qe.id, 'reviewer_2', T.pi, qe);
ok(dup.http === 403 || dup.http === 422, 'PI cannot take a second reviewer slot');
must(await sign(qe.id, 'reviewer_2', T['director.comms'], qe), 201, 'reviewer 2 signs');
must(await sign(qe.id, 'reviewer_1', T.staff, qe), 201, 'reviewer 1 signs');
c = await call('GET', `/cases/${caseId}`, T.staff);
ok(c.current_stage === 'purchase_order' && c.approved_amount === 95000 && c.selected_supplier.id === sup[0].id, 'case in purchase_order with supplier and approved amount');

console.log('\n== PO-09');
const po0 = must(await call('POST', `/cases/${caseId}/documents`, T.accountant, { doc_type: 'PO-09' }), 201, 'create PO-09');
ok(po0.data.supplier_name === sup[0].name && /^PO-\d{4}-\d{4}$/.test(po0.data.po_number), 'PO prefilled with supplier and number ' + po0.data.po_number);
await call('PATCH', `/documents/${po0.id}`, T.accountant, { data: { payment_terms: ['bank_transfer'], lines: [{ description: 'Event banners', specification_scope: 'Full colour', qty: 10, unit: 'pcs', unit_price: money(9500) }], tax_vat: money(0) } });
const po = must(await call('POST', `/documents/${po0.id}/submit`, T.accountant), 201, 'submit PO-09');
must(await sign(po.id, 'issued_by', T.accountant, po), 201, 'accountant issues');
must(await sign(po.id, 'authorized_by_pi', T.pi, po), 201, 'PI authorizes');
c = await call('GET', `/cases/${caseId}`, T.staff);
if (!REMOTE) ok(c.current_stage === 'purchase_order', 'PO signed but case waits for the contract'); else ok(c.current_stage === 'delivery', 'PO signed, case in delivery stage');

let ct;
if (!REMOTE) {
console.log('\n== supplier contract (external signer, no account)');
const ct0 = must(await call('POST', `/cases/${caseId}/documents`, T.accountant, { doc_type: 'CONTRACT' }), 201, 'create CONTRACT');
ok(ct0.data.contract_value.amount === 95000 && ct0.data.scope.length === 1, 'contract prefilled with value and scope from the PO');
ct = must(await call('POST', `/documents/${ct0.id}/submit`, T.accountant), 201, 'submit CONTRACT');
must(await sign(ct.id, 'supplier_signatory', T.pi, ct), 403, 'internal user cannot sign the supplier slot');
must(await sign(ct.id, 'afs_signatory', T.pi, ct), 201, 'PI signs for AfS-Rwanda');
await new Promise((r) => setTimeout(r, 4000));
const mp_list = await fetch(`http://localhost:${process.env.MAILPIT_PORT ?? 8125}/api/v1/search?query=${encodeURIComponent('to:' + sup[0].email)}`).then((r) => r.json());
const mailId = mp_list.messages.find((m) => /sign/i.test(m.Subject))?.ID;
ok(!!mailId, 'supplier received the signing e-mail');
const mailBody = await fetch(`http://localhost:${process.env.MAILPIT_PORT ?? 8125}/api/v1/message/${mailId}`).then((r) => r.json());
const link = /(https?:\/\/\S+\/sign\/[0-9a-f]{64})/.exec(mailBody.Text)?.[1];
ok(!!link, 'e-mail contains a single use link');
const stoken = link.split('/sign/')[1];
const view = must(await call('GET', `/sign/${stoken}`, null), 200, 'external view without login');
ok(view.document.doc_type === 'CONTRACT' && view.template.code === 'CONTRACT', 'external view returns the document and template');
must(await call('POST', `/sign/${stoken}`, null, { content_hash: view.document.content_hash, declaration_accepted: true, method: 'type', signature_text: 'Jean Mugabo', signer_name: 'Jean Mugabo', signer_position: 'Director' }), 201, 'supplier signs through the token');
must(await call('POST', `/sign/${stoken}`, null, { content_hash: view.document.content_hash, declaration_accepted: true, method: 'type', signature_text: 'again', signer_name: 'X' }), 410, 'token cannot be reused');
c = await call('GET', `/cases/${caseId}`, T.staff);
ok(c.current_stage === 'delivery', 'case in delivery stage after both PO and contract');

}

console.log('\n== delivery and PA-04 payment');
must(await call('POST', `/cases/${caseId}/documents`, T.accountant, { doc_type: 'PA-04' }), 422, 'PA-04 not allowed before payment stage');
const dn = await upload('delivery-note');
must(await call('POST', `/cases/${caseId}/delivery`, T.accountant, { delivery_date: '2026-10-20', invoice_no: 'INV-77', invoice_date: '2026-10-20', delivery_note_ref: 'DN-5', delivery_note_attachment_id: dn.id }), 201, 'record delivery');
const pa0 = must(await call('POST', `/cases/${caseId}/documents`, T.accountant, { doc_type: 'PA-04' }), 201, 'create PA-04');
ok(pa0.data.ctrl_requisition_attached === true && pa0.data.ctrl_two_quotations === true && pa0.data.ctrl_evaluation_signed === true, 'controls computed from the case');
const early2 = await call('POST', `/documents/${pa0.id}/submit`, T.accountant);
ok(early2.http === 422, 'PA-04 submit needs budget confirmation etc.');
await call('PATCH', `/documents/${pa0.id}`, T.accountant, { data: { expected_delivery_completion: '2026-10-20', ctrl_budget_confirmed: true, ctrl_supplier_details_verified: true, acceptance: 'received_in_full_and_conform', payment_method_ref: 'Bank transfer BK-1', amount_payable: money(120000) } });
const over = await call('POST', `/documents/${pa0.id}/submit`, T.accountant);
ok(over.http === 422 && over.error.code === 'guard.amount_within_approved', 'amount above approved is blocked (amount_within_approved)');
await call('PATCH', `/documents/${pa0.id}`, T.accountant, { data: { amount_payable: money(95000) } });
const pa = must(await call('POST', `/documents/${pa0.id}/submit`, T.accountant), 201, 'submit PA-04');
must(await sign(pa.id, 'received_verified', T.staff, pa), 201, 'requester verifies receipt');
must(await sign(pa.id, 'payment_prepared', T.accountant, pa), 201, 'accountant prepares payment');
must(await sign(pa.id, 'final_approval', T.cfm, pa), 201, 'CFM gives final approval');
c = await call('GET', `/cases/${caseId}`, T.staff);
ok(c.status === 'closed' && c.current_stage === 'closed', 'case closed');

console.log('\n== audit chain under concurrency');
await Promise.all(Array.from({ length: 25 }, (_, i) => { const f = new FormData(); f.append('file', new Blob([`stress ${i}`], { type: 'text/plain' }), `s${i}.txt`); return call('POST', '/attachments', T.accountant, f); }));
ok(true, '25 concurrent uploads (each writes an audit event)');

console.log('\n== PDF, verification, audit, timeline');
await new Promise((r) => setTimeout(r, 6000)); // worker renders PDFs
const prFinal = await getDoc(pr.id, T.staff);
ok(prFinal.state === 'archived' && prFinal.pdf_available, 'PR-01 archived with stored PDF (worker ran)');
const pdf = await call('GET', `/documents/${pr.id}/pdf`, T.staff, null, true);
const buf = Buffer.from(await pdf.arrayBuffer());
ok(pdf.status === 200 && buf.subarray(0, 4).toString() === '%PDF', `PDF downloaded (${buf.length} bytes)`);
const ver = await call('GET', `/verify/${pr.id}`, null);
ok(ver.ok === true && ver.checks.content_hash && ver.checks.pdf_hash && ver.checks.audit_chain, 'public /verify passes all 3 checks');
const tl = await call('GET', `/cases/${caseId}/timeline`, T.staff);
ok(tl.stages.every((s) => s.status === 'done') && tl.events.length > 30, `timeline: all stages done, ${tl.events.length} audit events`);
const au = await call('GET', `/audit?case_id=${caseId}`, T.accountant);
ok(au.items.length > 20, 'audit search works for the accountant');
const caseFile = await call('GET', `/cases/${caseId}/purchase-file`, T.accountant, null, true);
ok(caseFile.status === 200, 'purchase file (merged PDF) available for the closed case');
must(await call('GET', '/reports/spend', T.accountant), 200, 'spend report');
const mails = REMOTE ? null : await fetch(`http://localhost:${process.env.MAILPIT_PORT ?? 8125}/api/v1/messages`).then((r) => r.json()).catch(() => null);
if (mails) ok(mails.total > 5, `mailpit captured ${mails.total} e-mails`);

if (!REMOTE) {
console.log('\n== tamper evidence');
const ctFinal = await getDoc(ct.id, T.staff);
ok(ctFinal.state === 'archived', 'contract archived after both signatures');
const sql = (q) => execSync(`docker compose exec -T postgres psql -U afs -d afs -tA -c "${q}"`, { cwd: process.env.COMPOSE_DIR ?? new URL('..', import.meta.url).pathname }).toString();
let blocked = false;
try { sql("UPDATE audit_events SET action = 'x' WHERE id = 1"); } catch { blocked = true; }
ok(blocked, 'database refuses to UPDATE audit_events');
sql(`UPDATE documents SET data = jsonb_set(data, '{project_activity}', '\\"tampered\\"') WHERE id = '${pr.id}'`);
const bad = await call('GET', `/verify/${pr.id}`, null);
ok(bad.ok === false && bad.checks.content_hash === false, 'verify detects a tampered document');
sql(`UPDATE documents SET data = jsonb_set(data, '{project_activity}', to_jsonb('${'OFAB Rwanda Chapter'}'::text)) WHERE id = '${pr.id}'`);
ok((await call('GET', `/verify/${pr.id}`, null)).ok === true, 'verify passes again once restored');

}

console.log('\n== IM-08 memo with decision at the superior slot');
const memo = must(await call('POST', '/documents', T.staff, { doc_type: 'IM-08', data: { memo_reference_name: 'Printing of banners', department_office: 'Communications', issue_description: 'We need banners', recommendation: 'Procure 10 banners' } }), 201, 'create IM-08');
const msub = must(await call('POST', `/documents/${memo.id}/submit`, T.staff), 201, 'submit IM-08 (decision fields not required yet)');
must(await sign(memo.id, 'originating_staff', T.staff, msub), 201, 'originator signs');
const bare = await sign(memo.id, 'superior', T.superior, msub);
ok(bare.http === 422 && bare.error.fields.decision_status, 'superior must fill the decision');
const dec = must(await sign(memo.id, 'superior', T.superior, msub, { data: { decision_status: 'approved', priority: 'high', action_types: ['procurement_process'], follow_up: [{ staff: me.id, action_assigned: 'Create the requisition', due_date: '2026-10-30' }] } }), 201, 'superior decides');
const mfinal = await getDoc(memo.id, T.staff);
ok(mfinal.data.decision_status === 'approved' && mfinal.data.follow_up.length === 1, 'decision data merged into the document view');

console.log('\n== saved signature and automatic dates');
const today = new Date().toISOString().slice(0, 10);
for (const u of ['staff', 'superior']) await call('DELETE', '/me/signature', T[u]); // start clean so the test is repeatable
const sigGet = async (t) => fetch(API + '/me/signature', { headers: { Authorization: `Bearer ${t}` } });
ok((await sigGet(T.staff)).status === 404, 'no saved signature at first');
ok((await call('GET', '/me', T.staff)).has_signature === false, '/me says has_signature=false');
must(await call('PUT', '/me/signature', T.staff, { signature_image: 'data:image/gif;base64,AAAA' }), 400, 'only PNG/JPEG signatures are accepted');
must(await call('PUT', '/me/signature', T.staff, { signature_image: PNG }), 200, 'staff saves a signature on the account');
const got = await sigGet(T.staff);
ok(got.status === 200 && got.headers.get('content-type') === 'image/png', 'saved signature can be read back');
ok((await call('GET', '/me', T.staff)).has_signature === true, '/me says has_signature=true');
const memo2 = must(await call('POST', '/documents', T.staff, { doc_type: 'IM-08', data: { memo_reference_name: 'Saved sig memo', department_office: 'Communications', issue_description: 'x', recommendation: 'y' } }), 201, 'create IM-08 for the saved-signature test');
ok(memo2.data.date_submitted === today, 'IM-08 date_submitted filled automatically with today');
const msub2 = must(await call('POST', `/documents/${memo2.id}/submit`, T.staff), 201, 'submit');
const noSaved = await call('POST', `/documents/${memo2.id}/slots/originating_staff/sign`, T.staff, { content_hash: 'bad', declaration_accepted: true, method: 'saved' });
ok(noSaved.http === 422, 'hash is still checked for saved-signature signing');
must(await sign(memo2.id, 'originating_staff', T.staff, msub2, { method: 'saved', signature_image: undefined }), 201, 'sign with the saved signature (one click)');
const slotImg = await fetch(`${API}/documents/${memo2.id}/slots/originating_staff/signature.png`, { headers: { Authorization: `Bearer ${T.staff}` } });
ok(slotImg.status === 200, 'signature image stored with the document');
const before = Buffer.from(await slotImg.arrayBuffer());
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
must(await call('PUT', '/me/signature', T.staff, { signature_image: JPG }), 200, 'account signature replaced later');
const after = Buffer.from(await (await fetch(`${API}/documents/${memo2.id}/slots/originating_staff/signature.png`, { headers: { Authorization: `Bearer ${T.staff}` } })).arrayBuffer());
ok(Buffer.compare(before, after) === 0, 'changing the saved signature does not change the already signed one');
const noSig = await call('POST', `/documents/${memo2.id}/slots/superior/sign`, T.superior, { content_hash: msub2.content_hash, declaration_accepted: true, method: 'saved' });
ok(noSig.http === 400 && noSig.error.code === 'no_saved_signature', 'a user without a saved signature gets no_saved_signature');
must(await call('DELETE', '/me/signature', T.staff), 200, 'saved signature deleted');
ok((await sigGet(T.staff)).status === 404, 'and it is gone');
// save_signature flag on a drawn signature
const memo3 = must(await call('POST', '/documents', T.superior, { doc_type: 'IM-08', data: { memo_reference_name: 'Save flag', department_office: 'Programs', issue_description: 'x', recommendation: 'y' } }), 201, 'create IM-08 as superior');
const msub3 = must(await call('POST', `/documents/${memo3.id}/submit`, T.superior), 201, 'submit');
ok((await call('GET', '/me', T.superior)).has_signature === false, 'superior has no saved signature yet');
must(await sign(memo3.id, 'originating_staff', T.superior, msub3, { save_signature: true }), 201, 'drawing a signature with save_signature=true signs');
ok((await call('GET', '/me', T.superior)).has_signature === true, 'and it was saved on the account for next time');
await call('DELETE', '/me/signature', T.superior);
const prDraft = must(await call('POST', '/cases', T.staff, { project: 'Dates', budget_line_id: bl.id }), 201, 'new case for the date defaults');
const prd = await getDoc(prDraft.documents[0].id, T.staff);
ok(prd.data.date_of_request === today, 'PR-01 date_of_request defaults to today');
const tplPo = await call('GET', '/templates/PO-09', T.staff);
ok(tplPo.schema.sections.flatMap((x) => x.fields).find((f) => f.key === 'issue_date').default === 'today', 'templates expose default "today" on date fields');

console.log('\n== admin: invite a user');
const inv = must(await call('POST', '/admin/users', T.admin, { email: `new.person.${Date.now()}@afs.local`, full_name: 'New Person', position: 'Officer', roles: ['requesting_staff'] }), 201, 'admin creates user');
ok(!!inv.invite_link, 'invite link returned in dev');
const tok = new URL(inv.invite_link).searchParams.get('token');
must(await call('POST', '/auth/accept-invite', null, { token: tok, password: 'A-long-password-1' }), 201, 'invitee sets a password');
must(await call('POST', '/auth/accept-invite', null, { token: tok, password: 'A-long-password-1' }), 400, 'invite link is single use');

console.log('\n== admin holds every permission');
const adminMe = await call('GET', '/me', T.admin);
const allPerms = ['admin.manage', 'budget.manage', 'case.create', 'case.configure', 'case.view_all', 'case.advance_arrangement', 'document.edit', 'quotation.manage', 'mpv.fill', 'po.generate', 'payment.record', 'slot.sign', 'supplier.manage', 'reports.view', 'audit.read_all', 'audit.read_own'];
ok(allPerms.every((p) => adminMe.permissions.includes(p)), 'admin /me lists every permission');
must(await call('GET', '/reports/spend', T.admin), 200, 'admin can read reports');
const adminCase = must(await call('POST', '/cases', T.admin, { project: 'Admin case', budget_line_id: bl.id }), 201, 'admin can create a procurement case');
must(await call('PATCH', `/cases/${adminCase.id}`, T.admin, { market_check_required: true }), 200, 'admin can configure a case');
must(await call('POST', '/lookups/suppliers', T.admin, { name: `Admin supplier ${Date.now()}` }), 201, 'admin can add a supplier from a form');
must(await call('POST', '/documents', T.admin, { doc_type: 'GR-06' }), 201, 'admin can create a GR-06 request');

console.log('\n== budget lines: external funding, baseline, inline create');
const blCode = `BL-E2E-${Date.now()}`;
must(await call('POST', '/lookups/budget-lines', T.staff, { code: blCode }), 403, 'staff cannot create a budget line');
const noFunder = await call('POST', '/admin/budget-lines', T.admin, { code: blCode, funding_source: 'external' });
ok(noFunder.http === 422 && !!noFunder.error.fields.funder, 'an external budget line needs a funder');
const extBl = must(await call('POST', '/lookups/budget-lines', T.admin, { code: blCode, project: 'Donor project', funding_source: 'external', funder: 'Gates Foundation', baseline: 5_000_000 }), 201, 'admin creates an external budget line from a form picker');
ok(extBl.baseline === 5_000_000 && extBl.available === 5_000_000 && extBl.funder === 'Gates Foundation', 'new line starts with available = baseline');
must(await call('POST', '/admin/budget-lines', T.admin, { code: blCode }), 422, 'budget line codes are unique');
const blPatched = must(await call('PATCH', `/admin/budget-lines/${extBl.id}`, T.admin, { available: 4_200_000 }), 200, 'admin updates the available balance');
ok(blPatched.baseline === 5_000_000 && blPatched.available === 4_200_000, 'baseline kept when available changes');
ok((await call('GET', '/lookups/budget-lines', T.staff)).items.some((b) => b.id === extBl.id && b.funding_source === 'external'), 'lookup shows the funding source');

console.log('\n== TC-10 travel clearance');
const dirDept = await login('director.dept');
const dirMe = await call('GET', '/me', dirDept);
const tcBase = {
  id_number: '1199080012345678', account_number: '000-123-456', program: 'OFAB Rwanda', funding: extBl.id,
  expected_results: 'Partners briefed', purpose: 'Field visit', supervisor: dirMe.id, destination: 'Musanze',
  departure_date: '2026-11-02', departure_place: 'Kigali', return_date: '2026-11-04', duration_days: 3, transport: ['office_vehicle'],
};
let tc = must(await call('POST', '/documents', T.staff, { doc_type: 'TC-10', data: { ...tcBase, allowance_per_day: money(99_999) } }), 201, 'staff creates a TC-10 draft');
ok(tc.data.issued_to === me.id && tc.data.issued_at === 'Kigali', 'traveller and place of issue prefilled');
ok(tc.data.allowance_per_day === undefined && tc.data.total_amount === undefined, 'requester cannot set the allowance or total at create');
must(await call('PATCH', `/documents/${tc.id}`, T.staff, { data: { accommodation_per_day: money(1), return_date: '2026-11-01' } }), 200, 'save a return date before departure');
ok((await getDoc(tc.id, T.staff)).data.accommodation_per_day === undefined, 'requester cannot set accommodation on save');
const badDates = await call('POST', `/documents/${tc.id}/submit`, T.staff);
ok(badDates.http === 422 && badDates.error.code === 'guard.travel_clearance_valid', 'submit rejects a return before departure');
must(await call('PATCH', `/documents/${tc.id}`, T.staff, { data: { return_date: '2026-11-04' } }), 200, 'fix the return date');
tc = must(await call('POST', `/documents/${tc.id}/submit`, T.staff), 201, 'submit TC-10 without costs');
must(await sign(tc.id, 'traveller', T.staff, tc), 201, 'traveller signs');
tc = await getDoc(tc.id, T.staff);
ok(tc.slots.find((s) => s.slot_key === 'supervisor')?.assigned_user?.id === dirMe.id, 'supervisor slot goes to the person named on the form');
ok([403, 404].includes((await sign(tc.id, 'supervisor', T['director.comms'], tc)).http), 'another director cannot sign for the supervisor');
must(await sign(tc.id, 'supervisor', dirDept, tc), 201, 'supervisor signs');
ok((await call('GET', '/signing/tasks', T.admin)).items.some((t) => t.document_id === tc.id && t.slot_key === 'admin_costs'), 'costs step is in the admin task list');
must(await sign(tc.id, 'admin_costs', T.accountant, tc, { data: { allowance_per_day: money(20_000), accommodation_per_day: money(30_000) } }), 403, 'only the admin fills the costs step');
const noCosts = await sign(tc.id, 'admin_costs', T.admin, tc);
ok(noCosts.http === 422 && !!noCosts.error.fields.allowance_per_day, 'admin must enter the allowance and accommodation');
must(await sign(tc.id, 'admin_costs', T.admin, tc, { data: { allowance_per_day: money(20_000), accommodation_per_day: money(30_000), total_amount: money(1) } }), 201, 'admin enters items 15 and 16 and signs');
tc = await getDoc(tc.id, T.staff);
ok(tc.data.allowance_per_day?.amount === 20_000 && tc.data.total_amount?.amount === 150_000, 'total = (allowance + accommodation) x days, computed by the server');
must(await sign(tc.id, 'funding_check', T.accountant, tc), 201, 'accountant checks funding');
must(await sign(tc.id, 'approved_by', T.pi, tc), 201, 'PI approves');
ok((await getDoc(tc.id, T.staff)).state === 'signed', 'TC-10 fully signed');

if (failures.length) { console.log(`\n${passed} passed, ${failures.length} FAILED:`); failures.forEach((f) => console.log(' -', f)); process.exit(1); }
console.log(`\nALL GOOD: ${passed} checks passed`);
