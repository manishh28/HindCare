const path = require("path");
const { Pool } = require("pg");

require("dotenv").config({
  path: path.join(__dirname, "..", ".env")
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = pool;