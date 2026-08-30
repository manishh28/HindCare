const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

const pool = require("./db");


pool.query("SELECT NOW()")
  .then(() => console.log("PostgreSQL connected successfully"))
  .catch(error => console.error("PostgreSQL connection failed:", error.code || error.message));


const http = require("http");
const { handleMessage, emptySession } = require("../chatbot/chatbot");
const { askGemini } = require("./ai-gemini");
const { handleAuthRoutes } = require("./auth/routes");
const { handleProfileRoutes } = require("./profile/routes");
const { authenticate, requireAuth, getRequestMeta } = require("./auth/middleware");
const {
  ROLE_PERMISSIONS,
  findUserById,
  getProfile,
  store,
  maybeSeedDemoUsers,
  snapshotAuthCounters,
  restoreAuthCounter,
  repairRoleAssignments,
  repairDuplicateUserIds
} = require("./auth/store");
const { initAuthPersistence } = require("./auth/persist");

// Rate limiting for the public write endpoints below (hospital/ambulance
// onboarding, booking creation) — mirrors the same pattern already used in
// backend/auth/routes.js for login/signup/OTP.
const publicWriteRateLimits = new Map();
const PUBLIC_WRITE_WINDOW_MS = 60000;
const PUBLIC_WRITE_MAX = 20;
function checkPublicWriteRateLimit(key, max = PUBLIC_WRITE_MAX) {
  const now = Date.now();
  const entry = publicWriteRateLimits.get(key) || { count: 0, resetAt: now + PUBLIC_WRITE_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + PUBLIC_WRITE_WINDOW_MS;
  }
  entry.count += 1;
  publicWriteRateLimits.set(key, entry);
  if (publicWriteRateLimits.size > 10000) {
    for (const [storedKey, storedEntry] of publicWriteRateLimits) {
      if (storedEntry.resetAt < now) publicWriteRateLimits.delete(storedKey);
      if (publicWriteRateLimits.size <= 8000) break;
    }
  }
  return entry.count <= max;
}

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || `http://${HOST}:${PORT}`)
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

// Hosts we're willing to redirect to — used by the HTTP→HTTPS upgrade below
// so a attacker-crafted Host/x-forwarded-host header can't produce an open
// redirect to an arbitrary domain.
const ALLOWED_HOSTS = new Set(
  ALLOWED_ORIGINS.map(origin => {
    try { return new URL(origin).host; } catch { return null; }
  }).filter(Boolean)
);

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
  chatbotLogs: []
};

const chatSessions = new Map();

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || "").split(";");
  const prefix = `${name}=`;
  const value = cookies.find(cookie => cookie.trim().startsWith(prefix));
  if (!value) return null;
  try {
    return decodeURIComponent(value.trim().slice(prefix.length));
  } catch {
    return null;
  }
}

function getChatSessionId(req, res) {
  const existing = getCookie(req, "hindcare_chat");
  const sessionId = existing && /^[a-f0-9-]{36}$/i.test(existing)
    ? existing
    : crypto.randomUUID();
  const secure = process.env.NODE_ENV === "production" ||
    String(process.env.TRUST_PROXY || "").toLowerCase() === "true";
  res.setHeader(
    "Set-Cookie",
    `hindcare_chat=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800${secure ? "; Secure" : ""}`
  );
  return sessionId;
}

// ---------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------

// Applied to every response. The CSP is deliberately strict — same-origin
// only, plus the Google Fonts hosts this app actually loads. Lenis is
// self-hosted from /assets/vendor/ so no third-party script host is allowed
// (a compromised CDN package would otherwise be full XSS against every user).
const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://tile.openstreetmap.org",
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
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

