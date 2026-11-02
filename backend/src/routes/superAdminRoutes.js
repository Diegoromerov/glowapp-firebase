// backend/src/routes/superAdminRoutes.js
const express = require('express');
const { pool } = require('../config/db');
const superAdminGuard = require('../middleware/superAdminGuard');
const { authMiddleware } = require('../middleware/auth');
const subscriptionService = require('../services/subscriptionService');
const invoiceService = require('../services/invoiceService');
const usageMeteringService = require('../services/usageMeteringService');

const router = express.Router();

// Todos los endpoints requieren auth + superAdmin
router.use(authMiddleware);
router.use(superAdminGuard);

/**
 * GET /api/superadmin/dashboard
 * Resumen ejecutivo de la plataforma
 */
router.get('/dashboard', async (req, res) => {
  try {
    // Métricas generales
    const [
      tenantsTotal,
      tenantsActive,
      subscriptionsActive,
      revenueMRR,
      revenueARR,
      churnRate,
      trialsActive,
      trialsEndingSoon
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*) as count FROM business_profiles`),
      pool.query(`SELECT COUNT(*) as count FROM business_profiles WHERE saas_plan != 'FREEMIUM'`),
      pool.query(`SELECT COUNT(*) as count FROM subscriptions WHERE status = 'active'`),
      pool.query(`
        SELECT COALESCE(SUM(
          CASE 
            WHEN s.plan = 'BASIC' THEN 99000
            WHEN s.plan = 'PRO' THEN 249000
            WHEN s.plan = 'ENTERPRISE' THEN 599000
            ELSE 0
          END
        ), 0) as mrr
        FROM subscriptions s
        WHERE s.status = 'active' AND s.currency = 'COP'
      `),
      pool.query(`
        SELECT COALESCE(SUM(
          CASE 
            WHEN s.plan = 'BASIC' THEN 99000 * 12
            WHEN s.plan = 'PRO' THEN 249000 * 12
            WHEN s.plan = 'ENTERPRISE' THEN 599000 * 12
            ELSE 0
          END
        ), 0) as arr
        FROM subscriptions s
        WHERE s.status = 'active' AND s.currency = 'COP'
      `),
      pool.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'canceled' AND canceled_at >= NOW() - INTERVAL '30 days') as canceled_30d,
          COUNT(*) FILTER (WHERE status = 'active') as active_now
        FROM subscriptions
      `),
      pool.query(`SELECT COUNT(*) as count FROM subscriptions WHERE status = 'trialing'`),
      pool.query(`
        SELECT COUNT(*) as count FROM subscriptions 
        WHERE status = 'trialing' AND trial_end BETWEEN NOW() AND NOW() + INTERVAL '7 days'
      `)
    ]);

    const activeNow = parseInt(subscriptionsActive.rows[0].count);
    const canceled30d = parseInt(revenueMRR.rows[0]?.canceled_30d || 0);
    const churn = activeNow > 0 ? ((canceled30d / (activeNow + canceled30d)) * 100).toFixed(1) : 0;

    // Distribución por plan
    const planDist = await pool.query(`
      SELECT saas_plan, COUNT(*) as count
      FROM business_profiles
      GROUP BY saas_plan
      ORDER BY count DESC;
    `);

    // Top tenants por uso (API calls)
    const topUsage = await pool.query(`
      SELECT bp.id, bp.name, bp.saas_plan, um.count as api_calls
      FROM usage_metrics um
      JOIN business_profiles bp ON bp.id = um.tenant_id
      WHERE um.feature = 'API_CALLS' AND um.period_start = date_trunc('month', CURRENT_DATE)::date
      ORDER BY um.count DESC
      LIMIT 10;
    `);

    res.json({
      summary: {
        totalTenants: parseInt(tenantsTotal.rows[0].count),
        activeTenants: parseInt(tenantsActive.rows[0].count),
        activeSubscriptions: activeNow,
        mrrCOP: parseInt(revenueMRR.rows[0].mrr),
        arrCOP: parseInt(revenueARR.rows[0].arr),
        churnRate30d: parseFloat(churn),
        trialsActive: parseInt(trialsActive.rows[0].count),
        trialsEndingSoon: parseInt(trialsEndingSoon.rows[0].count)
      },
      planDistribution: planDist.rows.map(r => ({ plan: r.saas_plan, count: parseInt(r.count) })),
      topApiUsage: topUsage.rows
    });
  } catch (error) {
    console.error('[superAdminRoutes] Error dashboard:', error.message);
    res.status(500).json({ error: 'Error obteniendo dashboard' });
  }
});

