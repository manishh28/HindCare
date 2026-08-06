const http = require("http");
const fs = require("fs");
const path = require("path");
const { handleMessage, emptySession } = require("../chatbot/chatbot");
const { handleAuthRoutes } = require("./auth/routes");
const { handleProfileRoutes } = require("./profile/routes");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");

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

const BOOKING_TRANSITIONS = {
  requested: ["assigned", "cancelled"],
  assigned: ["on_route", "cancelled"],
  on_route: ["completed", "cancelled"],
  completed: [],
  cancelled: []
};

const KNOWN_AREAS = [
  { keywords: ["gomti nagar"], lat: 26.8500, lng: 80.9500 },
  { keywords: ["sgpgi"], lat: 26.8467, lng: 80.9462 },
  { keywords: ["mall road"], lat: 26.4499, lng: 80.3319 },
  { keywords: ["kanpur"], lat: 26.4499, lng: 80.3319 },
  { keywords: ["lucknow"], lat: 26.8467, lng: 80.9462 }
];

const db = {
  hospitals: [
    { id: 1, name: "HindCare Emergency Hospital", city: "Lucknow", address: "SGPGI Road, Lucknow", phone: "+91-9000000001", email: "contact@hindcare-hospital.example", emergencyAvailable: true, totalBeds: 120, availableBeds: 28, status: "approved" },
    { id: 2, name: "MedTech City Hospital", city: "Lucknow", address: "Gomti Nagar, Lucknow", phone: "+91-9000000002", email: "contact@medtechcity.example", emergencyAvailable: true, totalBeds: 80, availableBeds: 12, status: "approved" }
  ],
  ambulances: [
    { id: 1, registrationNumber: "UP32 AB 1001", type: "advanced", driverName: "Rahul Singh", phone: "+91-9111111111", email: "rahul.singh@fleet.example", currentLat: 26.8467, currentLng: 80.9462, status: "available" },
    { id: 2, registrationNumber: "UP32 AB 1002", type: "basic", driverName: "Amit Verma", phone: "+91-9222222222", email: "amit.verma@fleet.example", currentLat: 26.8500, currentLng: 80.9500, status: "busy" }
  ],
  bookings: [],
  chatbotLogs: []
};

const chatSessions = new Map();

// ---------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------

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

function sendJson(req, res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    ...corsHeaders(req),
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Demo-Role"
  });
  res.end(body);
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
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function findBestAmbulance(pickupText) {
  const available = db.ambulances.filter(a => a.status === "available");
  if (!available.length) return { ambulance: null, distanceKm: null };

  const pickupPoint = geocodePickup(pickupText);
  if (!pickupPoint) return { ambulance: available[0], distanceKm: null };

  let best = null, bestDistance = Infinity;
  for (const a of available) {
    if (typeof a.currentLat !== "number" || typeof a.currentLng !== "number") continue;
    const dist = haversineKm(pickupPoint, { lat: a.currentLat, lng: a.currentLng });
    if (dist < bestDistance) { bestDistance = dist; best = a; }
  }
  return best ? { ambulance: best, distanceKm: Math.round(bestDistance * 10) / 10 } : { ambulance: available[0], distanceKm: null };
}

