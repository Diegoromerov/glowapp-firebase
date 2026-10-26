// lib/services/saas_api_service.dart
/// SAAS API SERVICE
/// Centralized API calls for all SaaS functionality.
/// Uses ApiService base HTTP methods with retry logic.
library saas_api_service;

import 'dart:async';
import 'package:flutter/foundation.dart';
import 'api_service.dart';
import '../models/saas/saas_models.dart';

class SaasApiService {
  static const String _basePath = '/api/saas';

  // ═══════════════════════════════════════════════════════════════
  // BUSINESS PROFILE → /api/saas/bootstrap
  // ═══════════════════════════════════════════════════════════════

  /// Provisiona el tenant del usuario a partir de su salón (idempotente).
  /// POST /api/saas/bootstrap → { provisioned, created, profile }
  static Future<SaasBusinessProfile> provisionTenant({String plan = 'FREE_TRIAL'}) async {
    final response = await ApiService.post(
      '$_basePath/bootstrap',
      {'plan': plan},
    );
    final data = response as Map<String, dynamic>;
    final profile = data['profile'];
    final json = profile is Map<String, dynamic> ? profile : data;
    return SaasBusinessProfile.fromJson(json);
  }

  /// Perfil de negocio del usuario actual (null si aún no está provisionado).
  static Future<SaasBusinessProfile?> getMyBusinessProfile() async {
    try {
      final response = await ApiService.get('$_basePath/bootstrap');
      if (response is! Map<String, dynamic>) return null;
      final profile = response['profile'];
      if (profile is! Map<String, dynamic>) return null;
      return SaasBusinessProfile.fromJson(profile);
    } catch (e) {
      if (kDebugMode) print('⚠️ SaasApiService.getMyBusinessProfile: $e');
      return null;
    }
  }

  /// Perfil + rol del tenant activo (lo que necesita la UI para permisos).
  static Future<({SaasBusinessProfile profile, MembershipRole role})?> getMyTenant() async {
    try {
      final response = await ApiService.get('$_basePath/bootstrap');
      if (response is! Map<String, dynamic>) return null;
      final profileJson = response['profile'];
      if (profileJson is! Map<String, dynamic>) return null;
      return (
        profile: SaasBusinessProfile.fromJson(profileJson),
        role: MembershipRole.fromCode(
          (profileJson['role'] ?? response['role'] ?? 'MEMBER').toString(),
        ),
      );
    } catch (e) {
      if (kDebugMode) print('⚠️ SaasApiService.getMyTenant: $e');
      return null;
    }
  }

  /// Crear perfil de negocio (onboarding SaaS).
  /// El alta real es el provisionamiento desde el salón ya creado.
  static Future<SaasBusinessProfile> createBusinessProfile(
    CreateBusinessProfileRequest request,
  ) =>
      provisionTenant(plan: request.planId);

  /// Actualizar perfil de negocio.
  /// El backend no expone PATCH de business_profiles: se mantiene el perfil
  /// devuelto por bootstrap para no simular una escritura inexistente.
  static Future<SaasBusinessProfile> updateBusinessProfile(
    String businessProfileId,
    Map<String, dynamic> updates,
  ) async {
    final current = await getMyBusinessProfile();
    if (current == null) {
      throw StateError('No hay perfil de negocio provisionado');
    }
    return current;
  }

  /// Obtener perfil por ID (resuelve el tenant activo del usuario).
  static Future<SaasBusinessProfile> getBusinessProfile(String businessProfileId) async {
    final current = await getMyBusinessProfile();
    if (current == null) {
      throw StateError('No hay perfil de negocio provisionado');
    }
    return current;
  }

  /// Catálogo de planes.
  /// El backend no expone /plans: la fuente de verdad es `SaasPlanTier`
  /// (espejo de usageMeteringService.PLAN_LIMITS + invoiceService.getPlanPrice).
  static Future<List<SaasPlan>> getPlans() async {
    return SaasPlanTier.values.map((tier) {
      final raw = tier.limits;
      return SaasPlan(
        id: tier.code,
        tier: tier,
        name: tier.label,
        description: _planDescription(tier),
        priceCents: tier.priceCents,
        trialDays: tier == SaasPlanTier.freeTrial ? 14 : 0,
        limits: {
          for (final e in raw.entries)
            if (e.value != null) e.key: e.value!,
        },
        features: _planFeatures(tier),
        isActive: true,
        isPopular: tier == SaasPlanTier.pro,
      );
    }).toList();
  }

