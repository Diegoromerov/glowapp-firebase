#!/usr/bin/env node
/**
 * Catálogo mínimo de la tienda para demostración.
 *
 * Por qué existe: `productos` estaba vacía en producción y `GET /api/products`
 * devolvía `count: 0`. El check E3 de `tools/auditoria_cliente.py` lo detectaba
 * como PARCIAL ("la tienda de demostración se ve vacía"), pero sin catálogo no
 * hay forma de probar el flujo de compra ni de mostrar la app.
 *
 * El endpoint público hace:
 *   productos ⨝ precios_producto ⨝ listas_precios
 *   WHERE lp.codigo = <código del rol> AND lp.estado = 'ACTIVA' AND pp.precio IS NOT NULL
 *
 * así que sembrar `productos` no basta: hace falta la lista de precios 'cliente'
 * y una fila de precio por producto. Ese es el error que hacía que la tienda
 * pareciera vacía aunque hubiera productos.
 *
 * Los productos van al tenant de plataforma porque el catálogo público le
 * pertenece (ver src/middleware/publicTenantContext.js y D-GL-029).
 *
 * Guardas:
 *   1. `ALLOW_DEMO_SEED=1` — sin la bandera no hace nada.
 *   2. Idempotente: busca por (nombre, tenant_id) antes de insertar, y
 *      `precios_producto` usa ON CONFLICT (lista_id, producto_id).
 *   3. Todo en una transacción.
 *
 * Uso:
 *   ALLOW_DEMO_SEED=1 DATABASE_URL=... node scripts/seedCatalogoTienda.js
 */

const { Client } = require('pg');

const IMG = 'https://images.unsplash.com/photo-1526947425960-945c6e72858f?q=80&w=300&auto=format&fit=crop';

const PRODUCTOS = [
  { nombre: 'Shampoo de Argán 250 ml', descripcion: 'Restaurador con aceite de argán. Limpia sin resecar el cabello seco o procesado.', precio: 45000, stock: 40, tag: 'Cabello', img: 'https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?q=80&w=300&auto=format&fit=crop' },
  { nombre: 'Acondicionador de Coco 250 ml', descripcion: 'Ultra hidratante con leche de coco. Desenreda y controla el frizz.', precio: 38000, stock: 35, tag: 'Cabello', img: IMG },
  { nombre: 'Mascarilla de Queratina 200 g', descripcion: 'Tratamiento intensivo para reestructurar la fibra capilar y cerrar la cutícula.', precio: 55000, stock: 25, tag: 'Cabello', img: 'https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?q=80&w=300&auto=format&fit=crop' },
  { nombre: 'Sérum de Vitamina C 30 ml', descripcion: 'Antioxidante diario para manchas y luminosidad. Uso en piel limpia, por la mañana.', precio: 89000, stock: 20, tag: 'Skincare', img: IMG },
  { nombre: 'Protector solar SPF 50 50 ml', descripcion: 'Toque seco, sin residuo blanco. Reaplicar cada 3 horas en exposición directa.', precio: 79000, stock: 30, tag: 'Skincare', img: IMG },
  { nombre: 'Base líquida cobertura media', descripcion: 'Acabado natural, tonos claros a medios. Larga duración sin oxidarse.', precio: 65000, stock: 18, tag: 'Maquillaje', img: IMG },
  { nombre: 'Labial mate de larga duración', descripcion: 'Pigmento alto, no transfiere. Tonos rojo, nude y vino.', precio: 32000, stock: 45, tag: 'Maquillaje', img: IMG },
  { nombre: 'Aceite de cutícula 15 ml', descripcion: 'Con jojoba y vitamina E. Nutre el borde de la uña y sella el trabajo de manicure.', precio: 18000, stock: 60, tag: 'Uñas', img: IMG },
];

(async () => {
  if (process.env.ALLOW_DEMO_SEED !== '1') {
    console.log('nada que hacer: exporta ALLOW_DEMO_SEED=1');
    process.exit(0);
  }
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    const { rows: tRows } = await c.query(
      'SELECT id FROM tenants ORDER BY es_plataforma DESC, id ASC LIMIT 1',
    );
    if (!tRows.length) throw new Error('no hay tenants: corre la migración de plataforma primero');
    const tenant = tRows[0].id;

    const { rows: lRows } = await c.query(
      `INSERT INTO listas_precios (codigo, nombre, rol_destino, incluye_iva, estado, tenant_id)
       VALUES ('cliente', 'Cliente final', 'client', true, 'ACTIVA', $1)
       ON CONFLICT (codigo) DO UPDATE SET estado = 'ACTIVA', tenant_id = EXCLUDED.tenant_id
       RETURNING id`,
      [tenant],
    );
    const lista = lRows[0].id;

    let creados = 0;
    let actualizados = 0;
    for (const p of PRODUCTOS) {
      const { rows: ex } = await c.query(
        'SELECT id FROM productos WHERE nombre = $1 AND tenant_id = $2',
        [p.nombre, tenant],
      );
      let id;
      if (ex.length) {
        id = ex[0].id;
        await c.query(
          `UPDATE productos SET descripcion = $2, precio = $3, precio_al_publico = $3,
                  stock = $4, imagen_url = $5, tag_especialidad = $6
             WHERE id = $1`,
          [id, p.descripcion, p.precio, p.stock, p.img, p.tag],
        );
        actualizados += 1;
      } else {
        const { rows: ins } = await c.query(
          `INSERT INTO productos
             (nombre, descripcion, precio, precio_al_publico, stock, imagen_url,
              tag_especialidad, tipo_visibilidad, tenant_id)
           VALUES ($1, $2, $3, $3, $4, $5, $6, 'PUBLICO', $7)
           RETURNING id`,
          [p.nombre, p.descripcion, p.precio, p.stock, p.img, p.tag, tenant],
        );
        id = ins[0].id;
        creados += 1;
      }
      await c.query(
        `INSERT INTO precios_producto (lista_id, producto_id, precio, tenant_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (lista_id, producto_id)
         DO UPDATE SET precio = EXCLUDED.precio, tenant_id = EXCLUDED.tenant_id`,
        [lista, id, p.precio, tenant],
      );
    }
    await c.query('COMMIT');
    console.log(`tenant=${tenant} lista=${lista} creados=${creados} actualizados=${actualizados}`);
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('ERR', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
