const { pool } = require('../config/db');

/**
 * Helper para construir avisos de coherencia por producto
 */
const { calcularPrecioBulk } = require('../utils/precioBulk');

function calcularAvisosProducto({ costo, precios }) {
  const avisos = [];

  if (precios.cliente === null || precios.cliente === undefined) {
    avisos.push('sin_precio:cliente');
  }
  if (precios.profesional === null || precios.profesional === undefined) {
    avisos.push('sin_precio:profesional');
  }
  if (precios.negocio === null || precios.negocio === undefined) {
    avisos.push('sin_precio:negocio');
  }

  if (costo === null || costo === undefined) {
    avisos.push('sin_costo');
  }

  if (costo !== null && costo !== undefined) {
    const numCosto = parseFloat(costo);
    if (precios.cliente !== null && precios.cliente < numCosto) {
      avisos.push('precio_bajo_costo:cliente');
    }
    if (precios.profesional !== null && precios.profesional < numCosto) {
      avisos.push('precio_bajo_costo:profesional');
    }
    if (precios.negocio !== null && precios.negocio < numCosto) {
      avisos.push('precio_bajo_costo:negocio');
    }
  }

  if (precios.profesional !== null && precios.cliente !== null && precios.profesional >= precios.cliente) {
    avisos.push('profesional_mayor_o_igual_que_cliente');
  }

  if (precios.negocio !== null && precios.profesional !== null && precios.negocio > precios.profesional) {
    avisos.push('negocio_mayor_que_profesional');
  }

  return avisos;
}

/**
 * GET /api/admin/precios
 * Listado paginado de productos con precios por lista y avisos de coherencia.
 */