  static String _planDescription(SaasPlanTier tier) {
    switch (tier) {
      case SaasPlanTier.freeTrial:
        return '14 días para probar la plataforma completa';
      case SaasPlanTier.freemium:
        return 'Presencia básica sin costo mensual';
      case SaasPlanTier.basic:
        return 'Para salones que inician su operación digital';
      case SaasPlanTier.pro:
        return 'Para salones con equipo y agenda completa';
      case SaasPlanTier.enterprise:
        return 'Multi-sede, integraciones y soporte prioritario';
    }
  }

  static List<String> _planFeatures(SaasPlanTier tier) {
    final l = tier.limits;
    String limitOf(String k, String unit) {
      final v = l[k];
      if (v == null) return 'ilimitado';
      if (v == 1 && (k.endsWith('ANALYTICS') || k.endsWith('BRANDING') || k.endsWith('INTEGRATION'))) return 'incluido';
      if (v == 0) return 'no incluido';
      return '$v $unit';
    }

    return [
      '${limitOf('TEAM_SEATS', 'asientos')} de equipo',
      '${limitOf('ONLINE_BOOKING', 'reservas')} online/mes',
      '${limitOf('API_CALLS', 'llamadas')} API/mes',
      'Analítica avanzada: ${limitOf('ADVANCED_ANALYTICS', '')}',
      'Marca personalizada: ${limitOf('CUSTOM_BRANDING', '')}',
    ];
  }

  // ═══════════════════════════════════════════════════════════════
  // TEAM MANAGEMENT → /api/saas/team
  // ═══════════════════════════════════════════════════════════════

  /// Miembros del equipo del tenant activo. GET /api/saas/team → { members: [...] }
  static Future<List<TeamMember>> getTeamMembers(String businessProfileId) async {
    final response = await ApiService.get('$_basePath/team');
    final data = response as Map<String, dynamic>;
    final members = (data['members'] ?? data['data']) as List<dynamic>? ?? [];
    return members
        .whereType<Map<String, dynamic>>()
        .map((j) => TeamMember.fromJson(j))
        .toList();
  }

  /// Invitar miembro. POST /api/saas/team/invite { email, role }
  static Future<void> inviteMember(String businessProfileId, InviteMemberRequest request) async {
    await ApiService.post('$_basePath/team/invite', request.toJson());
  }

  /// Cambiar rol. PATCH /api/saas/team/:memberId/role
  static Future<void> updateMemberRole(
    String businessProfileId,
    String memberId,
    MembershipRole role,
  ) async {
    await ApiService.patch('$_basePath/team/$memberId/role', {'role': role.code});
  }

  /// Remover miembro. DELETE /api/saas/team/:memberId
  static Future<void> removeMember(String businessProfileId, String memberId) async {
    await ApiService.delete('$_basePath/team/$memberId');
  }

  /// Reenviar invitación. POST /api/saas/team/:memberId/resend-invite
  static Future<void> resendInvitation(String businessProfileId, String invitationId) async {
    await ApiService.post('$_basePath/team/$invitationId/resend-invite', {});
  }

  /// Invitaciones pendientes: el backend no expone un endpoint aparte,
  /// se derivan de las memberships en estado PENDING.
  static Future<List<TeamInvitation>> getPendingInvitations(String businessProfileId) async {
    final members = await getTeamMembers(businessProfileId);
    return members
        .where((m) => m.invitationStatus == InvitationStatus.pending)
        .map((m) => TeamInvitation(
              id: m.id,
              businessProfileId: businessProfileId,
              email: m.email,
              role: m.role,
              invitedByUserId: '',
              status: InvitationStatus.pending,
              expiresAt: DateTime.now().add(const Duration(days: 7)),
              createdAt: m.invitedAt ?? DateTime.now(),
            ))
        .toList();
  }

  // ═══════════════════════════════════════════════════════════════
  // BILLING & SUBSCRIPTIONS  →  /api/saas/billing
  // ═══════════════════════════════════════════════════════════════

  /// Obtener suscripción actual.
  /// GET /api/saas/billing → { subscription: { plan, status, periodStart, periodEnd, ... } | null }
  static Future<Subscription?> getSubscription(String businessProfileId) async {
    try {
      final response = await ApiService.get('$_basePath/billing');
      if (response is! Map<String, dynamic>) return null;
      final sub = response['subscription'];
      if (sub is! Map<String, dynamic>) return null;
      return Subscription.fromJson(sub);
    } catch (e) {
      if (kDebugMode) print('⚠️ SaasApiService.getSubscription: $e');
      return null;
    }
  }

  /// Resumen de facturación completo (suscripción + próximo pago + facturas recientes)
  static Future<Map<String, dynamic>> getBillingSummary() async {
    final response = await ApiService.get('$_basePath/billing');
    return response as Map<String, dynamic>;
  }

