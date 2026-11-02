// =========================================================================
// Two-Sided Loyalty System Nightly Cron Worker
// Handles batch calculations for clients (90-day rolling) and providers (monthly)
// =========================================================================

const { pool } = require('../config/db');

/**
 * Calculates and updates Client loyalty tiers based on a 90-day rolling window of completed bookings.
 * Tiers:
 * - Base Complexion: 0-2 completed bookings
 * - Glow Effect: 3-6 completed bookings
 * - Porcelain Radiance: 7+ completed bookings
 */
async function updateClientLoyaltyTiers() {
  console.log('⏳ Starting client loyalty tier update (90-day rolling window)...');
  const query = `
    INSERT INTO user_loyalty (user_id, tier, updated_at)
    SELECT 
      u.id as user_id,
      CASE 
        WHEN COUNT(b.id) >= 7 THEN 'Porcelain Radiance'::varchar
        WHEN COUNT(b.id) >= 3 THEN 'Glow Effect'::varchar
        ELSE 'Base Complexion'::varchar
      END as tier,
      NOW() as updated_at
    FROM usuarios u
    LEFT JOIN bookings b ON u.id = b.client_id 
      AND b.estado = 'COMPLETADA'
      AND b.scheduled_at >= NOW() - INTERVAL '90 days'
    WHERE u.rol = 'CLIENTE'
    GROUP BY u.id
    ON CONFLICT (user_id) DO UPDATE
    SET tier = EXCLUDED.tier,
        updated_at = NOW();
  `;

  const result = await pool.query(query);
  console.log(`✅ Client loyalty tiers updated. Affected rows: ${result.rowCount}`);
  return result.rowCount;
}

/**
 * Calculates and updates Provider loyalty tiers.
 * Evaluated monthly (runs automatically on Day 1 for the previous month's data,
 * or can be forced for the current/previous period).
 * Tiers:
 * - Creative Edge: baseline / new accounts or Rating < 4.5.
 * - Visage Pro: 12+ completed bookings/mo + Rating > 4.7.
 * - Avant-Garde Elite: 25+ completed bookings/mo + Rating > 4.9 + 0% provider-faulted cancellations.
 * Providers under an active 60-day fraud lockout are forced to 'Creative Edge'.
 * 
 * @param {Date} [startDate] Optional start of the period to evaluate
 * @param {Date} [endDate] Optional end of the period to evaluate (exclusive)
 */
async function updateProviderLoyaltyTiers(startDate, endDate) {
  let startPeriod = startDate;
  let endPeriod = endDate;

  // Default behavior: if no custom dates are provided, check if today is Day 1
  if (!startPeriod || !endPeriod) {
    const today = new Date();
    const isDay1 = today.getDate() === 1;

    // We default to the previous calendar month's evaluation
    startPeriod = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    endPeriod = new Date(today.getFullYear(), today.getMonth(), 1);

    if (!isDay1 && !startDate) {
      console.log('ℹ️ Today is not Day 1 of the month. Provider loyalty updates will be skipped for production.');
      return 0;
    }
  }

  console.log(`⏳ Starting provider loyalty tier update for period: ${startPeriod.toISOString()} to ${endPeriod.toISOString()}...`);

  const query = `
    INSERT INTO provider_loyalty (provider_id, tier, updated_at)
    SELECT 
      p.id as provider_id,
      CASE 
        -- Rule C: Active fraud lockout forces provider to 'Creative Edge'
        WHEN pl.lock_until IS NOT NULL AND pl.lock_until > NOW() THEN 'Creative Edge'::varchar
        
        -- Rule B3: Avant-Garde Elite (25+ completed bookings AND rating > 4.9 AND 0% provider-faulted cancellations)
        WHEN COUNT(b.id) FILTER (WHERE b.estado = 'COMPLETADA') >= 25 
             AND p.rating_avg > 4.9 
             AND COUNT(b.id) FILTER (WHERE b.estado = 'CANCELADA' AND b.provider_faulted_cancellation = TRUE) = 0 THEN 'Avant-Garde Elite'::varchar
             
        -- Rule B2: Visage Pro (12+ completed bookings AND rating > 4.7)
        WHEN COUNT(b.id) FILTER (WHERE b.estado = 'COMPLETADA') >= 12 
             AND p.rating_avg > 4.7 THEN 'Visage Pro'::varchar
             
        -- Rule B1: Creative Edge (Default / Baseline)
        ELSE 'Creative Edge'::varchar
      END as tier,
      NOW() as updated_at
    FROM perfiles_prestador p
    LEFT JOIN provider_loyalty pl ON p.id = pl.provider_id
    LEFT JOIN bookings b ON p.id = b.provider_id 
      AND b.scheduled_at >= $1::timestamptz
      AND b.scheduled_at < $2::timestamptz
    GROUP BY p.id, p.rating_avg, pl.lock_until
    ON CONFLICT (provider_id) DO UPDATE
    SET tier = EXCLUDED.tier,
        updated_at = NOW();
  `;

  const result = await pool.query(query, [startPeriod, endPeriod]);
  console.log(`✅ Provider loyalty tiers updated. Affected rows: ${result.rowCount}`);
  return result.rowCount;
}

/**
 * Main nightly cron task that coordinates loyalty and anti-circumvention maintenance.
 * Designed to be executed by a job scheduler (e.g. node-cron, systemd, or pg_cron).
 */
async function runNightlyLoyaltyCron() {
  console.log('🚀 [LOYALTY CRON] Initiating nightly loyalty evaluations...');
  const clientStart = Date.now();
  
  try {
    // 1. Process client tiers (rolling 90 days)
    const clientsUpdated = await updateClientLoyaltyTiers();

    // 2. Process provider tiers (runs conditionally if Day 1 or if force/custom period specified)
    const providersUpdated = await updateProviderLoyaltyTiers();

    console.log(`🎉 [LOYALTY CRON] Completed successfully. Client rows: ${clientsUpdated}, Provider rows: ${providersUpdated} in ${Date.now() - clientStart}ms.`);
  } catch (error) {
    console.error('❌ [LOYALTY CRON] Execution failed:', error);
    throw error;
  }
}

module.exports = {
  updateClientLoyaltyTiers,
  updateProviderLoyaltyTiers,
  runNightlyLoyaltyCron
};
