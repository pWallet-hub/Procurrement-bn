# API contract (frontend <-> backend)

Base URL `/api/v1` (dev: `http://localhost:3000/api/v1`, Vite proxies `/api` to it).
Auth: `Authorization: Bearer <access_token>`. JSON everywhere except uploads (multipart) and PDFs.
Errors: HTTP 4xx/5xx with `{"error": {"code": "guard.min_quotations", "message": "...", "fields": {"items[0].qty": "must be > 0"}}}`.
Guard failures and validation failures are HTTP 422. 401 = not signed in / token expired (use refresh), 403 = no permission.
Lists: `?limit=&cursor=` -> `{ "items": [...], "next_cursor": string|null }`.
Money values are `{ "amount": number, "currency": "RWF"|"USD"|"EUR" }`. Dates are ISO `YYYY-MM-DD`, timestamps ISO 8601.
Send an `Idempotency-Key` header (any uuid) on `submit` and `sign`.

## Auth
| Call | Body | Response |
| --- | --- | --- |
| `POST /auth/login` | `{email, password}` | `{access_token, refresh_token, user}` OR `{requires_totp: true, challenge_token}` |
| `POST /auth/totp` | `{challenge_token, code}` | `{access_token, refresh_token, user}` |
| `POST /auth/refresh` | `{refresh_token}` | `{access_token, refresh_token}` |
| `POST /auth/logout` | `{refresh_token}` | `{ok:true}` |
| `POST /auth/accept-invite` | `{token, password}` | `{access_token, refresh_token, user}` (invite link in e-mail: `/accept-invite?token=...`) |
| `POST /auth/totp/setup` (auth) | - | `{secret, otpauth_url}` |
| `POST /auth/totp/enable` (auth) | `{code}` | `{ok:true}` |
| `GET /me` | - | `User` |

`User = {id, email, full_name, position, department:{id,name}|null, roles:string[], permissions:string[], totp_enabled:boolean}`

Roles: `requesting_staff, accountant, director_comms, director_dept, pi, cfm, market_verifier, superior, admin`.

## Lookups (any signed-in user)
`GET /lookups/users`, `/lookups/suppliers`, `/lookups/budget-lines`, `/lookups/departments` -> `{items:[...]}` (no pagination).
- user: `{id, full_name, position, email, roles}`; supplier: `{id, name, tin_or_reg_no, contact_person, phone, email, address}`; budget line: `{id, code, project, funding_source: internal|external, funder, baseline, available, currency}`.
`POST /lookups/budget-lines` (permission `budget.manage`) body `{code, project?, funding_source?, funder? (required when external), baseline?, available? (defaults to baseline), currency?}` -> budget line; used by the "New budget line" button in form budget pickers.
- `POST /lookups/suppliers` (accountant) creates a supplier (used while filling QC-02).

## Templates (the form renderer input)
`GET /templates` -> `{items: Template[]}`; `GET /templates/{code}` -> `Template`.

```
Template = {
  code: "PR-01", version: 1, title: string, description: string,
  schema: { sections: Section[] },
  signature_slots: SlotDef[],
  workflow: { guards_on_submit: string[], guards_on_sign: string[], requires_conflict_confirmation: boolean, footer_note?: string }
}
Section = { key, title, description?, fields: Field[], visible_if?: Condition }
SlotDef = { key, label, role, seq, group?: string, declaration: string, assign?: "creator"|"case_requester" }
Condition = { field: string, equals?: any, includes?: string, truthy?: boolean }   // field is a top level key of document.data
Field = {
  key, type, label, help?, required?: boolean, required_if?: Condition, visible_if?: Condition,
  readonly?: boolean,                 // filled by the server (auto / from case) - show, do not edit
  options?: {value,label}[],          // select | radio | checkbox_group
  allow_other?: boolean,              // checkbox_group/radio: renders an extra text input stored in `${key}_other`
  min?, max?, maxLength?,             // number/text limits
  columns?: Field[], min_rows?, max_rows?,   // table
  accept?: string[],                  // file: mime types
  computed?: object, format?: "money" // computed fields: display only, server fills value
}
```
Field `type` values and the shape of the stored value in `document.data[key]`:
`text, textarea` string · `date` "YYYY-MM-DD" · `time` "HH:MM" · `number` number · `money` {amount,currency} ·
`select, radio` string · `checkbox_group` string[] · `yes_no` boolean · `table` array of row objects (row keys = `columns[].key`) ·
`file` attachment id (uuid; upload via `POST /attachments`) · `user_ref`/`supplier_ref`/`budget_line_ref` uuid (pick from lookups) ·
`computed` number or money (read only) · `case_ref` string (read only, copied from the case).

