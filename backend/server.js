const http = require("http");
const fs = require("fs");
const path = require("path");
const { handleMessage, emptySession } = require("../chatbot/chatbot");
const { handleAuthRoutes } = require("./auth/routes");
const { handleProfileRoutes } = require("./profile/routes");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");

// "*" keeps the zero-config local demo working. Set ALLOWED_ORIGINS to a
// comma-separated list of real origins before deploying anywhere shared.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

const EMERGENCY_TYPES = ["general", "cardiac", "trauma", "icu"];
const AMBULANCE_TYPES = ["basic", "advanced", "icu", "neonatal"];
const AMBULANCE_STATUSES = ["available", "busy", "maintenance", "offline"];
const HOSPITAL_STATUSES = ["pending", "approved", "rejected"];
const BOOKING_STATUSES = ["requested", "assigned", "on_route", "completed", "cancelled"];
const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{6,17}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Booking status can only move forward (or be cancelled) — this is what
// keeps a booking from being marked "completed" before an ambulance is even
// assigned, and it is also what lets a completed/cancelled booking release
// its ambulance back to the available pool.
const BOOKING_TRANSITIONS = {
  requested: ["assigned", "cancelled"],
  assigned: ["on_route", "cancelled"],
  on_route: ["completed", "cancelled"],
  completed: [],
  cancelled: []
};

// Small fixed lookup so the dispatch logic has real coordinates to work
// with, without calling an external geocoding service. Order matters —
// more specific areas are matched before the city-wide fallback.
const KNOWN_AREAS = [
  { keywords: ["gomti nagar"], lat: 26.8500, lng: 80.9500 },
  { keywords: ["sgpgi"], lat: 26.8467, lng: 80.9462 },
  { keywords: ["mall road"], lat: 26.4499, lng: 80.3319 },
  { keywords: ["kanpur"], lat: 26.4499, lng: 80.3319 },
  { keywords: ["lucknow"], lat: 26.8467, lng: 80.9462 }
];

const db = {
  hospitals: [
    {
      id: 1,
      name: "HindCare Emergency Hospital",
      city: "Lucknow",
      address: "SGPGI Road, Lucknow",
      phone: "+91-9000000001",
      email: "contact@hindcare-hospital.example",
      emergencyAvailable: true,
      totalBeds: 120,
      availableBeds: 28,
      status: "approved"
    },
    {
      id: 2,
      name: "MedTech City Hospital",
      city: "Lucknow",
      address: "Gomti Nagar, Lucknow",
      phone: "+91-9000000002",
      email: "contact@medtechcity.example",
      emergencyAvailable: true,
      totalBeds: 80,
      availableBeds: 12,
      status: "approved"
    }
  ],
  ambulances: [
    {
      id: 1,
      registrationNumber: "UP32 AB 1001",
      type: "advanced",
      driverName: "Rahul Singh",
      phone: "+91-9111111111",
      email: "rahul.singh@fleet.example",
      currentLat: 26.8467,
      currentLng: 80.9462,
      status: "available"
    },
    {
      id: 2,
      registrationNumber: "UP32 AB 1002",
      type: "basic",
      driverName: "Amit Verma",
      phone: "+91-9222222222",
      email: "amit.verma@fleet.example",
      currentLat: 26.8500,
      currentLng: 80.9500,
      status: "busy"
    }
  ],
  bookings: [],
  chatbotLogs: []
};

// sessionId -> chatbot conversation state (in-memory only, cleared on restart)
const chatSessions = new Map();

function corsHeaders(req) {
  if (ALLOWED_ORIGINS.includes("*")) {
    return { "Access-Control-Allow-Origin": "*" };
  }
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return { "Access-Control-Allow-Origin": origin, "Vary": "Origin" };
  }
  return {};
}

function sendJson(req, res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    ...corsHeaders(req),
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Demo-Role",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
  });
}

function requireFields(body, fields) {
  return fields.filter(field => !String(body[field] || "").trim());
}

function nextId(items) {
  return items.length ? Math.max(...items.map(item => item.id)) + 1 : 1;
}

