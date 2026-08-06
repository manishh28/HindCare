const {
  ROLES,
  getRoleBySlug,
  findUserById,
  findUserByEmail,
  findUserByPhone,
  findUserByEmployeeId,
  normalizePhone,
  isAccountLocked,
  recordLoginAttempt,
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
  sanitizeUser,
  getProfile,
  hashPassword,
  verifyPassword,
  store
} = require("./store");

const {
  getRequestMeta,
  requireAuth,
  issueTokens,
  validateEmail,
  validatePhone,
  validateEmployeeId,
  validatePassword,
  auditAction,
  passwordStrength
} = require("./middleware");

const { passwordStrength: calcStrength } = require("./crypto");

// Rate limiting (in-memory, per IP)
const rateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX = 20;

function checkRateLimit(key) {
  const now = Date.now();
  const entry = rateLimits.get(key) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }
  entry.count += 1;
  rateLimits.set(key, entry);
  return entry.count <= RATE_LIMIT_MAX;
}

async function handleAuthRoutes(req, res, url, parseBody, sendJson) {
  const meta = getRequestMeta(req);
  const ipKey = meta.ip || "unknown";

  // ---- Public: roles list ----
  if (req.method === "GET" && url.pathname === "/api/auth/roles") {
    sendJson(req, res, 200, ROLES.map(r => ({
      slug: r.slug,
      name: r.name,
      mfaRequired: r.mfaRequired
    })));
    return true;
  }

  // ---- Login (role-aware) ----
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    if (!checkRateLimit(`login:${ipKey}`)) {
      sendJson(req, res, 429, { error: "Too many login attempts", code: "RATE_LIMITED" });
      return true;
    }

    const body = await parseBody(req);
    const roleSlug = String(body.role || "").toLowerCase();
    const role = getRoleBySlug(roleSlug);
    if (!role) {
      sendJson(req, res, 400, { error: "Invalid role", code: "INVALID_ROLE" });
      return true;
    }

    let user = null;
    let method = "password";

    if (roleSlug === "driver") {
      if (body.loginMethod === "otp") {
        method = "otp";
        user = findUserByPhone(body.phone);
      } else {
        user = findUserByEmployeeId(body.employeeId);
        if (user && body.phone) {
          const phoneUser = findUserByPhone(body.phone);
          if (!phoneUser || phoneUser.id !== user.id) user = null;
        }
      }
    } else if (roleSlug === "dispatcher") {
      user = findUserByEmployeeId(body.employeeId);
    } else if (roleSlug === "hospital_admin") {
      user = findUserByEmail(body.email);
    } else if (roleSlug === "super_admin") {
      user = findUserByEmail(body.email);
    }

    if (!user || user.roleSlug !== roleSlug) {
      recordLoginAttempt(null, false, method, { ...meta, failureReason: "invalid_credentials" });
      sendJson(req, res, 401, { error: "Invalid credentials", code: "INVALID_CREDENTIALS" });
      return true;
    }

    if (isAccountLocked(user)) {
      recordLoginAttempt(user.id, false, method, { ...meta, failureReason: "account_locked" });
      sendJson(req, res, 423, {
        error: "Account is locked due to too many failed attempts",
        code: "ACCOUNT_LOCKED",
        lockedUntil: user.lockedUntil
      });
      return true;
    }

    if (method === "otp") {
      const phone = normalizePhone(body.phone);
      const otpCheck = verifyOtpRecord(phone, "login", body.otp);
      if (!otpCheck.ok) {
        await registerFailedLogin(user);
        recordLoginAttempt(user.id, false, "otp", { ...meta, failureReason: otpCheck.error });
        sendJson(req, res, 401, { error: otpCheck.error, code: "INVALID_OTP" });
        return true;
      }
    } else {
      const valid = await verifyPassword(body.password, user.passwordHash);
      if (!valid) {
        await registerFailedLogin(user);
        recordLoginAttempt(user.id, false, "password", { ...meta, failureReason: "invalid_password" });
        sendJson(req, res, 401, { error: "Invalid credentials", code: "INVALID_CREDENTIALS" });
        return true;
      }
    }

    if ((role.mfaRequired || user.mfaEnabled) && !body.mfaCode) {
      const mfaOtp = createOtp({ userId: user.id, channel: "email", destination: user.email, purpose: "mfa" });
      sendJson(req, res, 200, {
        requiresMfa: true,
        message: "Multi-factor authentication required",
        demoOtp: mfaOtp._plainOtp,
        note: "Demo only — MFA OTP returned for local testing"
      });
      return true;
    }

    if (body.mfaCode) {
      const mfaCheck = verifyOtpRecord(user.email, "mfa", body.mfaCode);
      if (!mfaCheck.ok) {
        sendJson(req, res, 401, { error: "Invalid MFA code", code: "INVALID_MFA" });
        return true;
      }
    }

    await resetFailedLogins(user);
    user.lastLoginAt = new Date().toISOString();
    user.updatedAt = new Date().toISOString();

    const session = createSession(user.id, {
      deviceName: body.deviceName || "Web Browser",
      ip: meta.ip,
      userAgent: meta.userAgent
    });

    const tokens = issueTokens(user, session.id);
    recordLoginAttempt(user.id, true, method, meta);
    auditAction(req, user.id, "user.login", "session", session.id);

    const profile = getProfile(user);
    const redirectMap = {
      driver: "/profile/#driver",
      dispatcher: "/profile/#dispatcher",
      hospital_admin: "/profile/#hospital-admin",
      super_admin: "/profile/#super-admin"
    };

    sendJson(req, res, 200, {
      ...tokens,
      refreshToken: session._plainRefreshToken,
      user: sanitizeUser(user),
      profile: sanitizeProfile(profile, user.roleSlug),
      redirectTo: redirectMap[user.roleSlug] || "/"
    });
    return true;
  }

  // ---- Send OTP ----
  if (req.method === "POST" && url.pathname === "/api/auth/otp/send") {
    if (!checkRateLimit(`otp:${ipKey}`)) {
      sendJson(req, res, 429, { error: "Too many OTP requests", code: "RATE_LIMITED" });
      return true;
    }

    const body = await parseBody(req);
    const purpose = body.purpose || "login";
    const channel = body.channel || "phone";
    let destination = body.destination || body.phone || body.email;

    if (channel === "phone") destination = normalizePhone(destination);
    if (channel === "email") destination = String(destination).trim().toLowerCase();

    if (!destination) {
      sendJson(req, res, 400, { error: "Destination required", code: "MISSING_DESTINATION" });
      return true;
    }

    const user = channel === "email" ? findUserByEmail(destination) : findUserByPhone(destination);
    const otp = createOtp({ userId: user?.id, channel, destination, purpose });

    sendJson(req, res, 200, {
      message: `OTP sent to ${channel === "phone" ? "phone" : "email"}`,
      expiresIn: 300,
      resendAvailableIn: 30,
      demoOtp: otp._plainOtp,
      note: "Demo only — OTP returned for local testing"
    });
    return true;
  }

  // ---- Verify OTP ----
  if (req.method === "POST" && url.pathname === "/api/auth/otp/verify") {
    const body = await parseBody(req);
    const purpose = body.purpose || "verify_phone";
    let destination = body.destination || body.phone || body.email;
    if (body.channel === "email" || purpose.includes("email")) {
      destination = String(destination).trim().toLowerCase();
    } else {
      destination = normalizePhone(destination);
    }

    const result = verifyOtpRecord(destination, purpose, body.otp);
    if (!result.ok) {
      sendJson(req, res, 400, { error: result.error, code: "OTP_VERIFICATION_FAILED" });
      return true;
    }

    if (result.record.userId) {
      const user = findUserById(result.record.userId);
      if (user) {
        if (purpose === "verify_email") user.emailVerified = true;
        if (purpose === "verify_phone") user.phoneVerified = true;
        if (user.status === "pending" && user.emailVerified && user.phoneVerified) {
          user.status = "active";
        }
        user.updatedAt = new Date().toISOString();
      }
    }

    sendJson(req, res, 200, { message: "OTP verified successfully", verified: true });
    return true;
  }

  // ---- Forgot Password ----
  if (req.method === "POST" && url.pathname === "/api/auth/forgot-password") {
    const body = await parseBody(req);
    const identifier = String(body.email || body.phone || "").trim();
    const user = validateEmail(identifier) ? findUserByEmail(identifier) : findUserByPhone(identifier);

    if (user) {
      const reset = createResetToken(user.id);
      auditAction(req, user.id, "password.reset_requested", "user", user.id);
      sendJson(req, res, 200, {
        message: "If an account exists, reset instructions have been sent",
        demoResetToken: reset._plainToken,
        note: "Demo only — reset token returned for local testing"
      });
    } else {
      sendJson(req, res, 200, { message: "If an account exists, reset instructions have been sent" });
    }
    return true;
  }

  // ---- Reset Password ----
  if (req.method === "POST" && url.pathname === "/api/auth/reset-password") {
    const body = await parseBody(req);
    const reset = verifyResetToken(body.token);
    if (!reset) {
      sendJson(req, res, 400, { error: "Invalid or expired reset token", code: "INVALID_TOKEN" });
      return true;
    }

    const pwdCheck = validatePassword(body.password);
    if (!pwdCheck.ok) {
      sendJson(req, res, 400, { error: pwdCheck.error, code: "WEAK_PASSWORD" });
      return true;
    }

    const user = findUserById(reset.userId);
    user.passwordHash = await hashPassword(body.password);
    user.passwordChangedAt = new Date().toISOString();
    user.updatedAt = new Date().toISOString();
    reset.usedAt = new Date().toISOString();
    revokeAllSessions(user.id);

    auditAction(req, user.id, "password.reset_completed", "user", user.id);
    sendJson(req, res, 200, { message: "Password reset successfully" });
    return true;
  }

  // ---- Change Password (authenticated) ----
  if (req.method === "POST" && url.pathname === "/api/auth/change-password") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    const body = await parseBody(req);
    const user = auth.user;
    const valid = await verifyPassword(body.currentPassword, user.passwordHash);
    if (!valid) {
      sendJson(req, res, 401, { error: "Current password is incorrect", code: "INVALID_PASSWORD" });
      return true;
    }

    const pwdCheck = validatePassword(body.newPassword);
    if (!pwdCheck.ok) {
      sendJson(req, res, 400, { error: pwdCheck.error, code: "WEAK_PASSWORD" });
      return true;
    }

    user.passwordHash = await hashPassword(body.newPassword);
    user.passwordChangedAt = new Date().toISOString();
    user.updatedAt = new Date().toISOString();
    auditAction(req, user.id, "password.changed", "user", user.id);

    sendJson(req, res, 200, { message: "Password changed successfully" });
    return true;
  }

  // ---- Refresh Token ----
  if (req.method === "POST" && url.pathname === "/api/auth/refresh") {
    const body = await parseBody(req);
    const session = findSessionByRefreshToken(body.refreshToken);
    if (!session) {
      sendJson(req, res, 401, { error: "Invalid or expired refresh token", code: "SESSION_EXPIRED" });
      return true;
    }

    const user = findUserById(session.userId);
    if (!user || isAccountLocked(user)) {
      sendJson(req, res, 401, { error: "Session invalid", code: "SESSION_EXPIRED" });
      return true;
    }

    const tokens = issueTokens(user, session.id);
    sendJson(req, res, 200, tokens);
    return true;
  }

  // ---- Logout ----
  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    if (auth.sessionId) revokeSession(auth.sessionId);
    auditAction(req, auth.user.id, "user.logout", "session", auth.sessionId);
    sendJson(req, res, 200, { message: "Logged out successfully" });
    return true;
  }

  // ---- Logout All Sessions ----
  if (req.method === "POST" && url.pathname === "/api/auth/logout-all") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    revokeAllSessions(auth.user.id, auth.sessionId);
    auditAction(req, auth.user.id, "user.logout_all", "user", auth.user.id);
    sendJson(req, res, 200, { message: "All other sessions revoked" });
    return true;
  }

  // ---- Current User ----
  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    const profile = getProfile(auth.user);
    sendJson(req, res, 200, {
      user: sanitizeUser(auth.user),
      profile: sanitizeProfile(profile, auth.user.roleSlug)
    });
    return true;
  }

  // ---- Active Sessions ----
  if (req.method === "GET" && url.pathname === "/api/auth/sessions") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    const sessions = store.sessions
      .filter(s => s.userId === auth.user.id && !s.revokedAt && new Date(s.expiresAt) > new Date())
      .map(s => ({
        id: s.id,
        deviceName: s.deviceName,
        ipAddress: s.ipAddress,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        current: s.id === auth.sessionId
      }));

    sendJson(req, res, 200, sessions);
    return true;
  }

  // ---- Login History ----
  if (req.method === "GET" && url.pathname === "/api/auth/login-history") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    const history = store.loginHistory
      .filter(h => h.userId === auth.user.id)
      .slice(-20)
      .reverse();

    sendJson(req, res, 200, history);
    return true;
  }

  // ---- Password Strength Check ----
  if (req.method === "POST" && url.pathname === "/api/auth/password-strength") {
    const body = await parseBody(req);
    sendJson(req, res, 200, calcStrength(body.password || ""));
    return true;
  }

  // ---- Google OAuth stub ----
  if (req.method === "POST" && url.pathname === "/api/auth/google") {
    sendJson(req, res, 501, {
      error: "Google OAuth requires production configuration",
      code: "OAUTH_NOT_CONFIGURED",
      setupNote: "Configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in production"
    });
    return true;
  }

  return false;
}

function sanitizeProfile(profile, roleSlug) {
  if (!profile) return null;
  const { userId, createdAt, updatedAt, ...rest } = profile;
  return rest;
}

module.exports = { handleAuthRoutes };
