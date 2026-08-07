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

const ROLES = [
  { id: 1, slug: "driver", name: "Ambulance Driver", mfaRequired: false },
  { id: 2, slug: "dispatcher", name: "Dispatcher / Call Center", mfaRequired: false },
  { id: 3, slug: "hospital_admin", name: "Hospital Admin", mfaRequired: true },
  { id: 4, slug: "super_admin", name: "Super Admin", mfaRequired: true },
  { id: 5, slug: "customer", name: "Patient", mfaRequired: false }
];

const ROLE_PERMISSIONS = {
  driver: ["bookings.read", "bookings.update", "profile.read", "profile.update"],
  dispatcher: ["bookings.read", "bookings.update", "bookings.dispatch", "profile.read", "profile.update"],
  hospital_admin: ["bookings.read", "hospitals.manage", "ambulances.manage", "profile.read", "profile.update", "audit.read"],
  super_admin: ["bookings.read", "bookings.update", "bookings.dispatch", "hospitals.manage", "ambulances.manage", "users.manage", "audit.read", "system.configure", "profile.read", "profile.update"],
  customer: ["bookings.read", "profile.read", "profile.update"]
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
  superAdminProfiles: [],
  customerProfiles: [],
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
}

function attachProfile(user, profile) {
  const base = { userId: user.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  switch (user.roleSlug) {
    case "driver":
      store.driverProfiles.push({ ...base, profilePhotoUrl: null, languages: ["en", "hi"], emergencyContactName: "Sunita Singh", emergencyContactPhone: "+919111111112", currentShiftStart: null, currentShiftEnd: null, ...profile });
      break;
    case "dispatcher":
      store.dispatcherProfiles.push({ ...base, profilePhotoUrl: null, avgResponseSeconds: 45, ...profile });
      break;
    case "hospital_admin":
      store.hospitalAdminProfiles.push({ ...base, profilePhotoUrl: null, hospitalId: 1, notificationEmail: true, notificationSms: true, licenseExpiry: "2027-12-31", ...profile });
      break;
    case "super_admin":
      store.superAdminProfiles.push({ ...base, profilePhotoUrl: null, apiKeysEnabled: true, ...profile });
      break;
    case "customer":
      store.customerProfiles.push({ ...base, profilePhotoUrl: null, fullName: profile.fullName });
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
}

function getRoleBySlug(slug) {
  return ROLES.find(r => r.slug === slug);
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
  return String(phone || "").trim();
}

function isAccountLocked(user) {
  if (user.status === "locked") return true;
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) return true;
  return false;
}

function recordLoginAttempt(userId, success, method, meta = {}) {
  store.loginHistory.push({
    id: nextLoginId++,
    userId,
    success,
    method,
    ipAddress: meta.ip || null,
    userAgent: meta.userAgent || null,
    failureReason: meta.failureReason || null,
    createdAt: new Date().toISOString()
  });
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
}

async function registerFailedLogin(user) {
  user.failedLoginAttempts += 1;
  if (user.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
    user.status = "locked";
    user.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
  }
  user.updatedAt = new Date().toISOString();
}

async function resetFailedLogins(user) {
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  if (user.status === "locked") user.status = "active";
  user.updatedAt = new Date().toISOString();
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
  if (hashToken(otp) !== record.otpHash) return { ok: false, error: "Invalid OTP" };
  record.verifiedAt = new Date().toISOString();
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
    deviceName: meta.deviceName || "Unknown device",
    ipAddress: meta.ip || null,
    userAgent: meta.userAgent || null,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    revokedAt: null,
    createdAt: new Date().toISOString(),
    _plainRefreshToken: refreshToken
  };
  store.sessions.push(session);
  return session;
}

function findSessionByRefreshToken(refreshToken) {
  return store.sessions.find(
    s => !s.revokedAt && s.refreshTokenHash === hashToken(refreshToken) && new Date(s.expiresAt) > new Date()
  );
}

function revokeSession(sessionId) {
  const session = store.sessions.find(s => s.id === sessionId);
  if (session) session.revokedAt = new Date().toISOString();
}

function revokeAllSessions(userId, exceptSessionId) {
  store.sessions.forEach(s => {
    if (s.userId === userId && s.id !== exceptSessionId && !s.revokedAt) {
      s.revokedAt = new Date().toISOString();
    }
  });
}

function getProfile(user) {
  switch (user.roleSlug) {
    case "driver":
      return store.driverProfiles.find(p => p.userId === user.id);
    case "dispatcher":
      return store.dispatcherProfiles.find(p => p.userId === user.id);
    case "hospital_admin":
      return store.hospitalAdminProfiles.find(p => p.userId === user.id);
    case "super_admin":
      return store.superAdminProfiles.find(p => p.userId === user.id);
    case "customer":
      return store.customerProfiles.find(p => p.userId === user.id);
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

const seeded = seedDemoUsers();

module.exports = {
  store,
  ROLES,
  ROLE_PERMISSIONS,
  seeded,
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
  findSessionByRefreshToken,
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
