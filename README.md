# Identity Lens

Digital identity fraud and synthetic identity detection (pygenic arc)

**Challenge:** CY-04 · Anvation Hackathon 2026

**Live application:** [identity-lens.vercel.app](https://identity-lens.vercel.app/)

Organisations can create accounts, invite a team, add/import applicants, collect hosted page activity or connect an external server, investigate risk and retain review history. These operations use FastAPI and PostgreSQL, not hard-coded dashboard actions. The light interface and projector mode remain. **Sample cases**, **Hosted activity** and organisation investigations are inside one website. Sample and organisation records stay separate; `/sandbox` is a backward-compatible entry link, not a required second website.

Applicant identities and verification inputs remain **fictional**. Sample datasets and benchmarks are synthetic. The optional hosted flow measures actual interactions with a controlled form after notice acknowledgement and labels those observations **hosted_client_reported**, not generated sample data. It collects no real personal identity information. Do not represent measured activity as wholly synthetic benchmark evidence. Scores are advisory evidence indices, not fraud probabilities or identity verification. No automatic approval, denial or production KYC is performed. If a submission must use exclusively generated behavioural data, disable `ALLOW_HOSTED_ACTIVITY` and present the sample dataset instead.

## Repository and hosting

This repository contains the React frontend, Python/FastAPI backend, PostgreSQL migrations, synthetic datasets, tests and operating instructions. GitHub stores the source code; a repository commit does not deploy the application.

The deployed application uses Vercel for the React interface and Python/FastAPI function, with Neon PostgreSQL for persistent storage. The frontend and `/api` share one HTTPS origin. Registration, sign-in, applicant intake, hosted activity receipt and saved reviews were checked against the deployed service. This verifies functionality, not real-world fraud accuracy or production certification.

The hosted installation has its own database. Local accounts and private organisation records are not copied into it. Create a workspace online or use **Explore sample cases**. Public sample access is read-only; signed-in organisation members can work on their own cases according to their role.

Deployment currently uses the Vercel CLI. A GitHub push alone should not be assumed to trigger a deployment until the Git integration is configured. See [DEPLOYMENT.md](DEPLOYMENT.md) for release settings and database migration requirements.

## Development setup

Use Node.js 22+ and Python 3.14. Internet access is needed to install dependencies. From a new working folder:

```sh
git clone https://github.com/Anvation-CSE-2026/ANV26-CB-09.git
cd ANV26-CB-09
npm ci
npm run setup
npm run present
```

For local development, open **http://localhost:4173**. This address refers to the machine running the app, not a public website. Create an organisation with a username and password of at least 12 characters. New organisations start empty; accounts and organisation records from another installation are not included in Git. Under **Import evidence**, download the synthetic sample, upload it, preview validation and import it. The sample contains legitimate, ambiguous-household and suspicious cases. Records survive browser refreshes and application restarts. Use [PRESENTATION_GUIDE.md](PRESENTATION_GUIDE.md) for the walkthrough.

One command starts native PostgreSQL on loopback port 55432, applies Alembic migrations, builds the frontend, starts FastAPI on port 8000 and serves the built app through a loopback proxy on port 4173. Hosted applicant activity runs in this website and requires no separate integration key or port-4180 service. No hot reload or internet connection is required for presentation. Stop with Ctrl+C; data is retained. `npm start` uses Vite instead for development. Stop the current mode before switching. `npm run doctor` checks local readiness, not fraud accuracy.

Browser-test installation is optional for running the application:

```sh
npx playwright install chromium
```

An external `DATABASE_URL` skips the embedded PostgreSQL runner. `.env.example` documents settings; `.env` is excluded from Git. No Supabase, Docker, cloud account or paid API is required by this local application.

## Implemented stack

| Layer | Technology | Actual use |
|---|---|---|
| Frontend | React, TypeScript | Accounts, investigations, imports, hosted activity, review, team and connections |
| Frontend tooling | Vite | Development server, API proxy and production assets |
| Interface | Tailwind CSS, custom CSS, Lucide, bundled DM Sans/Manrope | Responsive light theme, projector mode and locally loaded fonts |
| Relationships | Cytoscape.js | Interactive exact-token graph |
| Backend | Python, FastAPI, Uvicorn | Authenticated HTTP API, tenant isolation, ingestion and scoring |
| Validation | Pydantic | Strict schemas, timezone/chronology checks, limits, unknown-field rejection |
| Assessment | Explicit Python rules, NumPy | Capped scores, registration bursts and robust median/MAD checks |
| Database | PostgreSQL | Persistent accounts, evidence, assessments, imports, notes and audit |
| Cloud hosting | Vercel, Neon PostgreSQL | Same-origin Python/frontend deployment and separate persistent hosted database |
| Database access | SQLAlchemy, psycopg | Scoped queries, transactions, row locks and revision checks |
| Schema | Alembic | Versioned migrations |
| Account security | hashlib.scrypt, hashed opaque tokens, HttpOnly cookies | Password hashing, expiring sessions, integration keys and invitations |
| Account controls | FastAPI, PostgreSQL | Password change, own-session listing/revocation; no email recovery |
| Local serving | Node.js loopback reverse proxy + FastAPI static files | Built frontend on 4173, same-origin API; no Vite needed in presentation mode |
| Operations | Python rotating JSON metadata log + logical backup tools | Private bounded logs, generated request references, verified recovery |
| Separate registration service | FastAPI, httpx, native HTML/CSS | Loopback server-to-server synthetic intake; private key never sent to browser |
| Collection SDK | First-party JavaScript | Notice-gated hosted form-duration/change-count summary and scoped browser-storage token; external-site collection stays off |
| Tests | Node test runner, Vitest, pytest, Playwright | Policy regression, transport, PostgreSQL API and browser workflows |

There is no neural-network training, LLM decision-making, graph database or automatic device attestation. Scoring runs on the backend, not in the browser.

## Organisation workflow

1. Register a named account and organisation; become its administrator.
2. Invite analysts/viewers with revocable, single-use links expiring in 48 hours. Share invitation links manually; invitation emailing is not implemented.
3. Import JSON/CSV, preview every row, resolve errors and commit a complete batch atomically. CSV profile_records/sessions cells contain JSON arrays.
4. Alternatively create an integration key in Connections and submit applicants/session events from the organisation's server. Keys are shown once and can be revoked.
5. Inspect scores, capped contributions, missing inputs, indicator source records, graph, event provenance and assessment history.
6. Assign a case, save notes or create an internal evidence request with category, owner and optional deadline. Requests can be resolved/cancelled with a reason; closure does not modify evidence or risk. Corrections use readable forms, require a reason/revision and retain previous evidence. Stale edits return HTTP 409.
7. Compare up to three organisation cases side-by-side, omit indicators for a read-only what-if calculation or export a case report.
8. The setup checklist checks received evidence, members, actual server deliveries and completed reviews. A created key is not advertised as a completed connection. Filter the queue by risk, review status, owner or missing inputs.
9. Alternatively open **Hosted activity**, choose an existing applicant and issue an expiring activity link. The applicant uses a page on this same website, acknowledges the notice, interacts with a short form and submits one summary. It reaches that organisation, updates the assessment/history and appears in the activity overview. No external backend or private integration key is required for this path. Viewers cannot issue/revoke links.

Intake and correction forms support unknown fields, multiple profile records and sessions, and browser-local dates converted to UTC. They do not claim independent verification. Source provenance describes how evidence arrived, not whether the content is true.

Administrators manage access/keys; analysts import, correct and review; viewers inspect/export without write permissions. Suspending membership revokes its sessions. A workspace must retain an active administrator. Membership is checked on every request. Tenant context comes from the session/key, not a caller-supplied organisation ID. Isolation is implemented in application queries and tested; PostgreSQL row-level security is **not** enabled.

## Evidence collection

See [INTEGRATION.md](INTEGRATION.md) for the implemented server/browser contract.

- Imports supply synthetic source records and timestamps.
- The private-key server API accepts applicants and later observations, with identical-event retry deduplication.
- Hosted activity uses an organisation/applicant-scoped, one-summary, 30-minute link. Only its hash is stored. The token travels in a URL fragment, not a query/access-log path. It is a bearer capability: share it only with the intended applicant. Its holder cannot read scores, graphs, histories, other cases or account credentials. It does not authenticate a person's identity.
- The hosted browser-storage token is created only after the collection notice is acknowledged. Region, failed sign-ins, phone verification, email age and device-integrity signals are not inferred from the form. Hosted observations carry their own source and client-reported trust label. Submitting a summary recomputes scores; it does not manufacture verification fields.
- The activity overview refreshes every 10 seconds while visible. Summaries arrive on completion, not continuously. Stopping/withdrawing prevents further collection; already delivered records remain in history. Unknown delivery is not represented as a guaranteed failure. Retries preserve the exact original payload and are deduplicated. Changing a completed summary is rejected.
- Synthetic scenario replay was removed from the main interface. Its labelled API remains as a developer fixture utility, not presented as measured activity.
- A standalone port-4180 connector remains an optional developer example for the external API. It is no longer launched automatically or required for the hosted path. See INTEGRATION.md for manual configuration/startup. No user's external integration is silently selected or configured.

Hosted collection is explicitly notice-gated (`ALLOW_HOSTED_ACTIVITY=true`) for controlled interactions linked to fictional applicants. It can be disabled independently. The external-site collector remains off (`ALLOW_BROWSER_TELEMETRY=false`). Do not enable real-customer collection or upload real identity records without a separately authorised data/privacy scope. The SDK excludes typed values, passwords, OTP values, IP and GPS. Its token identifies browser storage, not a physical device or person, and can be reset/spoofed. Browser reports are not trusted attestation. Notice acknowledgement alone is not a production privacy-compliance programme.

## Storage

Local development database files: **`.local/postgres/`**, database **`identity_lens`**, excluded from Git. The hosted installation uses separate Neon PostgreSQL storage. Do not delete the local folder to resolve startup issues. Browser storage is not the evidence database, and Git contains no operator accounts, private cases or database credentials.

`npm run db:backup` saves a private local logical backup and performs an exact-content recovery drill. `npm run db:restore` restores only into a NEW named database, never the live one. See [OPERATIONS.md](OPERATIONS.md) for recovery, permissions and limitations. Archives are not encrypted and must not be shared in submissions.

| Tables | Contents |
|---|---|
| organisations, accounts, memberships | Organisation, users, password hashes, roles |
| workspace_sessions, invitations, integrations, auth_throttle | Hashed tokens/keys, expiry, revocation, account-attempt throttle |
| workspace_cases | Evidence, external applicant ID, assignment, review/evidence revisions |
| evidence_events, collection_tickets, import_batches | Provenance, collection sessions, import history |
| workspace_assessments | Assessment snapshots with policy/evidence versions |
| workspace_audit | Notes, corrections, previous payloads, access-management events |
| evidence_requests | Internal follow-up tasks, owner/deadline, closure reason and revision |
| hosted_access | Expiring hashed activity-link capabilities, acknowledgement/start/completion state and small summaries; excluded from backups |
| recovery_emails, email_actions | Retired schema-005 compatibility tables; no email routes or UI are enabled |

The sandbox retains the original identities/observations/entity_links/assessments/reviews/review_notes/audit_events/auth_sessions/evaluation_labels tables. Organisation workspaces are not automatically populated from those tables. `backend/data/seed.json` contains reproducible synthetic reference/evaluation fixtures, not real identities.

## Scoring and validation

Identity 25 + Device 25 + Behaviour 30 + Relationships 20 = at most 100. Bands: Low 0–24, Review 25–59, High 60–100. Cases without sessions remain **Pending**, not automatically Low. Coverage describes input availability, not confidence. Unknown verification/telemetry is not counted as completed verification.

Rules inspect profile conflicts, email age, phone verification, shared/emulated devices, attribute mismatch, 30-minute bursts, region consistency, reused contacts, failed sign-ins and form anomalies. Median/MAD uses 240 separate synthetic reference cases. Exact-token graph links stay inside the organisation and do not propagate neighbour scores. Labels are not scorer inputs. A per-batch observation-only index avoids repeatedly scanning peers for exact links; regression checks compare complete indexed and original assessments, not just scores.

**Method & validation** compares the full policy, a profile-conflict baseline and four scoring-group ablations on a separate 240-case synthetic cohort. Binary precision/recall/false-positive rates use legitimate/suspicious generator labels; ambiguous cases are reported separately. This cohort has already been inspected and used for regression, so it is not claimed as an untouched real-world test. Generator/policy shared assumptions and manual weights limit the conclusions. Results do not establish real-world accuracy.

The original sandbox showcase scores remain 0, 32 and 100. Its sample reproduces these scores before editing. New submissions/corrections can produce different outcomes.

Additional independent small challenge checks cover household sharing without bursts, sparse observations and rotating client tokens. These are edge-case invariants, not a new untouched accuracy benchmark. Sparse-history fraud without distinguishing signals can still score Low; the app exposes missing evidence rather than reading a hidden label.

## Account security (no email)

**Account security** lists your active organisation sessions, highlights the current one and lets you revoke one or all other sessions. Token hashes are never exposed as identifiers. Changing your password requires the current password and a new password of at least 12 characters; it revokes all your workspace sessions and requires a fresh sign-in. Accounts, other operators and stored applicant evidence are not reset.

Email delivery and email-based password recovery were removed at the user's request. There is no forgotten-password reset or bypass in the application. Keep the operator password safely. Dormant schema-005 tables remain for backup compatibility; retired source is archived as text, not imported. MFA/SSO is not implemented.

## API and verification

Offline, searchable, read-only API reference: **http://127.0.0.1:8000/docs**. It reads the actual generated `/openapi.json` schema and loads no third-party scripts. It does not execute authenticated API calls.

| Routes | Purpose |
|---|---|
| /api/org/register, login, logout, me, workspaces, switch | Accounts, sessions, organisation selection |
| /api/org/team, invitations, join, integrations | Memberships, invitations, server keys |
| /api/org/cases and /{id}/evidence, review, sensitivity, report | Intake, investigation, corrections, review, what-if, export |
| /api/org/imports/preview, imports, sample-dataset | Atomic imports/examples |
| /api/ingest/cases, /api/ingest/cases/{external_id}/sessions | Server-to-server evidence |
| /api/ingest/collection-tickets, /api/collect/events | Gated browser collection |
| /api/org/collection-status, collection/replay, validation, audit | Collection state, replay, evaluation, audit |
| /api/org/onboarding, cases/{id}/requests | Real setup progress and internal evidence follow-up |
| /api/ingest/check | Private server-key connection check |
| /api/org/hosted-links and /{id} | Issue, list and revoke applicant-scoped activity links |
| /api/hosted/info, start, complete, cancel | Public link capability, acknowledgement, bounded observation receipt and withdrawal |
| /api/org/account/sessions, sessions/revoke-others, password | Own-session management and current-password-authorised change |

```sh
npm run build
npm test
npm run test:api
npm run test:e2e
```

Keep either startup mode running for API/browser tests; do not restart PostgreSQL during tests. API tests use isolated PostgreSQL schemas; browser tests remove only organisations/accounts they create. Legacy parity covers 423 observed/evaluation fixtures. Browser checks cover accounts, imports, review, graph, correction, invitations, same-website sample navigation, mobile layout, SDK exclusions, exact-payload retries, hosted acknowledgement/receipt/withdrawal and external server delivery without private-key/verdict exposure. See VERIFICATION.md for the latest actual results.

## Deployment and limits

The current full-stack build is deployed at the live URL above. Vercel uses Python 3.14, the root ASGI entrypoint and runtime requirements; the build also compiles the React assets. Secure cookies, a single configured public origin and read-only public samples are enabled. PostgreSQL migrations through schema 006 were applied to the new Neon database. Secrets are configured in Vercel, not committed to Git. This release replaces the earlier static-only website.

Cloud functions use temporary private metadata-log files under `/tmp`; those files are not durable audit storage. Evidence, reviews and application audit records remain in PostgreSQL. Vercel/Neon may keep their own infrastructure logs under their provider policies; the SDK's collection exclusions do not mean the hosting providers collect no request metadata.

Before use with real applicants: approved evidence sources/validation, an authorised privacy/retention policy and account-recovery process, MFA/enterprise identity, HTTPS deployment, encrypted off-device backups, monitoring/alerting, load testing and independent security review are still needed. Intake is bounded to 1,000 applicants/organisation, 100 sessions/applicant, 100 applicants and 1.5 MB/import. Hosted activity allows at most five active links/applicant and 200 active links/organisation; only the most recent 100 are listed. Scoring is synchronous and the frontend loads a bounded population, not a high-volume streaming platform. Unchanged assessments do not multiply history on unrelated intake. Audit records have no edit/delete API but are not tamper-evident against database administrators. Logs are bounded private local diagnostics, not cloud monitoring. API failures use safe messages with request references. Account/evidence/link retention still needs a deployment-specific policy. Hosted expiry and elapsed-duration checks limit obvious invalid reports but cannot prevent a malicious client from spoofing observations.

## Source layout

- frontend/src/: typed React interfaces and transport.
- frontend/public/identity-lens.js: collection SDK.
- backend/app/: accounts, ingestion, scoring, database models.
- backend/migrations/: Alembic schema history.
- backend/data/: reproducible synthetic fixtures.
- scripts/: setup, PostgreSQL and coordinated startup.
- tests/ and backend/tests/: policy, transport, browser and API checks.
- legacy/: preserved original application; dist/: generated assets.
