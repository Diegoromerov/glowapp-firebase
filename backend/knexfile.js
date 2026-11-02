// backend/knexfile.js
require('dotenv').config();

module.exports = {
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  },
  pool: {
    min: 2,
    max: 10,
  },
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations',
    loadExtensions: ['.js', '.sql'],
  },
  seeds: {
    directory: './seeds',
  },
};