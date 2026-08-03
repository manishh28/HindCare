# Chatbot Flows

> These flows are now implemented as a stateful conversation in `chatbot/chatbot.js` and `backend/server.js`, keyed by the `sessionId` sent with each `POST /api/chatbot/message` call. Earlier versions of this doc described the intended flow before the bot could actually carry state across turns — it can now.

## Emergency Booking

User examples:

- "Book me an ambulance now"
- "Need ambulance urgently"
- "Emergency pickup from Gomti Nagar"

Bot behavior:

1. Detect emergency booking intent.
2. Ask for patient name, then phone number, then pickup location, then destination hospital — one field per turn.
3. Once all four are collected, call the same booking logic as `POST /api/bookings` (including nearest-ambulance dispatch).
4. Return the booking ID, status, and assigned ambulance (if any) in the reply.
5. If the booking can't be created (e.g. invalid phone number), explain why and restart collection instead of leaving the conversation stuck.

## Hospital Information

User examples:

- "Nearest hospital"
- "Hospital near Lucknow"
- "Show emergency hospitals"

Bot behavior:

1. Detect hospital information intent.
2. Ask for a city or area on the next turn.
3. Match against hospital city and name, and return matches in the `hospitals` field of the response.
4. If nothing matches the demo data, say so rather than returning an empty list silently.

## Support Request

User examples:

- "I need help"
- "Contact support"
- "Booking issue"

Bot behavior:

1. Detect support intent.
2. Reply with guidance to describe the issue for admin review.
3. Every chatbot message (including this one) is logged in `chatbotLogs` with its session id, which is what an admin review screen would read from.

## Partner Onboarding

User examples:

- "I want to register my hospital"
- "Add my ambulance fleet"
- "Partner onboarding"

Bot behavior:

1. Detect partner onboarding intent.
2. Ask whether the partner is a hospital or a fleet owner.
3. This is currently a single-turn acknowledgement; routing the answer into `POST /api/hospitals` or `POST /api/ambulances` automatically is a good next-step enhancement, tracked as a follow-up rather than implemented here.

## Analytics Query

User examples:

- "How many trips today?"
- "Show fleet utilization"
- "Booking count this week"

Bot behavior:

1. Detect analytics intent.
2. Point the user at the dashboard rather than answering inline, since there is no analytics aggregation yet — implementing that is Phase 4 work per `docs/project-summary.md`.
