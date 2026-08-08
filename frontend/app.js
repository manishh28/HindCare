const state = {
  hospitals: [],
  ambulances: [],
  bookings: [],
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

// Every value below can come from a public, unauthenticated submission
// (hospital/ambulance onboarding, the booking form). Anything rendered via
// innerHTML must be escaped — this is the fix for the stored-XSS finding
// from the security audit.
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

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

  if (!state.hospitals.length) {
    list.innerHTML = `<p class="empty-note">No hospitals yet.</p>`;
    return;
  }

  list.innerHTML = state.hospitals.map(hospital => `
    <article class="item" data-hospital-id="${hospital.id}">
      <div class="item-header">
        <strong>${escapeHtml(hospital.name)}</strong>
        <span class="badge ${escapeHtml(hospital.status)}">${escapeHtml(hospital.status)}</span>
      </div>
      <p>${escapeHtml(hospital.address)}</p>
      <p class="item-meta">${escapeHtml(hospital.phone)}${hospital.email ? ` — ${escapeHtml(hospital.email)}` : ""}</p>
      <p class="availability">${Number(hospital.availableBeds) || 0}/${Number(hospital.totalBeds) || 0} beds available</p>
    </article>
  `).join("");
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
    `<option value="${hospital.id}" data-city="${escapeHtml(hospital.city)}">${escapeHtml(hospital.name)} — ${escapeHtml(hospital.city)}</option>`
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

  if (!state.ambulances.length) {
    list.innerHTML = `<p class="empty-note">No ambulances yet.</p>`;
    return;
  }

  list.innerHTML = state.ambulances.map(ambulance => `
    <article class="item" data-ambulance-id="${ambulance.id}">
      <div class="item-header">
        <strong>${escapeHtml(ambulance.registrationNumber)}</strong>
        <span class="badge ${escapeHtml(ambulance.status)}">${escapeHtml(ambulance.status)}</span>
      </div>
      <p>${escapeHtml(ambulance.type)} ambulance</p>
    </article>
  `).join("");
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

  if (!state.bookings.length) {
    list.innerHTML = `<p class="empty-note">No bookings yet.</p>`;
    return;
  }

  list.innerHTML = [...state.bookings].reverse().map(booking => {
    const ambulance = state.ambulances.find(item => item.id === booking.ambulanceId);
    return `
    <article class="item" data-booking-id="${booking.id}">
      <div class="item-header">
        <strong>#${booking.id}</strong>
        ${statusChip(booking.status)}
      </div>
      <p>${escapeHtml(booking.pickup)} → ${escapeHtml(booking.destination)}</p>
      <p class="item-meta">
        ${ambulance ? `${escapeHtml(ambulance.registrationNumber)}` : "No ambulance assigned yet"}
        ${booking.dispatchDistanceKm != null ? ` · ~${Number(booking.dispatchDistanceKm)} km` : ""}
      </p>
    </article>
  `;
  }).join("");
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
    document.getElementById("hospital-list").innerHTML = `<p class="load-error">${escapeHtml(error.message)}</p>`;
  }
}

async function refreshAmbulances() {
  try {
    state.ambulances = await api("/api/ambulances");
    renderAmbulances();
    renderBookings();
    renderHeroStats();
  } catch (error) {
    document.getElementById("ambulance-list").innerHTML = `<p class="load-error">${escapeHtml(error.message)}</p>`;
  }
}

async function refreshBookings() {
  try {
    state.bookings = await api("/api/bookings");
    renderBookings();
    renderHeroStats();
  } catch (error) {
    // Live booking activity is staff-only now (see the security fixes) —
    // that's an expected, honest state for a public visitor, not an error.
    document.getElementById("booking-list").innerHTML =
      `<p class="empty-note">Live booking activity is visible to signed-in staff. Track your own booking above with your booking ID and phone number.</p>`;
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
    closeMobileNav();
  }
});

// ---- mobile hamburger menu ----

const mobileNavToggle = document.getElementById("mobile-nav-toggle");
const mobileNavMenu = document.getElementById("mobile-nav-menu");
const mobileNavIcon = document.getElementById("mobile-nav-icon");

function openMobileNav() {
  mobileNavMenu.classList.add("open");
  mobileNavToggle.setAttribute("aria-expanded", "true");
  mobileNavToggle.setAttribute("aria-label", "Close menu");
  mobileNavIcon.textContent = "✕";
}

