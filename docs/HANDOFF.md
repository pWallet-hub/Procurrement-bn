# AfS Rwanda Procurement and E-Signature System: project handoff

Written 2026-10-05 for the next agent or developer who continues this project on a new machine.
Read this file first, then `docs/API-CONTRACT.md`, then the spec (`docs/AfS Rwanda Digital Procurement and E-Signature System Project Document.md`).

## 1. What this is

A web system that digitises AfS-Rwanda's procurement paper forms and signing workflow:
nine forms (PR-01, QC-02, MPV-03, QE-03, PO-09, PA-04, GR-06, IM-08, supplier contract) are versioned **templates stored as data**; each purchase is a **Case** that moves through fixed stages with named rules (guards); every document is **frozen and hashed on submit**, signed in order (draw / type / upload / saved signature, or a single-use link for the external supplier), and every action goes into a **hash-chained, append-only audit log**. Signed documents are rendered to PDFs that look like the printed forms.

Roles: requesting_staff, accountant, director_comms, director_dept, pi, cfm, market_verifier, superior, admin (+ external supplier by token).

## 2. Repositories and what lives where

| Thing | Location | In git? |
| --- | --- | --- |
| Backend (NestJS API, worker, Docker stack) | `Procurrement-bn/`, remote `git@github.com:pWallet-hub/Procurrement-bn.git`, branch `main` | yes |
| Frontend (React + Vite + nginx) | `Procurrement-fn/`, remote `git@github.com:pWallet-hub/Procurrement-fn.git`, branch `main` | yes |
| Spec, API contract, reference PDFs, this file | parent folder (`docs/`, `temp/`, root `*.md`) | **no, the parent folder is not a repository** |

To avoid losing the non-git files, copies were placed in the backend repo under `Procurrement-bn/docs/` (this handoff, the API contract, the spec, `reference-forms/*.pdf`). **The copy inside the backend repo is the one to keep updated.** Commit them.

State at handoff: both repos have no uncommitted changes; the last commits are the saved-signature / drag-and-drop / date-default features.

## 3. Architecture in one page

```
Browser ──► Frontend (nginx serves the React app)
              │  VITE_API_BASE = absolute API URL (current live setup, needs CORS)  or  /api/v1 proxied by nginx (API_UPSTREAM)
              ▼
            API (NestJS, Procurrement-bn/src)  ◄── Worker (same image, node dist/worker.js: e-mail, PDFs, reminders, cleanup, audit checkpoint)
              │                                        │
   PostgreSQL 16 ── Redis (BullMQ queue) ── SeaweedFS (S3 files: attachments, signatures, PDFs) ── SMTP (Mailpit in dev)
```

Backend source map (`Procurrement-bn/src`):
- `templates/` forms as data: `definitions/{procurement,standalone,paper,index}.ts`, `computed.ts` (server-computed totals), `validate.ts`.
- `workflow/` `stages.ts` (case stages), `guards.ts` (named business rules), `workflow.service.ts` (stage transitions on signing).
- `documents/` `documents.service.ts` is the core: draft, submit (freeze + hash), sign (all methods), decline/return/revise/cancel, delegate assign, external token signing; `prefill.ts` copies data from case/earlier forms.
- `cases/`, `audit/` (hash chain), `auth/` (login, TOTP, invites, change password, saved signature), `admin/`, `attachments/` (+ `storage.service.ts` S3/local), `pdf/` (`paper-pdf.ts` mirrors the printed forms), `notifications/`, `worker.ts`, `db/` (migrate, seed), `common/` (errors, access rules, hashing).
- `db/migrations/*.sql` plain SQL migrations, applied in order at start.
- `scripts/e2e.mjs` end-to-end API test. `test/logic.spec.ts` unit tests.

Frontend map (`Procurrement-fn/src`): `api/` (typed client), `auth/`, `ui/` (primitives incl. `FileDropzone`, `PasswordInput`), `features/forms` (schema-driven form renderer), `features/paper` (PaperForm: on-screen replica of the printed forms), `features/signing` (signature input, saved signature, panel), `pages/`, `layout/`, `styles/` (theme tokens in `theme.css`). `scripts/ui-journey.mjs` is a Playwright browser test.

## 4. Key design rules (do not break these)