// Demo-only role check. There is no password, token, or identity behind
// this — it just mirrors the header the frontend's role switcher sends, so
// the prototype can show what role-gated actions will look like. Real
// authentication (see database/schema.sql `users` table) is a later phase.
function requireDemoRole(req, res, allowedRoles) {
  const role = String(req.headers["x-demo-role"] || "").toLowerCase();
  if (!allowedRoles.includes(role)) {
    sendJson(req, res, 403, {
      error: `This demo action needs an X-Demo-Role header set to one of: ${allowedRoles.join(", ")}.`,
      note: "This is a prototype role check for demo purposes, not real authentication."
    });
    return false;
  }
  return true;
}

// Non-blocking version for redacting fields rather than rejecting the
// whole request — e.g. hiding driver/patient contact details from the
// public list views instead of a hard 403.
function hasDemoRole(req, allowedRoles) {
  const role = String(req.headers["x-demo-role"] || "").toLowerCase();
  return allowedRoles.includes(role);
}

function lastDigits(value, n = 10) {
  return String(value || "").replace(/\D/g, "").slice(-n);
}

function geocodePickup(text) {
  const lower = String(text || "").toLowerCase();
  for (const area of KNOWN_AREAS) {
    if (area.keywords.some(keyword => lower.includes(keyword))) {
      return { lat: area.lat, lng: area.lng };
    }
  }
  return null;
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Picks the nearest available ambulance to the pickup location when the
// pickup text matches a known area; otherwise falls back to the first
// available ambulance (old behavior) so bookings never fail just because
// the demo geocoder didn't recognize the address.
function findBestAmbulance(pickupText) {
  const available = db.ambulances.filter(ambulance => ambulance.status === "available");
  if (!available.length) {
    return { ambulance: null, distanceKm: null };
  }

  const pickupPoint = geocodePickup(pickupText);
  if (!pickupPoint) {
    return { ambulance: available[0], distanceKm: null };
  }

  let best = null;
  let bestDistance = Infinity;
  for (const ambulance of available) {
    if (typeof ambulance.currentLat !== "number" || typeof ambulance.currentLng !== "number") {
      continue;
    }
    const distance = haversineKm(pickupPoint, { lat: ambulance.currentLat, lng: ambulance.currentLng });
    if (distance < bestDistance) {
      bestDistance = distance;
      best = ambulance;
    }
  }

  if (!best) {
    return { ambulance: available[0], distanceKm: null };
  }
  return { ambulance: best, distanceKm: Math.round(bestDistance * 10) / 10 };
}

// Shared by POST /api/bookings and the chatbot booking flow so both paths
// validate, geo-match, and link a hospital the same way.
function createBooking(body) {
  const missing = requireFields(body, ["patientName", "phone", "pickup"]);
  if (!String(body.destination || "").trim() && !body.hospitalId) {
    missing.push("destination");
  }
  if (missing.length) {
    return { statusCode: 400, error: "Missing required fields", fields: missing };
  }

  if (!PHONE_PATTERN.test(String(body.phone).trim())) {
    return { statusCode: 400, error: "phone must be a valid phone number (digits, spaces, -, or leading +)" };
  }

  const emergencyType = body.emergencyType || "general";
  if (!EMERGENCY_TYPES.includes(emergencyType)) {
    return { statusCode: 400, error: `emergencyType must be one of: ${EMERGENCY_TYPES.join(", ")}` };
  }

  let hospital = null;
  if (body.hospitalId) {
    hospital = db.hospitals.find(item => item.id === Number(body.hospitalId));
    if (!hospital) {
      return { statusCode: 400, error: "hospitalId does not match a known hospital" };
    }
  }

  const { ambulance, distanceKm } = findBestAmbulance(body.pickup);

  const booking = {
    id: nextId(db.bookings),
    patientName: String(body.patientName).trim(),
    phone: String(body.phone).trim(),
    pickup: String(body.pickup).trim(),
    destination: hospital ? hospital.name : String(body.destination).trim(),
    hospitalId: hospital ? hospital.id : null,
    emergencyType,
    ambulanceId: ambulance ? ambulance.id : null,
    dispatchDistanceKm: distanceKm,
    status: ambulance ? "assigned" : "requested",
    notes: body.notes ? String(body.notes).trim() : "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (ambulance) {
    ambulance.status = "busy";
  }

  db.bookings.push(booking);
  return { statusCode: 201, booking };
}

function serveStatic(req, res) {
  const requestPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const relativePath = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const filePath = path.normalize(path.join(FRONTEND_DIR, relativePath));

  if (!filePath.startsWith(FRONTEND_DIR)) {
    sendJson(req, res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      fs.readFile(path.join(FRONTEND_DIR, "index.html"), (indexError, indexContent) => {
        if (indexError) {
          sendJson(req, res, 404, { error: "Not found" });
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(indexContent);
      });
      return;
    }

    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".woff2": "font/woff2"
    };

    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(content);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...corsHeaders(req),
      "Access-Control-Allow-Headers": "Content-Type, X-Demo-Role",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS"
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(req, res, 200, { status: "ok", service: "hindcare-aggregator", auth: "enabled" });
    return;
  }

  // ---- Authentication & Profile (production auth module) ----
  if (await handleAuthRoutes(req, res, url, parseBody, sendJson)) return;
  if (await handleProfileRoutes(req, res, url, parseBody, sendJson)) return;

  // ---- Hospitals ----------------------------------------------------

  if (req.method === "GET" && url.pathname === "/api/hospitals") {
    const city = url.searchParams.get("city");
    const hospitals = city
      ? db.hospitals.filter(hospital => hospital.city.toLowerCase() === city.toLowerCase())
      : db.hospitals;
    sendJson(req, res, 200, hospitals);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/hospitals") {
    const body = await parseBody(req);
    const missing = requireFields(body, ["name", "city", "address", "phone", "email"]);
    if (missing.length) {
      sendJson(req, res, 400, { error: "Missing required fields", fields: missing });
      return;
    }
    if (!PHONE_PATTERN.test(String(body.phone).trim())) {
      sendJson(req, res, 400, { error: "phone must be a valid phone number" });
      return;
    }
    if (!EMAIL_PATTERN.test(String(body.email).trim())) {
      sendJson(req, res, 400, { error: "email must be a valid email address" });
      return;
    }

    const hospital = {
      id: nextId(db.hospitals),
      name: String(body.name).trim(),
      city: String(body.city).trim(),
      address: String(body.address).trim(),
      phone: String(body.phone).trim(),
      email: String(body.email).trim().toLowerCase(),
      emergencyAvailable: Boolean(body.emergencyAvailable ?? true),
      totalBeds: Number(body.totalBeds || 0),
      availableBeds: Number(body.availableBeds || 0),
      status: "pending"
    };
    db.hospitals.push(hospital);
    sendJson(req, res, 201, hospital);
    return;
  }

  const hospitalMatch = url.pathname.match(/^\/api\/hospitals\/(\d+)$/);
  if (req.method === "PATCH" && hospitalMatch) {
    if (!requireDemoRole(req, res, ["admin"])) return;

    const hospital = db.hospitals.find(item => item.id === Number(hospitalMatch[1]));
    if (!hospital) {
      sendJson(req, res, 404, { error: "Hospital not found" });
      return;
    }

    const body = await parseBody(req);
    if (!HOSPITAL_STATUSES.includes(body.status)) {
      sendJson(req, res, 400, { error: `status must be one of: ${HOSPITAL_STATUSES.join(", ")}` });
      return;
    }

    hospital.status = body.status;
    sendJson(req, res, 200, hospital);
    return;
  }

  // ---- Ambulances -----------------------------------------------------

  if (req.method === "GET" && url.pathname === "/api/ambulances") {
    const canSeeDriverInfo = hasDemoRole(req, ["fleet", "admin"]);
    const ambulances = canSeeDriverInfo
      ? db.ambulances
      : db.ambulances.map(({ driverName, phone, email, ...rest }) => rest);
    sendJson(req, res, 200, ambulances);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ambulances") {
    const body = await parseBody(req);
    const missing = requireFields(body, ["registrationNumber", "type", "driverName", "phone", "email"]);
    if (missing.length) {
      sendJson(req, res, 400, { error: "Missing required fields", fields: missing });
      return;
    }
    if (!AMBULANCE_TYPES.includes(body.type)) {
      sendJson(req, res, 400, { error: `type must be one of: ${AMBULANCE_TYPES.join(", ")}` });
      return;
    }
    if (!PHONE_PATTERN.test(String(body.phone).trim())) {
      sendJson(req, res, 400, { error: "phone must be a valid phone number" });
      return;
    }
    if (!EMAIL_PATTERN.test(String(body.email).trim())) {
      sendJson(req, res, 400, { error: "email must be a valid email address" });
      return;
    }

    const ambulance = {
      id: nextId(db.ambulances),
      registrationNumber: String(body.registrationNumber).trim(),
      type: body.type,
      driverName: String(body.driverName).trim(),
      phone: String(body.phone).trim(),
      email: String(body.email).trim().toLowerCase(),
      currentLat: body.currentLat !== undefined ? Number(body.currentLat) : null,
      currentLng: body.currentLng !== undefined ? Number(body.currentLng) : null,
      status: "available"
    };
    db.ambulances.push(ambulance);
    sendJson(req, res, 201, ambulance);
    return;
  }

  const ambulanceMatch = url.pathname.match(/^\/api\/ambulances\/(\d+)$/);
  if (req.method === "PATCH" && ambulanceMatch) {
    if (!requireDemoRole(req, res, ["fleet", "admin"])) return;

    const ambulance = db.ambulances.find(item => item.id === Number(ambulanceMatch[1]));
    if (!ambulance) {
      sendJson(req, res, 404, { error: "Ambulance not found" });
      return;
    }

    const body = await parseBody(req);
    if (!AMBULANCE_STATUSES.includes(body.status)) {
      sendJson(req, res, 400, { error: `status must be one of: ${AMBULANCE_STATUSES.join(", ")}` });
      return;
    }

    ambulance.status = body.status;
    sendJson(req, res, 200, ambulance);
    return;
  }

  // ---- Bookings -------------------------------------------------------

  if (req.method === "GET" && url.pathname === "/api/bookings") {
    const canSeePatientInfo = hasDemoRole(req, ["fleet", "admin", "hospital"]);
    const bookings = canSeePatientInfo
      ? db.bookings
      : db.bookings.map(({ patientName, phone, ...rest }) => rest);
    sendJson(req, res, 200, bookings);
    return;
  }

  // Lets a patient check their own booking without exposing everyone
  // else's — the phone number acts as the credential, so this is safe to
  // leave open even though the general list above is redacted.
  if (req.method === "GET" && url.pathname === "/api/bookings/lookup") {
    const id = Number(url.searchParams.get("id"));
    const phone = url.searchParams.get("phone") || "";
    const booking = db.bookings.find(
      item => item.id === id && lastDigits(item.phone) === lastDigits(phone) && lastDigits(phone).length > 0
    );

    if (!booking) {
      sendJson(req, res, 404, { error: "No booking found for that ID and phone number." });
      return;
    }

    const ambulance = booking.ambulanceId
      ? db.ambulances.find(item => item.id === booking.ambulanceId)
      : null;

    sendJson(req, res, 200, {
      id: booking.id,
      status: booking.status,
      destination: booking.destination,
      dispatchDistanceKm: booking.dispatchDistanceKm,
      ambulance: ambulance
        ? { registrationNumber: ambulance.registrationNumber, driverName: ambulance.driverName }
        : null
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/bookings") {
    const body = await parseBody(req);
    const result = createBooking(body);
    if (result.error) {
      sendJson(req, res, result.statusCode, { error: result.error, fields: result.fields });
      return;
    }
    sendJson(req, res, 201, result.booking);
    return;
  }

  const bookingMatch = url.pathname.match(/^\/api\/bookings\/(\d+)$/);
  if (req.method === "PATCH" && bookingMatch) {
    const booking = db.bookings.find(item => item.id === Number(bookingMatch[1]));
    if (!booking) {
      sendJson(req, res, 404, { error: "Booking not found" });
      return;
    }

    const body = await parseBody(req);
    const nextStatus = body.status;
    if (!BOOKING_STATUSES.includes(nextStatus)) {
      sendJson(req, res, 400, { error: `status must be one of: ${BOOKING_STATUSES.join(", ")}` });
      return;
    }

    const allowedNext = BOOKING_TRANSITIONS[booking.status] || [];
    if (!allowedNext.includes(nextStatus)) {
      sendJson(req, res, 409, {
        error: `Cannot move a booking from "${booking.status}" to "${nextStatus}".`,
        allowedNext
      });
      return;
    }

    booking.status = nextStatus;
    booking.updatedAt = new Date().toISOString();

    // Freeing the ambulance on completion/cancellation is what keeps the
    // fleet from getting permanently stuck at "busy" in the demo.
    if ((nextStatus === "completed" || nextStatus === "cancelled") && booking.ambulanceId) {
      const ambulance = db.ambulances.find(item => item.id === booking.ambulanceId);
      if (ambulance && ambulance.status === "busy") {
        ambulance.status = "available";
      }
    }

    sendJson(req, res, 200, booking);
    return;
  }

  // ---- Chatbot ----------------------------------------------------------

  if (req.method === "POST" && url.pathname === "/api/chatbot/message") {
    const body = await parseBody(req);
    const sessionId = String(body.sessionId || "anonymous");
    const priorSession = chatSessions.get(sessionId) || emptySession();

    const result = handleMessage(body.message, priorSession);
    chatSessions.set(sessionId, result.session || emptySession());

    let booking = null;
    if (result.nextAction === "create_booking" && result.readyBooking) {
      const outcome = createBooking(result.readyBooking);
      if (outcome.booking) {
        booking = outcome.booking;
        const ambulance = booking.ambulanceId
          ? db.ambulances.find(item => item.id === booking.ambulanceId)
          : null;
        result.reply = `${result.reply} Booking #${booking.id} created (status: ${booking.status}).` +
          (ambulance
            ? ` ${ambulance.registrationNumber} has been dispatched.`
            : " No ambulance is free right now — you're first in line for the next one.");
      } else {
        // Validation failed (e.g. bad phone number) — restart the booking
        // collection instead of leaving the user stuck.
        chatSessions.set(sessionId, emptySession());
        result.reply = `I couldn't create that booking (${outcome.error}). Let's start over — what is the patient's name?`;
        result.nextAction = "collect_booking_details";
        chatSessions.set(sessionId, { stage: "collecting_booking", draft: {} });
      }
    }

    let hospitals = null;
    if (result.nextAction === "show_hospitals" && result.cityQuery) {
      hospitals = db.hospitals.filter(hospital =>
        hospital.city.toLowerCase().includes(result.cityQuery.toLowerCase()) ||
        hospital.name.toLowerCase().includes(result.cityQuery.toLowerCase())
      );
      result.reply = hospitals.length
        ? `${result.reply} ${hospitals.map(h => h.name).join(", ")}.`
        : `${result.reply} I don't have any hospitals matching "${result.cityQuery}" in the demo data yet.`;
    }

    db.chatbotLogs.push({
      id: nextId(db.chatbotLogs),
      sessionId,
      message: body.message || "",
      intent: result.intent,
      reply: result.reply,
      createdAt: new Date().toISOString()
    });

    sendJson(req, res, 200, {
      intent: result.intent,
      reply: result.reply,
      nextAction: result.nextAction,
      booking,
      hospitals
    });
    return;
  }

  sendJson(req, res, 404, { error: "API route not found" });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch(error => {
      sendJson(req, res, 400, { error: error.message });
    });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`HindCare demo running at http://${HOST}:${PORT}`);
});
