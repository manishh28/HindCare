const fs = require("fs");
const path = require("path");

// Minimal .env loader (kept dependency-free, matching the rest of this
// project). Reads KEY=VALUE lines from a .env file in the project root, if
// one exists, without overwriting any variable already set in the real
// environment (so `set JWT_SECRET=... && node server.js` style overrides
// still win). Must run before anything below is required, since crypto.js
// reads process.env.JWT_SECRET the moment it's loaded.
//
// Handles UTF-8, UTF-8-with-BOM, and UTF-16 (LE/BE, with or without BOM) —
// PowerShell's `>` / `Out-File` redirection defaults to UTF-16 on Windows,
// which would otherwise silently produce an unparseable file.
(function loadEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;

  const buf = fs.readFileSync(envPath);
  let text;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    text = buf.slice(2).toString("utf16le");
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    text = buf.slice(2).swap16().toString("utf16le"); // UTF-16BE -> swap to LE
  } else if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    text = buf.slice(3).toString("utf8");
  } else {
    // No BOM. If it looks like UTF-16 anyway (lots of null bytes — common
    // with PowerShell's default redirect encoding), decode as utf16le.
    const nullRatio = buf.slice(0, 200).filter(b => b === 0).length / Math.min(buf.length, 200);
    text = nullRatio > 0.3 ? buf.toString("utf16le") : buf.toString("utf8");
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
})();

const http = require("http");
const { handleMessage, emptySession } = require("../chatbot/chatbot");
const { handleAuthRoutes } = require("./auth/routes");
const { handleProfileRoutes } = require("./profile/routes");
const { authenticate, requireAuth, getRequestMeta } = require("./auth/middleware");
const { ROLE_PERMISSIONS, findUserByEmail, getProfile, seeded } = require("./auth/store");

// Rate limiting for the public write endpoints below (hospital/ambulance
// onboarding, booking creation) — mirrors the same pattern already used in
// backend/auth/routes.js for login/signup/OTP.
const publicWriteRateLimits = new Map();
const PUBLIC_WRITE_WINDOW_MS = 60000;
const PUBLIC_WRITE_MAX = 20;
function checkPublicWriteRateLimit(key) {
  const now = Date.now();
  const entry = publicWriteRateLimits.get(key) || { count: 0, resetAt: now + PUBLIC_WRITE_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + PUBLIC_WRITE_WINDOW_MS;
  }
  entry.count += 1;
  publicWriteRateLimits.set(key, entry);
  return entry.count <= PUBLIC_WRITE_MAX;
}

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
    { id: 1, name: "HindCare Emergency Hospital", city: "Lucknow", address: "SGPGI Road, Lucknow", phone: "+91-9000000001", email: "contact@hindcare-hospital.example", emergencyAvailable: true, totalBeds: 120, availableBeds: 28, status: "approved", ownerId: null, departments: [
      { name: "Emergency", status: "available" },
      { name: "Cardiology", status: "available" },
      { name: "ICU", status: "limited" }
    ] },
    { id: 2, name: "MedTech City Hospital", city: "Lucknow", address: "Gomti Nagar, Lucknow", phone: "+91-9000000002", email: "contact@medtechcity.example", emergencyAvailable: true, totalBeds: 80, availableBeds: 12, status: "approved", ownerId: null, departments: [
      { name: "Emergency", status: "available" },
      { name: "Orthopedics", status: "available" }
    ] }
  ],
  ambulances: [
    { id: 1, registrationNumber: "UP32 AB 1001", type: "advanced", driverName: "Rahul Singh", phone: "+91-9111111111", email: "rahul.singh@fleet.example", currentLat: 26.8467, currentLng: 80.9462, status: "available", ownerId: null, driverId: null },
    { id: 2, registrationNumber: "UP32 AB 1002", type: "basic", driverName: "Amit Verma", phone: "+91-9222222222", email: "amit.verma@fleet.example", currentLat: 26.8500, currentLng: 80.9500, status: "busy", ownerId: null, driverId: null }
  ],
  bookings: [],
  chatbotLogs: []
};

