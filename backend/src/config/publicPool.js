'use strict';
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
function sslFor(url) {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.railway.internal')) return false;
  } catch { return false; }
  return { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' };
}
const publicPool = connectionString ? new Pool({
  connectionString,
  ssl: sslFor(connectionString),
  max: 3,
  statement_timeout: 3000,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
}) : null;

module.exports = publicPool;
