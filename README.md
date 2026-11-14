# BloodBridge — Emergency Donor Coordination

**Created:** 2026-11-13  
**Project status:** Deployable prototype; not validated or approved for clinical use.

BloodBridge is a hospital-facing web application for emergency blood requests, nearby donor call-outs, donor-confirmed availability, consent-based location updates, and inventory shortage estimates.

## Architecture

- **Web app and API:** Next.js App Router, TypeScript, React.
- **Device support:** responsive desktop and Android-sized layouts; the web manifest supports adding BloodBridge to the Android or desktop home screen where the browser supports app installation. This is a progressive web app, not a separately packaged native Android APK.
- **Database:** PostgreSQL with Prisma migrations.
- **Matching:** exact blood-group match for available, call-consented donors at any distance. Known coordinates are used only to order candidates; donor location consent is not required to place a call. A database row lock prevents one donor being reserved concurrently by two requests.
- **Voice and SMS:** Twilio Programmable Voice with signed webhooks and DTMF response handling; emergency SMS alerts are sent only to donors with a separate SMS opt-in and are logged per request.
- **Hospital access:** password hashes using bcrypt and an HTTP-only, signed hospital session cookie. Hospital tracking APIs require that session and scope requests to its hospital.
- **Patient access:** separate password-based patient accounts and cookies. Patient availability searches return only blood-group totals aggregated by city; they never return hospital names, donor details, patient records, or tracking data.
- **Google sign-in:** Google OpenID Connect with state, nonce, and PKCE; only verified Google emails matching an existing hospital account are accepted.
- **Account recovery:** single-use, 30-minute password-reset links delivered by Resend. Reset requests are rate-limited and return a generic message that does not reveal whether an email is registered. Forgotten hospital email recovery is administrator-assisted.
- **Location:** donors post coordinates with a one-time generated bearer token after accepting. Tracking is opt-in and can be revoked.
- **ETA:** displayed as a rough straight-line distance estimate at 25 km/h plus five minutes. It is not road-route guidance.
- **BloodVerify:** only unexpired, unit-level records released by staff count as verified usable inventory. Reported aggregate counts remain unverified until reconciled to unit records; stock freshness, consistency, pending tests, reservations, quarantine, expiry, and 90-day request history feed transparent confidence, anomaly, and shortage estimates. This is deterministic decision support, not a trained machine-learning model.

Request flow:

```text
Hospital session → emergency request → nationwide donor search → reserve up to 5 calls
  → Twilio IVR and consented SMS alerts → donor presses 1/2 or times out → persist response
  → replenish queue / stop calls at target → consented donor GPS → hospital dashboard
```

## Database

The dated initial migration is `prisma/migrations/20261113154000_initial/migration.sql`. It creates:

- `Donor`, `Hospital`, `EmergencyRequest`, `CallLog`, `LocationTracking`
- `BloodInventory` for hospital stock and shortage analytics
- enums and indexes, including unique donor-per-request call attempts

Apply migrations using `npm run db:migrate` (deployment) or `npm run db:dev` (local development). Never edit an applied migration; create a new dated migration for later schema changes.

The `20261113190000_patient_portal_and_staff_records` migration adds the patient portal account table, hospital city/mobile/policy fields, confidential hospital patient cases, inventory change history, and donor donation dates. Apply it before deploying this release.

The `20261114110000_blood_verify_and_staff_donors` migration adds explicit donor call consent, donor address and hospital registration, unit-level inventory, and inventory status audit events. The `20261114121000_add_consent_based_sms_alerts` migration adds donor SMS opt-in and per-request SMS delivery logs; existing donors default to no SMS consent. Apply all migrations before deploying the latest dashboard. Legacy aggregate stock is intentionally preserved as reported-but-unverified; do not fabricate unit breakdowns for existing counts.

## Local development

Requirements: Node.js 22+, npm, and PostgreSQL 16+. Docker Compose is also supplied, but Docker is not required if PostgreSQL is already running.

On Android Chrome, open the deployed site and use **Install app** / **Add to Home screen** from the browser menu. On desktop, use the browser's install control when available. The hospital map preview embeds a Google Maps view without exposing coordinate inputs; the hospital may grant browser location permission at the facility to set a pin for ETA calculations. A hospital address is required for IVR; map coordinates are optional.

