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
  static Future<SaasBusinessProfile> provisionTenant(
      {String plan = 'FREE_TRIAL'}) async {
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
      if (kDebugMode) debugPrint('⚠️ SaasApiService.getMyBusinessProfile: $e');
      return null;
    }
  }

  /// Perfil + rol del tenant activo (lo que necesita la UI para permisos).
  static Future<({SaasBusinessProfile profile, MembershipRole role})?>
      getMyTenant() async {
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
      if (kDebugMode) debugPrint('⚠️ SaasApiService.getMyTenant: $e');
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
  static Future<SaasBusinessProfile> getBusinessProfile(
      String businessProfileId) async {
    final current = await getMyBusinessProfile();
    if (current == null) {
      throw StateError('No hay perfil de negocio provisionado');
    }
    return current;
  }

  /// Lee la configuración de una sede del salón. El backend comprueba que la
  /// persona autenticada sea propietaria o administradora de esa sede.
  static Future<Map<String, dynamic>> getSalonProfile(int salonId) async {
    final response = await ApiService.get('/api/salon/$salonId/profile');
    if (response is Map<String, dynamic> &&
        response['salon'] is Map<String, dynamic>) {
      return Map<String, dynamic>.from(response['salon'] as Map);
    }
    throw StateError('No pudimos cargar el perfil del salón.');
  }

  /// Guarda los datos editables del salón, incluido su horario comercial.
  static Future<Map<String, dynamic>> updateSalonProfile(
    int salonId,
    Map<String, dynamic> updates,
  ) async {
    final response =
        await ApiService.patch('/api/salon/$salonId/profile', updates);
    if (response is Map<String, dynamic> &&
        response['salon'] is Map<String, dynamic>) {
      return Map<String, dynamic>.from(response['salon'] as Map);
    }
    throw StateError('No pudimos guardar los datos del salón.');
  }

  /// Catálogo comercial y cuotas publicados por el backend.
  static Future<List<SaasPlan>> getPlans() async {
    try {
      final response = await ApiService.get('$_basePath/catalog');
      final data = response as Map<String, dynamic>;
      final rawPlans = data['plans'] as List<dynamic>? ?? const [];
      return rawPlans.whereType<Map<String, dynamic>>().map((raw) {
        final tier = SaasPlanTier.fromCode((raw['id'] ?? '').toString());
        final rawQuotas = raw['quotas'] as Map<String, dynamic>? ?? const {};
        final limits = <String, int>{};
        final unlimitedLimits = <String>{};
        final features = <String>[];
        final proposedOffer = raw['proposedOffer'];
        final proposedPriceCop = raw['proposedPriceCop'] is num
            ? raw['proposedPriceCop'] as num
            : proposedOffer is Map<String, dynamic>
                ? proposedOffer['priceCop'] as num?
                : null;
        final catalogCapabilities =
            data['capabilities'] as Map<String, dynamic>? ?? const {};
        for (final capability
            in (raw['capabilities'] as List<dynamic>? ?? const [])) {
          final code = capability.toString();
          final definition = catalogCapabilities[code];
          if (definition is Map<String, dynamic> &&
              definition['kind'] == 'boolean') {
            features.add((definition['label'] ?? code).toString());
          }
        }
        for (final entry in rawQuotas.entries) {
          final quota = entry.value;
          if (quota is! Map<String, dynamic>) continue;
          final value = quota['limit'];
          if (value is num) limits[entry.key] = value.toInt();
          if (value == null) unlimitedLimits.add(entry.key);
          if (quota['kind'] == 'boolean') continue;
          final label = quota['label']?.toString();
          final unit = quota['unit']?.toString();
          if (entry.key == 'API_CALLS') continue;
          if (const {'TEAM_SEATS', 'DIRECT_BOOKINGS', 'ONLINE_BOOKING'}
              .contains(entry.key)) continue;
          if (label != null && label.isNotEmpty && value is num && value > 0) {
            features.add(value == 1 && quota['kind'] == 'boolean'
                ? '$label incluido'
                : '$value $unit de $label');
          } else if (label != null && label.isNotEmpty && value == null) {
            features.add('$label ilimitadas');
          }
        }

        return SaasPlan(
          id: (raw['id'] ?? '').toString(),
          tier: tier,
          name: (raw['name'] ?? tier.label).toString(),
          description: (raw['description'] ?? '').toString(),
          priceCents: ((raw['priceCop'] as num? ?? 0) * 100).round(),
          proposedPriceCents: proposedPriceCop == null
              ? null
              : (proposedPriceCop * 100).round(),
          trialDays: (raw['trialDays'] as num? ?? 0).toInt(),
          limits: limits,
          unlimitedLimits: unlimitedLimits,
          features: features,
          isActive: raw['commerciallyAvailable'] as bool? ?? true,
          isPopular: raw['popular'] as bool? ?? false,
        );
      }).toList();
    } catch (e) {
      if (kDebugMode)
        debugPrint(
            '⚠️ Catálogo SaaS no disponible; usando catálogo local compatible: $e');
      return _legacyPlans();
    }
  }

  static List<SaasPlan> _legacyPlans() {
    // Fail closed: without the API catalog, never present proposed prices as
    // purchasable offers. Only include tiers currently available in production.
    return SaasPlanTier.values
        .where((tier) => tier.isCommerciallyAvailable)
        .map((tier) {
      final raw = tier.limits;
      return SaasPlan(
        id: tier.code,
        tier: tier,
        name: tier.label,
        description: _planDescription(tier),
        priceCents: tier.priceCents,
        proposedPriceCents: null,
        trialDays: tier == SaasPlanTier.freeTrial ? 14 : 0,
        limits: {
          for (final e in raw.entries)
            if (e.value != null) e.key: e.value!,
        },
        unlimitedLimits: {
          for (final e in raw.entries)
            if (e.value == null) e.key,
        },
        features: _planFeatures(tier),
        isActive: tier.isCommerciallyAvailable,
        isPopular: tier == SaasPlanTier.pro,
      );
    }).toList();
  }

  /// Niveles disponibles para el primer render y para uso sin conexión.
  /// Evita que el onboarding invente una oferta distinta mientras carga el API.
  static List<SaasPlan> get fallbackPlans => _legacyPlans();

  static String _planDescription(SaasPlanTier tier) {
    switch (tier) {
      case SaasPlanTier.freeTrial:
        return 'Prueba GlowApp durante 14 días con hasta 3 personas y 150 reservas al mes.';
      case SaasPlanTier.freemium:
        return 'Administra tu salón gratis de forma permanente con 1 persona y 30 reservas al mes.';
      case SaasPlanTier.basic:
        return 'Agenda, caja, inventario y recursos para un salón de hasta 5 personas, con reservas ilimitadas.';
      case SaasPlanTier.growth:
        return 'Para salones en crecimiento que necesitan marca, fidelización y más recursos';
      case SaasPlanTier.pro:
        return 'Para salones con equipo, agenda completa, integraciones y analítica avanzada';
      case SaasPlanTier.enterprise:
        return 'Equipo e integraciones sin límite, WhatsApp, punto de venta y soporte prioritario';
    }
  }

  static List<String> _planFeatures(SaasPlanTier tier) {
    switch (tier) {
      case SaasPlanTier.freeTrial:
        return const [
          'Presencia en el mapa', 'Gestión de equipo', 'Reservas en línea',
          'Caja y ventas', 'Inventario', 'Reportes básicos',
          'Recursos ilimitados', 'Checklists de cumplimiento',
          'Marca personalizada', 'Fidelización y puntos del salón',
          'Recetas y consumo de productos', 'Analítica avanzada',
          'Facturación electrónica en modo de pruebas',
          'Aura para el negocio', 'Mensajes de WhatsApp',
        ];
      case SaasPlanTier.freemium:
        return const [
          'Presencia en el mapa', 'Reservas en línea', 'Recibos no fiscales',
          'Reportes básicos',
        ];
      case SaasPlanTier.basic:
        return const [
          'Presencia en el mapa', 'Gestión de equipo', 'Reservas en línea',
          'Caja y ventas', 'Inventario', 'Reportes básicos',
          'Gestión de recursos', 'Checklists de cumplimiento',
        ];
      case SaasPlanTier.growth:
      case SaasPlanTier.pro:
      case SaasPlanTier.enterprise:
        return const [];
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TEAM MANAGEMENT → /api/saas/team
  // ═══════════════════════════════════════════════════════════════

  /// Miembros del equipo del tenant activo. GET /api/saas/team → { members: [...] }
  static Future<List<TeamMember>> getTeamMembers(
      String businessProfileId) async {
    final response = await ApiService.get('$_basePath/team');
    final data = response as Map<String, dynamic>;
    final members = (data['members'] ?? data['data']) as List<dynamic>? ?? [];
    return members
        .whereType<Map<String, dynamic>>()
        .map((j) => TeamMember.fromJson(j))
        .toList();
  }

  /// Invitar miembro. POST /api/saas/team/invite { email, role }
  static Future<bool> inviteMember(
      String businessProfileId, InviteMemberRequest request) async {
    final response = await ApiService.post(
      '$_basePath/team/invite',
      request.toJson(),
    );
    return response is Map<String, dynamic> && response['emailSent'] == true;
  }

  /// Cambiar rol. PATCH /api/saas/team/:memberId/role
  static Future<void> updateMemberRole(
    String businessProfileId,
    String memberId,
    MembershipRole role,
  ) async {
    await ApiService.patch(
        '$_basePath/team/$memberId/role', {'role': role.code});
  }

  /// Remover miembro. DELETE /api/saas/team/:memberId
  static Future<void> removeMember(
      String businessProfileId, String memberId) async {
    await ApiService.delete('$_basePath/team/$memberId');
  }

  /// Suspender o reactivar una membresía activa.
  static Future<void> setMemberStatus(
      String businessProfileId, String memberId, String status) async {
    await ApiService.patch(
        '$_basePath/team/$memberId/status', {'status': status});
  }

  /// Reenviar invitación. POST /api/saas/team/:memberId/resend-invite
  static Future<bool> resendInvitation(
      String businessProfileId, String invitationId) async {
    final response = await ApiService.post(
      '$_basePath/team/$invitationId/resend-invite',
      {},
    );
    return response is Map<String, dynamic> && response['emailSent'] == true;
  }

  /// Invitaciones pendientes: el backend no expone un endpoint aparte,
  /// se derivan de las memberships en estado PENDING.
  static Future<List<TeamInvitation>> getPendingInvitations(
      String businessProfileId) async {
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
      if (kDebugMode) debugPrint('⚠️ SaasApiService.getSubscription: $e');
      return null;
    }
  }

  /// Resumen de facturación completo (suscripción + próximo pago + facturas recientes)
  static Future<Map<String, dynamic>> getBillingSummary() async {
    final response = await ApiService.get('$_basePath/billing');
    return response as Map<String, dynamic>;
  }

  /// Indicadores comerciales agregados del negocio activo.
  /// El backend valida el plan SaaS, el rol y la sede seleccionada.
  static Future<Map<String, dynamic>> getBusinessAnalytics({
    String? from,
    String? to,
  }) async {
    final query = <String, String>{};
    if (from != null) query['from'] = from;
    if (to != null) query['to'] = to;
    final endpoint = Uri(
      path: '$_basePath/analytics',
      queryParameters: query.isEmpty ? null : query,
    ).toString();
    final response = await ApiService.get(endpoint);
    if (response is! Map<String, dynamic>) {
      throw const FormatException('Respuesta de analítica inválida');
    }
    return response;
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

  /// Inicia checkout recurrente SaaS Wompi con token de tarjeta (nunca PAN/CVV).
  static Future<Map<String, dynamic>> createWompiSaasCheckout({
    required String plan,
    required String paymentToken,
    required bool acceptRecurring,
    required bool acceptTerms,
    required bool acceptPersonalData,
  }) async {
    final response = await ApiService.post(
      '$_basePath/billing/checkout',
      {
        'plan': plan,
        'currency': 'COP',
        'paymentToken': paymentToken,
        'acceptRecurring': acceptRecurring,
        'acceptTerms': acceptTerms,
        'acceptPersonalData': acceptPersonalData,
      },
    );
    return Map<String, dynamic>.from(response as Map);
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
      if (kDebugMode) debugPrint('⚠️ SaasApiService.createPortalSession: $e');
      return null;
    }
  }

  /// Obtener facturas. GET /api/saas/billing/invoices → { invoices: [...] }
  static Future<List<Invoice>> getInvoices(String businessProfileId,
      {int limit = 50, int offset = 0}) async {
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

  /// Descarga el comprobante usando la sesión autenticada de la app.
  static Future<Uint8List> downloadInvoiceDocument(String invoiceId) =>
      ApiService.getBytes(getInvoicePdfPath(invoiceId));

  /// Obtener métodos de pago. GET /api/saas/billing/payment-methods → { paymentMethods: [...] }
  static Future<List<Map<String, dynamic>>> getPaymentMethods(
      String businessProfileId) async {
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
    final data =
        response is Map<String, dynamic> ? response : <String, dynamic>{};
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
  static Future<List<UsageMetric>> getUsageMetrics(
      String businessProfileId) async {
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
    final response =
        await ApiService.get('$_basePath/usage/history?months=$months');
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
  static Future<void> revokeApiKey(
      String businessProfileId, String keyId) async {
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
