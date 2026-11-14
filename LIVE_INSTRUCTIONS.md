# BloodBridge — Live Deployment & Access Guide

## 🌐 Live Access URLs
Once the server is running, you can access the application at:
- **Hospital Dashboard:** [http://localhost:3000/hospital](http://localhost:3000/hospital)
- **Patient Portal:** [http://localhost:3000/patient](http://localhost:3000/patient)
- **Home / Root:** [http://localhost:3000/](http://localhost:3000/)

---

## ⚡ Quick 1-Click Start
You can launch the application immediately using either script in this directory:
- **Windows Batch:** Double-click `start.bat`
- **PowerShell:** Right-click `start.ps1` -> *Run with PowerShell*

The script will automatically generate the Prisma client, check database migrations, launch the server on port 3000, and open the live URL in your browser.

---

## 🔑 Default Hospital Admin Credentials
When seeded, you can sign in with:
- **Email:** `hospital@example.org`
- **Password:** `BloodBridgeAdmin2026!`

---

## 🗄️ Database Setup (PostgreSQL)

BloodBridge requires a PostgreSQL database for full backend data persistence (sessions, emergency requests, donor GPS coordinates, inventory ledger).

You have two easy options:

### Option A: Free Cloud PostgreSQL (Recommended — No installation needed)
You can get a free managed PostgreSQL connection string in 2 minutes:
1. Go to [Neon.tech](https://neon.tech/) or [Supabase.com](https://supabase.com/) and create a free PostgreSQL project.
2. Copy your connection URI (it looks like `postgresql://username:password@ep-something.neon.tech/blood_donor?sslmode=require`).
3. Open `.env` in this directory and replace `DATABASE_URL`:
   ```env
   DATABASE_URL="postgresql://username:password@ep-something.neon.tech/blood_donor?sslmode=require"
   ```
4. Run `npm run db:migrate` and `npm run db:seed`.

### Option B: Local PostgreSQL or Docker
If you have PostgreSQL or Docker installed locally:
- **Docker Compose:**
  ```sh
  docker compose up -d
  ```
- **Local PostgreSQL:**
  Ensure PostgreSQL is listening on `localhost:5432` with a database named `blood_donor`.

---

## 📞 Optional Integrations
To enable voice IVR calls, emergency SMS alerts, and email password resets, add your credentials in `.env`:
- **Twilio (Voice & SMS):** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- **Resend (Password Reset Emails):** `RESEND_API_KEY`, `PASSWORD_RESET_FROM`
- **Google OAuth (Sign in with Google):** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
