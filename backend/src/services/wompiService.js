const { pool } = require('../config/db');
const crypto = require('crypto');
const wompiPayoutsClient = require('./wompiPayoutsClient');

/**
 * Genera una referencia Wompi DETERMINISTA (idempotente) a partir de la clave de
 * negocio de la operación.
 *
 * Antes se usaba `Math.random()`, que no es idempotente ni garantiza unicidad:
 * un reintento del mismo pago generaba una referencia distinta, creando
 * dispersiones duplicadas y rompiendo la conciliación con Wompi.
 *
 * Ahora: misma operación -> misma referencia (un reintento es reconocible como el
 * mismo pago); operaciones distintas -> referencias distintas (colisión
 * despreciable con SHA-256 truncado a 16 hex / 64 bits).
 */
const generarReferenciaIdempotente = (prefijo, ...claves) => {
  const huella = crypto
    .createHash('sha256')
    .update(claves.map((clave) => String(clave)).join('|'))
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();
  return `${prefijo}_${huella}`;
};

/**
 * Mapea el estado del lote de Wompi al estado interno de `retiros`.
 * Wompi crea el lote como pendiente y lo resuelve asincrónicamente; el job de
 * conciliación corrige el estado final cuando Wompi notifica/actualiza.
 */
const mapearEstadoRetiro = (estadoWompi) => {
  const estado = String(estadoWompi || '').toUpperCase();
  if (['TOTAL_PAYMENT', 'APPROVED', 'COMPLETED', 'PAID', 'SUCCESS'].includes(estado)) return 'COMPLETADO';
  if (['FAILED', 'REJECTED', 'ERROR', 'PARTIAL_PAYMENT'].includes(estado)) return 'FALLIDO';
  return 'PROCESANDO';
};

/** Tipo de cuenta tal como lo exige Wompi. */
const mapearTipoCuenta = (tipoCuentaBancaria) => {
  const tipo = String(tipoCuentaBancaria || '').toUpperCase();
  return tipo === 'CORRIENTE' ? 'CORRIENTE' : 'AHORROS';
};

/**
 * Realiza un retiro / payout automático o por demanda a través de Wompi.
 * @param {object} params Datos del retiro
 */