## Cases
| Call | Notes |
| --- | --- |
| `POST /cases` | body `{project?, budget_line_id?, required_by?, data?}` creates case + PR-01 draft -> `Case` (with `documents`) |
| `GET /cases?status=&stage=&q=&limit=&cursor=` | list (object level rule applied server side) |
| `GET /cases/{id}` | `Case` |
| `GET /cases/{id}/timeline` | `{stages:[{stage,label,status:"done"|"current"|"upcoming"|"skipped", documents:[...]}], events:[AuditEvent]}` |
| `PATCH /cases/{id}` | `{market_check_required?, contract_required?}` (accountant) |
| `POST /cases/{id}/documents` | `{doc_type}` creates the next document allowed by the stage (QC-02, MPV-03, QE-03, PO-09, CONTRACT, PA-04) -> `Document` |
| `POST /cases/{id}/delivery` | accountant, `{delivery_date, invoice_no, invoice_date, delivery_note_ref, delivery_note_attachment_id}` moves to `payment` stage |
| `POST /cases/{id}/advance-arrangement` | cfm, `{reason}` |
| `POST /cases/{id}/cancel` | `{reason}` |

```
Case = { id, request_no, project, budget_line:{id,code}|null, requested_by:{id,full_name},
  required_by, status:"open"|"closed"|"cancelled", current_stage: Stage,
  market_check_required, contract_required, advance_arrangement:{reason}|null,
  selected_supplier:{id,name}|null, approved_amount:number|null, currency, delivery: object|null,
  created_at, closed_at, documents: DocumentSummary[], next_actions: NextAction[] }
Stage = "requisition"|"quotation"|"market_check"|"evaluation"|"purchase_order"|"delivery"|"payment"|"closed"|"cancelled"
DocumentSummary = { id, doc_type, title, state, version }
NextAction = { document_id, doc_type, slot_key, label, role, assigned_user:{id,full_name}|null }
```

## Documents
| Call | Notes |
| --- | --- |
| `POST /documents` | standalone `GR-06` / `IM-08`: `{doc_type, data?}` |
| `GET /documents?doc_type=&state=&mine=` | list standalone + visible docs |
| `GET /documents/{id}` | `Document` |
| `PATCH /documents/{id}` | autosave. `{data: {...}}` merged at top level key level, **only in `draft`**. Returns `Document` with computed values filled and `validation:{errors:{path:msg}}` (non blocking) |
| `POST /documents/{id}/submit` | validate -> freeze -> hash -> start signing. 422 with `error.fields` on failure |
| `POST /documents/{id}/slots/{slotKey}/sign` | `{content_hash, declaration_accepted, conflict_confirmed?, method:"draw"|"type"|"upload", signature_image?:dataURL, signature_text?}` -> `{document_state, signed_at, next_slots}` |
| `POST /documents/{id}/slots/{slotKey}/decline` | `{reason}` |
| `POST /documents/{id}/edit-request` | `{reason}` creator or accountant: returns doc, voids signatures |
| `POST /documents/{id}/revise` | after `returned`: new draft version |
| `POST /documents/{id}/cancel` | `{reason}` |
| `GET /documents/{id}/pdf` | `application/pdf` (fetch with auth header, show as blob) |
| `GET /documents/{id}/audit` | `{items: AuditEvent[]}` |

