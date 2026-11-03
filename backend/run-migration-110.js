const fs = require("fs");
const path = require("path");
const { pool } = require("./src/config/db");

async function runMigration() {
  const migrationPath = path.join(__dirname, "migrations/110_saas_schema_fix_and_complete.sql");
  const sql = fs.readFileSync(migrationPath, "utf8");
  console.log("Ejecutando migración 110...");
  
  try {
    await pool.query(sql);
    console.log("✅ Migración 110 ejecutada exitosamente");
  } catch (err) {
    console.error("❌ Error en migración:", err.message);
    console.error("Code:", err.code);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();