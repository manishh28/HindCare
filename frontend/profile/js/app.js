import { profileApi, clearProfileAuth, requireAuth, getInitials, formatDate } from "./api.js";

if (!requireAuth()) {
  throw new Error("Not authenticated");
}

// ---------------------------------------------------------------------
// Icons (Feather-style, stroke-based, 24x24)
// ---------------------------------------------------------------------
const ICONS = {
  overview: '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  bell: '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>',
  phone: '<path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>',
  map: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>',
  file: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  system: '<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
  hospital: '<path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/><path d="M12 8v8M8 12h8"/>',
  truck: '<rect x="1" y="6" width="15" height="12" rx="1"/><path d="M16 10h4l3 3v5h-7z"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="20" r="2"/>',
  users: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>'
};

function icon(name) {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

// ---------------------------------------------------------------------
// Nav configuration per role
// ---------------------------------------------------------------------
const COMMON_NAV = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "edit", label: "Edit Profile", icon: "edit" },
  { id: "notifications", label: "Notifications", icon: "bell" },
  { id: "contacts", label: "Emergency Contacts", icon: "phone" },
  { id: "addresses", label: "Addresses", icon: "map" }
];

const HOSPITAL_ROLES = ["hospital_admin", "hospital_doctor", "hospital_reception", "hospital_staff"];

const ROLE_NAV = {
  driver: [{ id: "documents", label: "Documents", icon: "file" }],
  dispatcher: [{ id: "dispatch", label: "Dispatch", icon: "activity" }],
  hospital_admin: [
    { id: "hospital", label: "My Hospital", icon: "hospital" },
    { id: "hospital-team", label: "Hospital Team", icon: "users" },
    { id: "activity", label: "Activity Log", icon: "activity" }
  ],
  hospital_doctor: [{ id: "hospital", label: "My Hospital", icon: "hospital" }],
  hospital_reception: [{ id: "hospital", label: "My Hospital", icon: "hospital" }],
  hospital_staff: [{ id: "hospital", label: "My Hospital", icon: "hospital" }],
  super_admin: [
    { id: "activity", label: "Activity Log", icon: "activity" },
    { id: "system", label: "System", icon: "system" }
  ],
  fleet_owner: [
    { id: "fleet", label: "My Fleet", icon: "truck" },
    { id: "fleet-drivers", label: "My Drivers", icon: "users" }
  ]
};

const PAGE_TITLES = {
  overview: "Overview",
  edit: "Edit Profile",
  notifications: "Notifications",
  contacts: "Emergency Contacts",
  addresses: "Addresses",
  documents: "Documents",
  dispatch: "Dispatch",
  activity: "Activity Log",
  system: "System",
  hospital: "My Hospital",
  "hospital-team": "Hospital Team",
  fleet: "My Fleet",
  "fleet-drivers": "My Drivers"
};

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
let data = null; // { user, profile, emergencyContacts, addresses, notificationPrefs, ... }
let hospitalsCache = null;

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function toast(message, type = "info") {
  const el = document.getElementById("toast");
  el.className = `md-alert md-alert-${type}`;
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 3500);
}

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------
async function boot() {
  try {
    data = await profileApi("/api/profile");
  } catch (err) {
    toast(err.message || "Could not load your profile", "error");
    return;
  }

  renderSidebar();
  window.addEventListener("hashchange", renderRoute);
  document.getElementById("logout-btn").addEventListener("click", logout);
  document.getElementById("mobile-nav-toggle").addEventListener("click", toggleSidebar);
  document.getElementById("sidebar-overlay").addEventListener("click", toggleSidebar);

  // Login redirects use hash formats like #driver / #hospital-admin rather than
  // this router's #/route format — treat anything that isn't #/route as "land on overview".
  if (!/^#\/[a-z-]+/i.test(window.location.hash)) {
    history.replaceState(null, "", "#/overview");
  }
  renderRoute();
}

function toggleSidebar() {
  document.getElementById("profile-sidebar").classList.toggle("open");
  document.getElementById("sidebar-overlay").classList.toggle("open");
}

async function logout() {
  try {
    await profileApi("/api/auth/logout", { method: "POST" });
  } catch {
    // Best-effort — still clear the local session below even if this fails.
  }
  clearProfileAuth();
  window.location.href = "/";
}

// ---------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------
function renderSidebar() {
  const { user, profile } = data;
  const name = profile?.fullName || profile?.adminName || user.email || user.employeeId || "User";

  document.getElementById("sidebar-avatar").textContent = getInitials(name);
  document.getElementById("sidebar-user-name").textContent = name;
  document.getElementById("sidebar-user-role").textContent = user.roleName;

  const items = [...COMMON_NAV, ...(ROLE_NAV[user.role] || [])];
  const nav = document.getElementById("sidebar-nav");
  nav.innerHTML = items.map(item => `
    <button type="button" class="nav-item" data-route="${item.id}">
      ${icon(item.icon)}
      <span>${item.label}</span>
    </button>
  `).join("");

  nav.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => { window.location.hash = `#/${btn.dataset.route}`; });
  });
}

function markActiveNav(routeId) {
  document.querySelectorAll("#sidebar-nav .nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.route === routeId);
  });
  document.getElementById("page-title").textContent = PAGE_TITLES[routeId] || "Overview";
  document.getElementById("profile-sidebar").classList.remove("open");
  document.getElementById("sidebar-overlay").classList.remove("open");
}

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------
const RENDERERS = {
  overview: renderOverview,
  edit: renderEdit,
  notifications: renderNotifications,
  contacts: renderContacts,
  addresses: renderAddresses,
  documents: renderDocuments,
  dispatch: renderDispatch,
  activity: renderActivity,
  system: renderSystem,
  hospital: renderHospital,
  "hospital-team": renderHospitalTeam,
  fleet: renderFleet,
  "fleet-drivers": renderFleetDrivers
};

