const crypto = require("crypto");
const {
  hashPassword,
  verifyPassword,
  hashToken,
  generateOtp,
  generateSecureToken,
  generateSessionId,
  MAX_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  OTP_TTL_SEC,
  RESET_TOKEN_TTL_SEC
} = require("./crypto");
const { markAuthStateDirty } = require("./persist");

const ROLES = [
  { id: 1, slug: "driver", name: "Ambulance Driver", mfaRequired: false },
  { id: 2, slug: "dispatcher", name: "Dispatcher / Call Center", mfaRequired: false },
  { id: 3, slug: "hospital_admin", name: "Hospital Admin", mfaRequired: true },
  { id: 4, slug: "super_admin", name: "Super Admin", mfaRequired: true },
  { id: 5, slug: "customer", name: "Patient", mfaRequired: false },
  { id: 6, slug: "fleet_owner", name: "Ambulance Fleet Owner", mfaRequired: false },
  { id: 7, slug: "hospital_doctor", name: "Hospital Doctor", mfaRequired: false },
  { id: 8, slug: "hospital_reception", name: "Hospital Reception", mfaRequired: false },
  { id: 9, slug: "hospital_staff", name: "Hospital Staff", mfaRequired: false }
];

const ROLE_PERMISSIONS = {
  driver: ["bookings.read", "bookings.update", "profile.read", "profile.update"],
  dispatcher: ["bookings.read", "bookings.update", "bookings.dispatch", "profile.read", "profile.update"],
  hospital_admin: ["bookings.read", "hospitals.manage", "ambulances.manage", "profile.read", "profile.update", "audit.read"],
  super_admin: ["bookings.read", "bookings.update", "bookings.dispatch", "hospitals.manage", "ambulances.manage", "users.manage", "audit.read", "system.configure", "profile.read", "profile.update"],
  customer: ["bookings.read", "profile.read", "profile.update"],
  fleet_owner: ["bookings.read", "ambulances.manage", "profile.read", "profile.update"],
  hospital_doctor: ["bookings.read", "hospitals.read", "profile.read", "profile.update"],
  hospital_reception: ["bookings.read", "hospitals.read", "hospitals.beds.update", "profile.read", "profile.update"],
  hospital_staff: ["hospitals.read", "profile.read", "profile.update"]
};

let nextUserId = 6;
let nextOtpId = 1;
let nextAuditId = 1;
let nextLoginId = 1;
let nextAddressId = 1;
let nextEmergencyId = 1;
let nextDocumentId = 1;

const store = {
  users: [],
  sessions: [],
  otps: [],
  resetTokens: [],
  auditLogs: [],
  loginHistory: [],
  driverProfiles: [],
  dispatcherProfiles: [],
  hospitalAdminProfiles: [],
  hospitalStaffProfiles: [],
  superAdminProfiles: [],
  customerProfiles: [],
  fleetOwnerProfiles: [],
  addresses: [],
  emergencyContacts: [],
  documents: [],
  driverBankDetails: [],
  notificationPrefs: [],
  apiKeys: []
};