/**
 * GET /api/superadmin/tenants
 * Lista paginada de tenants con filtros
 */
router.get('/tenants', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      plan,
      status,
      search,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const validSort = ['created_at', 'name', 'saas_plan', 'updated_at'];
    const validOrder = ['ASC', 'DESC'];
    const sortColumn = validSort.includes(sortBy) ? sortBy : 'created_at';
    const sortDir = validOrder.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';

    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIdx = 1;

    if (plan) {
      whereClause += ` AND bp.saas_plan = $${paramIdx++}`;
      params.push(plan);
    }
    if (status === 'active') {
      whereClause += ` AND bp.saas_plan != 'FREEMIUM'`;
    } else if (status === 'trial') {
      whereClause += ` AND bp.saas_plan = 'FREE_TRIAL'`;
    } else if (status === 'freemium') {
      whereClause += ` AND bp.saas_plan = 'FREEMIUM'`;
    }
    if (search) {
      whereClause += ` AND (bp.name ILIKE $${paramIdx} OR bp.id::text ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    // Query principal con subqueries para métricas
    const query = `
      SELECT 
        bp.id, bp.name, bp.saas_plan, bp.provider_id AS owner_id, bp.created_at, bp.updated_at,
        u.email as owner_email,
        s.status as sub_status, s.plan as sub_plan, s.current_period_end,
        (SELECT COUNT(*) FROM memberships m WHERE m.business_profile_id = bp.id AND m.status = 'ACTIVE') as team_size,
        (SELECT COUNT(*) FROM usage_metrics um WHERE um.tenant_id = bp.id AND um.feature = 'API_CALLS' AND um.period_start = date_trunc('month', CURRENT_DATE)::date) as api_calls_this_month
      FROM business_profiles bp
      LEFT JOIN usuarios u ON u.id = bp.provider_id
      LEFT JOIN subscriptions s ON s.tenant_id = bp.id AND s.status IN ('active', 'trialing', 'past_due')
      ${whereClause}
      ORDER BY bp.${sortColumn} ${sortDir}
      LIMIT $${paramIdx++} OFFSET $${paramIdx};
    `;

    params.push(parseInt(limit), offset);

    const { rows: tenants } = await pool.query(query, params);

    // Total count
    const countQuery = `SELECT COUNT(*) FROM business_profiles bp ${whereClause}`;
    const { rows: countResult } = await pool.query(countQuery, params.slice(0, -2));
    const total = parseInt(countResult[0].count);

    res.json({
      tenants: tenants.map(t => ({
        id: t.id,
        name: t.name,
        plan: t.saas_plan,
        owner: { id: t.owner_id, email: t.owner_email },
        subscription: t.sub_status ? {
          status: t.sub_status,
          plan: t.sub_plan,
          periodEnd: t.current_period_end
        } : null,
        teamSize: parseInt(t.team_size),
        apiCallsThisMonth: parseInt(t.api_calls_this_month || 0),
        createdAt: t.created_at,
        updatedAt: t.updated_at
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('[superAdminRoutes] Error listing tenants:', error.message);
    res.status(500).json({ error: 'Error listando tenants' });
  }
});

/**
 * GET /api/superadmin/tenants/:tenantId
 * Detalle completo de un tenant
 */
router.get('/tenants/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;

    const [tenant, memberships, subscription, invoices, usage, apiKeys] = await Promise.all([
      pool.query(`
        SELECT bp.*, u.email as owner_email, u.full_name as owner_name
        FROM business_profiles bp
        LEFT JOIN usuarios u ON u.id = bp.provider_id
        WHERE bp.id = $1
      `, [tenantId]),
      pool.query(`
        SELECT m.*, u.email, u.full_name
        FROM memberships m
        JOIN usuarios u ON u.id = m.user_id
        WHERE m.business_profile_id = $1
        ORDER BY 
          CASE m.role WHEN 'OWNER' THEN 1 WHEN 'ADMIN' THEN 2 WHEN 'MANAGER' THEN 3 ELSE 4 END,
          m.accepted_at DESC NULLS LAST
      `, [tenantId]),
      pool.query(`SELECT * FROM subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId]),
      invoiceService.getInvoicesByTenant(tenantId, { limit: 20 }),
      pool.query(`
        SELECT feature, count, limit, period_start, period_end
        FROM usage_metrics
        WHERE tenant_id = $1 AND period_start >= date_trunc('month', CURRENT_DATE)::date - INTERVAL '6 months'
        ORDER BY period_start DESC, feature
      `, [tenantId]),
      pool.query(`
        SELECT id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at
        FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC
      `, [tenantId])
    ]);

    if (tenant.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant no encontrado' });
    }

    const t = tenant.rows[0];

    // Agrupar uso por mes
    const usageByMonth = {};
    usage.rows.forEach(u => {
      const key = u.period_start;
      if (!usageByMonth[key]) usageByMonth[key] = { periodStart: key, periodEnd: u.period_end, features: {} };
      usageByMonth[key].features[u.feature] = { count: u.count, limit: u.limit };
    });

    res.json({
      tenant: {
        id: t.id,
        name: t.name,
        plan: t.saas_plan,
        owner: { id: t.owner_id, email: t.owner_email, name: t.owner_name },
        settings: t.metadata || {},
        createdAt: t.created_at,
        updatedAt: t.updated_at
      },
      memberships: memberships.rows.map(m => ({
        id: m.id,
        userId: m.user_id,
        email: m.email,
        name: m.full_name,
        role: m.role,
        status: m.status,
        invitedAt: m.invited_at,
        acceptedAt: m.accepted_at
      })),
      subscriptions: subscription.rows.map(s => ({
        id: s.id,
        plan: s.plan,
        status: s.status,
        currency: s.currency || 'COP',
        periodStart: s.current_period_start,
        periodEnd: s.current_period_end,
        trialEnd: s.trial_end,
        cancelAtPeriodEnd: s.cancel_at_period_end,
        stripeSubscriptionId: s.stripe_subscription_id,
        wompiSubscriptionId: s.wompi_subscription_id,
        createdAt: s.created_at
      })),
      invoices: invoices.map(inv => ({
        id: inv.id,
        number: inv.invoice_number,
        status: inv.status,
        total: inv.total,
        currency: inv.currency,
        periodStart: inv.period_start,
        periodEnd: inv.period_end,
        dueDate: inv.due_date,
        paidAt: inv.paid_at
      })),
      usage: Object.values(usageByMonth).sort((a, b) => b.periodStart.localeCompare(a.periodStart)),
      apiKeys: apiKeys.rows.map(k => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.key_prefix,
        scopes: k.scopes,
        lastUsedAt: k.last_used_at,
        expiresAt: k.expires_at,
        revokedAt: k.revoked_at,
        isActive: !k.revoked_at && (!k.expires_at || new Date(k.expires_at) > new Date()),
        createdAt: k.created_at
      }))
    });
  } catch (error) {
    console.error('[superAdminRoutes] Error getting tenant:', error.message);
    res.status(500).json({ error: 'Error obteniendo tenant' });
  }
});

