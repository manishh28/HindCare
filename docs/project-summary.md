# Project Summary

## Goal

Build a unified healthcare platform that connects patients, hospitals, and ambulance fleet owners during emergency and non-emergency care workflows.

## User Roles

### Patients And Families

- Book an ambulance quickly.
- Share pickup and destination details.
- View nearby hospitals.
- Track booking status.
- Store emergency contacts and medical history.

### Hospitals And Partners

- Onboard hospital profile and contact details.
- Manage facility data such as beds, emergency availability, pharmacy, and diagnostics.
- Use future HMS modules for patient and operational workflows.

### Ambulance Fleet Owners

- Register ambulances and drivers.
- Track vehicle status.
- View trips, utilization, and fuel analytics.
- Manage route and service reports.

### Admin

- Approve hospitals and fleet owners.
- Manage users, hospitals, ambulances, and bookings.
- Review chatbot logs and support requests.
- Monitor platform analytics.

## Phased Roadmap

### Phase 1 - Setup

- Create repository and folder structure.
- Define database schema.
- Build static UI skeleton for all roles.
- Create mock backend APIs.

### Phase 2 - Core Features

- Ambulance booking.
- Hospital onboarding.
- Fleet vehicle onboarding.
- Booking status tracking.

### Phase 3 - Chatbot

- Add emergency booking flow.
- Add hospital information queries.
- Add support and FAQ responses.
- Connect chatbot actions to backend APIs.

### Phase 4 - Admin And Analytics

- Admin review panels.
- Booking and demand reports.
- Fleet utilization analytics.
- Chatbot log review.

### Phase 5 - Testing And Deployment

- Unit testing for API and chatbot logic.
- API testing for booking and onboarding.
- UI testing for key workflows.
- Cloud deployment.

## Current Starter Scope

This repo currently provides a local proof of concept, laid out as a booking-first homepage rather than an internal-tool-style dashboard:

- Hero booking form (patient name, phone, pickup, emergency type) linked to real hospital records and nearest-ambulance dispatch — the primary call to action on the page, matching the UX pattern of consumer ambulance-booking apps.
- A "Join HindCare" section with separate onboarding forms for hospitals and for ambulance/fleet operators, feeding the same approval workflow the admin role uses.
- Nearby hospital list with an admin approval workflow.
- Fleet status view with status management.
- Booking board with a status lifecycle (requested → assigned → on route → completed/cancelled).
- Chatbot prompt box that carries a conversation across turns for booking and hospital search.
- A demo-only role switcher previewing role-gated actions (not real authentication).
- Mock API with in-memory data.
- SQL schema for future database integration.