async function seedDemoUsers() {
  const demoPassword = await hashPassword("HindCare@2026");

  const demos = [
    {
      roleSlug: "driver",
      employeeId: "DRV-1001",
      email: "rahul.singh@fleet.hindcare.in",
      phone: "+919111111111",
      profile: { fullName: "Rahul Singh", licenseNumber: "UP-DL-2019-884521", licenseExpiry: "2028-03-15", vehicleNumber: "UP32 AB 1001", availabilityStatus: "available", experienceYears: 6, rating: 4.7, completedTrips: 1240 }
    },
    {
      roleSlug: "fleet_owner",
      employeeId: null,
      email: "suresh@yadavambulance.in",
      phone: "+919555555555",
      profile: { fullName: "Suresh Yadav", companyName: "Yadav Ambulance Services" }
    },
    {
      roleSlug: "dispatcher",
      employeeId: "DSP-2001",
      email: "dispatch@hindcare.in",
      phone: "+919222222222",
      profile: { fullName: "Anita Verma", department: "Emergency Call Center", assignedRegion: "Lucknow Metro", shiftStart: "08:00", shiftEnd: "20:00", liveStatus: "online", callsHandled: 8420 }
    },
    {
      roleSlug: "hospital_admin",
      employeeId: "HAD-3001",
      email: "admin@hindcare-hospital.in",
      phone: "+919333333333",
      mfaEnabled: true,
      profile: { adminName: "Dr. Vikram Mehta", phone: "+919333333333", gstNumber: "09AABCH1234A1Z5", licenseNumber: "HOS-LKO-2018-001" }
    },
    {
      roleSlug: "hospital_doctor",
      employeeId: "DOC-3101",
      email: "doctor@hindcare-hospital.in",
      phone: "+919333333334",
      profile: { fullName: "Dr. Neha Sharma", hospitalId: 1, hospitalOwnerId: null, staffRole: "doctor", department: "Emergency", designation: "Emergency Physician" }
    },
    {
      roleSlug: "hospital_reception",
      employeeId: "REC-3201",
      email: "reception@hindcare-hospital.in",
      phone: "+919333333335",
      profile: { fullName: "Priya Tiwari", hospitalId: 1, hospitalOwnerId: null, staffRole: "reception", department: "Front Desk", designation: "Reception Executive" }
    },
    {
      roleSlug: "super_admin",
      employeeId: "SA-0001",
      email: "superadmin@hindcare.in",
      phone: "+919444444444",
      mfaEnabled: true,
      profile: { fullName: "Rajesh Kapoor", organizationName: "HindCare MedTech Pvt Ltd" }
    }
  ];

  for (const demo of demos) {
    const role = ROLES.find(r => r.slug === demo.roleSlug);
    const user = {
      id: nextUserId++,
      roleId: role.id,
      roleSlug: role.slug,
      employeeId: demo.employeeId || null,
      email: demo.email,
      phone: demo.phone,
      passwordHash: demoPassword,
      emailVerified: true,
      phoneVerified: true,
      mfaEnabled: demo.mfaEnabled || false,
      mfaSecret: null,
      status: "active",
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      passwordChangedAt: new Date().toISOString(),
      googleId: null,
      preferredLanguage: "en",
      theme: "light",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null
    };
    store.users.push(user);
    attachProfile(user, demo.profile);
  }

  // Link demo accounts together now that real ids exist.
  const demoFleetOwner = store.users.find(u => u.email === "suresh@yadavambulance.in");
  const demoHospitalOwner = store.users.find(u => u.email === "admin@hindcare-hospital.in");
  const demoDriverProfile = store.driverProfiles.find(p => {
    const owner = findUserById(p.userId);
    return owner && owner.email === "rahul.singh@fleet.hindcare.in";
  });
  if (demoFleetOwner && demoDriverProfile) {
    demoDriverProfile.fleetOwnerId = demoFleetOwner.id;
  }
  if (demoHospitalOwner) {
    store.hospitalStaffProfiles
      .filter(p => p.hospitalId === 1 && !p.hospitalOwnerId)
      .forEach(p => { p.hospitalOwnerId = demoHospitalOwner.id; });
  }
}