function bookingRowToApi(row) {
  return {
    id: Number(row.id),
    patientName: row.patient_name,
    phone: row.phone,
    pickup: row.pickup,
    destination: row.destination,
    emergencyType: row.emergency_type,
    ambulanceId: row.ambulance_id === null ? null : Number(row.ambulance_id),
    assignedDriverId: row.assigned_driver_id === null
      ? null
      : Number(row.assigned_driver_id),
    hospitalId: row.hospital_id === null
      ? null
      : Number(row.hospital_id),
    customerId: row.customer_id === null
      ? null
      : Number(row.customer_id),
    status: row.status,
    notes: row.notes || "",
    pickupLat: row.pickup_lat === null ? null : Number(row.pickup_lat),
    pickupLng: row.pickup_lng === null ? null : Number(row.pickup_lng),
    destinationLat: row.destination_lat === null
      ? null
      : Number(row.destination_lat),
    destinationLng: row.destination_lng === null
      ? null
      : Number(row.destination_lng),
    dispatchDistanceKm: row.dispatch_distance_km === null
      ? null
      : Number(row.dispatch_distance_km),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function hospitalRowToApi(row) {
  return {
    id: Number(row.id),
    name: row.name,
    city: row.city,
    address: row.address,
    phone: row.phone,
    email: row.email,
    emergencyAvailable: row.emergency_available,
    totalBeds: row.total_beds,
    availableBeds: row.available_beds,
    status: row.status,
    lat: row.lat === null ? null : Number(row.lat),
    lng: row.lng === null ? null : Number(row.lng),
    ownerId: row.owner_id === null ? null : Number(row.owner_id),
    departments: row.departments || []
  };
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

function isActiveBookingStatus(status) {
  return ["requested", "assigned", "on_route"].includes(status);
}

  async function ensureCustomerDatabaseUser(user) {
    if (!user || user.roleSlug !== "customer") return null;
    const profile = getProfile(user) || {};
    const fullName = String(profile.fullName || "Patient").trim().slice(0, 120);
    const phone = String(user.phone || "").trim();
    const email = user.email ? String(user.email).trim().toLowerCase() : null;

    const existing = await pool.query(
      "SELECT id, phone, email, role FROM users WHERE id = $1",
      [Number(user.id)]
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      const samePhone = String(row.phone || "").replace(/\D/g, "") === phone.replace(/\D/g, "");
      const sameEmail = !email || String(row.email || "").toLowerCase() === email;
      return row.role === "patient" && samePhone && sameEmail ? Number(row.id) : null;
    }

    const inserted = await pool.query(
      `INSERT INTO users (id, full_name, phone, email, role, password_hash)
       VALUES ($1, $2, $3, $4, 'patient', $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [Number(user.id), fullName, phone, email, user.passwordHash || null]
    );
    if (!inserted.rows[0]) return null;

    // Explicitly using the auth ID keeps JWT subjects, bookings and profiles
    // aligned. Advance the BIGSERIAL sequence so future inserts stay unique.
    await pool.query(
      "SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT MAX(id) FROM users), true)"
    );
    return Number(inserted.rows[0].id);
  }

  async function createBooking(body, customerId = null, customerUser = null) {
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let hospital = null;
    if (body.hospitalId) {
      const hospitalResult = await client.query(
        "SELECT id, name, lat, lng FROM hospitals WHERE id = $1",
        [Number(body.hospitalId)]
      );
      hospital = hospitalResult.rows[0] || null;
      if (!hospital) {
        await client.query("ROLLBACK");
        return { statusCode: 400, error: "hospitalId does not match a known hospital" };
      }
    }

    const pickupPoint = geocodePickup(body.pickup);
    const destinationPoint = hospital
      ? { lat: Number(hospital.lat), lng: Number(hospital.lng) }
      : geocodePickup(body.destination);

    const ambulanceResult = await client.query(`
      SELECT id, current_lat, current_lng, driver_id
      FROM ambulances
      WHERE status = 'available'
        AND driver_id IS NOT NULL
      ORDER BY id
      FOR UPDATE
    `);
    const availableAmbulances = ambulanceResult.rows;
    const ambulance = availableAmbulances.length
      ? availableAmbulances.reduce((closest, candidate) => {
        if (!pickupPoint) return closest || candidate;

        const candidateDistance = candidate.current_lat === null || candidate.current_lng === null
          ? Infinity
          : haversineKm(pickupPoint, {
            lat: Number(candidate.current_lat),
            lng: Number(candidate.current_lng)
          });
        const closestDistance = !closest || closest.current_lat === null || closest.current_lng === null
          ? Infinity
          : haversineKm(pickupPoint, {
            lat: Number(closest.current_lat),
            lng: Number(closest.current_lng)
          });

        return candidateDistance < closestDistance ? candidate : closest;
      }, null)
      : null;
    const ambulancePoint = ambulance && ambulance.current_lat !== null
      ? { lat: Number(ambulance.current_lat), lng: Number(ambulance.current_lng) }
      : null;
    const distanceKm = pickupPoint && ambulancePoint
      ? Math.round(haversineKm(pickupPoint, ambulancePoint) * 10) / 10
      : null;
    const assignedDriverId = ambulance?.driver_id || null;
    const status = ambulance ? "assigned" : "requested";
    let dbCustomerId = null;

    if (customerId && customerUser) {
      dbCustomerId = await ensureCustomerDatabaseUser(customerUser);
    }

    const bookingResult = await client.query(`
      INSERT INTO bookings (
        patient_name, phone, pickup, destination, emergency_type,
        ambulance_id, assigned_driver_id, hospital_id, status, notes,
        customer_id, pickup_lat, pickup_lng, destination_lat,
        destination_lng, dispatch_distance_km, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP)
      RETURNING *
    `, [
      String(body.patientName).trim().slice(0, 120),
      String(body.phone).trim(),
      String(body.pickup).trim().slice(0, 200),
      hospital ? hospital.name : String(body.destination).trim().slice(0, 200),
      emergencyType,
      ambulance?.id || null,
      assignedDriverId,
      hospital?.id || null,
      status,
      body.notes ? String(body.notes).trim().slice(0, 500) : "",
      dbCustomerId,
      pickupPoint?.lat ?? null,
      pickupPoint?.lng ?? null,
      destinationPoint?.lat ?? null,
      destinationPoint?.lng ?? null,
      distanceKm
    ]);

    if (ambulance) {
      await client.query("UPDATE ambulances SET status = 'busy' WHERE id = $1", [ambulance.id]);
    }
    await client.query("COMMIT");

    const row = bookingResult.rows[0];
    const booking = {
      id: Number(row.id),
      patientName: row.patient_name,
      phone: row.phone,
      pickup: row.pickup,
      destination: row.destination,
      pickupLat: row.pickup_lat === null ? null : Number(row.pickup_lat),
      pickupLng: row.pickup_lng === null ? null : Number(row.pickup_lng),
      destinationLat: row.destination_lat === null ? null : Number(row.destination_lat),
      destinationLng: row.destination_lng === null ? null : Number(row.destination_lng),
      hospitalId: row.hospital_id === null ? null : Number(row.hospital_id),
      customerId: row.customer_id === null ? null : Number(row.customer_id),
      emergencyType: row.emergency_type,
      ambulanceId: row.ambulance_id === null ? null : Number(row.ambulance_id),
      assignedDriverId: row.assigned_driver_id === null ? null : Number(row.assigned_driver_id),
      dispatchDistanceKm: row.dispatch_distance_km === null ? null : Number(row.dispatch_distance_km),
      status: row.status,
      notes: row.notes || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };

    return { statusCode: 201, booking };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Failed to create booking in PostgreSQL:", error.message);
    return { statusCode: 500, error: "Unable to create booking" };
  } finally {
    client.release();
  }
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
    if (path.relative(FRONTEND_DIR, filePath).startsWith("..") || path.isAbsolute(path.relative(FRONTEND_DIR, filePath))) {
      sendJson(req, res, 403, { error: "Forbidden" });
      return;
    }

    fs.stat(filePath, (statErr, stat) => {
      if (!statErr && stat.isDirectory()) {
        const indexPath = path.normalize(path.join(filePath, "index.html"));
        if (path.relative(FRONTEND_DIR, indexPath).startsWith("..") || path.isAbsolute(path.relative(FRONTEND_DIR, indexPath))) {
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
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
  if (await handleProfileRoutes(req, res, url, parseBody, sendJson, pool)) return;

  // Driver GPS updates are accepted only from the authenticated driver linked
  // to an ambulance with an active booking.
  if (req.method === "PATCH" && url.pathname === "/api/driver/location") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return;
    if (auth.user.roleSlug !== "driver") {
      sendJson(req, res, 403, { error: "Only a driver can update ambulance location.", code: "FORBIDDEN" });
      return;
    }
    if (!checkPublicWriteRateLimit(`driver-location:${auth.user.id}`)) {
      sendJson(req, res, 429, { error: "Location updates are temporarily limited.", code: "RATE_LIMITED" });
      return;
    }

    const body = await parseBody(req);
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      sendJson(req, res, 400, { error: "latitude must be between -90 and 90 and longitude between -180 and 180." });
      return;
    }

    try {
      const result = await pool.query(
        `
          UPDATE ambulances a
          SET current_lat = $1, current_lng = $2
          WHERE a.driver_id = $3
            AND EXISTS (
              SELECT 1
              FROM bookings b
              WHERE b.ambulance_id = a.id
                AND b.status IN ('assigned', 'on_route')
            )
          RETURNING a.id, a.registration_number, a.current_lat, a.current_lng
        `,
        [latitude, longitude, auth.user.id]
      );
      if (!result.rows[0]) {
        sendJson(req, res, 409, { error: "You are not linked to an ambulance with an active trip." });
        return;
      }

      const row = result.rows[0];
      sendJson(req, res, 200, {
        ambulanceId: Number(row.id),
        registrationNumber: row.registration_number,
        latitude: Number(row.current_lat),
        longitude: Number(row.current_lng),
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("Failed to update driver location:", error.message);
      sendJson(req, res, 500, { error: "Unable to update driver location" });
    }
    return;
  }

  // ----------- Hospitals -----------
  if (req.method === "GET" && url.pathname === "/api/hospitals") {
  const city = url.searchParams.get("city");
  const auth = authenticate(req);
  const includeUnapproved = auth?.user.roleSlug === "super_admin";

  try {
    const result = await pool.query(
      `
        SELECT
          id,
          name,
          city,
          address,
          phone,
          email,
          emergency_available AS "emergencyAvailable",
          total_beds AS "totalBeds",
          available_beds AS "availableBeds",
          status,
          lat,
          lng,
          owner_id AS "ownerId",
          departments
        FROM hospitals
        WHERE ($2::boolean OR status = 'approved')
          AND ($1::text IS NULL OR LOWER(city) = LOWER($1))
        ORDER BY id
      `,
      [city || null, includeUnapproved]
    );

    sendJson(req, res, 200, result.rows);
  } catch (error) {
    console.error("Failed to load hospitals:", error.message);
    sendJson(req, res, 500, {
      error: "Unable to load hospitals"
    });
  }

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
    try {
      const result = await pool.query(
        `
          INSERT INTO hospitals (
            name, city, address, phone, email, emergency_available,
            total_beds, available_beds, status, owner_id, departments
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, '[]'::jsonb)
          RETURNING *
        `,
        [
          String(body.name).trim().slice(0, 150),
          String(body.city).trim().slice(0, 80),
          String(body.address).trim().slice(0, 250),
          String(body.phone).trim(),
          String(body.email).trim().toLowerCase(),
          Boolean(body.emergencyAvailable ?? true),
          Math.max(0, Number(body.totalBeds || 0)),
          Math.max(0, Number(body.availableBeds || 0)),
          auth.user.id
        ]
      );
      const hospital = hospitalRowToApi(result.rows[0]);
      if (profile) profile.hospitalId = hospital.id;
      sendJson(req, res, 201, hospital);
    } catch (error) {
      console.error("Failed to register hospital:", error.message);
      sendJson(req, res, 500, { error: "Unable to register hospital" });
    }
    return;
  }
  const hospitalMatch = url.pathname.match(/^\/api\/hospitals\/(\d+)$/);
  if (req.method === "PATCH" && hospitalMatch) {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return;
    const body = await parseBody(req);

    let hospitalResult;
    try {
      hospitalResult = await pool.query("SELECT * FROM hospitals WHERE id = $1", [Number(hospitalMatch[1])]);
    } catch (error) {
      sendJson(req, res, 500, { error: "Unable to load hospital" });
      return;
    }
    const hospitalRow = hospitalResult.rows[0];
    if (!hospitalRow) { sendJson(req, res, 404, { error: "Hospital not found" }); return; }
    const hospital = hospitalRowToApi(hospitalRow);

    // Approving/rejecting a hospital is an admin-only action — never the owner's own call.
    if (body.status !== undefined) {
      if (auth.user.roleSlug !== "super_admin") {
        sendJson(req, res, 403, { error: "Only an administrator can approve or reject a hospital.", code: "FORBIDDEN" });
        return;
      }
      if (!HOSPITAL_STATUSES.includes(body.status)) { sendJson(req, res, 400, { error: `status must be one of: ${HOSPITAL_STATUSES.join(", ")}` }); return; }
      const result = await pool.query(
        "UPDATE hospitals SET status = $1 WHERE id = $2 RETURNING *",
        [body.status, hospital.id]
      );
      sendJson(req, res, 200, hospitalRowToApi(result.rows[0]));
      return;
    }

    // Everything else is scoped to the hospital. Owners can manage all details;
    // reception can only maintain live bed numbers for their own hospital.
    const profile = getProfile(auth.user);
    const isOwner = auth.user.roleSlug === "hospital_admin" && hospital.ownerId === auth.user.id;
    const isHospitalSubRole = ["hospital_doctor", "hospital_reception", "hospital_staff"].includes(auth.user.roleSlug)
      && profile?.hospitalId === hospital.id;
    if (!isOwner && !isHospitalSubRole && auth.user.roleSlug !== "super_admin") {
      sendJson(req, res, 403, { error: "You can only view or manage your assigned hospital.", code: "FORBIDDEN" });
      return;
    }
    const adminWrite = isOwner || auth.user.roleSlug === "super_admin";
    const bedWrite = adminWrite || auth.user.roleSlug === "hospital_reception";
    const requestedKeys = Object.keys(body).filter(key => key !== "status");
    const onlyBedKeys = requestedKeys.every(key => ["totalBeds", "availableBeds"].includes(key));
    if (!adminWrite && (!bedWrite || !onlyBedKeys)) {
      sendJson(req, res, 403, { error: "Your hospital role can only update bed availability.", code: "FORBIDDEN" });
      return;
    }

    const updates = [];
    const values = [];
    const addUpdate = (column, value) => { values.push(value); updates.push(`${column} = $${values.length}`); };
    const totalBeds = body.totalBeds !== undefined ? Math.max(0, Number(body.totalBeds) || 0) : hospital.totalBeds;
    if (body.totalBeds !== undefined) addUpdate("total_beds", totalBeds);
    if (body.availableBeds !== undefined) addUpdate("available_beds", Math.max(0, Math.min(totalBeds, Number(body.availableBeds) || 0)));
    if (body.emergencyAvailable !== undefined) addUpdate("emergency_available", Boolean(body.emergencyAvailable));
    if (body.phone !== undefined) {
      if (!PHONE_PATTERN.test(String(body.phone).trim())) { sendJson(req, res, 400, { error: "phone must be a valid phone number" }); return; }
      addUpdate("phone", String(body.phone).trim());
    }
    if (body.address !== undefined) addUpdate("address", String(body.address).trim().slice(0, 250));
    if (Array.isArray(body.departments)) {
      const validStatuses = ["available", "limited", "unavailable"];
      const departments = body.departments
        .filter(d => d && String(d.name || "").trim())
        .slice(0, 30)
        .map(d => ({
          name: String(d.name).trim().slice(0, 60),
          status: validStatuses.includes(d.status) ? d.status : "available"
        }));
      addUpdate("departments", JSON.stringify(departments));
    }
    if (!updates.length) { sendJson(req, res, 200, hospital); return; }
    values.push(hospital.id);
    const result = await pool.query(`UPDATE hospitals SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING *`, values);
    sendJson(req, res, 200, hospitalRowToApi(result.rows[0]));
    return;
  }

  // ----------- Ambulances -----------
  if (req.method === "GET" && url.pathname === "/api/ambulances") {
  const auth = authenticate(req);
  const isStaff = auth && auth.user.roleSlug !== "customer";

  try {
    const result = await pool.query(`
      SELECT
        id,
        registration_number AS "registrationNumber",
        type,
        driver_name AS "driverName",
        phone,
        email,
        current_lat AS "currentLat",
        current_lng AS "currentLng",
        status,
        owner_id AS "ownerId",
        driver_id AS "driverId"
      FROM ambulances
      ORDER BY id
    `);

    const ambulances = isStaff
      ? result.rows
      : result.rows.map(({ driverName, phone, email, ...publicAmbulance }) => publicAmbulance);

    sendJson(req, res, 200, ambulances);
  } catch (error) {
    console.error("Failed to load ambulances:", error.message);
    sendJson(req, res, 500, {
      error: "Unable to load ambulances"
    });
  }

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
    try {
      const result = await pool.query(
        `
          INSERT INTO ambulances (
            registration_number, type, driver_name, phone, email,
            current_lat, current_lng, status, owner_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'offline', $8)
          RETURNING *
        `,
        [
          String(body.registrationNumber).trim().slice(0, 30),
          body.type,
          String(body.driverName).trim().slice(0, 120),
          String(body.phone).trim(),
          String(body.email).trim().toLowerCase(),
          body.currentLat !== undefined ? Number(body.currentLat) : null,
          body.currentLng !== undefined ? Number(body.currentLng) : null,
          auth.user.id
        ]
      );
      const row = result.rows[0];
      sendJson(req, res, 201, {
        id: Number(row.id), registrationNumber: row.registration_number,
        type: row.type, driverName: row.driver_name, phone: row.phone,
        email: row.email, currentLat: row.current_lat, currentLng: row.current_lng,
        status: row.status, ownerId: row.owner_id, driverId: row.driver_id
      });
    } catch (error) {
      console.error("Failed to register ambulance:", error.message);
      sendJson(req, res, 500, { error: "Unable to register ambulance" });
    }
    return;
  }
  const ambulanceMatch = url.pathname.match(/^\/api\/ambulances\/(\d+)$/);
  if (req.method === "PATCH" && ambulanceMatch) {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return;
    const ambulanceResult = await pool.query("SELECT * FROM ambulances WHERE id = $1", [Number(ambulanceMatch[1])]);
    const ambulanceRow = ambulanceResult.rows[0];
    if (!ambulanceRow) { sendJson(req, res, 404, { error: "Ambulance not found" }); return; }

    const isOwner = auth.user.roleSlug === "fleet_owner" && Number(ambulanceRow.owner_id) === Number(auth.user.id);
    if (!isOwner && auth.user.roleSlug !== "super_admin") {
      sendJson(req, res, 403, { error: "You can only manage your own ambulances.", code: "FORBIDDEN" });
      return;
    }

    const body = await parseBody(req);
    const updates = [];
    const values = [];
    const addUpdate = (column, value) => { values.push(value); updates.push(`${column} = $${values.length}`); };
    if (body.status !== undefined) {
      if (!AMBULANCE_STATUSES.includes(body.status)) { sendJson(req, res, 400, { error: `status must be one of: ${AMBULANCE_STATUSES.join(", ")}` }); return; }
      addUpdate("status", body.status);
    }
    if (body.driverId !== undefined) {
      if (body.driverId === null) {
        addUpdate("driver_id", null);
      } else {
        const driverProfile = getProfile({ id: Number(body.driverId), roleSlug: "driver" });
        const isMyDriver = driverProfile && driverProfile.fleetOwnerId === auth.user.id;
        if (!isMyDriver && auth.user.roleSlug !== "super_admin") {
          sendJson(req, res, 403, { error: "You can only assign drivers linked to your fleet.", code: "FORBIDDEN" });
          return;
        }
        addUpdate("driver_id", Number(body.driverId));
      }
    }
    if (!updates.length) { sendJson(req, res, 200, ambulanceRow); return; }
    values.push(Number(ambulanceMatch[1]));
    const updated = await pool.query(`UPDATE ambulances SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING *`, values);
    const row = updated.rows[0];
    sendJson(req, res, 200, {
      id: Number(row.id), registrationNumber: row.registration_number, type: row.type,
      driverName: row.driver_name, phone: row.phone, email: row.email,
      currentLat: row.current_lat, currentLng: row.current_lng, status: row.status,
      ownerId: row.owner_id, driverId: row.driver_id
    });
    return;
  }

  // ----------- Bookings -----------
if (req.method === "GET" && url.pathname === "/api/bookings") {
  const auth = requireAuth(req, res, sendJson);
  if (!auth) return;

  const permissions = ROLE_PERMISSIONS[auth.user.roleSlug] || [];
  if (!permissions.includes("bookings.read")) {
    sendJson(req, res, 403, {
      error: "You don't have permission to view bookings.",
      code: "FORBIDDEN"
    });
    return;
  }

  const params = [];
  const filters = [];
  const role = auth.user.roleSlug;

  if (!["super_admin", "dispatcher"].includes(role)) {
    if (role === "hospital_admin" || role === "hospital_doctor" ||
        role === "hospital_reception" || role === "hospital_staff") {
      const profile = getProfile(auth.user);
      if (!profile?.hospitalId) {
        sendJson(req, res, 200, []);
        return;
      }

      params.push(profile.hospitalId);
      filters.push(`b.hospital_id = $${params.length}`);
    } else if (role === "fleet_owner") {
      params.push(auth.user.id);
      filters.push(`a.owner_id = $${params.length}`);
    } else if (role === "driver") {
      params.push(auth.user.id);
      filters.push(`(
        b.assigned_driver_id = $${params.length}
        OR a.driver_id = $${params.length}
      )`);
    } else {
      sendJson(req, res, 200, []);
      return;
    }
  }

  try {
    const result = await pool.query(
      `
        SELECT b.*
        FROM bookings b
        LEFT JOIN ambulances a ON a.id = b.ambulance_id
        ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
        ORDER BY b.created_at DESC
      `,
      params
    );

    sendJson(req, res, 200, result.rows.map(bookingRowToApi));
  } catch (error) {
    console.error("Failed to load bookings:", error.message);
    sendJson(req, res, 500, {
      error: "Unable to load bookings"
    });
  }

  return;
}
  if (req.method === "GET" && url.pathname === "/api/bookings/lookup") {
    // Public guest tracking, but hardened: the caller must supply the FULL
    // booking phone number (matched on its last 10 digits) instead of the old
    // 4-digit suffix — sequential booking IDs plus a 4-digit guess was far too
    // weak a proof for patient name, contact details and live GPS. The rate is
    // capped per IP (higher than writes because the tracking page polls every
    // 5 s) and only tracking-relevant fields come back; notes are never
    // exposed here and the phone number is masked.
    if (!checkPublicWriteRateLimit(`booking-lookup:${getRequestMeta(req).ip || "unknown"}`, 60)) {
      sendJson(req, res, 429, { error: "Too many lookups. Please try again in a moment.", code: "RATE_LIMITED" });
      return;
    }
    const id = Number(url.searchParams.get("id"));
    const phoneDigits = String(url.searchParams.get("phone") || "").replace(/\D/g, "");

    if (!Number.isInteger(id) || id < 1 || phoneDigits.length < 10) {
      sendJson(req, res, 400, { error: "A valid booking ID and the full phone number used for the booking are required." });
      return;
    }

    try {
      const result = await pool.query(
        `
          SELECT
            b.id, b.patient_name, b.phone, b.pickup, b.destination,
            b.emergency_type, b.ambulance_id, b.status,
            b.pickup_lat, b.pickup_lng, b.destination_lat, b.destination_lng,
            b.dispatch_distance_km,
            b.created_at, b.updated_at,
            a.registration_number AS ambulance_registration_number,
            a.type AS ambulance_type,
            a.driver_name AS ambulance_driver_name,
            a.current_lat AS ambulance_current_lat,
            a.current_lng AS ambulance_current_lng
          FROM bookings b
          LEFT JOIN ambulances a ON a.id = b.ambulance_id
          WHERE b.id = $1
            AND RIGHT(regexp_replace(b.phone, '[^0-9]', '', 'g'), 10)
                = RIGHT($2, 10)
          LIMIT 1
        `,
        [id, phoneDigits]
      );

      const row = result.rows[0];
      if (!row) {
        sendJson(req, res, 404, { error: "Booking not found" });
        return;
      }

      const booking = {
        id: Number(row.id),
        destination: row.destination,
        emergencyType: row.emergency_type,
        ambulanceId: row.ambulance_id === null ? null : Number(row.ambulance_id),
        status: row.status,
        pickupLat: row.pickup_lat === null ? null : Number(row.pickup_lat),
        pickupLng: row.pickup_lng === null ? null : Number(row.pickup_lng),
        destinationLat: row.destination_lat === null ? null : Number(row.destination_lat),
        destinationLng: row.destination_lng === null ? null : Number(row.destination_lng),
        dispatchDistanceKm: row.dispatch_distance_km === null ? null : Number(row.dispatch_distance_km),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
      booking.ambulance = row.ambulance_id === null ? null : {
        registrationNumber: row.ambulance_registration_number,
        type: row.ambulance_type,
        driverName: row.ambulance_driver_name,
        currentLat: row.ambulance_current_lat === null ? null : Number(row.ambulance_current_lat),
        currentLng: row.ambulance_current_lng === null ? null : Number(row.ambulance_current_lng)
      };

      sendJson(req, res, 200, booking);
    } catch (error) {
      console.error("Failed to look up booking:", error.message);
      sendJson(req, res, 500, { error: "Unable to look up booking" });
    }

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
    const result = await createBooking(body, customerId, auth?.user || null);
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

try {
  const result = await pool.query(
    `
      SELECT *
      FROM bookings
      WHERE customer_id = $1
         OR regexp_replace(phone, '[^0-9]', '', 'g') LIKE '%' || $2
      ORDER BY created_at DESC
    `,
    [auth.user.id, phoneKey]
  );

  sendJson(req, res, 200, result.rows.map(bookingRowToApi));
} catch (error) {
  console.error("Failed to load my bookings:", error.message);
  sendJson(req, res, 500, {
    error: "Unable to load your bookings"
  });
}
    return;
  }
  const bookingMatch = url.pathname.match(/^\/api\/bookings\/(\d+)$/);
  if (req.method === "PATCH" && bookingMatch) {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return;

    const body = await parseBody(req);
    const nextStatus = body.status;
    const hasStatusUpdate = nextStatus !== undefined;
    const hasDispatchUpdate = body.ambulanceId !== undefined || body.assignedDriverId !== undefined;

    if (hasDispatchUpdate) {
      sendJson(req, res, 409, {
        error: "Ambulances are assigned automatically to the nearest available vehicle and its fixed driver.",
        code: "AUTOMATIC_ASSIGNMENT"
      });
      return;
    }

    if (!hasStatusUpdate && !hasDispatchUpdate) {
      sendJson(req, res, 400, { error: "Send a status, ambulanceId, or assignedDriverId to update this booking." });
      return;
    }
    if (hasStatusUpdate && !BOOKING_STATUSES.includes(nextStatus)) {
      sendJson(req, res, 400, { error: `status must be one of: ${BOOKING_STATUSES.join(", ")}` });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const currentResult = await client.query(
        "SELECT * FROM bookings WHERE id = $1 FOR UPDATE",
        [Number(bookingMatch[1])]
      );
      const currentRow = currentResult.rows[0];
      if (!currentRow) {
        await client.query("ROLLBACK");
        sendJson(req, res, 404, { error: "Booking not found" });
        return;
      }

      const currentBooking = bookingRowToApi(currentRow);
      const perms = ROLE_PERMISSIONS[auth.user.roleSlug] || [];
      const isStaffManager = perms.includes("bookings.update");
      const canDispatch = perms.includes("bookings.dispatch");
      const isOwnerCancelling = auth.user.roleSlug === "customer" && currentBooking.customerId === auth.user.id && nextStatus === "cancelled";
      const isAssignedDriver = auth.user.roleSlug === "driver" && currentBooking.assignedDriverId === auth.user.id;
      const canUpdateStatus = auth.user.roleSlug === "driver" ? isAssignedDriver : isStaffManager;

      if (hasDispatchUpdate && !canDispatch) {
        await client.query("ROLLBACK");
        sendJson(req, res, 403, { error: "You don't have permission to assign ambulances or drivers.", code: "FORBIDDEN" });
        return;
      }
      if (hasStatusUpdate && !canUpdateStatus && !isOwnerCancelling) {
        await client.query("ROLLBACK");
        sendJson(req, res, 403, { error: "You don't have permission to update this booking.", code: "FORBIDDEN" });
        return;
      }

      let ambulanceId = currentBooking.ambulanceId;
      let driverId = currentBooking.assignedDriverId;
      let nextAmbulance = null;

      if (hasDispatchUpdate) {
        if (body.ambulanceId !== undefined) {
          ambulanceId = body.ambulanceId === null || body.ambulanceId === "" ? null : Number(body.ambulanceId);
        }

        if (ambulanceId !== null) {
          const ambulanceResult = await client.query(
            "SELECT id, status, driver_id FROM ambulances WHERE id = $1 FOR UPDATE",
            [ambulanceId]
          );
          nextAmbulance = ambulanceResult.rows[0] || null;
          if (!nextAmbulance) {
            await client.query("ROLLBACK");
            sendJson(req, res, 400, { error: "ambulanceId does not match a known ambulance" });
            return;
          }
          if (nextAmbulance.id !== currentBooking.ambulanceId && nextAmbulance.status !== "available") {
            await client.query("ROLLBACK");
            sendJson(req, res, 409, { error: "Selected ambulance is not available." });
            return;
          }
        }

        if (body.assignedDriverId !== undefined) {
          driverId = body.assignedDriverId === null || body.assignedDriverId === "" ? null : Number(body.assignedDriverId);
          if (driverId !== null) {
            const driverResult = await client.query(
              `SELECT id
               FROM users
               WHERE id = $1 AND role = 'driver'`,
              [driverId]
            );
            if (!driverResult.rows[0]) {
              await client.query("ROLLBACK");
              sendJson(req, res, 400, { error: "assignedDriverId must match a real driver account" });
              return;
            }
          }
        } else if (nextAmbulance) {
          driverId = nextAmbulance.driver_id || null;
        }

        if (
          nextAmbulance &&
          driverId &&
          nextAmbulance.driver_id &&
          Number(nextAmbulance.driver_id) !== Number(driverId)
        ) {
          await client.query("ROLLBACK");
          sendJson(req, res, 400, { error: "Selected driver is not linked to the selected ambulance." });
          return;
        }
      }

      let status = currentBooking.status;
      if (hasStatusUpdate) {
        if (!BOOKING_TRANSITIONS[status].includes(nextStatus)) {
          await client.query("ROLLBACK");
          sendJson(req, res, 409, {
            error: `Cannot move a booking from "${status}" to "${nextStatus}".`,
            allowedNext: BOOKING_TRANSITIONS[status]
          });
          return;
        }
        status = nextStatus;
      } else if (status === "requested" && (ambulanceId || driverId)) {
        status = "assigned";
      }

      if (currentBooking.ambulanceId && currentBooking.ambulanceId !== ambulanceId) {
        await client.query(
          "UPDATE ambulances SET status = 'available' WHERE id = $1 AND status = 'busy'",
          [currentBooking.ambulanceId]
        );
      }
      if (ambulanceId && isActiveBookingStatus(status)) {
        await client.query("UPDATE ambulances SET status = 'busy' WHERE id = $1", [ambulanceId]);
      }
      if (ambulanceId && ["completed", "cancelled"].includes(status)) {
        await client.query("UPDATE ambulances SET status = 'available' WHERE id = $1", [ambulanceId]);
      }

      const updatedResult = await client.query(
        `
          UPDATE bookings
          SET ambulance_id = $1,
              assigned_driver_id = $2,
              status = $3,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $4
          RETURNING *
        `,
        [ambulanceId, driverId, status, currentBooking.id]
      );
      await client.query("COMMIT");

      const updatedBooking = bookingRowToApi(updatedResult.rows[0]);
      sendJson(req, res, 200, updatedBooking);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Failed to update booking:", error.message);
      sendJson(req, res, 500, { error: "Unable to update booking" });
    } finally {
      client.release();
    }
    return;
  }

  // ----------- Chatbot -----------
  if (req.method === "POST" && url.pathname === "/api/chatbot/message") {
    if (!checkPublicWriteRateLimit(`chatbot:${getRequestMeta(req).ip || "unknown"}`)) {
      sendJson(req, res, 429, { error: "Too many requests. Please try again in a moment.", code: "RATE_LIMITED" });
      return;
    }
    const body = await parseBody(req);
    // Keep the conversation key in an HttpOnly cookie. A client-supplied
    // sessionId could be guessed or reused to pollute another chat flow.
    const sessionId = getChatSessionId(req, res);
    const prior = chatSessions.get(sessionId) || emptySession();
    const result = handleMessage(body.message, prior);
    chatSessions.set(sessionId, result.session || emptySession());
    if (chatSessions.size > 10000) {
      const oldest = chatSessions.keys().next().value;
      if (oldest) chatSessions.delete(oldest);
    }

    let booking = null;
    if (result.nextAction === "create_booking" && result.readyBooking) {
      const chatAuth = authenticate(req);
      const chatCustomerId = chatAuth && chatAuth.user.roleSlug === "customer" ? chatAuth.user.id : null;
      const outcome = await createBooking(result.readyBooking, chatCustomerId);
      if (outcome.booking) {
        booking = outcome.booking;
        let amb = null;
        if (booking.ambulanceId) {
          const ambulanceResult = await pool.query(
            "SELECT registration_number FROM ambulances WHERE id = $1",
            [booking.ambulanceId]
          );
          amb = ambulanceResult.rows[0] || null;
        }
        result.reply = `${result.reply} Booking #${booking.id} created (status: ${booking.status}).` +
          (amb ? ` ${amb.registration_number} has been dispatched.` : " No ambulance is free right now — you're first in line for the next one.");
      } else {
        chatSessions.set(sessionId, emptySession());
        result.reply = `I couldn't create that booking (${outcome.error}). Let's start over — what is the patient's name?`;
        result.nextAction = "collect_booking_details";
        chatSessions.set(sessionId, { stage: "collecting_booking", draft: {} });
      }
    }

    let hospitals = null;
    if (result.nextAction === "show_hospitals" && result.cityQuery) {
      const hospitalResult = await pool.query(
        `
          SELECT id, name, city, address, phone, email,
                 emergency_available AS "emergencyAvailable",
                 total_beds AS "totalBeds", available_beds AS "availableBeds",
                 status, lat, lng, owner_id AS "ownerId", departments
          FROM hospitals
          WHERE status = 'approved'
            AND (LOWER(city) LIKE '%' || LOWER($1) || '%'
                 OR LOWER(name) LIKE '%' || LOWER($1) || '%')
          ORDER BY id
        `,
        [result.cityQuery]
      );
      hospitals = hospitalResult.rows;
      result.reply = hospitals.length ? `${result.reply} ${hospitals.map(h => h.name).join(", ")}.` : `${result.reply} I don't have any hospitals matching "${result.cityQuery}" in the demo data yet.`;
    }

    // Keep structured emergency booking and hospital flows deterministic.
    // Gemini is used only as a fallback for general/support conversations.
    if (["unknown", "support", "analytics"].includes(result.intent)) {
      const aiReply = await askGemini(body.message);
      if (aiReply) result.reply = aiReply;
    }

    db.chatbotLogs.push({
      id: nextId(db.chatbotLogs), sessionId, message: body.message || "",
      intent: result.intent, reply: result.reply, createdAt: new Date().toISOString()
    });
    if (db.chatbotLogs.length > 10000) db.chatbotLogs.splice(0, db.chatbotLogs.length - 10000);
    sendJson(req, res, 200, { intent: result.intent, reply: result.reply, nextAction: result.nextAction, booking, hospitals });
    return;
  }

  // If nothing matched
  sendJson(req, res, 404, { error: "API route not found" });
}

// ---------------------------------------------------------------------
// Create server
// ---------------------------------------------------------------------
async function handleRequest(req, res) {
  // Behind a reverse proxy (TRUST_PROXY=true), politely move plain-HTTP
  // requests to HTTPS so no token or password ever travels in the clear.
  // The redirect target host must be one we actually serve — a spoofed
  // Host/x-forwarded-host header must not become an open redirect.
  if (String(process.env.TRUST_PROXY || "").toLowerCase() === "true" &&
      (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim() === "http") {
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
      .split(",")[0].trim();
    if (ALLOWED_HOSTS.has(host)) {
      res.writeHead(301, { Location: `https://${host}${req.url}` });
    } else {
      res.writeHead(301, { Location: "/" });
    }
    res.end();
    return;
  }

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
}

const isProduction = process.env.NODE_ENV === "production";
const directTlsConfigured = Boolean(process.env.TLS_KEY_PATH && process.env.TLS_CERT_PATH);
const proxyTlsConfigured = String(process.env.TRUST_PROXY || "").toLowerCase() === "true";

if (isProduction && !directTlsConfigured && !proxyTlsConfigured) {
  console.error("[HindCare] Refusing to start production without HTTPS or TRUST_PROXY=true.");
  process.exit(1);
}

let server;
if (process.env.TLS_KEY_PATH && process.env.TLS_CERT_PATH) {
  // Direct-TLS mode: terminate HTTPS in Node itself when there's no reverse
  // proxy. Set TLS_KEY_PATH/TLS_CERT_PATH to PEM files to enable.
  const https = require("https");
  let tlsOptions;
  try {
    tlsOptions = {
      key: fs.readFileSync(process.env.TLS_KEY_PATH),
      cert: fs.readFileSync(process.env.TLS_CERT_PATH)
    };
  } catch (error) {
    console.error("[HindCare] Could not read TLS key/cert files:", error.message);
    process.exit(1);
  }
  server = https.createServer(tlsOptions, handleRequest);
} else {
  // Default: plain HTTP on HOST:PORT — put this behind an HTTPS reverse proxy
  // (nginx/Caddy/traefik) for anything user-facing, with TRUST_PROXY=true so
  // plaintext requests are redirected.
  server = http.createServer(handleRequest);
}

// Hydrate users/sessions/audit history from PostgreSQL BEFORE accepting any
// traffic, then seed demo data only if explicitly opted in. If auth state
// can't be loaded, production refuses to start rather than booting with an
// empty account store (which would silently break every login).
initAuthPersistence(pool, store, {
  snapshot: snapshotAuthCounters,
  restore: restoreAuthCounter,
  repairRoles: repairRoleAssignments,
  repairUserIds: repairDuplicateUserIds
})
  .catch(error => {
    console.error("[HindCare] Failed to load auth state from PostgreSQL:", error.message);
    if (isProduction) process.exit(1);
    console.warn("[HindCare] Continuing WITHOUT durable auth state (development only).");
  })
  .then(() => maybeSeedDemoUsers())
  .finally(() => {
    server.listen(PORT, HOST, () => {
      const scheme = process.env.TLS_KEY_PATH && process.env.TLS_CERT_PATH ? "https" : "http";
      console.log(`HindCare running at ${scheme}://${HOST}:${PORT}`);
    });
  });
