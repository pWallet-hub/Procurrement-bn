# Procurrement-bn

Backend for the **AfS Rwanda Digital Procurement and E-Signature System** (spec: `AfS Rwanda Digital Procurement and E-Signature System Project Document.md`).
NestJS + TypeScript, PostgreSQL, Redis (BullMQ), SeaweedFS (S3 files, replaces the unmaintained MinIO), Mailpit (dev mail). Everything runs in Docker.

## Run

```bash
cp .env.example .env          # first time; change the host ports at the bottom if they clash
docker compose up -d --build  # api + worker + postgres + redis + storage (SeaweedFS) + mailpit
curl localhost:${API_PORT:-3000}/api/v1/health
```

Migrations and the seed (roles, permissions, the nine form templates, demo users/budget lines/suppliers) run automatically when the API starts.

| Service | Default URL |
| --- | --- |
| API | http://localhost:3000/api/v1 |
| Mailpit (all e-mails, invite and signing links) | http://localhost:8025 |
| S3 API (SeaweedFS, keys `afsstorage` / `afsstorage_dev_secret`) | http://localhost:8333 |
| PostgreSQL (`afs` / `afs_dev_password`, db `afs`) | localhost:5432 |

Demo accounts (password `Passw0rd!dev`, no TOTP in dev): `admin@`, `staff@` (requesting staff), `accountant@`, `director.comms@`, `director.dept@`, `pi@`, `cfm@`, `verifier@`, `superior@` + `afs.local`.

## Test

```bash
npm test                                   # unit tests: template validation, computed fields, hashing, audit chain
API=http://localhost:3000/api/v1 MAILPIT_PORT=8025 node scripts/e2e.mjs   # full case end to end against the running stack
```
The e2e drives PR-01 -> QC-02 -> MPV-03 -> QE-03 -> PO-09 -> supplier contract (external token signing) -> delivery -> PA-04 -> closed, then IM-08, PDF, verify and tamper checks.

## Layout

```
db/migrations/        SQL schema (spec section 6) - run in order on start
src/templates/        form templates as data (definitions/), computed fields, validation
src/workflow/         case stage machine + named guards (spec sections 7-9)
src/documents/        drafts, submit/freeze/hash, signing, return/revise, prefill from case
src/cases/            cases, timeline, delivery, cancel
src/audit/            hash chained append-only audit log
src/auth/ common/     login + TOTP + invites, permissions (role -> permission rows), access rule
src/pdf/              PDF render + signature stamping + audit page + case file merge
src/notifications/    queue, e-mail adapter and templates
src/worker.ts         background jobs (email, pdf, reminders, expiry, cleanup, audit checkpoint)
```

API contract used by the frontend: `../docs/API-CONTRACT.md`.

## Key behaviours

- **Forms are data.** Change a form by editing `src/templates/definitions/*` and bumping `version` (a version already used by documents is never rewritten).
- **Fields filled at a later signature** (`fill_at`): IM-08 decision, GR-06 finance action. They are stored with that signature, not in the frozen hash.
- **Frozen once submitted**: SHA-256 of `{template, version, data, attachment hashes}`; every signature stores the hash it signed; `GET /verify/:id` is public.
- **Audit**: chained hashes, UPDATE/DELETE/TRUNCATE blocked by DB triggers.
- **Roles / delegates**: slots are role based; `POST /documents/:id/slots/:slot/assign` sets a delegate (QE-03 when the requester is a director or PI).

## Production notes (not done yet)

TLS reverse proxy (Caddy) and firewall, real secrets, `TOTP_REQUIRED=true`, `NODE_ENV=production` (no demo seed, no invite links in responses), Google Workspace SMTP relay settings, nightly `pg_dump` + WAL archiving off the VPS, malware scan on upload (hook marked TODO), OpenAPI file, CI pipeline.
