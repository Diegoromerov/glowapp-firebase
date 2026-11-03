/**
 * GUARDIÁN DE VERIFICACIÓN — CATÁLOGO POR NIVEL Y CHECKOUT (GLOWSHOP A0)
 * 
 * Verifica el cálculo único de precios, la visibilidad por existencia de precio en lista,
 * la validación de unidad mínima y el contexto de plataforma para invitados sobre PostgreSQL real (puerto 5435).
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { resolverPrecio, conContextoDePlataforma, rolACodigoLista } = require('../src/services/precioService');

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
  console.log('🔍 INICIANDO VERIFICACIÓN DEL GUARDIÁN DE CATÁLOGO Y CHECKOUT');
  console.log('==================================================\n');

  let exitCode = 0;

  // Captura de snapshot inicial de valores
  const snapshotPre = await getDbSnapshot(pool);
  const initialProdCount = snapshotPre.prods.length;

  let insertedPriceKey = null;
  let preExistingPriceRow = null;

  try {
    // 1. Auditoría estática de cero columnas heredadas en funciones de lectura
    console.log('1. Auditando estáticamente productController.js...');
    const controllerPath = path.join(__dirname, '../src/controllers/productController.js');
    const controllerContent = fs.readFileSync(controllerPath, 'utf8');

    const getProductsMatch = controllerContent.match(/exports\.getProducts =[\s\S]*?exports\.getProductById =[\s\S]*?exports\.createProduct/);
    const readCode = getProductsMatch ? getProductsMatch[0] : '';

    if (/precio_prestador|precio_al_publico|precio_con_reserva/.test(readCode)) {
      throw new Error('Se encontraron referencias a columnas legadas (precio_prestador, precio_al_publico) en las funciones de lectura de productController.js');
    }
    console.log('   ✔ Cero columnas legadas en funciones de lectura del catálogo.\n');

    // 2. Probar acceso de invitado sin sesión con contexto de plataforma
    console.log('2. Probando catálogo para invitado sin sesión (Contexto de Plataforma)...');
    const guestData = await conContextoDePlataforma(pool, async (client) => {
      const codigoLista = rolACodigoLista('client');
      const query = `
        SELECT p.id, p.nombre, pp.precio, pp.unidad_minima
        FROM productos p
        INNER JOIN precios_producto pp ON pp.producto_id = p.id
        INNER JOIN listas_precios lp ON lp.id = pp.lista_id
        WHERE lp.codigo = $1
          AND lp.estado = 'ACTIVA'
          AND pp.precio IS NOT NULL
        ORDER BY p.id ASC;
      `;
      const res = await client.query(query, [codigoLista]);
      return res.rows;
    });

    console.log(`   Productos devueltos para invitado (consumidor): ${guestData.length}`);
    if (guestData.length !== initialProdCount) {
      throw new Error(`Se esperaban ${initialProdCount} productos de plataforma con precio cliente, pero se obtuvieron ${guestData.length}`);
    }
    console.log(`   ✔ Invitado ve los ${guestData.length} productos con precio de consumidor.\n`);

    // 3. Verificando que productos sin precio en listas B2B (profesional/negocio) devuelven sin_precio
    console.log('3. Verificando que productos sin precio en lista profesional devuelven sin_precio...');
    const insumosRes = await pool.query(`SELECT id, nombre FROM productos WHERE tipo_visibilidad = 'INSUMO_PRESTADOR' LIMIT 5`);
    for (const insumo of insumosRes.rows) {
      const resP = await resolverPrecio({ rol: 'provider', productoId: insumo.id, dbPool: pool });
      if (resP.estado !== 'sin_precio') {
        throw new Error(`El insumo ${insumo.nombre} (ID: ${insumo.id}) no debería tener precio en la lista profesional, pero obtuvo: ${JSON.stringify(resP)}`);
      }
    }
    console.log('   ✔ Productos sin tarifa en lista B2B devuelven estado sin_precio.\n');

    // 4. Coherencia entre precio de catálogo y precio de checkout
    console.log('4. Verificando coincidencia exacta entre catálogo y checkout...');
    const sampleProd = guestData[0];
    const resCheckout = await resolverPrecio({ rol: 'client', productoId: sampleProd.id, cantidad: 1, dbPool: pool });

    if (parseFloat(sampleProd.precio) !== resCheckout.precio) {
      throw new Error(`Discrepancia de precio entre catálogo (${sampleProd.precio}) y checkout (${resCheckout.precio})`);
    }
    console.log(`   ✔ Producto ${sampleProd.id}: Catálogo $${sampleProd.precio} == Checkout $${resCheckout.precio}.\n`);

    // 5. Validación de Unidad Mínima de Venta (B2B Negocio)
    console.log('5. Verificando validación de unidad mínima en nivel negocio...');
    const negocioProdId = sampleProd.id;

    const listaNegocioRes = await pool.query(`SELECT id FROM listas_precios WHERE codigo = 'negocio'`);
    const listaNegocioId = listaNegocioRes.rows[0].id;

    const existingPriceRes = await pool.query(`SELECT * FROM precios_producto WHERE lista_id = $1 AND producto_id = $2`, [listaNegocioId, negocioProdId]);
    preExistingPriceRow = existingPriceRes.rows[0] || null;

    // Sembrar precio en lista negocio para probar la validación de unidad mínima
    await pool.query(`
      INSERT INTO precios_producto (lista_id, producto_id, precio, unidad_minima)
      VALUES ($1, $2, 35000, 6)
      ON CONFLICT (lista_id, producto_id) DO UPDATE SET precio = EXCLUDED.precio, unidad_minima = EXCLUDED.unidad_minima;
    `, [listaNegocioId, negocioProdId]);
    insertedPriceKey = { lista_id: listaNegocioId, producto_id: negocioProdId };

    // Probar 5 unidades (debe fallar con MINIMO_NO_CUMPLIDO)
    let fallosCorrectamente = false;
    try {
      await resolverPrecio({ rol: 'salon', productoId: negocioProdId, cantidad: 5, dbPool: pool });
    } catch (err) {
      if (err.code === 'MINIMO_NO_CUMPLIDO' && err.unidad_minima === 6) {
        fallosCorrectamente = true;
      }
    }

    if (!fallosCorrectamente) {
      throw new Error('No se lanzó error MINIMO_NO_CUMPLIDO al solicitar 5 unidades para rol salon');
    }
    console.log('   ✔ 5 unidades como salón -> Bloqueado correctamente por unidad mínima (6).');

    // Probar 6 unidades (debe pasar)
    const resP6 = await resolverPrecio({ rol: 'salon', productoId: negocioProdId, cantidad: 6, dbPool: pool });
    if (resP6.unidad_minima !== 6 || resP6.precio !== 35000) {
      throw new Error(`Fallo en resolución para 6 unidades nivel negocio: ${JSON.stringify(resP6)}`);
    }

    console.log('   ✔ 6 unidades como salón -> Pasa exitosamente con unidad_minima = 6.\n');

  } catch (err) {
    console.error('❌ Error en verificación del guardián:', err);
    exitCode = 1;
  } finally {
    // LIMPIEZA NET ZERO EN FINALLY
    if (insertedPriceKey) {
      if (preExistingPriceRow) {
        await pool.query('UPDATE precios_producto SET precio = $1, unidad_minima = $2 WHERE lista_id = $3 AND producto_id = $4', [
          preExistingPriceRow.precio, preExistingPriceRow.unidad_minima, insertedPriceKey.lista_id, insertedPriceKey.producto_id
        ]);
      } else {
        await pool.query(`DELETE FROM precios_producto WHERE lista_id = $1 AND producto_id = $2`, [insertedPriceKey.lista_id, insertedPriceKey.producto_id]);
      }
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
