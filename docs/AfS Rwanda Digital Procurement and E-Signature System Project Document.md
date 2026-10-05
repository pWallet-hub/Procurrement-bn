# AfS Rwanda Digital Procurement and E-Signature System: Technical Specification

## 1. Technical overview

The system is a web application that models each AfS-Rwanda paper form as a versioned template, stores every submission as structured data, and moves it through an ordered signing workflow with a tamper evident audit trail. This document specifies the technical design only: components, schemas, state machines, APIs and security. The AfS-Rwanda forms (GR-06, IM-08, PO-09, PR-01, QC-02, QE-03, PA-04, MPV-03 and the supplier contract) are the reference templates for the field definitions in section 5.

**Design principles**

- **Forms as data.** A form is a JSON template (fields, types, validations, signature slots). Adding or changing a form is a template change, not a code change.
- **One case, many documents.** A Procurement Case owns every form of one purchase, so shared values (request no., project, budget line, supplier, items) are stored once and referenced.
- **Workflow as a state machine.** Allowed transitions and their guard conditions are defined explicitly and enforced server side.
- **Immutable once signed.** After the first signature a document version is frozen and identified by a SHA-256 hash.
- **Append only audit.** Every state change and signature produces an audit event that cannot be edited.
- **Stateless services.** All state lives in the database and object store, so the API scales horizontally.

**Hosting and identity.** The system is self hosted on the organization's own VPS. Email is sent through the organization's Google Workspace. User accounts are created by an administrator; there is no self registration. The forms and their workflow are reproduced as they are on the printed templates.

## 2. System architecture

A layered web architecture: thin clients, a stateless API with focused services, a relational database plus object store, and three external integrations. The layers follow the e-signature architecture in the project diagram, with one added service (Procurement Forms) that owns the nine templates and their rules.

&#91;embedded content: system architecture · 4 layers, 8 services\]

## 3. Technology stack

These are recommended defaults. Each row can be swapped without changing the rest of the design because the services talk through the interfaces in section 11.

| Concern | Choice | Reason |
| --- | --- | --- |
| Hosting | The organization's own Linux VPS, firewall open only on 80 and 443 for users and SSH for administrators | Data stays under the organization's control |
| Front end | React with TypeScript, responsive layout | Component model fits form rendering from JSON templates; works on phones |
| Form rendering | JSON Schema plus a renderer (for example react-jsonschema-form or a small custom renderer) | Same template validates in the browser and on the server |
| API | REST over HTTPS, JSON, OpenAPI 3 description | Simple for clients and for future integrations |
| Backend | One service in Node.js (NestJS) or Python (Django REST / FastAPI), modular by service in the diagram | Pick the one the team maintains; modules map to the services above |
| Database | PostgreSQL on the VPS (container with a persistent volume, or native) | Relational integrity for cases and forms, JSONB for template data, row level locking for the workflow |
| File storage | Encrypted volume on the VPS behind a storage interface; MinIO or another S3 compatible store can replace it later | Signed PDFs, uploads and originals without depending on an outside service |
| Background jobs | Queue (Redis in a container with BullMQ, or Celery) | Email sending, reminders, PDF generation off the request path |
| PDF | HTML to PDF renderer or a PDF library, plus a stamping step | Generate form PDFs from templates and merge signatures and audit page |
| Accounts and sign in | Accounts created by the admin, email and password with Argon2id hashing, TOTP second factor, short lived JWT access token with refresh token | Matches how the organization adds users; no self registration |
| Email | Google Workspace through an adapter (SMTP relay or Gmail API, see section 12) | The organization already uses Workspace mail |
| Reverse proxy and TLS | Caddy or Nginx with automatic certificates | One public entry point |
| Packaging | Docker images run with Docker Compose on the VPS | Same artifact for test and live, simple to operate |
| Delivery | Pipeline with lint, tests, image build, migration step, deploy to the VPS | Repeatable releases |
| Observability | Structured JSON logs, health checks, simple metrics and an uptime check | Needed to operate the system |

## 4. Roles and access control

Access is role based (RBAC) with an extra object level rule: a user sees a case only if they created it, are a current or past signer on it, belong to the owning department, or hold a global role (`pi`, `accountant`, `admin`). Roles come from the signature blocks of the reference forms.

| Role code | Source on the forms | Signature slots held |
| --- | --- | --- |
| `requesting_staff` | Prepared / Requested by; Requesting Staff | PR-01 requester, QC-02 acknowledgement, QE-03 reviewer 1, PA-04 received/verified |
| `accountant` | Accountant; procurement focal person | PR-01 check, QC-02 check, MPV-03 cross-check, GR-06 budget check, PO-09 issuer, PA-04 payment prepared |
| `director_comms` | Director of Communications | QE-03 reviewer 2 |
| `director_dept` | Director of Department | GR-06 activity reviewer |
| `pi` | PI | PR-01 initial authorization, GR-06 final authorization, QE-03 reviewer 3, PO-09 authorization |
| `cfm` | Chief Finance Manager | PA-04 final approval |
| `market_verifier` | Market Verification Officer | MPV-03 verifier |
| `superior` | Superior staff on IM-08 | IM-08 decision |
| `admin` | System owner | None; manages users, templates, settings |
| `supplier` (external) | Supplier on the contract | Contract signature through a single use token, no account |

**Permission matrix**