```
Document = { id, case_id|null, request_no|null, doc_type, title, state:"draft"|"in_signing"|"signed"|"returned"|"archived"|"cancelled",
  version, data, content_hash|null, template:{code,version}, created_by:{id,full_name}, created_at, updated_at,
  slots: [{slot_key,label,role_code,seq,group,status:"pending"|"waiting"|"signed"|"declined"|"skipped",declaration,
           assigned_user:{id,full_name}|null, signature:{signer_name,signed_at,method,image_url?}|null}],
  can: { edit:boolean, submit:boolean, sign:string[], decline:string[], revise:boolean, cancel:boolean },
  returned_reason?: string|null, pdf_available: boolean, validation?: {errors:{[path]:string}} }
```
Use `document.can.*` to show/hide buttons - never re-derive permissions in the client.

## Attachments
`POST /attachments` multipart: `file`, `case_id?`, `document_id?`, `kind?` -> `{id, filename, mime, size_bytes, sha256}`. `GET /attachments/{id}` downloads (auth header).

## Signing
- `GET /signing/tasks` -> `{items:[{document_id, case_id, request_no, doc_type, title, slot_key, label, created_at}]}` (my pending slots)
- External supplier (no login): `GET /sign/{token}` -> `{document: Document, slot: {slot_key,label,declaration}, signer_email}`; `POST /sign/{token}` -> `{ok:true}` with the same body as internal sign.
- `GET /verify/{documentId}` -> `{ok:boolean, checks:{content_hash:boolean, pdf_hash:boolean, audit_chain:boolean}, failing?:string}`. Public (QR target).

## Notifications, audit, reports
- `GET /notifications`, `POST /notifications/{id}/read` -> `Notification = {id,kind,payload,status,created_at,read_at}`
- `GET /audit?case_id=&actor=&from=&to=` -> `{items: AuditEvent[], next_cursor}`; `AuditEvent = {id, at, actor:{id,full_name}|null, action, object_type, object_id, case_id, detail}`
- `GET /reports/open-cases`, `/reports/cycle-time`, `/reports/spend` -> `{rows:[...]}` (shape: simple objects, render as tables)

## Admin (role `admin`)
`GET|POST /admin/users`, `PATCH /admin/users/{id}` (full_name, position, department_id, roles, active), `POST /admin/users/{id}/reset-password`, `POST /admin/users/{id}/reset-totp`;
`GET|POST|PATCH /admin/departments`, `/admin/budget-lines` (permission `budget.manage`, held by admin), `/admin/suppliers`; `GET /admin/templates`.
`POST /admin/users` body `{email, full_name, position, department_id, roles[]}` -> `{user, invite_link}` (`invite_link` only returned outside production).

## Dev seed accounts (password `Passw0rd!dev`, no TOTP in dev)
`admin@afs.local`, `staff@afs.local` (requesting_staff), `accountant@afs.local`, `director.comms@afs.local`, `director.dept@afs.local`, `pi@afs.local`, `cfm@afs.local`, `verifier@afs.local`, `superior@afs.local`.

## Routes the SPA must serve
`/login`, `/accept-invite?token=`, `/sign/:token` (external supplier), `/verify/:documentId` (public), then signed-in: `/` (my actions), `/cases`, `/cases/new`, `/cases/:id`, `/documents/:id`, `/requests` (GR-06), `/memos` (IM-08), `/notifications`, `/audit`, `/reports`, `/admin/*`.


---
## Addendum: behaviour confirmed against the running backend (supersedes anything above)

