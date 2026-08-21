const {
  findUserById,
  findUserByEmail,
  findUserByPhone,
  getRoleBySlug,
  getProfile,
  attachProfile,
  hashPassword,
  normalizePhone,
  sanitizeUser,
  store,
  nextUserId,
  nextAddressId,
  nextEmergencyId,
  nextDocumentId
} = require("../auth/store");

const { requireAuth, auditAction, validateEmail, validatePhone, validatePassword } = require("../auth/middleware");

const HOSPITAL_SUB_ROLES = {
  doctor: "hospital_doctor",
  reception: "hospital_reception",
  staff: "hospital_staff"
};

async function handleProfileRoutes(req, res, url, parseBody, sendJson, db) {
  // ---- Get full profile ----
  if (req.method === "GET" && url.pathname === "/api/profile") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    const profile = getProfile(auth.user);
    const related = getRelatedData(auth.user.id, auth.user.roleSlug, db);

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
    const contactName = String(body.name || "").trim();
    const relationship = String(body.relationship || "").trim();
    const contactPhone = String(body.phone || "").trim();
    if (!contactName || !relationship || !validatePhone(contactPhone)) {
      sendJson(req, res, 400, { error: "Name, relationship, and a valid phone number are required." });
      return true;
    }
    const contact = {
      id: nextEmergencyId(),
      userId: auth.user.id,
      name: contactName.slice(0, 120),
      relationship: relationship.slice(0, 80),
      phone: contactPhone,
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
    const line1 = String(body.line1 || "").trim();
    const city = String(body.city || "").trim();
    const state = String(body.state || "").trim();
    const pincode = String(body.pincode || "").trim();
    if (!line1 || !city || !state || !/^\d{4,10}$/.test(pincode)) {
      sendJson(req, res, 400, { error: "Address, city, state, and a valid pincode are required." });
      return true;
    }
    const address = {
      id: nextAddressId(),
      userId: auth.user.id,
      label: String(body.label || "home").trim().slice(0, 40),
      line1: line1.slice(0, 250),
      line2: String(body.line2 || "").trim().slice(0, 250) || null,
      city: city.slice(0, 80),
      state: state.slice(0, 80),
      pincode,
      country: String(body.country || "India").trim().slice(0, 80),
      lat: Number.isFinite(Number(body.lat)) ? Number(body.lat) : null,
      lng: Number.isFinite(Number(body.lng)) ? Number(body.lng) : null,
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
    const allowedKeys = ["bookingUpdates", "securityAlerts", "shiftReminders", "systemMaintenance", "promotions"];
    allowedKeys.forEach(key => {
      if (body[key] !== undefined) prefs[key] = Boolean(body[key]);
    });
    prefs.updatedAt = new Date().toISOString();
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
      ...getRelatedData(auth.user.id, auth.user.roleSlug, db),
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

    const logs = store.auditLogs
      .filter(log => auth.user.roleSlug === "super_admin" || auditLogVisibleToHospital(log, auth.user))
      .slice(-50)
      .reverse();
    sendJson(req, res, 200, logs);
    return true;
  }

  // ---- Hospital team (hospital owner only) ----
  if (req.method === "GET" && url.pathname === "/api/profile/hospital-team") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    if (auth.user.roleSlug !== "hospital_admin") {
      sendJson(req, res, 403, { error: "Only hospital owners can manage hospital team accounts." });
      return true;
    }

    const ownerProfile = getProfile(auth.user);
    const team = getHospitalTeam(auth.user.id, ownerProfile?.hospitalId);
    sendJson(req, res, 200, team);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/profile/hospital-team") {
    const auth = requireAuth(req, res, sendJson);
    if (!auth) return true;

    if (auth.user.roleSlug !== "hospital_admin") {
      sendJson(req, res, 403, { error: "Only hospital owners can create hospital team accounts." });
      return true;
    }

    const ownerProfile = getProfile(auth.user);
    if (!ownerProfile?.hospitalId) {
      sendJson(req, res, 409, { error: "Register your hospital before adding team members." });
      return true;
    }

    const body = await parseBody(req);
    const teamRole = String(body.teamRole || "").trim().toLowerCase();
    const roleSlug = HOSPITAL_SUB_ROLES[teamRole];
    const missing = ["fullName", "email", "phone", "password", "teamRole"].filter(f => !String(body[f] || "").trim());
    if (missing.length) {
      sendJson(req, res, 400, { error: "Missing required fields", fields: missing });
      return true;
    }
    if (!roleSlug) {
      sendJson(req, res, 400, { error: "teamRole must be doctor, reception, or staff." });
      return true;
    }
    if (!validateEmail(body.email)) {
      sendJson(req, res, 400, { error: "Invalid email address" });
      return true;
    }
    if (!validatePhone(body.phone)) {
      sendJson(req, res, 400, { error: "Invalid phone number" });
      return true;
    }
    const pwdCheck = validatePassword(body.password);
    if (!pwdCheck.ok) {
      sendJson(req, res, 400, { error: pwdCheck.error, code: "WEAK_PASSWORD" });
      return true;
    }

    const email = String(body.email).trim().toLowerCase();
    const phone = normalizePhone(body.phone);
    if (findUserByEmail(email) || findUserByPhone(phone)) {
      sendJson(req, res, 409, { error: "A user with this email or phone already exists." });
      return true;
    }

    const role = getRoleBySlug(roleSlug);
    const userId = nextUserId();
    const user = {
      id: userId,
      roleId: role.id,
      roleSlug: role.slug,
      employeeId: `${teamRole.slice(0, 3).toUpperCase()}-${String(userId).padStart(4, "0")}`,
      email,
      phone,
      passwordHash: await hashPassword(body.password),
      emailVerified: false,
      phoneVerified: false,
      mfaEnabled: false,
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
    attachProfile(user, {
      fullName: String(body.fullName).trim().slice(0, 120),
      hospitalId: ownerProfile.hospitalId,
      hospitalOwnerId: auth.user.id,
      staffRole: teamRole,
      department: String(body.department || "").trim().slice(0, 80) || null,
      designation: String(body.designation || "").trim().slice(0, 80) || null
    });

    auditAction(req, auth.user.id, "hospital.team.created", "user", user.id, { role: roleSlug });
    sendJson(req, res, 201, getHospitalTeam(auth.user.id, ownerProfile.hospitalId).find(member => member.id === user.id));
    return true;
  }

  return false;
}

function getRelatedData(userId, roleSlug, db) {
  const data = {
    emergencyContacts: store.emergencyContacts.filter(c => c.userId === userId),
    addresses: store.addresses.filter(a => a.userId === userId),
    notificationPrefs: store.notificationPrefs.find(p => p.userId === userId)
  };

  if (roleSlug === "driver") {
    data.bankDetails = store.driverBankDetails.find(b => b.userId === userId) || null;
    data.documents = store.documents.filter(d => d.userId === userId);
    if (db) {
      const myAmbulance = db.ambulances.find(a => a.driverId === userId) || null;
      data.assignedAmbulance = myAmbulance;
      data.activeBooking = db.bookings.find(b =>
        ["assigned", "on_route"].includes(b.status) &&
        (b.assignedDriverId === userId || (myAmbulance && b.ambulanceId === myAmbulance.id))
      ) || null;
    }
  }

  if (roleSlug === "dispatcher" && db) {
    const activeStatuses = ["requested", "assigned", "on_route"];
    const dispatchBookings = db.bookings
      .filter(b => activeStatuses.includes(b.status))
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    data.dispatcherWorkspace = {
      bookings: dispatchBookings.map(booking => enrichBookingForWorkspace(booking, db)),
      ambulances: db.ambulances.map(ambulance => enrichAmbulanceForWorkspace(ambulance)),
      drivers: store.driverProfiles.map(profile => enrichDriverForWorkspace(profile)),
      completedToday: db.bookings.filter(b => b.status === "completed" && isToday(b.updatedAt || b.createdAt)).length
    };
  }

  if (roleSlug === "fleet_owner" && db) {
    const myAmbulances = db.ambulances.filter(a => a.ownerId === userId);
    data.fleet = myAmbulances;
    data.drivers = store.driverProfiles
      .filter(p => p.fleetOwnerId === userId)
      .map(p => {
        const driverUser = findUserById(p.userId);
        const assignedAmbulance = myAmbulances.find(a => a.driverId === p.userId) || null;
        return {
          id: p.userId,
          fullName: p.fullName,
          phone: driverUser ? driverUser.phone : null,
          availabilityStatus: p.availabilityStatus,
          assignedAmbulanceId: assignedAmbulance ? assignedAmbulance.id : null
        };
      });
  }

  if (isHospitalRole(roleSlug) && db) {
    const profile = getProfile({ id: userId, roleSlug });
    const myHospital = roleSlug === "hospital_admin"
      ? db.hospitals.find(h => h.ownerId === userId || h.id === profile?.hospitalId) || null
      : db.hospitals.find(h => h.id === profile?.hospitalId) || null;
    data.hospital = myHospital;
    if (["hospital_admin", "hospital_doctor", "hospital_reception"].includes(roleSlug)) {
      data.bookings = myHospital ? db.bookings.filter(b => b.hospitalId === myHospital.id).slice(-20).reverse() : [];
    }
    if (roleSlug === "hospital_admin") {
      data.hospitalTeam = getHospitalTeam(userId, myHospital?.id || profile?.hospitalId);
    }
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

function isToday(value) {
  const date = new Date(value);
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

function enrichDriverForWorkspace(profile) {
  if (!profile || !profile.userId) return null;
  const user = findUserById(profile.userId);
  return {
    id: profile.userId,
    fullName: profile.fullName,
    phone: user ? user.phone : null,
    availabilityStatus: profile.availabilityStatus,
    fleetOwnerId: profile.fleetOwnerId || null
  };
}

function enrichAmbulanceForWorkspace(ambulance) {
  const driver = ambulance.driverId
    ? enrichDriverForWorkspace(store.driverProfiles.find(p => p.userId === ambulance.driverId))
    : null;
  return {
    id: ambulance.id,
    registrationNumber: ambulance.registrationNumber,
    type: ambulance.type,
    status: ambulance.status,
    currentLat: ambulance.currentLat,
    currentLng: ambulance.currentLng,
    driverId: ambulance.driverId || null,
    driverName: driver?.fullName || ambulance.driverName || "Unassigned"
  };
}

function enrichBookingForWorkspace(booking, db) {
  const ambulance = booking.ambulanceId ? db.ambulances.find(a => a.id === booking.ambulanceId) : null;
  const driverProfile = booking.assignedDriverId
    ? store.driverProfiles.find(p => p.userId === booking.assignedDriverId)
    : ambulance?.driverId
      ? store.driverProfiles.find(p => p.userId === ambulance.driverId)
      : null;
  const driver = driverProfile ? enrichDriverForWorkspace(driverProfile) : null;
  return {
    ...booking,
    ambulance: ambulance ? enrichAmbulanceForWorkspace(ambulance) : null,
    driver
  };
}

function getEditableFields(roleSlug) {
  const common = ["profilePhotoUrl"];
  const map = {
    driver: [...common, "fullName", "emergencyContactName", "emergencyContactPhone", "languages"],
    dispatcher: [...common, "fullName"],
    hospital_admin: [...common, "adminName", "phone", "gstNumber", "notificationEmail", "notificationSms"],
    hospital_doctor: [...common, "fullName", "department", "designation"],
    hospital_reception: [...common, "fullName", "department", "designation"],
    hospital_staff: [...common, "fullName", "department", "designation"],
    super_admin: [...common, "fullName", "organizationName"],
    customer: [...common, "fullName"],
    fleet_owner: [...common, "fullName", "companyName"]
  };
  return map[roleSlug] || common;
}

function isHospitalRole(roleSlug) {
  return ["hospital_admin", "hospital_doctor", "hospital_reception", "hospital_staff"].includes(roleSlug);
}

function getHospitalTeam(ownerId, hospitalId) {
  return store.hospitalStaffProfiles
    .filter(profile => profile.hospitalOwnerId === ownerId || (hospitalId && profile.hospitalId === hospitalId))
    .map(profile => {
      const user = findUserById(profile.userId);
      if (!user) return null;
      return {
        id: user.id,
        role: user.roleSlug,
        roleName: sanitizeUser(user).roleName,
        employeeId: user.employeeId,
        fullName: profile.fullName,
        email: user.email,
        phone: user.phone,
        department: profile.department,
        designation: profile.designation,
        status: user.status,
        createdAt: user.createdAt
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

function auditLogVisibleToHospital(log, owner) {
  const profile = getProfile(owner);
  const hospitalId = profile?.hospitalId;
  if (!hospitalId) return log.userId === owner.id;

  const teamUserIds = new Set([
    owner.id,
    ...store.hospitalStaffProfiles
      .filter(member => member.hospitalId === hospitalId)
      .map(member => member.userId)
  ]);
  return teamUserIds.has(log.userId)
    || teamUserIds.has(Number(log.resourceId))
    || (log.resourceType === "hospital" && Number(log.resourceId) === hospitalId)
    || Number(log.metadata?.hospitalId) === hospitalId;
}

module.exports = { handleProfileRoutes };