| Action | requesting\_staff | accountant | director\_\* | pi | cfm | market\_verifier | admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Create case and PR-01 | yes | yes | yes | yes | no | no | no |
| Edit own draft form | yes | yes | yes | yes | no | yes | no |
| Add quotations (QC-02) | no | yes | no | no | no | no | no |
| Fill MPV-03 | no | no | no | no | no | yes | no |
| Sign assigned slot | yes | yes | yes | yes | yes | yes | no |
| Generate PO-09 | no | yes | no | no | no | no | no |
| Record payment (PA-04) | no | yes | no | no | yes | no | no |
| View all cases | no | yes | no | yes | yes | no | yes |
| Manage users, templates | no | no | no | no | no | no | yes |
| Read audit log | own cases | yes | own cases | yes | yes | no | yes |

Permissions are stored as `role -> permission codes` rows and checked in one authorization middleware, so they can change without code changes. The rule that one person cannot fill two distinct reviewer slots on the same QE-03 is a workflow guard (section 9), not a role rule.

### Accounts and sign in

Users are managed only by an administrator (`POST /admin/users`).

1. The admin enters full name, Google Workspace email address, position, department and roles.
2. The system emails an invitation with a one time link that expires; the user sets a password and enrolls a TOTP authenticator.
3. Later sign in uses email, password and the TOTP code; sessions expire after inactivity.
4. The admin can change roles and departments, reset a password or second factor, and deactivate an account. A deactivated user cannot sign in, but their past signatures and audit records stay.
5. Every account change is written to the audit log.

Sign in with Google restricted to the organization's domain and to registered users can be added later as another login method without changing the data model.

## 5. Form templates as schemas

Each reference form is converted to a template: an ordered list of sections, each holding typed fields, plus a list of signature slots. The tables below are the field definitions taken from the AfS-Rwanda forms. Field keys are `snake_case`; `case.*` means the value is read from the Procurement Case instead of typed again.

**Shared field types**

| Type | Stored as | Notes |
| --- | --- | --- |
| `text`, `textarea` | string | Length limits per field |
| `date` | ISO date | Replaces the `__/__/____` blanks |
| `number` | decimal | Min and max per field |
| `money` | amount (numeric 14,2) plus currency code | Currency from RWF, USD, EUR |
| `select`, `radio` | string from a list | List defined in the template |
| `checkbox_group` | array of strings | Replaces the tick boxes; `other` adds a text field |
| `yes_no` | boolean | Replaces Y/N boxes |
| `table` | array of rows | Repeating rows with a fixed column set and min and max rows |
| `file` | attachment id | Upload with type and size limits |
| `user_ref`, `supplier_ref`, `case_ref` | foreign key | Picked from lists, not typed |
| `computed` | derived | Calculated by the server (totals, variance) |
| `signature_slot` | slot definition | Role, order, label, declaration text |

### 5.1 PR-01 Procurement Requisition (AfS-Rwa\_PR-01)

| Field key | Type | Required | Rule or source |
| --- | --- | --- | --- |
| `request_no` | text | auto | Generated, unique, becomes the case number |
| `date_of_request` | date | yes | Default today |
| `requested_by` | user\_ref | yes | Staff list; the form lists Agape, Pacifique, Felix, Gisele or Other |
| `project_activity` | text | yes | Project reference |
| `required_by_date` | date | yes | Not before `date_of_request` |
| `budget_line` | ref | yes | From budget lines table |
| `items` | table | 1 to 5 rows | Columns below |
| `items[].description` | textarea | yes | Detailed technical specification |
| `items[].qty` | number | yes | Greater than 0 |
| `items[].unit_cost` | money | yes | Unit Cost column as printed |
| items\[\].est\_unit\_cost | money | yes | Est. Unit Cost column as printed |
| `items[].est_total` | computed |  | `qty * est_unit_cost` |
| `business_justification` | textarea | yes |  |
| `suggested_supplier` | supplier\_ref or text | no | Optional on the form |
| `special_conditions` | checkbox\_group | no | delivery, installation, warranty, training, other |

Signature slots in order: `prepared_by` (requester), `received_checked` (`accountant`), `pi_initial` (`pi`). Both cost columns are kept as printed. Footer rule: the form alone does not authorize payment.

### 5.2 QC-02 Supplier Quotation Collection Register (AfS-Rwa\_QC-02)

| Field key | Type | Required | Rule or source |
| --- | --- | --- | --- |
| `request_no` | case\_ref | auto | `case.request_no` |
| `collection_date` | date | yes |  |
| `item_service` | text | yes | Default from PR-01 items |
| `quotations` | table | 2 to 5 rows | Minimum two comparable quotations |
| `quotations[].supplier` | supplier\_ref | yes | Creates a supplier record if new |
| `quotations[].tel`, `.email` | text | yes | Contact on the form |
| `quotations[].quote_ref_date` | text and date | yes |  |
| `quotations[].total_price` | money | yes |  |
| `quotations[].delivery` | text | yes |  |
| `quotations[].validity` | text or date | yes |  |
| `quotations[].attachment` | file | yes | The Yes box becomes a mandatory file |
| `collection_method` | checkbox\_group | yes | email, written quotation, supplier portal, other |
| `conflict_declaration` | yes\_no | yes | Disclosed, or N/A |
| `notes` | textarea | no |  |

Signature slots: `collected_by`, `checked_by_accountant` (`accountant`), `requesting_staff_ack`. Footer rule: quotations should be comparable in scope, specifications, taxes and delivery terms.

### 5.3 MPV-03 Market Price Verification

