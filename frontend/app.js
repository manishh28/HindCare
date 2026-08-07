const state = {
  hospitals: [],
  ambulances: [],
  bookings: [],
  role: "",
  destinationManuallySet: false
};

const chatSessionId =
  window.crypto && window.crypto.randomUUID
    ? window.crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;

// Same known-area vocabulary the backend geocoder uses, kept small and
// duplicated on purpose — the frontend only needs it to auto-suggest a
// hospital by city, not to compute real distances.
const CITY_GUESSES = [
  { keywords: ["gomti nagar", "sgpgi", "lucknow"], city: "Lucknow" },
  { keywords: ["mall road", "kanpur"], city: "Kanpur" }
];

function guessCityFromPickup(text) {
  const lower = String(text || "").toLowerCase();
  for (const guess of CITY_GUESSES) {
    if (guess.keywords.some(keyword => lower.includes(keyword))) {
      return guess.city;
    }
  }
  return null;
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (state.role) {
    headers["X-Demo-Role"] = state.role;
  }

  const response = await fetch(path, { ...options, headers });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function formToObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

// ---------------------------------------------------------------------
// Hospitals
// ---------------------------------------------------------------------

function renderHospitals() {
  const list = document.getElementById("hospital-list");
  const isAdmin = state.role === "admin";

  if (!state.hospitals.length) {
    list.innerHTML = `<p class="empty-note">No hospitals yet.</p>`;
    return;
  }

  list.innerHTML = state.hospitals.map(hospital => `
    <article class="item" data-hospital-id="${hospital.id}">
      <div class="item-header">
        <strong>${hospital.name}</strong>
        <span class="badge ${hospital.status}">${hospital.status}</span>
      </div>
      <p>${hospital.address}</p>
      <p class="item-meta">${hospital.phone}${hospital.email ? ` — ${hospital.email}` : ""}</p>
      <p class="availability">${hospital.availableBeds}/${hospital.totalBeds} beds available</p>
      ${isAdmin && hospital.status === "pending" ? `
        <div class="row-actions">
          <button type="button" class="ghost-button" data-hospital-action="approved">Approve</button>
          <button type="button" class="ghost-button danger" data-hospital-action="rejected">Reject</button>
        </div>
      ` : ""}
    </article>
  `).join("");

  if (isAdmin) {
    list.querySelectorAll("[data-hospital-action]").forEach(button => {
      button.addEventListener("click", async () => {
        const card = button.closest("[data-hospital-id]");
        const id = card.getAttribute("data-hospital-id");
        try {
          await api(`/api/hospitals/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: button.getAttribute("data-hospital-action") })
          });
          await refreshHospitals();
        } catch (error) {
          window.alert(error.message);
        }
      });
    });
  }
}

function populateDestinationSelect(preferredCity) {
  const select = document.getElementById("destination-select");
  const hint = document.getElementById("destination-hint");
  const approved = state.hospitals.filter(hospital => hospital.status === "approved");
  const previousValue = select.value;

  if (!approved.length) {
    select.innerHTML = `<option value="">No approved hospitals yet</option>`;
    hint.textContent = "";
    return;
  }

  select.innerHTML = approved.map(hospital =>
    `<option value="${hospital.id}" data-city="${hospital.city}">${hospital.name} — ${hospital.city}</option>`
  ).join("");

  if (!state.destinationManuallySet && preferredCity) {
    const match = approved.find(hospital => hospital.city.toLowerCase() === preferredCity.toLowerCase());
    if (match) {
      select.value = String(match.id);
      hint.textContent = `Nearest match for ${preferredCity}`;
      return;
    }
  }

  if (approved.some(hospital => String(hospital.id) === previousValue)) {
    select.value = previousValue;
  }
  if (!state.destinationManuallySet && !preferredCity) {
    hint.textContent = "";
  }
}

document.getElementById("pickup-input").addEventListener("input", event => {
  const city = guessCityFromPickup(event.target.value);
  if (city) {
    populateDestinationSelect(city);
  }
});

document.getElementById("destination-select").addEventListener("change", () => {
  state.destinationManuallySet = true;
  document.getElementById("destination-hint").textContent = "";
});

// ---------------------------------------------------------------------
// Ambulances
// ---------------------------------------------------------------------

function renderAmbulances() {
  const list = document.getElementById("ambulance-list");
  const canManage = state.role === "fleet" || state.role === "admin";
  // Driver name and personal phone are only useful to roles that actually
  // coordinate dispatch — showing them to every site visitor would let
  // anyone call a driver directly, bypassing dispatch entirely.
  const canSeeDriverInfo = state.role === "fleet" || state.role === "admin";
  const statuses = ["available", "busy", "maintenance", "offline"];

  if (!state.ambulances.length) {
    list.innerHTML = `<p class="empty-note">No ambulances yet.</p>`;
    return;
  }

  list.innerHTML = state.ambulances.map(ambulance => `
    <article class="item" data-ambulance-id="${ambulance.id}">
      <div class="item-header">
        <strong>${ambulance.registrationNumber}</strong>
        <span class="badge ${ambulance.status}">${ambulance.status}</span>
      </div>
      <p>${ambulance.type} ambulance</p>
      ${canSeeDriverInfo ? `<p class="item-meta">${ambulance.driverName} — ${ambulance.phone}${ambulance.email ? ` — ${ambulance.email}` : ""}</p>` : ""}
      ${canManage ? `
        <label class="inline-select">
          Update status
          <select data-ambulance-status>
            ${statuses.map(status => `<option value="${status}" ${status === ambulance.status ? "selected" : ""}>${status}</option>`).join("")}
          </select>
        </label>
      ` : ""}
    </article>
  `).join("");

  if (canManage) {
    list.querySelectorAll("[data-ambulance-status]").forEach(select => {
      select.addEventListener("change", async () => {
        const card = select.closest("[data-ambulance-id]");
        const id = card.getAttribute("data-ambulance-id");
        try {
          await api(`/api/ambulances/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: select.value })
          });
          await refreshAmbulances();
        } catch (error) {
          window.alert(error.message);
        }
      });
    });
  }
}

