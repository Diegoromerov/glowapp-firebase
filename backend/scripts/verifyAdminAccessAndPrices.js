/**
 * SCRIPT GUARDIÁN DE VERIFICACIÓN — AUTENTICACIÓN Y ACCESO ADMINISTRATIVO A PRECIOS (GLOWSHOP B-02)
 * 
 * Verificación obligatoria:
 *  1. Creación de usuarios fixture dinámicos con contraseñas aleatorias (sin contraseñas fijas ni credenciales reales).
 *  2. POST /api/auth/login con credenciales del Admin fixture -> 200 y Token.
 *  3. GET /api/admin/precios con token ADMIN -> HTTP 200.
 *  4. GET /api/admin/precios con token PRESTADOR (no-admin) -> HTTP 403.
 *  5. PUT /api/admin/precios/1 con token ADMIN -> HTTP 200 y lectura de vuelta en BD.
 *  6. GET /api/admin/precios/export.csv con Header Authorization -> HTTP 200 y descarga CSV.
 *  7. GET /api/admin/precios/export.csv sin Header -> HTTP 401.
 *  8. GET /api/admin/precios/export.csv?token=<jwt> -> HTTP 401.
 *  9. Limpieza de usuarios fixture en finally y comprobación asertiva de cambio neto cero en BD por valores.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { getJwtSecret } = require('../src/config/jwt');
const authController = require('../src/controllers/authController');
const adminPreciosRoutes = require('../src/routes/adminPreciosRoutes');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://admin:admin123@localhost:5435/beauty_db'
});

async function getDbSnapshot(dbPool) {
  const prods = await dbPool.query('SELECT id, nombre, costo, stock, sku, tenant_id FROM productos ORDER BY id');
  const precios = await dbPool.query('SELECT lista_id, producto_id, precio, unidad_minima FROM precios_producto ORDER BY lista_id, producto_id');
  const historial = await dbPool.query('SELECT id, lista_id, producto_id, precio_anterior, precio_nuevo, origen FROM precios_historial ORDER BY id');
  return {
    prods: prods.rows,
    precios: precios.rows,
    historial: historial.rows
  };
}

function verifyValueSnapshot(snapshotPre, snapshotPost) {
  const preStr = JSON.stringify(snapshotPre);
  const postStr = JSON.stringify(snapshotPost);
  if (preStr !== postStr) {
    console.error('❌ ERROR DE CAMBIO NETO CERO EN VALORES EN BD:');
    if (snapshotPre.precios.length !== snapshotPost.precios.length) {
      console.error(`   Precios total: inicial=${snapshotPre.precios.length} vs final=${snapshotPost.precios.length}`);
    }
    return false;
  }
  return true;
}

async function main() {
  console.log('==================================================');
  console.log('🔍 VERIFICACIÓN DE AUTENTICACIÓN ADMIN, PRECIOS Y EXPORT CSV');
  console.log('==================================================\n');

  let exitCode = 0;
  let server = null;
  const snapshotPre = await getDbSnapshot(pool);

  // Generar emails y contraseñas fixture aleatorias dinámicas en memoria (nunca hardcodeadas)
  const randomSuffix = crypto.randomBytes(6).toString('hex');
  const fixtureAdminEmail = `fixture_admin_${randomSuffix}@glowapp.test`;
  const fixtureAdminPassword = `PassAdmin_${crypto.randomBytes(12).toString('hex')}!`;

  const fixtureProviderEmail = `fixture_provider_${randomSuffix}@glowapp.test`;
  const fixtureProviderPassword = `PassProf_${crypto.randomBytes(12).toString('hex')}!`;

  let fixtureAdminId = null;
  let fixtureProviderId = null;

  try {
    console.log('0. Creando usuarios de prueba sintéticos (fixtures)...');
    const platRes = await pool.query('SELECT app_platform_tenant_id() AS tid');
    const platformTenantId = platRes.rows[0]?.tid || 9;

    const hashAdmin = await bcrypt.hash(fixtureAdminPassword, 10);
    const hashProvider = await bcrypt.hash(fixtureProviderPassword, 10);

    const adminIns = await pool.query(`
      INSERT INTO usuarios (email, nombre, auth_provider, provider_id, password_hash, rol, tenant_id, is_active, onboarding_completo)
      VALUES ($1, 'Fixture Admin', 'LOCAL', $1, $2, 'ADMIN', $3, true, true)
      RETURNING id
    `, [fixtureAdminEmail, hashAdmin, platformTenantId]);
    fixtureAdminId = adminIns.rows[0].id;

    const provIns = await pool.query(`
      INSERT INTO usuarios (email, nombre, auth_provider, provider_id, password_hash, rol, tenant_id, is_active, onboarding_completo)
      VALUES ($1, 'Fixture Provider', 'LOCAL', $1, $2, 'PRESTADOR', $3, true, true)
      RETURNING id
    `, [fixtureProviderEmail, hashProvider, platformTenantId]);
    fixtureProviderId = provIns.rows[0].id;

    console.log(`   ✔ Fixture ADMIN (ID ${fixtureAdminId}) y PRESTADOR (ID ${fixtureProviderId}) creados.\n`);

    // Montar servidor Express en puerto 0
    const app = express();
    app.use(express.json());

    app.post('/api/auth/login', authController.login);
    app.use('/api/admin', adminPreciosRoutes);

    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });

    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`   Servidor Express iniciado en ${baseUrl}\n`);

    // 1. POST /api/auth/login con credenciales Admin Fixture -> 200 y Token
    console.log('1. Probando POST /api/auth/login con credenciales de usuario ADMIN Fixture...');
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: fixtureAdminEmail, password: fixtureAdminPassword })
    });

    if (loginRes.status !== 200) {
      throw new Error(`Login de admin falló con HTTP ${loginRes.status}`);
    }

    const loginData = await loginRes.json();
    const adminToken = loginData.token;
    if (!adminToken) {
      throw new Error('El login de admin no retornó un token JWT válido');
    }
    console.log('   ✔ Login de ADMIN exitoso (HTTP 200). Token JWT obtenido correctamente.\n');

    // 2. GET /api/admin/precios con token ADMIN -> HTTP 200
    console.log('2. Probando GET /api/admin/precios con token ADMIN...');
    const preciosRes = await fetch(`${baseUrl}/api/admin/precios`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    if (preciosRes.status !== 200) {
      throw new Error(`GET /api/admin/precios con admin retornó HTTP ${preciosRes.status} en lugar de 200`);
    }
    const preciosBody = await preciosRes.json();
    console.log(`   ✔ GET /api/admin/precios retornó HTTP 200. Total productos en respuesta: ${preciosBody.filas?.length || 0}.\n`);

    // 3. GET /api/admin/precios con token PRESTADOR Fixture -> HTTP 403
    console.log('3. Probando GET /api/admin/precios con token PRESTADOR (no-admin)...');
    const secret = getJwtSecret();
    const providerToken = jwt.sign({ id: fixtureProviderId, email: fixtureProviderEmail }, secret);

    const providerPreciosRes = await fetch(`${baseUrl}/api/admin/precios`, {
      headers: { 'Authorization': `Bearer ${providerToken}` }
    });

    if (providerPreciosRes.status !== 403) {
      throw new Error(`GET /api/admin/precios con rol PRESTADOR debió retornar HTTP 403, obtuvo: ${providerPreciosRes.status}`);
    }
    console.log('   ✔ Acceso denegado correctamente con HTTP 403 para usuario rol PRESTADOR.\n');

    // 4. PUT /api/admin/precios/1 con token ADMIN -> HTTP 200 y lectura de vuelta en BD
    console.log('4. Probando PUT /api/admin/precios/1 con token ADMIN y lectura de vuelta en BD...');
    const putRes = await fetch(`${baseUrl}/api/admin/precios/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        precios: [{ lista: 'cliente', precio: 45000.00 }],
        motivo: 'Verificación Entregable B-02'
      })
    });

    if (putRes.status !== 200) {
      throw new Error(`PUT /api/admin/precios/1 retornó HTTP ${putRes.status}`);
    }

    const dbPriceRes = await pool.query(`
      SELECT pp.precio, lp.codigo 
      FROM precios_producto pp
      JOIN listas_precios lp ON lp.id = pp.lista_id
      WHERE pp.producto_id = 1 AND lp.codigo = 'cliente'
    `);

    const dbPrecio = parseFloat(dbPriceRes.rows[0]?.precio);
    if (dbPrecio !== 45000.00) {
      throw new Error(`El precio en BD no coincide tras PUT: ${dbPrecio} vs 45000.00`);
    }
    console.log(`   ✔ PUT /api/admin/precios/1 exitoso (HTTP 200). Leído de vuelta en BD: $${dbPrecio.toFixed(2)}.\n`);

    // 5. GET /api/admin/precios/export.csv CON Header Authorization -> HTTP 200
    console.log('5. Probando GET /api/admin/precios/export.csv CON Header Authorization...');
    const csvOkRes = await fetch(`${baseUrl}/api/admin/precios/export.csv`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    if (csvOkRes.status !== 200) {
      throw new Error(`Export CSV con Header retornó HTTP ${csvOkRes.status} en lugar de 200`);
    }

    const contentType = csvOkRes.headers.get('content-type') || '';
    if (!contentType.includes('text/csv')) {
      throw new Error(`Content-Type inesperado para export CSV: ${contentType}`);
    }

    const csvText = await csvOkRes.text();
    const csvLines = csvText.trim().split('\n');
    console.log(`   ✔ Export CSV con Header exitoso (HTTP 200, Content-Type: ${contentType}).`);
    console.log(`   Header CSV: "${csvLines[0]}"`);
    console.log(`   Fila 1 CSV: "${csvLines[1] || ''}"\n`);

    // 6. GET /api/admin/precios/export.csv SIN Header -> HTTP 401
    console.log('6. Probando GET /api/admin/precios/export.csv SIN Header Authorization...');
    const csvNoAuthRes = await fetch(`${baseUrl}/api/admin/precios/export.csv`);
    if (csvNoAuthRes.status !== 401) {
      throw new Error(`Export CSV sin auth debió retornar HTTP 401, obtuvo: ${csvNoAuthRes.status}`);
    }
    console.log('   ✔ Export CSV sin header rechazado con HTTP 401 UNAUTHORIZED.\n');

    // 7. GET /api/admin/precios/export.csv?token=<jwt> -> HTTP 401
    console.log('7. Probando GET /api/admin/precios/export.csv?token=<jwt>...');
    const csvUrlTokenRes = await fetch(`${baseUrl}/api/admin/precios/export.csv?token=${encodeURIComponent(adminToken)}`);
    if (csvUrlTokenRes.status !== 401) {
      throw new Error(`Export CSV con ?token= en URL debió retornar HTTP 401, obtuvo: ${csvUrlTokenRes.status}`);
    }
    console.log('   ✔ Export CSV con ?token= en URL rechazado correctamente con HTTP 401 (token en URL muerto).\n');

  } catch (err) {
    console.error('❌ Error en verificación:', err.message);
    exitCode = 1;
  } finally {
    if (server) {
      server.close();
    }

    // Limpiar usuarios fixture creados
    await pool.query("DELETE FROM usuarios WHERE email LIKE 'fixture_%'");
    await pool.query("DELETE FROM precios_historial WHERE motivo = 'Verificación Entregable B-02'");

    const snapshotPost = await getDbSnapshot(pool);
    const passed = verifyValueSnapshot(snapshotPre, snapshotPost);

    if (!passed) {
      exitCode = 1;
    } else {
      console.log('✅ CAMBIO NETO CERO EN VALORES VERIFICADO EN BD.');
    }

    await pool.end();

    if (exitCode === 0) {
      console.log('==================================================');
      console.log('🎉 [VERIFICACIÓN B-02] COMPLETADA EXITOSAMENTE (VERDE)');
      console.log('==================================================');
    } else {
      console.error('💥 [VERIFICACIÓN B-02] FALLIDA (ROJO)');
    }
    process.exit(exitCode);
  }
}

main();