| Field key | Type | Required | Rule or source |
| --- | --- | --- | --- |
| `procurement_request_no`, `project_activity`, `item_service`, `requesting_staff` | case\_ref | auto | From the case |
| `mpv_date` | date | yes |  |
| `staff_assigned`, `market_location_visited` | user\_ref, text | yes |  |
| `spec_lines` (A) | table, 1 to 4 | yes | `description`, `qty`, `unit`, `quoted_price_benchmark` |
| `market_checks` (B) | table, 1 to 4 | yes | `outlet`, `location_contact`, `item_available` (yes\_no), `unit_price`, `taxes_included` (yes\_no), `lead_time`, `evidence` (file), `remarks` |
| `comparisons` (C) | table, 1 to 4 | yes | `quoted_supplier`, `quotation_amount`, `verified_market_range`, `variance` (computed: quotation minus range midpoint), `price_reasonable` (yes\_no), `comment` |
| `price_range_low`, `price_range_high`, `currency` | money | yes | Observed range; low not above high |
| `market_availability` | radio | yes | readily available, limited availability, special order or customized |
| `quotation_assessment` | radio | yes | within, below, above market range, not directly comparable |
| `finding_explanation` | textarea | yes |  |
| `recommendation` | radio | yes | proceed with evaluation, seek clarification or negotiate, obtain additional quotations, repeat verification, other |
| `attachments` | checkbox\_group and files | no | supplier price list, proforma, business card, photo, other |
| `verifier_declaration` | yes\_no | yes | Conflict of interest and no benefit accepted |

Signature slots: `market_verification_officer` (`market_verifier`), `accountant_review`, `requesting_staff_ack`.

### 5.4 QE-03 Quotation Evaluation, Review, Supplier Recommendation and PO Authorization (AfS-Rwa\_QE-03)

| Field key | Type | Required | Rule or source |
| --- | --- | --- | --- |
| `request_no`, `item_service` | case\_ref | auto | From the case |
| `evaluation_date` | date | yes |  |
| `committee` | computed |  | Requesting staff, Director of Communications, PI |
| `comparison` | table, 1 to 7 | yes | One row per quotation, prefilled from QC-02 |
| `comparison[].supplier` | supplier\_ref | yes | Must be a supplier from QC-02 |
| `comparison[].product_name` | text | yes |  |
| `comparison[].meets_specs` | yes\_no | yes |  |
| `comparison[].price`, `.delivery` | money, text | yes | Prefilled |
| `comparison[].finding` | textarea | yes | Quality, experience and overall finding |
| `recommended_supplier` | supplier\_ref | yes | One of the compared suppliers |
| `recommended_amount` | money | yes | Amount and currency |
| `reason_for_selection` | checkbox\_group | yes | lowest compliant price, best value, quality or technical advantage, delivery advantage, other |
| `evaluation_notes` | textarea | yes | Evaluation notes and authorization to commit or order |
| `conflict_confirmations` | per reviewer yes\_no | yes | Each reviewer confirms no undisclosed conflict |

Signature slots: `reviewer_1` (`requesting_staff`), `reviewer_2` (`director_comms`), `reviewer_3` (`pi`). All three must be different users. When the director or PI is also the requester, a designated authorized staff user fills that slot (`delegate_user_id` on the slot).

### 5.5 PO-09 Purchase Order

| Field key | Type | Required | Rule or source |
| --- | --- | --- | --- |
| `po_number` | text | auto | Generated, unique |
| `issue_date` | date | yes |  |
| `requisition_no`, `project_activity`, `budget_line`, `requested_by` | case\_ref | auto | From the case |
| `currency` | radio | yes | RWF, USD, EUR, other |
| `payment_terms` | checkbox\_group | yes | bank transfer, mobile money, MoMo pay, cash, other |
| `supplier_name`, `tin_registration_no` | supplier\_ref | auto | From the selected supplier |
| `contact_person_position`, `telephone_email` | text | auto | From the supplier record |
| `quotation_ref_date` | text and date | auto | From the selected quotation |
| `lines` | table, 1 to 5 | yes | `description`, `specification_scope`, `qty`, `unit`, `unit_price` |
| `subtotal` | computed |  | Sum of `qty * unit_price` |
| `tax_vat` | money | yes | Entered or calculated by rate |
| `total_po_value` | computed |  | `subtotal + tax_vat` |

Signature slots: `issued_by` (`accountant`, text: confirms the PO reflects the approved supplier, specifications and amount), `authorized_by_pi` (`pi`, text: authorizes AfS-Rwanda to place the order). The PO can only be created from an approved QE-03; lines and supplier are copied, not retyped.

### 5.6 PA-04 Purchase / Service Payment Final Compliance Approval

| Field key | Type | Required | Rule or source |
| --- | --- | --- | --- |
| `request_no`, `selected_supplier`, `approved_purchase_service`, `approved_amount` | case\_ref | auto | From QE-03 |
| `po_contract_ref` | case\_ref | auto | PO number or contract id |
| `expected_delivery_completion` | date | yes |  |
| `ctrl_requisition_attached` | computed yes\_no |  | True when PR-01 is signed |
| `ctrl_two_quotations` | computed yes\_no |  | True when QC-02 has two or more files |
| `ctrl_evaluation_signed` | computed yes\_no |  | True when QE-03 is fully signed |
| `ctrl_budget_confirmed` | yes\_no | yes | Entered by the Accountant, with `comment` |
| `ctrl_supplier_details_verified` | yes\_no | yes | Entered by the Accountant, with `comment` |
| `delivery_completion_date` | date | yes |  |
| `invoice_no`, `invoice_date` | text, date | yes |  |
| `delivery_note_ref` | text and file | yes |  |
| `acceptance` | radio | yes | received in full and conform, or exception noted (then `exception_text` required) |
| `amount_payable` | money | yes | Not above `approved_amount` unless an exception is recorded |
| `payment_method_ref` | text | yes |  |