// ---------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------

const BOOKING_NEXT_STEPS = {
  requested: [["assigned", "Mark assigned"], ["cancelled", "Cancel"]],
  assigned: [["on_route", "Mark on route"], ["cancelled", "Cancel"]],
  on_route: [["completed", "Mark completed"], ["cancelled", "Cancel"]],
  completed: [],
  cancelled: []
};

// Friendlier, plain-language labels for the raw status values the API uses.
const STATUS_LABELS = {
  requested: "Finding ambulance",
  assigned: "Assigned",
  on_route: "En route",
  completed: "Completed",
  cancelled: "Cancelled"
};

function statusChip(status) {
  const label = STATUS_LABELS[status] || status;
  return `<span class="status-chip status-${status}">${label}</span>`;
}

function renderBookings() {
  const list = document.getElementById("booking-list");
  const canManage = state.role === "fleet" || state.role === "admin";
  // Patient name and phone are personal information — only show them to
  // roles that legitimately need them for dispatch, never to any visitor
  // who happens to load the public network view.
  const canSeePatientInfo = state.role === "fleet" || state.role === "admin" || state.role === "hospital";

  if (!state.bookings.length) {
    list.innerHTML = `<p class="empty-note">No bookings yet.</p>`;
    return;
  }

  list.innerHTML = [...state.bookings].reverse().map(booking => {
    const ambulance = state.ambulances.find(item => item.id === booking.ambulanceId);
    const nextSteps = BOOKING_NEXT_STEPS[booking.status] || [];
    return `
    <article class="item" data-booking-id="${booking.id}">
      <div class="item-header">
        <strong>#${booking.id}${canSeePatientInfo ? ` — ${booking.patientName}` : ""}</strong>
        ${statusChip(booking.status)}
      </div>
      <p>${booking.pickup} → ${booking.destination}</p>
      <p class="item-meta">
        ${ambulance ? `${ambulance.registrationNumber} (${ambulance.driverName})` : "No ambulance assigned yet"}
        ${booking.dispatchDistanceKm != null ? ` · ~${booking.dispatchDistanceKm} km` : ""}
      </p>
      ${canManage && nextSteps.length ? `
        <div class="row-actions">
          ${nextSteps.map(([status, label]) => `<button type="button" class="ghost-button ${status === "cancelled" ? "danger" : ""}" data-booking-status="${status}">${label}</button>`).join("")}
        </div>
      ` : ""}
    </article>
  `;
  }).join("");

  if (canManage) {
    list.querySelectorAll("[data-booking-status]").forEach(button => {
      button.addEventListener("click", async () => {
        const card = button.closest("[data-booking-id]");
        const id = card.getAttribute("data-booking-id");
        try {
          await api(`/api/bookings/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: button.getAttribute("data-booking-status") })
          });
          await Promise.all([refreshBookings(), refreshAmbulances()]);
        } catch (error) {
          window.alert(error.message);
        }
      });
    });
  }
}

// ---------------------------------------------------------------------
// Dashboard refresh — each section independent so one failure doesn't
// blank the whole page.
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Honest stats strip — computed from real (if small) demo data, never
// invented numbers.
// ---------------------------------------------------------------------

function renderHeroStats() {
  const fleetEl = document.getElementById("stat-fleet");
  if (!fleetEl) return; // stats strip not on this page

  const fleetReady = state.ambulances.filter(a => a.status === "available").length;
  const hospitalsApproved = state.hospitals.filter(h => h.status === "approved").length;
  const cities = new Set(state.hospitals.filter(h => h.status === "approved").map(h => h.city)).size;
  const distances = state.bookings
    .map(b => b.dispatchDistanceKm)
    .filter(value => typeof value === "number");
  const avgDistance = distances.length
    ? `${(distances.reduce((sum, d) => sum + d, 0) / distances.length).toFixed(1)} km`
    : "—";

  fleetEl.textContent = fleetReady;
  document.getElementById("stat-hospitals").textContent = hospitalsApproved;
  document.getElementById("stat-cities").textContent = cities;
  document.getElementById("stat-distance").textContent = avgDistance;
}

async function refreshHospitals() {
  try {
    state.hospitals = await api("/api/hospitals");
    renderHospitals();
    populateDestinationSelect(guessCityFromPickup(document.getElementById("pickup-input").value));
    renderHeroStats();
  } catch (error) {
    document.getElementById("hospital-list").innerHTML = `<p class="load-error">${error.message}</p>`;
  }
}

async function refreshAmbulances() {
  try {
    state.ambulances = await api("/api/ambulances");
    renderAmbulances();
    renderBookings();
    renderHeroStats();
  } catch (error) {
    document.getElementById("ambulance-list").innerHTML = `<p class="load-error">${error.message}</p>`;
  }
}

async function refreshBookings() {
  try {
    state.bookings = await api("/api/bookings");
    renderBookings();
    renderHeroStats();
  } catch (error) {
    document.getElementById("booking-list").innerHTML = `<p class="load-error">${error.message}</p>`;
  }
}

async function refreshDashboard() {
  await Promise.allSettled([refreshHospitals(), refreshAmbulances(), refreshBookings()]);
}

// ---------------------------------------------------------------------
// Floating panels — assistant chat and partner sign-up both open on
// click from the nav links or their floating action buttons, rather
// than living inline in the page.
// ---------------------------------------------------------------------

// The partner panel's actual show/hide target is its backdrop wrapper
// (so the dark overlay + centering both toggle together); the chat
// panel toggles itself directly.
const PANEL_TARGETS = {
  "partner-panel": "partner-panel-backdrop",
  "network-panel": "network-panel-backdrop",
  "contact-panel": "contact-panel-backdrop",
  "terms-panel": "terms-panel-backdrop",
  "privacy-panel": "privacy-panel-backdrop",
  "account-panel": "account-panel-backdrop"
};

function panelElement(key) {
  return document.getElementById(PANEL_TARGETS[key] || key);
}

function openPanel(key) {
  const el = panelElement(key);
  if (el) el.classList.remove("hidden");
  if (key === "account-panel") renderAccountPanel();
}

function closePanel(key) {
  const el = panelElement(key);
  if (el) el.classList.add("hidden");
}

document.querySelectorAll("[data-open]").forEach(button => {
  button.addEventListener("click", () => openPanel(button.getAttribute("data-open")));
});

document.querySelectorAll("[data-close]").forEach(element => {
  element.addEventListener("click", event => {
    // Close buttons always close. The backdrop only closes on a direct
    // click on the backdrop itself, not on clicks inside the modal card
    // that happen to bubble up to it.
    const isDirectHit = event.target === event.currentTarget;
    const isCloseButton = element.tagName === "BUTTON";
    if (isDirectHit || isCloseButton) {
      closePanel(element.getAttribute("data-close"));
    }
  });
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closePanel("chat-panel");
    closePanel("partner-panel");
    closePanel("network-panel");
    closePanel("contact-panel");
    closePanel("terms-panel");
    closePanel("privacy-panel");
    closePanel("account-panel");
  }
});

// ---------------------------------------------------------------------
// Role switcher (demo only — see docs/security-and-privacy.md)
// ---------------------------------------------------------------------

document.getElementById("demo-role").addEventListener("change", event => {
  state.role = event.target.value;
  renderHospitals();
  renderAmbulances();
  renderBookings();
});

// ---------------------------------------------------------------------
// Quick booking form
// ---------------------------------------------------------------------

document.getElementById("booking-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const result = document.getElementById("booking-result");
  result.textContent = "Requesting ambulance…";

  try {
    const booking = await api("/api/bookings", {
      method: "POST",
      body: JSON.stringify(formToObject(form))
    });
    const ambulanceNote = booking.ambulanceId
      ? `Ambulance ${state.ambulances.find(a => a.id === booking.ambulanceId)?.registrationNumber || booking.ambulanceId} is on the way${booking.dispatchDistanceKm != null ? ` (~${booking.dispatchDistanceKm} km out)` : ""}.`
      : "No ambulance is free right now — you're first in line for the next one.";
    result.textContent = `Booking #${booking.id} confirmed. ${ambulanceNote}`;
    form.reset();
    state.destinationManuallySet = false;
    await Promise.all([refreshBookings(), refreshAmbulances()]);
    populateDestinationSelect();
  } catch (error) {
    result.textContent = error.message;
  }
});

// ---------------------------------------------------------------------
// Partner onboarding — a dropdown picks which single screen shows,
// instead of both partner types being visible at once.
// ---------------------------------------------------------------------

const PARTNER_SCREENS = {
  hospital: "hospital-partner-screen",
  ambulance: "ambulance-partner-screen"
};

document.getElementById("partner-type-select").addEventListener("change", event => {
  const emptyNote = document.getElementById("partner-empty-note");
  Object.values(PARTNER_SCREENS).forEach(id => {
    document.getElementById(id).classList.add("hidden");
  });

  const screenId = PARTNER_SCREENS[event.target.value];
  if (screenId) {
    document.getElementById(screenId).classList.remove("hidden");
    emptyNote.classList.add("hidden");
  } else {
    emptyNote.classList.remove("hidden");
  }
});

document.getElementById("hospital-partner-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const result = document.getElementById("hospital-partner-result");
  result.textContent = "Submitting…";

  try {
    const hospital = await api("/api/hospitals", {
      method: "POST",
      body: JSON.stringify(formToObject(form))
    });
    result.textContent = `Thanks — ${hospital.name} is submitted and pending admin review.`;
    form.reset();
    await refreshHospitals();
  } catch (error) {
    result.textContent = error.message;
  }
});

document.getElementById("fleet-partner-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const result = document.getElementById("fleet-partner-result");
  result.textContent = "Submitting…";

  try {
    const ambulance = await api("/api/ambulances", {
      method: "POST",
      body: JSON.stringify(formToObject(form))
    });
    result.textContent = `Thanks — ${ambulance.registrationNumber} has been added to the fleet.`;
    form.reset();
    await refreshAmbulances();
  } catch (error) {
    result.textContent = error.message;
  }
});

// ---------------------------------------------------------------------
// Chatbot
// ---------------------------------------------------------------------

function appendChatMessage(role, text) {
  const transcript = document.getElementById("chat-transcript");
  const bubble = document.createElement("p");
  bubble.className = `chat-bubble chat-${role}`;
  bubble.textContent = text;
  transcript.appendChild(bubble);
  transcript.scrollTop = transcript.scrollHeight;
}

document.getElementById("chatbot-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = formToObject(form).message;
  appendChatMessage("user", message);
  form.reset();

  try {
    const data = await api("/api/chatbot/message", {
      method: "POST",
      body: JSON.stringify({ message, sessionId: chatSessionId })
    });
    appendChatMessage("bot", data.reply);
    if (data.booking || data.hospitals) {
      await refreshDashboard();
      populateDestinationSelect();
    }
  } catch (error) {
    appendChatMessage("bot", error.message);
  }
});

appendChatMessage("bot", "Hi! I can help book an ambulance, find nearby hospitals, or route you to support. What do you need?");

// ---------------------------------------------------------------------
// Track your booking — an honest stand-in for live GPS tracking: looks
// up the real booking status by ID + phone through a backend endpoint
// that only returns a match for the correct pair, so a stranger can't
// pull up someone else's booking just by guessing a small ID number.
// The "estimated arrival" is a rough calculation from dispatch distance,
// not a live GPS feed, and is labeled as such.
// ---------------------------------------------------------------------

function estimatedArrivalMinutes(distanceKm) {
  if (typeof distanceKm !== "number") return null;
  const assumedSpeedKmh = 40; // rough urban emergency-response average — an estimate, not a live calculation
  return Math.max(1, Math.round((distanceKm / assumedSpeedKmh) * 60));
}

document.getElementById("tracker-form").addEventListener("submit", async event => {
  event.preventDefault();
  const { bookingId, phone } = formToObject(event.currentTarget);
  const result = document.getElementById("tracker-result");
  result.innerHTML = `<p>Looking up…</p>`;

  try {
    const booking = await api(`/api/bookings/lookup?id=${encodeURIComponent(bookingId)}&phone=${encodeURIComponent(phone)}`);
    const eta = estimatedArrivalMinutes(booking.dispatchDistanceKm);
    const showEta = eta != null && !["completed", "cancelled"].includes(booking.status);

    result.innerHTML = `
      <div class="tracker-row"><span>Status</span>${statusChip(booking.status)}</div>
      <div class="tracker-row"><span>Destination</span><span>${booking.destination}</span></div>
      ${booking.ambulance
        ? `<div class="tracker-row"><span>Ambulance</span><span>${booking.ambulance.registrationNumber}</span></div>
           <div class="tracker-row"><span>Driver</span><span>${booking.ambulance.driverName}</span></div>`
        : `<div class="tracker-row"><span>Ambulance</span><span>Not yet assigned</span></div>`}
      ${showEta ? `<div class="tracker-row"><span>Est. arrival</span><span>~${eta} min (approx.)</span></div>` : ""}
    `;
  } catch (error) {
    result.innerHTML = `<p>${error.message}</p>`;
  }
});

refreshDashboard().catch(error => {
  document.body.insertAdjacentHTML("afterbegin", `<p class="load-error">${error.message}</p>`);
});

const footerYear = document.getElementById("footer-year");
if (footerYear) {
  footerYear.textContent = String(new Date().getFullYear());
}

// ---------------------------------------------------------------------
// Patient accounts — entirely optional. Booking works with no account at
// all; signing in just saves your name/phone for next time and shows a
// history of bookings tied to your account or made as a guest with the
// same phone number. Kept in its own storage namespace (hindcare_patient_*)
// so it never collides with the separate staff/ERP session under /auth/.
// ---------------------------------------------------------------------

const PATIENT_KEY = "hindcare_patient";

const patientState = {
  accessToken: localStorage.getItem(`${PATIENT_KEY}_token`) || null,
  refreshToken: localStorage.getItem(`${PATIENT_KEY}_refresh`) || null,
  user: JSON.parse(localStorage.getItem(`${PATIENT_KEY}_user`) || "null"),
  profile: JSON.parse(localStorage.getItem(`${PATIENT_KEY}_profile`) || "null")
};

function savePatientAuth(data) {
  patientState.accessToken = data.accessToken;
  patientState.refreshToken = data.refreshToken;
  patientState.user = data.user;
  patientState.profile = data.profile;
  localStorage.setItem(`${PATIENT_KEY}_token`, data.accessToken);
  if (data.refreshToken) localStorage.setItem(`${PATIENT_KEY}_refresh`, data.refreshToken);
  localStorage.setItem(`${PATIENT_KEY}_user`, JSON.stringify(data.user));
  localStorage.setItem(`${PATIENT_KEY}_profile`, JSON.stringify(data.profile));
}

function clearPatientAuth() {
  patientState.accessToken = null;
  patientState.refreshToken = null;
  patientState.user = null;
  patientState.profile = null;
  localStorage.removeItem(`${PATIENT_KEY}_token`);
  localStorage.removeItem(`${PATIENT_KEY}_refresh`);
  localStorage.removeItem(`${PATIENT_KEY}_user`);
  localStorage.removeItem(`${PATIENT_KEY}_profile`);
}

async function patientApi(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (patientState.accessToken) headers.Authorization = `Bearer ${patientState.accessToken}`;

  let response = await fetch(path, { ...options, headers });
  let data = await response.json().catch(() => ({}));

  if (response.status === 401 && patientState.refreshToken && !options._retried) {
    const refreshRes = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: patientState.refreshToken })
    });
    if (refreshRes.ok) {
      const refreshData = await refreshRes.json();
      patientState.accessToken = refreshData.accessToken;
      localStorage.setItem(`${PATIENT_KEY}_token`, refreshData.accessToken);
      return patientApi(path, { ...options, _retried: true });
    }
    clearPatientAuth();
    updateAccountNav();
    throw new Error("Your session expired. Please sign in again.");
  }

  if (!response.ok) {
    const err = new Error(data.error || "Something went wrong");
    err.code = data.code;
    throw err;
  }
  return data;
}

