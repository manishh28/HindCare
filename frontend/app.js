const state = {
  hospitals: [],
  ambulances: [],
  bookings: [],
  role: ""
};

// Per-page-load conversation id so the chatbot can remember where it is in
// a multi-step flow (e.g. mid-way through collecting booking details).
const chatSessionId =
  window.crypto && window.crypto.randomUUID
    ? window.crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;

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

function renderCounts() {
  document.getElementById("hospital-count").textContent = state.hospitals.length;
  document.getElementById("ambulance-count").textContent = state.ambulances.length;
  document.getElementById("booking-count").textContent = state.bookings.length;
}

function renderHospitals() {
  const list = document.getElementById("hospital-list");
  const isAdmin = state.role === "admin";

  list.innerHTML = state.hospitals.map(hospital => `
    <article class="item" data-hospital-id="${hospital.id}">
      <div class="item-header">
        <strong>${hospital.name}</strong>
        <span class="badge ${hospital.status}">${hospital.status}</span>
      </div>
      <p>${hospital.address}</p>
      <p class="item-meta">${hospital.phone}</p>
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

function populateDestinationSelect() {
  const select = document.getElementById("destination-select");
  const approved = state.hospitals.filter(hospital => hospital.status === "approved");
  const previousValue = select.value;

  select.innerHTML = approved.length
    ? approved.map(hospital => `<option value="${hospital.id}">${hospital.name} — ${hospital.city}</option>`).join("")
    : `<option value="">No approved hospitals yet</option>`;

  if (approved.some(hospital => String(hospital.id) === previousValue)) {
    select.value = previousValue;
  }
}

function renderAmbulances() {
  const list = document.getElementById("ambulance-list");
  const canManage = state.role === "fleet" || state.role === "admin";
  const statuses = ["available", "busy", "maintenance", "offline"];

  list.innerHTML = state.ambulances.map(ambulance => `
    <article class="item" data-ambulance-id="${ambulance.id}">
      <div class="item-header">
        <strong>${ambulance.registrationNumber}</strong>
        <span class="badge ${ambulance.status}">${ambulance.status}</span>
      </div>
      <p>${ambulance.type} ambulance</p>
      <p class="item-meta">${ambulance.driverName} — ${ambulance.phone}</p>
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

const BOOKING_NEXT_STEPS = {
  requested: [["assigned", "Mark assigned"], ["cancelled", "Cancel"]],
  assigned: [["on_route", "Mark on route"], ["cancelled", "Cancel"]],
  on_route: [["completed", "Mark completed"], ["cancelled", "Cancel"]],
  completed: [],
  cancelled: []
};

function renderBookings() {
  const list = document.getElementById("booking-list");
  const canManage = state.role === "fleet" || state.role === "admin";

  if (!state.bookings.length) {
    list.innerHTML = `<p class="empty-note">No bookings yet — the board fills in as patients request ambulances.</p>`;
    return;
  }

  list.innerHTML = [...state.bookings].reverse().map(booking => {
    const ambulance = state.ambulances.find(item => item.id === booking.ambulanceId);
    const nextSteps = BOOKING_NEXT_STEPS[booking.status] || [];
    return `
    <article class="item" data-booking-id="${booking.id}">
      <div class="item-header">
        <strong>#${booking.id} — ${booking.patientName}</strong>
        <span class="badge ${booking.status}">${booking.status.replace("_", " ")}</span>
      </div>
      <p>${booking.pickup} → ${booking.destination}</p>
      <p class="item-meta">
        ${ambulance ? `${ambulance.registrationNumber} (${ambulance.driverName})` : "No ambulance assigned yet"}
        ${booking.dispatchDistanceKm != null ? ` · ~${booking.dispatchDistanceKm} km away` : ""}
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

// Each dashboard section refreshes independently so one failing request
// (e.g. the API being briefly unreachable) doesn't blank out the whole page.
async function refreshHospitals() {
  try {
    state.hospitals = await api("/api/hospitals");
    renderHospitals();
    populateDestinationSelect();
    renderCounts();
  } catch (error) {
    document.getElementById("hospital-list").innerHTML = `<p class="load-error">${error.message}</p>`;
  }
}

async function refreshAmbulances() {
  try {
    state.ambulances = await api("/api/ambulances");
    renderAmbulances();
    renderBookings();
    renderCounts();
  } catch (error) {
    document.getElementById("ambulance-list").innerHTML = `<p class="load-error">${error.message}</p>`;
  }
}

async function refreshBookings() {
  try {
    state.bookings = await api("/api/bookings");
    renderBookings();
    renderCounts();
  } catch (error) {
    document.getElementById("booking-list").innerHTML = `<p class="load-error">${error.message}</p>`;
  }
}

async function refreshDashboard() {
  await Promise.allSettled([refreshHospitals(), refreshAmbulances(), refreshBookings()]);
}

function formToObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

document.getElementById("demo-role").addEventListener("change", event => {
  state.role = event.target.value;
  renderHospitals();
  renderAmbulances();
  renderBookings();
});

document.getElementById("booking-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const result = document.getElementById("booking-result");
  result.textContent = "Creating booking...";

  try {
    const booking = await api("/api/bookings", {
      method: "POST",
      body: JSON.stringify(formToObject(form))
    });
    const ambulanceNote = booking.ambulanceId
      ? `Ambulance ${state.ambulances.find(a => a.id === booking.ambulanceId)?.registrationNumber || booking.ambulanceId} assigned.`
      : "Waiting for the next available ambulance.";
    result.textContent = `Booking #${booking.id} created. Status: ${booking.status}. ${ambulanceNote}`;
    form.reset();
    await Promise.all([refreshBookings(), refreshAmbulances()]);
    populateDestinationSelect();
  } catch (error) {
    result.textContent = error.message;
  }
});

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

refreshDashboard().catch(error => {
  document.body.insertAdjacentHTML("afterbegin", `<p class="load-error">${error.message}</p>`);
});
