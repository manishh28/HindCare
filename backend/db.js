const path = require("path");
const { Pool } = require("pg");

require("dotenv").config({
  path: path.join(__dirname, "..", ".env")
});

// TLS is ON and certificate verification is STRICT unless explicitly disabled
// via DATABASE_SSL=false (local development without TLS only). Verification
// used to be skipped entirely (rejectUnauthorized: false), which allowed a
// machine-in-the-middle between this app and the database to read everything,
// including credentials in the connection string. Only turn verification off
// if you fully understand that trade-off.
const databaseSslDisabled = String(process.env.DATABASE_SSL || "").toLowerCase() === "false";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: databaseSslDisabled ? false : { rejectUnauthorized: true }
});

module.exports = pool;
