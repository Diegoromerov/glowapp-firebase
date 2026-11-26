/** Reserve one monthly direct-booking quota unit within the booking transaction. */
async function reserveDirectBookingQuota({
  query,
  tenantId,
  delta = 1,
  periodStart,
  periodEnd,
  getLimit,
  countHistorical,
  setTenantContext,
  legacyTenantId = '',
}) {
  const queryRows = async (sql, params = []) => {
    const result = await query(sql, params);
    return Array.isArray(result) ? result : (result?.rows || []);
  };
  // Lock by canonical tenant ID. This serializes the read/check/upsert without
  // requiring UPDATE policy on business_profiles (SELECT FOR UPDATE under RLS
  // can otherwise hide a readable row from the application role).
  await queryRows('SELECT pg_advisory_xact_lock(hashtextextended($1, 73108))', [String(tenantId)]);

  const tenants = await queryRows(
    'SELECT saas_plan, provider_id FROM business_profiles WHERE id = $1',
    [tenantId]
  );
  if (!tenants.length) {
    throw Object.assign(new Error('No se pudo validar el plan SaaS del salón para aplicar su cuota de reservas.'), {
      code: 'SAAS_TENANT_CONTEXT_MISSING',
    });
  }

  const plan = tenants[0].saas_plan || 'FREEMIUM';
  const limit = getLimit(plan, 'DIRECT_BOOKINGS');
  // usage_metrics uses the canonical business-profile ID as its tenant, while
  // bookings/services may still use the legacy integer tenant in this same
  // request. Switch only around metric reads/writes, then restore before the
  // caller creates booking rows.
  if (setTenantContext) await setTenantContext(String(tenantId));
  try {
    let existingUsage = await queryRows(
      `SELECT count FROM usage_metrics
        WHERE tenant_id = $1 AND feature = 'DIRECT_BOOKINGS' AND period_start = $2`,
      [tenantId, periodStart]
    );
    let currentUsage = Number(existingUsage[0]?.count || 0);
    if (!existingUsage.length) {
      if (setTenantContext) await setTenantContext(String(legacyTenantId ?? ''));
      currentUsage = Number(await countHistorical({
        tenantId,
        providerId: tenants[0].provider_id,
        periodStart,
      }) || 0);
      if (setTenantContext) await setTenantContext(String(tenantId));
      // Re-read after the advisory lock and historical scan in canonical
      // context. This also protects against non-cooperating legacy writers.
      existingUsage = await queryRows(
        `SELECT count FROM usage_metrics
          WHERE tenant_id = $1 AND feature = 'DIRECT_BOOKINGS' AND period_start = $2`,
        [tenantId, periodStart]
      );
      if (existingUsage.length) currentUsage = Number(existingUsage[0].count || 0);
    }

    if (limit === 0 || (limit !== null && currentUsage + delta > limit)) {
      throw Object.assign(new Error('límite mensual de reservas alcanzado'), {
        code: 'SAAS_QUOTA_EXCEEDED', feature: 'DIRECT_BOOKINGS', limit,
        current: currentUsage, plan,
      });
    }

    const usageRows = await queryRows(`
    INSERT INTO usage_metrics (tenant_id, feature, period_start, period_end, count, "limit")
    VALUES ($1, 'DIRECT_BOOKINGS', $2, $3, $4, $5)
    ON CONFLICT (tenant_id, feature, period_start)
    DO UPDATE SET
      count = usage_metrics.count + EXCLUDED.count,
      "limit" = EXCLUDED."limit",
      updated_at = NOW()
    WHERE EXCLUDED."limit" IS NULL
       OR usage_metrics.count + EXCLUDED.count <= EXCLUDED."limit"
    RETURNING count`,
    [tenantId, periodStart, periodEnd, existingUsage.length === 0 ? currentUsage + delta : delta, limit]);

    if (!usageRows.length) {
      const currentRows = await queryRows(
        `SELECT count FROM usage_metrics
          WHERE tenant_id = $1 AND feature = 'DIRECT_BOOKINGS' AND period_start = $2`,
        [tenantId, periodStart]
      );
      throw Object.assign(new Error('límite mensual de reservas alcanzado'), {
        code: 'SAAS_QUOTA_EXCEEDED', feature: 'DIRECT_BOOKINGS', limit,
        current: Number(currentRows[0]?.count ?? currentUsage), plan,
      });
    }

    return { plan, limit, current: Number(usageRows[0].count) };
  } finally {
    if (setTenantContext) {
      // Preserve the original failure if PostgreSQL already marked the booking
      // transaction aborted; the caller will roll it back immediately.
      await setTenantContext(String(legacyTenantId ?? '')).catch(() => {});
    }
  }
}

module.exports = { reserveDirectBookingQuota };
