# HindCare Hospital and Ambulance Aggregator

Starter workspace for the Hospital and Ambulance Aggregator Website internship project.

## What This Includes

- `frontend/` - static patient, hospital, fleet, and admin demo screens.
- `backend/` - no-install Node.js API server using in-memory demo data.
- `chatbot/` - simple intent handler for emergency bookings and support questions.
- `database/` - PostgreSQL schema and seed data.
- `docs/` - project summary, API notes, chatbot flows, and onboarding checklist.

## Quick Start

Run the local demo:

```powershell
node backend/server.js
```

Then open:

```text
http://127.0.0.1:4173
```

The backend serves both the frontend and the API.

## First Internship Tasks

1. Read `docs/project-summary.md` to understand the product vision.
2. Review `database/schema.sql` and identify the main entities.
3. Run the local demo and test booking an ambulance from the frontend.
4. Read `docs/api-docs.md` and test one API endpoint.
5. Update `docs/project-notes.md` daily with what you completed and what blocked you.

## Suggested Tech Direction

This starter uses plain HTML, CSS, and Node.js so you can begin without installing packages. A production version can later move to:

- React or Next.js for the frontend.
- Express/NestJS for backend APIs.
- PostgreSQL or MySQL for the database.
- Prisma or Sequelize for ORM.
- Maps/GPS provider for tracking.
- OpenAI or Dialogflow for a richer chatbot.

