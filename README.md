# HindCare Hospital and Ambulance Aggregator

HindCare is a Phase 4 emergency healthcare platform prototype that connects patients with hospitals and ambulance operators — designed like consumer ambulance-booking services (Medulance, RED.Health, Medicab, etc.): **booking an ambulance is the primary action**, with self-service accounts, role-based operational dashboards, and a local tracking simulation.

> **Current status:** Working prototype backed by PostgreSQL for bookings, hospitals, ambulances, and auth state (users, sessions, OTPs, audit logs persist across restarts via the `app_auth_state` table). The tracking map is simulated and does not provide live GPS. This is not a live emergency service and does not connect to real hospitals, ambulance fleets, GPS services, or patient records. In a real emergency, call your local emergency number (e.g. **108** in India).

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
- **Honest demo data.** Stats (fleet ready, hospitals in network, avg. dispatch distance) are computed live from the database, not invented marketing numbers.

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

- JWT access tokens (15 min) with single-use refresh-token rotation and replay detection (reuse of a retired token revokes all sessions; near-simultaneous refreshes return 409 `CONCURRENT_REFRESH`)
- HttpOnly `SameSite=Lax` session cookies (`hindcare_access`, `hindcare_refresh`) — tokens never touch JavaScript storage
- JWT issuer/algorithm/session binding validated on every request
- Role-based access control (RBAC) on all protected endpoints
- MFA for hospital admin and super admin accounts (codes delivered out-of-band, never in API responses)
- Rate limiting on login, signup, OTP (per IP and per destination), refresh, and public write endpoints
- Account lockout after repeated failed logins; session revocation on password change/reset
- Honeypot fields on public forms; magic-byte validation on profile photo uploads
- Security headers (strict CSP with no third-party script hosts — Lenis is self-hosted, HSTS, X-Frame-Options, etc.)
- Guest booking lookup requires the full booking phone number and returns masked PII
- PostgreSQL TLS certificate verification on by default; optional HTTPS termination or reverse-proxy redirect
- Demo accounts are disabled unless explicitly opted in (see below)
- Optional `.env` configuration (see `backend/.env.example`)

## Technology

- HTML, CSS, and JavaScript (no frontend build step)
- Node.js built-in HTTP server plus `pg` (PostgreSQL) and `dotenv`
- PostgreSQL for bookings, hospitals, ambulances, and durable auth state (`app_auth_state`); in-memory working set hydrated at startup
- SQL schemas and seed data in `database/`

## Run locally

### Requirements

- Node.js 18 or newer
- PostgreSQL 14 or newer with the schemas in `database/` applied (`schema.sql`, `auth-schema.sql`, plus seed files)
- A modern web browser

### Start the server

From the project root:

```powershell
npm install
node backend/server.js
```

Then open http://127.0.0.1:4173

Press `Ctrl+C` to stop the server.

On first boot the server hydrates auth state from the `app_auth_state` table (creating it if needed). In production it refuses to start if auth state cannot be loaded; in development it warns and continues with a fresh store.

### Optional configuration

Copy `backend/.env.example` to `.env` in the **project root** (not inside `backend/`):