async function renderRoute() {
  const match = window.location.hash.match(/^#\/([a-z-]+)/i);
  const routeId = match ? match[1] : "overview";
  markActiveNav(routeId);

  const allowed = [...COMMON_NAV, ...(ROLE_NAV[data.user.role] || [])].map(i => i.id);
  const renderer = allowed.includes(routeId) ? RENDERERS[routeId] : renderOverview;

  const el = document.getElementById("profile-content");
  el.innerHTML = '<div class="skeleton" style="height:180px; border-radius:16px;"></div>';
  try {
    await renderer(el);
  } catch (err) {
    el.innerHTML = `<div class="md-card full-width profile-card"><div class="profile-card-body"><div class="md-alert md-alert-error">${escapeHtml(err.message || "Something went wrong")}</div></div></div>`;
  }
}

// ---------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------
async function renderOverview(el) {
  const { user, profile } = data;
  const role = user.role;

  let statsHtml = "";
  let extraCard = "";

  if (role === "driver") {
    statsHtml = statCard(profile.rating, "Rating") + statCard(profile.completedTrips, "Trips completed") + statCard(profile.experienceYears, "Years experience");
    const ambulance = data.assignedAmbulance;
    const trip = data.activeBooking;
    extraCard = `
      <div class="profile-card">
        <div class="profile-card-header"><h2>Availability</h2></div>
        <div class="profile-card-body">
          <div class="availability-select" id="availability-select">
            ${["available", "busy", "on_break", "offline"].map(s => `
              <button type="button" class="status-chip ${s} ${profile.availabilityStatus === s ? "active" : ""}" data-status="${s}">${s.replace("_", " ")}</button>
            `).join("")}
          </div>
        </div>
      </div>
      <div class="profile-card">
        <div class="profile-card-header"><h2>My ambulance</h2></div>
        <div class="profile-card-body">
          ${ambulance
            ? infoRow("Vehicle", ambulance.registrationNumber) + infoRow("Type", ambulance.type) + infoRow("Status", ambulance.status)
            : '<div class="empty-state-card">Not assigned to a vehicle yet. Your fleet owner assigns you to an ambulance.</div>'}
        </div>
      </div>
      ${trip ? `
      <div class="profile-card full-width">
        <div class="profile-card-header"><h2>Active trip</h2></div>
        <div class="profile-card-body">
          ${infoRow("Booking", "#" + trip.id)}
          ${infoRow("Pickup", trip.pickup)}
          ${infoRow("Destination", trip.destination)}
          ${infoRow("Status", trip.status)}
          <div class="dispatch-actions" id="driver-trip-actions">
            ${(DISPATCH_NEXT_STATUSES[trip.status] || []).map(status => `<button type="button" class="md-btn md-btn-outlined" data-driver-trip-id="${trip.id}" data-driver-trip-status="${status}">${escapeHtml(prettyStatus(status))}</button>`).join("")}
          </div>
        </div>
      </div>` : ""}`;
  } else if (role === "dispatcher") {
    const workspace = data.dispatcherWorkspace || {};
    const dispatchBookings = workspace.bookings || [];
    const ambulances = workspace.ambulances || [];
    statsHtml = statCard(dispatchBookings.filter(b => b.status === "requested").length, "New requests")
      + statCard(dispatchBookings.filter(b => ["assigned", "on_route"].includes(b.status)).length, "Active trips")
      + statCard(ambulances.filter(a => a.status === "available").length, "Ambulances free")
      + statCard(workspace.completedToday || 0, "Completed today");
    extraCard = `
      <div class="profile-card">
        <div class="profile-card-header"><h2>Live status</h2></div>
        <div class="profile-card-body">
          <div class="availability-select" id="live-status-select">
            ${["online", "on_break", "offline"].map(s => `
              <button type="button" class="status-chip ${s === "online" ? "available" : s === "offline" ? "busy" : ""} ${profile.liveStatus === s ? "active" : ""}" data-status="${s}">${s.replace("_", " ")}</button>
            `).join("")}
          </div>
        </div>
      </div>
      <div class="profile-card">
        <div class="profile-card-header"><h2>Dispatch workspace</h2></div>
        <div class="profile-card-body">
          <p class="info-label" style="margin-bottom:1rem;">Assign ambulances and real driver accounts to requests from one place.</p>
          <button type="button" class="md-btn md-btn-filled" id="open-dispatch-btn">Open dispatch board</button>
        </div>
      </div>`;
  } else if (HOSPITAL_ROLES.includes(role)) {
    const hospital = data.hospital || await resolveHospital(profile.hospitalId);
    if (hospital) {
      statsHtml = statCard(`${hospital.availableBeds}/${hospital.totalBeds}`, "Beds available")
        + statCard(hospital.status, "Hospital status")
        + statCard(hospital.city || "—", "City");
    }
    if (role === "hospital_admin") {
      extraCard = `
        <div class="profile-card">
          <div class="profile-card-header"><h2>Hospital team</h2></div>
          <div class="profile-card-body">
            <p class="info-label" style="margin-bottom:1rem;">Create doctor, reception, and staff accounts with narrower access than the hospital owner.</p>
            <button type="button" class="md-btn md-btn-filled" id="open-team-btn">Manage team</button>
          </div>
        </div>`;
    }
  } else if (role === "super_admin") {
    const sys = data.systemInfo || {};
    statsHtml = statCard(sys.environment || "—", "Environment")
      + statCard(sys.uptime ? `${Math.floor(sys.uptime / 60)}m` : "—", "Server uptime")
      + statCard((data.apiKeys || []).length, "Active API keys");
  } else if (role === "fleet_owner") {
    const fleet = data.fleet || [];
    statsHtml = statCard(fleet.length, "Ambulances")
      + statCard(fleet.filter(a => a.status === "available").length, "Available now")
      + statCard((data.drivers || []).length, "Drivers linked");
  }

  const rows = overviewRows(role, profile, user);

  document.getElementById("profile-content").innerHTML = `
    ${statsHtml ? `<div class="profile-card full-width"><div class="profile-card-body"><div class="stats-grid">${statsHtml}</div></div></div>` : ""}
    <div class="profile-card">
      <div class="profile-card-header"><h2>Profile details</h2></div>
      <div class="profile-card-body">${rows}</div>
    </div>
    ${extraCard}
  `;

  document.getElementById("availability-select")?.addEventListener("click", async e => {
    const btn = e.target.closest(".status-chip");
    if (!btn) return;
    try {
      await profileApi("/api/profile/availability", { method: "PATCH", body: JSON.stringify({ status: btn.dataset.status }) });
      profile.availabilityStatus = btn.dataset.status;
      toast("Availability updated", "success");
      renderRoute();
    } catch (err) {
      toast(err.message, "error");
    }
  });

  document.getElementById("live-status-select")?.addEventListener("click", async e => {
    const btn = e.target.closest(".status-chip");
    if (!btn) return;
    try {
      await profileApi("/api/profile/live-status", { method: "PATCH", body: JSON.stringify({ status: btn.dataset.status }) });
      profile.liveStatus = btn.dataset.status;
      toast("Status updated", "success");
      renderRoute();
    } catch (err) {
      toast(err.message, "error");
    }
  });

  document.getElementById("open-dispatch-btn")?.addEventListener("click", () => {
    window.location.hash = "#/dispatch";
  });

  document.getElementById("open-team-btn")?.addEventListener("click", () => {
    window.location.hash = "#/hospital-team";
  });

  document.getElementById("driver-trip-actions")?.addEventListener("click", async e => {
    const btn = e.target.closest("[data-driver-trip-status]");
    if (!btn) return;
    try {
      await profileApi(`/api/bookings/${btn.dataset.driverTripId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: btn.dataset.driverTripStatus })
      });
      toast("Trip status updated", "success");
      await refreshProfileData();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

function statCard(value, label) {
  return `<div class="stat-card"><strong>${escapeHtml(value ?? "—")}</strong><span>${escapeHtml(label)}</span></div>`;
}

function infoRow(label, value) {
  return `<div class="info-row"><span class="info-label">${escapeHtml(label)}</span><span class="info-value">${escapeHtml(value ?? "—")}</span></div>`;
}

function overviewRows(role, profile, user) {
  const common = infoRow("Employee ID", user.employeeId) + infoRow("Email", user.email) + infoRow("Phone", user.phone);
  if (role === "driver") {
    return common
      + infoRow("Full name", profile.fullName)
      + infoRow("License number", profile.licenseNumber)
      + infoRow("License expiry", formatDate(profile.licenseExpiry))
      + infoRow("Vehicle number", profile.vehicleNumber)
      + infoRow("Languages", (profile.languages || []).join(", "))
      + infoRow("Emergency contact", `${profile.emergencyContactName || "—"} (${profile.emergencyContactPhone || "—"})`);
  }
  if (role === "dispatcher") {
    return common
      + infoRow("Full name", profile.fullName)
      + infoRow("Department", profile.department)
      + infoRow("Assigned region", profile.assignedRegion);
  }
  if (role === "hospital_admin") {
    return common
      + infoRow("Admin name", profile.adminName)
      + infoRow("Hospital name", profile.hospitalName || "Not registered yet")
      + infoRow("GST number", profile.gstNumber)
      + infoRow("Hospital license", profile.licenseNumber)
      + infoRow("Email notifications", profile.notificationEmail ? "On" : "Off")
      + infoRow("SMS notifications", profile.notificationSms ? "On" : "Off");
  }
  if (["hospital_doctor", "hospital_reception", "hospital_staff"].includes(role)) {
    return common
      + infoRow("Full name", profile.fullName)
      + infoRow("Department", profile.department || "—")
      + infoRow("Designation", profile.designation || "—")
      + infoRow("Access level", user.roleName);
  }
  if (role === "super_admin") {
    return common
      + infoRow("Full name", profile.fullName)
      + infoRow("Organization", profile.organizationName)
      + infoRow("API access", profile.apiKeysEnabled ? "Enabled" : "Disabled");
  }
  if (role === "fleet_owner") {
    return common
      + infoRow("Full name", profile.fullName)
      + infoRow("Company name", profile.companyName || "—")
      + infoRow("Fleet code", profile.fleetCode);
  }
  return common;
}

async function resolveHospital(hospitalId) {
  if (!hospitalId) return null;
  try {
    if (!hospitalsCache) hospitalsCache = await fetch("/api/hospitals").then(r => r.json());
    return hospitalsCache.find(h => h.id === hospitalId) || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Edit profile
// ---------------------------------------------------------------------
const EDIT_FIELDS = {
  driver: [
    { key: "fullName", label: "Full name", type: "text" },
    { key: "emergencyContactName", label: "Emergency contact name", type: "text" },
    { key: "emergencyContactPhone", label: "Emergency contact phone", type: "tel" }
  ],
  dispatcher: [{ key: "fullName", label: "Full name", type: "text" }],
  hospital_admin: [
    { key: "adminName", label: "Admin name", type: "text" },
    { key: "phone", label: "Phone", type: "tel" },
    { key: "gstNumber", label: "GST number", type: "text" }
  ],
  hospital_doctor: [
    { key: "fullName", label: "Full name", type: "text" },
    { key: "department", label: "Department", type: "text" },
    { key: "designation", label: "Designation", type: "text" }
  ],
  hospital_reception: [
    { key: "fullName", label: "Full name", type: "text" },
    { key: "department", label: "Department", type: "text" },
    { key: "designation", label: "Designation", type: "text" }
  ],
  hospital_staff: [
    { key: "fullName", label: "Full name", type: "text" },
    { key: "department", label: "Department", type: "text" },
    { key: "designation", label: "Designation", type: "text" }
  ],
  super_admin: [
    { key: "fullName", label: "Full name", type: "text" },
    { key: "organizationName", label: "Organization name", type: "text" }
  ],
  fleet_owner: [
    { key: "fullName", label: "Full name", type: "text" },
    { key: "companyName", label: "Company name", type: "text" }
  ]
};

function renderEdit(el) {
  const { user, profile } = data;
  const fields = EDIT_FIELDS[user.role] || [];
  const toggles = user.role === "hospital_admin"
    ? `
      <div class="toggle-row">
        <span>Email notifications</span>
        <label class="toggle-switch"><input type="checkbox" id="field-notificationEmail" ${profile.notificationEmail ? "checked" : ""}><span class="toggle-slider"></span></label>
      </div>
      <div class="toggle-row">
        <span>SMS notifications</span>
        <label class="toggle-switch"><input type="checkbox" id="field-notificationSms" ${profile.notificationSms ? "checked" : ""}><span class="toggle-slider"></span></label>
      </div>`
    : "";

  el.innerHTML = `
    <div class="profile-card full-width">
      <div class="profile-card-header"><h2>Edit profile</h2></div>
      <div class="profile-card-body">
        <form id="edit-form" class="edit-form">
          <div class="photo-upload">
            <div class="avatar">${profile.profilePhotoUrl ? `<img src="${profile.profilePhotoUrl}" alt="">` : getInitials(profile.fullName || profile.adminName)}</div>
            <div class="photo-actions">
              <label class="md-btn md-btn-outlined">
                Upload photo
                <input type="file" id="photo-input" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden">
              </label>
              ${profile.profilePhotoUrl ? '<button type="button" id="remove-photo" class="md-btn md-btn-text">Remove photo</button>' : ""}
            </div>
          </div>
          ${fields.map(f => `
            <div class="md-field">
              <label for="field-${f.key}">${f.label}</label>
              <div class="md-input-wrap"><input class="md-input" type="${f.type}" id="field-${f.key}" value="${escapeHtml(profile[f.key] || "")}"></div>
            </div>
          `).join("")}
          ${toggles}
          <div class="form-actions">
            <button type="submit" class="md-btn md-btn-filled">Save changes</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.getElementById("edit-form").addEventListener("submit", async e => {
    e.preventDefault();
    const body = {};
    fields.forEach(f => { body[f.key] = document.getElementById(`field-${f.key}`).value.trim(); });
    if (user.role === "hospital_admin") {
      body.notificationEmail = document.getElementById("field-notificationEmail").checked;
      body.notificationSms = document.getElementById("field-notificationSms").checked;
    }
    try {
      const res = await profileApi("/api/profile", { method: "PATCH", body: JSON.stringify(body) });
      data.profile = res.profile;
      toast("Profile updated", "success");
      renderSidebar();
      renderRoute();
    } catch (err) {
      toast(err.message, "error");
    }
  });

  document.getElementById("photo-input").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await profileApi("/api/profile/photo", { method: "POST", body: JSON.stringify({ imageData: reader.result }) });
        data.profile.profilePhotoUrl = reader.result;
        toast("Photo updated", "success");
        renderSidebar();
        renderRoute();
      } catch (err) {
        toast(err.message, "error");
      }
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("remove-photo")?.addEventListener("click", async () => {
    try {
      await profileApi("/api/profile/photo", { method: "DELETE" });
      data.profile.profilePhotoUrl = null;
      toast("Photo removed", "success");
      renderSidebar();
      renderRoute();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// ---------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------
const NOTIF_TOGGLES = [
  { key: "bookingUpdates", label: "Booking updates" },
  { key: "securityAlerts", label: "Security alerts" },
  { key: "shiftReminders", label: "Shift reminders" },
  { key: "systemMaintenance", label: "System maintenance" },
  { key: "promotions", label: "Promotions" }
];

function renderNotifications(el) {
  const prefs = data.notificationPrefs || {};
  el.innerHTML = `
    <div class="profile-card full-width">
      <div class="profile-card-header"><h2>Notification preferences</h2></div>
      <div class="profile-card-body" id="notif-body">
        ${NOTIF_TOGGLES.map(t => `
          <div class="toggle-row">
            <span>${t.label}</span>
            <label class="toggle-switch"><input type="checkbox" data-key="${t.key}" ${prefs[t.key] ? "checked" : ""}><span class="toggle-slider"></span></label>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  document.getElementById("notif-body").addEventListener("change", async e => {
    const input = e.target.closest("input[data-key]");
    if (!input) return;
    try {
      const body = { [input.dataset.key]: input.checked };
      const updated = await profileApi("/api/profile/notifications", { method: "PATCH", body: JSON.stringify(body) });
      data.notificationPrefs = updated;
      toast("Preference saved", "success");
    } catch (err) {
      toast(err.message, "error");
      input.checked = !input.checked;
    }
  });
}

// ---------------------------------------------------------------------
// Emergency contacts
// ---------------------------------------------------------------------
function renderContacts(el) {
  const contacts = data.emergencyContacts || [];
  el.innerHTML = `
    <div class="profile-card full-width">
      <div class="profile-card-header"><h2>Emergency contacts</h2></div>
      <div class="profile-card-body">
        ${contacts.length ? contacts.map(c => `
          <div class="list-item">
            <div>
              <strong>${escapeHtml(c.name)}</strong>${c.isPrimary ? ' <span class="role-badge">Primary</span>' : ""}
              <div class="info-label">${escapeHtml(c.relationship)} · ${escapeHtml(c.phone)}</div>
            </div>
          </div>
        `).join("") : '<div class="empty-state-card">No emergency contacts added yet.</div>'}

        <form id="contact-form" class="edit-form" style="margin-top:1.5rem;">
          <div class="grid grid-2">
            <div class="md-field"><label for="c-name">Name</label><div class="md-input-wrap"><input class="md-input" id="c-name" required></div></div>
            <div class="md-field"><label for="c-relationship">Relationship</label><div class="md-input-wrap"><input class="md-input" id="c-relationship" required></div></div>
          </div>
          <div class="md-field"><label for="c-phone">Phone</label><div class="md-input-wrap"><input class="md-input" type="tel" id="c-phone" required></div></div>
          <div class="form-actions"><button type="submit" class="md-btn md-btn-filled">Add contact</button></div>
        </form>
      </div>
    </div>
  `;

  document.getElementById("contact-form").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      const contact = await profileApi("/api/profile/emergency-contacts", {
        method: "POST",
        body: JSON.stringify({
          name: document.getElementById("c-name").value.trim(),
          relationship: document.getElementById("c-relationship").value.trim(),
          phone: document.getElementById("c-phone").value.trim()
        })
      });
      data.emergencyContacts.push(contact);
      toast("Contact added", "success");
      renderRoute();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// ---------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------
function renderAddresses(el) {
  const addresses = data.addresses || [];
  el.innerHTML = `
    <div class="profile-card full-width">
      <div class="profile-card-header"><h2>Addresses</h2></div>
      <div class="profile-card-body">
        ${addresses.length ? addresses.map(a => `
          <div class="list-item">
            <div>
              <strong>${escapeHtml((a.label || "address").toUpperCase())}</strong>${a.isDefault ? ' <span class="role-badge">Default</span>' : ""}
              <div class="info-label">${escapeHtml(a.line1)}${a.line2 ? ", " + escapeHtml(a.line2) : ""}, ${escapeHtml(a.city)}, ${escapeHtml(a.state)} ${escapeHtml(a.pincode)}</div>
            </div>
          </div>
        `).join("") : '<div class="empty-state-card">No addresses added yet.</div>'}

        <form id="address-form" class="edit-form" style="margin-top:1.5rem;">
          <div class="grid grid-2">
            <div class="md-field"><label for="a-label">Label</label><div class="md-input-wrap"><input class="md-input" id="a-label" placeholder="home / work"></div></div>
            <div class="md-field"><label for="a-line1">Address line 1</label><div class="md-input-wrap"><input class="md-input" id="a-line1" required></div></div>
          </div>
          <div class="grid grid-3">
            <div class="md-field"><label for="a-city">City</label><div class="md-input-wrap"><input class="md-input" id="a-city" required></div></div>
            <div class="md-field"><label for="a-state">State</label><div class="md-input-wrap"><input class="md-input" id="a-state" required></div></div>
            <div class="md-field"><label for="a-pincode">Pincode</label><div class="md-input-wrap"><input class="md-input" id="a-pincode" required></div></div>
          </div>
          <div class="form-actions"><button type="submit" class="md-btn md-btn-filled">Add address</button></div>
        </form>
      </div>
    </div>
  `;

  document.getElementById("address-form").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      const address = await profileApi("/api/profile/addresses", {
        method: "POST",
        body: JSON.stringify({
          label: document.getElementById("a-label").value.trim() || "home",
          line1: document.getElementById("a-line1").value.trim(),
          city: document.getElementById("a-city").value.trim(),
          state: document.getElementById("a-state").value.trim(),
          pincode: document.getElementById("a-pincode").value.trim()
        })
      });
      data.addresses.push(address);
      toast("Address added", "success");
      renderRoute();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// ---------------------------------------------------------------------
// Documents (driver only)
// ---------------------------------------------------------------------
function renderDocuments(el) {
  const documents = data.documents || [];
  const bank = data.bankDetails;
  el.innerHTML = `
    <div class="profile-card full-width">
      <div class="profile-card-header"><h2>Documents</h2></div>
      <div class="profile-card-body">
        ${documents.length ? documents.map(d => `<div class="list-item"><strong>${escapeHtml(d.name)}</strong></div>`).join("")
          : '<div class="empty-state-card">No documents on file. Contact your fleet admin to have license and vehicle documents uploaded.</div>'}
      </div>
    </div>
    <div class="profile-card full-width">
      <div class="profile-card-header"><h2>Bank details</h2></div>
      <div class="profile-card-body">
        ${bank ? `${infoRow("Account holder", bank.accountHolder)}${infoRow("Bank", bank.bankName)}` : '<div class="empty-state-card">No payout bank account on file. Contact your fleet admin.</div>'}
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------
// Dispatch workspace (dispatcher)
// ---------------------------------------------------------------------
const DISPATCH_NEXT_STATUSES = {
  requested: ["assigned", "cancelled"],
  assigned: ["on_route", "cancelled"],
  on_route: ["completed", "cancelled"],
  completed: [],
  cancelled: []
};

const STATUS_TEXT = {
  requested: "Requested",
  assigned: "Assigned",
  on_route: "On route",
  completed: "Completed",
  cancelled: "Cancelled",
  available: "Available",
  busy: "Busy",
  maintenance: "Maintenance",
  offline: "Offline",
  on_break: "On break"
};

function prettyStatus(status) {
  return STATUS_TEXT[status] || String(status || "unknown").replaceAll("_", " ");
}

function renderDispatch(el) {
  const workspace = data.dispatcherWorkspace || {};
  const bookings = workspace.bookings || [];
  const ambulances = workspace.ambulances || [];
  const drivers = workspace.drivers || [];
  const activeTrips = bookings.filter(b => ["assigned", "on_route"].includes(b.status));
  const newRequests = bookings.filter(b => b.status === "requested");

  el.innerHTML = `
    <div class="profile-card full-width dispatch-hero">
      <div class="profile-card-body">
        <div class="stats-grid">
          ${statCard(newRequests.length, "Waiting requests")}
          ${statCard(activeTrips.length, "Active trips")}
          ${statCard(ambulances.filter(a => a.status === "available").length, "Ambulances free")}
          ${statCard(drivers.filter(d => d.availabilityStatus === "available").length, "Drivers free")}
        </div>
      </div>
    </div>

    <div class="dispatch-grid full-width">
      <div class="profile-card">
        <div class="profile-card-header">
          <h2>Requests and active trips</h2>
          <button type="button" class="md-btn md-btn-outlined" id="dispatch-refresh-btn">Refresh</button>
        </div>
        <div class="profile-card-body dispatch-board">
          ${bookings.length ? bookings.map(booking => dispatchBookingCard(booking, ambulances, drivers)).join("") : '<div class="empty-state-card">No active requests right now.</div>'}
        </div>
      </div>

      <aside class="dispatch-side">
        <div class="profile-card">
          <div class="profile-card-header"><h2>Ambulances</h2></div>
          <div class="profile-card-body compact-list">
            ${ambulances.length ? ambulances.map(a => `
              <div class="compact-row">
                <div>
                  <strong>${escapeHtml(a.registrationNumber)}</strong>
                  <span>${escapeHtml(a.type)} · ${escapeHtml(a.driverName || "No driver")}</span>
                </div>
                <span class="status-chip ${a.status === "available" ? "available active" : a.status === "busy" ? "busy active" : ""}">${escapeHtml(prettyStatus(a.status))}</span>
              </div>
            `).join("") : '<div class="empty-state-card">No ambulances in fleet.</div>'}
          </div>
        </div>

        <div class="profile-card">
          <div class="profile-card-header"><h2>Drivers</h2></div>
          <div class="profile-card-body compact-list">
            ${drivers.length ? drivers.map(d => `
              <div class="compact-row">
                <div>
                  <strong>${escapeHtml(d.fullName)}</strong>
                  <span>${escapeHtml(d.phone || "")}</span>
                </div>
                <span class="status-chip ${d.availabilityStatus === "available" ? "available active" : d.availabilityStatus === "busy" ? "busy active" : ""}">${escapeHtml(prettyStatus(d.availabilityStatus))}</span>
              </div>
            `).join("") : '<div class="empty-state-card">No driver accounts yet.</div>'}
          </div>
        </div>
      </aside>
    </div>
  `;

  document.getElementById("dispatch-refresh-btn")?.addEventListener("click", refreshProfileData);

  el.querySelectorAll("[data-dispatch-assign]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const card = btn.closest("[data-booking-id]");
      const bookingId = card.dataset.bookingId;
      const ambulanceId = card.querySelector("[data-dispatch-ambulance]").value;
      const assignedDriverId = card.querySelector("[data-dispatch-driver]").value;

      try {
        await profileApi(`/api/bookings/${bookingId}`, {
          method: "PATCH",
          body: JSON.stringify({
            ambulanceId: ambulanceId ? Number(ambulanceId) : null,
            assignedDriverId: assignedDriverId ? Number(assignedDriverId) : null
          })
        });
        toast("Trip assignment updated", "success");
        await refreshProfileData();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  });

  el.querySelectorAll("[data-dispatch-status]").forEach(btn => {
    btn.addEventListener("click", async () => {
      try {
        await profileApi(`/api/bookings/${btn.dataset.bookingId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: btn.dataset.dispatchStatus })
        });
        toast("Trip status updated", "success");
        await refreshProfileData();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  });
}

function dispatchBookingCard(booking, ambulances, drivers) {
  const nextStatuses = DISPATCH_NEXT_STATUSES[booking.status] || [];
  return `
    <article class="dispatch-card" data-booking-id="${booking.id}">
      <div class="dispatch-card-head">
        <div>
          <strong>Booking #${escapeHtml(booking.id)}</strong>
          <span>${escapeHtml(booking.patientName)} · ${escapeHtml(booking.phone)}</span>
        </div>
        <span class="status-chip ${booking.status === "requested" ? "busy active" : booking.status === "assigned" || booking.status === "on_route" ? "available active" : ""}">${escapeHtml(prettyStatus(booking.status))}</span>
      </div>

      <div class="dispatch-route">
        <div><span>Pickup</span><strong>${escapeHtml(booking.pickup)}</strong></div>
        <div><span>Destination</span><strong>${escapeHtml(booking.destination)}</strong></div>
      </div>

      <div class="dispatch-controls">
        <label>
          Ambulance
          <select class="md-input" data-dispatch-ambulance>
            <option value="">No ambulance</option>
            ${ambulances.map(a => `<option value="${a.id}" ${booking.ambulanceId === a.id ? "selected" : ""}>${escapeHtml(a.registrationNumber)} · ${escapeHtml(prettyStatus(a.status))}</option>`).join("")}
          </select>
        </label>
        <label>
          Driver
          <select class="md-input" data-dispatch-driver>
            <option value="">No driver</option>
            ${drivers.map(d => `<option value="${d.id}" ${booking.assignedDriverId === d.id ? "selected" : ""}>${escapeHtml(d.fullName)} · ${escapeHtml(prettyStatus(d.availabilityStatus))}</option>`).join("")}
          </select>
        </label>
        <button type="button" class="md-btn md-btn-filled" data-dispatch-assign>Assign</button>
      </div>

      ${nextStatuses.length ? `
        <div class="dispatch-actions">
          ${nextStatuses.map(status => `<button type="button" class="md-btn md-btn-outlined" data-booking-id="${booking.id}" data-dispatch-status="${status}">${escapeHtml(prettyStatus(status))}</button>`).join("")}
        </div>
      ` : ""}
    </article>
  `;
}

async function refreshProfileData() {
  data = await profileApi("/api/profile");
  renderRoute();
}

// ---------------------------------------------------------------------
// Activity log (hospital_admin, super_admin)
// ---------------------------------------------------------------------
async function renderActivity(el) {
  const logs = await profileApi("/api/profile/audit-logs");
  el.innerHTML = `
    <div class="profile-card full-width">
      <div class="profile-card-header"><h2>Recent activity</h2></div>
      <div class="profile-card-body">
        ${logs.length ? logs.map(l => `
          <div class="info-row">
            <span class="info-label">${escapeHtml(l.action)} · ${escapeHtml(l.resourceType)}${l.resourceId ? " #" + escapeHtml(l.resourceId) : ""}</span>
            <span class="info-value">${escapeHtml(new Date(l.createdAt).toLocaleString("en-IN"))}</span>
          </div>
        `).join("") : '<div class="empty-state-card">No activity recorded yet.</div>'}
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------
// System (super_admin only)
// ---------------------------------------------------------------------
function renderSystem(el) {
  const sys = data.systemInfo || {};
  const keys = data.apiKeys || [];
  el.innerHTML = `
    <div class="profile-card">
      <div class="profile-card-header"><h2>System info</h2></div>
      <div class="profile-card-body">
        ${infoRow("Version", sys.version)}
        ${infoRow("Environment", sys.environment)}
        ${infoRow("Server uptime", sys.uptime ? `${Math.floor(sys.uptime / 60)} min` : "—")}
        ${infoRow("Backup status", sys.backupStatus)}
      </div>
    </div>
    <div class="profile-card">
      <div class="profile-card-header"><h2>API keys</h2></div>
      <div class="profile-card-body">
        ${keys.length ? keys.map(k => `<div class="list-item"><strong>${escapeHtml(k.label)}</strong></div>`).join("")
          : '<div class="empty-state-card">No API keys generated yet.</div>'}
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------
// Hospital (hospital_admin)
// ---------------------------------------------------------------------
async function renderHospital(el) {
  const hospital = data.hospital;
  const role = data.user.role;
  const canManageHospital = role === "hospital_admin";
  const canUpdateBeds = canManageHospital || role === "hospital_reception";
  const canEditDepartments = canManageHospital;

  if (!hospital) {
    if (!canManageHospital) {
      el.innerHTML = `
        <div class="profile-card full-width">
          <div class="profile-card-header"><h2>Hospital access</h2></div>
          <div class="profile-card-body">
            <div class="empty-state-card">Your account is not linked to a registered hospital yet. Ask your hospital owner to review your team access.</div>
          </div>
        </div>`;
      return;
    }
    el.innerHTML = `
      <div class="profile-card full-width">
        <div class="profile-card-header"><h2>Register your hospital</h2></div>
        <div class="profile-card-body">
          <p class="info-label" style="margin-bottom:1rem;">You haven't registered a hospital yet. Once submitted, an administrator will review and approve it before it appears to patients.</p>
          <form id="hospital-register-form" class="edit-form">
            <div class="md-field"><label>Hospital name</label><div class="md-input-wrap"><input class="md-input" id="reg-name" value="${escapeHtml(data.profile?.hospitalName || "")}" required></div></div>
            <div class="md-field"><label>City</label><div class="md-input-wrap"><input class="md-input" id="reg-city" required></div></div>
            <div class="md-field"><label>Address</label><div class="md-input-wrap"><input class="md-input" id="reg-address" required></div></div>
            <div class="md-field"><label>Phone</label><div class="md-input-wrap"><input class="md-input" type="tel" id="reg-phone" required></div></div>
            <div class="md-field"><label>Email</label><div class="md-input-wrap"><input class="md-input" type="email" id="reg-email" required></div></div>
            <div class="form-actions"><button type="submit" class="md-btn md-btn-filled">Register hospital</button></div>
            <p class="form-result" id="hospital-register-result" role="status"></p>
          </form>
        </div>
      </div>`;

    document.getElementById("hospital-register-form").addEventListener("submit", async e => {
      e.preventDefault();
      const result = document.getElementById("hospital-register-result");
      try {
        const created = await profileApi("/api/hospitals", {
          method: "POST",
          body: JSON.stringify({
            name: document.getElementById("reg-name").value.trim(),
            city: document.getElementById("reg-city").value.trim(),
            address: document.getElementById("reg-address").value.trim(),
            phone: document.getElementById("reg-phone").value.trim(),
            email: document.getElementById("reg-email").value.trim()
          })
        });
        data.hospital = created;
        toast("Hospital registered — pending admin approval", "success");
        renderRoute();
      } catch (err) {
        result.textContent = err.message;
      }
    });
    return;
  }

  const deptRow = (d, i) => `
    <div class="list-item" data-dept-index="${i}">
      <div style="flex:1;"><strong>${escapeHtml(d.name)}</strong></div>
      <select class="md-input" style="max-width:160px;" data-dept-status ${canEditDepartments ? "" : "disabled"}>
        ${["available", "limited", "unavailable"].map(s => `<option value="${s}" ${d.status === s ? "selected" : ""}>${s}</option>`).join("")}
      </select>
      ${canEditDepartments ? '<button type="button" class="ghost-button danger" data-dept-remove>Remove</button>' : ""}
    </div>`;

  const bedFields = `
    <div class="md-field"><label>Total beds</label><div class="md-input-wrap"><input class="md-input" type="number" min="0" id="hosp-total-beds" value="${hospital.totalBeds}" ${canUpdateBeds ? "" : "disabled"}></div></div>
    <div class="md-field"><label>Available beds</label><div class="md-input-wrap"><input class="md-input" type="number" min="0" id="hosp-available-beds" value="${hospital.availableBeds}" ${canUpdateBeds ? "" : "disabled"}></div></div>
    ${canUpdateBeds ? '<button type="button" class="md-btn md-btn-filled" id="hosp-save-beds-btn">Save beds</button><p class="form-result" id="hosp-beds-result" role="status"></p>' : '<p class="info-label">Only the hospital owner or reception team can update live bed availability.</p>'}`;

  const departmentControls = canEditDepartments ? `
    <div class="md-field" style="margin-top:1rem;"><label>Add department</label><div class="md-input-wrap"><input class="md-input" id="hosp-dept-new" placeholder="e.g. Neurology"></div></div>
    <button type="button" class="md-btn md-btn-outlined" id="hosp-add-dept-btn">Add</button>
    <button type="button" class="md-btn md-btn-filled" id="hosp-save-dept-btn" style="margin-left:0.5rem;">Save departments</button>
    <p class="form-result" id="hosp-dept-result" role="status"></p>` : '<p class="info-label" style="margin-top:1rem;">Departments are managed by the hospital owner.</p>';

  const bookingView = role === "hospital_doctor" || role === "hospital_reception" ? `
    <div class="profile-card full-width">
      <div class="profile-card-header"><h2>Recent ambulance requests</h2></div>
      <div class="profile-card-body">
        ${(data.bookings || []).length ? data.bookings.slice(0, 8).map(b => `<div class="list-item"><div><strong>Booking #${escapeHtml(b.id)}</strong><div class="info-label">${escapeHtml(b.patientName || "Patient")} · ${escapeHtml(b.emergencyType || "Emergency")}</div></div><span class="role-badge">${escapeHtml(b.status)}</span></div>`).join("") : '<div class="empty-state-card">No ambulance requests for this hospital yet.</div>'}
      </div>
    </div>` : "";

  el.innerHTML = `
    <div class="profile-card full-width">
      <div class="profile-card-header"><h2>${escapeHtml(hospital.name)}</h2></div>
      <div class="profile-card-body">
        ${infoRow("Status", hospital.status)}
        ${infoRow("City", hospital.city)}
        ${infoRow("Address", hospital.address)}
        ${infoRow("Phone", hospital.phone)}
        ${hospital.status === "pending" ? '<div class="empty-state-card" style="margin-top:1rem;">Waiting on admin approval before patients can see this hospital.</div>' : ""}
      </div>
    </div>
    <div class="profile-card">
      <div class="profile-card-header"><h2>Beds</h2></div>
      <div class="profile-card-body">
        ${bedFields}
      </div>
    </div>
    <div class="profile-card">
      <div class="profile-card-header"><h2>Departments</h2></div>
      <div class="profile-card-body">
        <div id="hosp-dept-list">${(hospital.departments || []).map(deptRow).join("") || '<div class="empty-state-card">No departments added yet.</div>'}</div>
        ${departmentControls}
      </div>
    </div>
    ${bookingView}
  `;

  document.getElementById("hosp-save-beds-btn")?.addEventListener("click", async () => {
    const result = document.getElementById("hosp-beds-result");
    try {
      const updated = await profileApi(`/api/hospitals/${hospital.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          totalBeds: Number(document.getElementById("hosp-total-beds").value),
          availableBeds: Number(document.getElementById("hosp-available-beds").value)
        })
      });
      data.hospital = { ...data.hospital, ...updated };
      result.textContent = "Saved.";
      renderRoute();
    } catch (err) {
      result.textContent = err.message;
    }
  });

  document.getElementById("hosp-add-dept-btn")?.addEventListener("click", () => {
    const input = document.getElementById("hosp-dept-new");
    const name = input.value.trim();
    if (!name) return;
    hospital.departments = hospital.departments || [];
    hospital.departments.push({ name, status: "available" });
    input.value = "";
    renderRoute();
  });

  document.getElementById("hosp-dept-list")?.addEventListener("click", e => {
    if (e.target.matches("[data-dept-remove]")) {
      const row = e.target.closest("[data-dept-index]");
      hospital.departments.splice(Number(row.dataset.deptIndex), 1);
      renderRoute();
    }
  });

  document.getElementById("hosp-save-dept-btn")?.addEventListener("click", async () => {
    const result = document.getElementById("hosp-dept-result");
    const rows = document.querySelectorAll("#hosp-dept-list [data-dept-index]");
    const departments = Array.from(rows).map(row => ({
      name: row.querySelector("strong").textContent,
      status: row.querySelector("[data-dept-status]").value
    }));
    try {
      const updated = await profileApi(`/api/hospitals/${hospital.id}`, {
        method: "PATCH",
        body: JSON.stringify({ departments })
      });
      data.hospital = { ...data.hospital, ...updated };
      result.textContent = "Saved.";
      renderRoute();
    } catch (err) {
      result.textContent = err.message;
    }
  });
}

