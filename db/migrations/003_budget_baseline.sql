-- budget lines: internal vs external (donor) funding and the approved baseline the available balance is measured against
ALTER TABLE budget_lines
  ADD COLUMN funding_source text NOT NULL DEFAULT 'internal' CHECK (funding_source IN ('internal', 'external')),
  ADD COLUMN funder text,
  ADD COLUMN baseline numeric(14,2);
UPDATE budget_lines SET baseline = available WHERE baseline IS NULL;
ALTER TABLE budget_lines ALTER COLUMN baseline SET NOT NULL, ALTER COLUMN baseline SET DEFAULT 0;
