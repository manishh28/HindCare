# API Docs

Base URL for local development:

```text
http://127.0.0.1:4173
```

## Health

### `GET /api/health`

Returns server status.

Example response:

```json
{
  "status": "ok",
  "service": "hindcare-aggregator"
}
```

## Hospitals

### `GET /api/hospitals`

Returns all hospitals.

### `POST /api/hospitals`

Creates a hospital onboarding request.

Required JSON fields:

- `name`
- `city`
- `address`
- `phone`

## Ambulances

### `GET /api/ambulances`

Returns registered ambulances.

### `POST /api/ambulances`

Creates a fleet vehicle entry.

Required JSON fields:

- `registrationNumber`
- `type`
- `driverName`
- `phone`

## Bookings

### `GET /api/bookings`

Returns current bookings.

### `GET /api/bookings/:id`

Returns one booking by ID. This is used by the Phase 2 booking status workflow.

Example response:

```json
{
  "id": 1,
  "patientName": "Manish Kumar",
  "phone": "+91-9876543210",
  "pickup": "Gomti Nagar, Lucknow",
  "destination": "HindCare Emergency Hospital",
  "emergencyType": "general",
  "ambulanceId": 1,
  "status": "assigned",
  "notes": "",
  "createdAt": "2026-07-31T06:30:00.000Z"
}
```

### `POST /api/bookings`

Creates an ambulance booking.

Required JSON fields:

- `patientName`
- `phone`

Optional JSON fields:

- `pickup`
- `destination`
- `emergencyType`
- `notes`

## Chatbot

### `POST /api/chatbot/message`

Handles a simple chatbot message.

Required JSON fields:

- `message`

Example request:

```json
{
  "message": "Book me an ambulance now"
}
```

Example response:

```json
{
  "intent": "emergency_booking",
  "reply": "I can help book an ambulance. Please share patient name, phone number, pickup location, and destination hospital.",
  "nextAction": "collect_booking_details"
}
```