// Link the demo hospital/ambulance records to real seeded owner accounts,
// once those accounts actually exist (seeding is async). Anything created
// from here on gets its ownerId set directly at creation time instead.
seeded.then(() => {
  const hospitalOwner = findUserByEmail("admin@hindcare-hospital.in");
  if (hospitalOwner) {
    db.hospitals[0].ownerId = hospitalOwner.id;
    const profile = getProfile(hospitalOwner);
    if (profile) profile.hospitalId = db.hospitals[0].id;
  }

  const fleetOwner = findUserByEmail("suresh@yadavambulance.in");
  const driver = findUserByEmail("rahul.singh@fleet.hindcare.in");
  if (fleetOwner) {
    db.ambulances[0].ownerId = fleetOwner.id;
    db.ambulances[1].ownerId = fleetOwner.id;
  }
  if (driver) {
    db.ambulances[0].driverId = driver.id;
  }
}).catch(() => {});

const chatSessions = new Map();

// ---------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------

// Applied to every response. The CSP is deliberately strict — same-origin
// only, plus the two Google Fonts hosts this app actually loads. No inline
// scripts/styles are used anywhere, so none are allowed here either.
const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=(), payment=()",
  // Harmless over plain HTTP (browsers ignore it there) — takes effect
  // automatically the moment this runs behind real HTTPS.
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
};

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
    ...SECURITY_HEADERS,
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

// SEC-021: lightweight, dependency-free bot mitigation for public forms —
// a hidden field real users never see or fill, but simple scripted bots
// that blindly fill every input often do. Doesn't replace a real CAPTCHA
// for high-value targets, but meaningfully raises the bar for free.
function isHoneypotTriggered(body) {
  return Boolean(body && body.website);
}

