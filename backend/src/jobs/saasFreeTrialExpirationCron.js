// Daily, isolated lifecycle job for FREE_TRIAL tenants provisioned by SaaS.
// Deliberately does not send email, cancel billing, or modify paid plans.
const { pool, systemPool } = require('../config/db');
const { runAsSystem } = require('../config/tenantRouting');

async function expireCompletedFreeTrials(deps = { pool, systemPool }) {
  const tenantId = deps.tenantId ?? null;
  // business_profiles.id is VARCHAR(36), and existing salons use IDs such as
  // "salon-17" alongside UUIDs. Keep the target scope aligned with that schema.
  if (tenantId !== null &&
      (typeof tenantId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(tenantId))) {
    throw new TypeError('tenantId must be a valid business profile id (1-36 safe characters) when provided');
  }
  return runAsSystem(deps, async () => {
    const { rows } = await pool.query(`
      WITH eligible AS (
        SELECT bp.id, bp.saas_plan AS previous_plan, bp.saas_trial_ends_at
        FROM business_profiles bp
        WHERE bp.saas_plan IN ('FREE_TRIAL', 'FREE_TRIAL_LEGACY')
          AND ($1::text IS NULL OR bp.id = $1::text)
          AND bp.saas_trial_ends_at IS NOT NULL
          AND bp.saas_trial_ends_at <= NOW()
          AND NOT EXISTS (
            SELECT 1
            FROM subscriptions s
            WHERE s.tenant_id = bp.id
              -- Solo un plan pago confirmado protege la cuenta del downgrade.
              -- Checkout incompleto, trialing o en mora no equivale a pago.
              AND s.plan IN ('BASIC', 'GROWTH', 'PRO', 'ENTERPRISE')
              AND s.status = 'active'
          )
        FOR UPDATE OF bp
      ), expired AS (
        UPDATE business_profiles bp
        SET saas_plan = 'FREEMIUM', updated_at = NOW()
        FROM eligible e
        WHERE bp.id = e.id
        RETURNING bp.id, bp.name, bp.saas_trial_ends_at, e.previous_plan
      ), updated_salons AS (
        UPDATE salones s
        SET plan_saas = 'FREEMIUM', updated_at = NOW()
        FROM expired e
        WHERE s.business_profile_id = e.id
          AND s.plan_saas IN ('FREE_TRIAL', 'FREE_TRIAL_LEGACY')
        RETURNING s.id, s.business_profile_id
      ), audit AS (
        INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata)
        SELECT NULL, 'saas_free_trial_expired', 'tenant', e.id,
               jsonb_build_object(
                 'previousPlan', e.previous_plan,
                 'newPlan', 'FREEMIUM',
                 'trialEndsAt', e.saas_trial_ends_at,
                 'salonsUpdated', (SELECT COUNT(*) FROM updated_salons us
                                   WHERE us.business_profile_id = e.id)
               )
        FROM expired e
        RETURNING target_id
      )
      SELECT (SELECT COUNT(*)::integer FROM expired) AS expired_tenants,
             (SELECT COUNT(*)::integer FROM updated_salons) AS updated_salons,
             (SELECT COUNT(*)::integer FROM audit) AS audit_events;
    `, [tenantId]);
    return rows[0] || { expired_tenants: 0, updated_salons: 0, audit_events: 0 };
  });
}

async function runSaasFreeTrialExpirationCron({ tenantId = null } = {}) {
  const startedAt = new Date().toISOString();
  console.log('[saasFreeTrialExpirationCron] Started', { startedAt, scope: tenantId || 'all eligible tenants' });
  const result = await expireCompletedFreeTrials({ tenantId });
  console.log('[saasFreeTrialExpirationCron] Completed', {
    ...result,
    completedAt: new Date().toISOString(),
  });
  return { success: true, ...result };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let tenantId = null;
  if (args.length === 1 && args[0].startsWith('--tenant-id=')) {
    tenantId = args[0].slice('--tenant-id='.length);
  } else if (args.length > 0) {
    console.error('Usage: node src/jobs/saasFreeTrialExpirationCron.js [--tenant-id=<business-profile-id>]');
    process.exit(2);
  }

  runSaasFreeTrialExpirationCron({ tenantId })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[saasFreeTrialExpirationCron] Failed', error.message);
      process.exit(1);
    });
}

module.exports = { expireCompletedFreeTrials, runSaasFreeTrialExpirationCron };
