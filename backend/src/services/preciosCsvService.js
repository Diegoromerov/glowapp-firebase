const { pool } = require('../config/db');

/**
 * Escapa un valor para incluirlo en un archivo CSV.
 */
function escapeCsvCell(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Divide el texto del CSV en líneas respetando valores entre comillas que contengan saltos de línea.
 */
function parseCsvLines(text) {
  const lines = [];
  let currentLine = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      currentLine += char;
    } else if (char === '\n' && !inQuotes) {
      lines.push(currentLine);
      currentLine = '';
    } else {
      currentLine += char;
    }
  }
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }
  return lines;
}

/**
 * Divide una línea de CSV en campos respetando valores entre comillas.
 */
function parseCsvRow(line) {
  const fields = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(currentField.trim());
      currentField = '';
    } else {
      currentField += char;
    }
  }
  fields.push(currentField.trim());
  return fields;
}

/**
 * Función Pura: Analiza el contenido de texto de un CSV y devuelve filas validadas y errores.
 * Sin efectos secundarios ni llamadas a base de datos.
 */
function parsearPreciosCsv(texto) {
  if (!texto || typeof texto !== 'string') {
    return {
      total_leidas: 0,
      filas: [],
      errores: [{ fila: 0, columna: 'archivo', motivo: 'Archivo CSV vacío o inválido' }]
    };
  }

  // 1. Limpieza de BOM y normalización de saltos de línea
  let cleanText = texto.replace(/^\ufeff/, '');
  cleanText = cleanText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const rawLines = parseCsvLines(cleanText).filter(l => l.trim().length > 0);
  if (rawLines.length === 0) {
    return {
      total_leidas: 0,
      filas: [],
      errores: [{ fila: 0, columna: 'archivo', motivo: 'Archivo CSV sin contenido' }]
    };
  }

  // Límite máximo de filas (5000 filas de datos)
  const dataLines = rawLines.slice(1);
  if (dataLines.length > 5000) {
    return {
      total_leidas: dataLines.length,
      filas: [],
      errores: [{ fila: 0, columna: 'archivo', motivo: 'El archivo supera el límite máximo de 5000 filas' }]
    };
  }

  // 2. Encabezado
  const headerRow = parseCsvRow(rawLines[0]).map(h => h.toLowerCase().trim());
  const headerMap = {};
  headerRow.forEach((col, idx) => { headerMap[col] = idx; });

  const errores = [];
  const filas = [];

  // Validar presencia de identificador mínimo
  if (!('producto_id' in headerMap) && !('sku' in headerMap)) {
    errores.push({
      fila: 1,
      columna: 'encabezado',
      motivo: 'El encabezado del CSV debe incluir al menos la columna "producto_id" o "sku"'
    });
    return { total_leidas: dataLines.length, filas: [], errores };
  }

  // 3. Procesar cada fila de datos (1-indexed considerando el encabezado en fila 1)
  dataLines.forEach((lineText, idx) => {
    const filaNum = idx + 2; // Fila 1 es el encabezado
    const cols = parseCsvRow(lineText);

    const getVal = (colName) => {
      const colIdx = headerMap[colName];
      if (colIdx === undefined || colIdx >= cols.length) return '';
      return cols[colIdx].trim();
    };

    const rawId = getVal('producto_id');
    const rawSku = getVal('sku');
    const nombre = getVal('nombre') || null;
    const rawCosto = getVal('costo');
    const rawStock = getVal('stock');

    let producto_id = null;
    if (rawId !== '') {
      const parsedId = parseInt(rawId, 10);
      if (isNaN(parsedId) || parsedId <= 0) {
        errores.push({ fila: filaNum, columna: 'producto_id', motivo: 'producto_id debe ser un entero positivo' });
      } else {
        producto_id = parsedId;
      }
    }

    const sku = rawSku !== '' ? rawSku : null;

    if (!producto_id && !sku) {
      errores.push({ fila: filaNum, columna: 'producto_id', motivo: 'Debe especificar producto_id o sku' });
    }

    // Validar Costo si está presente
    let costo = null;
    if (rawCosto !== '') {
      const cleanC = validateAndNormalizeNumber(rawCosto, 'costo', filaNum, errores);
      if (cleanC !== null) {
        if (cleanC < 0) {
          errores.push({ fila: filaNum, columna: 'costo', motivo: 'El costo debe ser mayor o igual a 0' });
        } else {
          costo = cleanC;
        }
      }
    }

    // Validar Stock si está presente
    let stock = null;
    if (rawStock !== '') {
      const parsedStock = parseInt(rawStock, 10);
      if (isNaN(parsedStock) || parsedStock < 0 || String(parsedStock) !== rawStock) {
        errores.push({ fila: filaNum, columna: 'stock', motivo: 'El stock debe ser un entero mayor o igual a 0' });
      } else {
        stock = parsedStock;
      }
    }

    // Validar precios por lista
    const precios = {
      cliente: validateAndNormalizePrice(getVal('precio_cliente'), 'precio_cliente', filaNum, errores),
      profesional: validateAndNormalizePrice(getVal('precio_profesional'), 'precio_profesional', filaNum, errores),
      negocio: validateAndNormalizePrice(getVal('precio_negocio'), 'precio_negocio', filaNum, errores)
    };

    // Validar unidad minima negocio
    const rawUM = getVal('unidad_minima_negocio');
    let unidad_minima_negocio = 6;
    if (rawUM !== '') {
      const parsedUM = parseInt(rawUM, 10);
      if (isNaN(parsedUM) || parsedUM <= 0) {
        errores.push({ fila: filaNum, columna: 'unidad_minima_negocio', motivo: 'unidad_minima_negocio debe ser un entero > 0' });
      } else {
        unidad_minima_negocio = parsedUM;
      }
    }

    // Si la fila no generó errores nuevos en esta iteración, se agrega a filas válidas
    const erroresFila = errores.filter(e => e.fila === filaNum);
    if (erroresFila.length === 0) {
      filas.push({
        fila: filaNum,
        producto_id,
        sku,
        nombre,
        costo,
        stock,
        precios,
        unidad_minima_negocio
      });
    }
  });

  return {
    total_leidas: dataLines.length,
    filas,
    errores
  };
}

