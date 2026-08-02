// Chatbot intent detection plus a small per-session state machine so the bot
// can actually carry out the multi-step flows described in
// docs/chatbot-flows.md (ask for missing details, then act), instead of
// answering every message the same way regardless of what came before.

const BOOKING_FIELDS = [
  { key: "patientName", prompt: "What is the patient's name?" },
  { key: "phone", prompt: "What phone number can we reach you on?" },
  { key: "pickup", prompt: "What is the pickup location?" },
  { key: "destination", prompt: "Which hospital should the ambulance head to?" }
];

const SINGLE_TURN_RESPONSES = {
  support: {
    reply: "I can help with support. Please describe the issue, and an admin can review it.",
    nextAction: "create_support_log"
  },
  partner_onboarding: {
    reply: "I can guide partner onboarding. Are you registering a hospital or an ambulance fleet?",
    nextAction: "collect_partner_type"
  },
  analytics: {
    reply: "Analytics will be available in the admin and fleet dashboard. For now, ask for bookings or ambulance status.",
    nextAction: "open_dashboard"
  },
  unknown: {
    reply: "I can help with ambulance booking, hospital information, support, partner onboarding, or analytics.",
    nextAction: "clarify_intent"
  }
};

function detectIntent(message) {
  const text = String(message || "").toLowerCase();

  if (text.includes("ambulance") || text.includes("emergency") || text.includes("urgent")) {
    return "emergency_booking";
  }

  if (text.includes("hospital") || text.includes("bed") || text.includes("nearest")) {
    return "hospital_info";
  }

  if (text.includes("support") || text.includes("help") || text.includes("issue")) {
    return "support";
  }

  if (text.includes("register") || text.includes("onboard") || text.includes("fleet") || text.includes("partner")) {
    return "partner_onboarding";
  }

  if (text.includes("analytics") || text.includes("trips") || text.includes("report")) {
    return "analytics";
  }

  return "unknown";
}

function emptySession() {
  return { stage: null, draft: {} };
}

/**
 * Advances the conversation by one turn.
 *
 * @param {string} message - the user's latest message
 * @param {{stage: string|null, draft: object}} session - state returned from the previous turn (or {} for a new session)
 * @returns {object} intent, reply, nextAction, the updated session to persist, and
 *   optionally readyBooking (caller should create the booking) or cityQuery (caller should look up hospitals)
 */
function handleMessage(message, session) {
  const text = String(message || "").trim();
  const working = {
    stage: session && session.stage ? session.stage : null,
    draft: session && session.draft ? { ...session.draft } : {}
  };

  if (working.stage === "collecting_booking") {
    const nextEmptyField = BOOKING_FIELDS.find(field => !working.draft[field.key]);
    if (nextEmptyField && text) {
      working.draft[nextEmptyField.key] = text;
    }

    const stillMissing = BOOKING_FIELDS.find(field => !working.draft[field.key]);
    if (stillMissing) {
      return {
        intent: "emergency_booking",
        reply: stillMissing.prompt,
        nextAction: "collect_booking_details",
        session: working
      };
    }

    return {
      intent: "emergency_booking",
      reply: "Got it — creating the booking now.",
      nextAction: "create_booking",
      readyBooking: { ...working.draft },
      session: emptySession()
    };
  }

  if (working.stage === "collecting_hospital_city") {
    return {
      intent: "hospital_info",
      reply: text ? `Here is what I found near ${text}.` : "I didn't catch a city or area — could you share one?",
      nextAction: "show_hospitals",
      cityQuery: text || null,
      session: emptySession()
    };
  }

  const intent = detectIntent(text);

  if (intent === "emergency_booking") {
    const draft = {};
    return {
      intent,
      reply: `I can help book an ambulance. ${BOOKING_FIELDS[0].prompt}`,
      nextAction: "collect_booking_details",
      session: { stage: "collecting_booking", draft }
    };
  }

  if (intent === "hospital_info") {
    return {
      intent,
      reply: "I can show hospital information. Which city or area should I search?",
      nextAction: "show_hospitals",
      session: { stage: "collecting_hospital_city", draft: {} }
    };
  }

  return {
    intent,
    ...SINGLE_TURN_RESPONSES[intent],
    session: emptySession()
  };
}

module.exports = {
  detectIntent,
  handleMessage,
  emptySession,
  BOOKING_FIELDS
};