function updateAccountNav() {
  const btn = document.getElementById("account-nav-btn");
  if (!btn) return;
  btn.textContent = patientState.user ? (patientState.profile?.fullName?.split(" ")[0] || "My account") : "Sign in";

  // A light convenience touch: prefill the booking form for a returning signed-in patient.
  if (patientState.user) {
    const form = document.getElementById("booking-form");
    if (form) {
      if (!form.elements.patientName.value) form.elements.patientName.value = patientState.profile?.fullName || "";
      if (!form.elements.phone.value) form.elements.phone.value = patientState.user.phone || "";
    }
  }
}

function renderAccountPanel() {
  const authView = document.getElementById("account-auth-view");
  const dashView = document.getElementById("account-dashboard-view");

  if (!patientState.user) {
    authView.classList.remove("hidden");
    dashView.classList.add("hidden");
    return;
  }

  authView.classList.add("hidden");
  dashView.classList.remove("hidden");
  document.getElementById("account-name").textContent = patientState.profile?.fullName || "there";
  document.getElementById("account-phone").textContent = patientState.user.phone || "";
  document.getElementById("account-fullname-input").value = patientState.profile?.fullName || "";
  renderAccountBookings();
}

async function renderAccountBookings() {
  const list = document.getElementById("account-bookings-list");
  list.innerHTML = `<p class="empty-note">Loading…</p>`;
  try {
    const bookings = await patientApi("/api/my-bookings");
    if (!bookings.length) {
      list.innerHTML = `<p class="empty-note">No bookings yet. Once you book an ambulance, it'll show up here.</p>`;
      return;
    }
    list.innerHTML = bookings.map(booking => `
      <article class="item">
        <div class="item-header">
          <strong>#${booking.id}</strong>
          ${statusChip(booking.status)}
        </div>
        <p>${booking.pickup} → ${booking.destination}</p>
        <p class="item-meta">${new Date(booking.createdAt).toLocaleString("en-IN")}${booking.dispatchDistanceKm != null ? ` · ~${booking.dispatchDistanceKm} km` : ""}</p>
      </article>
    `).join("");
  } catch (error) {
    list.innerHTML = `<p class="load-error">${error.message}</p>`;
  }
}