/**
 * Valida formato numérico de precio.
 * Retorna null si la celda está vacía (no tocar).
 * Registra error en errores[] si el formato es inválido o el precio es <= 0.
 */
function validateAndNormalizePrice(val, colName, filaNum, errores) {
  if (val === null || val === undefined || val === '') {
    return null;
  }

  const cleanNum = validateAndNormalizeNumber(val, colName, filaNum, errores);
  if (cleanNum === null) return null;

  if (cleanNum <= 0) {
    errores.push({ fila: filaNum, columna: colName, motivo: 'El precio debe ser un número estrictamente mayor a 0' });
    return null;
  }

  return cleanNum;
}

/**
 * Helper para validar formato numérico sin $, sin espacios internos y procesando coma como decimal.
 */
function validateAndNormalizeNumber(val, colName, filaNum, errores) {
  const str = String(val).trim();
  if (str === '') return null;

  if (str.includes('$')) {
    errores.push({ fila: filaNum, columna: colName, motivo: 'Formato numérico inválido: no debe incluir símbolo $' });
    return null;
  }

  if (/\s/.test(str)) {
    errores.push({ fila: filaNum, columna: colName, motivo: 'Formato numérico inválido: no debe incluir espacios' });
    return null;
  }

  // Detección de múltiples separadores o separadores de miles
  if (str.includes('.') && str.includes(',')) {
    errores.push({ fila: filaNum, columna: colName, motivo: 'Formato numérico inválido: no usar separadores de miles (p. ej. 1.234,56)' });
    return null;
  }

  let normalized = str;
  if (str.includes(',')) {
    if (str.split(',').length > 2) {
      errores.push({ fila: filaNum, columna: colName, motivo: 'Formato numérico inválido: múltiples comas' });
      return null;
    }
    normalized = str.replace(',', '.');
  } else if (str.includes('.')) {
    if (str.split('.').length > 2) {
      errores.push({ fila: filaNum, columna: colName, motivo: 'Formato numérico inválido: múltiples puntos' });
      return null;
    }
  }

  const num = Number(normalized);
  if (isNaN(num)) {
    errores.push({ fila: filaNum, columna: colName, motivo: `Valor no numérico: "${str}"` });
    return null;
  }

  return num;
}

/**
 * Genera el CSV de exportación de productos y precios.
 */