  /// Crear sesión de checkout (Stripe) o link de pago (Wompi) para upgrade.
  /// POST /api/saas/billing/checkout → { provider, checkoutUrl, sessionId? }
  static Future<CheckoutSessionResponse> createCheckoutSession(
    String businessProfileId,
    CreateCheckoutRequest request,
  ) async {
    final response = await ApiService.post(
      '$_basePath/billing/checkout',
      {
        'plan': request.planId,
        'currency': request.currency,
        'successUrl': request.successUrl,
        'cancelUrl': request.cancelUrl,
      },
    );
    return CheckoutSessionResponse.fromJson(response as Map<String, dynamic>);
  }

  /// Cambiar de plan (upgrade o downgrade sin pasar por checkout).
  /// POST /api/saas/billing/change-plan
  static Future<Map<String, dynamic>> changePlan(String planCode) async {
    final response = await ApiService.post(
      '$_basePath/billing/change-plan',
      {'plan': planCode},
    );
    return response as Map<String, dynamic>;
  }

  /// Sesión del Stripe Billing Portal (métodos de pago, facturas, cancelación).
  /// POST /api/saas/billing/portal → { portalUrl }
  static Future<String?> createPortalSession({String? returnUrl}) async {
    try {
      final response = await ApiService.post(
        '$_basePath/billing/portal',
        {if (returnUrl != null) 'returnUrl': returnUrl},
      );
      return (response as Map<String, dynamic>)['portalUrl'] as String?;
    } catch (e) {
      if (kDebugMode) print('⚠️ SaasApiService.createPortalSession: $e');
      return null;
    }
  }

  /// Obtener facturas. GET /api/saas/billing/invoices → { invoices: [...] }
  static Future<List<Invoice>> getInvoices(String businessProfileId, {int limit = 50, int offset = 0}) async {
    final response = await ApiService.get(
      '$_basePath/billing/invoices?limit=$limit&offset=$offset',
    );
    final data = response as Map<String, dynamic>;
    final invoices = (data['invoices'] ?? data['data']) as List<dynamic>? ?? [];
    return invoices
        .whereType<Map<String, dynamic>>()
        .map((j) => Invoice.fromJson(j))
        .toList();
  }

  /// PDF de factura: el backend sirve el archivo con `Content-Type: application/pdf`
  /// en una ruta autenticada, no una URL firmada. Se devuelve la ruta para
  /// descarga autenticada desde el cliente.
  static String getInvoicePdfPath(String invoiceId) =>
      '$_basePath/billing/invoices/$invoiceId/pdf';

