/**
 * Modelo de datos del Panel de Administración de GlowApp para PostgreSQL.
 * Proporciona consultas parametrizadas seguras nativas.
 */
const { pool, systemPool } = require('../../config/db');
const { runAsSystem } = require('../../config/tenantRouting');

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
 * Las rutas administrativas necesitan consultar proveedores de cualquier
 * tenant. Ejecutar cada consulta en una transacción acotada con app_system
 * evita que RLS responda silenciosamente con cero filas usando el pool normal.
 */
async function executeAdminQuery(query, params = []) {
  return runAsSystem({ pool, systemPool }, async (client) => {
    const result = await client.query(query, params);
    return result.rows;
  });
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
      u_requester.nombre AS requester_name, u_requester.phone AS requester_phone,
      u_requester.rol AS requester_role,
      u_prov.nombre AS provider_name, u_prov.phone AS provider_phone
    FROM sos_alerts s
    LEFT JOIN usuarios u_requester ON s.user_id = u_requester.id
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
  return await executeAdminQuery(query);
}

async function getProviderFcmToken(providerId) {
  const query = 'SELECT fcm_token FROM usuarios WHERE id = $1';
  const rows = await executeAdminQuery(query, [providerId]);
  return rows.length > 0 ? rows[0].fcm_token : null;
}

/**
 * Actualiza el estado de verificación de un prestador con valores del enum PostgreSQL.
 */
async function setProviderVerifiedStatus(providerId, isVerified) {
  const status = isVerified ? 'APROBADO' : 'RECHAZADO';
  const documentRequirements = isVerified
    ? `AND documento_id_url IS NOT NULL AND BTRIM(documento_id_url) <> ''
       AND certificacion_url IS NOT NULL AND BTRIM(certificacion_url) <> ''`
    : '';
  const query = `
    UPDATE perfiles_prestador
       SET estatus_verificacion = $1
     WHERE id = $2 AND estatus_verificacion = 'PENDIENTE'
       ${documentRequirements}
    RETURNING id, estatus_verificacion;
  `;
  return await executeAdminQuery(query, [status, providerId]);
}

/** Lista prestadores con los estados que determinan su operación. */
async function getProvidersOperationalStatus() {
  return runAsSystem({ pool, systemPool }, async (client) => {
    const { rows } = await client.query(`
      SELECT u.id, u.nombre, u.email, u.rol, u.is_active,
             u.estado_operativo, u.estado_operativo_desde, u.estado_operativo_motivo,
             u.revision_estado AS rut_revision_estado, u.rut_numero,
             p.estatus_verificacion,
             (p.documento_id_url IS NOT NULL AND BTRIM(p.documento_id_url) <> '') AS tiene_documento,
             (p.certificacion_url IS NOT NULL AND BTRIM(p.certificacion_url) <> '') AS tiene_acreditacion
        FROM usuarios u
        LEFT JOIN perfiles_prestador p ON p.id = u.id
       WHERE u.rol::text IN ('PRESTADOR', 'SALON')
       ORDER BY CASE WHEN u.estado_operativo = 'HABILITADO' THEN 1 ELSE 0 END,
                LOWER(u.nombre), u.id
    `);

    return rows.map((row) => {
      const requisitos = [];
      if (!row.is_active) requisitos.push('La cuenta está inactiva.');
      if (row.estatus_verificacion !== 'APROBADO') requisitos.push('Falta aprobar identidad y acreditación profesional.');
      if (!row.tiene_documento) requisitos.push('Falta el documento de identidad.');
      if (!row.tiene_acreditacion) requisitos.push('Falta la acreditación profesional.');
      if (row.rut_revision_estado !== 'APROBADA' || !row.rut_numero) requisitos.push('Falta la aprobación del RUT.');

      return {
        ...row,
        estado_operativo: row.estado_operativo || 'EXPLORACION',
        puede_habilitar: requisitos.length === 0 && row.estado_operativo !== 'SUSPENDIDO' && row.estado_operativo !== 'HABILITADO',
        requisitos_pendientes: requisitos,
      };
    });
  });
}

/** Habilita en una transacción, revalidando requisitos y guardando ambas bitácoras. */
async function enableProviderOperational(providerId, adminId) {
  return runAsSystem({ pool, systemPool }, async (client) => {
    const { rows } = await client.query(`
      SELECT u.id, u.nombre, u.rol, u.is_active, u.estado_operativo,
             u.revision_estado, u.rut_numero,
             p.estatus_verificacion, p.documento_id_url, p.certificacion_url
        FROM usuarios u
        LEFT JOIN perfiles_prestador p ON p.id = u.id
       WHERE u.id = $1 AND u.rol::text IN ('PRESTADOR', 'SALON')
       FOR UPDATE OF u
    `, [providerId]);

    if (!rows.length) return { ok: false, reason: 'NOT_FOUND' };
    const provider = rows[0];
    if (provider.estado_operativo === 'HABILITADO') return { ok: true, alreadyEnabled: true, provider };
    if (provider.estado_operativo === 'SUSPENDIDO') return { ok: false, reason: 'SUSPENDED' };

    const requisitos = [];
    if (!provider.is_active) requisitos.push('La cuenta está inactiva.');
    if (provider.estatus_verificacion !== 'APROBADO') requisitos.push('Identidad y acreditación deben estar aprobadas.');
    if (!provider.documento_id_url || !provider.documento_id_url.trim()) requisitos.push('Falta el documento de identidad.');
    if (!provider.certificacion_url || !provider.certificacion_url.trim()) requisitos.push('Falta la acreditación profesional.');
    if (provider.revision_estado !== 'APROBADA' || !provider.rut_numero) requisitos.push('El RUT debe estar aprobado y registrado.');
    if (requisitos.length) return { ok: false, reason: 'REQUIREMENTS', requisitos };

    const { rows: updated } = await client.query(`
      UPDATE usuarios
         SET estado_operativo = 'HABILITADO',
             estado_operativo_desde = NOW(),
             estado_operativo_motivo = $2
       WHERE id = $1
       RETURNING id, nombre, estado_operativo, estado_operativo_desde, estado_operativo_motivo
    `, [providerId, `Habilitado manualmente desde el dashboard por administrador ${adminId}; identidad, acreditación y RUT aprobados.`]);

    await client.query(`
      INSERT INTO estado_operativo_historial
        (usuario_id, estado_anterior, estado_nuevo, motivo, cambiado_por, creado_en)
      VALUES ($1, $2, 'HABILITADO', $3, $4, NOW())
    `, [providerId, provider.estado_operativo || 'EXPLORACION', updated[0].estado_operativo_motivo, adminId]);

    await client.query(`
      INSERT INTO admin_actions (admin_id, accion, descripcion, fecha_creacion)
      VALUES ($1, 'HABILITAR_ESTADO_OPERATIVO', $2, NOW())
    `, [adminId, `Prestador ID ${providerId} habilitado operativamente tras validar identidad, acreditación y RUT.`]);

    return { ok: true, alreadyEnabled: false, provider: updated[0] };
  });
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
  getProvidersOperationalStatus,
  enableProviderOperational,
  getProviderFcmToken,
  setProviderVerifiedStatus,
  getProviderWalletBalance,
  hasActiveDisputes,
  processWalletWithdrawal,
  getConsolidatedFinancialMetrics,
  getDailyFinancialHistory,
  getCategoryPopularity,
  logKYCEvidence
};