```powershell
copy backend\.env.example .env
```

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `DATABASE_SSL` | Set to `false` only for local dev against a TLS-less database; certificate verification is strict by default |
| `JWT_SECRET` | Signs all login tokens. Required in production; in dev a random one is generated per restart (you'll sign in again after each restart) |
| `ENABLE_DEMO_ACCOUNTS` | Set to `true` on non-production runs to seed demo staff accounts (off by default, ignored in production) |
| `ALLOWED_ORIGINS` | Comma-separated API origins; defaults to the local app origin |
| `TLS_KEY_PATH` / `TLS_CERT_PATH` | PEM files for direct HTTPS termination (otherwise run behind an HTTPS reverse proxy) |
| `TRUST_PROXY` | Set to `true` behind a reverse proxy: trusts `X-Forwarded-*` for client IPs and redirects plain-HTTP requests to HTTPS |

## Demo credentials

Demo accounts are **not** created unless `ENABLE_DEMO_ACCOUNTS=true` is set on a non-production run.

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

For MFA-protected accounts, the one-time code is printed to the **server console** in local development only (never returned in API responses). In production, wire `deliverSecurityCode()` in `backend/auth/routes.js` to a real email/SMS provider.

## Project structure

```text
backend/
  server.js           HTTP(S) server, static files, core API routes
  db.js               PostgreSQL pool (TLS verification on by default)
  auth/               JWT auth, sessions, OTP, RBAC middleware
    crypto.js         Token signing, password hashing, secret handling
    store.js          User/session/OTP working set (synchronous lookups)
    persist.js        Hydrates/flushes auth state to PostgreSQL (app_auth_state)
    middleware.js     Bearer + HttpOnly-cookie auth, RBAC guards
    routes.js         /api/auth/* endpoints
  profile/            Profile management and super-admin API routes
chatbot/              Chatbot intent, session, and response logic
database/
  schema.sql          Core booking/hospital/ambulance schema
  auth-schema.sql     Users, roles, profiles, sessions (PostgreSQL)
  seed.sql            Fictional hospital/ambulance seed data
  auth-seed.sql       Demo staff accounts (only used with ENABLE_DEMO_ACCOUNTS)
docs/                 Project and technical documentation
frontend/
  index.html          Public booking site + account panel
  app.js              Booking UI, patient accounts, partner forms
  assets/vendor/      Self-hosted third-party assets (Lenis)
  auth/               Enterprise login (MD3)
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
| `GET` | `/api/bookings/lookup` | — | Track a booking by ID + full phone number (PII masked, rate limited) |
| `GET` | `/api/bookings` | JWT (staff) | All bookings (staff roles only) |
| `GET` | `/api/my-bookings` | JWT (patient) | Bookings for signed-in patient |
| `PATCH` | `/api/bookings/:id` | JWT (staff) | Update booking status or dispatcher assignment |
| `PATCH` | `/api/driver/location` | JWT (driver) | GPS update for the driver's active trip |
| `POST` | `/api/chatbot/message` | — | Chatbot message (rate limited, server-set session cookie) |

### Authentication (`/api/auth/*`)

| Method | Route | Description |
| --- | --- | --- |
| `POST` | `/api/auth/signup` | Register (roles: `customer`, `hospital_admin`, `fleet_owner`, `driver`) |
| `POST` | `/api/auth/login` | Sign in (role-aware, MFA step when required) |
| `POST` | `/api/auth/refresh` | Rotate refresh token (single-use; replay revokes all sessions) |
| `POST` | `/api/auth/logout` | End current session (revokes cookies) |
| `POST` | `/api/auth/logout-all` | Revoke all other sessions |
| `POST` | `/api/auth/change-password` | Change password (revokes other sessions) |
| `GET` | `/api/auth/me` | Current user |
| `GET` | `/api/auth/sessions` | Active sessions for current user |
| `GET` | `/api/auth/login-history` | Recent login attempts for current user |
| `POST` | `/api/auth/password-strength` | Password strength check |
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
| `POST/DELETE` | `/api/profile/photo` | Upload/remove profile photo (magic-byte validated) |
| `GET` | `/api/profile/export` | Export personal data |
| `DELETE` | `/api/profile/account` | Self-service deletion (disabled for staff — contact an admin) |
| `GET/PATCH` | `/api/profile/notifications` | Notification preferences |
| `GET/POST` | `/api/profile/emergency-contacts` | Emergency contacts |
| `GET/POST` | `/api/profile/addresses` | Saved addresses |
| `PATCH` | `/api/profile/availability` | Driver availability |
| `PATCH` | `/api/profile/live-status` | Dispatcher live status |
| `GET` | `/api/profile/audit-logs` | Audit log (admin roles) |
| `GET` | `/api/profile/hospital-team` | List team accounts (hospital admin) |
| `POST` | `/api/profile/hospital-team` | Create doctor, reception, or staff account (hospital admin) |

### Super admin (`/api/admin/*`)

All admin routes require a super-admin JWT.

| Method | Route | Description |
| --- | --- | --- |
| `GET/PATCH` | `/api/admin/users` and `/api/admin/users/:id` | List users, suspend/lock accounts, change non-admin roles |
| `POST` | `/api/admin/partner-accounts` | Provision a verified hospital admin or fleet owner (auto-creates an approved hospital for hospital admins) |

See [`docs/api-docs.md`](docs/api-docs.md) for request and response examples.

## Data and security

Bookings, hospitals, and ambulances live in PostgreSQL. Auth state (users, sessions, OTPs, reset tokens, audit logs, login history) is hydrated from the `app_auth_state` table at startup and flushed back on a short debounce, a periodic sweep, and shutdown — restarts no longer wipe accounts or sessions. Plaintext secrets (refresh tokens, OTPs, reset tokens) are hashed at rest and stripped from persisted snapshots.

- Store secrets in a local `.env` file — never commit it. See `backend/.env.example`.
- Demo staff accounts are only seeded with `ENABLE_DEMO_ACCOUNTS=true` on non-production runs — never enable it on an internet-facing host.
- Read [`docs/security-and-privacy.md`](docs/security-and-privacy.md) before connecting real services or personal data.
- The placeholder emergency number (+91 1800-000-000) does not connect to anyone — replace it before any real use.

## Documentation

- [`docs/project-summary.md`](docs/project-summary.md) — product vision and development phases
- [`docs/api-docs.md`](docs/api-docs.md) — API documentation
- [`docs/chatbot-flows.md`](docs/chatbot-flows.md) — chatbot conversation flows
- [`docs/project-notes.md`](docs/project-notes.md) — progress notes
- [`docs/internship-onboarding.md`](docs/internship-onboarding.md) — onboarding checklist
- [`docs/security-and-privacy.md`](docs/security-and-privacy.md) — security and privacy guidance