  /// Obtener métodos de pago. GET /api/saas/billing/payment-methods → { paymentMethods: [...] }
  static Future<List<Map<String, dynamic>>> getPaymentMethods(String businessProfileId) async {
    final response = await ApiService.get('$_basePath/billing/payment-methods');
    final data = response as Map<String, dynamic>;
    return (data['paymentMethods'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .toList();
  }

  /// Cancelar suscripción. POST /api/saas/billing/cancel → { subscription }
  static Future<Subscription> cancelSubscription(
    String businessProfileId, {
    bool atPeriodEnd = true,
  }) async {
    final response = await ApiService.post(
      '$_basePath/billing/cancel',
      {'atPeriodEnd': atPeriodEnd},
    );
    final data = response as Map<String, dynamic>;
    final sub = data['subscription'];
    if (sub is Map<String, dynamic>) return Subscription.fromJson(sub);
    return (await getSubscription(businessProfileId))!;
  }

  // ═══════════════════════════════════════════════════════════════
  // USAGE & LIMITS  →  /api/saas/usage
  // ═══════════════════════════════════════════════════════════════

  /// Resumen de uso del período actual.
  /// GET /api/saas/usage → { plan, period:{start,end}, usage:[...], summary:{...} }
  ///
  /// Las alertas se derivan del consumo real frente al límite del plan.
  /// `/api/saas/usage/alerts` guarda *configuración* de alertas (feature +
  /// thresholdPercent), no eventos disparados, así que no alimenta esta lista.
  static Future<UsageSummary> getUsageSummary(String businessProfileId) async {
    final response = await ApiService.get('$_basePath/usage');
    final data = response is Map<String, dynamic> ? response : <String, dynamic>{};
    final summary = UsageSummary.fromJson(data);

    final derived = <UsageAlert>[];
    for (final m in summary.metrics) {
      if (m.type.isBoolean || m.limit <= 0) continue;
      final progress = m.current / m.limit;
      if (progress < 0.8) continue;
      derived.add(UsageAlert(
        id: '${m.type.code}-${summary.periodStart.toIso8601String()}',
        businessProfileId: businessProfileId,
        metricType: m.type,
        threshold: 0.8,
        currentValue: m.current,
        limitValue: m.limit,
        triggeredAt: DateTime.now(),
        acknowledged: false,
        message: progress >= 1
            ? 'Límite de ${m.type.label.toLowerCase()} alcanzado en el plan actual'
            : 'Consumo de ${m.type.label.toLowerCase()} por encima del 80% del plan',
      ));
    }

    return UsageSummary(
      metrics: summary.metrics,
      alerts: derived,
      periodStart: summary.periodStart,
      periodEnd: summary.periodEnd,
    );
  }

  /// Métricas detalladas (misma fuente que el resumen).
  static Future<List<UsageMetric>> getUsageMetrics(String businessProfileId) async {
    final summary = await getUsageSummary(businessProfileId);
    return summary.metrics;
  }

  /// Configuración de alertas del tenant (reglas, no eventos).
  /// GET /api/saas/usage/alerts → { alerts: [{ feature, thresholdPercent, channel }] }
  static Future<List<Map<String, dynamic>>> getAlertConfigurations() async {
    final response = await ApiService.get('$_basePath/usage/alerts');
    final data = response as Map<String, dynamic>;
    return ((data['alerts'] ?? data['data']) as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .toList();
  }

  /// Historial de uso de los últimos meses. GET /api/saas/usage/history
  static Future<Map<String, dynamic>> getUsageHistory({int months = 6}) async {
    final response = await ApiService.get('$_basePath/usage/history?months=$months');
    return response as Map<String, dynamic>;
  }

  /// Límites del plan actual según el backend. GET /api/saas/usage/limits
  static Future<Map<String, dynamic>> getUsageLimits() async {
    final response = await ApiService.get('$_basePath/usage/limits');
    return response as Map<String, dynamic>;
  }

  // ═══════════════════════════════════════════════════════════════
  // API KEYS  →  /api/saas/api-keys
  // ═══════════════════════════════════════════════════════════════

  /// Listar API keys. GET /api/saas/api-keys → { apiKeys: [...] }
  static Future<List<ApiKey>> getApiKeys(String businessProfileId) async {
    final response = await ApiService.get('$_basePath/api-keys');
    final data = response as Map<String, dynamic>;
    final keys = (data['apiKeys'] ?? data['data']) as List<dynamic>? ?? [];
    return keys
        .whereType<Map<String, dynamic>>()
        .map((j) => ApiKey.fromJson(j))
        .toList();
  }

  /// Crear API key. POST → { message, apiKey: { ..., key: <completa> } }
  static Future<ApiKey> createApiKey(
    String businessProfileId,
    CreateApiKeyRequest request,
  ) async {
    final response = await ApiService.post(
      '$_basePath/api-keys',
      request.toJson(),
    );
    final data = response as Map<String, dynamic>;
    final payload = data['apiKey'] ?? data['data'];
    final json = payload is Map<String, dynamic> ? payload : data;
    return ApiKey.fromJson(json);
  }

  /// Revocar API key. POST /api/saas/api-keys/:keyId/revoke
  static Future<void> revokeApiKey(String businessProfileId, String keyId) async {
    await ApiService.post('$_basePath/api-keys/$keyId/revoke', {});
  }

  /// Actualizar nombre/scopes/expiración. PATCH /api/saas/api-keys/:keyId
  static Future<ApiKey> updateApiKey(
    String keyId, {
    String? name,
    List<ApiKeyScope>? scopes,
    int? expiresInDays,
  }) async {
    final response = await ApiService.patch(
      '$_basePath/api-keys/$keyId',
      {
        if (name != null) 'name': name,
        if (scopes != null) 'scopes': ApiKeyScope.toCodes(scopes),
        if (expiresInDays != null) 'expiresInDays': expiresInDays,
      },
    );
    final data = response as Map<String, dynamic>;
    final payload = data['apiKey'];
    return ApiKey.fromJson(payload is Map<String, dynamic> ? payload : data);
  }

  // ═══════════════════════════════════════════════════════════════
  // HEALTH CHECK
  // ═══════════════════════════════════════════════════════════════

  /// Verificar salud del API (el endpoint SaaS no expone /health propio).
  static Future<bool> healthCheck() async {
    try {
      final response = await ApiService.get('/api/health');
      if (response is! Map<String, dynamic>) return false;
      final status = (response['status'] ?? '').toString().toUpperCase();
      return status == 'OK' || status == 'HEALTHY';
    } catch (_) {
      return false;
    }
  }
}