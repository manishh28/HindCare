const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^(\+91)?[6-9]\d{9}$/;

export function validateEmail(value) {
  const v = String(value || "").trim();
  if (!v) return { ok: false, message: "Email is required" };
  if (!EMAIL_RE.test(v)) return { ok: false, message: "Enter a valid email address" };
  return { ok: true, value: v.toLowerCase() };
}

export function validatePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const normalized = digits.length === 10 ? `+91${digits}` : `+${digits}`;
  if (!PHONE_RE.test(normalized.replace("+", ""))) {
    return { ok: false, message: "Enter a valid 10-digit mobile number" };
  }
  return { ok: true, value: normalized };
}

export function validatePassword(value) {
  const v = String(value || "");
  if (!v) return { ok: false, message: "Password is required", strength: calcStrength(v) };
  if (v.length < 8) return { ok: false, message: "At least 8 characters required", strength: calcStrength(v) };
  if (!/[A-Z]/.test(v)) return { ok: false, message: "Include an uppercase letter", strength: calcStrength(v) };
  if (!/[a-z]/.test(v)) return { ok: false, message: "Include a lowercase letter", strength: calcStrength(v) };
  if (!/[0-9]/.test(v)) return { ok: false, message: "Include a number", strength: calcStrength(v) };
  if (!/[^A-Za-z0-9]/.test(v)) return { ok: false, message: "Include a special character", strength: calcStrength(v) };
  return { ok: true, value: v, strength: calcStrength(v) };
}

export function validateName(value) {
  const v = String(value || "").trim();
  if (!v) return { ok: false, message: "Name is required" };
  if (v.length < 2) return { ok: false, message: "Name is too short" };
  return { ok: true, value: v };
}

export function validateOtp(value) {
  const v = String(value || "").replace(/\D/g, "");
  if (v.length !== 6) return { ok: false, message: "Enter the 6-digit OTP" };
  return { ok: true, value: v };
}

export function calcStrength(password) {
  const checks = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password)
  };
  const score = Object.values(checks).filter(Boolean).length;
  let level = "weak";
  if (score >= 4) level = "medium";
  if (score >= 5 && password.length >= 12) level = "strong";
  return { score, level, checks };
}

export function renderStrengthBar(strength) {
  const levels = ["weak", "medium", "strong"];
  const activeCount = strength.level === "weak" ? 1 : strength.level === "medium" ? 2 : 3;
  return `<div class="strength-bar" role="meter" aria-valuenow="${strength.score}" aria-valuemin="0" aria-valuemax="5" aria-label="Password strength: ${strength.level}">
    ${[0, 1, 2].map(i => `<div class="strength-segment ${i < activeCount ? `active ${strength.level}` : ""}"></div>`).join("")}
  </div>
  <span class="md-field-hint">Strength: ${strength.level}</span>`;
}

export function setFieldError(input, message) {
  const field = input.closest(".md-field");
  if (!field) return;
  const errEl = field.querySelector(".md-field-error");
  if (message) {
    input.classList.add("error");
    input.classList.remove("success");
    input.setAttribute("aria-invalid", "true");
    if (errEl) errEl.textContent = message;
  } else {
    input.classList.remove("error");
    input.setAttribute("aria-invalid", "false");
    if (errEl) errEl.textContent = "";
  }
}

export function setupRealtimeValidation(form, rules) {
  Object.entries(rules).forEach(([name, validator]) => {
    const input = form.querySelector(`[name="${name}"]`);
    if (!input) return;
    input.addEventListener("blur", () => {
      const result = validator(input.value);
      setFieldError(input, result.ok ? "" : result.message);
    });
    input.addEventListener("input", () => {
      if (input.classList.contains("error")) {
        const result = validator(input.value);
        if (result.ok) setFieldError(input, "");
      }
    });
  });
}

export function startOtpTimer(seconds, onTick, onComplete) {
  let remaining = seconds;
  onTick(remaining);
  const interval = setInterval(() => {
    remaining -= 1;
    onTick(remaining);
    if (remaining <= 0) {
      clearInterval(interval);
      onComplete();
    }
  }, 1000);
  return () => clearInterval(interval);
}
