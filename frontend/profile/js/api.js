const PROFILE_STORAGE_KEY = "hindcare_auth";

const profileState = {
  accessToken: null,
  refreshToken: null,
  user: JSON.parse(sessionStorage.getItem(`${PROFILE_STORAGE_KEY}_user`) || "null"),
  profileData: null
};

// Single-flight refresh: when several API calls 401 at once they must share
// ONE refresh request — two parallel refreshes present the same token and the
// second looks like replay.
let refreshInFlight = null;

function refreshProfileSession() {
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      credentials: "same-origin"
    }).finally(() => {
      setTimeout(() => { refreshInFlight = null; }, 0);
    });
  }
  return refreshInFlight;
}

async function profileApi(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (profileState.accessToken) {
    headers.Authorization = `Bearer ${profileState.accessToken}`;
  }

  let response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  let data = await response.json().catch(() => ({}));

  if (response.status === 401 && !options._retried) {
    const refreshRes = await refreshProfileSession();
    if (refreshRes.ok) {
      return profileApi(path, { ...options, _retried: true });
    }
    if (refreshRes.status === 409) {
      // Another tab refreshed a moment before us; the rotated cookies are
      // already in the shared cookie jar, so simply retry with them.
      return profileApi(path, { ...options, _retried: true });
    }
    clearProfileAuth();
    window.location.href = "/?auth=signin&session=expired";
    throw new Error("Session expired");
  }

  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function clearProfileAuth() {
  profileState.accessToken = null;
  profileState.refreshToken = null;
  profileState.user = null;
  sessionStorage.removeItem(`${PROFILE_STORAGE_KEY}_token`);
  sessionStorage.removeItem(`${PROFILE_STORAGE_KEY}_refresh`);
  sessionStorage.removeItem(`${PROFILE_STORAGE_KEY}_user`);
}

function requireAuth() {
  // Authentication is carried by an HttpOnly cookie. The profile request
  // below is the source of truth; it will redirect if the cookie is invalid.
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