Signature slots: `received_verified` (`requesting_staff`), `payment_prepared` (`accountant`), `final_approval` (`cfm`). Footer rule: payment only after verified delivery and supporting invoice, except an approved advance arrangement.

### 5.7 GR-06 General Requisition and Activity Support Request

| Field key | Type | Required | Rule or source |
| --- | --- | --- | --- |
| `project_activity`, `budget_line` | text, ref | yes |  |
| `purpose_justification` | textarea | yes |  |
| `request_types` | checkbox\_group | yes | office supplies, incidental fees, accommodation, per diems, local travel or field work, international travel, other (with `other_specify`) |
| `noted_details` | textarea | no |  |
| `estimated_total` | money | yes | Sum of item totals plus travel estimate |
| `items` (C) | table, 1 to 3 | when office supplies or fees | `description`, `specification_purpose`, `qty`, `unit_cost`, `est_total` (computed) |
| `travel_category` (D) | radio | when travel | within 30 km, beyond 70 km |
| `travelers` | text list, `team_list_file` | when travel | List of traveling team attached |
| `destination` | text | when travel |  |
| `departure_date`, `departure_time` | date, time | when travel |  |
| `transport` | checkbox\_group | when travel | office vehicle, taxi ride, public transport, hired vehicle, motorcycle, mileage or fuel support, other |
| `funds_action` (F) | checkbox\_group | at finance step | cash advance, direct payment, vehicle/fuel/transport arranged, supplier's invoice cover |

Signature slots in order: `prepared_by`, `accountant_budget_check`, `director_activity_review`, `pi_final_authorization`; then `processed_by` for the finance action. Control note: the form is an authorization request and does not replace procurement procedures where thresholds or competitive sourcing apply.

### 5.8 IM-08 Internal Memorandum: Issue, Recommendation and Management Decision

| Field key | Type | Required | Rule or source |
| --- | --- | --- | --- |
| `memo_reference_name`, `department_office` | text, ref | yes |  |
| `date_submitted`, `version` | date, text | auto | Version starts at 1.0 |
| `issue_description` | textarea | yes | Issue, background, urgency, operational implication, references |
| `recommendation` | textarea | yes | Proposed solution and reason |
| `decision_advice` | textarea | at decision |  |
| `decision_status` | radio | at decision | approved, approved with conditions, further information required, not approved |
| `priority` | radio | at decision | immediate, high, routine |
| `target_date` | date | no |  |
| `action_types` | checkbox\_group | at decision | internal administrative action, procurement process, single source justification or approval, consultant or professional expert, service provider, goods or supplies, other |
| `single_source_justification` | file | when single source is ticked | Required before approval |
| `follow_up` (D) | table, 1 to 3 | yes | `staff` (user\_ref), `action_assigned`, `due_date` |

Signature slots: `originating_staff`, `superior`. After approval, each `follow_up` user gets a task and a notification. Choosing a procurement action offers to create a PR-01 prefilled from the memo. Control note: the memo does not replace procurement, finance, HR, contracting or safeguarding approvals.

### 5.9 Supplier contract (Financial Contract for Event Management Service Tools, Communication Materials and Other Supplies)

The contract is a document template with variables and fixed clauses, generated from the case and the approved PO.

| Part | Type | Source |
| --- | --- | --- |
| Contractor block | fixed text | AfS-Rwanda as principal implementer of OFAB Rwanda Chapter |
| Supplier block: name, address, email, telephone, TIN or ID | supplier\_ref | Supplier record |
| Scope of services | table, 8 rows | Three free text columns per row, as on the printed form |
| Contract value | money | Set from the approved evaluation amount; template text says value is agreed before work starts |
| Tax declaration | fixed clause | Tax exclusive basis; supplier handles its own tax obligations |
| Payment terms | clause with parameters | `advance_percent` = 50 within `advance_days` = 2 of proforma approval; balance after final invoice and completion |
| Delivery, liability, confidentiality, acceptance | fixed clauses | Template text, versioned |

Signature slots: `afs_signatory` (name, position, date) and `supplier_signatory` (name, position, date). The supplier signs through a single use link, without an account. The wording is reproduced from the printed template without changes.

## 6. Data model

PostgreSQL schema. Form content lives in JSONB validated against the template, while everything the workflow must query (state, signers, amounts, dates) is in typed columns. Primary keys are UUIDs.

