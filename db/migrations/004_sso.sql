-- AFS single sign-on. external_id holds the Keycloak subject of the linked identity. Accounts that were never linked
-- keep their password sign-in, so nothing changes for them.
ALTER TABLE users ADD COLUMN external_id text UNIQUE;

-- One-time codes that hand a finished SSO sign-in from the API to the portal. Only the hash is stored.
CREATE TABLE sso_codes (
  code_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
