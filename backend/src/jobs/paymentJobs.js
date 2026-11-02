// backend/src/jobs/paymentJobs.js
// Jobs programados: retiros automáticos (quincena/mensual) + conciliación diaria

const { pool } = require('../config/db');
const wompiService = require('../services/wompiService');
const wompiPayoutsClient = require('../services/wompiPayoutsClient');
const { _mapearEstadoRetiro: mapearEstadoRetiro } = require('../services/wompiService');
const { aplicarPricingDinamico } = require('./dynamicPricing');
const { enviarNotificacionesRetencion } = require('./retentionNotification');
const { runAsSystem } = require('../config/tenantRouting');

/**
 * Ejecuta un job con el ROL DE SISTEMA activo (SET LOCAL ROLE app_system, que
 * tiene BYPASSRLS).
 *
 * Los jobs no nacen de una petición autenticada, así que no tienen inquilino, y
 * trabajan de forma intencionadamente cross-tenant: maduran saldos, ejecutan
 * retiros y concilian mirando TODOS los salones. Con FORCE ROW LEVEL SECURITY
 * (migración 068) sus consultas irían sin contexto y devolverían 0 filas, de modo
 * que el job se quedaría sin hacer su trabajo EN SILENCIO, sin lanzar un error.
 *
 * Requiere `GRANT app_system TO app_rls_user` (scripts/setupRlsRole.sql): sin esa
 * membresía, el SET LOCAL ROLE falla en voz alta en vez de degradarse.
 */
const comoSistema = (job) => async () => {
  try {
    return await runAsSystem({ pool }, () => job());
  } catch (err) {
    console.error(`❌ [paymentJobs] Error en job con ROL DE SISTEMA (${job.name || 'anon'}):`, err.message || err);
  }
};

/**
 * Lee un parámetro de configuración de la plataforma.
 */
async function getConfig(key, defaultValue = null) {
  const { rows } = await pool.query(
    'SELECT value FROM platform_config WHERE key = $1', [key]
  );
  return rows.length > 0 ? rows[0].value : defaultValue;
}

// ─── JOB 1: MADURACIÓN DE SALDOS PENDIENTES ──────────────────────────────────
/**
 * Mueve saldos de 'pendiente' a 'disponible' cuando su ventana de espera ha vencido.
 * Ejecutar cada 15 minutos.
 */