```sql
-- identity
CREATE TABLE users (
  id uuid PRIMARY KEY, email citext UNIQUE NOT NULL, full_name text NOT NULL,
  position text, department_id uuid REFERENCES departments(id),
  password_hash text, totp_secret text, active boolean DEFAULT true,
  created_at timestamptz DEFAULT now());
CREATE TABLE departments (id uuid PRIMARY KEY, name text UNIQUE NOT NULL, head_user_id uuid);
CREATE TABLE roles (code text PRIMARY KEY, description text);
CREATE TABLE user_roles (user_id uuid REFERENCES users(id), role_code text REFERENCES roles(code),
  PRIMARY KEY (user_id, role_code));
CREATE TABLE role_permissions (role_code text REFERENCES roles(code), permission text,
  PRIMARY KEY (role_code, permission));

-- reference data
CREATE TABLE budget_lines (id uuid PRIMARY KEY, code text UNIQUE, project text, available numeric(14,2), currency char(3));
CREATE TABLE suppliers (id uuid PRIMARY KEY, name text NOT NULL, tin_or_reg_no text, contact_person text,
  phone text, email text, address text);

-- templates
CREATE TABLE form_templates (id uuid PRIMARY KEY, code text NOT NULL, version int NOT NULL,
  schema jsonb NOT NULL, signature_slots jsonb NOT NULL, workflow jsonb NOT NULL,
  active boolean DEFAULT true, UNIQUE (code, version));

-- case and documents
CREATE TABLE cases (id uuid PRIMARY KEY, request_no text UNIQUE NOT NULL, project text,
  budget_line_id uuid REFERENCES budget_lines(id), requested_by uuid REFERENCES users(id),
  required_by date, status text NOT NULL, current_stage text NOT NULL,
  selected_supplier_id uuid REFERENCES suppliers(id), approved_amount numeric(14,2), currency char(3),
  created_at timestamptz DEFAULT now(), closed_at timestamptz);
CREATE TABLE documents (id uuid PRIMARY KEY, case_id uuid REFERENCES cases(id),
  template_id uuid REFERENCES form_templates(id), doc_type text NOT NULL,
  state text NOT NULL, data jsonb NOT NULL, version int NOT NULL DEFAULT 1,
  content_hash char(64), pdf_object_key text, created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE attachments (id uuid PRIMARY KEY, case_id uuid REFERENCES cases(id),
  document_id uuid REFERENCES documents(id), kind text, filename text, mime text,
  size_bytes bigint, sha256 char(64), object_key text, uploaded_by uuid, uploaded_at timestamptz DEFAULT now());

-- signing
CREATE TABLE signature_slots (id uuid PRIMARY KEY, document_id uuid REFERENCES documents(id),
  slot_key text NOT NULL, role_code text NOT NULL, seq int NOT NULL,
  assigned_user_id uuid REFERENCES users(id), external_email text,
  status text NOT NULL, -- pending | waiting | signed | declined | skipped
  UNIQUE (document_id, slot_key));
CREATE TABLE signatures (id uuid PRIMARY KEY, slot_id uuid UNIQUE REFERENCES signature_slots(id),
  signer_user_id uuid, signer_name text, method text, -- draw | type | upload
  signature_image_key text, signed_at timestamptz NOT NULL, ip inet, user_agent text,
  document_hash char(64) NOT NULL, declaration_text text);
CREATE TABLE signing_tokens (id uuid PRIMARY KEY, slot_id uuid REFERENCES signature_slots(id),
  token_hash char(64) UNIQUE, expires_at timestamptz, used_at timestamptz);

-- notifications and audit
CREATE TABLE notifications (id uuid PRIMARY KEY, user_id uuid, kind text, payload jsonb,
  channel text, status text, created_at timestamptz DEFAULT now(), sent_at timestamptz, read_at timestamptz);
CREATE TABLE audit_events (id bigserial PRIMARY KEY, at timestamptz DEFAULT now(),
  actor_user_id uuid, actor_ip inet, action text NOT NULL, object_type text, object_id uuid,
  case_id uuid, detail jsonb, prev_hash char(64), event_hash char(64));
```

**Relationships.** A case has many documents (one per form type, one or more versions); a document has many signature slots; a slot has at most one signature; attachments belong to a case and optionally a document. New documents copy shared values from `cases` when created, so a change to the case after signing creates a new document version instead of changing a signed one.

**Indexes and constraints.** Index `documents(case_id, doc_type)`, `signature_slots(assigned_user_id, status)` for the my actions list, `audit_events(case_id, at)`, and a partial unique index on active template `(code)`. `audit_events` has no UPDATE or DELETE grant for the application database user.

## 7. Workflow engine

The workflow engine owns the lifecycle of a case and its documents. A case moves through the stages in the diagram; each stage creates one document from its template, assigns its signature slots in order, and advances only when every guard passes. The engine reads the `workflow` JSON stored on each template, so routing can change without a deployment.

```json
{
  "doc_type": "QE-03",
  "slots": [
    {"key": "reviewer_1", "role": "requesting_staff", "seq": 1, "mode": "parallel_group:eval"},
    {"key": "reviewer_2", "role": "director_comms",   "seq": 1, "mode": "parallel_group:eval"},
    {"key": "reviewer_3", "role": "pi",               "seq": 1, "mode": "parallel_group:eval"}
  ],
  "guards_on_submit": ["min_quotations:2", "reviewers_distinct", "conflict_confirmed"],
  "on_complete": {"next_stage": "purchase_order", "create_document": "PO-09"}
}
```

Slots with the same `seq` and a `parallel_group` can sign in any order; slots with higher `seq` wait for the lower ones. QE-03 uses a parallel group because the form says all three reviewers should sign, without an order.

&#91;embedded content: procurement workflow · 8 steps, 1 optional start\]

## 8. State machine and transitions

Two state machines run together: one per document and one per case. Every transition is a single database transaction that also writes an audit event and queues notifications.

**Document states**

