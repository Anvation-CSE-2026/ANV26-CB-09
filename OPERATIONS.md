# Local operation and recovery

These tools operate on the configured PostgreSQL database from the terminal. They are intentionally not exposed through an organisation's web account: an instance-wide backup contains every organisation's records and password hashes.

## Start for presentation

From the project folder, run `npm run present`. This builds the React frontend, starts PostgreSQL and the API, and serves the built app at **http://localhost:4173**. Hosted applicant activity is inside the same website; the optional port-4180 developer connector is not started automatically. Use `npm start` for development instead. Stop the existing launcher with Control+C before changing modes; startup refuses to replace a service on an occupied port. It stops only processes it started, not unrelated services. Keep this terminal open; do not interrupt it while API/browser tests or backups are running.

Run `npm run doctor` from a second terminal before presenting. It checks six main-app readiness conditions, including hosted activity capability and the locally served SDK. It does not certify fraud accuracy, issue a private applicant link or validate an optional external connector. An external service requires its own configuration/check; hosted activity does not require an integration key.

Read-only endpoint documentation at **http://127.0.0.1:8000/docs** loads the generated schema and all assets locally. The application requires no remote font, CDN or AI service for these screens.

Builds retain content-hashed assets so an already-open page can still load its graph after a rebuild. This is intentional compatibility, not a second running application. Refresh the page after a release to load the latest interface. Do not clear `dist/assets` while the app is serving open clients.

## Diagnose without leaking evidence

API responses include a generated request reference. Unexpected failures return a generic error instead of exception details; input validation does not echo raw submitted values. `.local/logs/requests.jsonl` records UTC time, reference, HTTP method, matched route template, status, duration and unexpected error class only. It excludes applicant/account IDs, raw paths, queries, request bodies, credentials, keys and IP addresses. Rotation is capped at one 1 MiB current file plus two backups; files use private `0600` permissions. These files are not encrypted and should not be submitted.

This is local troubleshooting, not an external alerting system. API/browser request timeouts cannot prove whether a timed-out write committed: refresh the case or retry identical integration evidence before submitting different data. Do not delete `.local/postgres` to fix a connection error.

## Create and verify a backup

Keep `npm start` running. From the project folder:

```sh
npm run db:backup
```

The command takes a consistent, read-only transaction snapshot of application tables and writes a new `.local/backups/identity-lens-<timestamp>-<id>.json.gz` file. It then restores the archive contents into a randomly named, isolated verification schema, compares every restored record exactly and removes only that temporary schema. It does not alter your live case records.

Archives have private 0600 filesystem permissions and are excluded from Git through `.local/`. They are **not encrypted**. Do not upload them with a hackathon submission or share them as case reports. Store an encrypted off-device copy using your approved backup process; a file on the same laptop does not protect against loss of that laptop.

To verify a saved file again:

```sh
npm run db:verify-backup -- .local/backups/<exact-file-name>.json.gz
```

SHA-256 catches accidental corruption. It is not an authenticated signature against malicious replacement. Verification also checks the allowed table/column manifest, schema revision, foreign-key constraints and exact restored content. Archive content is inserted as data, never executed as SQL.

## Recover without overwriting the active database

Choose a NEW name beginning `lens_recovery_`:

```sh
npm run db:restore -- .local/backups/<exact-file-name>.json.gz --database lens_recovery_review
```

The command creates that new database on the same configured PostgreSQL server, applies migrations, restores records transactionally and verifies their exact contents. Integer sequences are reset so subsequent reviews/assessments receive new IDs. It refuses an existing database, the active database, or a target containing tables. A failure after creating the new database leaves it available for operator diagnosis; no existing database is deleted or overwritten.

After verifying recovery, stop the app with Ctrl+C. Set DATABASE_URL in your local `.env` to the same connection with the recovered database name, then restart with `npm start`. The original database remains available. Users must sign in again: auth sessions, collection tickets and throttle counters are not backed up or restored. Persistent password hashes, membership, keys and invitation records are preserved; rotate integration keys/invitations after an actual incident using the account interface.

The operator's PostgreSQL role needs schema-creation permission for verification and database-creation permission for recovery. The bundled local instance supports these commands. Externally managed database services may restrict them.

## Scope and limitations

- This is a version-matched **logical application backup**, not pg_dump, a complete PostgreSQL server backup, WAL archiving or point-in-time recovery.
- It captures the known application tables, not unrelated databases, roles, server settings, custom database objects or uploaded files outside PostgreSQL.
- It supports up to 100 MiB of uncompressed backup data. Use a provider/native PostgreSQL backup strategy for larger deployments.
- Schema 006 supports tested 003, 004 and 005 archives into a new database: newly introduced persistent tables start empty. Other schema versions need a matching application and tested migration. Active sessions, throttle counters, collection tickets, retired email tokens and hosted-access links are excluded. Users must sign in again and issue new activity links; email reset is not available. Hosted observations and their audit records remain backed up in evidence/history tables.
- Scheduled off-device backups, retention, encryption-key management and disaster recovery after loss of this server still require deployment-specific infrastructure.

## Health and verification

`GET /api/health` checks database connectivity. The local startup command checks readiness before announcing the UI address. API schemas are at http://127.0.0.1:8000/docs. To verify code changes:

```sh
npm run build
npm test
npm run test:api
npm run test:e2e
```

API tests use isolated schemas. Recovery tests create only randomly named `lens_recovery_test_...` databases and remove those exact test targets. Browser tests remove only their generated organisations/accounts. No test should reset the active workspace.
