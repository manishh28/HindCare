# HindCare Hospital and Ambulance Aggregator

HindCare is a Phase 1 prototype for connecting patients with hospitals and ambulance operators through one emergency-care platform.

The prototype demonstrates the main workflow: a patient submits an ambulance request, hospitals are displayed with basic availability information, ambulance records are shown to fleet users, and a simple chatbot responds to common support questions.

> **Current status:** Phase 1 prototype using fictional, in-memory demo data. This is not a live emergency service and does not yet connect to real hospitals, ambulance fleets, GPS services, or patient records.

## Features

- Patient ambulance booking form with hospital selection and nearest-ambulance dispatch
- Hospital directory with approval workflow and bed-availability details
- Ambulance fleet status view with status management
- Booking lifecycle tracking (requested -> assigned -> on route -> completed/cancelled)
- Stateful chatbot that can carry a booking or hospital-search conversation across turns
- Mock REST API for hospitals, ambulances, bookings, and chatbot messages
- A demo-only role switcher (Patient / Hospital / Fleet / Admin) that shows how role-gated actions will work once real authentication is added
- PostgreSQL schema and fictional seed data for the next development stage
- Project documentation for APIs, chatbot flows, security, and onboarding

## Technology

- HTML, CSS, and JavaScript
- Node.js built-in HTTP server
- PostgreSQL schema and SQL seed file
- No external packages required for the local Phase 1 demo

## Run Locally

### Requirements

- Node.js 18 or newer
- A modern web browser

### Start the server

Run this command from the project root:

```powershell
node backend/server.js
```

Then open:

```text
http://127.0.0.1:4173
```

The server hosts the frontend and API together. Press `Ctrl+C` to stop it.

## Project Structure

```text
backend/    Node.js server and API routes
chatbot/    Chatbot intent, session, and response logic
database/   Database schema and fictional seed data
docs/       Project and technical documentation
frontend/   Patient, hospital, fleet, and admin demo screens
```

## API Routes

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Check whether the server is running |
| `GET` | `/api/hospitals` | Retrieve hospital records |
| `POST` | `/api/hospitals` | Add a hospital record (starts as `pending`) |
| `PATCH` | `/api/hospitals/:id` | Approve or reject a hospital (demo `admin` role) |
| `GET` | `/api/ambulances` | Retrieve ambulance records |
| `POST` | `/api/ambulances` | Add an ambulance record |
| `PATCH` | `/api/ambulances/:id` | Update ambulance status (demo `fleet`/`admin` role) |
| `GET` | `/api/bookings` | Retrieve demo bookings |
| `POST` | `/api/bookings` | Create an ambulance booking (auto-assigns nearest available ambulance) |
| `PATCH` | `/api/bookings/:id` | Move a booking through its status lifecycle |
| `POST` | `/api/chatbot/message` | Send a message to the stateful chatbot |

See [`docs/api-docs.md`](docs/api-docs.md) for request and response examples.

## Demo role switcher (not real authentication)

The frontend includes a role dropdown (Patient / Hospital / Fleet / Admin) that sends an `x-demo-role` header on requests that change hospital, ambulance, or booking status. This exists only to preview how role-gated actions will look and is **not** a security control — there is no password, session, or identity check behind it. Real authentication (backed by the `users` table in `database/schema.sql`) is planned for a later phase. See [`docs/security-and-privacy.md`](docs/security-and-privacy.md).

## Data and Security

The current application uses temporary mock data stored in server memory.

Store private configuration in a local `.env` file or a deployment secret manager. The `.gitignore` file is configured to exclude environment files, local databases, exports, and uploads. Read [`docs/security-and-privacy.md`](docs/security-and-privacy.md) before connecting real services or personal data.

## Documentation

- [`docs/project-summary.md`](docs/project-summary.md) - product vision and development phases
- [`docs/api-docs.md`](docs/api-docs.md) - API documentation
- [`docs/chatbot-flows.md`](docs/chatbot-flows.md) - chatbot conversation flows
- [`docs/project-notes.md`](docs/project-notes.md) - progress notes
- [`docs/internship-onboarding.md`](docs/internship-onboarding.md) - onboarding checklist
- [`docs/security-and-privacy.md`](docs/security-and-privacy.md) - security and privacy guidance