| From | Event | To | Guard | Side effects |
| --- | --- | --- | --- | --- |
| `draft` | `submit` | `in_signing` | Template validation passes; user may edit this document | Compute `content_hash`, freeze `data`, create slots, notify first signer |
| `in_signing` | `sign` | `in_signing` or `signed` | Signer owns the next open slot; declaration ticked; hash matches | Store signature, notify next slot, or complete |
| `in_signing` | `decline` | `returned` | Reason required | Notify creator and previous signers |
| `in_signing` | `edit_request` | `returned` | Creator or Accountant | Void collected signatures (kept in audit) |
| `returned` | `revise` | `draft` | Creator | New `version`, copy data |
| `signed` | `finalize` | `archived` | All slots signed | Generate PDF, store hash and object key |
| any open state | `cancel` | `cancelled` | `admin` or creator before first signature | Close slots |

**Case stages**

| Stage | Entered when | Exit guard (all must hold) |
| --- | --- | --- |
| `requisition` | Case created from PR-01 | PR-01 `signed` |
| `quotation` | PR-01 signed | QC-02 `signed` with 2 or more quotation files |
| `market_check` | QC-02 signed, if required by the template or Accountant | MPV-03 `signed` (skipped if not required) |
| `evaluation` | Quotations (and market check) complete | QE-03 `signed` by three distinct users; recommended supplier is one of the QC-02 suppliers |
| `purchase_order` | QE-03 signed | PO-09 `signed`; contract `signed` when the order type needs one |
| `delivery` | PO-09 signed | Delivery date, invoice and delivery note recorded |
| `payment` | Delivery data complete | PA-04 `signed` by requesting staff, Accountant, CFM |
| `closed` | PA-04 signed | Purchase file PDF built and stored |
| `cancelled` | Any stage | Reason recorded; no further transitions |

GR-06 and IM-08 use the same document machine without a case: GR-06 ends in a finance action record, IM-08 in a decision record with follow up tasks. An approved IM-08 with a procurement action can spawn a case through `POST /memos/{id}/create-case`.

## 9. Validation and enforcement rules

Rules written in the footers and control notes of the forms become named guards. A guard is a pure function `(case, document, actor) -> ok | error(code, message)` run on submit, sign or stage change. Guard names are referenced from the template `workflow` JSON.

| Guard code | Rule | Source | Check |
| --- | --- | --- | --- |
| `template_valid` | Required fields filled, types and ranges valid | All forms | JSON Schema validation on the server |
| `min_quotations:2` | At least two quotation files attached | QC-02 | `count(quotations where attachment is not null) >= 2` |
| `reviewers_distinct` | Three different reviewers on QE-03; delegate used when the requester is director or PI | QE-03 | `count(distinct signer) = 3` |
| `conflict_confirmed` | Conflict of interest or verifier declaration ticked before signing | QC-02, QE-03, MPV-03 | Required boolean on the signing request |
| `supplier_in_quotations` | Recommended supplier appears in QC-02 | QE-03 | Foreign key check against quotations |
| `amount_within_approved` | Payable amount not above approved PO amount unless exception recorded | PA-04 | `amount_payable <= approved_amount OR exception_text` |
| `po_from_approved_eval` | PO can only be created from a fully signed QE-03 | PO-09 | Case stage check |
| `budget_confirmed` | Accountant confirms budget availability | PR-01, PA-04 | `ctrl_budget_confirmed = true` |
| `payment_after_delivery` | PA-04 cannot be signed before delivery date, invoice and delivery note exist, unless `advance_arrangement` is set on the case by the CFM with a reason (a case flag, not a form field) | PA-04 and contract | Field presence plus advance flag |
| `requisition_not_payment` | PR-01 never moves a case to the payment stage | PR-01 | Stage machine has no such edge |
| `single_source_requires_justification` | Single source option needs an uploaded justification before the memo is approved | IM-08 | File presence check |
| `distance_notice` | A journey between 30 km and 70 km shows the form's distance control note to the approver before authorization | GR-06 | `Notice shown on the approval screen, no extra field` |
| `no_duplicate_signature` | A user cannot sign the same slot twice or sign slots that would break `reviewers_distinct` | All forms | Unique constraint on `signatures(slot_id)` plus the guard |
| `frozen_after_sign` | Document data cannot change after the first signature | All forms | Write rejected when `state` is not `draft` |

Guard failures return HTTP 422 with `code` and a plain message, and are shown next to the field or button that caused them.

## 10. E-signature service

The signature service turns a frozen document into a verifiable record. It is an internal module of the application layer, not a separate product, and it supports internal users (logged in) and external signers (single use link).

**Document hash**

On `submit`, the service builds a canonical JSON of `{template_code, template_version, data, attachment_hashes}` with sorted keys and no whitespace, and stores its SHA-256 as `documents.content_hash`. Every signature stores the hash it signed. Verification recomputes the hash and compares.

**Signing sequence (internal signer)**

1. Signer opens `GET /signing/tasks`; the API returns slots with `status = pending` for that user.
2. Client loads `GET /documents/{id}` and the rendered PDF preview.
3. Signer ticks the declaration, chooses a method (draw, type, saved signature) and calls `POST /documents/{id}/slots/{slotKey}/sign` with the signature image or text and the `content_hash` it displayed.
4. Server checks: session and second factor, slot belongs to the user and is next in order, document in `in_signing`, submitted hash equals stored hash, guards from section 9.
5. In one transaction: insert `signatures` (signer, time, IP, user agent, hash), set slot `signed`, write `audit_events`, and either open the next slot or set the document `signed`.
6. After commit, queue jobs: notify next signer, or generate the final PDF.

**Signing sequence (external signer, supplier contract)**

1. When the contract reaches the supplier slot, the service creates a random 256 bit token, stores only its SHA-256 in `signing_tokens`, sets expiry, and emails a link.
2. `GET /sign/{token}` returns the contract and slot without a login, rate limited by IP and token.
3. `POST /sign/{token}` accepts the signature; the token is marked `used_at` and cannot be reused. An email or SMS one time code can be required before signing.

