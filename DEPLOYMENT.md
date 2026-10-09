# Vercel deployment

Live application: **https://identity-lens.vercel.app/**

## Running components

- Vercel hosts the React assets and the Python/FastAPI ASGI function under one HTTPS origin.
- Neon PostgreSQL stores hosted accounts, memberships, cases, evidence, assessments, reviews and application audit history. The Free plan was selected; monitor its current limits in the provider dashboard.
- Root `app.py` exports the backend. `.python-version` selects Python 3.14.
- `vercel.json` installs Node dependencies and Python runtime dependencies into Vercel's Python environment, then builds the frontend.
- The function reads source public assets when present and compiled `dist/` copies otherwise.
- Public sample sessions are always viewers. They cannot change the shared examples or gain organisation access.

The deployed service was checked with an isolated fictional organisation and case. Test records were removed using exact identifiers; local organisation data was not uploaded. This is a functioning hosted release, not a production security/privacy certification.

## Environment settings

Set these through Vercel's environment settings; do not put private URLs or keys in Git, screenshots or chat.

| Setting | Hosted value/purpose |
|---|---|
| DATABASE_URL | Neon pooled PostgreSQL URL, supplied by the integration; standard PostgreSQL URLs are normalised to the installed psycopg driver |
| DATABASE_URL_UNPOOLED | Private direct connection for controlled operator migrations, not a browser value |
| PUBLIC_HOST | identity-lens.vercel.app |
| ALLOWED_ORIGINS | https://identity-lens.vercel.app |
| SECURE_COOKIES | true |
| RUNTIME_MODE | hosted |
| ENABLE_SANDBOX | true |
| ALLOW_PUBLIC_SAMPLES | true; enforces viewer-only public sample sessions |
| ALLOW_BROWSER_TELEMETRY | false |
| ALLOW_HOSTED_ACTIVITY | true, notice-gated and restricted to fictional applicants |

Only the canonical hostname is configured for public app requests. Preview deployment URLs and new custom domains need their own deliberate configuration; do not allow arbitrary origins.

## Release workflow

From the project folder, using the authorised Vercel account:

```sh
npx vercel link --project identity-lens
npx vercel deploy --prod
```

The deployment currently uses the CLI. GitHub updates do not imply a live deployment unless Vercel's Git integration is separately connected.

Before a schema-changing release, use a trusted operator environment with the direct cloud connection as DATABASE_URL and run Alembic upgrade to head. The current deployed database is schema 006. The application lifespan does not apply migrations. Verify the target database before running a migration, take an appropriate backup and never substitute a local/private archive into the cloud database without an explicit migration plan.

After deployment check the public /api/health endpoint, sign-in, sample comparison, case intake, hosted script/receipt and persistent review. A platform READY status alone does not prove these workflows work.

## Storage and safety boundaries

Local laptop accounts/cases remain local. The cloud installation starts separately, with generated sample/reference fixtures; new organisations are empty.

Cloud functions use temporary /tmp files for bounded private diagnostic metadata, not durable backups. Evidence and application audit remain in PostgreSQL. Provider logs, quotas, retention and availability follow the selected hosting/database plans. Configure durable encrypted backups, monitoring, retention/deletion, account recovery, independent validation and security review before real-customer operation. Provider infrastructure can log request metadata; SDK field-value/IP/GPS exclusions are not a claim about provider logging.

No email recovery, MFA/SSO, independent identity verification, physical-device attestation or automatic approval/denial is added by deploying the app.