// ---------------------------------------------------------------------
// Hospital team (hospital_admin only)
// ---------------------------------------------------------------------
async function renderHospitalTeam(el) {
  const team = data.hospitalTeam || await profileApi("/api/profile/hospital-team");
  data.hospitalTeam = team;
  const roleLabels = { hospital_doctor: "Doctor", hospital_reception: "Reception", hospital_staff: "Staff" };

  el.innerHTML = `
    <div class="profile-card full-width">
      <div class="profile-card-header"><h2>Hospital team</h2></div>
      <div class="profile-card-body">
        <p class="info-label" style="margin-bottom:1rem;">Create focused accounts for doctors, reception, and staff. They can only access the hospital work relevant to their role.</p>
        ${team.length ? team.map(member => `
          <div class="list-item">
            <div style="flex:1;"><strong>${escapeHtml(member.fullName)}</strong><div class="info-label">${escapeHtml(roleLabels[member.role] || member.roleName)} · ${escapeHtml(member.department || "No department")}${member.designation ? " · " + escapeHtml(member.designation) : ""}</div><div class="info-label">${escapeHtml(member.email)} · ${escapeHtml(member.phone)}</div></div>
            <span class="role-badge">${escapeHtml(member.status)}</span>
          </div>`).join("") : '<div class="empty-state-card">No team members added yet.</div>'}
      </div>
    </div>
    <div class="profile-card full-width">
      <div class="profile-card-header"><h2>Add team member</h2></div>
      <div class="profile-card-body">
        <form id="hospital-team-form" class="edit-form">
          <div class="grid grid-2">
            <div class="md-field"><label for="team-name">Full name</label><div class="md-input-wrap"><input class="md-input" id="team-name" required></div></div>
            <div class="md-field"><label for="team-role">Role</label><div class="md-input-wrap"><select class="md-input" id="team-role"><option value="doctor">Doctor</option><option value="reception">Reception</option><option value="staff">Staff</option></select></div></div>
          </div>
          <div class="grid grid-2">
            <div class="md-field"><label for="team-email">Email</label><div class="md-input-wrap"><input class="md-input" type="email" id="team-email" required></div></div>
            <div class="md-field"><label for="team-phone">Phone</label><div class="md-input-wrap"><input class="md-input" type="tel" id="team-phone" required></div></div>
          </div>
          <div class="grid grid-2">
            <div class="md-field"><label for="team-password">Temporary password</label><div class="md-input-wrap"><input class="md-input" type="password" id="team-password" minlength="8" required></div></div>
            <div class="md-field"><label for="team-department">Department</label><div class="md-input-wrap"><input class="md-input" id="team-department" placeholder="Emergency / Front Desk"></div></div>
          </div>
          <div class="md-field"><label for="team-designation">Designation</label><div class="md-input-wrap"><input class="md-input" id="team-designation" placeholder="Optional"></div></div>
          <div class="form-actions"><button type="submit" class="md-btn md-btn-filled">Create team account</button></div>
          <p class="form-result" id="hospital-team-result" role="status"></p>
        </form>
      </div>
    </div>`;

  document.getElementById("hospital-team-form").addEventListener("submit", async e => {
    e.preventDefault();
    const result = document.getElementById("hospital-team-result");
    try {
      const member = await profileApi("/api/profile/hospital-team", {
        method: "POST",
        body: JSON.stringify({
          fullName: document.getElementById("team-name").value.trim(),
          teamRole: document.getElementById("team-role").value,
          email: document.getElementById("team-email").value.trim(),
          phone: document.getElementById("team-phone").value.trim(),
          password: document.getElementById("team-password").value,
          department: document.getElementById("team-department").value.trim(),
          designation: document.getElementById("team-designation").value.trim()
        })
      });
      data.hospitalTeam.unshift(member);
      toast("Team account created", "success");
      renderRoute();
    } catch (err) {
      result.textContent = err.message;
    }
  });
}