**PDF generation**

A worker renders the template to PDF, stamps each signature image with signer name and time in the signature slot positions defined by the template, appends an audit page (signers, times, IPs, hashes, event chain head), and stores the file in object storage with `sha256` recorded. The case close step merges all signed PDFs and attachments into one purchase file.

**Verification**

`GET /verify/{documentId}` recomputes the content hash, checks that the stored PDF hash matches, and validates the audit event hash chain for that case. The result is pass or fail with the failing record. A QR code on the PDF audit page points to this endpoint.

**Signature level.** This design is a simple electronic signature with identity, time, intent and integrity evidence. If a donor or law requires an advanced or qualified signature, the PDF step can be extended with certificate based signing (PAdES) without changing the data model.

## 11. REST API design

JSON over HTTPS, versioned under `/api/v1`, described in OpenAPI 3. Access token in the `Authorization: Bearer` header. List endpoints use cursor pagination (`?limit=&cursor=`) and filters. Errors use one shape: `{"error": {"code": "guard.min_quotations", "message": "...", "fields": {...}}}`.

| Method and path | Purpose | Roles |
| --- | --- | --- |
| `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/totp` | Session and second factor | all |
| `GET /me` | Current user, roles, permissions | all |
| `GET /templates`, `GET /templates/{code}` | Template schema and slots | all |
| `POST /cases` | Create case with PR-01 draft | staff roles |
| `GET /cases`, `GET /cases/{id}` | List and detail with stage, documents, next signer | by object rule |
| `GET /cases/{id}/timeline` | Stages, documents and audit summary | by object rule |
| `POST /cases/{id}/cancel` | Cancel with reason | creator, admin |
| `POST /cases/{id}/documents` | Create the next document of the case (`doc_type`) | by stage |
| `GET /documents/{id}`, `PATCH /documents/{id}` | Read, or update draft `data` (partial, validated) | owner or assigned |
| `POST /documents/{id}/submit` | Validate, freeze, hash, start signing | owner |
| `POST /documents/{id}/slots/{slotKey}/sign` | Sign a slot | slot owner |
| `POST /documents/{id}/slots/{slotKey}/decline` | Decline with reason | slot owner |
| `POST /documents/{id}/revise` | New draft version after return | owner |
| `GET /documents/{id}/pdf` | Download current or final PDF | by object rule |
| `POST /cases/{id}/quotations`, `PATCH`, `DELETE` | Manage QC-02 rows and files | accountant |
| `POST /attachments` | Upload (multipart or pre signed URL); returns id and sha256 | by case |
| `POST /memos/{id}/create-case` | Spawn a case from an approved IM-08 | requester |
| `GET /signing/tasks` | My pending signature slots | all signers |
| `GET /sign/{token}`, `POST /sign/{token}` | External signer view and sign | token holder |
| `GET /verify/{documentId}` | Integrity check | authenticated or QR |
| `GET /notifications`, `POST /notifications/{id}/read` | In app list | all |
| `GET /audit?case_id=&actor=&from=&to=` | Audit search and export | audit roles |
| `GET /reports/open-cases`, `/reports/cycle-time`, `/reports/spend` | Reports | accountant, pi, cfm |
| `GET/POST/PATCH /admin/users`, `/admin/departments`, `/admin/templates`, `/admin/budget-lines`, `/admin/suppliers` | Administration | admin |

**Example: sign a slot**

```json
POST /api/v1/documents/9f2c.../slots/reviewer_3/sign
{
  "content_hash": "b1946ac92492d2347c6235b4d2611184...",
  "declaration_accepted": true,
  "conflict_confirmed": true,
  "method": "draw",
  "signature_image": "data:image/png;base64,iVBORw0..."
}

200 OK
{
  "document_state": "signed",
  "signed_at": "2026-10-14T09:12:44Z",
  "next_slots": []
}
```

Use idempotency keys (`Idempotency-Key` header) on `submit` and `sign` so a retry after a network drop cannot sign twice.

## 12. Notifications and background jobs

Slow or external work runs in a queue so API calls stay fast. Jobs are idempotent and retried with backoff; failures after the retry limit go to a dead letter queue and raise an alert.

| Job or event | Trigger | Action |
| --- | --- | --- |
| `notify.sign_requested` | Slot becomes next | Email with a link to the signing page; create in app notification |
| `notify.returned` | Decline or edit request | Email to creator with the reason |
| `notify.completed` | Document `signed` or case `closed` | Email to creator and all signers with the PDF link |
| `notify.followup` | IM-08 approved | Email each follow up user with action and due date |
| `job.reminder` | Scheduled, daily | Remind signers whose slot has been pending past the configured days |
| `job.expiry` | Scheduled, daily | Warn on quotation validity or delivery dates that are near |
| `job.pdf.render` | Document `signed` | Render, stamp, store, record hash |
| `job.pdf.case_file` | Case `closed` | Merge documents and attachments into one file |
| `job.token.cleanup` | Scheduled | Delete expired signing tokens |
| `job.backup.verify` | Scheduled | Check that the latest backup restores |

**Email templates.** Stored as versioned templates with variables (`{{signer_name}}`, `{{document_title}}`, `{{requester}}`, `{{link}}`). Each message contains one action button and a plain text fallback. Sending goes through an adapter interface (`send(to, subject, html, text)`) so the Google Workspace sender is one implementation that can be replaced by configuration.

