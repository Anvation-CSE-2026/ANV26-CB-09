# Connect a registration system

The same website offers two paths: **Hosted activity** needs no external server/key; **Connections** accepts externally supplied evidence with a private key. The contracts below are implemented, not a claim of a deployed third-party/provider connection. Applicant identities stay fictional. Never put server keys in source control or browser JavaScript.

## Hosted activity — no company-side integration required

Sign in, add/import an applicant, open Hosted activity, choose that applicant and create a link. Share only with its intended participant. The link includes an expiring token in a fragment (`?view=activity#access=...`); the server stores only its hash. It permits one summary, not access to the organisation's cases or an authenticated customer identity.

The participant's same-origin page obtains minimal context through POST `/api/hosted/info`. No browser token or collector is created before the notice is acknowledged. POST `/api/hosted/start` binds a first-party organisation-scoped browser-storage token; `/api/hosted/complete` accepts duration/change count and saves an observation labelled `hosted_client_reported`. No form values, passwords, OTPs, IP/GPS, internal score or graph are transmitted to/from this participant page. `/api/hosted/cancel` withdraws collection without deleting existing applicant evidence. Links are revocable and expire after 30 minutes. Repeating an identical completion is deduplicated; changed completion data is rejected. SDK retries preserve the exact original payload, including after an uncertain previous response.

These are measured controlled-page interactions, not generated fixture events. Do not claim all behaviour is synthetic once this path is used. Applicant identities remain fictional, and the synthetic accuracy benchmark is separate. Set `ALLOW_HOSTED_ACTIVITY=false` if your submission requires only generated behavioural datasets. No external-site measurement is enabled by this setting, and it is not a production privacy/identity-verification system.

## Server intake

POST http://127.0.0.1:8000/api/ingest/cases with Content-Type: application/json and X-Lens-Key: <your secret>. Do not send an Origin header: keys are server-only.

```json
{"synthetic":true,"external_id":"APP-001","registered_at":"2026-10-08T09:00:00Z","declared_region":"North","phone_verified":null,"profile_records":[],"sessions":[]}
```

The API returns an internal case ID. Without sessions the assessment remains Pending. Repeating identical registration evidence/external ID is idempotent even after later session events arrive; incoming sessions must match a subset of stored events. Different profile evidence or conflicting events under an existing ID return 409. An authorised analyst corrects it with a reason and revision.

POST /api/ingest/cases/APP-001/sessions with the same key:

```json
{"synthetic":true,"sessions":[{"event_id":"FORM-001","timestamp":"2026-10-08T09:05:00Z","device_token":"DEV-EXAMPLE-001","region":null,"form_seconds":190,"edit_count":4,"failed_attempts":0}]}
```

Timestamps require a timezone and must follow registration. Identical retries are deduplicated; changed payloads with the same event ID return 409. The backend stores provenance, recomputes the organisation population and retains assessment snapshots. An analyst sees updates after Refresh.

Optional profile_records entries use source, birth_year and region. Regions are North/South/East/West. Optional fields include email_created_at, phone_verified, phone_token (PHONE-...), address_token (ADDR-...), emulated_device and device_mismatch. Unknown values should remain null, not invented facts. Fetch /api/org/sample-dataset while signed in for complete examples. Generated schemas are at http://127.0.0.1:8000/docs.

No real email addresses, legal-name fields, raw phone numbers or document fields are accepted. Synthetic declarations cannot prove data is fictional: source labels and analyst notes must also contain no real personal data.

## Browser collector — disabled by default

ALLOW_BROWSER_TELEMETRY=false rejects the **external-site** ticket/event routes. It does not disable the separate hosted route above. Including /identity-lens.js alone never starts measurement. Only enable external collection with an explicitly authorised data/privacy scope; imported/generated sample evidence remains available without it.

When explicitly enabled:

1. After notice acknowledgement, the page calls IdentityLens.browserToken(projectId) for a random identifier in this browser's storage. It is not a physical-device fingerprint.
2. The page sends that token to its own registration backend. That backend creates/locates the applicant and requests an Identity Lens ticket with its private key.
3. POST /api/ingest/collection-tickets with {"synthetic":true,"external_id":"APP-001","browser_token":"DEV-..."}.
4. Return only the short-lived ticket to the page. Tickets expire after 30 minutes and bind the integration, applicant, browser token and allowed origins.
5. Attach the collector and call complete after the application's registration succeeds:

```js
const collector = IdentityLens.attach({
  form: document.querySelector("#registration-form"),
  noticeAcknowledged: true,
  ticket: ticketFromYourOwnBackend,
  endpoint: "http://127.0.0.1:8000/api/collect/events"
});
await collector.complete(); // after your registration succeeds
// On abandonment or withdrawal of measurement:
collector.stop();
```

External deployment requires HTTPS and exact configured origins. Mark additional sensitive inputs data-lens-ignore. Password and autocomplete OTP/password inputs are excluded automatically. The SDK sends elapsed duration and non-sensitive change count, never typed values, IP or GPS. Retries are deduplicated server-side.

Browser storage can be cleared or spoofed; shared browsers and private browsing affect links. Client reports are not trusted attestation. Region, phone verification, email age and emulator/device flags require approved sources supplied by the organisation. No external verification, geolocation or attestation vendor is currently connected.

## Checks

- Active keys submit only into their organisation; revocation also invalidates their collection tickets.
- Browsers cannot use server keys; tickets reject expired/wrong-origin requests.
- Duplicate delivery cannot create duplicate observations.
- Viewers cannot import/correct/review; stale revisions protect against overwrites.

Public deployment and real-person collection are separate decisions; neither is enabled by this guide.

## Separate registration application

The separate port-4180 connector is an optional developer example and is no longer part of the main website's startup or presentation flow. Hosted activity does not need it. To test an external integration separately, start Identity Lens, choose an exact organisation, and configure this optional connector:

```sh
npm run registration:connect -- --organisation "Exact existing organisation name"
```

This creates one integration in that existing organisation, audits it as `local-operator` and writes a new private configuration. It will not create an organisation, change an operator's credentials, overwrite a previous config or accept missing/duplicate organisation names. This is an instance-administrator setup tool, not an account authentication bypass or a public onboarding endpoint.

For normal organisation-admin onboarding, create a key in **Connections**, then in a second project terminal:

```sh
npm run registration:configure
npm run registration:start
```

The manual configuration command asks for a private integration key through a hidden prompt, checks it against `/api/ingest/check` and creates a new private `0600` `.local/registration.env` file. Existing configuration is not overwritten. Keep this file out of Git/submissions; move the exact file aside before reconfiguring a replacement. Environment variables `LENS_REGISTRATION_API` and `LENS_REGISTRATION_KEY` can also supply configuration. The connector allows loopback HTTP API endpoints only. Start it explicitly with `npm run registration:start`; it is not needed for Hosted activity.

Open **http://localhost:4180**. Its browser talks to its own FastAPI backend, which forwards the fictional registration and optional explicitly supplied session through `httpx`. The organisation key never reaches browser code, and responses contain delivery status rather than scores or internal graph data. A session timestamp is derived from the synthetic registration time and supplied duration—not measured real behaviour. Retries use stable event IDs, so they cannot duplicate observations. A partial delivery error is explicit and can be retried with identical data. Revoking the key stops the connector. The browser collector remains disabled and is not attached to this form.

This provides an executable integration example and local onboarding path, not a hosted organisation portal or real verification-provider connection.