1. Copy `.env.example` to `.env`. Replace `SESSION_SECRET` with a random value of at least 32 characters and set the hospital name, physical address, email, password (12+ characters), and coordinates. `POSTGRES_PASSWORD` and the example database URL are development-only.
2. Start PostgreSQL, or use `docker compose up --build` after creating `.env`. Compose runs database migrations before starting the web server.
3. Install and initialize:

   ```sh
   npm ci
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   npm run dev
   ```

4. Visit `http://localhost:3000/hospital` and sign in with the seeded hospital account.
5. Add donors from the dashboard's **Donor records** section or with `npm run donor:create`. Record call, SMS, and tracking consent separately. Calls require call consent but not location; tracking and ETA require donor consent, a donor-confirmed location, and the hospital's optional map pin. Deliver any one-time location token securely; never put it in source control or logs.

The donor client should send location samples only after the donor has accepted and granted location permission:

```http
POST /api/donors/location
Authorization: Bearer <donor-location-token>
Content-Type: application/json

{"latitude":40.71,"longitude":-74.00,"accuracyMeters":20}
```

Donor availability can be changed through `PATCH /api/donors/location` with `{"available":true}` or `{"available":false}`. A donor can revoke tracking consent and erase stored coordinates/history with `DELETE /api/donors/location`.

## API

