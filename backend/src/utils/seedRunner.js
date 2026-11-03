const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

async function executeSeed({ pool, env = process.env, seedPath = path.join(__dirname, '../../seed.sql') }) {
  if (env.NODE_ENV === 'production') {
    throw new Error('Omitiendo siembra de base de datos: la siembra automática está prohibida en producción.');
  }

  if (env.SEED_DATABASE !== 'true') {
    return { seeded: false, reason: 'SEED_DATABASE_NOT_TRUE' };
  }

  const seedPassword = env.SEED_PASSWORD;
  if (!seedPassword || !seedPassword.trim()) {
    throw new Error('SEED_PASSWORD variable de entorno es requerida para ejecutar la siembra de datos de prueba (seed.sql). No se configuraron contraseñas por defecto.');
  }

  if (!fs.existsSync(seedPath)) {
    throw new Error(`Archivo seed.sql no encontrado en ${seedPath}`);
  }

  const hash = bcrypt.hashSync(seedPassword.trim(), 10);
  let seedSql = fs.readFileSync(seedPath, 'utf8');
  seedSql = seedSql.replace(/__SEED_PASSWORD_HASH__/g, hash);

  await pool.query(seedSql);
  return { seeded: true };
}

module.exports = { executeSeed };