function attachProfile(user, profile) {
  const base = { userId: user.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  switch (user.roleSlug) {
    case "driver":
      store.driverProfiles.push({ ...base, profilePhotoUrl: null, languages: ["en", "hi"], emergencyContactName: "Sunita Singh", emergencyContactPhone: "+919111111112", currentShiftStart: null, currentShiftEnd: null, fleetOwnerId: null, ...profile });
      break;
    case "dispatcher":
      store.dispatcherProfiles.push({ ...base, profilePhotoUrl: null, avgResponseSeconds: 45, ...profile });
      break;
    case "hospital_admin":
      store.hospitalAdminProfiles.push({ ...base, profilePhotoUrl: null, hospitalId: 1, notificationEmail: true, notificationSms: true, licenseExpiry: "2027-12-31", ...profile });
      break;
    case "hospital_doctor":
    case "hospital_reception":
    case "hospital_staff":
      store.hospitalStaffProfiles.push({
        ...base,
        profilePhotoUrl: null,
        fullName: profile.fullName,
        hospitalId: profile.hospitalId || null,
        hospitalOwnerId: profile.hospitalOwnerId || null,
        staffRole: profile.staffRole || user.roleSlug.replace("hospital_", ""),
        department: profile.department || null,
        designation: profile.designation || null
      });
      break;
    case "super_admin":
      store.superAdminProfiles.push({ ...base, profilePhotoUrl: null, apiKeysEnabled: true, ...profile });
      break;
    case "customer":
      store.customerProfiles.push({ ...base, profilePhotoUrl: null, fullName: profile.fullName });
      break;
    case "fleet_owner":
      store.fleetOwnerProfiles.push({
        ...base,
        profilePhotoUrl: null,
        fullName: profile.fullName,
        companyName: profile.companyName || null,
        // Random, unguessable fleet code — the old `FLT` + zero-padded user id
        // was fully predictable from public signup order, letting any driver
        // signup attach itself to someone else's fleet by guessing codes.
        fleetCode: generateFleetCode()
      });
      break;
    default:
      break;
  }
  store.notificationPrefs.push({
    userId: user.id,
    bookingUpdates: true,
    promotions: false,
    securityAlerts: true,
    shiftReminders: true,
    systemMaintenance: true,
    updatedAt: new Date().toISOString()
  });
  markAuthStateDirty();
}

function getRoleBySlug(slug) {
  return ROLES.find(r => r.slug === slug);
}

// Unambiguous alphabet (no 0/O/1/I) — codes are read out over the phone.
const FLEET_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function generateFleetCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    let suffix = "";
    const bytes = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) {
      suffix += FLEET_CODE_ALPHABET[bytes[i] % FLEET_CODE_ALPHABET.length];
    }
    const code = `FLT-${suffix}`;
    if (!store.fleetOwnerProfiles.some(p => p.fleetCode === code)) return code;
  }
  throw new Error("Unable to generate a unique fleet code");
}

function findUserById(id) {
  return store.users.find(u => u.id === Number(id) && u.status !== "deleted");
}

function findUserByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  return store.users.find(u => u.email === normalized && u.status !== "deleted");
}

function findUserByPhone(phone) {
  const normalized = normalizePhone(phone);
  return store.users.find(u => normalizePhone(u.phone) === normalized && u.status !== "deleted");
}

function findUserByEmployeeId(employeeId) {
  const normalized = String(employeeId || "").trim().toUpperCase();
  return store.users.find(u => u.employeeId === normalized && u.status !== "deleted");
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  // Leading trunk 0 (e.g. "0" + 10-digit number), a common local-dialing format.
  if (digits.startsWith("0") && digits.length === 11) return `+91${digits.slice(1)}`;
  if (digits.startsWith("091") && digits.length === 13) return `+91${digits.slice(3)}`;
  // Unrecognized format: still normalize to a stable, digit-only shape
  // rather than passing back the raw, differently-formatted original —
  // that's what previously allowed the same real number to register as two
  // "different" accounts depending on how it was typed.
  return digits ? `+${digits}` : String(phone || "").trim();
}

function isAccountLocked(user) {
  if (user.status === "locked") return true;
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) return true;
  return false;
}

function recordLoginAttempt(userId, success, method, meta = {}) {
  store.loginHistory.push({    id: nextLoginId++,
    userId,
    success,
    method,
    ipAddress: meta.ip || null,
    userAgent: meta.userAgent || null,
    failureReason: meta.failureReason || null,
    createdAt: new Date().toISOString()
  });
  if (store.loginHistory.length > 10000) store.loginHistory.splice(0, store.loginHistory.length - 10000);
  markAuthStateDirty();
}

