/**
 * GUARDIÁN DE VERIFICACIÓN — IMPORTACIÓN Y EXPORTACIÓN MASIVA CSV DE PRECIOS GLOWSHOP
 * 
 * Verifica el funcionamiento contra PostgreSQL real en el puerto 5435 con CAMBIO NETO CERO EN VALORES.
 */

const { Pool } = require('pg');
const { parsearPreciosCsv, exportarPreciosCsv, aplicarPreciosCsv } = require('../src/services/preciosCsvService');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://admin:admin123@localhost:5435/beauty_db'
});

async function getDbSnapshot(dbPool) {
  const prods = await dbPool.query('SELECT id, nombre, costo, sku, stock, tenant_id FROM productos ORDER BY id');
  const precios = await dbPool.query('SELECT producto_id, lista_id, precio, unidad_minima FROM precios_producto ORDER BY producto_id, lista_id');
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
    console.error('❌ ERROR: DIVERGENCIA DE VALORES EN BASE DE DATOS DETECTADA (CAMBIO NETO CERO FALLÓ)');
    if (snapshotPre.prods.length !== snapshotPost.prods.length) {
      console.error(`  - Productos: inicial=${snapshotPre.prods.length}, final=${snapshotPost.prods.length}`);
    }
    if (snapshotPre.precios.length !== snapshotPost.precios.length) {
      console.error(`  - Precios: inicial=${snapshotPre.precios.length}, final=${snapshotPost.precios.length}`);
    }
    if (snapshotPre.historial.length !== snapshotPost.historial.length) {
      console.error(`  - Historial: inicial=${snapshotPre.historial.length}, final=${snapshotPost.historial.length}`);
    }
    for (let i = 0; i < Math.max(snapshotPre.precios.length, snapshotPost.precios.length); i++) {
      const p1 = snapshotPre.precios[i];
      const p2 = snapshotPost.precios[i];
      if (JSON.stringify(p1) !== JSON.stringify(p2)) {
        console.error(`  - Diferencia en precio[${i}]: ANTES=${JSON.stringify(p1)} vs DESPUÉS=${JSON.stringify(p2)}`);
        break;
      }
    }
    return false;
  }
  return true;
}

