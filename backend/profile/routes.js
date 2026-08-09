const {
  findUserById,
  getProfile,
  sanitizeUser,
  store,
  nextAddressId,
  nextEmergencyId,
  nextDocumentId
} = require("../auth/store");

const { requireAuth, auditAction } = require("../auth/middleware");

async function handleProfileRoutes(req, res, url, parseBody, sendJson) {
  // ---- Get full profile ----
  if (req.method === "GET" && url.pathname === "/api/profile") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    const profile = getProfile(auth.user);
    const related = getRelatedData(auth.user.id, auth.user.roleSlug);

    sendJson(req, res, 200, {
      user: sanitizeUser(auth.user),
      profile,
      ...related
    });
    return true;
  }

  // ---- Update profile ----
  if (req.method === "PATCH" && url.pathname === "/api/profile") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    const body = await parseBody(req);
    const profile = getProfile(auth.user);
    if (!profile) {
      sendJson(req, res, 404, { error: "Profile not found" });
      return true;
    }

    const allowedFields = getEditableFields(auth.user.roleSlug);
    let updated = false;
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        profile[field] = body[field];
        updated = true;
      }
    }

    if (body.preferredLanguage) auth.user.preferredLanguage = body.preferredLanguage;
    if (body.theme && ["light", "dark", "system"].includes(body.theme)) auth.user.theme = body.theme;

    profile.updatedAt = new Date().toISOString();
    auth.user.updatedAt = new Date().toISOString();

    if (updated) auditAction(req, auth.user.id, "profile.updated", "profile", auth.user.id);

    sendJson(req, res, 200, { profile, user: sanitizeUser(auth.user) });
    return true;
  }

  // ---- Upload profile photo (base64 demo) ----
  if (req.method === "POST" && url.pathname === "/api/profile/photo") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    const body = await parseBody(req);
    const profile = getProfile(auth.user);
    const imageData = String(body.imageData || "");

    // Only safe raster formats — deliberately NOT svg+xml, which can embed
    // <script> tags and event handlers. Browsers mostly (but not always,
    // and not in every future context this data URI might end up in)
    // sandbox scripts inside <img>-rendered SVGs, so this shouldn't be the
    // only thing standing between an upload and script execution.
    const allowedPrefixes = ["data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,", "data:image/gif;base64,"];
    if (!allowedPrefixes.some(prefix => imageData.startsWith(prefix))) {
      sendJson(req, res, 400, { error: "Image must be a PNG, JPEG, WEBP, or GIF." });
      return true;
    }
    if (imageData.length > 1_400_000) { // ~1MB of actual image data once base64 overhead is accounted for
      sendJson(req, res, 400, { error: "Image is too large. Please use a smaller photo." });
      return true;
    }

    profile.profilePhotoUrl = imageData;
    profile.updatedAt = new Date().toISOString();
    auditAction(req, auth.user.id, "profile.photo_updated", "profile", auth.user.id);

    sendJson(req, res, 200, { profilePhotoUrl: profile.profilePhotoUrl });
    return true;
  }

  // ---- Remove profile photo ----
  if (req.method === "DELETE" && url.pathname === "/api/profile/photo") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    const profile = getProfile(auth.user);
    profile.profilePhotoUrl = null;
    profile.updatedAt = new Date().toISOString();
    sendJson(req, res, 200, { message: "Photo removed" });
    return true;
  }

  // ---- Emergency contacts ----
  if (req.method === "GET" && url.pathname === "/api/profile/emergency-contacts") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;
    sendJson(req, res, 200, store.emergencyContacts.filter(c => c.userId === auth.user.id));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/profile/emergency-contacts") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    const body = await parseBody(req);
    const contact = {
      id: nextEmergencyId(),
      userId: auth.user.id,
      name: String(body.name).trim(),
      relationship: String(body.relationship).trim(),
      phone: String(body.phone).trim(),
      isPrimary: Boolean(body.isPrimary)
    };
    store.emergencyContacts.push(contact);
    sendJson(req, res, 201, contact);
    return true;
  }

  // ---- Addresses ----
  if (req.method === "GET" && url.pathname === "/api/profile/addresses") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;
    sendJson(req, res, 200, store.addresses.filter(a => a.userId === auth.user.id));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/profile/addresses") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    const body = await parseBody(req);
    const address = {
      id: nextAddressId(),
      userId: auth.user.id,
      label: body.label || "home",
      line1: String(body.line1).trim(),
      line2: body.line2 || null,
      city: String(body.city).trim(),
      state: String(body.state).trim(),
      pincode: String(body.pincode).trim(),
      country: body.country || "India",
      lat: body.lat || null,
      lng: body.lng || null,
      isDefault: Boolean(body.isDefault),
      createdAt: new Date().toISOString()
    };
    store.addresses.push(address);
    sendJson(req, res, 201, address);
    return true;
  }

  // ---- Notification preferences ----
  if (req.method === "GET" && url.pathname === "/api/profile/notifications") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;
    const prefs = store.notificationPrefs.find(p => p.userId === auth.user.id);
    sendJson(req, res, 200, prefs || {});
    return true;
  }

  if (req.method === "PATCH" && url.pathname === "/api/profile/notifications") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    const body = await parseBody(req);
    let prefs = store.notificationPrefs.find(p => p.userId === auth.user.id);
    if (!prefs) {
      prefs = { userId: auth.user.id };
      store.notificationPrefs.push(prefs);
    }
    Object.assign(prefs, body, { updatedAt: new Date().toISOString() });
    sendJson(req, res, 200, prefs);
    return true;
  }

  // ---- Driver availability ----
  if (req.method === "PATCH" && url.pathname === "/api/profile/availability") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    if (auth.user.roleSlug !== "driver") {
      sendJson(req, res, 403, { error: "Only drivers can update availability" });
      return true;
    }

    const body = await parseBody(req);
    const profile = getProfile(auth.user);
    const valid = ["available", "busy", "on_break", "offline"];
    if (!valid.includes(body.status)) {
      sendJson(req, res, 400, { error: `Status must be one of: ${valid.join(", ")}` });
      return true;
    }

    profile.availabilityStatus = body.status;
    profile.updatedAt = new Date().toISOString();
    sendJson(req, res, 200, { availabilityStatus: profile.availabilityStatus });
    return true;
  }

  // ---- Dispatcher live status ----
  if (req.method === "PATCH" && url.pathname === "/api/profile/live-status") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    if (auth.user.roleSlug !== "dispatcher") {
      sendJson(req, res, 403, { error: "Only dispatchers can update live status" });
      return true;
    }

    const body = await parseBody(req);
    const profile = getProfile(auth.user);
    const validStatuses = ["online", "on_break", "offline"];
    if (!validStatuses.includes(body.status)) {
      sendJson(req, res, 400, { error: `Status must be one of: ${validStatuses.join(", ")}` });
      return true;
    }
    profile.liveStatus = body.status;
    profile.updatedAt = new Date().toISOString();
    sendJson(req, res, 200, { liveStatus: profile.liveStatus });
    return true;
  }

  // ---- Delete account ----
  if (req.method === "DELETE" && url.pathname === "/api/profile/account") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    sendJson(req, res, 403, { error: "Account deletion isn't self-service for staff accounts. Contact an administrator." });
    return true;
  }

  // ---- Export personal data ----
  if (req.method === "GET" && url.pathname === "/api/profile/export") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    const data = {
      user: sanitizeUser(auth.user),
      profile: getProfile(auth.user),
      ...getRelatedData(auth.user.id, auth.user.roleSlug),
      exportedAt: new Date().toISOString()
    };
    auditAction(req, auth.user.id, "profile.data_exported", "user", auth.user.id);
    sendJson(req, res, 200, data);
    return true;
  }

  // ---- Audit logs (admin roles) ----
  if (req.method === "GET" && url.pathname === "/api/profile/audit-logs") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    if (!["hospital_admin", "super_admin"].includes(auth.user.roleSlug)) {
      sendJson(req, res, 403, { error: "Access denied" });
      return true;
    }

    const logs = store.auditLogs.slice(-50).reverse();
    sendJson(req, res, 200, logs);
    return true;
  }

  return false;
}

