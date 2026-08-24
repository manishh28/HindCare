const AUTH_STORAGE_KEY = "hindcare_auth";

const authState = {
  accessToken: null,
  refreshToken: null,
  user: JSON.parse(sessionStorage.getItem(`${AUTH_STORAGE_KEY}_user`) || "null"),
  rememberMe: sessionStorage.getItem(`${AUTH_STORAGE_KEY}_remember`) === "true"
};

function saveAuth(data) {
  authState.accessToken = null;
  authState.refreshToken = null;
  authState.user = data.user;
  sessionStorage.removeItem(`${AUTH_STORAGE_KEY}_token`);
  sessionStorage.removeItem(`${AUTH_STORAGE_KEY}_refresh`);
  sessionStorage.setItem(`${AUTH_STORAGE_KEY}_user`, JSON.stringify(data.user));
}

function clearAuth() {
  authState.accessToken = null;
  authState.refreshToken = null;
  authState.user = null;
  sessionStorage.removeItem(`${AUTH_STORAGE_KEY}_token`);
  sessionStorage.removeItem(`${AUTH_STORAGE_KEY}_refresh`);
  sessionStorage.removeItem(`${AUTH_STORAGE_KEY}_user`);
}

function isAuthenticated() {
  // Tokens live in HttpOnly cookies now (invisible to JS), so the persisted
  // user object is the client-side hint that a session exists.
  return Boolean(authState.user);
}

// Single-flight refresh: when several API calls 401 at once they must share
// ONE refresh request — two parallel refreshes present the same token and the
// second looks like replay.
let refreshInFlight = null;

function refreshSession() {
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

async function authApi(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (authState.accessToken) {
    headers.Authorization = `Bearer ${authState.accessToken}`;
  }

  let response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  let data = await response.json().catch(() => ({}));

  if (response.status === 401 && !options._retried &&
      !["/api/auth/login", "/api/auth/signup"].includes(path)) {
    const refreshRes = await refreshSession();
    if (refreshRes.ok) {
      return authApi(path, { ...options, _retried: true });
    }
    if (refreshRes.status === 409) {
      // Another tab refreshed a moment before us; the rotated cookies are
      // already in the shared cookie jar, so simply retry with them.
      return authApi(path, { ...options, _retried: true });
    }
    clearAuth();
    window.location.hash = "#/session-expired";
    throw new Error("Session expired");
  }

  if (!response.ok) {
    const err = new Error(data.error || "Request failed");
    err.code = data.code;
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

export { authState, saveAuth, clearAuth, isAuthenticated, authApi, AUTH_STORAGE_KEY };
