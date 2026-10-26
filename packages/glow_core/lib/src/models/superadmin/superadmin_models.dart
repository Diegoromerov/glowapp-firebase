// lib/models/superadmin/superadmin_models.dart
/// MODELOS DEL DASHBOARD SUPERADMIN
/// Reflejan exactamente lo que devuelve `backend/src/routes/superAdminRoutes.js`.
/// El parseo es tolerante (snake_case y camelCase, numéricos como string) porque
/// los agregados de PostgreSQL llegan como texto en varias columnas.
library superadmin_models;

int _asInt(dynamic v, [int fallback = 0]) {
  if (v == null) return fallback;
  if (v is int) return v;
  if (v is num) return v.toInt();
  return int.tryParse(v.toString()) ?? fallback;
}

double _asDouble(dynamic v, [double fallback = 0]) {
  if (v == null) return fallback;
  if (v is num) return v.toDouble();
  return double.tryParse(v.toString()) ?? fallback;
}

String _asString(dynamic v, [String fallback = '']) =>
    v == null ? fallback : v.toString();

DateTime? _asDate(dynamic v) {
  if (v == null) return null;
  return DateTime.tryParse(v.toString());
}

/// Formato de moneda colombiana sin decimales: $ 1.234.000 COP
String formatCop(num value, {bool withSuffix = true}) {
  final rounded = value.round();
  final digits = rounded.abs().toString();
  final buffer = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write('.');
    buffer.write(digits[i]);
  }
  final sign = rounded < 0 ? '-' : '';
  return '\$ $sign$buffer${withSuffix ? ' COP' : ''}';
}

// ════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════

class DashboardSummary {
  final int totalTenants;
  final int activeTenants;
  final int activeSubscriptions;
  final int mrrCop;
  final int arrCop;
  final double churnRate30d;
  final int trialsActive;
  final int trialsEndingSoon;

  const DashboardSummary({
    required this.totalTenants,
    required this.activeTenants,
    required this.activeSubscriptions,
    required this.mrrCop,
    required this.arrCop,
    required this.churnRate30d,
    required this.trialsActive,
    required this.trialsEndingSoon,
  });

  factory DashboardSummary.fromJson(Map<String, dynamic> j) => DashboardSummary(
        totalTenants: _asInt(j['totalTenants']),
        activeTenants: _asInt(j['activeTenants']),
        activeSubscriptions: _asInt(j['activeSubscriptions']),
        mrrCop: _asInt(j['mrrCOP'] ?? j['mrrCop']),
        arrCop: _asInt(j['arrCOP'] ?? j['arrCop']),
        churnRate30d: _asDouble(j['churnRate30d']),
        trialsActive: _asInt(j['trialsActive']),
        trialsEndingSoon: _asInt(j['trialsEndingSoon']),
      );

  /// Porcentaje de tenants con plan de pago sobre el total.
  double get payingShare => totalTenants == 0 ? 0 : activeTenants / totalTenants;
}

class PlanCount {
  final String plan;
  final int count;

  const PlanCount({required this.plan, required this.count});

  factory PlanCount.fromJson(Map<String, dynamic> j) =>
      PlanCount(plan: _asString(j['plan'], 'DESCONOCIDO'), count: _asInt(j['count']));
}

class TopUsageRow {
  final String tenantId;
  final String tenantName;
  final int count;

  const TopUsageRow({required this.tenantId, required this.tenantName, required this.count});

  factory TopUsageRow.fromJson(Map<String, dynamic> j) => TopUsageRow(
        tenantId: _asString(j['tenant_id'] ?? j['tenantId']),
        tenantName: _asString(j['name'] ?? j['tenant_name'] ?? j['tenantName'], 'Sin nombre'),
        count: _asInt(j['count']),
      );
}

class SuperAdminDashboard {
  final DashboardSummary summary;
  final List<PlanCount> planDistribution;
  final List<TopUsageRow> topApiUsage;

