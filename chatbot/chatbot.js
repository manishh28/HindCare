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

function handleMessage(message) {
  const intent = detectIntent(message);

  const responses = {
    emergency_booking: {
      reply: "I can help book an ambulance. Please share patient name, phone number, pickup location, and destination hospital.",
      nextAction: "collect_booking_details"
    },
    hospital_info: {
      reply: "I can show hospital information. Please share your city or area so I can find nearby emergency hospitals.",
      nextAction: "show_hospitals"
    },
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

  return {
    intent,
    ...responses[intent]
  };
}

module.exports = {
  detectIntent,
  handleMessage
};