1. **Forms are data.** Change a form in `templates/definitions/*`, then **bump `VERSION` in `definitions/index.ts`** (currently 4). Seed never rewrites a version already used by documents; old documents keep their version.
2. **Frozen after submit.** Document data cannot change after `submit`; `content_hash` = SHA-256 of `{template, version, data, attachment hashes}`. Fields with `fill_at: "<slotKey>"` (IM-08 decision, GR-06 finance action) are filled at that signature and stored with it, outside the hash.
3. **All audit writes go through `AuditService.log`**, which takes an advisory lock inside a transaction. A past bug (writes outside a transaction) forked the chain; fixed, covered by the e2e concurrency step. Never write to `audit_events` any other way. DB triggers block UPDATE/DELETE.
4. **Guards return HTTP 422** with `{error:{code,message,fields}}`; all errors use that one shape.
5. **Saved signatures are copied** into each document at signing time; changing the account signature never alters past signatures.
6. **Object-level access** is one SQL fragment in `common/access.ts`; permissions are rows seeded from `auth/permissions.ts`.
7. In production (`NODE_ENV=production`) the API **refuses to start** with placeholder secrets or without `ADMIN_EMAIL`/`ADMIN_PASSWORD`, and no demo data/users are created.
8. Dates are stored ISO (`YYYY-MM-DD`, UTC); the UI shows dd/mm/yyyy. Date fields with `default:"today"` are prefilled on new drafts.

## 5. Run it locally

Backend (own folder, Docker only):
```bash
cd Procurrement-bn
cp .env.example .env          # first time. Change the host-port block at the bottom if ports clash
docker compose up -d --build  # api, worker, postgres, redis, storage (SeaweedFS), mailpit
curl localhost:${API_PORT:-3000}/api/v1/health
```
`docker-compose.override.yml` (local only) publishes ports; `docker-compose.yml` publishes none (Coolify-ready).
On the previous PC another project occupied 3000/5432/9000/8025/8080, so the local `.env` used API 3100, Postgres 5442, S3 8433, Mailpit 8125. The `.env` is git-ignored; recreate it from `.env.example` and pick free ports.

Frontend (own folder; talks to any API URL):
```bash
cd Procurrement-fn
npm install && npm run dev          # Vite; set VITE_API_PROXY=http://localhost:<api port> (see .env.example)
# or Docker:
API_UPSTREAM=http://host.docker.internal:<api port> WEB_PORT=8180 docker compose up -d --build
```

Demo accounts (dev/demo only, created outside production), all with password `Passw0rd!dev`:
`admin@`, `staff@` (requesting staff), `accountant@`, `director.comms@`, `director.dept@`, `pi@`, `cfm@`, `verifier@`, `superior@` + `afs.local`.
Mailpit (dev inbox) shows every e-mail, invite and supplier signing link.

## 6. Tests (run these before and after any change)

```bash
cd Procurrement-bn
npm test                                                     # 11 unit tests
API=http://localhost:3100/api/v1 MAILPIT_PORT=8125 COMPOSE_DIR=$PWD node scripts/e2e.mjs   # 124 checks; full case PR-01 -> closed + contract + IM-08 + saved signature + tamper + audit concurrency
```
e2e flags: `E2E_REMOTE=1` (against a deployed server: skips steps needing local Mailpit/Docker), `E2E_SOFT=1` (continue after failures and summarise), `COMPOSE_DIR` (folder whose compose project holds Postgres, used for the tamper test). **It creates test data**: only run against demo/test databases.

Browser test: `BASE=<frontend url> [API_DIRECT=<api url>] node Procurrement-fn/scripts/ui-journey.mjs` (needs `npm i playwright` somewhere and `npx playwright install chromium`; see the file header).

Testing pitfalls already hit:
- The password field has an eye button labelled "Show password", so `getByLabel(/password/i)` matches two elements: use `#password`.
- Users with a saved signature land on the **Saved** tab when signing; tests must click the **Draw** tab first (`ui-journey.mjs` does).
- The Profile signature card opens on **Draw**; its drop zone is under **Upload**. A user who already saved a signature sees Replace/Delete first.
- Repeated test runs add rows to the same draft (QC-02) and leave demo cases in `quotation` stage.

## 7. Deployment (Coolify) and current live state

Docs: `Procurrement-bn/DEPLOY.md`, `Procurrement-fn/DEPLOY.md`. Production variables for the backend: `NODE_ENV=production`, `APP_URL`, `CORS_ORIGINS`, `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (+ optional SMTP_*, MAIL_FROM, TOTP_REQUIRED).

Live URLs: backend `https://apipro.afs-rwanda.org` (API base `https://apipro.afs-rwanda.org/api/v1`), frontend `https://procurement.afs-rwanda.org`. Coolify itself is operated by the owner; agents have no access to it.

