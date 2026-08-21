import { authApi, saveAuth, clearAuth, isAuthenticated } from "./api.js";
import {
  validateEmail, validatePhone, validatePassword, validateName,
  validateOtp, calcStrength, renderStrengthBar,
  setFieldError, setupRealtimeValidation, startOtpTimer
} from "./validation.js";

const ROLE_META = {
  super_admin: { icon: "🛡️", title: "Super Admin", desc: "Enterprise system administration", class: "super_admin" }
};

let selectedRole = sessionStorage.getItem("hindcare_selected_role") || "";
let pendingLogin = null;
let otpCleanup = null;

function getRoute() {
  const hash = window.location.hash.slice(1) || "/welcome";
  return hash.startsWith("/") ? hash : `/${hash}`;
}

function navigate(path) {
  window.location.hash = `#${path}`;
}

function showLoading(show) {
  document.getElementById("auth-screen").classList.toggle("loading", show);
  document.getElementById("global-loader").classList.toggle("hidden", !show);
}

function renderAlert(type, message) {
  return `<div class="md-alert md-alert-${type}" role="alert">${message}</div>`;
}

// ---- Screens ----

function screenWelcome() {
  return `
    <div class="welcome-hero animate-in">
      <div class="logo-large" aria-hidden="true">
        <svg viewBox="0 0 48 48" width="48" height="48"><path d="M24 4C12.95 4 4 12.95 4 24s8.95 20 20 20 20-8.95 20-20S35.05 4 24 4zm-2 30V26h4v8h-4zm0-12V14h4v8h-4z" fill="currentColor" style="color:var(--md-sys-color-primary)"/></svg>
      </div>
      <h1>Welcome to HindCare</h1>
      <p class="subtitle">India's trusted emergency healthcare platform</p>
      <div class="welcome-actions">
        <button class="md-btn md-btn-filled md-btn-block" data-action="select-role">Get Started</button>
      </div>
      <p class="md-field-hint" style="margin-top:1.5rem;text-align:center">
        Emergency? Call <a href="tel:108" style="color:var(--md-sys-color-primary)">108</a> immediately
      </p>
    </div>`;
}

function screenRoleSelect() {
  const roles = Object.entries(ROLE_META).map(([slug, meta]) => `
    <button class="role-card" data-role="${slug}" aria-label="Sign in as ${meta.title}">
      <div class="role-icon ${meta.class}" aria-hidden="true">${meta.icon}</div>
      <div class="role-info">
        <h3>${meta.title}</h3>
        <p>${meta.desc}</p>
      </div>
      <span class="role-arrow" aria-hidden="true">→</span>
    </button>`).join("");

  return `
    <button class="auth-back" data-action="back-welcome" aria-label="Go back">← Back</button>
    <div class="auth-header animate-in">
      <h1>Choose your role</h1>
      <p class="subtitle">Select how you'll use HindCare</p>
    </div>
    <div class="role-grid">${roles}</div>`;
}

function screenSignIn(role) {
  const meta = ROLE_META[role];
  if (!meta) return screenRoleSelect();

  const commonHeader = `
    <button class="auth-back" data-action="back-roles" aria-label="Go back">← Back</button>
    <div class="auth-header animate-in">
      <h1>Sign in</h1>
      <p class="subtitle">${meta.title}</p>
    </div>`;

  if (role === "driver") return commonHeader + driverSignInForm();
  if (role === "dispatcher") return commonHeader + dispatcherSignInForm();
  if (role === "hospital_admin") return commonHeader + hospitalAdminSignInForm();
  if (role === "super_admin") return commonHeader + superAdminSignInForm();
  return screenRoleSelect();
}