async function getPrecios(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const porPagina = Math.min(100, Math.max(1, parseInt(req.query.por_pagina, 10) || 50));
    const offset = (page - 1) * porPagina;

    const listaFilter = req.query.lista ? String(req.query.lista).trim() : null;
    const qFilter = req.query.q ? String(req.query.q).trim() : null;
    const sinPrecioFilter = req.query.sin_precio === 'true';

    // 1. Obtener todas las listas de precios
    const listasRes = await pool.query(`SELECT id, codigo, nombre, rol_destino, incluye_iva FROM listas_precios ORDER BY id`);
    const listas = listasRes.rows || [];
    const listasMap = {};
    listas.forEach(l => { listasMap[l.codigo] = l.id; });

    // 2. Armar filtros WHERE dinámicos
    const whereConditions = [];
    const queryParams = [];
    let paramIdx = 1;

    if (qFilter) {
      whereConditions.push(`(p.nombre ILIKE $${paramIdx} OR p.sku ILIKE $${paramIdx})`);
      queryParams.push(`%${qFilter}%`);
      paramIdx++;
    }

    if (sinPrecioFilter) {
      if (listaFilter && listasMap[listaFilter]) {
        whereConditions.push(`NOT EXISTS (
          SELECT 1 FROM precios_producto pp_sub 
          WHERE pp_sub.producto_id = p.id AND pp_sub.lista_id = $${paramIdx}
        )`);
        queryParams.push(listasMap[listaFilter]);
        paramIdx++;
      } else {
        whereConditions.push(`EXISTS (
          SELECT 1 FROM listas_precios lp_sub
          WHERE NOT EXISTS (
            SELECT 1 FROM precios_producto pp_sub 
            WHERE pp_sub.producto_id = p.id AND pp_sub.lista_id = lp_sub.id
          )
        )`);
      }
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // 3. Consulta de conteo total
    const countQuery = `SELECT COUNT(DISTINCT p.id) as total FROM productos p ${whereClause};`;
    const countRes = await pool.query(countQuery, queryParams);
    const total = parseInt(countRes.rows[0]?.total || 0, 10);

    // 4. Consulta paginada de productos
    const productosQuery = `
      SELECT p.id AS producto_id, p.nombre, p.sku, p.costo, p.stock
      FROM productos p
      ${whereClause}
      ORDER BY p.id ASC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1};
    `;
    const pageParams = [...queryParams, porPagina, offset];
    const productosRes = await pool.query(productosQuery, pageParams);
    const productosRows = productosRes.rows || [];

    if (productosRows.length === 0) {
      return res.json({
        total,
        pagina: page,
        filas: []
      });
    }

    // 5. Cargar precios existentes para los productos recuperados
    const productoIds = productosRows.map(p => p.producto_id);
    const preciosQuery = `
      SELECT pp.producto_id, lp.codigo AS lista_codigo, pp.precio, pp.unidad_minima
      FROM precios_producto pp
      JOIN listas_precios lp ON lp.id = pp.lista_id
      WHERE pp.producto_id = ANY($1::int[]);
    `;
    const preciosRes = await pool.query(preciosQuery, [productoIds]);
    const preciosRows = preciosRes.rows || [];

    const preciosIndex = {};
    preciosRows.forEach(row => {
      if (!preciosIndex[row.producto_id]) preciosIndex[row.producto_id] = {};
      preciosIndex[row.producto_id][row.lista_codigo] = {
        precio: parseFloat(row.precio),
        unidad_minima: parseInt(row.unidad_minima, 10)
      };
    });

    // 6. Construir array de filas formateadas
    const filas = productosRows.map(p => {
      const pid = p.producto_id;
      const pData = preciosIndex[pid] || {};

      const precios = {
        cliente: pData.cliente ? pData.cliente.precio : null,
        profesional: pData.profesional ? pData.profesional.precio : null,
        negocio: pData.negocio ? pData.negocio.precio : null
      };

      const unidad_minima = {
        cliente: pData.cliente ? pData.cliente.unidad_minima : 1,
        profesional: pData.profesional ? pData.profesional.unidad_minima : 1,
        negocio: pData.negocio ? pData.negocio.unidad_minima : 6
      };

      const costo = p.costo !== null && p.costo !== undefined ? parseFloat(p.costo) : null;
      const avisos = calcularAvisosProducto({ costo, precios });

      return {
        producto_id: p.producto_id,
        nombre: p.nombre,
        sku: p.sku || null,
        costo,
        stock: p.stock !== null && p.stock !== undefined ? parseInt(p.stock, 10) : 0,
        precios,
        unidad_minima,
        avisos
      };
    });

    return res.json({
      total,
      pagina: page,
      filas
    });
  } catch (error) {
    console.error('Error en GET /api/admin/precios:', error);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
}

/**
 * PUT /api/admin/precios/:productoId
 * Edición manual de costo y/o precios por lista de un producto.
 */
/**
 * Lee un producto y sus precios por lista, en la forma exacta que consume el panel:
 *   { producto_id, nombre, sku, costo, stock,
 *     precios: { cliente, profesional, negocio },
 *     unidad_minima: { cliente, profesional, negocio }, avisos }
 *
 * La lectura y la forma viven en UN solo sitio a proposito: el GET y el PUT de
 * /precios/:productoId devuelven lo mismo, y el panel lee la respuesta de los dos
 * con el mismo codigo (productos/page.tsx -> fetchPrecios). Tener la forma
 * duplicada/supuesta es justo lo que dejo el GET sin implementar mientras el panel
 * ya lo llamaba.
 *
 * Devuelve null si el producto no existe.
 */
async function leerProductoConPrecios(productoId) {
  const prodRes = await pool.query(
    `SELECT id AS producto_id, nombre, sku, costo, stock FROM productos WHERE id = $1`,
    [productoId]
  );
  const prod = prodRes.rows[0];
  if (!prod) return null;

  const preciosRes = await pool.query(`
    SELECT pp.precio, pp.unidad_minima, lp.codigo AS lista_codigo
    FROM precios_producto pp
    JOIN listas_precios lp ON lp.id = pp.lista_id
    WHERE pp.producto_id = $1;
  `, [productoId]);

  const pData = {};
  preciosRes.rows.forEach(r => {
    pData[r.lista_codigo] = { precio: parseFloat(r.precio), unidad_minima: parseInt(r.unidad_minima, 10) };
  });

  const precios = {
    cliente: pData.cliente ? pData.cliente.precio : null,
    profesional: pData.profesional ? pData.profesional.precio : null,
    negocio: pData.negocio ? pData.negocio.precio : null
  };

  const unidad_minima = {
    cliente: pData.cliente ? pData.cliente.unidad_minima : 1,
    profesional: pData.profesional ? pData.profesional.unidad_minima : 1,
    negocio: pData.negocio ? pData.negocio.unidad_minima : 6
  };

  const numCosto = prod.costo !== null && prod.costo !== undefined ? parseFloat(prod.costo) : null;

  return {
    producto_id: prod.producto_id,
    nombre: prod.nombre,
    sku: prod.sku || null,
    costo: numCosto,
    stock: prod.stock !== null && prod.stock !== undefined ? parseInt(prod.stock, 10) : 0,
    precios,
    unidad_minima,
    avisos: calcularAvisosProducto({ costo: numCosto, precios })
  };
}

/**
 * GET /api/admin/precios/:productoId
 *
 * Faltaba por completo: solo existia el PUT del mismo camino. El panel lo llama
 * desde /admin/productos para pintar los precios por perfil al editar un producto;
 * al responder 404 y estar el consumo dentro de un `if (res.ok)`, no fallaba en voz
 * alta: el modal se quedaba con los precios en 0 —o con los del producto anterior,
 * que ademas se podian guardar encima del producto equivocado— y Gestion de Precios
 * parecia un sistema aparte del catalogo. Era la misma tabla y la misma data.
 */
async function getPrecioProducto(req, res) {
  try {
    const productoId = parseInt(req.params.productoId, 10);
    if (!Number.isInteger(productoId) || productoId <= 0) {
      return res.status(400).json({ error: 'INVALID_ARGUMENT', message: 'ID de producto inválido' });
    }

    const data = await leerProductoConPrecios(productoId);
    if (!data) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Producto no encontrado' });
    }

    return res.json(data);
  } catch (error) {
    console.error('Error en GET /api/admin/precios/:productoId:', error);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
}

async function updatePrecioProducto(req, res) {
  try {
    const productoId = parseInt(req.params.productoId, 10);
    if (isNaN(productoId)) {
      return res.status(400).json({ error: 'INVALID_ARGUMENT', message: 'ID de producto inválido' });
    }

    const { costo, precios, motivo } = req.body || {};

    // 1. Verificar que el producto exista
    const prodRes = await pool.query(`SELECT id, nombre, sku, costo, stock FROM productos WHERE id = $1`, [productoId]);
    if (prodRes.rows.length === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Producto no encontrado' });
    }
    const producto = prodRes.rows[0];

    // 2. Validar costo si se proporciona
    if (costo !== undefined && costo !== null) {
      const numCosto = parseFloat(costo);
      if (isNaN(numCosto) || numCosto < 0) {
        return res.status(400).json({ error: 'INVALID_ARGUMENT', message: 'El costo debe ser un número mayor o igual a 0' });
      }
    }

    // 3. Validar array de precios
    if (precios !== undefined) {
      if (!Array.isArray(precios)) {
        return res.status(400).json({ error: 'INVALID_ARGUMENT', message: 'El campo precios debe ser un arreglo' });
      }
      for (const pItem of precios) {
        if (!['cliente', 'profesional', 'negocio'].includes(pItem.lista)) {
          return res.status(400).json({ error: 'INVALID_ARGUMENT', message: `Lista inválida: ${pItem.lista}` });
        }
        if (pItem.precio !== undefined && pItem.precio !== null) {
          const numP = parseFloat(pItem.precio);
          if (isNaN(numP) || numP < 0) {
            return res.status(400).json({ error: 'INVALID_ARGUMENT', message: `El precio para ${pItem.lista} debe ser >= 0` });
          }
        }
        if (pItem.unidad_minima !== undefined && pItem.unidad_minima !== null) {
          const numU = parseInt(pItem.unidad_minima, 10);
          if (isNaN(numU) || numU <= 0) {
            return res.status(400).json({ error: 'INVALID_ARGUMENT', message: `La unidad mínima para ${pItem.lista} debe ser un entero > 0` });
          }
        }
      }
    }

    // 4. Cargar listas de precios
    const listasRes = await pool.query(`SELECT id, codigo FROM listas_precios`);
    const listasMap = {};
    listasRes.rows.forEach(l => { listasMap[l.codigo] = l.id; });

    const actorId = req.user ? req.user.id : null;

    // 5. Aplicar cambios
    if (costo !== undefined && costo !== null) {
      await pool.query(`UPDATE productos SET costo = $1 WHERE id = $2`, [parseFloat(costo), productoId]);
    }

    if (Array.isArray(precios)) {
      for (const pItem of precios) {
        const listaId = listasMap[pItem.lista];
        if (!listaId) continue;

        const pNuevo = pItem.precio !== undefined && pItem.precio !== null ? parseFloat(pItem.precio) : null;
        const defaultMin = pItem.lista === 'negocio' ? 6 : 1;
        const uMinima = pItem.unidad_minima !== undefined && pItem.unidad_minima !== null
          ? parseInt(pItem.unidad_minima, 10)
          : defaultMin;

        if (pNuevo !== null) {
          // Consultar precio anterior
          const antRes = await pool.query(
            `SELECT precio FROM precios_producto WHERE lista_id = $1 AND producto_id = $2`,
            [listaId, productoId]
          );
          const precioAnterior = antRes.rows.length > 0 ? parseFloat(antRes.rows[0].precio) : null;

          // Upsert en precios_producto
          await pool.query(`
            INSERT INTO precios_producto (lista_id, producto_id, precio, unidad_minima)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (lista_id, producto_id)
            DO UPDATE SET precio = EXCLUDED.precio, unidad_minima = EXCLUDED.unidad_minima;
          `, [listaId, productoId, pNuevo, uMinima]);

          // Registrar en historial
          await pool.query(`
            INSERT INTO precios_historial (lista_id, producto_id, precio_anterior, precio_nuevo, actor_id, origen, motivo, tenant_id)
            SELECT $1, $2, $3, $4, $5, 'manual', $6, tenant_id FROM listas_precios WHERE id = $1;
          `, [listaId, productoId, precioAnterior, pNuevo, actorId, motivo || null]);
        }
      }
    }

    // 6. Devolver el producto actualizado. La lectura y la forma de la respuesta
    //    viven en leerProductoConPrecios() para que el PUT y el GET no puedan
    //    divergir: el panel consume las dos con el mismo codigo.
    return res.json(await leerProductoConPrecios(productoId));
  } catch (error) {
    console.error('Error en PUT /api/admin/precios/:productoId:', error);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
}

/**
 * PATCH /api/admin/precios/bulk
 * Carga masiva por porcentaje, fijar o delta (con vista previa obligatoria o aplicación).
 */
async function bulkUpdatePrecios(req, res) {
  try {
    const { lista, producto_ids, operacion, preview } = req.body || {};

    if (!lista || !['cliente', 'profesional', 'negocio'].includes(lista)) {
      return res.status(400).json({ error: 'INVALID_ARGUMENT', message: 'Debe especificar una lista válida (cliente, profesional, negocio)' });
    }

    if (!Array.isArray(producto_ids) || producto_ids.length === 0) {
      return res.status(400).json({ error: 'INVALID_ARGUMENT', message: 'Debe especificar un arreglo producto_ids con al menos un producto' });
    }

    if (!operacion || typeof operacion !== 'object') {
      return res.status(400).json({ error: 'INVALID_ARGUMENT', message: 'Debe especificar un objeto operacion' });
    }

    const { tipo, valor } = operacion;
    if (!['porcentaje', 'fijar', 'delta'].includes(tipo)) {
      return res.status(400).json({ error: 'INVALID_ARGUMENT', message: 'Tipo de operación debe ser porcentaje, fijar o delta' });
    }

    const numValor = parseFloat(valor);
    if (isNaN(numValor)) {
      return res.status(400).json({ error: 'INVALID_ARGUMENT', message: 'El valor de la operación debe ser un número válido' });
    }

    // 1. Obtener lista objetivo e id
    const listaRes = await pool.query(`SELECT id, codigo FROM listas_precios WHERE codigo = $1`, [lista]);
    if (listaRes.rows.length === 0) {
      return res.status(400).json({ error: 'INVALID_ARGUMENT', message: `Lista ${lista} no encontrada` });
    }
    const targetListaId = listaRes.rows[0].id;

    // Obtener lista de consumidor para fallback de cálculo si aplica
    const clienteListaRes = await pool.query(`SELECT id FROM listas_precios WHERE codigo = 'cliente'`);
    const clienteListaId = clienteListaRes.rows[0]?.id;

    // 2. Consultar precios actuales de los productos seleccionados
    const pIds = producto_ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
    if (pIds.length === 0) {
      return res.status(400).json({ error: 'INVALID_ARGUMENT', message: 'No hay IDs de producto válidos' });
    }

    const preciosQuery = `
      SELECT p.id AS producto_id, 
             pp_target.precio AS precio_target, 
             pp_target.unidad_minima AS unidad_minima_target,
             pp_cliente.precio AS precio_cliente
      FROM productos p
      LEFT JOIN precios_producto pp_target ON pp_target.producto_id = p.id AND pp_target.lista_id = $1
      LEFT JOIN precios_producto pp_cliente ON pp_cliente.producto_id = p.id AND pp_cliente.lista_id = $2
      WHERE p.id = ANY($3::int[]);
    `;
    const preciosRes = await pool.query(preciosQuery, [targetListaId, clienteListaId, pIds]);
    const rows = preciosRes.rows || [];

    let suben = 0;
    let bajan = 0;
    let mayorCambioPct = 0;
    const detalle = [];

    rows.forEach(r => {
      const pid = r.producto_id;
      const antes = r.precio_target !== null && r.precio_target !== undefined ? parseFloat(r.precio_target) : null;
      const baseCalc = antes !== null ? antes : (r.precio_cliente !== null && r.precio_cliente !== undefined ? parseFloat(r.precio_cliente) : 0);

      // El calculo vive en utils/precioBulk para poder probarlo con valores reales.
      const despues = calcularPrecioBulk(baseCalc, tipo, numValor);

      let deltaPct = 0;
      if (antes !== null && antes > 0) {
        deltaPct = Math.round(((despues - antes) / antes) * 100 * 10) / 10;
      } else if (despues > 0) {
        deltaPct = 100;
      }

      if (antes !== null) {
        if (despues > antes) suben++;
        else if (despues < antes) bajan++;
      } else {
        if (despues > 0) suben++;
      }

      const absDelta = Math.abs(deltaPct);
      if (absDelta > mayorCambioPct) mayorCambioPct = absDelta;

      detalle.push({
        producto_id: pid,
        antes,
        despues,
        delta_pct: deltaPct,
        unidad_minima: r.unidad_minima_target ? parseInt(r.unidad_minima_target, 10) : (lista === 'negocio' ? 6 : 1)
      });
    });

    // Si preview === true, no se escribe nada en la base de datos
    if (preview === true) {
      return res.json({
        afectados: detalle.length,
        suben,
        bajan,
        mayor_cambio_pct: mayorCambioPct,
        detalle
      });
    }

    // Si preview === false, aplicar los cambios e insertar en historial
    const actorId = req.user ? req.user.id : null;
    const origenBulk = `bulk_${tipo}`;

    for (const item of detalle) {
      const uMin = item.unidad_minima || (lista === 'negocio' ? 6 : 1);

      await pool.query(`
        INSERT INTO precios_producto (lista_id, producto_id, precio, unidad_minima)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (lista_id, producto_id)
        DO UPDATE SET precio = EXCLUDED.precio, unidad_minima = EXCLUDED.unidad_minima;
      `, [targetListaId, item.producto_id, item.despues, uMin]);

      await pool.query(`
        INSERT INTO precios_historial (lista_id, producto_id, precio_anterior, precio_nuevo, actor_id, origen, motivo, tenant_id)
        SELECT $1, $2, $3, $4, $5, $6, $7, tenant_id FROM listas_precios WHERE id = $1;
      `, [targetListaId, item.producto_id, item.antes, item.despues, actorId, origenBulk, req.body.motivo || null]);
    }

    return res.json({
      afectados: detalle.length,
      suben,
      bajan,
      mayor_cambio_pct: mayorCambioPct,
      detalle
    });
  } catch (error) {
    console.error('Error en PATCH /api/admin/precios/bulk:', error);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
}

/**
 * GET /api/admin/precios/coherencia
 * Informe de coherencia de precios (5 listas de avisos de negocio).
 */
async function getCoherenciaReport(req, res) {
  try {
    const listasRes = await pool.query(`SELECT id, codigo FROM listas_precios`);
    const listasMap = {};
    listasRes.rows.forEach(l => { listasMap[l.codigo] = l.id; });

    const cId = listasMap.cliente;
    const pId = listasMap.profesional;
    const nId = listasMap.negocio;

    const query = `
      SELECT p.id AS producto_id, p.nombre, p.costo,
             pp_c.precio AS precio_cliente,
             pp_p.precio AS precio_profesional,
             pp_n.precio AS precio_negocio
      FROM productos p
      LEFT JOIN precios_producto pp_c ON pp_c.producto_id = p.id AND pp_c.lista_id = $1
      LEFT JOIN precios_producto pp_p ON pp_p.producto_id = p.id AND pp_p.lista_id = $2
      LEFT JOIN precios_producto pp_n ON pp_n.producto_id = p.id AND pp_n.lista_id = $3
      ORDER BY p.id ASC;
    `;
    const prodRes = await pool.query(query, [cId, pId, nId]);
    const rows = prodRes.rows || [];

    const profesional_mayor_o_igual_que_cliente = [];
    const negocio_mayor_que_profesional = [];
    const precio_bajo_costo = [];
    const sin_costo_cargado = [];
    const producto_sin_precio_en_lista = [];

    rows.forEach(r => {
      const pid = r.producto_id;
      const costo = r.costo !== null && r.costo !== undefined ? parseFloat(r.costo) : null;
      const c = r.precio_cliente !== null && r.precio_cliente !== undefined ? parseFloat(r.precio_cliente) : null;
      const p = r.precio_profesional !== null && r.precio_profesional !== undefined ? parseFloat(r.precio_profesional) : null;
      const n = r.precio_negocio !== null && r.precio_negocio !== undefined ? parseFloat(r.precio_negocio) : null;

      if (p !== null && c !== null && p >= c) {
        profesional_mayor_o_igual_que_cliente.push({ producto_id: pid, profesional: p, cliente: c });
      }

      if (n !== null && p !== null && n > p) {
        negocio_mayor_que_profesional.push({ producto_id: pid, negocio: n, profesional: p });
      }

      if (costo !== null) {
        if ((c !== null && c < costo) || (p !== null && p < costo) || (n !== null && n < costo)) {
          precio_bajo_costo.push({ producto_id: pid, costo, cliente: c, profesional: p, negocio: n });
        }
      } else {
        sin_costo_cargado.push({ producto_id: pid, nombre: r.nombre });
      }

      if (c === null || p === null || n === null) {
        producto_sin_precio_en_lista.push({ producto_id: pid, cliente: c, profesional: p, negocio: n });
      }
    });

    return res.json({
      profesional_mayor_o_igual_que_cliente,
      negocio_mayor_que_profesional,
      precio_bajo_costo,
      sin_costo_cargado,
      producto_sin_precio_en_lista
    });
  } catch (error) {
    console.error('Error en GET /api/admin/precios/coherencia:', error);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
}

/**
 * GET /api/admin/precios/export.csv
 * Exporta el catálogo completo o de una lista a formato CSV.
 */
async function exportPreciosCsv(req, res) {
  try {
    const lista = req.query.lista ? String(req.query.lista).trim() : null;
    const { exportarPreciosCsv } = require('../services/preciosCsvService');

    const csvContent = await exportarPreciosCsv({ dbPool: pool, lista });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="precios_glowshop.csv"');
    return res.status(200).send(csvContent);
  } catch (error) {
    console.error('Error en GET /api/admin/precios/export.csv:', error);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
}

/**
 * POST /api/admin/precios/import.csv
 * Carga e importación masiva de precios por archivo CSV.
 */
async function importPreciosCsv(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        error: 'INVALID_ARGUMENT',
        message: 'Debe adjuntar un archivo CSV en el campo "archivo"'
      });
    }

    const dryRun = req.query.dry_run === undefined || req.query.dry_run === 'true';
    const reemplazar = req.query.reemplazar === 'true';

    const { parsearPreciosCsv, aplicarPreciosCsv } = require('../services/preciosCsvService');
    const csvText = req.file.buffer.toString('utf8');

    const parsed = parsearPreciosCsv(csvText);

    if (parsed.errores.length > 0 && parsed.filas.length === 0) {
      return res.status(400).json({
        leidas: parsed.total_leidas,
        validas: 0,
        con_error: parsed.errores.length,
        errores: parsed.errores,
        cambios: { nuevos: 0, modificados: 0, sin_cambio: 0 }
      });
    }

    const actorId = req.user ? req.user.id : null;
    const report = await aplicarPreciosCsv({
      dbPool: pool,
      actorId,
      filas: parsed.filas,
      errores: parsed.errores,
      totalLeidas: parsed.total_leidas,
      dryRun,
      reemplazar
    });

    return res.status(200).json(report);
  } catch (error) {
    console.error('Error en POST /api/admin/precios/import.csv:', error);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
}

/**
 * GET /api/admin/precios/historial
 * Consulta paginada del historial de cambios de precios (precios_historial).
 */
async function getHistorialPrecios(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const porPagina = Math.min(100, Math.max(1, parseInt(req.query.por_pagina, 10) || 50));
    const offset = (page - 1) * porPagina;

    const productoId = req.query.producto_id ? parseInt(req.query.producto_id, 10) : null;
    const listaFilter = req.query.lista ? String(req.query.lista).trim() : null;

    const whereConditions = [];
    const queryParams = [];
    let paramIdx = 1;

    if (productoId && !isNaN(productoId)) {
      whereConditions.push(`ph.producto_id = $${paramIdx}`);
      queryParams.push(productoId);
      paramIdx++;
    }

    if (listaFilter) {
      whereConditions.push(`lp.codigo = $${paramIdx}`);
      queryParams.push(listaFilter);
      paramIdx++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM precios_historial ph
      JOIN listas_precios lp ON lp.id = ph.lista_id
      ${whereClause};
    `;
    const countRes = await pool.query(countQuery, queryParams);
    const total = parseInt(countRes.rows[0]?.total || 0, 10);

    const historialQuery = `
      SELECT 
        ph.id,
        ph.producto_id,
        p.nombre AS producto_nombre,
        ph.lista_id,
        lp.codigo AS lista_codigo,
        lp.nombre AS lista_nombre,
        ph.precio_anterior,
        ph.precio_nuevo,
        ph.actor_id,
        u.nombre AS actor_nombre,
        ph.origen,
        ph.motivo,
        ph.fecha_cambio
      FROM precios_historial ph
      JOIN productos p ON p.id = ph.producto_id
      JOIN listas_precios lp ON lp.id = ph.lista_id
      LEFT JOIN usuarios u ON u.id = ph.actor_id
      ${whereClause}
      ORDER BY ph.fecha_cambio DESC, ph.id DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1};
    `;

    const historialRes = await pool.query(historialQuery, [...queryParams, porPagina, offset]);
    const filas = (historialRes.rows || []).map(r => ({
      id: r.id,
      producto_id: r.producto_id,
      producto_nombre: r.producto_nombre,
      lista_id: r.lista_id,
      lista_codigo: r.lista_codigo,
      lista_nombre: r.lista_nombre,
      precio_anterior: r.precio_anterior !== null && r.precio_anterior !== undefined ? parseFloat(r.precio_anterior) : null,
      precio_nuevo: parseFloat(r.precio_nuevo),
      actor_id: r.actor_id,
      actor_nombre: r.actor_nombre || null,
      origen: r.origen,
      motivo: r.motivo || null,
      fecha_cambio: r.fecha_cambio
    }));

    return res.json({
      total,
      pagina: page,
      por_pagina: porPagina,
      filas
    });
  } catch (error) {
    console.error('Error en GET /api/admin/precios/historial:', error);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
}

module.exports = {
  getPrecios,
  getPrecioProducto,
  updatePrecioProducto,
  bulkUpdatePrecios,
  getCoherenciaReport,
  exportPreciosCsv,
  importPreciosCsv,
  getHistorialPrecios
};