/**
 * PATCH /api/superadmin/tenants/:tenantId/plan
 * Cambia plan de un tenant (override manual)
 */
router.patch('/tenants/:tenantId/plan', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { plan, reason } = req.body;

    const validPlans = ['FREE_TRIAL', 'FREEMIUM', 'BASIC', 'PRO', 'ENTERPRISE'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido', validPlans });
    }

    // Actualizar business_profiles
    await pool.query(
      `UPDATE business_profiles SET saas_plan = $1, updated_at = NOW() WHERE id = $2`,
      [plan, tenantId]
    );

    // Actualizar subscription si existe
    await pool.query(
      `UPDATE subscriptions SET plan = $1, updated_at = NOW(), metadata = metadata || $2::jsonb WHERE tenant_id = $3`,
      [plan, JSON.stringify({ manualOverride: true, reason, changedBy: req.user.id, changedAt: new Date().toISOString() }), tenantId]
    );

    // Log de auditoría
    await pool.query(`
      INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata)
      VALUES ($1, 'plan_change', 'tenant', $2, $3)
    `, [req.user.id, tenantId, JSON.stringify({ newPlan: plan, reason })]);

    res.json({ message: 'Plan actualizado', tenantId, newPlan: plan });
  } catch (error) {
    console.error('[superAdminRoutes] Error changing tenant plan:', error.message);
    res.status(500).json({ error: 'Error cambiando plan' });
  }
});

/**
 * POST /api/superadmin/tenants/:tenantId/suspend
 * Suspende tenant (baja a FREEMIUM, cancela sub)
 */