async function exportarPreciosCsv({ dbPool = pool, lista = null }) {
  const listasRes = await dbPool.query(`SELECT id, codigo FROM listas_precios ORDER BY id`);
  const listasMap = {};
  listasRes.rows.forEach(l => { listasMap[l.codigo] = l.id; });

  const query = `
    SELECT p.id AS producto_id, p.sku, p.nombre, p.costo, p.stock,
           pp_c.precio AS precio_cliente,
           pp_p.precio AS precio_profesional,
           pp_n.precio AS precio_negocio,
           pp_n.unidad_minima AS unidad_minima_negocio
    FROM productos p
    LEFT JOIN precios_producto pp_c ON pp_c.producto_id = p.id AND pp_c.lista_id = $1
    LEFT JOIN precios_producto pp_p ON pp_p.producto_id = p.id AND pp_p.lista_id = $2
    LEFT JOIN precios_producto pp_n ON pp_n.producto_id = p.id AND pp_n.lista_id = $3
    ORDER BY p.id ASC;
  `;
  const res = await dbPool.query(query, [listasMap.cliente, listasMap.profesional, listasMap.negocio]);
  const rows = res.rows || [];

  const header = ['producto_id', 'sku', 'nombre', 'costo', 'stock', 'precio_cliente', 'precio_profesional', 'precio_negocio', 'unidad_minima_negocio'];
  const lines = [header.join(',')];

  rows.forEach(r => {
    const pCliente = (lista && lista !== 'cliente') ? '' : (r.precio_cliente !== null && r.precio_cliente !== undefined ? r.precio_cliente : '');
    const pProf = (lista && lista !== 'profesional') ? '' : (r.precio_profesional !== null && r.precio_profesional !== undefined ? r.precio_profesional : '');
    const pNegocio = (lista && lista !== 'negocio') ? '' : (r.precio_negocio !== null && r.precio_negocio !== undefined ? r.precio_negocio : '');
    const uNegocio = (r.unidad_minima_negocio !== null && r.unidad_minima_negocio !== undefined) ? r.unidad_minima_negocio : 6;

    const line = [
      escapeCsvCell(r.producto_id),
      escapeCsvCell(r.sku || ''),
      escapeCsvCell(r.nombre || ''),
      escapeCsvCell(r.costo !== null && r.costo !== undefined ? r.costo : ''),
      escapeCsvCell(r.stock !== null && r.stock !== undefined ? r.stock : ''),
      escapeCsvCell(pCliente),
      escapeCsvCell(pProf),
      escapeCsvCell(pNegocio),
      escapeCsvCell(uNegocio)
    ];
    lines.push(line.join(','));
  });

  return lines.join('\n');
}

/**
 * Aplica los datos del CSV a la base de datos o simula los cambios (dry_run).
 */
