-- AfS Rwanda procurement: initial schema (spec section 6)
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  head_user_id uuid
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE NOT NULL,
  full_name text NOT NULL,
  position text,
  department_id uuid REFERENCES departments(id),
  password_hash text,
  totp_secret text,
  totp_enabled boolean NOT NULL DEFAULT false,
  failed_logins int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  signature_image_key text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (code text PRIMARY KEY, description text);
CREATE TABLE user_roles (
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  role_code text REFERENCES roles(code),
  PRIMARY KEY (user_id, role_code)
);
CREATE TABLE role_permissions (
  role_code text REFERENCES roles(code),
  permission text,
  PRIMARY KEY (role_code, permission)
);

-- invitations and password resets (token stored as sha256)
CREATE TABLE user_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,                       -- invite | reset
  token_hash char(64) UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL, project text,
  available numeric(14,2) NOT NULL DEFAULT 0, currency char(3) NOT NULL DEFAULT 'RWF',
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, tin_or_reg_no text, contact_person text, phone text, email text, address text,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE form_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL, version int NOT NULL, title text NOT NULL, description text,
  schema jsonb NOT NULL, signature_slots jsonb NOT NULL, workflow jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (code, version)
);
CREATE UNIQUE INDEX form_templates_one_active ON form_templates (code) WHERE active;

CREATE SEQUENCE request_no_seq START 1;
CREATE SEQUENCE po_no_seq START 1;

CREATE TABLE cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_no text UNIQUE NOT NULL,
  project text,
  budget_line_id uuid REFERENCES budget_lines(id),
  requested_by uuid NOT NULL REFERENCES users(id),
  department_id uuid REFERENCES departments(id),
  required_by date,
  status text NOT NULL DEFAULT 'open',      -- open | closed | cancelled
  current_stage text NOT NULL DEFAULT 'requisition',
  market_check_required boolean NOT NULL DEFAULT false,
  contract_required boolean NOT NULL DEFAULT false,
  advance_arrangement jsonb,
  selected_supplier_id uuid REFERENCES suppliers(id),
  approved_amount numeric(14,2),
  currency char(3),
  delivery jsonb,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES cases(id),         -- null for GR-06 and IM-08
  template_id uuid NOT NULL REFERENCES form_templates(id),
  doc_type text NOT NULL,
  state text NOT NULL DEFAULT 'draft',       -- draft | in_signing | signed | returned | archived | cancelled
  data jsonb NOT NULL DEFAULT '{}',
  version int NOT NULL DEFAULT 1,
  content_hash char(64),
  pdf_object_key text,
  pdf_sha256 char(64),
  returned_reason text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_case_type ON documents (case_id, doc_type);

CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES cases(id),
  document_id uuid REFERENCES documents(id),
  kind text, filename text NOT NULL, mime text, size_bytes bigint, sha256 char(64) NOT NULL,
  object_key text NOT NULL,
  uploaded_by uuid REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE signature_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id),
  slot_key text NOT NULL, label text NOT NULL, role_code text NOT NULL, seq int NOT NULL,
  grp text, declaration text,
  assigned_user_id uuid REFERENCES users(id), external_email text,
  status text NOT NULL,                      -- pending | waiting | signed | declined | skipped
  voided_at timestamptz,
  UNIQUE (document_id, slot_key)
);
CREATE INDEX slots_user_status ON signature_slots (assigned_user_id, status);

CREATE TABLE signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid UNIQUE NOT NULL REFERENCES signature_slots(id),
  signer_user_id uuid REFERENCES users(id), signer_name text NOT NULL,
  method text NOT NULL,                      -- draw | type | upload
  signature_image_key text, signature_text text,
  signed_at timestamptz NOT NULL DEFAULT now(), ip inet, user_agent text,
  document_hash char(64) NOT NULL, declaration_text text
);

CREATE TABLE signing_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL REFERENCES signature_slots(id),
  token_hash char(64) UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL, used_at timestamptz
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id), email text,
  kind text NOT NULL, payload jsonb NOT NULL DEFAULT '{}',
  channel text NOT NULL DEFAULT 'email', status text NOT NULL DEFAULT 'queued',  -- queued | sent | failed
  error text,
  created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, read_at timestamptz
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);

CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid, actor_ip inet,
  action text NOT NULL, object_type text, object_id uuid, case_id uuid,
  detail jsonb, prev_hash char(64), event_hash char(64) NOT NULL
);
CREATE INDEX audit_case_at ON audit_events (case_id, at);

-- append only: nobody (including the app user) may change or delete audit rows
CREATE FUNCTION audit_events_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_events is append only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_immutable();

CREATE TABLE idempotency_keys (
  key text NOT NULL, user_id uuid NOT NULL, route text NOT NULL,
  response jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, user_id, route)
);

CREATE TABLE audit_checkpoints (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  last_event_id bigint NOT NULL, event_hash char(64) NOT NULL
);