function driverSignInForm() {
  return `
    <div class="driver-status-bar" role="status">
      <span class="status-dot"></span> Fleet system online — 12 ambulances active in Lucknow
    </div>
    <div class="md-card animate-in">
      <div class="auth-tabs" role="tablist">
        <button class="auth-tab active" role="tab" data-tab="password">Password</button>
        <button class="auth-tab" role="tab" data-tab="otp">OTP Login</button>
      </div>
      <form id="signin-form" novalidate>
        <input type="hidden" name="role" value="driver">
        <input type="hidden" name="loginMethod" value="password" id="login-method">
        <div class="md-field" id="field-identifier">
          <label for="identifier">Email or mobile number</label>
          <input class="md-input" id="identifier" name="identifier" type="text" autocomplete="username" required placeholder="rahul.singh@fleet.hindcare.in or 9111111111">
          <span class="md-field-error" role="alert"></span>
        </div>
        <div class="md-field" id="field-phone">
          <label for="phone">Mobile Number</label>
          <input class="md-input" id="phone" name="phone" type="tel" autocomplete="tel" required placeholder="9876543210">
          <span class="md-field-error" role="alert"></span>
        </div>
        <div class="md-field" id="field-password">
          <label for="password">Password</label>
          <div class="md-input-wrap">
            <input class="md-input" id="password" name="password" type="password" autocomplete="current-password" required>
            <button type="button" class="password-toggle" aria-label="Show password" data-toggle-password="password">👁</button>
          </div>
          <span class="md-field-error" role="alert"></span>
        </div>
        <div class="md-field hidden" id="field-otp">
          <label for="otp">OTP</label>
          <input class="md-input" id="otp" name="otp" type="text" inputmode="numeric" maxlength="6" placeholder="6-digit OTP">
          <span class="md-field-error" role="alert"></span>
        </div>
        <div id="form-alert"></div>
        <button type="submit" class="md-btn md-btn-filled md-btn-block">Sign In</button>
      </form>
    </div>`;
}

function dispatcherSignInForm() {
  return `
    <div class="shift-info">
      <strong>Current Shift: Morning (08:00 – 20:00)</strong>
      Region: Lucknow Metro · 3 dispatchers online
    </div>
    <div class="md-card animate-in">
      <form id="signin-form" novalidate>
        <input type="hidden" name="role" value="dispatcher">
        <div class="md-field">
          <label for="identifier">Email or mobile number</label>
          <input class="md-input" id="identifier" name="identifier" type="text" autocomplete="username" required placeholder="dispatch@hindcare.in or 9222222222">
          <span class="md-field-error" role="alert"></span>
        </div>
        <div class="md-field">
          <label for="password">Password</label>
          <div class="md-input-wrap">
            <input class="md-input" id="password" name="password" type="password" autocomplete="current-password" required>
            <button type="button" class="password-toggle" aria-label="Show password" data-toggle-password="password">👁</button>
          </div>
          <span class="md-field-error" role="alert"></span>
        </div>
        <div id="form-alert"></div>
        <button type="submit" class="md-btn md-btn-filled md-btn-block">Sign In</button>
      </form>
    </div>`;
}

function hospitalAdminSignInForm() {
  return `
    <div class="mfa-badge">🔒 MFA Required for hospital accounts</div>
    <div class="md-card animate-in">
      <form id="signin-form" novalidate>
        <input type="hidden" name="role" value="hospital_admin">
        <div class="md-field">
          <label for="email">Official Email</label>
          <input class="md-input" id="email" name="email" type="email" autocomplete="email" required placeholder="admin@hospital.in">
          <span class="md-field-error" role="alert"></span>
        </div>
        <div class="md-field">
          <label for="password">Password</label>
          <div class="md-input-wrap">
            <input class="md-input" id="password" name="password" type="password" autocomplete="current-password" required>
            <button type="button" class="password-toggle" aria-label="Show password" data-toggle-password="password">👁</button>
          </div>
          <span class="md-field-error" role="alert"></span>
        </div>
        <div id="form-alert"></div>
        <button type="submit" class="md-btn md-btn-filled md-btn-block">Sign In</button>
      </form>
    </div>`;
}