All `/api/hospital/*` routes require a hospital session. Unauthorized callers receive 401; the dashboard API only returns data belonging to the signed-in hospital.

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/hospital/register` | Create a hospital account and sign in |
| PUT | `/api/hospital/settings` | Re-authenticate and update hospital email, password, mobile, profile name, and donation interval |
| GET / POST | `/api/hospital/cases` | List or add hospital-private patient blood cases |
| PATCH | `/api/hospital/cases/:caseId` | Update a case; unit issue counts must be recorded through the verified unit ledger |
| GET / POST | `/api/hospital/donations` | Read hospital donor history / record donation date and administrative next-review date |
| GET / POST | `/api/hospital/donor-records` | Read or add hospital-managed donors with separate call, SMS, and tracking consent |
| GET / POST | `/api/hospital/inventory/units` | Read unit-level inventory or register a unit as pending testing |
| PATCH | `/api/hospital/inventory/units/:unitId` | Release, reserve, issue, quarantine, or return a unit to testing with an audit event |
| POST | `/api/hospital/login` | Create hospital session |
| GET | `/api/hospital/google/start` | Start Google OpenID Connect sign-in |
| GET | `/api/hospital/google/callback` | Verify Google identity and create hospital session |
| GET | `/api/hospital/google/status` | Report whether Google sign-in is configured, without exposing credentials |
| POST | `/api/hospital/password-reset/request` | Request a one-time reset link by email |
| POST | `/api/hospital/password-reset/confirm` | Set a new password with a valid reset token |
| POST | `/api/hospital/logout` | Clear session |
| GET | `/api/hospital/me` | Current hospital account and map coordinates for ETA |
| PUT | `/api/hospital/profile` | Save hospital address and optional ETA coordinates |
| GET / POST | `/api/hospital/requests` | List requests / create emergency and start consent-based calls and alerts |
| GET | `/api/hospital/donors?bloodGroup=A_POSITIVE` | Preview available, call-consented matches at any distance |
| GET | `/api/hospital/ivr/status` | Report voice/SMS readiness and missing environment-variable names, without exposing values |
| POST | `/api/hospital/requests/:id/dispatch` | Retry voice dispatch and any undelivered consented alerts for an open request |
| PATCH | `/api/hospital/donor-records/:donorId/consent` | Record or revoke explicit donor call/SMS consent |
| POST | `/api/hospital/requests/:id/complete` | Close out accepted donor call records |
| GET / PUT | `/api/hospital/inventory` | Read BloodVerify stock confidence, anomalies, expiry risk and forecast / update reported stock |
| GET / POST | `/api/hospital/members` | Read donor-network counts / import up to 150 explicitly consented donors |
| GET | `/api/hospital/network` | List other registered hospitals' phone numbers, cities, and verified usable stock for authenticated hospital accounts |
| POST / PATCH / DELETE | `/api/donors/location` | Consent-token GPS, donor availability, and tracking revocation |
| POST | `/api/ivr/answer` | Twilio voice prompt |
| POST | `/api/ivr/response` | Process 1/2/no response |
| POST | `/api/ivr/status` | Process Twilio call lifecycle callbacks |
| POST | `/api/patient/register` | Create a patient portal account |
| POST | `/api/patient/login` | Sign in to the separate patient portal |
| GET | `/api/patient/inventory?city=...&bloodGroup=...` | Patient-authenticated city-level aggregate unit availability |

Emergency request input is `{ "bloodGroup": "O_NEGATIVE", "unitsRequired": 2 }`. The target is capped at 20 units. Twilio callbacks are authenticated using `X-Twilio-Signature`; the configured `APP_URL` must exactly match the public HTTPS callback host and scheme.

## Configure Twilio

Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, and the externally accessible HTTPS `APP_URL` for voice. For SMS, set either `TWILIO_PHONE_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID` with the account credentials. Outbound calls use the app's signed IVR and status callback URLs. Twilio credentials must remain server-side; the hospital dashboard reports configuration completeness and missing variable names without checking account or sender capabilities. Local calls require a secure tunnel and a matching public `APP_URL`.

Requests are saved even when Twilio is not configured, and the dashboard explains what is missing. Once configured, staff can retry voice dispatch on an open request. Up to five donors are called concurrently, and rollover continues until the requested units are confirmed. SMS is never sent unless a donor has separately opted in; existing records default to no SMS consent. SMS logs prevent duplicate alerts for the same request/donor pair. A Twilio trial account has provider-imposed limits and is not an unlimited free calling or messaging service; verify eligible recipient numbers and local messaging rules before use.

## Hospital account recovery

Configure `RESEND_API_KEY` and `PASSWORD_RESET_FROM` in the deployment environment. The sender must be verified with Resend. Reset requests are delivered to the account email and use a single-use token that expires after 30 minutes. The API returns the same success message whether or not an account exists, and applies per-email and per-IP request limits. Run the new Prisma migration before deploying these routes.

Forgotten account emails are not disclosed by the sign-in page. The hospital user must contact their hospital administrator or IT team through an official channel to verify identity and recover or update the registered email.

## Donor network import

The hospital dashboard separates live network counts from its 150-profile fictional preview. Demo profiles are display-only and are never written to the donor database or included in calling. To import actual records, download the dashboard CSV template and provide `Name,Phone,BloodGroup,Latitude,Longitude` columns. Phone numbers must use E.164 format (for example, `+14155550123`); blood groups use values such as `A_POSITIVE` or `O_NEGATIVE`. Imports are limited to 150 donors per file and reject duplicate phone numbers and invalid coordinates.

Import only donors who have explicitly agreed to emergency contact and location sharing. The consent confirmation is required for every import. Donors are created as available and tracking-consented; each receives a randomly generated activation token for sharing location. The token CSV is downloaded only once after a successful import. Treat it as sensitive bearer credentials, deliver each donor’s token through a secure channel, and never commit or publicly share the file. The database stores token hashes rather than the plaintext tokens.

## Patient portal, donor records, and BloodVerify

Patients register and sign in at `/patient`. Search results aggregate only unexpired, staff-released unit records across participating hospitals by city and blood group; legacy reported-only stock is excluded. Results do not disclose the contributing hospitals, donors, patients, or emergency call data. Availability is not a reservation and should be confirmed with the patient's care team.

Hospital staff add donors from **Donor records**. Phone numbers are normalized to E.164 format. Call, SMS, and location consent are separate: only available, eligible, call-consented donors can be called; only SMS-opted-in donors receive emergency texts. Matching is not limited by radius. Location consent and donor-confirmed GPS are optional and used only after call acceptance for live tracking and ETA. An address or neighborhood is not treated as a precise coordinate. Donor records and precise locations are hospital-only.

Use **Blood inventory** to register each unit. A new unit increases the reported stock by one and starts in pending testing; when entering a unit already included in a legacy aggregate count, uncheck **This is newly collected stock** to avoid double-counting. Qualified staff can release it only after confirming required testing; only unexpired released units count as usable. Reservations, issues, quarantine, expired units, stale reports, mismatches, and large stock increases are surfaced in the audit/alert views. Issuing a unit decreases reported stock and writes a unit audit event. The confidence score is a transparent rule-based quality signal, not clinical or ML certification.

Existing patient case data and tables are retained. The former Patient records dashboard section is now Donor records. Unit issues and corrections must be recorded through the verified unit ledger rather than changing aggregate stock through a patient case.

The **Donation history** area records donor/date/time and derives an administrative next-review date from the hospital-configured interval in months. The interval must be selected by the hospital's medical director based on applicable rules; there is no assumed default. Donors with a recorded future review date are excluded from new call matching. A calculated date is not a medical eligibility determination: clinical staff remain responsible for donor screening. Changing the configured interval applies only to future donation records.

## Hospital registration

To create a hospital login, open `/hospital`, choose **Register**, enter the hospital name and email, set a password of at least 12 characters, confirm it, and select **Create hospital account**. The account is signed in immediately. Before donor matching is available, complete the dashboard setup with the hospital address and latitude/longitude. For future visits, use **Sign in** with the same email and password.

Registration does not verify that the email belongs to a hospital. Protect the registration endpoint with appropriate operational controls before public production use. Google sign-in is only available after an account exists with the same verified email, and Google OAuth testing-mode accounts must also be listed as test users.

## Hospital-to-hospital emergency coordination

The hospital dashboard's **Hospital network** section lists every other registered hospital's phone number, city, and verified usable units by blood group. It is available to every signed-in hospital account at all times; it does not expose hospital emails, exact addresses, or coordinates. **Hospital registration is not independently verified**, so do not use this feature with real inventory until account enrollment is restricted to approved hospitals and participating organizations authorize the sharing. Add or update the phone number in Hospital settings and register unit-level stock in Blood inventory. A `tel:` link lets staff call another facility directly. Staff must call to confirm availability, compatibility, and transfer arrangements. BloodBridge does not reserve stock or arrange transfers between hospitals.

## Google hospital sign-in

Create a Google OAuth client for a web application and add the exact authorized redirect URI `https://YOUR_PRODUCTION_DOMAIN/api/hospital/google/callback`. For local development, separately authorize `http://localhost:3000` as a JavaScript origin and `http://localhost:3000/api/hospital/google/callback` as a redirect URI, then set `APP_URL=http://localhost:3000`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` in the ignored `.env.local` file. Production credentials do not automatically exist in a local environment. Set the Google credentials as server-side deployment secrets and redeploy. Google sign-in does not create hospital accounts: the Google account must have a verified email matching an existing hospital login email. The OAuth flow uses state, nonce, and PKCE; credentials are never sent to the browser.