function recordAudit(userId, action, resourceType, resourceId, meta = {}) {
  store.auditLogs.push({
    id: nextAuditId++,
    userId,
    action,
    resourceType,
    resourceId: String(resourceId || ""),
    ipAddress: meta.ip || null,
    userAgent: meta.userAgent || null,
    metadata: meta.metadata || {},
    createdAt: new Date().toISOString()
  });
  if (store.auditLogs.length > 10000) store.auditLogs.splice(0, store.auditLogs.length - 10000);
  markAuthStateDirty();
}

async function registerFailedLogin(user) {
  user.failedLoginAttempts += 1;
  if (user.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
    user.status = "locked";
    user.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
  }
  user.updatedAt = new Date().toISOString();
  markAuthStateDirty();
}

async function resetFailedLogins(user) {
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  if (user.status === "locked") user.status = "active";
  user.updatedAt = new Date().toISOString();
  markAuthStateDirty();
}

function createOtp({ userId, channel, destination, purpose }) {
  const otp = generateOtp();
  const record = {
    id: nextOtpId++,
    userId: userId || null,
    channel,
    destination,
    purpose,
    otpHash: hashToken(otp),
    attempts: 0,
    maxAttempts: 5,
    expiresAt: new Date(Date.now() + OTP_TTL_SEC * 1000).toISOString(),
    verifiedAt: null,
    createdAt: new Date().toISOString(),
    _plainOtp: otp
  };
  store.otps.push(record);
  if (store.otps.length > 5000) store.otps.splice(0, store.otps.length - 5000);
  markAuthStateDirty();
  return record;
}

function verifyOtpRecord(destination, purpose, otp) {
  const record = store.otps
    .filter(o => !o.verifiedAt && new Date(o.expiresAt) > new Date())
    .reverse()
    .find(o => o.destination === destination && o.purpose === purpose);
  if (!record) return { ok: false, error: "OTP expired or not found" };
  if (record.attempts >= record.maxAttempts) return { ok: false, error: "Too many OTP attempts" };
  record.attempts += 1;
  if (hashToken(otp) !== record.otpHash) {
    markAuthStateDirty();
    return { ok: false, error: "Invalid OTP" };
  }
  record.verifiedAt = new Date().toISOString();
  markAuthStateDirty();
  return { ok: true, record };
}

function createResetToken(userId) {
  const token = generateSecureToken();
  const record = {
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_SEC * 1000).toISOString(),
    usedAt: null,
    createdAt: new Date().toISOString(),
    _plainToken: token
  };
  store.resetTokens.push(record);
  markAuthStateDirty();
  return record;
}

function verifyResetToken(token) {
  const record = store.resetTokens.find(
    r => !r.usedAt && r.tokenHash === hashToken(token) && new Date(r.expiresAt) > new Date()
  );
  return record || null;
}

function createSession(userId, meta = {}) {
  const refreshToken = generateSecureToken();
  const session = {
    id: generateSessionId(),
    userId,
    refreshTokenHash: hashToken(refreshToken),
    previousTokenHashes: [],
    deviceName: meta.deviceName || "Unknown device",
    ipAddress: meta.ip || null,
    userAgent: meta.userAgent || null,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    revokedAt: null,
    createdAt: new Date().toISOString(),
    _plainRefreshToken: refreshToken
  };
  store.sessions.push(session);
  if (store.sessions.length > 5000) {
    store.sessions = store.sessions.filter(s => !s.revokedAt && new Date(s.expiresAt) > new Date()).slice(-5000);
  }
  markAuthStateDirty();
  return session;
}

