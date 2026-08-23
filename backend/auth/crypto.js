const crypto = require("crypto");

function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET is not set. Refusing to start in production without a real signing secret. " +
      "Generate one (e.g. `node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"`) and set it in your environment."
    );
  }

  const devSecret = crypto.randomBytes(32).toString("hex");
  console.warn(
    "[HindCare] WARNING: JWT_SECRET is not set. Using a random secret generated for this run only.\n" +
    "           Every existing token will stop working the next time the server restarts.\n" +
    "           Set JWT_SECRET in your .env for a stable secret across restarts."
  );
  return devSecret;
}

const JWT_SECRET = resolveJwtSecret();
const JWT_ISSUER = "hindcare-auth";
const ACCESS_TOKEN_TTL_SEC = Number(process.env.ACCESS_TOKEN_TTL_SEC || 900);
const REFRESH_TOKEN_TTL_SEC = Number(process.env.REFRESH_TOKEN_TTL_SEC || 604800);
const OTP_TTL_SEC = Number(process.env.OTP_TTL_SEC || 300);
const RESET_TOKEN_TTL_SEC = Number(process.env.RESET_TOKEN_TTL_SEC || 1800);
const MAX_LOGIN_ATTEMPTS = Number(process.env.MAX_LOGIN_ATTEMPTS || 5);
const LOCKOUT_DURATION_MS = Number(process.env.LOCKOUT_DURATION_MS || 900000);

function base64UrlEncode(buffer) {
  return buffer.toString("base64url");
}

function base64UrlDecode(str) {
  return Buffer.from(str, "base64url");
}

function signJwt(payload, expiresInSec) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iss: JWT_ISSUER, iat: now, exp: now + expiresInSec };
  const headerPart = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadPart = base64UrlEncode(Buffer.from(JSON.stringify(body)));
  const data = `${headerPart}.${payloadPart}`;
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(data).digest("base64url");
  return `${data}.${signature}`;
}

function verifyJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("Invalid token format");
  const [headerPart, payloadPart, signature] = parts;
  const data = `${headerPart}.${payloadPart}`;

  // Reject unexpected algorithms up front — never let an attacker pick "none"
  // or an asymmetric alg and hope verification is skipped.
  let header;
  try {
    header = JSON.parse(base64UrlDecode(headerPart).toString("utf8"));
  } catch {
    throw new Error("Invalid token header");
  }
  if (header.alg !== "HS256") throw new Error("Unsupported token algorithm");

  const expected = crypto.createHmac("sha256", JWT_SECRET).update(data).digest("base64url");
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch — do an explicit length check
  // first so mismatched-length signatures fail cleanly instead of erroring.
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) {
    throw new Error("Invalid token signature");
  }

  const payload = JSON.parse(base64UrlDecode(payloadPart).toString("utf8"));
  if (payload.iss !== JWT_ISSUER) throw new Error("Invalid token issuer");
  if (!payload.sid || typeof payload.sub === "undefined") {
    // Every token this server issues is bound to a server-side session, so a
    // token without one can't be ours — reject rather than bypassing the
    // revocation check in middleware.authenticate().
    throw new Error("Invalid token claims");
  }
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }
  return payload;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [algo, saltHex, hashHex] = stored.split("$");
  if (algo !== "scrypt") return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
  return crypto.timingSafeEqual(derived, expected);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

function generateSecureToken() {
  return crypto.randomBytes(32).toString("hex");
}

function generateSessionId() {
  return crypto.randomUUID();
}

function passwordStrength(password) {
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

module.exports = {
  JWT_SECRET,
  ACCESS_TOKEN_TTL_SEC,
  REFRESH_TOKEN_TTL_SEC,
  OTP_TTL_SEC,
  RESET_TOKEN_TTL_SEC,
  MAX_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  signJwt,
  verifyJwt,
  hashPassword,
  verifyPassword,
  hashToken,
  generateOtp,
  generateSecureToken,
  generateSessionId,
  passwordStrength
};