document.getElementById("show-signup-btn").addEventListener("click", () => {
  document.getElementById("account-signin-form").classList.add("hidden");
  document.getElementById("show-signup-btn").parentElement.classList.add("hidden");
  document.getElementById("account-signup-form").classList.remove("hidden");
  document.getElementById("show-signin-note").classList.remove("hidden");
});

document.getElementById("show-signin-btn").addEventListener("click", () => {
  document.getElementById("account-signup-form").classList.add("hidden");
  document.getElementById("show-signin-note").classList.add("hidden");
  document.getElementById("account-signin-form").classList.remove("hidden");
  document.getElementById("show-signup-btn").parentElement.classList.remove("hidden");
});

document.getElementById("account-signin-form").addEventListener("submit", async event => {
  event.preventDefault();
  const { identifier, password } = formToObject(event.currentTarget);
  const result = document.getElementById("account-signin-result");
  result.textContent = "Signing in…";
  try {
    const data = await patientApi("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ role: "customer", identifier, password })
    });
    savePatientAuth(data);
    updateAccountNav();
    event.currentTarget.reset();
    result.textContent = "";
    renderAccountPanel();
  } catch (error) {
    result.textContent = error.message;
  }
});

document.getElementById("account-signup-form").addEventListener("submit", async event => {
  event.preventDefault();
  const payload = formToObject(event.currentTarget);
  const result = document.getElementById("account-signup-result");
  result.textContent = "Creating your account…";
  try {
    const data = await patientApi("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    savePatientAuth(data);
    updateAccountNav();
    event.currentTarget.reset();
    result.textContent = "";
    renderAccountPanel();
  } catch (error) {
    result.textContent = error.message;
  }
});

document.getElementById("account-edit-form").addEventListener("submit", async event => {
  event.preventDefault();
  const { fullName } = formToObject(event.currentTarget);
  const result = document.getElementById("account-edit-result");
  result.textContent = "Saving…";
  try {
    const res = await patientApi("/api/profile", { method: "PATCH", body: JSON.stringify({ fullName }) });
    patientState.profile = res.profile;
    localStorage.setItem(`${PATIENT_KEY}_profile`, JSON.stringify(res.profile));
    updateAccountNav();
    result.textContent = "Saved.";
    document.getElementById("account-name").textContent = res.profile.fullName;
  } catch (error) {
    result.textContent = error.message;
  }
});

document.getElementById("account-signout-btn").addEventListener("click", () => {
  clearPatientAuth();
  updateAccountNav();
  closePanel("account-panel");
});

updateAccountNav();
