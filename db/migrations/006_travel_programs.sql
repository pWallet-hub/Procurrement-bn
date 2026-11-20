-- Travel clearance (TC-10) rework.
-- Programs: a TC-10 names one of the programs kept here instead of free text. Seeded from the projects of the budget
-- lines and from the programs typed on earlier clearances, so nothing has to be entered twice.
CREATE TABLE programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name citext UNIQUE NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO programs (name)
  SELECT DISTINCT btrim(project) FROM budget_lines WHERE btrim(COALESCE(project, '')) <> ''
  ON CONFLICT (name) DO NOTHING;
INSERT INTO programs (name)
  SELECT DISTINCT btrim(data->>'program') FROM documents
   WHERE doc_type = 'TC-10' AND btrim(COALESCE(data->>'program', '')) <> ''
  ON CONFLICT (name) DO NOTHING;

-- Saved traveller details (ID, bank account, function), so a clearance does not ask for them every time.
-- Staff are keyed by their account; external travellers by their ID document.
CREATE TABLE traveller_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  id_type text,
  id_number text,
  account_number text,
  function text,
  email text,                               -- external travellers: where their clearance is sent (staff: account e-mail)
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX traveller_profiles_external ON traveller_profiles (id_type, id_number) WHERE user_id IS NULL;

-- the details of the latest clearance of each staff traveller
INSERT INTO traveller_profiles (user_id, full_name, id_type, id_number, account_number, function)
SELECT DISTINCT ON (u.id) u.id, u.full_name, d.data->>'id_type', d.data->>'id_number', d.data->>'account_number', d.data->>'function'
  FROM documents d JOIN users u ON u.id::text = d.data->>'issued_to'
 WHERE d.doc_type = 'TC-10' AND d.state <> 'cancelled'
 ORDER BY u.id, d.updated_at DESC
ON CONFLICT DO NOTHING;
-- and of each external traveller
INSERT INTO traveller_profiles (full_name, id_type, id_number, account_number, function)
SELECT DISTINCT ON (d.data->>'id_type', d.data->>'id_number') d.data->>'issued_to_name', d.data->>'id_type', d.data->>'id_number', d.data->>'account_number', d.data->>'function'
  FROM documents d
 WHERE d.doc_type = 'TC-10' AND d.state <> 'cancelled' AND d.data->>'traveller_type' = 'external'
   AND btrim(COALESCE(d.data->>'issued_to_name', '')) <> '' AND btrim(COALESCE(d.data->>'id_number', '')) <> ''
 ORDER BY d.data->>'id_type', d.data->>'id_number', d.updated_at DESC
ON CONFLICT DO NOTHING;

-- Fingerprint of the paper layout a stored PDF was drawn with. When the layout of a form changes, the worker draws the
-- stored PDFs again so archived documents look like the current form (the layout is outside the document hash).
ALTER TABLE documents ADD COLUMN pdf_layout char(64);
