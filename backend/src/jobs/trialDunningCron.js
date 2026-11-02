// backend/src/jobs/trialDunningCron.js
const { pool } = require('../config/db');
const subscriptionService = require('../services/subscriptionService');
const invoiceService = require('../services/invoiceService');

/**
 * Job diario: trial ending + dunning (cobros fallidos)
 * Se ejecuta cada día a las 06:00 UTC (configurar en cron)
 */
async function runTrialDunningCron() {
  const startTime = Date.now();
  console.log('[trialDunningCron] Iniciando...', new Date().toISOString());

  try {
    let results = {
      trialsEnding: 0,
      trialsEnded: 0,
      dunningSent: 0,
      subscriptionsCanceled: 0,
      errors: []
    };

    // 1. TRIALS: Detectar trials que terminan en 3 días (enviar aviso)
    results.trialsEnding = await notifyTrialsEndingSoon();

    // 2. TRIALS: Detectar trials que terminaron ayer (convertir a FREEMIUM si no pagaron)
    results.trialsEnded = await processExpiredTrials();

    // 3. DUNNING: Facturas pendientes vencidas (reintentar cobro / notificar)
    results.dunningSent = await processDunning();

    // 4. DUNNING: Suscripciones past_due > 14 días (cancelar)
    results.subscriptionsCanceled = await cancelOverdueSubscriptions();

    // Log auditoría
    await pool.query(`
      INSERT INTO audit_logs (actor_id, action, target_type, metadata)
      VALUES (NULL, 'trial_dunning_cron', 'platform', $1)
    `, [JSON.stringify({
      executedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      ...results
    })]);

    console.log('[trialDunningCron] Completado:', results);
    return { success: true, ...results };

  } catch (error) {
    console.error('[trialDunningCron] Error:', error.message);
    
    await pool.query(`
      INSERT INTO audit_logs (actor_id, action, target_type, metadata)
      VALUES (NULL, 'trial_dunning_cron_failed', 'platform', $1)
    `, [JSON.stringify({ error: error.message, executedAt: new Date().toISOString() })]);

    throw error;
  }
}

/**
 * Notifica trials que terminan en 3 días
 */
async function notifyTrialsEndingSoon() {
  const { rows } = await pool.query(`
    SELECT s.*, bp.name as tenant_name, bp.owner_id, u.email as owner_email
    FROM subscriptions s
    JOIN business_profiles bp ON bp.id = s.tenant_id
    LEFT JOIN users u ON u.id = bp.owner_id
    WHERE s.status = 'trialing'
      AND s.trial_end BETWEEN NOW() AND NOW() + INTERVAL '3 days'
      AND NOT EXISTS (
        SELECT 1 FROM audit_logs al 
        WHERE al.action = 'trial_ending_notice' 
          AND al.target_id = s.tenant_id 
          AND al.created_at > NOW() - INTERVAL '1 day'
      )
  `);

  for (const sub of rows) {
    try {
      // TODO: Enviar email real via email.service.js
      console.log(`[trialDunningCron] Trial ending notice para ${sub.tenant_name} (${sub.owner_email}) - termina ${sub.trial_end}`);
      
      // Log para no duplicar
      await pool.query(`
        INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata)
        VALUES (NULL, 'trial_ending_notice', 'tenant', $1, $2)
      `, [sub.tenant_id, JSON.stringify({ trialEnd: sub.trial_end, daysLeft: 3 })]);
    } catch (err) {
      console.error(`[trialDunningCron] Error notificando trial ${sub.tenant_id}:`, err.message);
    }
  }

  return rows.length;
}

/**
 * Procesa trials expirados (pasaron trial_end sin pago)
 */
async function processExpiredTrials() {
  const { rows } = await pool.query(`
    SELECT s.*, bp.name as tenant_name, bp.owner_id, u.email as owner_email
    FROM subscriptions s
    JOIN business_profiles bp ON bp.id = s.tenant_id
    LEFT JOIN users u ON u.id = bp.owner_id
    WHERE s.status = 'trialing'
      AND s.trial_end < NOW()
      AND s.trial_end > NOW() - INTERVAL '7 days'  -- solo últimos 7 días
  `);

  for (const sub of rows) {
    try {
      // Verificar si hubo pago exitoso reciente
      const { rows: paidInvoices } = await pool.query(`
        SELECT 1 FROM invoices 
        WHERE tenant_id = $1 AND status = 'paid' 
          AND paid_at > $2
        LIMIT 1
      `, [sub.tenant_id, sub.trial_end]);

      if (paidInvoices.length > 0) {
        // Hubo pago - la webhook ya debería haber activado la sub
        console.log(`[trialDunningCron] Trial ${sub.tenant_id} ya pagó, saltando`);
        continue;
      }

      // No pagó - bajar a FREEMIUM
      await subscriptionService.cancelSubscription({
        tenantId: sub.tenant_id,
        atPeriodEnd: false
      });

      // Notificar
      console.log(`[trialDunningCron] Trial expirado sin pago: ${sub.tenant_name} → FREEMIUM`);
      
      await pool.query(`
        INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata)
        VALUES (NULL, 'trial_expired_downgraded', 'tenant', $1, $2)
      `, [sub.tenant_id, JSON.stringify({ trialEnd: sub.trial_end, reason: 'no_payment' })]);

    } catch (err) {
      console.error(`[trialDunningCron] Error procesando trial expirado ${sub.tenant_id}:`, err.message);
    }
  }

  return rows.length;
}