function superAdminSignInForm() {
  return `
    <div class="enterprise-notice">
      🏢 Enterprise Login · Hardware security key supported · All access is logged and audited
    </div>
    <div class="mfa-badge">🔒 MFA Required · Hardware key ready</div>
    <div class="md-card animate-in">
      <form id="signin-form" novalidate>
        <input type="hidden" name="role" value="super_admin">
        <div class="md-field">
          <label for="email">Enterprise Email</label>
          <input class="md-input" id="email" name="email" type="email" autocomplete="email" required placeholder="admin@hindcare.in">
          <span class="md-field-error" role="alert"></span>
        </div>
        <div class="md-field">
          <label for="password">Password</label>
          <div class="md-input-wrap">
            <input class="md-input" id="password" name="password" type="password" autocomplete="current-password" required>
            <button type="button" class="password-toggle" aria-label="Show password" data-toggle-password="password">👁</button>
          </div>
          <span class="md-field-error" role="alert"></span>
        </div>
        <div id="form-alert"></div>
        <button type="submit" class="md-btn md-btn-filled md-btn-block">Enterprise Sign In</button>
      </form>
    </div>`;
}

function screenForgotPassword() {
  return `
    <button class="auth-back" data-action="back-signin" aria-label="Go back">← Back</button>
    <div class="auth-header animate-in">
      <h1>Forgot password?</h1>
      <p class="subtitle">We'll send reset instructions to your email or phone</p>
    </div>
    <div class="md-card animate-in">
      <form id="forgot-form" novalidate>
        <div class="md-field">
          <label for="identifier">Email or Mobile</label>
          <input class="md-input" id="identifier" name="identifier" type="text" required placeholder="Email or 10-digit mobile">
          <span class="md-field-error" role="alert"></span>
        </div>
        <div id="form-alert"></div>
        <button type="submit" class="md-btn md-btn-filled md-btn-block">Send Reset Link</button>
      </form>
    </div>`;
}

function screenResetPassword() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const token = params.get("token") || sessionStorage.getItem("reset_token") || "";
  return `
    <div class="auth-header animate-in">
      <h1>Create new password</h1>
      <p class="subtitle">Choose a strong password for your account</p>
    </div>
    <div class="md-card animate-in">
      <form id="reset-form" novalidate>
        <input type="hidden" name="token" value="${token}">
        <div class="md-field">
          <label for="password">New Password</label>
          <div class="md-input-wrap">
            <input class="md-input" id="password" name="password" type="password" autocomplete="new-password" required>
            <button type="button" class="password-toggle" aria-label="Show password" data-toggle-password="password">👁</button>
          </div>
          <div id="strength-bar"></div>
          <span class="md-field-error" role="alert"></span>
        </div>
        <div class="md-field">
          <label for="confirmPassword">Confirm Password</label>
          <input class="md-input" id="confirmPassword" name="confirmPassword" type="password" required>
          <span class="md-field-error" role="alert"></span>
        </div>
        <div id="form-alert"></div>
        <button type="submit" class="md-btn md-btn-filled md-btn-block">Reset Password</button>
      </form>
    </div>`;
}

function screenMfa() {
  return `
    <div class="auth-header animate-in">
      <h1>Two-factor authentication</h1>
      <p class="subtitle">Enter the verification code sent to your registered email</p>
    </div>
    <div class="md-card animate-in">
      <form id="mfa-form" novalidate>
        <div class="otp-group" role="group" aria-label="MFA code">
          ${[0,1,2,3,4,5].map(i => `<input class="otp-input" type="text" inputmode="numeric" maxlength="1" data-otp-index="${i}">`).join("")}
        </div>
        <input type="hidden" name="mfaCode" id="mfa-value">
        <div id="form-alert"></div>
        <button type="submit" class="md-btn md-btn-filled md-btn-block" style="margin-top:1rem">Verify & Sign In</button>
      </form>
    </div>`;
}

