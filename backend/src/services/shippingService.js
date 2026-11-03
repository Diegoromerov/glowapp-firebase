// backend/src/services/shippingService.js
// Motor de cotización de envío por zonas (L5)
const { pool } = require('../config/db');

/**
 * Cotiza el costo de envío para una dirección y valor de pedido.
 * 
 * @param {Object} params
 * @param {string} params.ciudad - Ciudad de destino
 * @param {string} params.departamento - Departamento de destino
 * @param {string} [params.codigo_postal] - Código postal (opcional, para match por prefijo)
 * @param {number} [params.peso_total_kg=0.5] - Peso estimado del paquete en kg
 * @param {number} [params.valor_pedido=0] - Valor total del pedido (para envío gratis por monto)
 * @returns {Promise<Object>} { costo, transportadora, dias_estimados, gratis, zona, tarifa_base, tarifa_por_kg }
 */
/**
 * Normaliza un texto para compararlo: sin acentos, sin mayusculas, sin espacios de mas.
 * En SQL `lower()` no alcanza: "bogota" nunca iguala a "Bogota con tilde", y una direccion
 * guardada sin tildes caia al fallback global "OTRO" (la tarifa mas cara).
 */
function normalizar(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Cotiza el costo de envío para una dirección y valor de pedido.
 *
 * @param {Object} params
 * @param {string} params.ciudad - Ciudad de destino
 * @param {string} params.departamento - Departamento de destino
 * @param {string} [params.codigo_postal] - Código postal (opcional, para match por prefijo)
 * @param {number} [params.peso_total_kg=0.5] - Peso estimado del paquete en kg
 * @param {number} [params.valor_pedido=0] - Valor total del pedido (para envío gratis por monto)
 * @returns {Promise<Object>} { costo, transportadora, dias_estimados, gratis, zona, tarifa_base, tarifa_por_kg }
 */
async function cotizarEnvio({ ciudad, departamento, codigo_postal, peso_total_kg = 0.5, valor_pedido = 0 }) {
  if (!ciudad || !departamento) {
    throw new Error('ciudad y departamento son obligatorios para cotizar envío');
  }

  const cp = String(codigo_postal || '');
  const nCiudad = normalizar(ciudad);
  const nDepartamento = normalizar(departamento);

  // Una sola consulta: el catalogo de zonas es pequeno y el emparejamiento se hace en
  // memoria, que es donde se puede ignorar tildes y mayusculas de verdad.
  const zonasRes = await pool.query('SELECT * FROM zonas_envio WHERE activa ORDER BY ciudad, departamento');
  const zonas = zonasRes.rows || [];

  // 1. Ciudad + departamento (normalizados).
  const candidatas = zonas.filter(
    (z) => normalizar(z.ciudad) === nCiudad && normalizar(z.departamento) === nDepartamento
  );

  let zona = null;
  if (candidatas.length > 0) {
    // 1a. Con codigo postal: gana el prefijo mas largo que coincida.
    const porPrefijo = candidatas
      .filter((z) => z.codigo_postal_prefijo && cp.startsWith(String(z.codigo_postal_prefijo)))
      .sort(
        (a, b) =>
          String(b.codigo_postal_prefijo).length - String(a.codigo_postal_prefijo).length
      )[0];
    // 1b. Sin prefijo declarado: comodin de la ciudad.
    const sinPrefijo = candidatas.find((z) => !z.codigo_postal_prefijo);
    zona = porPrefijo || sinPrefijo || candidatas[0];
  }

  // 2. La ciudad coincide pero el departamento viene escrito distinto.
  if (!zona) {
    zona = zonas.find((z) => normalizar(z.ciudad) === nCiudad) || null;
  }

  // 3. Fallback global "OTRO".
  if (!zona) {
    zona = zonas.find((z) => normalizar(z.ciudad) === 'otro') || null;
  }

  if (!zona) {
    // Hardcoded fallback extremo (no deberia ocurrir si el seed tiene OTRO)
    return {
      costo: 15000,
      transportadora: 'Coordinadora',
      dias_estimados: '3-6 días hábiles',
      gratis: false,
      zona: 'Desconocida',
      tarifa_base: 15000,
      tarifa_por_kg: 800
    };
  }

  const tarifaBase = parseFloat(zona.tarifa_base);
  const tarifaPorKg = parseFloat(zona.tarifa_por_kg || 0);
  const gratisDesde = zona.gratis_desde_monto ? parseFloat(zona.gratis_desde_monto) : null;

  // Calcular costo: base + peso
  let costo = tarifaBase + tarifaPorKg * peso_total_kg;

  // Envío gratis por monto
  const gratis = gratisDesde !== null && valor_pedido >= gratisDesde;
  if (gratis) costo = 0;

  return {
    costo: Math.round(costo),
    transportadora: zona.transportadora_default || 'Coordinadora',
    dias_estimados: `${zona.dias_estimados_min}-${zona.dias_estimados_max} días hábiles`,
    gratis,
    zona: `${zona.ciudad}, ${zona.departamento}`,
    tarifa_base: tarifaBase,
    tarifa_por_kg: tarifaPorKg,
    gratis_desde_monto: gratisDesde
  };
}

/**
 * Obtiene todas las zonas activas (para admin)
 */
async function getAllZonas() {
  const res = await pool.query(
    `SELECT * FROM zonas_envio WHERE activa ORDER BY departamento, ciudad`
  );
  return res.rows;
}

/**
 * Crea o actualiza una zona (admin)
 */
async function upsertZona(zonaData) {
  const {
    ciudad,
    departamento,
    codigo_postal_prefijo,
    tarifa_base,
    tarifa_por_kg,
    gratis_desde_monto,
    transportadora_default,
    dias_estimados_min,
    dias_estimados_max,
    activa = true
  } = zonaData;

  const res = await pool.query(
    `INSERT INTO zonas_envio 
      (ciudad, departamento, codigo_postal_prefijo, tarifa_base, tarifa_por_kg, gratis_desde_monto, transportadora_default, dias_estimados_min, dias_estimados_max, activa)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (ciudad, departamento, codigo_postal_prefijo) DO UPDATE SET
      tarifa_base = EXCLUDED.tarifa_base,
      tarifa_por_kg = EXCLUDED.tarifa_por_kg,
      gratis_desde_monto = EXCLUDED.gratis_desde_monto,
      transportadora_default = EXCLUDED.transportadora_default,
      dias_estimados_min = EXCLUDED.dias_estimados_min,
      dias_estimados_max = EXCLUDED.dias_estimados_max,
      activa = EXCLUDED.activa
     RETURNING *`,
    [ciudad, departamento, codigo_postal_prefijo, tarifa_base, tarifa_por_kg, gratis_desde_monto, transportadora_default, dias_estimados_min, dias_estimados_max, activa]
  );
  return res.rows[0];
}

/**
 * Desactiva una zona (admin)
 */
async function deactivateZona(ciudad, departamento, codigo_postal_prefijo) {
  const res = await pool.query(
    `UPDATE zonas_envio SET activa = false WHERE lower(ciudad) = lower($1) AND lower(departamento) = lower($2) AND (codigo_postal_prefijo IS NULL AND $3 IS NULL OR codigo_postal_prefijo = $3) RETURNING *`,
    [ciudad, departamento, codigo_postal_prefijo]
  );
  return res.rows[0];
}

module.exports = {
  cotizarEnvio,
  getAllZonas,
  upsertZona,
  deactivateZona
};