function createBooking(body) {
  const missing = requireFields(body, ["patientName", "phone", "pickup"]);
  if (!String(body.destination || "").trim() && !body.hospitalId) missing.push("destination");
  if (missing.length) return { statusCode: 400, error: "Missing required fields", fields: missing };

  if (!PHONE_PATTERN.test(String(body.phone).trim())) {
    return { statusCode: 400, error: "phone must be a valid phone number" };
  }
  const emergencyType = body.emergencyType || "general";
  if (!EMERGENCY_TYPES.includes(emergencyType)) {
    return { statusCode: 400, error: `emergencyType must be one of: ${EMERGENCY_TYPES.join(", ")}` };
  }

  let hospital = null;
  if (body.hospitalId) {
    hospital = db.hospitals.find(h => h.id === Number(body.hospitalId));
    if (!hospital) return { statusCode: 400, error: "hospitalId does not match a known hospital" };
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

  if (ambulance) ambulance.status = "busy";
  db.bookings.push(booking);
  return { statusCode: 201, booking };
}

// ---------------------------------------------------------------------
// Static file server with SPA fallback (so /profile/ serves index.html)
// ---------------------------------------------------------------------
function serveStatic(req, res) {
  const requestPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const relativePath = requestPath === "/" ? "index.html" : requestPath.slice(1).replace(/\/$/, "");

  // /auth/ and /auth both resolve to auth/index.html
  const candidates = [];
  if (relativePath === "index.html" || relativePath === "") {
    candidates.push(path.join(FRONTEND_DIR, "index.html"));
  } else {
    candidates.push(path.join(FRONTEND_DIR, relativePath));
    if (!path.extname(relativePath)) {
      candidates.push(path.join(FRONTEND_DIR, relativePath, "index.html"));
    }
  }

  // Only /auth is a true sub-app with its own index.html.
  // /profile has no dedicated index.html and must keep falling back to the main SPA shell.
  const isSubApp = /^auth(\/|$)/.test(relativePath);

  function tryCandidate(index) {
    if (index >= candidates.length) {
      if (isSubApp) {
        sendJson(req, res, 404, { error: "Not found" });
        return;
      }
      // Fallback to index.html for SPA routing (e.g., /profile/)
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

    const filePath = path.normalize(candidates[index]);
    // Security: prevent escaping FRONTEND_DIR
    if (!filePath.startsWith(FRONTEND_DIR)) {
      sendJson(req, res, 403, { error: "Forbidden" });
      return;
    }

    fs.stat(filePath, (statErr, stat) => {
      if (!statErr && stat.isDirectory()) {
        const indexPath = path.normalize(path.join(filePath, "index.html"));
        if (!indexPath.startsWith(FRONTEND_DIR)) {
          sendJson(req, res, 403, { error: "Forbidden" });
          return;
        }
        fs.readFile(indexPath, (error, content) => {
          if (error) {
            tryCandidate(index + 1);
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(content);
        });
        return;
      }

      fs.readFile(filePath, (error, content) => {
        if (error) {
          tryCandidate(index + 1);
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
    });
  }

  tryCandidate(0);
}

// ---------------------------------------------------------------------
// API dispatcher
// ---------------------------------------------------------------------
async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...corsHeaders(req),
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Demo-Role",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS"
    });
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(req, res, 200, { status: "ok", service: "hindcare-aggregator", auth: "enabled" });
    return;
  }

  // ----------- Production auth & profile modules -----------
  if (await handleAuthRoutes(req, res, url, parseBody, sendJson)) return;
  if (await handleProfileRoutes(req, res, url, parseBody, sendJson)) return;

  // ----------- Hospitals -----------
  if (req.method === "GET" && url.pathname === "/api/hospitals") {
    const city = url.searchParams.get("city");
    const hospitals = city
      ? db.hospitals.filter(h => h.city.toLowerCase() === city.toLowerCase())
      : db.hospitals;
    sendJson(req, res, 200, hospitals);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/hospitals") {
    const body = await parseBody(req);
    const missing = requireFields(body, ["name", "city", "address", "phone", "email"]);
    if (missing.length) { sendJson(req, res, 400, { error: "Missing required fields", fields: missing }); return; }
    if (!PHONE_PATTERN.test(String(body.phone).trim())) { sendJson(req, res, 400, { error: "phone must be a valid phone number" }); return; }
    if (!EMAIL_PATTERN.test(String(body.email).trim())) { sendJson(req, res, 400, { error: "email must be a valid email address" }); return; }
    const hospital = {
      id: nextId(db.hospitals),
      name: String(body.name).trim(), city: String(body.city).trim(), address: String(body.address).trim(),
      phone: String(body.phone).trim(), email: String(body.email).trim().toLowerCase(),
      emergencyAvailable: Boolean(body.emergencyAvailable ?? true), totalBeds: Number(body.totalBeds || 0),
      availableBeds: Number(body.availableBeds || 0), status: "pending"
    };
    db.hospitals.push(hospital);
    sendJson(req, res, 201, hospital);
    return;
  }
  const hospitalMatch = url.pathname.match(/^\/api\/hospitals\/(\d+)$/);
  if (req.method === "PATCH" && hospitalMatch) {
    if (!requireDemoRole(req, res, ["admin"])) return;
    const hospital = db.hospitals.find(h => h.id === Number(hospitalMatch[1]));
    if (!hospital) { sendJson(req, res, 404, { error: "Hospital not found" }); return; }
    const body = await parseBody(req);
    if (!HOSPITAL_STATUSES.includes(body.status)) { sendJson(req, res, 400, { error: `status must be one of: ${HOSPITAL_STATUSES.join(", ")}` }); return; }
    hospital.status = body.status;
    sendJson(req, res, 200, hospital);
    return;
  }

  // ----------- Ambulances -----------
  if (req.method === "GET" && url.pathname === "/api/ambulances") {
    const canSee = hasDemoRole(req, ["fleet", "admin"]);
    const ambulances = canSee ? db.ambulances : db.ambulances.map(({ driverName, phone, email, ...rest }) => rest);
    sendJson(req, res, 200, ambulances);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/ambulances") {
    const body = await parseBody(req);
    const missing = requireFields(body, ["registrationNumber", "type", "driverName", "phone", "email"]);
    if (missing.length) { sendJson(req, res, 400, { error: "Missing required fields", fields: missing }); return; }
    if (!AMBULANCE_TYPES.includes(body.type)) { sendJson(req, res, 400, { error: `type must be one of: ${AMBULANCE_TYPES.join(", ")}` }); return; }
    if (!PHONE_PATTERN.test(String(body.phone).trim())) { sendJson(req, res, 400, { error: "phone must be a valid phone number" }); return; }
    if (!EMAIL_PATTERN.test(String(body.email).trim())) { sendJson(req, res, 400, { error: "email must be a valid email address" }); return; }
    const ambulance = {
      id: nextId(db.ambulances), registrationNumber: String(body.registrationNumber).trim(), type: body.type,
      driverName: String(body.driverName).trim(), phone: String(body.phone).trim(), email: String(body.email).trim().toLowerCase(),
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
    const ambulance = db.ambulances.find(a => a.id === Number(ambulanceMatch[1]));
    if (!ambulance) { sendJson(req, res, 404, { error: "Ambulance not found" }); return; }
    const body = await parseBody(req);
    if (!AMBULANCE_STATUSES.includes(body.status)) { sendJson(req, res, 400, { error: `status must be one of: ${AMBULANCE_STATUSES.join(", ")}` }); return; }
    ambulance.status = body.status;
    sendJson(req, res, 200, ambulance);
    return;
  }

  // ----------- Bookings -----------
  if (req.method === "GET" && url.pathname === "/api/bookings") {
    const canSee = hasDemoRole(req, ["fleet", "admin", "hospital"]);
    const bookings = canSee ? db.bookings : db.bookings.map(({ patientName, phone, ...rest }) => rest);
    sendJson(req, res, 200, bookings);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/bookings/lookup") {
    const id = Number(url.searchParams.get("id"));
    const phone = url.searchParams.get("phone") || "";
    const booking = db.bookings.find(b => b.id === id && lastDigits(b.phone) === lastDigits(phone) && lastDigits(phone).length > 0);
    if (!booking) { sendJson(req, res, 404, { error: "No booking found for that ID and phone number." }); return; }
    const amb = booking.ambulanceId ? db.ambulances.find(a => a.id === booking.ambulanceId) : null;
    sendJson(req, res, 200, {
      id: booking.id, status: booking.status, destination: booking.destination,
      dispatchDistanceKm: booking.dispatchDistanceKm,
      ambulance: amb ? { registrationNumber: amb.registrationNumber, driverName: amb.driverName } : null
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/bookings") {
    const body = await parseBody(req);
    const result = createBooking(body);
    if (result.error) { sendJson(req, res, result.statusCode, { error: result.error, fields: result.fields }); return; }
    sendJson(req, res, 201, result.booking);
    return;
  }
  const bookingMatch = url.pathname.match(/^\/api\/bookings\/(\d+)$/);
  if (req.method === "PATCH" && bookingMatch) {
    const booking = db.bookings.find(b => b.id === Number(bookingMatch[1]));
    if (!booking) { sendJson(req, res, 404, { error: "Booking not found" }); return; }
    const body = await parseBody(req);
    const nextStatus = body.status;
    if (!BOOKING_STATUSES.includes(nextStatus)) { sendJson(req, res, 400, { error: `status must be one of: ${BOOKING_STATUSES.join(", ")}` }); return; }
    if (!BOOKING_TRANSITIONS[booking.status].includes(nextStatus)) {
      sendJson(req, res, 409, { error: `Cannot move a booking from "${booking.status}" to "${nextStatus}".`, allowedNext: BOOKING_TRANSITIONS[booking.status] });
      return;
    }
    booking.status = nextStatus;
    booking.updatedAt = new Date().toISOString();
    if ((nextStatus === "completed" || nextStatus === "cancelled") && booking.ambulanceId) {
      const ambulance = db.ambulances.find(a => a.id === booking.ambulanceId);
      if (ambulance && ambulance.status === "busy") ambulance.status = "available";
    }
    sendJson(req, res, 200, booking);
    return;
  }

  // ----------- Chatbot -----------
  if (req.method === "POST" && url.pathname === "/api/chatbot/message") {
    const body = await parseBody(req);
    const sessionId = String(body.sessionId || "anonymous");
    const prior = chatSessions.get(sessionId) || emptySession();
    const result = handleMessage(body.message, prior);
    chatSessions.set(sessionId, result.session || emptySession());

    let booking = null;
    if (result.nextAction === "create_booking" && result.readyBooking) {
      const outcome = createBooking(result.readyBooking);
      if (outcome.booking) {
        booking = outcome.booking;
        const amb = booking.ambulanceId ? db.ambulances.find(a => a.id === booking.ambulanceId) : null;
        result.reply = `${result.reply} Booking #${booking.id} created (status: ${booking.status}).` +
          (amb ? ` ${amb.registrationNumber} has been dispatched.` : " No ambulance is free right now — you're first in line for the next one.");
      } else {
        chatSessions.set(sessionId, emptySession());
        result.reply = `I couldn't create that booking (${outcome.error}). Let's start over — what is the patient's name?`;
        result.nextAction = "collect_booking_details";
        chatSessions.set(sessionId, { stage: "collecting_booking", draft: {} });
      }
    }

    let hospitals = null;
    if (result.nextAction === "show_hospitals" && result.cityQuery) {
      hospitals = db.hospitals.filter(h => h.city.toLowerCase().includes(result.cityQuery.toLowerCase()) || h.name.toLowerCase().includes(result.cityQuery.toLowerCase()));
      result.reply = hospitals.length ? `${result.reply} ${hospitals.map(h => h.name).join(", ")}.` : `${result.reply} I don't have any hospitals matching "${result.cityQuery}" in the demo data yet.`;
    }

    db.chatbotLogs.push({
      id: nextId(db.chatbotLogs), sessionId, message: body.message || "",
      intent: result.intent, reply: result.reply, createdAt: new Date().toISOString()
    });
    sendJson(req, res, 200, { intent: result.intent, reply: result.reply, nextAction: result.nextAction, booking, hospitals });
    return;
  }

  // If nothing matched
  sendJson(req, res, 404, { error: "API route not found" });
}

// ---------------------------------------------------------------------
// Create server
// ---------------------------------------------------------------------
const server = http.createServer((req, res) => {
  // API requests
  if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch(error => {
      sendJson(req, res, 400, { error: error.message });
    });
    return;
  }

  // All other requests → static files (with SPA fallback)
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`HindCare demo running at http://${HOST}:${PORT}`);
});