exports.crearPayout = async ({ retiroId, providerId, amount, numeroCuenta, banco, automatico = false }) => {
  // Compuerta: sin credenciales reales no se intenta dispersar. No se simula.
  if (!wompiPayoutsClient.isConfigured()) {
    throw new Error(
      '[WOMPI PAYOUTS] Dispersión imposible: faltan credenciales (WOMPI_PAYOUTS_API_KEY / ' +
      'WOMPI_PAYOUTS_USER_PRINCIPAL_ID / WOMPI_PAYOUTS_ACCOUNT_ID). No se simula el pago.'
    );
  }

  const referenciaLote = generarReferenciaIdempotente('wompi_ret', retiroId, providerId, amount);

  try {
    console.log(`\n💸 [WOMPI PAYOUT] Procesando dispersión (${automatico ? 'AUTOMÁTICO' : 'DEMANDA'}): retiro=${retiroId} monto=$${amount} COP`);

    // 1. Datos del beneficiario exigidos por Wompi (name, legalId, legalIdType).
    const { rows } = await pool.query(
      `SELECT w.titular_nombre, w.titular_documento_tipo, w.titular_documento_num,
              w.tipo_cuenta_bancaria, w.numero_cuenta, w.banco,
              u.nombre AS usuario_nombre, u.email AS usuario_email
       FROM provider_wallet w
       JOIN usuarios u ON u.id = w.provider_id
       WHERE w.provider_id = $1`,
      [providerId]
    );

    if (!rows.length) throw new Error(`No existe wallet para el prestador ${providerId}.`);
    const w = rows[0];

    const nombreBeneficiario = (w.titular_nombre || w.usuario_nombre || '').trim();
    const legalIdType = (w.titular_documento_tipo || 'CC').toUpperCase();
    const legalId = (w.titular_documento_num || '').trim();
    const email = (w.usuario_email || '').trim();
    const cuentaDestino = String(numeroCuenta || w.numero_cuenta || '').trim();

    const faltantes = [];
    if (!nombreBeneficiario) faltantes.push('titular_nombre');
    if (!legalId) faltantes.push('titular_documento_num');
    if (!email) faltantes.push('email del prestador');
    if (!cuentaDestino) faltantes.push('numero_cuenta');
    if (faltantes.length) {
      throw new Error(
        `El prestador no tiene los datos que Wompi exige para dispersar: falta ${faltantes.join(', ')}.`
      );
    }

    // 2. bankId real (UUID) desde el catálogo de Wompi. Nunca se inventa.
    const bankId = await wompiPayoutsClient.resolveBankId(banco || w.banco);

    // 3. Lote de dispersión (amount en CENTAVOS).
    const lote = await wompiPayoutsClient.createPayoutBatch({
      reference: referenciaLote,
      idempotencyKey: referenciaLote,
      paymentType: 'PROVIDERS',
      transactions: [
        {
          legalIdType,
          legalId,
          bankId,
          accountType: mapearTipoCuenta(w.tipo_cuenta_bancaria),
          accountNumber: cuentaDestino,
          name: nombreBeneficiario,
          email,
          amount: Math.round(Number(amount) * 100),
          reference: referenciaLote
        }
      ]
    });

    const estadoInterno = mapearEstadoRetiro(lote.status);

    // 4. Guardar la referencia REAL de la pasarela y el estado traducido.
    await pool.query(
      `UPDATE retiros
          SET estado = $2,
              referencia_wompi = $3,
              procesado_at = NOW()
        WHERE id = $1`,
      [retiroId, estadoInterno, lote.id]
    );

    // 5. Registrar el desenlace como evento append-only (ledger inmutable).
    await pool.query(
      `INSERT INTO wallet_ledger_events (tx_id, provider_id, evento, detalle)
       SELECT wt.id, wt.provider_id, 'RETIRO_COMPLETADO',
              jsonb_build_object('referencia_wompi', $2::text, 'estado_wompi', $3::text)
       FROM wallet_transactions wt
       WHERE wt.provider_id = $1
         AND wt.tipo = 'DEBITO_RETIRO'
         AND (wt.metadata->>'retiro_id')::uuid = $4`,
      [providerId, lote.id, lote.status || 'PENDING', retiroId]
    );

    console.log(`✅ [WOMPI PAYOUT] Retiro ${retiroId} enviado. Lote Wompi: ${lote.id} (${lote.status}).`);
    return { retiroId, referenciaWompi: lote.id, estadoWompi: lote.status, estado: estadoInterno };
  } catch (err) {
    console.error(`❌ [WOMPI PAYOUT ERROR] Fallo al dispersar el retiro ${retiroId}:`, err.message);

    await pool.query(
      `UPDATE retiros
          SET estado = 'FALLIDO',
              error_wompi = $2,
              procesado_at = NOW()
        WHERE id = $1`,
      [retiroId, String(err.message).slice(0, 500)]
    );

    await pool.query(
      `INSERT INTO wallet_ledger_events (tx_id, provider_id, evento, detalle)
       SELECT wt.id, wt.provider_id, 'RETIRO_FALLIDO',
              jsonb_build_object('error', $3::text)
       FROM wallet_transactions wt
       WHERE wt.provider_id = $1
         AND wt.tipo = 'DEBITO_RETIRO'
         AND (wt.metadata->>'retiro_id')::uuid = $2`,
      [providerId, retiroId, String(err.message).slice(0, 500)]
    );

    throw err;
  }
};

// Expuesto para pruebas de formato y mapeo.
exports._generarReferenciaIdempotente = generarReferenciaIdempotente;
exports._mapearEstadoRetiro = mapearEstadoRetiro;
exports._mapearTipoCuenta = mapearTipoCuenta;

