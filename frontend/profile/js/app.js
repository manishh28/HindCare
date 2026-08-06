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
  system: '<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>'
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

const ROLE_NAV = {
  driver: [{ id: "documents", label: "Documents", icon: "file" }],
  dispatcher: [],
  hospital_admin: [{ id: "activity", label: "Activity Log", icon: "activity" }],
  super_admin: [
    { id: "activity", label: "Activity Log", icon: "activity" },
    { id: "system", label: "System", icon: "system" }
  ]
};

const PAGE_TITLES = {
  overview: "Overview",
  edit: "Edit Profile",
  notifications: "Notifications",
  contacts: "Emergency Contacts",
  addresses: "Addresses",
  documents: "Documents",
  activity: "Activity Log",
  system: "System"
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

function logout() {
  clearProfileAuth();
  window.location.href = "/auth/";
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
  activity: renderActivity,
  system: renderSystem
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
      </div>`;
  } else if (role === "dispatcher") {
    statsHtml = statCard(profile.callsHandled, "Calls handled") + statCard(profile.avgResponseSeconds, "Avg. response (s)") + statCard(`${profile.shiftStart}–${profile.shiftEnd}`, "Shift");
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
      </div>`;
  } else if (role === "hospital_admin") {
    const hospital = await resolveHospital(profile.hospitalId);
    statsHtml = statCard(hospital ? `${hospital.availableBeds}/${hospital.totalBeds}` : "—", "Beds available")
      + statCard(formatDate(profile.licenseExpiry), "License expiry")
      + statCard(hospital?.city || "—", "City");
  } else if (role === "super_admin") {
    const sys = data.systemInfo || {};
    statsHtml = statCard(sys.environment || "—", "Environment")
      + statCard(sys.uptime ? `${Math.floor(sys.uptime / 60)}m` : "—", "Server uptime")
      + statCard((data.apiKeys || []).length, "Active API keys");
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
      + infoRow("GST number", profile.gstNumber)
      + infoRow("Hospital license", profile.licenseNumber)
      + infoRow("Email notifications", profile.notificationEmail ? "On" : "Off")
      + infoRow("SMS notifications", profile.notificationSms ? "On" : "Off");
  }
  if (role === "super_admin") {
    return common
      + infoRow("Full name", profile.fullName)
      + infoRow("Organization", profile.organizationName)
      + infoRow("API access", profile.apiKeysEnabled ? "Enabled" : "Disabled");
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
  super_admin: [
    { key: "fullName", label: "Full name", type: "text" },
    { key: "organizationName", label: "Organization name", type: "text" }
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
                <input type="file" id="photo-input" accept="image/*" class="hidden">
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

boot();