function getRelatedData(userId, roleSlug) {
  const data = {
    emergencyContacts: store.emergencyContacts.filter(c => c.userId === userId),
    addresses: store.addresses.filter(a => a.userId === userId),
    notificationPrefs: store.notificationPrefs.find(p => p.userId === userId)
  };

  if (roleSlug === "driver") {
    data.bankDetails = store.driverBankDetails.find(b => b.userId === userId) || null;
    data.documents = store.documents.filter(d => d.userId === userId);
  }

  if (roleSlug === "super_admin") {
    data.apiKeys = store.apiKeys.filter(k => k.userId === userId && !k.revokedAt);
    data.systemInfo = {
      version: "1.0.0",
      environment: process.env.NODE_ENV || "development",
      uptime: process.uptime(),
      backupStatus: "last_backup_2h_ago"
    };
  }

  return data;
}

function getEditableFields(roleSlug) {
  const common = ["profilePhotoUrl"];
  const map = {
    driver: [...common, "fullName", "emergencyContactName", "emergencyContactPhone", "languages"],
    dispatcher: [...common, "fullName"],
    hospital_admin: [...common, "adminName", "phone", "gstNumber", "notificationEmail", "notificationSms"],
    super_admin: [...common, "fullName", "organizationName"],
    customer: [...common, "fullName"]
  };
  return map[roleSlug] || common;
}

module.exports = { handleProfileRoutes };