router.post('/tenants/:tenantId/suspend', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { reason } = req.body;

    await pool.query(
      `UPDATE business_profiles SET saas_plan = 'FREEMIUM', updated_at = NOW() WHERE id = $1`,
      [tenantId]
    );

    await pool.query(
      `UPDATE subscriptions SET status = 'canceled', canceled_at = NOW(), updated_at = NOW() WHERE tenant_id = $1`,
      [tenantId]
    );

    await pool.query(`
      INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata)
      VALUES ($1, 'tenant_suspend', 'tenant', $2, $3)
    `, [req.user.id, tenantId, JSON.stringify({ reason })]);

    res.json({ message: 'Tenant suspendido', tenantId });
  } catch (error) {
    console.error('[superAdminRoutes] Error suspending tenant:', error.message);
    res.status(500).json({ error: 'Error suspendiendo tenant' });
  }
});

/**
 * GET /api/superadmin/revenue
 * Métricas de revenue detalladas
 */
router.get('/revenue', async (req, res) => {
  try {
    const { months = 12 } = req.query;
    const m = Math.min(parseInt(months), 24);

    // MRR histórico por mes
    const mrrHistory = await pool.query(`
      SELECT 
        date_trunc('month', i.paid_at)::date as month,
        COUNT(DISTINCT i.tenant_id) as paying_tenants,
        SUM(i.total) as revenue
      FROM invoices i
      WHERE i.status = 'paid' 
        AND i.paid_at >= date_trunc('month', CURRENT_DATE) - INTERVAL '${m} months'
      GROUP BY date_trunc('month', i.paid_at)
      ORDER BY month DESC;
    `);

    // Revenue por plan
    const revenueByPlan = await pool.query(`
      SELECT 
        bp.saas_plan,
        COUNT(DISTINCT bp.id) as tenants,
        COALESCE(SUM(i.total), 0) as revenue
      FROM business_profiles bp
      LEFT JOIN invoices i ON i.tenant_id = bp.id AND i.status = 'paid' 
        AND i.paid_at >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
      GROUP BY bp.saas_plan
      ORDER BY revenue DESC;
    `);

    // Facturas pendientes
    const pendingInvoices = await pool.query(`
      SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as amount
      FROM invoices
      WHERE status = 'pending' AND due_date < NOW();
    `);

    res.json({
      mrrHistory: mrrHistory.rows.map(r => ({
        month: r.month,
        payingTenants: parseInt(r.paying_tenants),
        revenueCOP: parseFloat(r.revenue)
      })),
      revenueByPlan: revenueByPlan.rows.map(r => ({
        plan: r.saas_plan,
        tenants: parseInt(r.tenants),
        revenueCOP: parseFloat(r.revenue)
      })),
      pendingInvoices: {
        count: parseInt(pendingInvoices.rows[0].count),
        amountCOP: parseFloat(pendingInvoices.rows[0].amount)
      }
    });
  } catch (error) {
    console.error('[superAdminRoutes] Error revenue:', error.message);
    res.status(500).json({ error: 'Error obteniendo revenue' });
  }
});

/**
 * GET /api/superadmin/usage
 * Métricas de uso agregadas cross-tenant
 */
router.get('/usage', async (req, res) => {
  try {
    const { feature, months = 6 } = req.query;
    const m = Math.min(parseInt(months), 12);

    let whereFeature = '';
    const params = [m];
    if (feature) {
      whereFeature = 'AND um.feature = $2';
      params.push(feature);
    }

    // Uso agregado por feature por mes
    const aggUsage = await pool.query(`
      SELECT 
        um.feature,
        date_trunc('month', um.period_start)::date as month,
        SUM(um.count) as total_count,
        COUNT(DISTINCT um.tenant_id) as active_tenants,
        AVG(um.count)::numeric(10,2) as avg_per_tenant,
        MAX(um.count) as max_count
      FROM usage_metrics um
      WHERE um.period_start >= date_trunc('month', CURRENT_DATE) - INTERVAL '${m} months'
      ${whereFeature}
      GROUP BY um.feature, date_trunc('month', um.period_start)
      ORDER BY month DESC, um.feature;
    `, params);

    // Features con límites excedidos (mes actual)
    const exceeded = await pool.query(`
      SELECT um.tenant_id, bp.name, um.feature, um.count, um.limit, bp.saas_plan
      FROM usage_metrics um
      JOIN business_profiles bp ON bp.id = um.tenant_id
      WHERE um.period_start = date_trunc('month', CURRENT_DATE)::date
        AND um.limit IS NOT NULL
        AND um.count > um.limit
      ORDER BY (um.count::numeric / um.limit) DESC;
    `);

    res.json({
      aggregated: aggUsage.rows.map(r => ({
        feature: r.feature,
        month: r.month,
        totalCount: parseInt(r.total_count),
        activeTenants: parseInt(r.active_tenants),
        avgPerTenant: parseFloat(r.avg_per_tenant),
        maxCount: parseInt(r.max_count)
      })),
      exceededLimits: exceeded.rows.map(r => ({
        tenantId: r.tenant_id,
        tenantName: r.name,
        plan: r.saas_plan,
        feature: r.feature,
        count: r.count,
        limit: r.limit,
        overagePercent: Math.round(((r.count - r.limit) / r.limit) * 100)
      }))
    });
  } catch (error) {
    console.error('[superAdminRoutes] Error usage:', error.message);
    res.status(500).json({ error: 'Error obteniendo métricas de uso' });
  }
});