function screenStatus(type, title, message, actionLabel, actionPath) {
  const icons = { success: "✓", error: "✕", warning: "⚠", info: "ℹ" };
  return `
    <div class="status-screen animate-in">
      <div class="status-icon ${type}" aria-hidden="true">${icons[type] || "ℹ"}</div>
      <h2>${title}</h2>
      <p>${message}</p>
      ${actionLabel ? `<button class="md-btn md-btn-filled" data-action="navigate" data-path="${actionPath}">${actionLabel}</button>` : ""}
    </div>`;
}

function renderScreen() {
  const route = getRoute();
  const screen = document.getElementById("auth-screen");

  if (isAuthenticated() && ["/welcome", "/roles", "/signin"].some(r => route.startsWith(r))) {
    window.location.href = "/profile/";
    return;
  }

  let html = "";
  if (route === "/welcome" || route === "/" || route === "/roles") html = screenSignIn("super_admin");
  else if (route.startsWith("/signin")) html = screenSignIn("super_admin");
  else if (route === "/forgot-password") html = screenForgotPassword();
  else if (route.startsWith("/reset-password")) html = screenResetPassword();
  else if (route === "/mfa") html = screenMfa();
  else if (route === "/password-changed") html = screenStatus("success", "Password changed!", "Your password has been updated successfully.", "Sign In", "/signin");
  else if (route === "/session-expired") html = screenStatus("warning", "Session expired", "Your session has timed out for security. Please sign in again.", "Sign In", "/welcome");
  else if (route === "/account-locked") html = screenStatus("error", "Account locked", "Too many failed attempts. Try again in 15 minutes or contact support.", "Contact Support", "/welcome");
  else if (route === "/access-denied") html = screenStatus("error", "Access denied", "You don't have permission to access this resource.", "Go Home", "/welcome");
  else html = screenStatus("error", "Page not found", "The page you're looking for doesn't exist.", "Go Home", "/welcome");

  screen.innerHTML = html;
  screen.classList.add("animate-in");
  bindScreenEvents(route);
}

function bindScreenEvents(route) {
  document.querySelectorAll("[data-action]").forEach(el => {
    el.addEventListener("click", () => {
      const action = el.dataset.action;
      if (action === "select-role") navigate("/roles");
      else if (action === "back-welcome") navigate("/welcome");
      else if (action === "back-roles") navigate("/roles");
      else if (action === "back-signin") navigate("/signin");
      else if (action === "navigate") navigate(el.dataset.path);
    });
  });

  document.querySelectorAll("[data-role]").forEach(card => {
    card.addEventListener("click", () => {
      selectedRole = card.dataset.role;
      sessionStorage.setItem("hindcare_selected_role", selectedRole);
      navigate("/signin");
    });
  });

  document.querySelectorAll("[data-toggle-password]").forEach(btn => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.togglePassword);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  });

  const signinForm = document.getElementById("signin-form");
  if (signinForm) bindSignInForm(signinForm);

  const forgotForm = document.getElementById("forgot-form");
  if (forgotForm) bindForgotForm(forgotForm);

  const resetForm = document.getElementById("reset-form");
  if (resetForm) bindResetForm(resetForm);

  const mfaForm = document.getElementById("mfa-form");
  if (mfaForm) bindMfaForm(mfaForm);

  bindTabs();
  bindOtpInputs();
  bindPasswordStrength();
}

function bindTabs() {
  document.querySelectorAll(".auth-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const tabName = tab.dataset.tab;

      if (selectedRole === "driver") {
        const methodInput = document.getElementById("login-method");
        const pwdField = document.getElementById("field-password");
        const otpField = document.getElementById("field-otp");
        if (tabName === "otp") {
          methodInput.value = "otp";
          pwdField.classList.add("hidden");
          otpField.classList.remove("hidden");
        } else {
          methodInput.value = "password";
          pwdField.classList.remove("hidden");
          otpField.classList.add("hidden");
        }
      }
    });
  });
}

