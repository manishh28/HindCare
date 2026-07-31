# HindCare Hospital and Ambulance Aggregator

HindCare is a Phase 1 prototype for connecting patients with hospitals and ambulance operators through one emergency-care platform.

The prototype demonstrates the main workflow: a patient submits an ambulance request, hospitals are displayed with basic availability information, ambulance records are shown to fleet users, and a simple chatbot responds to common support questions.

> **Current status:** Phase 1 prototype using fictional, in-memory demo data. This is not a live emergency service and does not yet connect to real hospitals, ambulance fleets, GPS services, or patient records.

## Features

- Patient ambulance booking form
- Hospital directory with approval and bed-availability details
- Ambulance fleet status view
- Basic chatbot intent handling
- Mock REST API for hospitals, ambulances, bookings, and chatbot messages
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
chatbot/    Chatbot intent and response logic
database/   Database schema and fictional seed data
docs/       Project and technical documentation
frontend/   Patient, hospital, fleet, and admin demo screens
```

## API Routes

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Check whether the server is running |
| `GET` | `/api/hospitals` | Retrieve hospital records |
| `POST` | `/api/hospitals` | Add a hospital record |
| `GET` | `/api/ambulances` | Retrieve ambulance records |
| `POST` | `/api/ambulances` | Add an ambulance record |
| `GET` | `/api/bookings` | Retrieve demo bookings |
| `POST` | `/api/bookings` | Create an ambulance booking |
| `POST` | `/api/chatbot/message` | Send a message to the chatbot |

See [`docs/api-docs.md`](docs/api-docs.md) for request and response examples.


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
