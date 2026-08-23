// Durable storage for authentication state in PostgreSQL.
//
// The auth module keeps working-set data in memory for fast synchronous lookups,
// but everything important is hydrated from PostgreSQL at startup and flushed
// back on a short debounce plus a periodic sweep and process exit. This means:
//   - users, sessions, OTPs, reset tokens, audit logs and login history survive
//     restarts instead of evaporating with the process;
//   - the audit trail is tamper-evident enough to be worth keeping;
//   - no plaintext secrets are ever written: keys prefixed with "_" (plain
//     refresh tokens / OTPs / reset tokens) are stripped before serialization.
//
// The table is deliberately schemaless (JSONB per collection). Migrating every
// collection to normalized tables is tracked separately; this closes the
// "all auth state lives in RAM" hole now.

const FLUSH_DEBOUNCE_MS = 5 * 1000;      // shortly after any mutation
const FLUSH_INTERVAL_MS = 30 * 1000;     // periodic safety net

// Every store array we persist. Anything not listed here stays memory-only.
const PERSISTED_COLLECTIONS = [
  "users",
  "sessions",
  "otps",
  "resetTokens",
  "auditLogs",
  "loginHistory",
  "driverProfiles",
  "dispatcherProfiles",
  "hospitalAdminProfiles",
  "hospitalStaffProfiles",
  "superAdminProfiles",
  "customerProfiles",
  "fleetOwnerProfiles",
  "addresses",
  "emergencyContacts",
  "documents",
  "driverBankDetails",
  "notificationPrefs",
  "apiKeys"
];

const COUNTER_KEYS = [
  "nextUserId",
  "nextOtpId",
  "nextAuditId",
  "nextLoginId",
  "nextAddressId",
  "nextEmergencyId",
  "nextDocumentId"
];

let dbPool = null;
let authStore = null;
let flushTimer = null;
let debounceTimer = null;
let flushing = false;
let dirty = false;
let lastErrorLoggedAt = 0;

function markIfDirtyNoop() { /* "exit" can't run async work — SIGINT/SIGTERM handlers above cover flushing */ }

function markAuthStateDirty() {
  if (!dbPool) return; // persistence not wired up (e.g. unit tests)
  dirty = true;
  if (!debounceTimer) {
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      flushAuthState().catch(() => {});
    }, FLUSH_DEBOUNCE_MS);
    // Don't hold the process open just for a pending flush.
    if (typeof debounceTimer.unref === "function") debounceTimer.unref();
  }
}

// Strip plaintext-secret fields (keys starting with "_") before anything
// leaves the process.
function serializeCollection(rows) {
  return JSON.parse(JSON.stringify(rows, (key, value) =>
    key.startsWith("_") ? undefined : value
  ));
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_auth_state (
      collection TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function hydrateAuthState() {
  const client = await dbPool.connect();
  try {
    const result = await client.query("SELECT collection, data FROM app_auth_state");
    let restoredCollections = 0;
    for (const row of result.rows) {
      if (row.collection === "__counters") {
        for (const key of COUNTER_KEYS) {
          const stored = Number(row.data[key] || 0);
          if (stored > 0) counterRestore(key, stored);
        }
        continue;
      }
      if (Array.isArray(authStore[row.collection]) && Array.isArray(row.data)) {
        authStore[row.collection] = row.data;
        restoredCollections += 1;
      }
    }
    return restoredCollections;
  } finally {
    client.release();
  }
}

// Counter values (nextUserId etc.) live as closure variables in store.js, so
// initAuthPersistence() receives two hooks: snapshot() reads them all,
// restore(key, value) raises any that come back from PostgreSQL lower than
// what's already live (never lower a counter — ids must stay monotonic).
let counterSnapshot = () => ({});
let counterRestore = () => {};

async function flushAuthState() {
  if (!dbPool || !authStore || flushing) return;
  flushing = true;
  const client = await dbPool.connect();
  try {
    await ensureTable(client);
    const payload = counterSnapshot();
    for (const collection of PERSISTED_COLLECTIONS) {
      const rows = serializeCollection(authStore[collection] || []);
      await client.query(
        `
          INSERT INTO app_auth_state (collection, data, updated_at)
          VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
          ON CONFLICT (collection)
          DO UPDATE SET data = EXCLUDED.data, updated_at = CURRENT_TIMESTAMP
        `,
        [collection, JSON.stringify(rows)]
      );
    }
    await client.query(
      `
        INSERT INTO app_auth_state (collection, data, updated_at)
        VALUES ('__counters', $1::jsonb, CURRENT_TIMESTAMP)
        ON CONFLICT (collection)
        DO UPDATE SET data = EXCLUDED.data, updated_at = CURRENT_TIMESTAMP
      `,
      [JSON.stringify(payload)]
    );
    dirty = false;
  } catch (error) {
    // Never take the API down because persistence hiccuped — but make sure the
    // failure is visible in logs rather than silently losing the audit trail.
    const now = Date.now();
    if (now - lastErrorLoggedAt > 60_000) {
      lastErrorLoggedAt = now;
      console.error("[HindCare] Failed to persist auth state to PostgreSQL:", error.message);
    }
  } finally {
    client.release();
    flushing = false;
  }
}

async function initAuthPersistence(pool, store, hooks = {}) {
  dbPool = pool;
  authStore = store;
  counterSnapshot = typeof hooks.snapshot === "function" ? hooks.snapshot : counterSnapshot;
  counterRestore = typeof hooks.restore === "function" ? hooks.restore : counterRestore;

  let restored = 0;
  const client = await pool.connect();
  try {
    await ensureTable(client);
  } finally {
    client.release();
  }
  restored = await hydrateAuthState();

  const interval = setInterval(() => {
    if (dirty) flushAuthState().catch(() => {});
  }, FLUSH_INTERVAL_MS);
  if (typeof interval.unref === "function") interval.unref();

  const shutdownAndFlush = (signal) => {
    if (!dirty) {
      process.exit(0);
      return;
    }
    // Hard cap so an unreachable database can't hang shutdown.
    const forceExit = setTimeout(() => process.exit(0), 1500);
    flushAuthState()
      .catch(() => {})
      .finally(() => {
        clearTimeout(forceExit);
        process.exit(0);
      });
  };
  process.once("SIGINT", () => shutdownAndFlush("SIGINT"));
  process.once("SIGTERM", () => shutdownAndFlush("SIGTERM"));
  process.once("exit", markIfDirtyNoop);

  console.log(
    restored > 0
      ? `[HindCare] Auth state restored from PostgreSQL (${restored} collections).`
      : "[HindCare] Auth persistence ready (fresh store — no prior state found)."
  );
  return { flushAuthState };
}

module.exports = {
  initAuthPersistence,
  flushAuthState,
  markAuthStateDirty
};