// Real, server-verified authorization — checks an actual signed-in staff
// user's permissions (from the same JWT auth used by /auth/ and /profile/),
// not a client-supplied header. The X-Demo-Role header this app used to
// accept for these checks was never real authorization — anyone could set
// it to anything — so it's been fully retired from every endpoint that
// changes data or returns non-public information.
function requirePermission(req, res, permission) {
  const auth = requireAuth(req, res, sendJson);
  if (!auth) return null;
  const perms = ROLE_PERMISSIONS[auth.user.roleSlug] || [];
  if (!perms.includes(permission)) {
    sendJson(req, res, 403, {
      error: "You don't have permission to perform this action.",
      code: "FORBIDDEN"
    });
    return null;
  }
  return auth;
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

function createBooking(body, customerId = null) {
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
    patientName: String(body.patientName).trim().slice(0, 120),
    phone: String(body.phone).trim(),
    pickup: String(body.pickup).trim().slice(0, 200),
    destination: hospital ? hospital.name : String(body.destination).trim().slice(0, 200),
    hospitalId: hospital ? hospital.id : null,
    customerId,
    emergencyType,
    ambulanceId: ambulance ? ambulance.id : null,
    dispatchDistanceKm: distanceKm,
    status: ambulance ? "assigned" : "requested",
    notes: body.notes ? String(body.notes).trim().slice(0, 500) : "",
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

  // /auth and /profile are true sub-apps with their own index.html.
  const isSubApp = /^(auth|profile)(\/|$)/.test(relativePath);

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
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...SECURITY_HEADERS });
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
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...SECURITY_HEADERS });
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

        res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", ...SECURITY_HEADERS });
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
      ...SECURITY_HEADERS,
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
  if (await handleProfileRoutes(req, res, url, parseBody, sendJson, db)) return;

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
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return;
    if (auth.user.roleSlug !== "hospital_admin") {
      sendJson(req, res, 403, { error: "Only a hospital account can register a hospital." });
      return;
    }
    const profile = getProfile(auth.user);
    if (profile && profile.hospitalId) {
      sendJson(req, res, 409, { error: "You already have a hospital registered to your account." });
      return;
    }
    if (!checkPublicWriteRateLimit(`hospital-signup:${getRequestMeta(req).ip || "unknown"}`)) {
      sendJson(req, res, 429, { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" });
      return;
    }
    const body = await parseBody(req);
    if (isHoneypotTriggered(body)) { sendJson(req, res, 400, { error: "Unable to process request." }); return; }
    const missing = requireFields(body, ["name", "city", "address", "phone", "email"]);
    if (missing.length) { sendJson(req, res, 400, { error: "Missing required fields", fields: missing }); return; }
    if (!PHONE_PATTERN.test(String(body.phone).trim())) { sendJson(req, res, 400, { error: "phone must be a valid phone number" }); return; }
    if (!EMAIL_PATTERN.test(String(body.email).trim())) { sendJson(req, res, 400, { error: "email must be a valid email address" }); return; }
    const hospital = {
      id: nextId(db.hospitals),
      name: String(body.name).trim().slice(0, 150), city: String(body.city).trim().slice(0, 80), address: String(body.address).trim().slice(0, 250),
      phone: String(body.phone).trim(), email: String(body.email).trim().toLowerCase(),
      emergencyAvailable: Boolean(body.emergencyAvailable ?? true), totalBeds: Number(body.totalBeds || 0),
      availableBeds: Number(body.availableBeds || 0), status: "pending",
      ownerId: auth.user.id, departments: []
    };
    db.hospitals.push(hospital);
    if (profile) profile.hospitalId = hospital.id;
    sendJson(req, res, 201, hospital);
    return;
  }
  const hospitalMatch = url.pathname.match(/^\/api\/hospitals\/(\d+)$/);
  if (req.method === "PATCH" && hospitalMatch) {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return;
    const hospital = db.hospitals.find(h => h.id === Number(hospitalMatch[1]));
    if (!hospital) { sendJson(req, res, 404, { error: "Hospital not found" }); return; }
    const body = await parseBody(req);

    // Approving/rejecting a hospital is an admin-only action — never the owner's own call.
    if (body.status !== undefined) {
      if (auth.user.roleSlug !== "super_admin") {
        sendJson(req, res, 403, { error: "Only an administrator can approve or reject a hospital.", code: "FORBIDDEN" });
        return;
      }
      if (!HOSPITAL_STATUSES.includes(body.status)) { sendJson(req, res, 400, { error: `status must be one of: ${HOSPITAL_STATUSES.join(", ")}` }); return; }
      hospital.status = body.status;
      sendJson(req, res, 200, hospital);
      return;
    }

    // Everything else (beds, departments, contact info) — owner or admin only.
    const isOwner = auth.user.roleSlug === "hospital_admin" && hospital.ownerId === auth.user.id;
    if (!isOwner && auth.user.roleSlug !== "super_admin") {
      sendJson(req, res, 403, { error: "You can only manage your own hospital.", code: "FORBIDDEN" });
      return;
    }

    if (body.totalBeds !== undefined) hospital.totalBeds = Math.max(0, Number(body.totalBeds) || 0);
    if (body.availableBeds !== undefined) hospital.availableBeds = Math.max(0, Math.min(hospital.totalBeds, Number(body.availableBeds) || 0));
    if (body.emergencyAvailable !== undefined) hospital.emergencyAvailable = Boolean(body.emergencyAvailable);
    if (body.phone !== undefined) {
      if (!PHONE_PATTERN.test(String(body.phone).trim())) { sendJson(req, res, 400, { error: "phone must be a valid phone number" }); return; }
      hospital.phone = String(body.phone).trim();
    }
    if (body.address !== undefined) hospital.address = String(body.address).trim().slice(0, 250);
    if (Array.isArray(body.departments)) {
      const validStatuses = ["available", "limited", "unavailable"];
      hospital.departments = body.departments
        .filter(d => d && String(d.name || "").trim())
        .slice(0, 30)
        .map(d => ({
          name: String(d.name).trim().slice(0, 60),
          status: validStatuses.includes(d.status) ? d.status : "available"
        }));
    }
    sendJson(req, res, 200, hospital);
    return;
  }

  // ----------- Ambulances -----------
  if (req.method === "GET" && url.pathname === "/api/ambulances") {
    const auth = authenticate(req);
    const isStaff = auth && auth.user.roleSlug !== "customer";
    const ambulances = isStaff ? db.ambulances : db.ambulances.map(({ driverName, phone, email, ...rest }) => rest);
    sendJson(req, res, 200, ambulances);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/ambulances") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return;
    if (auth.user.roleSlug !== "fleet_owner") {
      sendJson(req, res, 403, { error: "Only a fleet owner account can register an ambulance." });
      return;
    }
    if (!checkPublicWriteRateLimit(`ambulance-signup:${getRequestMeta(req).ip || "unknown"}`)) {
      sendJson(req, res, 429, { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" });
      return;
    }
    const body = await parseBody(req);
    if (isHoneypotTriggered(body)) { sendJson(req, res, 400, { error: "Unable to process request." }); return; }
    const missing = requireFields(body, ["registrationNumber", "type", "driverName", "phone", "email"]);
    if (missing.length) { sendJson(req, res, 400, { error: "Missing required fields", fields: missing }); return; }
    if (!AMBULANCE_TYPES.includes(body.type)) { sendJson(req, res, 400, { error: `type must be one of: ${AMBULANCE_TYPES.join(", ")}` }); return; }
    if (!PHONE_PATTERN.test(String(body.phone).trim())) { sendJson(req, res, 400, { error: "phone must be a valid phone number" }); return; }
    if (!EMAIL_PATTERN.test(String(body.email).trim())) { sendJson(req, res, 400, { error: "email must be a valid email address" }); return; }
    const ambulance = {
      id: nextId(db.ambulances), registrationNumber: String(body.registrationNumber).trim().slice(0, 30), type: body.type,
      driverName: String(body.driverName).trim().slice(0, 120), phone: String(body.phone).trim(), email: String(body.email).trim().toLowerCase(),
      currentLat: body.currentLat !== undefined ? Number(body.currentLat) : null,
      currentLng: body.currentLng !== undefined ? Number(body.currentLng) : null,
      // Starts offline — the owner (now a real, verified account) switches
      // it to available once it's actually ready, same safety default as
      // before, just a self-service step instead of an admin gate.
      status: "offline",
      ownerId: auth.user.id, driverId: null
    };
    db.ambulances.push(ambulance);
    sendJson(req, res, 201, ambulance);
    return;
  }
  const ambulanceMatch = url.pathname.match(/^\/api\/ambulances\/(\d+)$/);
  if (req.method === "PATCH" && ambulanceMatch) {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return;
    const ambulance = db.ambulances.find(a => a.id === Number(ambulanceMatch[1]));
    if (!ambulance) { sendJson(req, res, 404, { error: "Ambulance not found" }); return; }

    const isOwner = auth.user.roleSlug === "fleet_owner" && ambulance.ownerId === auth.user.id;
    if (!isOwner && auth.user.roleSlug !== "super_admin") {
      sendJson(req, res, 403, { error: "You can only manage your own ambulances.", code: "FORBIDDEN" });
      return;
    }

    const body = await parseBody(req);
    if (body.status !== undefined) {
      if (!AMBULANCE_STATUSES.includes(body.status)) { sendJson(req, res, 400, { error: `status must be one of: ${AMBULANCE_STATUSES.join(", ")}` }); return; }
      ambulance.status = body.status;
    }
    if (body.driverId !== undefined) {
      if (body.driverId === null) {
        ambulance.driverId = null;
      } else {
        const driverProfile = getProfile({ id: Number(body.driverId), roleSlug: "driver" });
        const isMyDriver = driverProfile && driverProfile.fleetOwnerId === auth.user.id;
        if (!isMyDriver && auth.user.roleSlug !== "super_admin") {
          sendJson(req, res, 403, { error: "You can only assign drivers linked to your fleet.", code: "FORBIDDEN" });
          return;
        }
        ambulance.driverId = Number(body.driverId);
      }
    }
    sendJson(req, res, 200, ambulance);
    return;
  }

  // ----------- Bookings -----------
  if (req.method === "GET" && url.pathname === "/api/bookings") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return;
    if (auth.user.roleSlug === "customer") {
      sendJson(req, res, 403, { error: "Use /api/my-bookings to view your own bookings.", code: "FORBIDDEN" });
      return;
    }
    sendJson(req, res, 200, db.bookings);
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
    if (!checkPublicWriteRateLimit(`booking-create:${getRequestMeta(req).ip || "unknown"}`)) {
      sendJson(req, res, 429, { error: "Too many requests. Please try again in a moment.", code: "RATE_LIMITED" });
      return;
    }
    const body = await parseBody(req);
    if (isHoneypotTriggered(body)) { sendJson(req, res, 400, { error: "Unable to process request." }); return; }
    const auth = authenticate(req);
    const customerId = auth && auth.user.roleSlug === "customer" ? auth.user.id : null;
    const result = createBooking(body, customerId);
    if (result.error) { sendJson(req, res, result.statusCode, { error: result.error, fields: result.fields }); return; }
    sendJson(req, res, 201, result.booking);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/my-bookings") {
    const auth = authenticate(req);
    if (!auth || auth.user.roleSlug !== "customer") {
      sendJson(req, res, 401, { error: "Sign in to view your bookings", code: "AUTH_REQUIRED" });
      return;
    }
    const phoneKey = lastDigits(auth.user.phone);
    const mine = db.bookings.filter(b => b.customerId === auth.user.id || (phoneKey && lastDigits(b.phone) === phoneKey));
    sendJson(req, res, 200, mine.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
    return;
  }
  const bookingMatch = url.pathname.match(/^\/api\/bookings\/(\d+)$/);
  if (req.method === "PATCH" && bookingMatch) {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return;

    const booking = db.bookings.find(b => b.id === Number(bookingMatch[1]));
    if (!booking) { sendJson(req, res, 404, { error: "Booking not found" }); return; }

    const body = await parseBody(req);
    const nextStatus = body.status;
    if (!BOOKING_STATUSES.includes(nextStatus)) { sendJson(req, res, 400, { error: `status must be one of: ${BOOKING_STATUSES.join(", ")}` }); return; }

    const perms = ROLE_PERMISSIONS[auth.user.roleSlug] || [];
    const isStaffManager = perms.includes("bookings.update");
    const isOwnerCancelling = auth.user.roleSlug === "customer" && booking.customerId === auth.user.id && nextStatus === "cancelled";
    if (!isStaffManager && !isOwnerCancelling) {
      sendJson(req, res, 403, { error: "You don't have permission to update this booking.", code: "FORBIDDEN" });
      return;
    }

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
    if (!checkPublicWriteRateLimit(`chatbot:${getRequestMeta(req).ip || "unknown"}`)) {
      sendJson(req, res, 429, { error: "Too many requests. Please try again in a moment.", code: "RATE_LIMITED" });
      return;
    }
    const body = await parseBody(req);
    const sessionId = String(body.sessionId || "anonymous");
    const prior = chatSessions.get(sessionId) || emptySession();
    const result = handleMessage(body.message, prior);
    chatSessions.set(sessionId, result.session || emptySession());

    let booking = null;
    if (result.nextAction === "create_booking" && result.readyBooking) {
      const chatAuth = authenticate(req);
      const chatCustomerId = chatAuth && chatAuth.user.roleSlug === "customer" ? chatAuth.user.id : null;
      const outcome = createBooking(result.readyBooking, chatCustomerId);
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
      // These two are deliberately client-facing validation messages from
      // parseBody(). Anything else is an unexpected error — log it in full
      // server-side (this used to go nowhere at all) and give the client
      // only a generic message, not internal details.
      const knownSafeMessages = ["Invalid JSON body", "Request body too large"];
      if (!knownSafeMessages.includes(error.message)) {
        console.error(`[HindCare] Unhandled error on ${req.method} ${req.url}:`, error);
      }
      const clientMessage = knownSafeMessages.includes(error.message)
        ? error.message
        : "Something went wrong. Please try again.";
      sendJson(req, res, 400, { error: clientMessage });
    });
    return;
  }

  // All other requests → static files (with SPA fallback)
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`HindCare demo running at http://${HOST}:${PORT}`);
});
