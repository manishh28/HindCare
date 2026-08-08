const {
  verifyJwt,
  signJwt,
  ACCESS_TOKEN_TTL_SEC,
  passwordStrength
} = require("./crypto");
const {
  findUserById,
  sanitizeUser,
  ROLE_PERMISSIONS,
  isAccountLocked,
  recordAudit,
  store
} = require("./store");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{6,17}$/;
const EMPLOYEE_ID_PATTERN = /^[A-Z]{2,4}-[0-9]{4,6}$/i;

function extractBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function getRequestMeta(req) {
  return {
    ip: req.socket?.remoteAddress || null,
    userAgent: req.headers["user-agent"] || null
  };
}

function authenticate(req) {
  const token = extractBearerToken(req);
  if (!token) return null;
  try {
    const payload = verifyJwt(token);
    const user = findUserById(payload.sub);
    if (!user || user.status === "deleted" || user.status === "suspended") return null;
    if (isAccountLocked(user)) return null;

    if (payload.sid) {
      const session = store.sessions.find(s => s.id === payload.sid);
      if (!session || session.revokedAt || new Date(session.expiresAt) <= new Date()) {
        return null;
      }
    }

    return { user, payload, sessionId: payload.sid };
  } catch {
    return null;
  }
}

function requireAuth(req, res, sendJson) {
  const auth = authenticate(req);
  if (!auth) {
    sendJson(req, res, 401, {
      error: "Authentication required",
      code: "AUTH_REQUIRED"
    });
    return null;
  }
  return auth;
}

function requireRoles(allowedRoles) {
  return (req, res, sendJson) => {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return null;
    if (!allowedRoles.includes(auth.user.roleSlug)) {
      sendJson(req, res, 403, {
        error: "Access denied for your role",
        code: "ACCESS_DENIED",
        requiredRoles: allowedRoles
      });
      return null;
    }
    return auth;
  };
}

function requirePermission(permission) {
  return (req, res, sendJson) => {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return null;
    const perms = ROLE_PERMISSIONS[auth.user.roleSlug] || [];
    if (!perms.includes(permission)) {
      sendJson(req, res, 403, {
        error: "Insufficient permissions",
        code: "PERMISSION_DENIED",
        requiredPermission: permission
      });
      return null;
    }
    return auth;
  };
}

function issueTokens(user, sessionId) {
  const accessToken = signJwt(
    { sub: user.id, role: user.roleSlug, sid: sessionId },
    ACCESS_TOKEN_TTL_SEC
  );
  return {
    accessToken,
    expiresIn: ACCESS_TOKEN_TTL_SEC,
    tokenType: "Bearer"
  };
}

function validateEmail(email) {
  return EMAIL_PATTERN.test(String(email || "").trim());
}

function validatePhone(phone) {
  return PHONE_PATTERN.test(String(phone || "").trim());
}

function validateEmployeeId(id) {
  return EMPLOYEE_ID_PATTERN.test(String(id || "").trim());
}

function validatePassword(password) {
  const strength = passwordStrength(password);
  if (!strength.checks.length) return { ok: false, error: "Password must be at least 8 characters" };
  if (!strength.checks.uppercase || !strength.checks.lowercase) {
    return { ok: false, error: "Password must include uppercase and lowercase letters" };
  }
  if (!strength.checks.number) return { ok: false, error: "Password must include a number" };
  if (!strength.checks.special) return { ok: false, error: "Password must include a special character" };
  return { ok: true, strength };
}

function auditAction(req, userId, action, resourceType, resourceId, metadata) {
  const meta = getRequestMeta(req);
  recordAudit(userId, action, resourceType, resourceId, { ...meta, metadata });
}

module.exports = {
  extractBearerToken,
  getRequestMeta,
  authenticate,
  requireAuth,
  requireRoles,
  requirePermission,
  issueTokens,
  validateEmail,
  validatePhone,
  validateEmployeeId,
  validatePassword,
  auditAction,
  EMAIL_PATTERN,
  PHONE_PATTERN
};
