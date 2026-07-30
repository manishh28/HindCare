const state = {
  hospitals: [],
  ambulances: [],
  bookings: []
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

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
  list.innerHTML = state.hospitals.map(hospital => `
    <article class="item">
      <div class="item-header">
        <strong>${hospital.name}</strong>
        <span class="badge ${hospital.status}">${hospital.status}</span>
      </div>
      <p>${hospital.address}</p>
      <p class="item-meta">${hospital.phone}</p>
      <p class="availability">${hospital.availableBeds}/${hospital.totalBeds} beds available</p>
    </article>
  `).join("");
}

function renderAmbulances() {
  const list = document.getElementById("ambulance-list");
  list.innerHTML = state.ambulances.map(ambulance => `
    <article class="item">
      <div class="item-header">
        <strong>${ambulance.registrationNumber}</strong>
        <span class="badge ${ambulance.status}">${ambulance.status}</span>
      </div>
      <p>${ambulance.type} ambulance</p>
      <p class="item-meta">${ambulance.driverName} - ${ambulance.phone}</p>
    </article>
  `).join("");
}

async function refreshDashboard() {
  const [hospitals, ambulances, bookings] = await Promise.all([
    api("/api/hospitals"),
    api("/api/ambulances"),
    api("/api/bookings")
  ]);

  state.hospitals = hospitals;
  state.ambulances = ambulances;
  state.bookings = bookings;

  renderCounts();
  renderHospitals();
  renderAmbulances();
}

function formToObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

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
    result.textContent = `Booking #${booking.id} created. Status: ${booking.status}. Ambulance ID: ${booking.ambulanceId || "waiting for assignment"}.`;
    form.reset();
    await refreshDashboard();
  } catch (error) {
    result.textContent = error.message;
  }
});

document.getElementById("chatbot-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const reply = document.getElementById("chatbot-reply");
  reply.textContent = "Thinking...";

  try {
    const data = await api("/api/chatbot/message", {
      method: "POST",
      body: JSON.stringify(formToObject(form))
    });
    reply.textContent = `${data.intent}: ${data.reply}`;
    form.reset();
  } catch (error) {
    reply.textContent = error.message;
  }
});

refreshDashboard().catch(error => {
  document.body.insertAdjacentHTML("afterbegin", `<p class="load-error">${error.message}</p>`);
});