/**
 * GET /api/superadmin/webhooks
 * Log de webhooks procesados (debugging)
 */
router.get('/webhooks', async (req, res) => {
  try {
    const { provider, limit = 100, offset = 0 } = req.query;

    let where = 'WHERE 1=1';
    const params = [];
    let paramIdx = 1;

    if (provider) {
      where += ` AND provider = $${paramIdx++}`;
      params.push(provider);
    }

    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await pool.query(`
      SELECT provider, event_id, event_type, payload_hash, result, error_message, created_at
      FROM webhook_events
      ${where}
      ORDER BY created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx};
    `, params);

    res.json({
      webhooks: rows.map(w => ({
        provider: w.provider,
        eventId: w.event_id,
        eventType: w.event_type,
        hash: w.payload_hash,
        success: !!w.result && !w.error_message,
        error: w.error_message,
        createdAt: w.created_at
      }))
    });
  } catch (error) {
    console.error('[superAdminRoutes] Error webhooks:', error.message);
    res.status(500).json({ error: 'Error obteniendo webhooks' });
  }
});

/**
 * GET /api/superadmin/health
 * Health check de la plataforma (para monitoring externo)
 */
router.get('/health', async (req, res) => {
  try {
    const checks = await Promise.allSettled([
      pool.query('SELECT 1'), // DB
      pool.query(`SELECT COUNT(*) FROM business_profiles`),
      pool.query(`SELECT COUNT(*) FROM subscriptions WHERE status = 'active'`),
      pool.query(`SELECT COUNT(*) FROM invoices WHERE status = 'pending' AND due_date < NOW()`)
    ]);

    const dbOk = checks[0].status === 'fulfilled';
    const tenants = dbOk ? parseInt(checks[1].value.rows[0].count) : 0;
    const activeSubs = dbOk ? parseInt(checks[2].value.rows[0].count) : 0;
    const overdueInvoices = dbOk ? parseInt(checks[3].value.rows[0].count) : 0;

    const healthy = dbOk && overdueInvoices < 100; // umbral arbitrario

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        database: dbOk ? 'ok' : 'fail',
        tenants,
        activeSubscriptions: activeSubs,
        overdueInvoices
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * GET /api/superadmin/audit-logs
 * Logs de auditoría (últimas acciones admin)
 */
router.get('/audit-logs', async (req, res) => {
  try {
    const { limit = 100, offset = 0, action, targetType } = req.query;

    let where = 'WHERE 1=1';
    const params = [];
    let paramIdx = 1;

    if (action) {
      where += ` AND action = $${paramIdx++}`;
      params.push(action);
    }
    if (targetType) {
      where += ` AND target_type = $${paramIdx++}`;
      params.push(targetType);
    }

    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await pool.query(`
      SELECT al.*, u.email as actor_email
      FROM audit_logs al
      LEFT JOIN usuarios u ON u.id = al.actor_id
      ${where}
      ORDER BY al.created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx};
    `, params);

    res.json({
      logs: rows.map(l => ({
        id: l.id,
        actor: { id: l.actor_id, email: l.actor_email },
        action: l.action,
        target: { type: l.target_type, id: l.target_id },
        metadata: l.metadata,
        createdAt: l.created_at
      }))
    });
  } catch (error) {
    console.error('[superAdminRoutes] Error audit logs:', error.message);
    res.status(500).json({ error: 'Error obteniendo logs de auditoría' });
  }
});

module.exports = router;