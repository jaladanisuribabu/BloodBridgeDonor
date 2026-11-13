# BloodBridge — Emergency Donor Coordination

**Created:** 2026-11-13  
**Project status:** Deployable prototype; not validated or approved for clinical use.

BloodBridge is a hospital-facing web application for emergency blood requests, nearby donor call-outs, donor-confirmed availability, consent-based location updates, and inventory shortage estimates.

## Architecture

- **Web app and API:** Next.js App Router, TypeScript, React.
- **Database:** PostgreSQL with Prisma migrations.
- **Matching:** exact blood-group match; consented, available donors within 5 km, sorted by Haversine distance. A database row lock prevents one donor being reserved concurrently by two requests.
- **Voice:** Twilio Programmable Voice, with signed webhooks and DTMF response handling.
- **Hospital access:** password hashes using bcrypt and an HTTP-only, signed hospital session cookie. Hospital tracking APIs require that session and scope requests to its hospital.
- **Patient access:** separate password-based patient accounts and cookies. Patient availability searches return only blood-group totals aggregated by city; they never return hospital names, donor details, patient records, or tracking data.
- **Google sign-in:** Google OpenID Connect with state, nonce, and PKCE; only verified Google emails matching an existing hospital account are accepted.
- **Account recovery:** single-use, 30-minute password-reset links delivered by Resend. Reset requests are rate-limited and return a generic message that does not reveal whether an email is registered. Forgotten hospital email recovery is administrator-assisted.
- **Location:** donors post coordinates with a one-time generated bearer token after accepting. Tracking is opt-in and can be revoked.
- **ETA:** displayed as a rough straight-line distance estimate at 25 km/h plus five minutes. It is not road-route guidance.
- **Shortage forecast:** 90-day request history divided into an average daily demand, projected over seven days and compared with manually maintained stock. This is a transparent baseline, not a trained machine-learning model.

Request flow:

```text
Hospital session → emergency request → donor search (5 km) → reserve up to 5 calls
  → Twilio IVR → donor presses 1/2 or times out → persist response
  → replenish queue / stop calls at target → consented donor GPS → hospital dashboard
```

## Database

The dated initial migration is `prisma/migrations/20261113154000_initial/migration.sql`. It creates:

- `Donor`, `Hospital`, `EmergencyRequest`, `CallLog`, `LocationTracking`
- `BloodInventory` for hospital stock and shortage analytics
- enums and indexes, including unique donor-per-request call attempts

Apply migrations using `npm run db:migrate` (deployment) or `npm run db:dev` (local development). Never edit an applied migration; create a new dated migration for later schema changes.

The `20261113190000_patient_portal_and_staff_records` migration adds the patient portal account table, hospital city/mobile/policy fields, confidential hospital patient cases, inventory change history, and donor donation dates. Apply it before deploying this release.

## Local development

Requirements: Node.js 22+, npm, and PostgreSQL 16+. Docker Compose is also supplied, but Docker is not required if PostgreSQL is already running.

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
5. Add donors with `npm run donor:create`. Record explicit consent; the command prints a random location token once. Deliver that token securely to the donor; never put it in source control or logs.

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
| PATCH | `/api/hospital/cases/:caseId` | Record units issued, atomically debit stock, and audit the change |
| GET / POST | `/api/hospital/donations` | Read hospital donor history / record donation date and administrative next-review date |
| POST | `/api/hospital/login` | Create hospital session |
| GET | `/api/hospital/google/start` | Start Google OpenID Connect sign-in |
| GET | `/api/hospital/google/callback` | Verify Google identity and create hospital session |
| GET | `/api/hospital/google/status` | Report whether Google sign-in is configured, without exposing credentials |
| POST | `/api/hospital/password-reset/request` | Request a one-time reset link by email |
| POST | `/api/hospital/password-reset/confirm` | Set a new password with a valid reset token |
| POST | `/api/hospital/logout` | Clear session |
| GET | `/api/hospital/me` | Current hospital account and matching coordinates |
| PUT | `/api/hospital/profile` | Save hospital address and coordinates for matching |
| GET / POST | `/api/hospital/requests` | List requests / create emergency and start calls |
| GET | `/api/hospital/donors?bloodGroup=A_POSITIVE` | Preview available matches within 5 km |
| POST | `/api/hospital/requests/:id/complete` | Close out accepted donor call records |
| GET / PUT | `/api/hospital/inventory` | Read seven-day baseline forecast / update stock |
| GET / POST | `/api/hospital/members` | Read donor-network counts / import up to 150 explicitly consented donors |
| POST / PATCH / DELETE | `/api/donors/location` | Consent-token GPS, donor availability, and tracking revocation |
| POST | `/api/ivr/answer` | Twilio voice prompt |
| POST | `/api/ivr/response` | Process 1/2/no response |
| POST | `/api/ivr/status` | Process Twilio call lifecycle callbacks |
| POST | `/api/patient/register` | Create a patient portal account |
| POST | `/api/patient/login` | Sign in to the separate patient portal |
| GET | `/api/patient/inventory?city=...&bloodGroup=...` | Patient-authenticated city-level aggregate unit availability |

Emergency request input is `{ "bloodGroup": "O_NEGATIVE", "unitsRequired": 2 }`. The target is capped at 20 units. Twilio callbacks are authenticated using `X-Twilio-Signature`; the configured `APP_URL` must exactly match the public HTTPS callback host and scheme.

