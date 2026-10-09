# Present Identity Lens in one website

## Start and check

```sh
cd ANV26-CB-09
npm run present
```

These commands assume the repository has been cloned and dependencies installed as described in README.md. Keep Terminal open. From a second project Terminal run `npm run doctor`. Open **http://localhost:4173/** and sign into your organisation. This is the local presentation address; use a verified HTTPS deployment URL only after the full stack is hosted. Hosted activity needs no second website, external integration key, email service or paid API. The optional external connector is not auto-started.

Applicant identities remain fictional. The sample/benchmark datasets are generated. Hosted activity measures actual controlled-page interactions after acknowledgement and labels them client-reported. Do not call these measured observations generated data or verified identity. If judging rules require exclusively generated behavioural inputs, set `ALLOW_HOSTED_ACTIVITY=false` and restart, then present only the sample dataset.

## Your opening

“Identity Lens gives an organisation one workspace to receive applicant evidence, observe disclosed activity on a hosted page, understand risk indicators and document human review. We use fictional applicant identities. Scores prioritise investigation; they are not fraud probabilities or automated rejection decisions.”

## Five-minute walkthrough

### 1. Explain the three sample cases

Click **Sample cases**, then **Open sample cases** if asked, and **Compare sample cases**. The unchanged examples score 0, 32 and 100.

- Consistent records and ordinary activity produce Low observed risk—not verified authenticity.
- Sharing and mixed evidence support Review, not a fraud accusation.
- Corroborating conflicts, reused contacts and coordinated registrations support prioritised investigation.

Show the caps: Identity 25, Device 25, Behaviour 30 and Relationships 20. Explain what evidence could change each assessment. A shared graph link does not copy a neighbour's risk. The read-only what-if changes a calculation, not stored evidence.

Click **Organisation workspace** to return in the same tab, still signed in. Sample and company records remain separate.

### 2. Put an applicant on the platform

In **Investigations**, use **Add applicant** with a new invented ID, such as PRESENT-001. Leave unavailable verification inputs unknown. Alternatively import JSON/CSV, validate and preview before committing. New organisations are empty; samples are not inserted silently.

A case without activity remains Pending. Say: “Missing activity is not proof that someone is safe.”

If you already imported the comparison sample, use those existing IDs; do not repeatedly import the same records.

### 3. Collect activity on this website

Open **Hosted activity**, choose the applicant and **Create activity link**. It expires after 30 minutes and allows one summary. Its hash is stored; the full link is shown once through copy/open controls. It is a bearer capability, not verified applicant identity or organisation access.

Click **Open activity page**. Read the notice before acknowledgement. No browser-storage identifier or form collector is created before the notice is acknowledged. The access link itself already contains its short-lived capability.

Click **Start disclosed activity**. Change Account purpose, Preferred summary frequency and Workspace layout. Click **Complete and submit activity**.

Only duration/change count and the scoped browser-storage token are submitted. Selected/typed field values are not sent. The participant receives a receipt, not the internal score/graph. Collection stops after completion. A new link is needed for another session.

A separate new link can show **Stop without submitting**. That stops further collection without erasing previously delivered records. Do not claim no delivery if the previous response was uncertain.

### 4. Show received evidence and review

Return to **Organisation workspace → Hosted activity**. The received summary and current assessment appear; this view refreshes every ten seconds while visible. Summaries arrive on completion, not as a continuous live stream.

Open **Investigations**, inspect the case and show the **hosted client reported** event source, gaps and assessment history. A short duration may trigger an anomaly, but does not prove fraud. This page cannot discover email age, phone verification, region, emulator status, physical-device identity or failed sign-ins. Those remain unknown without supplied evidence.

Save a note or evidence request, then refresh to show PostgreSQL persistence. Review complete is not an approval or denial.

### 5. Validate and close

In **Method & validation**, explain the separate median/MAD reference, synthetic evaluation cohort, baseline and scoring-group ablations. Household sharing and sparse-history fraud are hard cases. The scorer never receives generator labels.

“Synthetic precision, recall and false positives test the policy, not real-world accuracy. The evaluation cohort has been inspected for regression, so it is not a new untouched benchmark. The workflow works; real-customer deployment still needs approved sources, privacy/retention controls, HTTPS operations and independent validation.”

## Actual stack

See README.md for every implemented layer: React/TypeScript frontend; Vite builds; Tailwind/custom CSS, Lucide and local fonts; Cytoscape graph view; Python/FastAPI/Uvicorn backend; Pydantic validation; Python rules/NumPy scoring; PostgreSQL storage; SQLAlchemy/psycopg queries; Alembic schema 006; scrypt and hashed session/link capabilities; first-party JavaScript collection; Node local proxy; private diagnostic/backup tools; Node/Vitest/pytest/Playwright verification.

Supabase, Docker, Firebase, Redis, Kafka, an LLM, neural training and external verification/attestation providers are not in the running stack. The optional FastAPI/httpx external connector is not required for hosted collection. The earlier Vercel static site is not this local full-stack deployment.

## Judge questions

**Can a company onboard without a developer?** Yes: create an organisation, invite analysts, add/import applicants and issue hosted activity links. External server integration is optional.

**Are you collecting activity yourselves?** Yes, for the controlled hosted form after acknowledgement: duration, non-sensitive changes and a scoped browser-storage token. One summary is sent on completion. We do not watch other pages/apps or collect field contents.

**Can users spoof observations?** Yes. Tokens are resettable; client reports can be forged. Expiry, binding, schema and elapsed-duration checks limit obvious invalid reports, not replace attestation. The assessment stays advisory.

**Does a link prove who the person is?** No. It is a bounded bearer capability for one applicant's observation. The issuer must share it only with the intended participant.

**Where is data stored?** PostgreSQL. API queries are organisation-scoped and isolation is tested in application code; PostgreSQL row-level security is not enabled. Browser storage holds a token, not cases.

**Does a short completion mean fraud?** No. It can contribute an anomaly indicator. Other evidence, caps, missingness and human review matter. False positives and negatives remain possible.

**What remains for real customers?** HTTPS Python/PostgreSQL hosting, approved evidence and validation, authorised privacy/retention and account recovery, stronger identity controls, encrypted off-device backups, load testing, monitoring and independent security review. Localhost is not publicly reachable by remote customers.

## If something fails

Keep the launcher open. Check `npm run doctor` and the request reference. Never delete `.local/postgres`, expose private keys/backups or blindly create duplicate IDs. An expired/revoked link needs a new invitation. For uncertain delivery inspect the stored case before sending different data. Evidence and reviews survive refresh/restart.
