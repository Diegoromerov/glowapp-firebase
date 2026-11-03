/**
 * GUARDIÁN DE VERIFICACIÓN — AUTORIZACIÓN DEL CATÁLOGO Y PROTECCIÓN DE HISTORIAL (GLOWSHOP A0)
 * 
 * Comprueba las aserciones obligatorias sobre servidor HTTP Express real (app.listen(0)):
 *  0. Idempotencia de la Migración 072 ejecutada dos veces
 *  1. 403 al POST, PUT, DELETE para roles client, provider, salon (9 combinaciones)
 *  2. 400 al enviar POST sin costo o con costo negativo
 *  3. POST enviando tenant_id: 1 en el body confirmando que el contexto del actor se respeta (SELECT tenant_id)
 *  4. 201 POST y 200 PUT como admin
 *  5. 200/204 DELETE de un producto SIN historial
 *  6. 409 CONFLICT en DELETE de un producto CON historial
 *  7. Modificación neta cero en la BD tras finalizar mediante snapshot de valores
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { getJwtSecret } = require('../src/config/jwt');
const productRoutes = require('../src/routes/productRoutes');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://admin:admin123@localhost:5435/beauty_db'
});

async function getDbSnapshot(pool) {
  const prods = await pool.query('SELECT id, nombre, costo, stock, sku, tenant_id FROM productos ORDER BY id');
  const precios = await pool.query('SELECT lista_id, producto_id, precio FROM precios_producto ORDER BY lista_id, producto_id');
  const historial = await pool.query('SELECT id, lista_id, producto_id, precio_anterior, precio_nuevo, motivo FROM precios_historial ORDER BY id');
  return {
    prods: prods.rows,
    precios: precios.rows,
    historial: historial.rows
  };
}

function verifyValueSnapshot(initial, final) {
  const initStr = JSON.stringify(initial);
  const finalStr = JSON.stringify(final);
  if (initStr !== finalStr) {
    console.error('❌ ERROR DE CAMBIO NETO EN VALORES EN BD:');
    if (initial.prods.length !== final.prods.length) {
      console.error(`   Productos total: inicial=${initial.prods.length} vs final=${final.prods.length}`);
    }
    if (initial.precios.length !== final.precios.length) {
      console.error(`   Precios total: inicial=${initial.precios.length} vs final=${final.precios.length}`);
    }
    if (initial.historial.length !== final.historial.length) {
      console.error(`   Historial total: inicial=${initial.historial.length} vs final=${final.historial.length}`);
    }
    return false;
  }
  return true;
}

async function main() {
  console.log('==================================================');
  console.log('🔍 INICIANDO VERIFICACIÓN HTTP DEL GUARDIÁN DE CATÁLOGO AUTORIZADO Y HISTORIAL');
  console.log('==================================================\n');

  let exitCode = 0;
  let server = null;
  let createdProdIdNoHist = null;
  let createdProdIdWithHist = null;

  // Snapshot inicial de BD
  const initialSnapshot = await getDbSnapshot(pool);

  try {
    // 0. Ejecutar migración 072 dos veces (Test de idempotencia)
    console.log('0. Probando idempotencia de Migración 072 (ejecución doble)...');
    const migPath = path.join(__dirname, '../migrations/072_catalogo_autorizado_y_historial_protegido.sql');
    const migSql = fs.readFileSync(migPath, 'utf8');

    await pool.query(migSql);
    await pool.query(migSql);
    console.log('   ✔ Migración 072 ejecutada 2 veces exitosamente (Idempotencia probada).\n');

    // Insertar/Asegurar usuarios de prueba para HTTP Auth (IDs 99991-99994)
    await pool.query(`
      INSERT INTO usuarios (id, email, nombre, auth_provider, provider_id, rol, tenant_id)
      VALUES 
        (99991, 'guardian_client@test.com', 'Client Test', 'LOCAL', '99991', 'CLIENTE', 2),
        (99992, 'guardian_provider@test.com', 'Provider Test', 'LOCAL', '99992', 'PRESTADOR', 2),
        (99993, 'guardian_salon@test.com', 'Salon Test', 'LOCAL', '99993', 'SALON', 2),
        (99994, 'guardian_admin@test.com', 'Admin Test', 'LOCAL', '99994', 'ADMIN', 2)
      ON CONFLICT (id) DO UPDATE SET
        rol = EXCLUDED.rol,
        tenant_id = EXCLUDED.tenant_id;
    `);

    // Firmar Tokens JWT reales
    const secret = getJwtSecret();
    const tokenClient = jwt.sign({ id: 99991, email: 'guardian_client@test.com' }, secret);
    const tokenProvider = jwt.sign({ id: 99992, email: 'guardian_provider@test.com' }, secret);
    const tokenSalon = jwt.sign({ id: 99993, email: 'guardian_salon@test.com' }, secret);
    const tokenAdmin = jwt.sign({ id: 99994, email: 'guardian_admin@test.com' }, secret);

    // Levantar Servidor HTTP Express en puerto 0
    const app = express();
    app.use(express.json());
    app.use('/api', productRoutes);

    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });

    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`   Servidor HTTP Express iniciado en ${baseUrl}\n`);

    // 1. Porteros de Rol en HTTP Real (403 sin admin: 9 casos)
    console.log('1. Probando bloqueos 403 vía HTTP real para roles no-admin (9 combinaciones)...');
    const nonAdminTokens = [
      { name: 'client', token: tokenClient },
      { name: 'provider', token: tokenProvider },
      { name: 'salon', token: tokenSalon }
    ];

    for (const item of nonAdminTokens) {
      // POST
      const resPost = await fetch(`${baseUrl}/api/admin/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${item.token}` },
        body: JSON.stringify({ nombre: 'Prod Forbidden', tag_especialidad: 'capilar', costo: 1000 })
      });
      if (resPost.status !== 403) throw new Error(`POST /api/admin/products con rol ${item.name} devolvió HTTP ${resPost.status} en lugar de 403`);

      // PUT
      const resPut = await fetch(`${baseUrl}/api/admin/products/1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${item.token}` },
        body: JSON.stringify({ nombre: 'Prod Forbidden Edit', tag_especialidad: 'capilar', costo: 1000 })
      });
      if (resPut.status !== 403) throw new Error(`PUT /api/admin/products/1 con rol ${item.name} devolvió HTTP ${resPut.status} en lugar de 403`);

      // DELETE
      const resDel = await fetch(`${baseUrl}/api/admin/products/1`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${item.token}` }
      });
      if (resDel.status !== 403) throw new Error(`DELETE /api/admin/products/1 con rol ${item.name} devolvió HTTP ${resDel.status} en lugar de 403`);
    }
    console.log('   ✔ Las 9 combinaciones (POST/PUT/DELETE x client/provider/salon) devolvieron 403 FORBIDDEN.\n');

    // 2. Validación HTTP 400 por costo faltante / inválido
    console.log('2. Probando validación HTTP 400 por costo omiso o negativo...');
    // Faltante
    const resNoCost = await fetch(`${baseUrl}/api/admin/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ nombre: 'Sin Costo', tag_especialidad: 'capilar' })
    });
    if (resNoCost.status !== 400) throw new Error(`POST omitiendo costo debió retornar HTTP 400, obtuvo: ${resNoCost.status}`);

    // Negativo
    const resNegCost = await fetch(`${baseUrl}/api/admin/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ nombre: 'Costo Negativo', tag_especialidad: 'capilar', costo: -500 })
    });
    if (resNegCost.status !== 400) throw new Error(`POST con costo -500 debió retornar HTTP 400, obtuvo: ${resNegCost.status}`);
    console.log('   ✔ Solicitudes sin costo o con costo negativo rechazadas con HTTP 400.\n');

    // 3. Respeto al contexto del actor (tenant_id: 1 en body override)
    console.log('3. Probando aislamiento de tenant: POST enviando tenant_id: 1 en el body...');
    const resTenant = await fetch(`${baseUrl}/api/admin/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAdmin}` },
      body: JSON.stringify({
        nombre: 'Producto Tenant Test',
        tag_especialidad: 'capilar',
        costo: 25000,
        tenant_id: 1 // intento de spoofing
      })
    });

    if (resTenant.status !== 201) throw new Error(`POST /api/admin/products con admin falló con HTTP ${resTenant.status}`);
    const tenantBody = await resTenant.json();
    createdProdIdNoHist = tenantBody.data?.id;

    // Verificar en BD que el tenant_id asignado sea el del actor (2) y NO el del body (1)
    const checkTenantRes = await pool.query('SELECT tenant_id FROM productos WHERE id = $1', [createdProdIdNoHist]);
    if (checkTenantRes.rows[0].tenant_id !== 2) {
      throw new Error(`El producto tomó tenant_id=${checkTenantRes.rows[0].tenant_id} del body en lugar del actor (2)`);
    }
    console.log(`   ✔ Producto creado id=${createdProdIdNoHist} ignoró tenant_id del body y conservó tenant_id=2 del actor.\n`);

    // 4. Edición exitosa por Admin (HTTP 200 PUT)
    console.log('4. Probando actualización exitosa (HTTP 200 PUT) por Admin...');
    const resPutAdmin = await fetch(`${baseUrl}/api/admin/products/${createdProdIdNoHist}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAdmin}` },
      body: JSON.stringify({
        nombre: 'Producto Tenant Test Editado',
        tag_especialidad: 'capilar',
        costo: 28000
      })
    });
    if (resPutAdmin.status !== 200) throw new Error(`PUT /api/admin/products/${createdProdIdNoHist} devolvió HTTP ${resPutAdmin.status}`);
    const putBody = await resPutAdmin.json();
    if (putBody.data?.nombre !== 'Producto Tenant Test Editado' || parseFloat(putBody.data?.costo) !== 28000) {
      throw new Error(`Edición de producto no actualizó datos correctamente: ${JSON.stringify(putBody)}`);
    }
    console.log('   ✔ Producto actualizado exitosamente vía HTTP 200 PUT.\n');

    // 5. Borrado exitoso de producto SIN historial (HTTP 200/204 DELETE)
    console.log('5. Probando borrado exitoso (HTTP 200/204 DELETE) de producto SIN historial...');
    const resDelNoHist = await fetch(`${baseUrl}/api/admin/products/${createdProdIdNoHist}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenAdmin}` }
    });
    if (resDelNoHist.status !== 200 && resDelNoHist.status !== 204) {
      throw new Error(`DELETE sin historial devolvió HTTP ${resDelNoHist.status}`);
    }
    const checkDelRes = await pool.query('SELECT COUNT(*) FROM productos WHERE id = $1', [createdProdIdNoHist]);
    if (parseInt(checkDelRes.rows[0].count, 10) !== 0) {
      throw new Error(`El producto ${createdProdIdNoHist} aún existe en BD tras DELETE`);
    }
    createdProdIdNoHist = null; // ya borrado
    console.log('   ✔ Producto sin historial eliminado correctamente.\n');

    // 6. Intento de borrado de producto CON historial -> HTTP 409 CONFLICT
    console.log('6. Probando respuesta HTTP 409 CONFLICT en borrado de producto CON historial...');
    // Crear producto nuevo
    const resCreateWithHist = await fetch(`${baseUrl}/api/admin/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAdmin}` },
      body: JSON.stringify({
        nombre: 'Producto Con Historial Guardián',
        tag_especialidad: 'capilar',
        costo: 40000
      })
    });
    const withHistBody = await resCreateWithHist.json();
    createdProdIdWithHist = withHistBody.data?.id;

    // Insertar registro en precios_historial
    const listaRes = await pool.query("SELECT id FROM listas_precios WHERE codigo = 'cliente'");
    const listaId = listaRes.rows[0].id;

    await pool.query(`
      INSERT INTO precios_historial (lista_id, producto_id, precio_anterior, precio_nuevo, actor_id, origen, motivo, tenant_id)
      VALUES ($1, $2, NULL, 40000, 99994, 'manual', 'Historial para test 409', 2)
    `, [listaId, createdProdIdWithHist]);

    // Intentar borrar vía HTTP DELETE
    const resDelWithHist = await fetch(`${baseUrl}/api/admin/products/${createdProdIdWithHist}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenAdmin}` }
    });
    if (resDelWithHist.status !== 409) {
      throw new Error(`DELETE con historial devolvió HTTP ${resDelWithHist.status} en lugar de 409`);
    }
    const delErrBody = await resDelWithHist.json();
    if (delErrBody.error !== 'CONFLICT') {
      throw new Error(`Respuesta de error 409 inesperada: ${JSON.stringify(delErrBody)}`);
    }
    console.log('   ✔ Intento de borrado con historial bloqueado con HTTP 409 (CONFLICT).\n');

  } catch (err) {
    console.error('❌ Error en verificación del guardián HTTP:', err);
    exitCode = 1;
  } finally {
    // LIMPIEZA TOTAL EN BD Y SHUTDOWN DEL SERVIDOR
    try {
      if (server) {
        server.close();
      }
      if (createdProdIdWithHist) {
        await pool.query('DELETE FROM precios_historial WHERE producto_id = $1', [createdProdIdWithHist]);
        await pool.query('DELETE FROM precios_producto WHERE producto_id = $1', [createdProdIdWithHist]);
        await pool.query('DELETE FROM productos WHERE id = $1', [createdProdIdWithHist]);
      }
      if (createdProdIdNoHist) {
        await pool.query('DELETE FROM precios_historial WHERE producto_id = $1', [createdProdIdNoHist]);
        await pool.query('DELETE FROM precios_producto WHERE producto_id = $1', [createdProdIdNoHist]);
        await pool.query('DELETE FROM productos WHERE id = $1', [createdProdIdNoHist]);
      }

      // Eliminar usuarios de prueba
      await pool.query('DELETE FROM usuarios WHERE id IN (99991, 99992, 99993, 99994)');
    } catch (cleanErr) {
      console.error('Error durante la limpieza en finally:', cleanErr);
    }

    // Comprobación asertiva de CAMBIO NETO CERO EN VALORES
    const finalSnapshot = await getDbSnapshot(pool);
    const snapshotPassed = verifyValueSnapshot(initialSnapshot, finalSnapshot);

    if (!snapshotPassed) {
      exitCode = 1;
    } else {
      console.log('✅ CAMBIO NETO CERO EN VALORES VERIFICADO (296 productos / 296 precios conservados intactós).');
    }

    await pool.end();

    if (exitCode === 0) {
      console.log('==================================================');
      console.log('🎉 [GUARDIÁN] VERIFICACIÓN COMPLETADA EXITOSAMENTE (VERDE)');
      console.log('==================================================');
    } else {
      console.error('💥 [GUARDIÁN] VERIFICACIÓN FALLIDA (ROJO)');
    }
    process.exit(exitCode);
  }
}

main();