async function aplicarPreciosCsv({ dbPool = pool, actorId = null, filas = [], errores = [], totalLeidas = 0, dryRun = true, reemplazar = false }) {
  // 1. Cargar listas de precios
  const listasRes = await dbPool.query(`SELECT id, codigo FROM listas_precios`);
  const listasMap = {};
  listasRes.rows.forEach(l => { listasMap[l.codigo] = l.id; });

  // 2. Cargar mapa de productos por id y por sku
  const prodRes = await dbPool.query(`SELECT id, sku, costo, stock, tenant_id FROM productos`);
  const prodById = {};
  const prodBySku = {};
  prodRes.rows.forEach(p => {
    prodById[p.id] = p;
    if (p.sku) prodBySku[p.sku] = p;
  });

  // 3. Cargar precios existentes
  const pricesRes = await dbPool.query(`SELECT lista_id, producto_id, precio, unidad_minima FROM precios_producto`);
  const pricesMap = {}; // key: `${lista_id}:${producto_id}`
  pricesRes.rows.forEach(pr => {
    pricesMap[`${pr.lista_id}:${pr.producto_id}`] = parseFloat(pr.precio);
  });

  const validFilas = [];
  const validErrores = [...errores];

  // 4. Validar existencia de productos en base de datos
  filas.forEach(f => {
    let matchedProd = null;
    if (f.producto_id && prodById[f.producto_id]) {
      matchedProd = prodById[f.producto_id];
    } else if (f.sku && prodBySku[f.sku]) {
      matchedProd = prodBySku[f.sku];
      f.producto_id = matchedProd.id;
    }

    if (!matchedProd) {
      validErrores.push({
        fila: f.fila,
        columna: f.producto_id ? 'producto_id' : 'sku',
        motivo: `Producto no encontrado en la base de datos (${f.producto_id || f.sku})`
      });
    } else {
      f.matchedProd = matchedProd;
      validFilas.push(f);
    }
  });

  // 5. Calcular la matriz de cambios (nuevos, modificados, sin_cambio)
  const cambios = { nuevos: 0, modificados: 0, sin_cambio: 0 };
  const detalle = [];
  const quedoSinPrecio = [];

  validFilas.forEach(f => {
    const pid = f.producto_id;

    ['cliente', 'profesional', 'negocio'].forEach(listaCod => {
      const nuevoPrecio = f.precios[listaCod];
      if (nuevoPrecio !== null && nuevoPrecio !== undefined) {
        const listaId = listasMap[listaCod];
        if (!listaId) return;

        const key = `${listaId}:${pid}`;
        const antes = pricesMap[key] !== undefined ? pricesMap[key] : null;

        if (antes === null) {
          cambios.nuevos++;
        } else if (antes !== nuevoPrecio) {
          cambios.modificados++;
        } else {
          cambios.sin_cambio++;
        }

        detalle.push({
          fila: f.fila,
          producto_id: pid,
          lista: listaCod,
          antes,
          despues: nuevoPrecio
        });
      }
    });
  });

  // Manejo de opción reemplazar=true
  if (reemplazar) {
    const productosEnCsv = new Set(validFilas.map(f => f.producto_id));
    Object.keys(pricesMap).forEach(key => {
      const [lIdStr, pIdStr] = key.split(':');
      const pId = parseInt(pIdStr, 10);
      const lId = parseInt(lIdStr, 10);

      if (productosEnCsv.has(pId)) {
        const listaCod = Object.keys(listasMap).find(k => listasMap[k] === lId);
        const f = validFilas.find(row => row.producto_id === pId);
        if (f && (f.precios[listaCod] === null || f.precios[listaCod] === undefined)) {
          quedoSinPrecio.push({ producto_id: pId, lista: listaCod, precio_removido: pricesMap[key] });
        }
      }
    });
  }

  const resultReport = {
    leidas: totalLeidas,
    validas: validFilas.length,
    con_error: validErrores.length,
    errores: validErrores,
    cambios,
    detalle,
    quedo_sin_precio: quedoSinPrecio
  };

  // Si dryRun === true, no realiza escrituras
  if (dryRun) {
    return resultReport;
  }

  // 6. Aplicar cambios reales en transacción
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');

    for (const f of validFilas) {
      const pid = f.producto_id;

      // Actualizar costo/stock si se especificaron
      if (f.costo !== null && f.costo !== undefined) {
        await client.query(`UPDATE productos SET costo = $1 WHERE id = $2`, [f.costo, pid]);
      }
      if (f.stock !== null && f.stock !== undefined) {
        await client.query(`UPDATE productos SET stock = $1 WHERE id = $2`, [f.stock, pid]);
      }

      // Upsert precios por lista
      for (const listaCod of ['cliente', 'profesional', 'negocio']) {
        const pNuevo = f.precios[listaCod];
        if (pNuevo !== null && pNuevo !== undefined) {
          const listaId = listasMap[listaCod];
          if (!listaId) continue;

          const uMin = listaCod === 'negocio' ? (f.unidad_minima_negocio || 6) : 1;
          const key = `${listaId}:${pid}`;
          const pAntes = pricesMap[key] !== undefined ? pricesMap[key] : null;

          await client.query(`
            INSERT INTO precios_producto (lista_id, producto_id, precio, unidad_minima)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (lista_id, producto_id)
            DO UPDATE SET precio = EXCLUDED.precio, unidad_minima = EXCLUDED.unidad_minima;
          `, [listaId, pid, pNuevo, uMin]);

          await client.query(`
            INSERT INTO precios_historial (lista_id, producto_id, precio_anterior, precio_nuevo, actor_id, origen, motivo, tenant_id)
            SELECT $1, $2, $3, $4, $5, 'import_csv', 'Importación masiva CSV', tenant_id FROM listas_precios WHERE id = $1;
          `, [listaId, pid, pAntes, pNuevo, actorId]);
        }
      }

      // Si reemplazar === true, eliminar los precios omitidos para estos productos
      if (reemplazar) {
        for (const item of quedoSinPrecio) {
          if (item.producto_id === pid) {
            const listaId = listasMap[item.lista];
            await client.query(`DELETE FROM precios_producto WHERE lista_id = $1 AND producto_id = $2`, [listaId, pid]);
            await client.query(`
              INSERT INTO precios_historial (lista_id, producto_id, precio_anterior, precio_nuevo, actor_id, origen, motivo, tenant_id)
              SELECT $1, $2, $3, NULL, $4, 'import_csv', 'Eliminación por reemplazo CSV', tenant_id FROM listas_precios WHERE id = $1;
            `, [listaId, pid, item.precio_removido, actorId]);
          }
        }
      }
    }

    await client.query('COMMIT');
    return resultReport;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al aplicar importación de precios CSV:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  parsearPreciosCsv,
  exportarPreciosCsv,
  aplicarPreciosCsv
};
