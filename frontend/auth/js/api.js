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
  return Boolean(authState.accessToken);
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
    const refreshRes = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    if (refreshRes.ok) {
      const refreshData = await refreshRes.json();
      authState.accessToken = null;
      authState.refreshToken = null;
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