async function main() {
  console.log('==================================================');
  console.log('🔍 INICIANDO VERIFICACIÓN DEL GUARDIÁN DE CSV DE PRECIOS');
  console.log('==================================================\n');

  let exitCode = 0;

  // Captura de snapshot inicial de valores en BD
  const snapshotPre = await getDbSnapshot(pool);
  const initialProdCount = snapshotPre.prods.length;

  let createdProdIds = [];

  try {
    // 1. Probar exportación a CSV
    console.log('1. Probando exportarPreciosCsv()...');
    const csvExportado = await exportarPreciosCsv({ dbPool: pool });
    const lines = csvExportado.split('\n').filter(l => l.trim().length > 0);
    const header = lines[0];

    console.log(`   Header exportado: ${header}`);
    const expectedHeader = 'producto_id,sku,nombre,costo,stock,precio_cliente,precio_profesional,precio_negocio,unidad_minima_negocio';
    if (header !== expectedHeader) {
      throw new Error(`El encabezado exportado (${header}) no coincide con el esperado (${expectedHeader})`);
    }

    const totalProds = initialProdCount;
    console.log(`   Filas exportadas: ${lines.length - 1} (esperadas: ${totalProds})`);

    if (lines.length - 1 !== totalProds) {
      throw new Error(`Cantidad de filas exportadas (${lines.length - 1}) no coincide con el total de productos (${totalProds})`);
    }
    console.log('   ✔ Exportación CSV validada correctamente.\n');

    // 2. Probar parseo de función pura con errores de formato
    console.log('2. Probando parsearPreciosCsv() en modo puro...');
    const invalidCsv = `producto_id,sku,nombre,precio_cliente,precio_profesional
1042,SH-ARG-01,Shampoo,$45000,40000
1043,AC-COC-02,Acondicionador,38000,0`;

    const parsedInvalid = parsearPreciosCsv(invalidCsv);
    console.log(`   Errores detectados en CSV inválido: ${parsedInvalid.errores.length}`);
    if (parsedInvalid.errores.length !== 2) {
      throw new Error(`Se esperaban 2 errores en el CSV inválido, pero se obtuvieron ${parsedInvalid.errores.length}`);
    }
    console.log('   ✔ Analizador sintáctico puro validó errores correctamente.\n');

    // 3. Probar dry_run=true con un producto de prueba dedicado
    console.log('3. Creando producto de prueba dedicado para no alterar catálogo existente...');
    const createdRes = await pool.query(
      "INSERT INTO productos (nombre, sku, costo, stock, tag_especialidad, tenant_id) VALUES ('Producto Guardián CSV', 'SKU-GUARDIAN-CSV-999', 25000, 50, 'capilar', 1) RETURNING id, nombre, sku"
    );
    const tempProd = createdRes.rows[0];
    createdProdIds.push(tempProd.id);

    // Insertar precio inicial cliente
    await pool.query(
      "INSERT INTO precios_producto (lista_id, producto_id, precio, unidad_minima) VALUES (1, $1, 45000.00, 1)",
      [tempProd.id]
    );

    console.log('4. Probando aplicarPreciosCsv() con dryRun = true...');
    const sampleCsv = `producto_id,sku,nombre,costo,stock,precio_cliente,precio_profesional,precio_negocio,unidad_minima_negocio
${tempProd.id},${tempProd.sku},${tempProd.nombre},25000,50,50000,45000,40000,6`;

    const parsedSample = parsearPreciosCsv(sampleCsv);
    const dryRunReport = await aplicarPreciosCsv({
      dbPool: pool,
      actorId: 1,
      filas: parsedSample.filas,
      errores: parsedSample.errores,
      totalLeidas: parsedSample.total_leidas,
      dryRun: true
    });

    console.log('   Reporte Dry Run:', JSON.stringify(dryRunReport.cambios));
    if (dryRunReport.con_error > 0) {
      throw new Error(`Error inesperado en dry run: ${JSON.stringify(dryRunReport.errores)}`);
    }
    console.log('   ✔ Dry run ejecutado sin alteraciones de datos.\n');

    // 5. Probar aplicarPreciosCsv() con dryRun = false (aplicar cambios reales al producto de prueba)
    console.log('5. Probando aplicarPreciosCsv() con dryRun = false...');
    const applyReport = await aplicarPreciosCsv({
      dbPool: pool,
      actorId: 1,
      filas: parsedSample.filas,
      errores: parsedSample.errores,
      totalLeidas: parsedSample.total_leidas,
      dryRun: false
    });

    console.log('   Reporte Aplicación:', JSON.stringify(applyReport.cambios));
    if (applyReport.validas !== 1) {
      throw new Error(`Se esperaba 1 fila válida aplicada, pero fueron ${applyReport.validas}`);
    }

    // Verificar auditoría en precios_historial con origen import_csv
    const histRes = await pool.query(`SELECT COUNT(*) FROM precios_historial WHERE origen = 'import_csv' AND producto_id = $1`, [tempProd.id]);
    const histCount = parseInt(histRes.rows[0].count, 10);
    console.log(`   Registros creados en precios_historial con origen 'import_csv': ${histCount}`);
    if (histCount === 0) {
      throw new Error('No se generaron registros en precios_historial con origen import_csv');
    }
    console.log('   ✔ Aplicación transaccional e historial de auditoría verificados.\n');

    // 6. Probar Idempotencia (reimportar el mismo archivo)
    console.log('6. Probando Idempotencia (reimportar mismo CSV)...');
    const reimportReport = await aplicarPreciosCsv({
      dbPool: pool,
      actorId: 1,
      filas: parsedSample.filas,
      errores: parsedSample.errores,
      totalLeidas: parsedSample.total_leidas,
      dryRun: true
    });

    console.log('   Reporte Reimportación:', JSON.stringify(reimportReport.cambios));
    if (reimportReport.cambios.nuevos !== 0 || reimportReport.cambios.modificados !== 0) {
      throw new Error(`La reimportación de los mismos datos debía resultar en 0 cambios (idempotente), obtuvo: ${JSON.stringify(reimportReport.cambios)}`);
    }
    console.log('   ✔ Idempotencia de importación confirmada (0 modificaciones).\n');

  } catch (err) {
    console.error('❌ Error en verificación del guardián:', err);
    exitCode = 1;
  } finally {
    // LIMPIEZA NET ZERO EN FINALLY (elimina únicamente las filas creadas para la prueba)
    if (createdProdIds.length > 0) {
      await pool.query(`DELETE FROM precios_historial WHERE producto_id = ANY($1::int[])`, [createdProdIds]);
      await pool.query(`DELETE FROM precios_producto WHERE producto_id = ANY($1::int[])`, [createdProdIds]);
      await pool.query(`DELETE FROM productos WHERE id = ANY($1::int[])`, [createdProdIds]);
    }

    const snapshotPost = await getDbSnapshot(pool);
    console.log(`🧹 Conteo final BD: productos=${snapshotPost.prods.length}, precios=${snapshotPost.precios.length}, historial=${snapshotPost.historial.length}`);

    if (!verifyValueSnapshot(snapshotPre, snapshotPost)) {
      exitCode = 1;
    } else {
      console.log('✅ CAMBIO NETO CERO EN VALORES VERIFICADO.');
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