// ---------------------------------------------------------------------
// Fleet (fleet_owner)
// ---------------------------------------------------------------------
function renderFleet(el) {
  const fleet = data.fleet || [];
  const AMBULANCE_STATUSES = ["available", "busy", "maintenance", "offline"];

  el.innerHTML = `
    <div class="profile-card full-width">
      <div class="profile-card-header"><h2>My ambulances</h2></div>
      <div class="profile-card-body">
        ${fleet.length ? fleet.map(a => `
          <div class="list-item">
            <div style="flex:1;">
              <strong>${escapeHtml(a.registrationNumber)}</strong>
              <div class="info-label">${escapeHtml(a.type)}${a.driverId ? " · driver assigned" : " · no driver assigned"}</div>
            </div>
            <select class="md-input" style="max-width:160px;" data-ambulance-id="${a.id}">
              ${AMBULANCE_STATUSES.map(s => `<option value="${s}" ${a.status === s ? "selected" : ""}>${s}</option>`).join("")}
            </select>
          </div>
        `).join("") : '<div class="empty-state-card">No ambulances yet — add your first one below.</div>'}
      </div>
    </div>
    <div class="profile-card full-width">
      <div class="profile-card-header"><h2>Add an ambulance</h2></div>
      <div class="profile-card-body">
        <form id="add-ambulance-form" class="edit-form">
          <div class="md-field"><label>Registration number</label><div class="md-input-wrap"><input class="md-input" id="amb-reg" required></div></div>
          <div class="md-field"><label>Type</label><div class="md-input-wrap">
            <select class="md-input" id="amb-type">
              <option value="basic">Basic</option>
              <option value="advanced">Advanced</option>
              <option value="icu">ICU</option>
              <option value="neonatal">Neonatal</option>
            </select>
          </div></div>
          <div class="md-field"><label>Contact phone</label><div class="md-input-wrap"><input class="md-input" type="tel" id="amb-phone" required></div></div>
          <div class="md-field"><label>Contact email</label><div class="md-input-wrap"><input class="md-input" type="email" id="amb-email" required></div></div>
          <div class="form-actions"><button type="submit" class="md-btn md-btn-filled">Add ambulance</button></div>
          <p class="form-result" id="add-ambulance-result" role="status"></p>
        </form>
      </div>
    </div>
  `;

  el.querySelectorAll("[data-ambulance-id]").forEach(select => {
    select.addEventListener("change", async () => {
      try {
        await profileApi(`/api/ambulances/${select.dataset.ambulanceId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: select.value })
        });
        const item = data.fleet.find(a => a.id === Number(select.dataset.ambulanceId));
        if (item) item.status = select.value;
        toast("Status updated", "success");
      } catch (err) {
        toast(err.message, "error");
      }
    });
  });

  document.getElementById("add-ambulance-form").addEventListener("submit", async e => {
    e.preventDefault();
    const result = document.getElementById("add-ambulance-result");
    try {
      const created = await profileApi("/api/ambulances", {
        method: "POST",
        body: JSON.stringify({
          registrationNumber: document.getElementById("amb-reg").value.trim(),
          type: document.getElementById("amb-type").value,
          driverName: "Unassigned",
          phone: document.getElementById("amb-phone").value.trim(),
          email: document.getElementById("amb-email").value.trim()
        })
      });
      data.fleet.push(created);
      toast("Ambulance added — starts offline until you activate it", "success");
      renderRoute();
    } catch (err) {
      result.textContent = err.message;
    }
  });
}

// ---------------------------------------------------------------------
// Fleet drivers (fleet_owner)
// ---------------------------------------------------------------------
function renderFleetDrivers(el) {
  const drivers = data.drivers || [];
  const fleet = data.fleet || [];

  el.innerHTML = `
    <div class="profile-card full-width">
      <div class="profile-card-header"><h2>Your fleet code</h2></div>
      <div class="profile-card-body">
        <p class="info-label">Share this with drivers so they can link their account to your fleet at signup.</p>
        <div class="stat-card" style="max-width:200px; margin-top:0.75rem;"><strong>${escapeHtml(data.profile?.fleetCode || "")}</strong><span>Fleet code</span></div>
      </div>
    </div>
    <div class="profile-card full-width">
      <div class="profile-card-header"><h2>Drivers</h2></div>
      <div class="profile-card-body">
        ${drivers.length ? drivers.map(d => `
          <div class="list-item">
            <div style="flex:1;">
              <strong>${escapeHtml(d.fullName)}</strong>
              <div class="info-label">${escapeHtml(d.phone || "")} · ${escapeHtml(d.availabilityStatus || "unknown")}</div>
            </div>
            <select class="md-input" style="max-width:220px;" data-driver-id="${d.id}">
              <option value="">Not assigned</option>
              ${fleet.map(a => `<option value="${a.id}" ${d.assignedAmbulanceId === a.id ? "selected" : ""}>${escapeHtml(a.registrationNumber)}</option>`).join("")}
            </select>
          </div>
        `).join("") : '<div class="empty-state-card">No drivers linked yet. Share your fleet code above.</div>'}
      </div>
    </div>
  `;

  el.querySelectorAll("[data-driver-id]").forEach(select => {
    select.addEventListener("change", async () => {
      const driverId = Number(select.dataset.driverId);
      const ambulanceId = select.value ? Number(select.value) : null;
      try {
        if (ambulanceId) {
          await profileApi(`/api/ambulances/${ambulanceId}`, { method: "PATCH", body: JSON.stringify({ driverId }) });
        } else {
          const current = fleet.find(a => a.driverId === driverId);
          if (current) await profileApi(`/api/ambulances/${current.id}`, { method: "PATCH", body: JSON.stringify({ driverId: null }) });
        }
        toast("Assignment updated", "success");
        renderRoute();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  });
}

boot();