// Refresh-token rotation: the presented token is retired (hash kept for reuse
// detection) and a fresh one becomes the only valid credential for the session.
// Each retired hash records WHEN it was rotated out — replays inside a short
// grace window are treated as harmless concurrent refreshes (two tabs racing),
// while older replays indicate a stolen token.
const ROTATION_REPLAY_GRACE_MS = 15 * 1000;

function rotateSessionRefreshToken(session) {
  const refreshToken = generateSecureToken();
  session.previousTokenHashes = [
    ...(session.previousTokenHashes || []),
    { hash: session.refreshTokenHash, rotatedAt: new Date().toISOString() }
  ].slice(-5);
  session.refreshTokenHash = hashToken(refreshToken);
  markAuthStateDirty();
  return refreshToken;
}

function findSessionByRefreshToken(refreshToken) {
  const tokenHash = hashToken(refreshToken);
  return store.sessions.find(
    s => !s.revokedAt && s.refreshTokenHash === tokenHash && new Date(s.expiresAt) > new Date()
  ) || null;
}

// A rotated-out token being presented again usually means the token was
// stolen at some point — the caller must treat every session of that user as
// compromised (unless it's within the concurrency grace window).
function findSessionByRotatedToken(refreshToken) {
  const tokenHash = hashToken(refreshToken);
  return store.sessions.find(
    s =>
      Array.isArray(s.previousTokenHashes) &&
      s.previousTokenHashes.some(entry => (typeof entry === "string" ? entry : entry.hash) === tokenHash)
  ) || null;
}

// True when this rotated-out token was retired only moments ago — almost
// certainly two tabs refreshing in parallel, not an attacker replaying a
// stolen token hours later.
function isRecentTokenRotation(session, refreshToken) {
  const tokenHash = hashToken(refreshToken);
  const entry = (session.previousTokenHashes || [])
    .find(e => (typeof e === "string" ? e : e.hash) === tokenHash);
  if (!entry || typeof entry === "string" || !entry.rotatedAt) return false;
  return Date.now() - new Date(entry.rotatedAt).getTime() < ROTATION_REPLAY_GRACE_MS;
}

function revokeSession(sessionId) {
  const session = store.sessions.find(s => s.id === sessionId);
  if (session && !session.revokedAt) {
    session.revokedAt = new Date().toISOString();
    markAuthStateDirty();
  }
}

function revokeAllSessions(userId, exceptSessionId) {
  let changed = false;
  store.sessions.forEach(s => {
    if (s.userId === userId && s.id !== exceptSessionId && !s.revokedAt) {
      s.revokedAt = new Date().toISOString();
      changed = true;
    }
  });
  if (changed) markAuthStateDirty();
}

function getProfile(user) {
  switch (user.roleSlug) {
    case "driver":
      return store.driverProfiles.find(p => p.userId === user.id);
    case "dispatcher":
      return store.dispatcherProfiles.find(p => p.userId === user.id);
    case "hospital_admin":
      return store.hospitalAdminProfiles.find(p => p.userId === user.id);
    case "hospital_doctor":
    case "hospital_reception":
    case "hospital_staff":
      return store.hospitalStaffProfiles.find(p => p.userId === user.id);
    case "super_admin":
      return store.superAdminProfiles.find(p => p.userId === user.id);
    case "customer":
      return store.customerProfiles.find(p => p.userId === user.id);
    case "fleet_owner":
      return store.fleetOwnerProfiles.find(p => p.userId === user.id);
    default:
      return null;
  }
}

function sanitizeUser(user) {
  const role = ROLES.find(r => r.id === user.roleId);
  return {
    id: user.id,
    role: role?.slug,
    roleName: role?.name,
    employeeId: user.employeeId,
    email: user.email,
    phone: user.phone,
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
    mfaEnabled: user.mfaEnabled,
    status: user.status,
    preferredLanguage: user.preferredLanguage,
    theme: user.theme,
    lastLoginAt: user.lastLoginAt,
    permissions: ROLE_PERMISSIONS[role?.slug] || []
  };
}

