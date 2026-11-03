/**
 * Modelo de datos del Panel de Administración de GlowApp para PostgreSQL.
 * Proporciona consultas parametrizadas seguras nativas.
 */
const { pool } = require('../../config/db');

/**
 * Helper para ejecutar consultas parametrizadas de forma segura en PostgreSQL.
 */
async function executeQuery(query, params = []) {
  if (pool) {
    const res = await pool.query(query, params);
    return res.rows;
  }
  console.log(`[PostgreSQL mock] Ejecutando: ${query} con parámetros:`, params);
  return [];
}

/**
 * Obtener alertas SOS activas con información unida de cliente y prestador.
 */
async function getActiveSOSAlerts(estado = 'ACTIVO') {
  // 'TODOS' devuelve activas y atendidas: la pantalla /admin/sos necesita ver
  // la resolución de las que ya se atendieron. El dashboard usa el valor por
  // defecto ('ACTIVO') para su contador, así que no cambia de comportamiento.
  const query = `
    SELECT 
      s.id, s.latitude, s.longitude, s.estado, s.creado_en as fecha_creacion,
      s.resolucion, s.resuelto_en,
      u_client.nombre AS client_name, u_client.phone AS client_phone,
      u_prov.nombre AS provider_name, u_prov.phone AS provider_phone
    FROM sos_alerts s
    LEFT JOIN usuarios u_client ON s.user_id = u_client.id
    LEFT JOIN bookings b ON s.booking_id = b.id
    LEFT JOIN usuarios u_prov ON b.provider_id = u_prov.id
    WHERE ($1 = 'TODOS' OR s.estado = $1)
    ORDER BY CASE WHEN s.estado = 'ACTIVO' THEN 0 ELSE 1 END, s.creado_en DESC
    LIMIT 200;
  `;
  return await executeQuery(query, [estado]);
}

/**
 * Actualiza el estado de una alerta SOS.
 */
async function updateSOSAlertStatus(alertId, newStatus, resolucion = null, adminId = null) {
  // No se toca creado_en: es la fecha en que se EMITIO el SOS. El momento y el
  // autor de la atención van a resuelto_en / resuelto_por, y el texto a resolucion.
  // `AND estado = 'ACTIVO'` evita atender dos veces la misma alerta: si ya estaba
  // atendida no devuelve filas y el controlador responde 404.
  const query = `
    UPDATE sos_alerts
    SET estado = $1,
        resolucion = $3,
        resuelto_en = NOW(),
        resuelto_por = $4
    WHERE id = $2 AND estado = 'ACTIVO'
    RETURNING id, estado, resolucion, resuelto_en;
  `;
  return await executeQuery(query, [newStatus, alertId, resolucion, adminId]);
}

/**
 * Registra una acción administrativa.
 */
async function logAdminAction(adminId, actionType, description) {
  const query = `
    INSERT INTO admin_actions (admin_id, accion, descripcion, fecha_creacion)
    VALUES ($1, $2, $3, NOW());
  `;
  return await executeQuery(query, [adminId, actionType, description]);
}

/**
 * Obtener prestadores con estado de verificación PENDIENTE.
 */
async function getPendingProviders() {
  const query = `
    SELECT p.id, u.nombre, u.email, p.business_name, p.description, 
           p.documento_id_url, p.rut_url, p.certificacion_url, p.estatus_verificacion
    FROM perfiles_prestador p
    JOIN usuarios u ON p.id = u.id
    WHERE p.estatus_verificacion = 'PENDIENTE';
  `;
  return await executeQuery(query);
}

/**
 * Actualiza el estado de verificación de un prestador con valores del enum PostgreSQL.
 */
async function setProviderVerifiedStatus(providerId, isVerified) {
  const status = isVerified ? 'APROBADO' : 'RECHAZADO';
  const query = `
    UPDATE perfiles_prestador 
    SET estatus_verificacion = $1 
    WHERE id = $2;
  `;
  return await executeQuery(query, [status, providerId]);
}

/**
 * Obtiene el saldo disponible de un prestador en su billetera.
 */
async function getProviderWalletBalance(providerId) {
  const query = `
    SELECT saldo_disponible 
    FROM provider_wallet 
    WHERE provider_id = $1;
  `;
  const rows = await executeQuery(query, [providerId]);
  return rows.length > 0 ? parseFloat(rows[0].saldo_disponible) : 0;
}

/**
 * Comprueba si existen disputas activas relacionadas con un prestador.
 */
