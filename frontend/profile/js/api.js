const PROFILE_STORAGE_KEY = "hindcare_auth";

const profileState = {
  accessToken: sessionStorage.getItem(`${PROFILE_STORAGE_KEY}_token`) || null,
  refreshToken: sessionStorage.getItem(`${PROFILE_STORAGE_KEY}_refresh`) || null,
  user: JSON.parse(sessionStorage.getItem(`${PROFILE_STORAGE_KEY}_user`) || "null"),
  profileData: null
};

async function profileApi(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (profileState.accessToken) {
    headers.Authorization = `Bearer ${profileState.accessToken}`;
  }

  let response = await fetch(path, { ...options, headers });
  let data = await response.json().catch(() => ({}));

  if (response.status === 401 && profileState.refreshToken) {
    const refreshRes = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: profileState.refreshToken })
    });
    if (refreshRes.ok) {
      const refreshData = await refreshRes.json();
      profileState.accessToken = refreshData.accessToken;
      sessionStorage.setItem(`${PROFILE_STORAGE_KEY}_token`, refreshData.accessToken);
      return profileApi(path, { ...options, _retried: true });
    }
    window.location.href = "/auth/#/session-expired";
    throw new Error("Session expired");
  }

  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function clearProfileAuth() {
  sessionStorage.removeItem(`${PROFILE_STORAGE_KEY}_token`);
  sessionStorage.removeItem(`${PROFILE_STORAGE_KEY}_refresh`);
  sessionStorage.removeItem(`${PROFILE_STORAGE_KEY}_user`);
}

function requireAuth() {
  if (!profileState.accessToken) {
    window.location.href = "/auth/#/roles";
    return false;
  }
  return true;
}

function getInitials(name) {
  return String(name || "U").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatCurrency(n) {
  return `₹${Number(n || 0).toLocaleString("en-IN")}`;
}

export { profileState, profileApi, clearProfileAuth, requireAuth, getInitials, formatDate, formatCurrency };
