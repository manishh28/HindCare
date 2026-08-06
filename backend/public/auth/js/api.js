const AUTH_STORAGE_KEY = "hindcare_auth";

const authState = {
  accessToken: localStorage.getItem(`${AUTH_STORAGE_KEY}_token`) || null,
  refreshToken: localStorage.getItem(`${AUTH_STORAGE_KEY}_refresh`) || null,
  user: JSON.parse(localStorage.getItem(`${AUTH_STORAGE_KEY}_user`) || "null"),
  rememberMe: localStorage.getItem(`${AUTH_STORAGE_KEY}_remember`) === "true"
};

function saveAuth(data) {
  authState.accessToken = data.accessToken;
  authState.refreshToken = data.refreshToken;
  authState.user = data.user;
  localStorage.setItem(`${AUTH_STORAGE_KEY}_token`, data.accessToken);
  if (data.refreshToken) localStorage.setItem(`${AUTH_STORAGE_KEY}_refresh`, data.refreshToken);
  localStorage.setItem(`${AUTH_STORAGE_KEY}_user`, JSON.stringify(data.user));
}

function clearAuth() {
  authState.accessToken = null;
  authState.refreshToken = null;
  authState.user = null;
  localStorage.removeItem(`${AUTH_STORAGE_KEY}_token`);
  localStorage.removeItem(`${AUTH_STORAGE_KEY}_refresh`);
  localStorage.removeItem(`${AUTH_STORAGE_KEY}_user`);
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

  let response = await fetch(path, { ...options, headers });
  let data = await response.json().catch(() => ({}));

  if (response.status === 401 && authState.refreshToken && !options._retried) {
    const refreshRes = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: authState.refreshToken })
    });
    if (refreshRes.ok) {
      const refreshData = await refreshRes.json();
      authState.accessToken = refreshData.accessToken;
      localStorage.setItem(`${AUTH_STORAGE_KEY}_token`, refreshData.accessToken);
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