function closeMobileNav() {
  mobileNavMenu.classList.remove("open");
  mobileNavToggle.setAttribute("aria-expanded", "false");
  mobileNavToggle.setAttribute("aria-label", "Open menu");
  mobileNavIcon.textContent = "☰";
}

mobileNavToggle.addEventListener("click", () => {
  if (mobileNavMenu.classList.contains("open")) closeMobileNav();
  else openMobileNav();
});

mobileNavMenu.querySelectorAll("[data-mobile-nav-item]").forEach(item => {
  item.addEventListener("click", () => closeMobileNav());
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 900) closeMobileNav();
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
      <div class="tracker-row"><span>Destination</span><span>${escapeHtml(booking.destination)}</span></div>
      ${booking.ambulance
        ? `<div class="tracker-row"><span>Ambulance</span><span>${escapeHtml(booking.ambulance.registrationNumber)}</span></div>
           <div class="tracker-row"><span>Driver</span><span>${escapeHtml(booking.ambulance.driverName)}</span></div>`
        : `<div class="tracker-row"><span>Ambulance</span><span>Not yet assigned</span></div>`}
      ${showEta ? `<div class="tracker-row"><span>Est. arrival</span><span>~${Number(eta)} min (approx.)</span></div>` : ""}
    `;
  } catch (error) {
    result.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }
});

refreshDashboard().catch(error => {
  document.body.insertAdjacentHTML("afterbegin", `<p class="load-error">${escapeHtml(error.message)}</p>`);
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
//
// The panel is a strict state machine — exactly one view is visible at
// any time: welcome, signin, signup, or dashboard. Nothing about account
// details, editing, or bookings can ever render before the user is
// actually signed in.
// ---------------------------------------------------------------------

const PATIENT_KEY = "hindcare_patient";
const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{6,17}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    throw new Error("Your session has expired. Please sign in again.");
  }

  if (!response.ok) {
    const err = new Error(data.error || "Something went wrong");
    err.code = data.code;
    throw err;
  }
  return data;
}

// ---- friendly error copy, mapped from backend error codes ----
function friendlyAuthError(error) {
  const map = {
    INVALID_CREDENTIALS: "Phone/email or password is incorrect.",
    INVALID_ROLE: "Something went wrong. Please try again.",
    PHONE_EXISTS: "An account with this phone number already exists. Try signing in instead.",
    EMAIL_EXISTS: "An account with this email already exists. Try signing in instead.",
    INVALID_PHONE: "Enter a valid phone number.",
    INVALID_EMAIL: "Enter a valid email address.",
    WEAK_PASSWORD: error.message || "Choose a stronger password.",
    RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
    ACCOUNT_LOCKED: "Your account is temporarily locked. Please try again later."
  };
  return map[error.code] || error.message || "Something went wrong. Please try again.";
}

// =======================================================================
// View state machine
// =======================================================================

const ACCOUNT_VIEWS = ["welcome", "signin", "signup", "dashboard"];

function setAccountView(view) {
  ACCOUNT_VIEWS.forEach(name => {
    document.getElementById(`account-view-${name}`).classList.toggle("hidden", name !== view);
  });
  // Leaving a view always resets its transient state, so coming back to
  // it later never shows a stale error, a half-filled form, or last
  // time's forgot-password step.
  if (view !== "signin") resetSigninView();
  if (view !== "signup") resetSignupView();
  if (view === "dashboard") renderDashboard();
}

function resetSigninView() {
  document.getElementById("account-signin-form").reset();
  clearFieldError("signin-identifier");
  clearFieldError("signin-password");
  setFormError("signin-form-error", "");
  document.getElementById("forgot-password-panel").classList.add("hidden");
  document.getElementById("forgot-step-request").classList.remove("hidden");
  document.getElementById("forgot-step-reset").classList.add("hidden");
  document.getElementById("forgot-request-result").textContent = "";
  document.getElementById("forgot-reset-result").textContent = "";
}

function resetSignupView() {
  document.getElementById("account-signup-form").reset();
  ["signup-fullname", "signup-phone", "signup-email", "signup-password"].forEach(clearFieldError);
  setFormError("signup-form-error", "");
}

// =======================================================================
// Validation helpers
// =======================================================================

function setFieldError(inputId, message) {
  const input = document.getElementById(inputId);
  const errorEl = document.getElementById(`${inputId}-error`);
  if (errorEl) errorEl.textContent = message;
  if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
}

function clearFieldError(inputId) {
  setFieldError(inputId, "");
}

function setFormError(elId, message) {
  const el = document.getElementById(elId);
  if (el) el.textContent = message;
}

function setButtonLoading(buttonId, isLoading, loadingLabel, normalLabel) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  btn.disabled = isLoading;
  btn.textContent = isLoading ? loadingLabel : normalLabel;
}

// =======================================================================
// Password show/hide
// =======================================================================

document.querySelectorAll(".password-toggle").forEach(btn => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.textContent = showing ? "Show" : "Hide";
    btn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  });
});

// =======================================================================
// Nav button + welcome-state entry points
// =======================================================================

function updateAccountNav() {
  const btn = document.getElementById("account-nav-btn");
  const mobileBtn = document.getElementById("account-nav-btn-mobile");
  const label = patientState.user ? (patientState.profile?.fullName?.split(" ")[0] || "My account") : "Sign in";
  if (btn) btn.textContent = label;
  if (mobileBtn) mobileBtn.textContent = label;

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
  if (patientState.user) {
    setAccountView("dashboard");
  } else {
    setAccountView("welcome");
  }
}

document.getElementById("go-signin-btn").addEventListener("click", () => setAccountView("signin"));
document.getElementById("go-signup-btn").addEventListener("click", () => setAccountView("signup"));
document.getElementById("signin-to-signup-btn").addEventListener("click", () => setAccountView("signup"));
document.getElementById("signup-to-signin-btn").addEventListener("click", () => setAccountView("signin"));
document.getElementById("signin-back-btn").addEventListener("click", () => setAccountView("welcome"));
document.getElementById("signup-back-btn").addEventListener("click", () => setAccountView("welcome"));

// =======================================================================
// Sign in
// =======================================================================

document.getElementById("account-signin-form").addEventListener("submit", async event => {
  event.preventDefault();
  const { identifier, password } = formToObject(event.currentTarget);

  clearFieldError("signin-identifier");
  clearFieldError("signin-password");
  setFormError("signin-form-error", "");

  let hasError = false;
  if (!identifier.trim()) {
    setFieldError("signin-identifier", "Enter your phone number or email.");
    hasError = true;
  }
  if (!password) {
    setFieldError("signin-password", "Enter your password.");
    hasError = true;
  }
  if (hasError) return;

  setButtonLoading("signin-submit-btn", true, "Signing in…", "Sign in");
  try {
    const data = await patientApi("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ role: "customer", identifier: identifier.trim(), password })
    });
    savePatientAuth(data);
    updateAccountNav();
    setAccountView("dashboard");
  } catch (error) {
    setFormError("signin-form-error", friendlyAuthError(error));
  } finally {
    setButtonLoading("signin-submit-btn", false, "Signing in…", "Sign in");
  }
});

// =======================================================================
// Create account
// =======================================================================

document.getElementById("account-signup-form").addEventListener("submit", async event => {
  event.preventDefault();
  const payload = formToObject(event.currentTarget);

  ["signup-fullname", "signup-phone", "signup-email", "signup-password"].forEach(clearFieldError);
  setFormError("signup-form-error", "");

  let hasError = false;
  if (!payload.fullName.trim()) {
    setFieldError("signup-fullname", "Enter your full name.");
    hasError = true;
  }
  if (!PHONE_PATTERN.test(payload.phone.trim())) {
    setFieldError("signup-phone", "Enter a valid phone number.");
    hasError = true;
  }
  if (payload.email.trim() && !EMAIL_PATTERN.test(payload.email.trim())) {
    setFieldError("signup-email", "Enter a valid email address.");
    hasError = true;
  }
  if (!payload.password) {
    setFieldError("signup-password", "Enter a password.");
    hasError = true;
  } else if (payload.password.length < 8) {
    setFieldError("signup-password", "Password must be at least 8 characters.");
    hasError = true;
  }
  if (hasError) return;

  setButtonLoading("signup-submit-btn", true, "Creating account…", "Create account");
  try {
    const data = await patientApi("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    savePatientAuth(data);
    updateAccountNav();
    setAccountView("dashboard");
  } catch (error) {
    if (error.code === "PHONE_EXISTS") setFieldError("signup-phone", friendlyAuthError(error));
    else if (error.code === "EMAIL_EXISTS") setFieldError("signup-email", friendlyAuthError(error));
    else if (error.code === "WEAK_PASSWORD") setFieldError("signup-password", friendlyAuthError(error));
    else setFormError("signup-form-error", "Unable to create your account. Please try again.");
  } finally {
    setButtonLoading("signup-submit-btn", false, "Creating account…", "Create account");
  }
});

// =======================================================================
// Forgot password (uses the existing forgot/reset-password API as-is)
// =======================================================================

document.getElementById("forgot-password-btn").addEventListener("click", () => {
  document.getElementById("forgot-password-panel").classList.remove("hidden");
});

document.getElementById("forgot-request-btn").addEventListener("click", async () => {
  const identifier = document.getElementById("forgot-identifier").value.trim();
  clearFieldError("forgot-identifier");
  const resultEl = document.getElementById("forgot-request-result");

  if (!identifier) {
    setFieldError("forgot-identifier", "Enter your phone number or email.");
    return;
  }

  setButtonLoading("forgot-request-btn", true, "Sending…", "Send reset instructions");
  try {
    const body = EMAIL_PATTERN.test(identifier) ? { email: identifier } : { phone: identifier };
    const data = await patientApi("/api/auth/forgot-password", { method: "POST", body: JSON.stringify(body) });
    resultEl.textContent = data.demoResetToken
      ? `Reset code (demo): ${data.demoResetToken}`
      : "If an account exists, reset instructions have been sent.";
    document.getElementById("forgot-step-request").classList.add("hidden");
    document.getElementById("forgot-step-reset").classList.remove("hidden");
    if (data.demoResetToken) document.getElementById("forgot-token").value = data.demoResetToken;
  } catch (error) {
    resultEl.textContent = friendlyAuthError(error);
  } finally {
    setButtonLoading("forgot-request-btn", false, "Sending…", "Send reset instructions");
  }
});

document.getElementById("forgot-reset-btn").addEventListener("click", async () => {
  const token = document.getElementById("forgot-token").value.trim();
  const password = document.getElementById("forgot-new-password").value;
  const resultEl = document.getElementById("forgot-reset-result");
  clearFieldError("forgot-new-password");

  if (!password || password.length < 8) {
    setFieldError("forgot-new-password", "Password must be at least 8 characters.");
    return;
  }

  setButtonLoading("forgot-reset-btn", true, "Resetting…", "Reset password");
  try {
    await patientApi("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) });
    resultEl.textContent = "Password reset. You can now sign in.";
    setTimeout(() => setAccountView("signin"), 1200);
  } catch (error) {
    resultEl.textContent = friendlyAuthError(error);
  } finally {
    setButtonLoading("forgot-reset-btn", false, "Resetting…", "Reset password");
  }
});

// =======================================================================
// Dashboard — account details (view / edit) + bookings
// =======================================================================

function renderDashboard() {
  document.getElementById("account-dashboard-name").textContent = patientState.profile?.fullName?.split(" ")[0] || "there";
  document.getElementById("detail-fullname").textContent = patientState.profile?.fullName || "—";
  document.getElementById("detail-phone").textContent = patientState.user?.phone || "—";
  document.getElementById("detail-email").textContent = patientState.user?.email || "Not added";

  document.getElementById("account-details-view").classList.remove("hidden");
  document.getElementById("edit-details-btn").classList.remove("hidden");
  document.getElementById("account-details-edit").classList.add("hidden");

  loadAccountBookings();
}

document.getElementById("edit-details-btn").addEventListener("click", () => {
  document.getElementById("edit-fullname").value = patientState.profile?.fullName || "";
  document.getElementById("edit-phone").value = patientState.user?.phone || "";
  document.getElementById("edit-email").value = patientState.user?.email || "Not added";
  clearFieldError("edit-fullname");
  setFormError("edit-form-error", "");

  document.getElementById("account-details-view").classList.add("hidden");
  document.getElementById("edit-details-btn").classList.add("hidden");
  document.getElementById("account-details-edit").classList.remove("hidden");
});

document.getElementById("cancel-edit-btn").addEventListener("click", () => {
  document.getElementById("account-details-view").classList.remove("hidden");
  document.getElementById("edit-details-btn").classList.remove("hidden");
  document.getElementById("account-details-edit").classList.add("hidden");
});

document.getElementById("account-details-edit").addEventListener("submit", async event => {
  event.preventDefault();
  const fullName = document.getElementById("edit-fullname").value.trim();
  clearFieldError("edit-fullname");
  setFormError("edit-form-error", "");

  if (!fullName) {
    setFieldError("edit-fullname", "Enter your full name.");
    return;
  }

  setButtonLoading("save-details-btn", true, "Saving…", "Save changes");
  try {
    const res = await patientApi("/api/profile", { method: "PATCH", body: JSON.stringify({ fullName }) });
    patientState.profile = res.profile;
    localStorage.setItem(`${PATIENT_KEY}_profile`, JSON.stringify(res.profile));
    updateAccountNav();
    document.getElementById("account-details-view").classList.remove("hidden");
    document.getElementById("edit-details-btn").classList.remove("hidden");
    document.getElementById("account-details-edit").classList.add("hidden");
    document.getElementById("detail-fullname").textContent = res.profile.fullName;
    document.getElementById("account-dashboard-name").textContent = res.profile.fullName.split(" ")[0];
  } catch (error) {
    setFormError("edit-form-error", "Unable to save your changes. Please try again.");
  } finally {
    setButtonLoading("save-details-btn", false, "Saving…", "Save changes");
  }
});

// ---- bookings: loading skeleton -> empty state or booking cards ----

let ambulanceTypeCache = null;

async function lookupAmbulanceType(ambulanceId) {
  if (!ambulanceId) return null;
  try {
    if (!ambulanceTypeCache) ambulanceTypeCache = await fetch("/api/ambulances").then(r => r.json());
    const match = ambulanceTypeCache.find(a => a.id === ambulanceId);
    if (!match) return null;
    const labels = { basic: "Basic Ambulance", advanced: "Advanced Ambulance", icu: "ICU Ambulance", neonatal: "Neonatal Ambulance" };
    return labels[match.type] || match.type;
  } catch {
    return null;
  }
}

async function loadAccountBookings() {
  const list = document.getElementById("account-bookings-list");
  list.innerHTML = `<div class="booking-skeleton"></div><div class="booking-skeleton"></div>`;

  try {
    const bookings = await patientApi("/api/my-bookings");

    if (!bookings.length) {
      list.innerHTML = `
        <p class="empty-note">You haven't made any bookings yet.</p>
        <button type="button" class="cta-secondary" id="empty-book-btn">Book an ambulance</button>
      `;
      document.getElementById("empty-book-btn").addEventListener("click", () => {
        closePanel("account-panel");
        document.getElementById("quick-book")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return;
    }

    const cardsHtml = await Promise.all(bookings.map(async booking => {
      const ambulanceType = await lookupAmbulanceType(booking.ambulanceId);
      const date = new Date(booking.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      return `
        <article class="item">
          <div class="item-header">
            <strong>Booking #${booking.id}</strong>
            ${statusChip(booking.status)}
          </div>
          <div class="booking-card-details">
            <div class="booking-card-row"><span>Ambulance</span><span>${escapeHtml(ambulanceType || "Not yet assigned")}</span></div>
            <div class="booking-card-row"><span>Date</span><span>${escapeHtml(date)}</span></div>
            <div class="booking-card-row"><span>Pickup</span><span>${escapeHtml(booking.pickup)}</span></div>
          </div>
          <button type="button" class="ghost-button" data-view-booking="${booking.id}" data-view-phone="${escapeHtml(booking.phone)}">View booking</button>
        </article>
      `;
    }));

    list.innerHTML = cardsHtml.join("");

    list.querySelectorAll("[data-view-booking]").forEach(btn => {
      btn.addEventListener("click", () => {
        const trackerForm = document.getElementById("tracker-form");
        if (!trackerForm) return;
        trackerForm.elements.bookingId.value = btn.dataset.viewBooking;
        trackerForm.elements.phone.value = btn.dataset.viewPhone;
        closePanel("account-panel");
        trackerForm.scrollIntoView({ behavior: "smooth", block: "center" });
        trackerForm.requestSubmit();
      });
    });
  } catch (error) {
    list.innerHTML = `<p class="load-error">${escapeHtml(error.message)}</p>`;
  }
}

// =======================================================================
// Sign out
// =======================================================================

document.getElementById("account-signout-btn").addEventListener("click", async () => {
  try {
    await patientApi("/api/auth/logout", { method: "POST" });
  } catch {
    // Best-effort — even if this fails (e.g. offline), still clear the
    // local session below so the user isn't stuck looking "signed in".
  }
  clearPatientAuth();
  updateAccountNav();
  closePanel("account-panel");
});

updateAccountNav();