1. **Fields filled at a later signature (`Field.fill_at`)**. A top level field with `fill_at: "<slotKey>"` is NOT part of the submitted/frozen document. It is filled by the person who signs that slot (IM-08 decision section -> slot `superior`; GR-06 `funds_action` -> slot `processed_by`). Render those fields read only until the signing panel for that slot is open, then send them in the sign body as `data: {...}`. They are required at that moment (422 with `error.fields` otherwise). `Document.data` always shows the merged values of already signed slots.
2. `allow_other`: send `"other"` as the value (radio/select) or inside the array (checkbox_group), plus the text in `${key}_other`. (Not `__other__`.)
3. `GET /sign/{token}` returns `{document, template, slot, signer_email}` - use the included `template` (the templates endpoint needs a login). `POST /sign/{token}` body: `{content_hash, declaration_accepted, method, signature_image?|signature_text?, signer_name (required), signer_position?}`. 410 = link used/expired.
4. `slot.signature.image_url` needs the bearer token: fetch it as a blob (or `GET /documents/{id}/slots/{slotKey}/signature.png` with the header) and use an object URL.
5. `Document.can` also has `edit_request: boolean` and `assign: boolean`. `POST /documents/{id}/slots/{slotKey}/assign` body `{user_id}` sets a delegate on an open slot (QE-03 when the requester is the Director or PI; see `guard.reviewers_distinct`).
6. `GET /cases/{id}/purchase-file` -> merged PDF of a closed case (404 until built).
7. Notification payload: `{subject, title, message, document_id|null, path|null, vars, in_app}`; `path` is a SPA route such as `/documents/<id>`.
8. `CONTRACT` template: section `clauses` has only a long `description` (fixed clauses, shown as read only text). The payment clause contains `{advance_percent}`, `{advance_days}` and `{balance_percent}` placeholders - substitute from `data.advance_percent`, `data.advance_days` and `100 - advance_percent` when displaying.
9. GR-06: the distance control note (journeys between 30 and 70 km) is a UI notice only: show `field.help` of `travel_category` to the approver before they sign `pi_final_authorization`.
10. Seed accounts (also `verifier@afs.local`). With the local `.env` the API port may differ (see Procurrement-bn/README).

## Addendum 2: paper form layout (`schema.paper`)
Every template now has `schema.paper` (type `PaperMeta`) describing how the printed AfS-Rwanda form looks:
`{layout:"form"|"contract", form_label, title, version, date_label, org, footer, intro?, signoff_title, notes?}`.
Templates are version 2 now. The reference PDFs are in `/home/kevin/others/afs/temp/`. Page images of them: `/tmp/claude-1000/-home-kevin-others-afs/88021a09-8939-4de0-af8b-3d99fb066778/scratchpad/pdfimg/*.png`.
The logo is `/logo.png` (served from the frontend `public/` folder).
Section titles already carry the printed letters ("A. Request Information"...).

## Addendum 3
`POST /auth/change-password` (signed in) body `{current_password, new_password}` (min 10 chars) -> `{ok:true}`; other sessions are signed out. 400 with `fields.current_password` when wrong.

## Addendum 4: saved signature and automatic dates
- `GET /me` now includes `has_signature: boolean`.
- `GET /me/signature` (signed in) -> the saved signature image (`image/png` or `image/jpeg`; fetch with the bearer token, show as blob), 404 if none.
- `PUT /me/signature` body `{signature_image: "data:image/png;base64,..."}` (PNG or JPEG, max 1 MB) saves/replaces it -> `{ok:true}`. `DELETE /me/signature` removes it.
- Signing: `method: "saved"` signs with the account's saved image (no `signature_image` needed; 400 `bad_request`-style error with code `no_saved_signature` if none). For `draw` and `upload` you may add `save_signature: true` to also store that image as the account's saved signature. The saved image is copied into the document, so changing it later never alters past signatures.
- Template `Field.default === "today"` on a `date` field: new drafts already contain today's date (the user can change it). The client should also use it when adding a table row (`columns[].default === "today"` -> prefill the row's date) and may show a "Today" shortcut on every date input.
- The date shown in the sign-off grid is stamped automatically by the server when the person signs (nobody types it).