State when last tested (2026-10-05):
- The **backend was still on the demo setup**: demo logins (`admin@afs.local` etc. / `Passw0rd!dev`) worked on the public API, `NODE_ENV` was not production, invite links were returned in API responses, and the audit chain was forked at event 66 (old code). **Redeploy with the production variables, then wipe the Postgres volume** (clears demo users and the forked chain, which cannot be repaired). Re-verify with `E2E_REMOTE=1 ... e2e.mjs` and `GET /verify/<id>` (must say `ok:true`).
- The frontend works end to end **when the browser calls the API directly** (build arg `VITE_API_BASE=https://apipro.afs-rwanda.org/api/v1`, backend `CORS_ORIGINS=https://procurement.afs-rwanda.org`). That is the configuration the owner switched to.
- The nginx `/api` proxy inside the frontend container returned 502 on the server although the API is healthy. Cause not confirmed (suspected: container cannot reach its own server's public address, or the runtime variable). Diagnostics exist in the latest code: `/healthz/api` and `/healthz-upstream.txt` (DNS, port, HTTP result written at container start). Not needed while the direct-API setup is used.
- Not yet tested live: external supplier signing e-mail flow, real SMTP delivery, QE-03/PO-09/PA-04/MPV-03/contract screens.

## 8. Lessons and gotchas

- **SeaweedFS** (replaced MinIO): needs `-ip.bind=0.0.0.0`; health check must use `127.0.0.1` (not `localhost`); S3 keys come from env (`S3_ACCESS_KEY`/`S3_SECRET_KEY`) written to a config at start.
- **Compose**: `docker-compose.yml` must stay self-contained (no `env_file`, no published ports) because Coolify has no `.env`. Do not run the root `docker-compose.yml` and the backend one together (same ports). The root compose is an optional demo shortcut.
- **nginx → HTTPS API**: needs `proxy_set_header Host <api host>`, `proxy_ssl_server_name on`, `proxy_ssl_verify_depth 4` (Let's Encrypt chain is 3 deep), CA bundle in the image, `resolver_timeout`. Already in `nginx.conf`.
- **Port clashes** on the previous PC came from another project (homelink). Never stop or modify containers you did not create.
- The PDF header date and on-screen header date use the same rule (document's own date); keep them consistent.
- PDF tables do not repeat the header row when a table spans pages.
- The in-memory rate limiter (`common/auth.ts`) is per process; move to Redis if the API is scaled out.
- Printing: `@media print` CSS exists but was never exercised.

## 9. Backlog (suggested order)

1. **Production go-live**: variables, DB wipe, redeploy both, rerun e2e + UI journey against live, change the admin password, `TOTP_REQUIRED=true` for approver roles.
2. **E-mail**: Google Workspace SMTP relay (smtp-relay.gmail.com:587, allow server IP) + SPF/DKIM/DMARC; remove Mailpit from the live stack or protect it.
3. **Backups**: nightly `pg_dump` + WAL archiving off the server; copy of the storage volume; restore test (spec section 13/14).
4. **Review on screen** the forms not yet viewed: QC-02, QE-03, PA-04, MPV-03, contract; run print preview; dark mode; check the PDFs of QC-02/QE-03/PA-04/IM-08 visually (PR-01, PO-09, GR-06, MPV-03, contract were reviewed).
5. **Test live**: the supplier signing link end to end with real mail.
6. **OpenAPI file** generated from the API (spec section 11 asks for it); CI pipeline (lint, tests, build); malware scan hook on upload (marked TODO in `attachments.controller.ts`).
7. Admin features still read-only: template editing UI (templates are edited in code + version bump).
8. Nice to have: QE-03 delegate assignment tested only via API/UI component, reports are plain tables, Kinyarwanda/English UI, payment/accounting integration (spec phase 5).
9. **Project name** is undecided. Suggestions given to the owner: "AfS ProcureSign" (recommended), "Isoko", "Icyemezo" (Kinyarwanda words need native-speaker confirmation). Renaming touches: sidebar/title, e-mail subjects, `package.json` names, repo/folder names (`Procurrement-bn`/`-fn` are misspelt "Procurrement" with a double r in the folder names; the GitHub repo names are `Procurrement-bn` / `Procurrement-fn`).

## 10. Working agreements with the owner

- **Do not commit or push unless asked.** The owner commits (they have done so for all current work).
- Confirm before anything destructive or outward facing (wiping databases, deleting volumes, touching the live servers). Testing the live servers with the demo accounts was explicitly authorised on 2026-10-05; creating more live data beyond that needs a new go-ahead, and the live data is to be wiped anyway.
- Report results honestly: say what was and was not tested.
- Use `they/them` for people whose pronouns are unknown.
- Keep the two services independently runnable (backend compose and frontend compose must not depend on each other).
- After changing a form or a rule, run the unit tests and e2e; after UI changes run lint, typecheck, build and the browser journey.

## 11. First 15 minutes on the new machine

1. Clone both repos (`Procurrement-bn`, `Procurrement-fn`) next to each other. Read `Procurrement-bn/docs/HANDOFF.md` (this file) and `docs/API-CONTRACT.md`.
2. Install Docker, Node 22+. Start the backend (section 5). Check `/api/v1/health`.
3. Run `npm test` and `scripts/e2e.mjs` (expect `ALL GOOD: 124 checks passed`).
4. Start the frontend, sign in as `staff@afs.local`, create a case, and walk it through with the demo accounts.
5. Pick up the backlog from section 9, starting with production go-live.

Prompt you can give a new agent: *"Read HANDOFF.md, docs/API-CONTRACT.md and the spec in docs/. Run the tests, confirm the stack works locally, then continue with the backlog in HANDOFF.md section 9. Do not commit unless I ask; confirm before destructive actions on live servers."*
