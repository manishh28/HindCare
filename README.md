# HindCare Hospital and Ambulance Aggregator

HindCare is a Phase 4 emergency healthcare platform prototype that connects patients with hospitals and ambulance operators — designed like consumer ambulance-booking services (Medulance, RED.Health, Medicab, etc.): **booking an ambulance is the primary action**, with self-service accounts, role-based operational dashboards, and a local tracking simulation.

> **Current status:** Phase 4 prototype using fictional, in-memory demo data. The tracking map is simulated and does not provide live GPS. This is not a live emergency service and does not connect to real hospitals, ambulance fleets, GPS services, or patient records. In a real emergency, call your local emergency number (e.g. **108** in India).

## Platform surfaces

The app is split into three entry points:

| Surface | URL | Purpose |
| --- | --- | --- |
| **Public site** | http://127.0.0.1:4173/ | Ambulance booking, optional patient accounts, partner sign-up |
| **Staff dashboard** | http://127.0.0.1:4173/profile/ | Operational ERP for drivers, dispatchers, hospital admins, fleet owners, super admins |
| **Enterprise login** | http://127.0.0.1:4173/auth/ | Enterprise and MFA-protected sign-in |

## Design approach

- **Booking comes first.** The hero form (patient name, phone, pickup, emergency type) works with **no login required**. Hospital is auto-matched from the pickup area.
- **Accounts are optional for patients.** Signing in saves your details and shows booking history tied to your phone or account — but never blocks an emergency request.
- **Partners self-register.** Hospitals, fleet owners, and drivers create accounts from the main site **Sign in** panel and manage operations from `/profile/`.
- **Real authorization.** Protected API routes use JWT sessions and role-based permissions — not a client-side role switcher.
- **Dispatcher workspace.** Dispatchers can view active requests, see ambulances and drivers, assign or reassign trips, and move bookings through the active trip lifecycle.
- **Hospital sub-roles.** Hospital owners can create Doctor, Reception, and Staff accounts. Each role receives a narrower hospital view and permission set.
- **Local tracking simulation.** A booking lookup shows pickup, hospital, and ambulance markers with simulated ambulance movement. It is not live GPS.
- **Honest demo data.** Stats (fleet ready, hospitals in network, avg. dispatch distance) are computed live from in-memory data, not invented marketing numbers.

## User roles

| Role | Sign in via | Dashboard |
| --- | --- | --- |
| **Patient / Customer** | Main site → **Sign in** (phone or email + password) | Account panel on homepage |
| **Hospital admin** | Main site → Sign in or Create account → Hospital | `/profile/#hospital-admin` |
| **Hospital doctor** | Hospital owner creates the account | `/profile/#hospital` |
| **Hospital reception** | Hospital owner creates the account | `/profile/#hospital` |
| **Hospital staff** | Hospital owner creates the account | `/profile/#hospital` |
| **Fleet owner** | Main site → Create account → Ambulance fleet | `/profile/#fleet-owner` |
| **Driver** | Main site → Create account → Driver (requires fleet code) | `/profile/#driver` |
| **Dispatcher** | Main site → Sign in (email/phone + password) | `/profile/#dispatcher` |
| **Super admin** | `/auth/` → Enterprise sign-in | `/profile/#super-admin` |

## Features

### Public site (`/`)

- Hero-first ambulance booking with nearest-available-ambulance dispatch
- Optional patient accounts (sign in, booking history, profile basics)
- Multi-role sign-up: Patient, Hospital, Ambulance fleet, Driver
- Hospital and fleet partner onboarding
- Hospital directory, fleet status, booking board
- Stateful chatbot for booking and hospital search
- Mobile navigation and expanded site footer

### Staff dashboard (`/profile/`)

- Role-based sidebar navigation and overview pages
- Edit profile, notifications, emergency contacts, addresses
- **Driver** — documents, availability status, assigned trip status updates
- **Dispatcher** — live status, request queue, ambulance/driver assignment, active trip monitoring
- **Hospital admin** — manage own hospital, beds, departments, and hospital team accounts
- **Hospital doctor** — view assigned hospital, departments, and recent ambulance requests
- **Hospital reception** — view hospital operations and update live bed availability
- **Hospital staff** — view assigned hospital information with read-only access
- **Fleet owner** — register ambulances, assign drivers, fleet overview
- **Super admin** — activity log, system information

### Authentication and security

- JWT access tokens with refresh-token rotation
- Role-based access control (RBAC) on all protected endpoints
- MFA for hospital admin and super admin accounts
- Rate limiting on login, signup, OTP, and public write endpoints
- Honeypot fields on public forms
- Security headers (CSP, HSTS, X-Frame-Options, etc.)
- Session revocation on password change
- Optional `.env` configuration (see `backend/.env.example`)

## Technology

- HTML, CSS, and JavaScript (no frontend build step)
- Node.js built-in HTTP server (no npm dependencies for the demo)
- In-memory data store at runtime
- PostgreSQL schema files in `database/` for future integration

## Run locally

### Requirements

- Node.js 18 or newer
- A modern web browser

### Start the server

From the project root:

```powershell
node backend/server.js
```

Then open http://127.0.0.1:4173

Press `Ctrl+C` to stop the server.

### Optional configuration

Copy `backend/.env.example` to `.env` in the **project root** (not inside `backend/`):

```powershell
copy backend\.env.example .env
```

Set `JWT_SECRET` before any shared or production deployment. In local development a random secret is generated on each restart if none is set — you will need to sign in again after restarting the server.

## Demo credentials