function bindOtpInputs() {
  document.querySelectorAll(".otp-input").forEach((input, idx, all) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 1);
      if (input.value && idx < all.length - 1) all[idx + 1].focus();
      const otpVal = document.getElementById("otp-value") || document.getElementById("mfa-value");
      if (otpVal) otpVal.value = [...all].map(i => i.value).join("");
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Backspace" && !input.value && idx > 0) all[idx - 1].focus();
    });
  });
}

function bindPasswordStrength() {
  const pwd = document.getElementById("password");
  const bar = document.getElementById("strength-bar");
  if (!pwd || !bar) return;
  pwd.addEventListener("input", () => {
    bar.innerHTML = pwd.value ? renderStrengthBar(calcStrength(pwd.value)) : "";
  });
}

async function bindSignInForm(form) {
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const alert = document.getElementById("form-alert");
    alert.innerHTML = "";
    showLoading(true);

    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());

    try {
      const data = await authApi("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      if (data.requiresMfa) {
        pendingLogin = payload;
        if (data.demoOtp) sessionStorage.setItem("demo_mfa_otp", data.demoOtp);
        navigate("/mfa");
        return;
      }

      saveAuth(data);
      if (payload.rememberMe) localStorage.setItem("hindcare_auth_remember", "true");
      window.location.href = data.redirectTo || "/profile/";
    } catch (err) {
      if (err.code === "ACCOUNT_LOCKED") navigate("/account-locked");
      else {
        alert.innerHTML = renderAlert("error", err.message);
        form.classList.add("animate-shake");
        setTimeout(() => form.classList.remove("animate-shake"), 400);
      }
    } finally {
      showLoading(false);
    }
  });
}

async function bindForgotForm(form) {
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const alert = document.getElementById("form-alert");
    showLoading(true);
    try {
      const identifier = form.identifier.value.trim();
      const isEmail = validateEmail(identifier).ok;
      const data = await authApi("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify(isEmail ? { email: identifier } : { phone: identifier })
      });
      if (data.demoResetToken) sessionStorage.setItem("reset_token", data.demoResetToken);
      alert.innerHTML = renderAlert("success", data.message);
      setTimeout(() => navigate("/reset-password"), 2000);
    } catch (err) {
      alert.innerHTML = renderAlert("error", err.message);
    } finally {
      showLoading(false);
    }
  });
}

async function bindResetForm(form) {
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const alert = document.getElementById("form-alert");
    const pwdCheck = validatePassword(form.password.value);
    if (!pwdCheck.ok) { alert.innerHTML = renderAlert("error", pwdCheck.message); return; }
    if (form.password.value !== form.confirmPassword.value) {
      alert.innerHTML = renderAlert("error", "Passwords do not match"); return;
    }
    showLoading(true);
    try {
      await authApi("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token: form.token.value, password: form.password.value })
      });
      navigate("/password-changed");
    } catch (err) {
      alert.innerHTML = renderAlert("error", err.message);
    } finally {
      showLoading(false);
    }
  });
}

async function bindMfaForm(form) {
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const alert = document.getElementById("form-alert");
    const pending = pendingLogin || {};
    const mfaCode = form.querySelector("#mfa-value").value;

    showLoading(true);
    try {
      const data = await authApi("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ ...pending, mfaCode })
      });
      saveAuth(data);
      pendingLogin = null;
      window.location.href = data.redirectTo || "/profile/";
    } catch (err) {
      alert.innerHTML = renderAlert("error", err.message);
    } finally {
      showLoading(false);
    }
  });
}

// Init
window.addEventListener("hashchange", renderScreen);
renderScreen();

// Apply saved theme
const savedTheme = localStorage.getItem("hindcare_theme");
if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);

export { navigate, renderScreen };