**Google Workspace email.** All notifications and invitations are sent from one dedicated sender address on the organization's domain. Two supported methods, chosen by configuration: (1) the Google Workspace SMTP relay, where the Workspace admin allows the VPS public IP address, or (2) the Gmail API with a service account that has domain wide delegation limited to sending. Either way, SPF, DKIM and DMARC must be set for the domain so that messages are not marked as spam.

**Delivery tracking.** The `notifications` table records `status` (queued, sent, failed) and `sent_at`. A bounce or failure is shown on the case page so the requester can contact the signer another way.

## 13. Audit logging and security

**Audit log.** Every state transition, signature, decline, login, permission change, download and admin action writes one row to `audit_events` with actor, IP, object, case and a JSON `detail`. Rows are chained: `event_hash = SHA256(prev_hash || canonical(row))`, so a removed or edited row breaks the chain, which `GET /verify` checks. The application database user has INSERT and SELECT only on this table. A nightly job exports a signed checkpoint of the latest `event_hash` to object storage.

**Security controls**

| Area | Control |
| --- | --- |
| Transport | TLS 1.2 or higher everywhere; HSTS; internal service traffic inside a private network |
| Authentication | Accounts created only by the admin, no self registration; Argon2id password hashes; TOTP second factor required for approver roles; account lock after repeated failures; session timeout |
| Authorization | Central permission check plus object level rule on every endpoint; deny by default |
| Input handling | Schema validation on every request; parameterized queries only; output encoding in the client; upload type, size and malware scan |
| Files | Files kept outside the web root on an encrypted volume, downloads only through the API with a permission check, SHA-256 recorded for every file |
| Secrets | Kept in environment files or Docker secrets readable only by the service user, never in the repository; rotated on a schedule |
| External signing links | 256 bit random token, hash stored, single use, short expiry, rate limit |
| Data protection | Personal data limited to name, email, position, phone; retention and deletion rules by document type |
| Hardening | Security headers, CORS allow list, CSRF protection for cookie sessions, dependency scanning in CI |
| Backups | Nightly database dump plus WAL archiving and a copy of the file volume to a second location off the VPS; restore tested before go live |

## 14. Deployment and non functional requirements

**Environments.** `dev` (local containers), `test` (a second Compose stack, seeded with sample forms and users) and `prod` on the organization's VPS. The same images run in every environment; configuration comes from environment files readable only by the service user. Database migrations run as a deploy step before the new containers start and are written to be backward compatible for one release.

**Runtime topology**

- One Linux VPS running Docker Compose: reverse proxy with automatic TLS, API container, worker container, PostgreSQL and Redis.
- Firewall allows 80 and 443 to everyone and SSH only from administrator addresses; SSH by key only, root login disabled, brute force protection on.
- PostgreSQL and Redis listen only on the internal Docker network, never on the public interface.
- Files on a separate encrypted volume mounted into the API and worker containers.
- Backups: nightly database dump, WAL archiving and a copy of the file volume, encrypted and sent off the VPS; restore tested on a schedule.
- Automatic operating system security updates; disk, memory and certificate expiry alerts.
- One host means downtime until restore if the VPS fails. The scale path is a second VPS for the database, then more API containers behind the proxy.

**Targets**

| Area | Target |
| --- | --- |
| API latency | 95th percentile under 500 ms for reads and form saves; signing under 2 s excluding PDF work |
| PDF generation | Under 10 s per document, run in the background |
| Availability | 99% during working hours; health and readiness endpoints on every service |
| Recovery | Nightly backups plus WAL archiving to an off VPS location; restore tested; recovery point under 15 minutes for the database |
| Capacity | Sized for dozens of concurrent users and hundreds of cases a year, scale out by adding API replicas |
| Weak connectivity | Draft autosave every few seconds, resumable uploads, small page payloads |
| Browser support | Current Chrome, Edge, Firefox, Safari; Android and iOS browsers |
| Observability | JSON logs with request id and user id, metrics (request rate, errors, queue depth, job failures), alerts on error rate and dead letters |
| Testing | Unit tests for guards and state machines, contract tests against the OpenAPI file, end to end tests for the full case path, load test on signing and PDF jobs |
| Maintainability | Template driven forms; code split by service module; migrations in version control; API documentation generated from the OpenAPI file |

## 15. Implementation milestones

The build order delivers the signing engine and the first forms early, then adds the rest of the template set on top of it. Phases are in order, not dated.

&#91;embedded content: roadmap · 5 phases, 3 gates\]

**Technical deliverables per phase**

1. **Discover and design.** Finalize template JSON for the nine forms (section 5); OpenAPI file for section 11; schema migrations for section 6; clickable wireframes; decide the signature level.
2. **Core build.** Admin managed accounts with TOTP, RBAC, users and departments; template engine and form renderer; case and document services; workflow engine with the state machines; PR-01, QC-02, QE-03, PO-09; signature service, audit chain and Google Workspace email notifications; CI pipeline and the test environment.
3. **Full chain.** MPV-03, PA-04, GR-06, IM-08; contract template and external signing token flow; PDF stamping, audit page and case file merge; reports endpoints; reminder and expiry jobs.
4. **Pilot.** VPS setup and hardening, production environment, backups and restore test, monitoring and alerts, load and security tests, data seeding (users, budget lines, suppliers), pilot with one team and defect fixing.
5. **Later (not committed).** Payment and accounting integration, WhatsApp or SMS channel, public API keys, certificate based signing, supplier performance reports.
