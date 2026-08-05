const {
  findUserById,
  getProfile,
  sanitizeUser,
  store,
  nextAddressId,
  nextEmergencyId,
  nextMedicalId,
  nextAllergyId,
  nextInsuranceId,
  nextLocationId,
  nextPaymentId,
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
    if (!body.imageData || !String(body.imageData).startsWith("data:image/")) {
      sendJson(req, res, 400, { error: "Valid base64 image required" });
      return true;
    }

    profile.profilePhotoUrl = body.imageData;
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

  // ---- Medical info ----
  if (req.method === "GET" && url.pathname === "/api/profile/medical") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;
    sendJson(req, res, 200, {
      conditions: store.medicalInfo.filter(m => m.userId === auth.user.id),
      allergies: store.allergies.filter(a => a.userId === auth.user.id)
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/profile/medical/conditions") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    const body = await parseBody(req);
    const condition = {
      id: nextMedicalId(),
      userId: auth.user.id,
      conditionName: String(body.conditionName).trim(),
      severity: body.severity || "moderate",
      notes: body.notes || null,
      diagnosedAt: body.diagnosedAt || null,
      createdAt: new Date().toISOString()
    };
    store.medicalInfo.push(condition);
    sendJson(req, res, 201, condition);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/profile/medical/allergies") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    const body = await parseBody(req);
    const allergy = {
      id: nextAllergyId(),
      userId: auth.user.id,
      allergen: String(body.allergen).trim(),
      reaction: body.reaction || null,
      severity: body.severity || "moderate",
      createdAt: new Date().toISOString()
    };
    store.allergies.push(allergy);
    sendJson(req, res, 201, allergy);
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
    profile.liveStatus = body.status;
    profile.updatedAt = new Date().toISOString();
    sendJson(req, res, 200, { liveStatus: profile.liveStatus });
    return true;
  }

  // ---- Delete account ----
  if (req.method === "DELETE" && url.pathname === "/api/profile/account") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    if (!["customer"].includes(auth.user.roleSlug)) {
      sendJson(req, res, 403, { error: "Account deletion not available for this role. Contact administrator." });
      return true;
    }

    auth.user.status = "deleted";
    auth.user.deletedAt = new Date().toISOString();
    auditAction(req, auth.user.id, "account.deleted", "user", auth.user.id);
    sendJson(req, res, 200, { message: "Account scheduled for deletion" });
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

  if (roleSlug === "customer") {
    data.medicalConditions = store.medicalInfo.filter(m => m.userId === userId);
    data.allergies = store.allergies.filter(a => a.userId === userId);
    data.insurance = store.insurance.filter(i => i.userId === userId);
    data.savedLocations = store.savedLocations.filter(l => l.userId === userId);
    data.paymentMethods = store.paymentMethods.filter(p => p.userId === userId);
    data.documents = store.documents.filter(d => d.userId === userId);
    data.favouriteHospitals = store.favouriteHospitals.filter(f => f.userId === userId);
  }

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
    customer: [...common, "fullName", "gender", "dateOfBirth", "bloodGroup", "heightCm", "weightKg", "languagePreference", "notificationEmail", "notificationSms", "notificationPush", "privacyShareLocation", "privacyShareMedical"],
    driver: [...common, "fullName", "emergencyContactName", "emergencyContactPhone", "languages"],
    dispatcher: [...common, "fullName"],
    hospital_admin: [...common, "adminName", "phone", "gstNumber", "notificationEmail", "notificationSms"],
    super_admin: [...common, "fullName", "organizationName"]
  };
  return map[roleSlug] || common;
}

module.exports = { handleProfileRoutes };