**Password for all seeded staff accounts:** `HindCare@2026`

| Role | How to sign in |
| --- | --- |
| Fleet owner | Email: `suresh@yadavambulance.in` (main site Sign in) |
| Driver | Email: `rahul.singh@fleet.hindcare.in` or phone: `9111111111` |
| Dispatcher | Email: `dispatch@hindcare.in` or phone: `9222222222` |
| Hospital admin | Email: `admin@hindcare-hospital.in` (main site Sign in, MFA required) |
| Hospital doctor | Email: `doctor@hindcare-hospital.in` |
| Hospital reception | Email: `reception@hindcare-hospital.in` |
| Super admin | Email: `superadmin@hindcare.in` at `/auth/` (MFA required) |

**Patients** are not pre-seeded — create an account via the main site **Sign in** panel → Create account → Patient.

For MFA-protected accounts in local demo mode, the one-time code is returned in the login API response (check the browser Network tab → `login` → Response → `demoOtp`).

## Project structure

```text
backend/
  server.js           HTTP server, static files, core API routes
  auth/               JWT auth, sessions, OTP, RBAC middleware
  profile/            Profile management API routes
chatbot/              Chatbot intent, session, and response logic
database/
  schema.sql          Core booking/hospital/ambulance schema
  auth-schema.sql     Users, roles, profiles, sessions (PostgreSQL)
  seed.sql            Fictional hospital/ambulance seed data
docs/                 Project and technical documentation
frontend/
  index.html          Public booking site + account panel
  app.js              Booking UI, patient accounts, partner forms
  auth/               Super Admin enterprise login (MD3)
  profile/            Staff ERP dashboard
```

## API routes

### Core

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/health` | — | Server health check |
| `GET` | `/api/hospitals` | — | List hospitals |
| `POST` | `/api/hospitals` | — | Submit hospital (starts as `pending`; honeypot protected) |
| `PATCH` | `/api/hospitals/:id` | JWT | Approve/reject (super admin), manage own hospital (hospital admin), or update beds (hospital reception) |
| `GET` | `/api/ambulances` | — | List ambulances (driver contact redacted for public) |
| `POST` | `/api/ambulances` | JWT (fleet owner) | Register an ambulance to your fleet |
| `PATCH` | `/api/ambulances/:id` | JWT (owner/admin) | Update status or assign driver |
| `POST` | `/api/bookings` | — | Create ambulance booking (auto-dispatch) |
| `GET` | `/api/bookings/lookup` | — | Lookup booking by ID + phone |
| `GET` | `/api/bookings` | JWT (staff) | All bookings (staff roles only) |
| `GET` | `/api/my-bookings` | JWT (patient) | Bookings for signed-in patient |
| `PATCH` | `/api/bookings/:id` | JWT (staff) | Update booking status or dispatcher assignment |
| `POST` | `/api/chatbot/message` | — | Chatbot message (rate limited) |

### Authentication (`/api/auth/*`)

| Method | Route | Description |
| --- | --- | --- |
| `POST` | `/api/auth/signup` | Register (roles: `customer`, `hospital_admin`, `fleet_owner`, `driver`) |
| `POST` | `/api/auth/login` | Sign in (role-aware) |
| `POST` | `/api/auth/refresh` | Refresh access token |
| `POST` | `/api/auth/logout` | End current session |
| `GET` | `/api/auth/me` | Current user |
| `POST` | `/api/auth/forgot-password` | Request password reset |
| `POST` | `/api/auth/reset-password` | Reset password with token |
| `POST` | `/api/auth/otp/send` | Send OTP |
| `POST` | `/api/auth/otp/verify` | Verify OTP |

### Profile (`/api/profile/*`)

All profile routes require a valid JWT.

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/api/profile` | Full profile with role-specific data |
| `PATCH` | `/api/profile` | Update profile fields |
| `GET/PATCH` | `/api/profile/notifications` | Notification preferences |
| `GET/POST` | `/api/profile/emergency-contacts` | Emergency contacts |
| `GET/POST` | `/api/profile/addresses` | Saved addresses |
| `PATCH` | `/api/profile/availability` | Driver availability |
| `PATCH` | `/api/profile/live-status` | Dispatcher live status |
| `GET` | `/api/profile/audit-logs` | Audit log (admin roles) |
| `GET` | `/api/profile/hospital-team` | List team accounts (hospital admin) |
| `POST` | `/api/profile/hospital-team` | Create doctor, reception, or staff account (hospital admin) |

See [`docs/api-docs.md`](docs/api-docs.md) for request and response examples.

## Data and security

The current application uses temporary mock data stored in server memory. Restarting the server resets bookings and any accounts created during that session (seeded demo staff accounts are re-created on startup).

- Store secrets in a local `.env` file — never commit it. See `backend/.env.example`.
- Read [`docs/security-and-privacy.md`](docs/security-and-privacy.md) before connecting real services or personal data.
- The placeholder emergency number (+91 1800-000-000) does not connect to anyone — replace it before any real use.

## Documentation

- [`docs/project-summary.md`](docs/project-summary.md) — product vision and development phases
- [`docs/api-docs.md`](docs/api-docs.md) — API documentation
- [`docs/chatbot-flows.md`](docs/chatbot-flows.md) — chatbot conversation flows
- [`docs/project-notes.md`](docs/project-notes.md) — progress notes
- [`docs/internship-onboarding.md`](docs/internship-onboarding.md) — onboarding checklist
- [`docs/security-and-privacy.md`](docs/security-and-privacy.md) — security and privacy guidance