/**
 * Procesa dunning: facturas pending vencidas
 */
async function processDunning() {
  const { rows: overdueInvoices } = await pool.query(`
    SELECT i.*, bp.name as tenant_name, bp.owner_id, u.email as owner_email, bp.saas_plan
    FROM invoices i
    JOIN business_profiles bp ON bp.id = i.tenant_id
    LEFT JOIN users u ON u.id = bp.owner_id
    WHERE i.status = 'pending' 
      AND i.due_date < NOW()
      AND i.due_date > NOW() - INTERVAL '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM audit_logs al 
        WHERE al.action = 'dunning_notice' 
          AND al.target_id = i.tenant_id 
          AND al.metadata->>'invoiceId' = i.id::text
          AND al.created_at > NOW() - INTERVAL '3 days'
      )
  `);

  // Agrupar por tenant para enviar un solo email con todas las facturas
  const byTenant = {};
  for (const inv of overdueInvoices) {
    if (!byTenant[inv.tenant_id]) byTenant[inv.tenant_id] = { tenant: inv, invoices: [] };
    byTenant[inv.tenant_id].invoices.push(inv);
  }

  let sent = 0;
  for (const [tenantId, data] of Object.entries(byTenant)) {
    try {
      const { tenant, invoices } = data;
      const totalDue = invoices.reduce((sum, i) => sum + parseFloat(i.total), 0);
      const oldestDue = invoices.reduce((min, i) => new Date(i.due_date) < new Date(min.due_date) ? i : min).due_date;

      // TODO: Enviar email real con detalle de facturas
      console.log(`[trialDunningCron] Dunning notice para ${tenant.tenant_name} (${tenant.owner_email}): ${invoices.length} facturas, $${totalDue.toLocaleString()} COP, más antigua ${oldestDue}`);

      // Log para no duplicar (usar la factura más antigua como referencia)
      await pool.query(`
        INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata)
        VALUES (NULL, 'dunning_notice', 'tenant', $1, $2)
      `, [tenantId, JSON.stringify({ 
        invoiceId: invoices[0].id, 
        invoiceCount: invoices.length, 
        totalDue,
        oldestDueDate: oldestDue
      })]);

      sent++;
    } catch (err) {
      console.error(`[trialDunningCron] Error dunning tenant ${tenantId}:`, err.message);
    }
  }

  return sent;
}

/**
 * Cancela suscripciones past_due > 14 días
 */
async function cancelOverdueSubscriptions() {
  const { rows } = await pool.query(`
    SELECT s.*, bp.name as tenant_name, bp.owner_id, u.email as owner_email
    FROM subscriptions s
    JOIN business_profiles bp ON bp.id = s.tenant_id
    LEFT JOIN users u ON u.id = bp.owner_id
    WHERE s.status = 'past_due'
      AND s.updated_at < NOW() - INTERVAL '14 days'
  `);

  let canceled = 0;
  for (const sub of rows) {
    try {
      await subscriptionService.cancelSubscription({
        tenantId: sub.tenant_id,
        atPeriodEnd: false
      });

      console.log(`[trialDunningCron] Suscripción cancelada por mora >14d: ${sub.tenant_name}`);
      
      await pool.query(`
        INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata)
        VALUES (NULL, 'subscription_canceled_dunning', 'tenant', $1, $2)
      `, [sub.tenant_id, JSON.stringify({ reason: 'past_due_14_days', plan: sub.plan })]);

      canceled++;
    } catch (err) {
      console.error(`[trialDunningCron] Error cancelando sub ${sub.tenant_id}:`, err.message);
    }
  }

  return canceled;
}

// Ejecutar si se llama directamente
if (require.main === module) {
  runTrialDunningCron()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { runTrialDunningCron };