async function hasActiveDisputes(providerId) {
  const query = `
    SELECT COUNT(*) AS count 
    FROM disputas d
    JOIN bookings b ON d.booking_id = b.id
    WHERE b.provider_id = $1 AND d.estado IN ('ABIERTA','EN_REVISION');
  `;
  const rows = await executeQuery(query, [providerId]);
  return rows.length > 0 && parseInt(rows[0].count) > 0;
}

/**
 * Registra y aprueba la solicitud de retiro en el historial contable.
 */
async function processWalletWithdrawal(providerId, amount, newBalance) {
  // 1. Actualizar saldo disponible
  const updateWalletQuery = `
    UPDATE provider_wallet 
    SET saldo_disponible = $1 
    WHERE provider_id = $2;
  `;
  await executeQuery(updateWalletQuery, [newBalance, providerId]);

  // 2. Registrar el retiro en el historial de transacciones de liquidación
  const recordTransactionQuery = `
    INSERT INTO wallet_transactions (provider_id, tipo, monto, estado, created_at)
    VALUES ($1, 'DEBITO_RETIRO', $2, 'COMPLETADO', NOW());
  `;
  return await executeQuery(recordTransactionQuery, [providerId, amount]);
}

/**
 * Obtiene métricas financieras consolidadas agregando valores brutos, comisiones e impuestos.
 */
async function getConsolidatedFinancialMetrics() {
  const query = `
    SELECT 
      COALESCE(SUM(valor_bruto), 0.00) AS gmv,
      COALESCE(SUM(comision_plataforma), 0.00) AS total_commission,
      COALESCE(SUM(impuestos_estado), 0.00) AS total_taxes,
      COALESCE(SUM(comision_plataforma + impuestos_estado), 0.00) AS platform_gross_income,
      COALESCE(SUM(pago_neto_prestador), 0.00) AS total_provider_payouts,
      COUNT(id) AS total_bookings
    FROM bookings
    WHERE estado IN ('COMPLETADA', 'FINALIZADA_PRESTADOR');
  `;
  const rows = await executeQuery(query);
  return rows.length > 0 ? rows[0] : {
    gmv: 0,
    total_commission: 0,
    total_taxes: 0,
    platform_gross_income: 0,
    total_provider_payouts: 0,
    total_bookings: 0
  };
}

/**
 * Obtiene el historial financiero diario (últimos 30 días con actividad).
 */
async function getDailyFinancialHistory() {
  const query = `
    SELECT 
      DATE(scheduled_at) AS date,
      COALESCE(SUM(valor_bruto), 0.00) AS gmv,
      COALESCE(SUM(comision_plataforma + impuestos_estado), 0.00) AS income
    FROM bookings
    WHERE estado IN ('COMPLETADA', 'FINALIZADA_PRESTADOR')
    GROUP BY DATE(scheduled_at)
    ORDER BY DATE(scheduled_at) ASC
    LIMIT 30;
  `;
  return await executeQuery(query);
}

/**
 * Obtiene la distribución de popularidad e ingresos por categoría de servicio.
 */
async function getCategoryPopularity() {
  const query = `
    SELECT 
      COALESCE(s.category, 'Otros') AS category,
      COUNT(b.id) AS booking_count,
      COALESCE(SUM(b.valor_bruto), 0.00) AS total_revenue
    FROM bookings b
    JOIN services s ON b.service_id = s.id
    WHERE b.estado IN ('COMPLETADA', 'FINALIZADA_PRESTADOR')
    GROUP BY s.category
    ORDER BY booking_count DESC;
  `;
  return await executeQuery(query);
}

/**
 * Registra evidencia KYC inmutable para auditoría legal.
 * Tabla: kyc_audit_logs (inmutable - solo INSERT)
 */
async function logKYCEvidence(providerId, documentType, documentNumberHash, providerName, providerResponseHash, result, auditId, auditHash) {
  const query = `
    INSERT INTO kyc_audit_logs (
      audit_id, provider_id, document_type, document_number_hash,
      provider_name, provider_response_hash, result, created_at, audit_hash
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (audit_id) DO NOTHING;
  `;
  return await executeQuery(query, [
    auditId, providerId, documentType, documentNumberHash,
    providerName, providerResponseHash, result, new Date().toISOString(), auditHash
  ]);
}

module.exports = {
  getActiveSOSAlerts,
  updateSOSAlertStatus,
  logAdminAction,
  getPendingProviders,
  setProviderVerifiedStatus,
  getProviderWalletBalance,
  hasActiveDisputes,
  processWalletWithdrawal,
  getConsolidatedFinancialMetrics,
  getDailyFinancialHistory,
  getCategoryPopularity,
  logKYCEvidence
};