let seeded = Promise.resolve();

// Demo accounts are OFF by default. The old behaviour — seeding a full staff
// roster, including a super admin, whenever NODE_ENV wasn't "production" —
// meant one forgotten env var on a deployed box gave the world super-admin
// access with a publicly documented password. Now demo data only exists when
// someone explicitly opts in with ENABLE_DEMO_ACCOUNTS=true on a non-production
// run, and never when users were restored from PostgreSQL (a restart must not
// duplicate or resurrect demo rows).
// Used by persist.js so id counters survive restarts (ids must never go
// backwards after hydration, hence the Math.max guards).
function snapshotAuthCounters() {
  return {
    nextUserId,
    nextOtpId,
    nextAuditId,
    nextLoginId,
    nextAddressId,
    nextEmergencyId,
    nextDocumentId
  };
}

function restoreAuthCounter(key, value) {
  const v = Number(value || 0);
  if (!Number.isFinite(v) || v <= 0) return;
  switch (key) {
    case "nextUserId": nextUserId = Math.max(nextUserId, v); break;
    case "nextOtpId": nextOtpId = Math.max(nextOtpId, v); break;
    case "nextAuditId": nextAuditId = Math.max(nextAuditId, v); break;
    case "nextLoginId": nextLoginId = Math.max(nextLoginId, v); break;
    case "nextAddressId": nextAddressId = Math.max(nextAddressId, v); break;
    case "nextEmergencyId": nextEmergencyId = Math.max(nextEmergencyId, v); break;
    case "nextDocumentId": nextDocumentId = Math.max(nextDocumentId, v); break;
    default: break;
  }
}

function maybeSeedDemoUsers() {
  const wantsDemo = String(process.env.ENABLE_DEMO_ACCOUNTS || "").toLowerCase() === "true";
  if (!wantsDemo) {
    if (process.env.NODE_ENV !== "production") {
      console.log("[HindCare] Demo accounts disabled (set ENABLE_DEMO_ACCOUNTS=true to enable).");
    }
    seeded = Promise.resolve();
    return seeded;
  }
  if (process.env.NODE_ENV === "production") {
    console.warn("[HindCare] ENABLE_DEMO_ACCOUNTS is ignored while NODE_ENV=production.");
    seeded = Promise.resolve();
    return seeded;
  }
  if (store.users.length > 0) {
    console.log("[HindCare] Existing accounts found in persistent store — skipping demo seed.");
    seeded = Promise.resolve();
    return seeded;
  }
  console.warn(
    "[HindCare] Seeding DEMO accounts with a shared password. Never enable this on an\n" +
    "           internet-facing deployment. Disable by removing ENABLE_DEMO_ACCOUNTS."
  );
  seeded = seedDemoUsers().then(() => markAuthStateDirty());
  return seeded;
}

module.exports = {
  store,
  ROLES,
  ROLE_PERMISSIONS,
  seeded,
  maybeSeedDemoUsers,
  getRoleBySlug,
  findUserById,
  findUserByEmail,
  findUserByPhone,
  findUserByEmployeeId,
  normalizePhone,
  isAccountLocked,
  recordLoginAttempt,
  recordAudit,
  registerFailedLogin,
  resetFailedLogins,
  createOtp,
  verifyOtpRecord,
  createResetToken,
  verifyResetToken,
  createSession,
  rotateSessionRefreshToken,
  findSessionByRefreshToken,
  findSessionByRotatedToken,
  isRecentTokenRotation,
  revokeSession,
  revokeAllSessions,
  getProfile,
  attachProfile,
  sanitizeUser,
  hashPassword,
  verifyPassword,
  nextUserId: () => nextUserId++,
  nextAddressId: () => nextAddressId++,
  nextEmergencyId: () => nextEmergencyId++,
  nextDocumentId: () => nextDocumentId++
};