## GitHub and deployment

The repository includes a GitHub Actions workflow for install, Prisma generation, type-check, and build. Deployment options:

- **Container host:** deploy the included `Dockerfile` with a managed PostgreSQL URL; the container applies migrations before starting.
- **Vercel:** the production build runs `npm run db:migrate` before building the app. Set `DATABASE_URL` in the Vercel Production environment; the deployment will stop if migration cannot be applied. Preview deployments do not migrate the production database. For other managed Next.js platforms, run `npm run db:migrate` as a release/pre-deploy step.

Before deploying, provision PostgreSQL, use a unique `SESSION_SECRET`, set `APP_URL` to the final HTTPS domain, set Twilio secrets, configure hospital seed credentials securely, and add an initial hospital account through the seed command. Do not commit `.env` or paste secrets into GitHub issues/chat.

## Production and safety checklist

- This is a prototype. Validate blood compatibility and donor eligibility with qualified clinical staff; this implementation intentionally matches exact blood groups and does not make clinical decisions.
- Integrate a road-routing service for reliable ETAs; current ETA is illustrative.
- Add operational on-call monitoring, webhook retry/dead-letter handling, rate limiting, backup/restore drills, retention policy, audit review, and donor-consent administration before real emergency use.
- Perform legal, privacy, security, accessibility, and healthcare compliance review for the deployment jurisdiction. Do not treat this project as HIPAA-compliant or as a substitute for emergency services.
- Use a managed database with encryption, restricted network access, and tested backups. Limit database and Twilio credentials to server-side deployment secrets.

## Project handover documents

- [Complete project documentation and database inspection guide](./docs/BloodBridge-Project-Documentation.docx)
- [Project presentation](./docs/BloodBridge-Project-Presentation.pptx)

To inspect a **local development database**, configure `DATABASE_URL` in the ignored `.env` file, apply migrations with `npm run db:migrate`, and run `npx prisma studio`. Prisma Studio can edit data, so use it with test data. For production, use the authorized PostgreSQL provider console and a read-only database role; do not expose connection strings or export donor, patient, password-hash, token, or location data. The documentation includes step-by-step Windows instructions and aggregate-only SQL examples.