  const SuperAdminDashboard({
    required this.summary,
    required this.planDistribution,
    required this.topApiUsage,
  });

  factory SuperAdminDashboard.fromJson(Map<String, dynamic> j) => SuperAdminDashboard(
        summary: DashboardSummary.fromJson(
            (j['summary'] as Map<String, dynamic>?) ?? const {}),
        planDistribution: ((j['planDistribution'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(PlanCount.fromJson)
            .toList(),
        topApiUsage: ((j['topApiUsage'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(TopUsageRow.fromJson)
            .toList(),
      );
}

// ════════════════════════════════════════════════════════════════
// TENANTS
// ════════════════════════════════════════════════════════════════

class TenantSubscription {
  final String status;
  final String plan;
  final DateTime? periodEnd;

  const TenantSubscription({required this.status, required this.plan, this.periodEnd});

  bool get isActive => status == 'active' || status == 'trialing';

  factory TenantSubscription.fromJson(Map<String, dynamic> j) => TenantSubscription(
        status: _asString(j['status'], 'unknown'),
        plan: _asString(j['plan'], 'desconocido'),
        periodEnd: _asDate(j['periodEnd'] ?? j['current_period_end']),
      );
}

class TenantSummary {
  final String id;
  final String name;
  final String plan;
  final String ownerEmail;
  final TenantSubscription? subscription;
  final int teamSize;
  final int apiCallsThisMonth;
  final DateTime? createdAt;

  const TenantSummary({
    required this.id,
    required this.name,
    required this.plan,
    required this.ownerEmail,
    required this.subscription,
    required this.teamSize,
    required this.apiCallsThisMonth,
    required this.createdAt,
  });

  /// Sin suscripción activa el tenant está en trial o suspendido: se muestra como tal.
  String get statusLabel {
    if (subscription == null) return 'SIN SUSCRIPCIÓN';
    return subscription!.status.toUpperCase();
  }

  factory TenantSummary.fromJson(Map<String, dynamic> j) {
    final owner = j['owner'];
    final sub = j['subscription'];
    return TenantSummary(
      id: _asString(j['id']),
      name: _asString(j['name'], 'Sin nombre'),
      plan: _asString(j['plan'], 'FREE_TRIAL'),
      ownerEmail: owner is Map ? _asString(owner['email'], '—') : '—',
      subscription: sub is Map<String, dynamic> ? TenantSubscription.fromJson(sub) : null,
      teamSize: _asInt(j['teamSize'] ?? j['team_size']),
      apiCallsThisMonth: _asInt(j['apiCallsThisMonth'] ?? j['api_calls_this_month']),
      createdAt: _asDate(j['createdAt'] ?? j['created_at']),
    );
  }
}

class TenantPage {
  final List<TenantSummary> tenants;
  final int page;
  final int total;
  final int totalPages;

  const TenantPage({
    required this.tenants,
    required this.page,
    required this.total,
    required this.totalPages,
  });

  factory TenantPage.fromJson(Map<String, dynamic> j) {
    final pagination = (j['pagination'] as Map<String, dynamic>?) ?? const {};
    return TenantPage(
      tenants: ((j['tenants'] as List?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(TenantSummary.fromJson)
          .toList(),
      page: _asInt(pagination['page'], 1),
      total: _asInt(pagination['total']),
      totalPages: _asInt(pagination['totalPages'], 1),
    );
  }
}

// ════════════════════════════════════════════════════════════════
// INGRESOS
// ════════════════════════════════════════════════════════════════

class MrrPoint {
  final String month;
  final int payingTenants;
  final double revenueCop;

  const MrrPoint({required this.month, required this.payingTenants, required this.revenueCop});

  factory MrrPoint.fromJson(Map<String, dynamic> j) => MrrPoint(
        month: _asString(j['month']),
        payingTenants: _asInt(j['payingTenants']),
        revenueCop: _asDouble(j['revenueCOP'] ?? j['revenueCop']),
      );
}

class PlanRevenue {
  final String plan;
  final int tenants;
  final double revenueCop;

  const PlanRevenue({required this.plan, required this.tenants, required this.revenueCop});

  factory PlanRevenue.fromJson(Map<String, dynamic> j) => PlanRevenue(
        plan: _asString(j['plan'], 'DESCONOCIDO'),
        tenants: _asInt(j['tenants']),
        revenueCop: _asDouble(j['revenueCOP'] ?? j['revenueCop']),
      );
}

class RevenueSnapshot {
  final List<MrrPoint> mrrHistory;
  final List<PlanRevenue> revenueByPlan;
  final int pendingCount;
  final double pendingAmountCop;

  const RevenueSnapshot({
    required this.mrrHistory,
    required this.revenueByPlan,
    required this.pendingCount,
    required this.pendingAmountCop,
  });

  factory RevenueSnapshot.fromJson(Map<String, dynamic> j) {
    final pending = (j['pendingInvoices'] as Map<String, dynamic>?) ?? const {};
    return RevenueSnapshot(
      mrrHistory: ((j['mrrHistory'] as List?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(MrrPoint.fromJson)
          .toList(),
      revenueByPlan: ((j['revenueByPlan'] as List?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(PlanRevenue.fromJson)
          .toList(),
      pendingCount: _asInt(pending['count']),
      pendingAmountCop: _asDouble(pending['amountCOP'] ?? pending['amountCop']),
    );
  }
}

// ════════════════════════════════════════════════════════════════
// USO
// ════════════════════════════════════════════════════════════════

class UsageAggregate {
  final String feature;
  final String month;
  final int totalCount;
  final int activeTenants;
  final double avgPerTenant;
  final int maxCount;

  const UsageAggregate({
    required this.feature,
    required this.month,
    required this.totalCount,
    required this.activeTenants,
    required this.avgPerTenant,
    required this.maxCount,
  });

  factory UsageAggregate.fromJson(Map<String, dynamic> j) => UsageAggregate(
        feature: _asString(j['feature']),
        month: _asString(j['month']),
        totalCount: _asInt(j['totalCount']),
        activeTenants: _asInt(j['activeTenants']),
        avgPerTenant: _asDouble(j['avgPerTenant']),
        maxCount: _asInt(j['maxCount']),
      );
}

class ExceededLimit {
  final String tenantId;
  final String tenantName;
  final String plan;
  final String feature;
  final int count;
  final int limit;
  final int overagePercent;

  const ExceededLimit({
    required this.tenantId,
    required this.tenantName,
    required this.plan,
    required this.feature,
    required this.count,
    required this.limit,
    required this.overagePercent,
  });

  factory ExceededLimit.fromJson(Map<String, dynamic> j) => ExceededLimit(
        tenantId: _asString(j['tenantId'] ?? j['tenant_id']),
        tenantName: _asString(j['tenantName'] ?? j['tenant_name'], 'Sin nombre'),
        plan: _asString(j['plan'], '—'),
        feature: _asString(j['feature']),
        count: _asInt(j['count']),
        limit: _asInt(j['limit']),
        overagePercent: _asInt(j['overagePercent']),
      );
}

class UsageSnapshot {
  final List<UsageAggregate> aggregated;
  final List<ExceededLimit> exceededLimits;

  const UsageSnapshot({required this.aggregated, required this.exceededLimits});

  factory UsageSnapshot.fromJson(Map<String, dynamic> j) => UsageSnapshot(
        aggregated: ((j['aggregated'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(UsageAggregate.fromJson)
            .toList(),
        exceededLimits: ((j['exceededLimits'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(ExceededLimit.fromJson)
            .toList(),
      );
}

/// Planes que el backend acepta en `PATCH /tenants/:id/plan`.
const List<String> kSuperAdminPlans = ['FREE_TRIAL', 'FREEMIUM', 'BASIC', 'PRO', 'ENTERPRISE'];
