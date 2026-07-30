# Chatbot Flows

## Emergency Booking

User examples:

- "Book me an ambulance now"
- "Need ambulance urgently"
- "Emergency pickup from Gomti Nagar"

Bot behavior:

1. Detect emergency booking intent.
2. Ask for patient name, phone number, pickup location, and destination.
3. Confirm details.
4. Call `POST /api/bookings`.
5. Return booking ID and status.

## Hospital Information

User examples:

- "Nearest hospital"
- "Hospital near Lucknow"
- "Show emergency hospitals"

Bot behavior:

1. Detect hospital information intent.
2. Ask for city or location if missing.
3. Call `GET /api/hospitals`.
4. Return hospital name, address, phone, and emergency status.

## Support Request

User examples:

- "I need help"
- "Contact support"
- "Booking issue"

Bot behavior:

1. Detect support intent.
2. Ask for issue category.
3. Offer helpline or escalation.
4. Log support request for admin review.

## Partner Onboarding

User examples:

- "I want to register my hospital"
- "Add my ambulance fleet"
- "Partner onboarding"

Bot behavior:

1. Detect partner onboarding intent.
2. Identify partner type: hospital or fleet owner.
3. Collect contact information.
4. Route to hospital or fleet onboarding API.

## Analytics Query

User examples:

- "How many trips today?"
- "Show fleet utilization"
- "Booking count this week"

Bot behavior:

1. Verify user role and access.
2. Identify metric requested.
3. Query analytics API.
4. Return short summary and dashboard link.
