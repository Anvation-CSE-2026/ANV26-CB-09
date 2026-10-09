# Release verification — 9 October 2026

The current application was checked in presentation mode: built React assets, FastAPI and local PostgreSQL. Hosted applicant activity is inside the same website. These checks verify software behaviour, not real-world fraud accuracy or production certification.

## Results

| Check | Result |
|---|---|
| TypeScript check + Vite build | Passed |
| Node scoring/startup checks | 14 passed |
| Vitest interface/transport checks | 9 passed |
| pytest PostgreSQL/API/backup/engine checks | 70 passed |
| Playwright browser checks | 10 passed |
| Local readiness | 6/6 passed |
| Source/documentation whitespace check | Passed; generated graph bundle contains shader-string trailing whitespace |
| Current schema-006 backup recovery drill | 8,063 rows exactly compared across 20 persistent tables |
| Actual schema-005 archive recovery drill | 7,967 rows exactly compared across 20 persistent tables |

Total: **103 automated tests passed**. The API tests emit one Starlette/httpx deprecation warning; it is not a failure or an accuracy result. Complete scoring parity is checked for 423 observed/evaluation fixtures. New checks cover viewer-only public samples, standard cloud PostgreSQL URL handling and serving compiled public assets without frontend source files.

## Hosted release checks

The full-stack application is live at **https://identity-lens.vercel.app/** on Vercel with a separate Neon PostgreSQL database, schema 006. Live checks passed for database health, root/SDK/reference assets, private-file exclusion, public read-only sample sessions, the unchanged 0/32/100 examples, organisation registration/sign-in, secure cookies, applicant intake, hosted receipt/deduplication and review persistence across a new login. The public sample comparison was also inspected in the browser.

The hosted API checks used explicitly synthetic endpoint-test observations, not claimed human measurements. Only those checks' exact generated account, cases and sessions were removed. User records were not uploaded from the laptop or overwritten. The public release replaces the earlier static-only deployment; GitHub updates alone do not imply an automatic Vercel redeployment.

Browser coverage includes SDK-sensitive-field exclusions, identical retry payloads after uncertain delivery, hosted notice/start/completion/withdrawal, mobile layout, organisational import/correction/review, returning from Sample cases with the same account and cases, Back/Forward navigation, offline API documentation, an optional separate external connector, graph loading after an actual frontend rebuild, comparison, what-if and persistent review permissions. The graph rebuild check specifically covers an open page requesting its older lazy-loaded asset after a new build.

Hosted API coverage includes organisation and role boundaries, hashed access capabilities, allowed origins, acknowledgement, expiry/revocation, browser binding, elapsed-duration checks, strict input validation, duplicate prevention, withdrawal without evidence deletion and active-link limits. Tests also check honest source qualifications: shared identifiers are not verified physical devices.

API tests use isolated database schemas. Browser/connector tests use generated test organisations and clean up those exact records. The original sample review test restores its previous review if the revision still matches its own update. Existing organisation applicant records and operator credentials were not changed by this verification.

## Current local setup

- Main website: http://localhost:4173/
- Sample cases: available from the main navigation; the original /sandbox alias remains available.
- Hosted activity: inside the signed-in organisation workspace, with no integration key or second service required.
- Offline API reference: http://127.0.0.1:8000/docs
- PostgreSQL: loopback port 55432, schema 006.
- Password change and own-session revocation are active. Email recovery is not present.
- The external-site browser collector remains disabled.
- Controlled hosted collection is enabled after notice acknowledgement, for fictional applicant identities only.
- The optional port-4180 developer connector is not auto-started or required by the six readiness checks.
- Local and hosted installations use separate databases and accounts.

Existing local organisation records remain untouched. No access link was issued for a user's applicant merely to verify the interface; the complete collection flow was checked with isolated test records.

## What observations mean

Sample and benchmark datasets are generated. Hosted form duration/change counts are actual controlled-page measurements, explicitly stored as hosted client-reported evidence. Only one summary is delivered on completion; this is not continuous surveillance or a live event stream. Field values, passwords, OTPs, IPs, GPS and activity on other websites/apps are not collected by this SDK.

A browser-storage token can be reset or forged. It does not identify a physical device or prove a person's identity. Supplied email-age, verification and region attributes are not discovered by the hosted form and are not independently verified. Missing evidence remains unknown.

If the CY-04 submission requires all behavioural observations to be generated, disable ALLOW_HOSTED_ACTIVITY and use only supplied synthetic datasets. Do not describe measured hosted interactions as generated fixtures.

## Scope and remaining deployment work

There is no claim of 100% fraud accuracy, a trained neural model, automatic identity verification, approval/denial, production KYC, physical-device fingerprinting, email recovery, MFA/SSO, external verification-provider integration, high-volume streaming or independent production security certification.

Real-customer operation still requires an authorised evidence/privacy scope, deployment-specific retention/deletion and recovery controls, stronger identity controls, encrypted backups, load testing, operational monitoring and independent validation/security review. HTTPS hosting is now configured but does not certify those properties. Local backups use private filesystem permissions but are not encrypted and are not cloud backups. Cloud /tmp metadata logs are temporary; persistent application evidence/audit is in PostgreSQL. Hosted access links are excluded from local logical backups; stored evidence/history remain included. Historical link metadata does not yet have an automatic retention purge.

See PRESENTATION_GUIDE.md for the current one-website walkthrough and README.md for the implemented stack and bounded runtime limits.