async function madurarSaldosPendientes() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Obtener transacciones pendientes que ya maduraron
    const { rows: pendientes } = await client.query(`
      SELECT wt.provider_id, SUM(wt.monto) as total_a_madurar
      FROM wallet_transactions wt
      WHERE wt.tipo = 'CREDITO_SERVICIO'
        AND wt.estado <> 'REVERTIDO'
        AND (wt.metadata->>'madura_at')::timestamptz <= NOW()
        AND NOT EXISTS (
          SELECT 1 FROM wallet_ledger_events e
          WHERE e.tx_id = wt.id AND e.evento = 'ACREDITADO'
        )
      GROUP BY wt.provider_id
    `);

    for (const row of pendientes) {
      // Acreditar al saldo disponible
      await client.query(
        `UPDATE provider_wallet
         SET saldo_disponible = saldo_disponible + $2,
             saldo_pendiente  = GREATEST(0, saldo_pendiente - $2),
             updated_at       = NOW()
         WHERE provider_id = $1`,
        [row.provider_id, parseFloat(row.total_a_madurar)]
      );

      // Registrar la acreditación como evento append-only (el ledger no se muta)
      await client.query(
        `INSERT INTO wallet_ledger_events (tx_id, provider_id, evento, detalle)
         SELECT wt.id, wt.provider_id, 'ACREDITADO',
                jsonb_build_object('monto', wt.monto, 'origen', 'job-maduracion')
         FROM wallet_transactions wt
         WHERE wt.tipo = 'CREDITO_SERVICIO'
           AND wt.estado <> 'REVERTIDO'
           AND wt.provider_id = $1
           AND (wt.metadata->>'madura_at')::timestamptz <= NOW()
           AND NOT EXISTS (
             SELECT 1 FROM wallet_ledger_events e
             WHERE e.tx_id = wt.id AND e.evento = 'ACREDITADO'
           )`,
        [row.provider_id]
      );

      console.log(`💰 Saldo madurado para prestador ${row.provider_id}: $${row.total_a_madurar}`);
    }

    await client.query('COMMIT');
    console.log(`✅ Job maduración completado. ${pendientes.length} prestadores actualizados.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error en job de maduración:', err);
  } finally {
    client.release();
  }
}

// ─── JOB 2: RETIROS AUTOMÁTICOS (QUINCENA / MENSUAL) ─────────────────────────
/**
 * Ejecuta retiros automáticos para prestadores con modelo QUINCENA o MENSUAL.
 * Ejecutar diariamente a las 6:00 AM.
 */
async function ejecutarRetirosAutomaticos() {
  const client = await pool.connect();
  try {
    const minCop = parseInt(await getConfig('retiro_auto_min_cop', '20000'));

    // Buscar prestadores cuyo retiro automático está programado para hoy
    const { rows: wallets } = await client.query(`
      SELECT pw.*, u.nombre as nombre_prestador
      FROM provider_wallet pw
      JOIN usuarios u ON pw.provider_id = u.id
      WHERE pw.modelo_retiro IN ('QUINCENA', 'MENSUAL')
        AND pw.proximo_retiro_auto <= NOW()
        AND pw.saldo_disponible >= $1
        AND pw.retiros_pausados = FALSE
        AND pw.cuenta_verificada = TRUE
    `, [minCop]);

    console.log(`🔄 Retiros automáticos: ${wallets.length} prestador(es) en cola.`);

    for (const wallet of wallets) {
      try {
        await client.query('BEGIN');

        const monto = parseFloat(wallet.saldo_disponible);

        // Verificar disputas activas
        const { rows: disputas } = await client.query(`
          SELECT COUNT(*) FROM disputas d
          JOIN bookings b ON d.booking_id = b.id
          WHERE b.provider_id = $1 AND d.estado IN ('ABIERTA','EN_REVISION')
        `, [wallet.provider_id]);

        if (parseInt(disputas[0].count) > 0) {
          console.log(`⏸️  Retiro pausado para ${wallet.nombre_prestador}: tiene disputas activas.`);
          await client.query('ROLLBACK');
          continue;
        }

        // Calcular próximo retiro según el modelo
        const ahora = new Date();
        let proximoRetiro;
        if (wallet.modelo_retiro === 'QUINCENA') {
          const dia = ahora.getDate();
          if (dia < 15) {
            proximoRetiro = new Date(ahora.getFullYear(), ahora.getMonth(), 15);
          } else {
            proximoRetiro = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1);
          }
        } else { // MENSUAL
          proximoRetiro = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0);
        }

        // Registrar retiro
        const { rows: retiroRows } = await client.query(
          `INSERT INTO retiros (provider_id, wallet_id, monto, tipo_origen, numero_cuenta, banco, estado)
           VALUES ($1, $2, $3, $4, $5, $6, 'PROCESANDO')
           RETURNING *`,
          [wallet.provider_id, wallet.id, monto, wallet.modelo_retiro,
           wallet.numero_cuenta, wallet.banco]
        );

        // Debitar wallet
        await client.query(
          `UPDATE provider_wallet
           SET saldo_disponible     = 0,
               total_retirado       = total_retirado + $2,
               ultimo_retiro_at     = NOW(),
               proximo_retiro_auto  = $3,
               updated_at           = NOW()
           WHERE provider_id = $1`,
          [wallet.provider_id, monto, proximoRetiro]
        );

        // Ledger
        await client.query(
          `INSERT INTO wallet_transactions
             (provider_id, tipo, monto, saldo_resultante, estado, descripcion, metadata)
           VALUES ($1, 'DEBITO_RETIRO', $2, 0, 'PENDIENTE', $3, $4)`,
          [
            wallet.provider_id, monto,
            `Retiro automático ${wallet.modelo_retiro}`,
            JSON.stringify({ retiro_id: retiroRows[0].id, automatico: true })
          ]
        );

        // Llamar a la API de Payouts de Wompi para realizar la dispersión
        wompiService.crearPayout({
          retiroId: retiroRows[0].id,
          providerId: wallet.provider_id,
          amount: monto,
          numeroCuenta: wallet.numero_cuenta,
          banco: wallet.banco,
          automatico: true
        }).catch(err => console.error('Error asíncrono al iniciar dispersión de retiro automático:', err));

        await client.query('COMMIT');
        console.log(`✅ Retiro automático de $${monto} para ${wallet.nombre_prestador}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ Error en retiro de ${wallet.nombre_prestador}:`, err);
      }
    }
  } catch (err) {
    console.error('❌ Error en job de retiros automáticos:', err);
  } finally {
    client.release();
  }
}

// ─── JOB 3: CONCILIACIÓN DIARIA ───────────────────────────────────────────────
/**
 * Verifica que el balance interno coincida con el reportado por Wompi.
 * Ejecutar diariamente a las 2:00 AM.
 */
async function conciliacionDiaria() {
  const client = await pool.connect();
  try {
    console.log('🔍 Iniciando conciliación diaria...');

    const { rows } = await client.query(`
      SELECT
        (SELECT COALESCE(SUM(saldo_disponible + saldo_pendiente + saldo_en_disputa), 0)
         FROM provider_wallet)                    AS total_wallets,
        (SELECT COALESCE(SUM(monto), 0)
         FROM retiros WHERE estado = 'PENDIENTE') AS retiros_pendientes,
        (SELECT COALESCE(SUM(monto), 0)
         FROM wallet_transactions
         WHERE tipo IN ('CREDITO_SERVICIO') AND estado != 'REVERTIDO'
           AND DATE(created_at) = CURRENT_DATE)  AS creditos_hoy,
        (SELECT COUNT(*) FROM disputas
         WHERE estado IN ('ABIERTA','EN_REVISION')
           AND sla_limite_at < NOW())             AS disputas_sla_vencido
    `);

    const reporte = rows[0];
    console.log('📊 Reporte de conciliación:', reporte);

    // TODO: Comparar con balance real de Wompi via API
    // const balanceWompi = await wompiService.obtenerBalance();
    // if (Math.abs(balanceWompi - reporte.total_wallets) > 100) { ALERTA CRÍTICA }

    if (parseInt(reporte.disputas_sla_vencido) > 0) {
      console.error(`⚠️  ${reporte.disputas_sla_vencido} disputas con SLA vencido. Requiere atención inmediata.`);
      // TODO: Enviar email de alerta al admin
    }

    // Expirar OTPs vencidos
    const { rows: expiredOTPs } = await client.query(
      `SELECT expirar_otps_vencidos() as expirados`
    );
    console.log(`⏱️  OTPs expirados: ${expiredOTPs[0].expirados}`);

    console.log('✅ Conciliación diaria completada.');
    return reporte;
  } catch (err) {
    console.error('❌ Error en conciliación diaria:', err);
  } finally {
    client.release();
  }
}

// ─── JOB 4: CONCILIACIÓN DE PAYOUTS (RECONCILIACIÓN W2) ───────────────────────
/**
 * Consulta Wompi el estado de los retiros en PROCESANDO y actualiza al estado real.
 * - Si Wompi dice TOTAL_PAYMENT/APPROVED/COMPLETED → COMPLETADO (ya está OK en ledger por crearPayout).
 * - Si Wompi dice FAILED/REJECTED/ERROR/PARTIAL_PAYMENT → FALLIDO + RE-ABONAR saldo_disponible (W3).
 * Ejecutar cada 10 minutos.
 */
async function conciliarPayouts() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Retiros en PROCESANDO que ya tienen referencia_wompi (lote enviado)
    const { rows: retirosProcesando } = await client.query(`
      SELECT r.id, r.provider_id, r.monto, r.referencia_wompi, r.numero_cuenta, r.banco,
             pw.saldo_disponible
      FROM retiros r
      JOIN provider_wallet pw ON pw.id = r.wallet_id
      WHERE r.estado = 'PROCESANDO'
        AND r.referencia_wompi IS NOT NULL
    `);

    if (retirosProcesando.length === 0) {
      await client.query('COMMIT');
      return;
    }

    console.log(`🔄 Conciliando ${retirosProcesando.length} retiro(s) en PROCESANDO...`);

    for (const retiro of retirosProcesando) {
      try {
        const lote = await wompiPayoutsClient.getPayout(retiro.referencia_wompi);
        const estadoWompi = lote.status || 'PENDING';
        const estadoInterno = mapearEstadoRetiro(estadoWompi);

        if (estadoInterno === 'PROCESANDO') {
          // Wompi aún no resuelve; esperar próximo ciclo
          continue;
        }

        // Actualizar retiro al estado real
        await client.query(
          `UPDATE retiros
              SET estado = $2,
                  error_wompi = CASE WHEN $2 = 'FALLIDO' THEN $3 ELSE NULL END,
                  procesado_at = NOW()
            WHERE id = $1`,
          [retiro.id, estadoInterno, estadoInterno === 'FALLIDO' ? `Wompi: ${estadoWompi}` : null]
        );

        if (estadoInterno === 'FALLIDO') {
          // W3: RE-ABONAR saldo_disponible al wallet (el débito se hizo al crear el retiro)
          await client.query(
            `UPDATE provider_wallet
                SET saldo_disponible = saldo_disponible + $2,
                    updated_at       = NOW()
              WHERE provider_id = $1`,
            [retiro.provider_id, parseFloat(retiro.monto)]
          );

          // Ledger: evento de retiro fallido (si no existe ya)
          // Buscar el tx_id del DEBITO_RETIRO asociado
          const { rows: txRows } = await client.query(`
            SELECT id FROM wallet_transactions
            WHERE provider_id = $1
              AND tipo = 'DEBITO_RETIRO'
              AND (metadata->>'retiro_id')::uuid = $2
            LIMIT 1
          `, [retiro.provider_id, retiro.id]);

          if (txRows.length > 0) {
            await client.query(
              `INSERT INTO wallet_ledger_events (tx_id, provider_id, evento, detalle)
               VALUES ($1, $2, 'RETIRO_FALLIDO', $3)
               ON CONFLICT DO NOTHING`,
              [txRows[0].id, retiro.provider_id, JSON.stringify({ referencia_wompi: lote.id, estado_wompi: estadoWompi, reabonado: true })]
            );
          }

          console.log(`💸 Retiro ${retiro.id} FALLIDO en Wompi (${estadoWompi}). Saldo RE-ABONADO: $${retiro.monto}`);
        } else {
          // COMPLETADO: asegurar que el ledger tenga el evento
          const { rows: txRows } = await client.query(`
            SELECT id FROM wallet_transactions
            WHERE provider_id = $1
              AND tipo = 'DEBITO_RETIRO'
              AND (metadata->>'retiro_id')::uuid = $2
            LIMIT 1
          `, [retiro.provider_id, retiro.id]);

          if (txRows.length > 0) {
            await client.query(
              `INSERT INTO wallet_ledger_events (tx_id, provider_id, evento, detalle)
               VALUES ($1, $2, 'RETIRO_COMPLETADO', $3)
               ON CONFLICT DO NOTHING`,
              [txRows[0].id, retiro.provider_id, JSON.stringify({ referencia_wompi: lote.id, estado_wompi: estadoWompi })]
            );
          }

          console.log(`✅ Retiro ${retiro.id} CONFIRMADO en Wompi (${estadoWompi}).`);
        }
      } catch (err) {
        console.error(`❌ Error conciliando retiro ${retiro.id}:`, err.message);
        // No hacemos rollback del ciclo: seguimos con los demás retiros
      }
    }

    await client.query('COMMIT');
    console.log('✅ Conciliación de payouts completada.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error en conciliación de payouts:', err);
  } finally {
    client.release();
  }
}
/**
 * Configura los jobs periódicos usando setInterval (simple y sin dependencias).
 * Para producción, usar node-cron o un worker separado.
 */
function inicializarJobs() {
  console.log('⚙️  Iniciando jobs de pagos...');

  // Maduración de saldos: cada 15 minutos
  setInterval(comoSistema(madurarSaldosPendientes), 15 * 60 * 1000);

  // Retiros automáticos: cada día a las 6 AM (verificación cada hora)
  setInterval(async () => {
    const hora = new Date().getHours();
    if (hora === 6) await comoSistema(ejecutarRetirosAutomaticos)();
  }, 60 * 60 * 1000);

  // Conciliación diaria: a las 2 AM
  setInterval(async () => {
    const hora = new Date().getHours();
    if (hora === 2) await comoSistema(conciliacionDiaria)();
  }, 60 * 60 * 1000);

  // Conciliación de payouts (W2): cada 10 minutos
  setInterval(comoSistema(conciliarPayouts), 10 * 60 * 1000);

  // Pricing dinámico: cada día a las 3 AM
  setInterval(async () => {
    const hora = new Date().getHours();
    if (hora === 3) await comoSistema(aplicarPricingDinamico)();
  }, 60 * 60 * 1000);

  // Notificaciones de retención: cada día a las 10 AM
  setInterval(async () => {
    const hora = new Date().getHours();
    if (hora === 10) await comoSistema(enviarNotificacionesRetencion)();
  }, 60 * 60 * 1000);

  // Ejecutar maduración inmediatamente al iniciar
  setTimeout(comoSistema(madurarSaldosPendientes), 5000);
  
  console.log('✅ Jobs de pagos inicializados.');
}

module.exports = {
  inicializarJobs,
  comoSistema,
  // Envueltos igual que en el scheduler: también se exportan, y cualquier otro
  // llamador debe recibir el mismo contexto de sistema.
  madurarSaldosPendientes: comoSistema(madurarSaldosPendientes),
  ejecutarRetirosAutomaticos: comoSistema(ejecutarRetirosAutomaticos),
  conciliacionDiaria: comoSistema(conciliacionDiaria),
  conciliarPayouts: comoSistema(conciliarPayouts)
};