## Configure Twilio

Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, and the externally accessible HTTPS `APP_URL`. Outbound calls use the app's signed IVR and status callback URLs. Twilio credentials must remain server-side. Local calls require a secure tunnel and a matching public `APP_URL`.

Without Twilio credentials, emergency requests are saved but calls cannot start; configure Twilio before using request creation.

## Hospital account recovery

Configure `RESEND_API_KEY` and `PASSWORD_RESET_FROM` in the deployment environment. The sender must be verified with Resend. Reset requests are delivered to the account email and use a single-use token that expires after 30 minutes. The API returns the same success message whether or not an account exists, and applies per-email and per-IP request limits. Run the new Prisma migration before deploying these routes.

Forgotten account emails are not disclosed by the sign-in page. The hospital user must contact their hospital administrator or IT team through an official channel to verify identity and recover or update the registered email.

## Donor network import

The hospital dashboard separates live network counts from its 150-profile fictional preview. Demo profiles are display-only and are never written to the donor database or included in calling. To import actual records, download the dashboard CSV template and provide `Name,Phone,BloodGroup,Latitude,Longitude` columns. Phone numbers must use E.164 format (for example, `+14155550123`); blood groups use values such as `A_POSITIVE` or `O_NEGATIVE`. Imports are limited to 150 donors per file and reject duplicate phone numbers and invalid coordinates.

Import only donors who have explicitly agreed to emergency contact and location sharing. The consent confirmation is required for every import. Donors are created as available and tracking-consented; each receives a randomly generated activation token for sharing location. The token CSV is downloaded only once after a successful import. Treat it as sensitive bearer credentials, deliver each donor’s token through a secure channel, and never commit or publicly share the file. The database stores token hashes rather than the plaintext tokens.

## Patient portal and hospital records

Patients register and sign in at `/patient`. Search results aggregate units across participating hospitals by city and blood group only; they do not disclose the contributing hospitals, donors, patients, or emergency call data. Availability is not a reservation and should be confirmed with the patient's care team.

Hospital staff use the dashboard's single-section workspace. The separate **Patient records** area stores a name, optional hospital reference, blood group, requested/issued unit totals, and an optional staff note. Issuing additional units atomically decrements the hospital's blood inventory; corrections add the units back. Stock adjustments are retained in a hospital-only audit trail. Avoid entering diagnoses or unnecessary sensitive patient details.

The **Donation history** area records donor/date/time and derives an administrative next-review date from the hospital-configured interval in months. The interval must be selected by the hospital's medical director based on applicable rules; there is no assumed default. Donors with a recorded future review date are excluded from new call matching. A calculated date is not a medical eligibility determination: clinical staff remain responsible for donor screening. Changing the configured interval applies only to future donation records.

## Hospital registration

To create a hospital login, open `/hospital`, choose **Register**, enter the hospital name and email, set a password of at least 12 characters, confirm it, and select **Create hospital account**. The account is signed in immediately. Before donor matching is available, complete the dashboard setup with the hospital address and latitude/longitude. For future visits, use **Sign in** with the same email and password.

Registration does not verify that the email belongs to a hospital. Protect the registration endpoint with appropriate operational controls before public production use. Google sign-in is only available after an account exists with the same verified email, and Google OAuth testing-mode accounts must also be listed as test users.

## Google hospital sign-in

Create a Google OAuth client for a web application and add the exact authorized redirect URI `https://YOUR_PRODUCTION_DOMAIN/api/hospital/google/callback`. For local development, separately authorize `http://localhost:3000` as a JavaScript origin and `http://localhost:3000/api/hospital/google/callback` as a redirect URI, then set `APP_URL=http://localhost:3000`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` in the ignored `.env.local` file. Production credentials do not automatically exist in a local environment. Set the Google credentials as server-side deployment secrets and redeploy. Google sign-in does not create hospital accounts: the Google account must have a verified email matching an existing hospital login email. The OAuth flow uses state, nonce, and PKCE; credentials are never sent to the browser.

## GitHub and deployment

The repository includes a GitHub Actions workflow for install, Prisma generation, type-check, and build. Deployment options:

- **Container host:** deploy the included `Dockerfile` with a managed PostgreSQL URL; the container applies migrations before starting.
- **Managed Next.js platform:** deploy the Next.js project and set the same production environment variables. Run `npm run db:migrate` as a release/pre-deploy step; do not rely on build-time database access.

Before deploying, provision PostgreSQL, use a unique `SESSION_SECRET`, set `APP_URL` to the final HTTPS domain, set Twilio secrets, configure hospital seed credentials securely, and add an initial hospital account through the seed command. Do not commit `.env` or paste secrets into GitHub issues/chat.

## Production and safety checklist

- This is a prototype. Validate blood compatibility and donor eligibility with qualified clinical staff; this implementation intentionally matches exact blood groups and does not make clinical decisions.
- Integrate a road-routing service for reliable ETAs; current ETA is illustrative.
- Add operational on-call monitoring, webhook retry/dead-letter handling, rate limiting, backup/restore drills, retention policy, audit review, and donor-consent administration before real emergency use.
- Perform legal, privacy, security, accessibility, and healthcare compliance review for the deployment jurisdiction. Do not treat this project as HIPAA-compliant or as a substitute for emergency services.
- Use a managed database with encryption, restricted network access, and tested backups. Limit database and Twilio credentials to server-side deployment secrets.
