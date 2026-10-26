// lib/models/saas/saas_models.dart
/// GLOWAPP SAAS MODELS (Dart 3.x)
/// Strong typed Enums, immutability, and JSON serialization.
/// Covers: BusinessProfile (SaaS), Membership, TeamMember, Invitation,
/// Subscription, Invoice, UsageMetrics, ApiKey, Plan.
library saas_models;

import 'package:flutter/material.dart';

// ═══════════════════════════════════════════════════════════════
// ENUMS
// ═══════════════════════════════════════════════════════════════

/// Lee un valor de un mapa JSON aceptando varias claves (snake_case / camelCase).
dynamic _pick(Map<String, dynamic> json, List<String> keys) {
  for (final k in keys) {
    if (json.containsKey(k) && json[k] != null) return json[k];
  }
  return null;
}

String _asString(Map<String, dynamic> json, List<String> keys, [String fallback = '']) {
  final v = _pick(json, keys);
  if (v == null) return fallback;
  return v.toString();
}

int _asInt(Map<String, dynamic> json, List<String> keys, [int fallback = 0]) {
  final v = _pick(json, keys);
  if (v == null) return fallback;
  if (v is num) return v.toInt();
  return int.tryParse(v.toString()) ?? fallback;
}

DateTime? _asDate(Map<String, dynamic> json, List<String> keys) {
  final v = _pick(json, keys);
  if (v == null) return null;
  if (v is DateTime) return v;
  return DateTime.tryParse(v.toString());
}

enum SaasPlanTier {
  freeTrial('FREE_TRIAL', 'Prueba Gratis', 0, Color(0xFF6B7280)),
  freemium('FREEMIUM', 'Freemium', 0, Color(0xFF9CA3AF)),
  basic('BASIC', 'Básico', 9900000, Color(0xFF3B82F6)), // $99.000 COP
  pro('PRO', 'Profesional', 24900000, Color(0xFF8B5CF6)), // $249.000 COP
  enterprise('ENTERPRISE', 'Empresarial', 59900000, Color(0xFFF59E0B)); // $599.000 COP

  final String code;
  final String label;
  /// Precio mensual en **centavos** de COP (99.000 COP = 9.900.000).
  /// Equivale a `invoiceService.getPlanPrice(plan, 'COP') * 100`.
  final int priceCents;
  final Color color;

  const SaasPlanTier(this.code, this.label, this.priceCents, this.color);

  static SaasPlanTier fromCode(String code) {
    final clean = code.toUpperCase().trim();
    return SaasPlanTier.values.firstWhere(
      (e) => e.code == clean,
      orElse: () => SaasPlanTier.freeTrial,
    );
  }

  String get formattedPrice {
    if (priceCents == 0) return 'Gratis';
    final pesos = priceCents / 100;
    return '\$${pesos.toStringAsFixed(0).replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]}.')} COP/mes';
  }

  /// Límites mensuales del plan — espejo de backend/src/services/usageMeteringService.js
  /// `null` = ilimitado; los booleanos (ANALYTICS, BRANDING, WHATSAPP, POS) usan 1/0.
  Map<String, int?> get limits {
    switch (this) {
      case SaasPlanTier.freeTrial:
        return {
          'MAP_VISIBILITY': 1,
          'ONLINE_BOOKING': 50,
          'TEAM_SEATS': 3,
          'API_CALLS': 1000,
          'ADVANCED_ANALYTICS': 1,
          'CUSTOM_BRANDING': 1,
          'WHATSAPP_INTEGRATION': 0,
          'POS_INTEGRATION': 0,
        };
      case SaasPlanTier.freemium:
        return {
          'MAP_VISIBILITY': 0,
          'ONLINE_BOOKING': 20,
          'TEAM_SEATS': 1,
          'API_CALLS': 500,
          'ADVANCED_ANALYTICS': 0,
          'CUSTOM_BRANDING': 0,
          'WHATSAPP_INTEGRATION': 0,
          'POS_INTEGRATION': 0,
        };
      case SaasPlanTier.basic:
        return {
          'MAP_VISIBILITY': 1,
          'ONLINE_BOOKING': 200,
          'TEAM_SEATS': 5,
          'API_CALLS': 10000,
          'ADVANCED_ANALYTICS': 0,
          'CUSTOM_BRANDING': 0,
          'WHATSAPP_INTEGRATION': 0,
          'POS_INTEGRATION': 0,
        };
      case SaasPlanTier.pro:
        return {
          'MAP_VISIBILITY': 1,
          'ONLINE_BOOKING': null,
          'TEAM_SEATS': 20,
          'API_CALLS': 100000,
          'ADVANCED_ANALYTICS': 1,
          'CUSTOM_BRANDING': 1,
          'WHATSAPP_INTEGRATION': 1,
          'POS_INTEGRATION': 0,
        };
      case SaasPlanTier.enterprise:
        return {
          'MAP_VISIBILITY': 1,
          'ONLINE_BOOKING': null,
          'TEAM_SEATS': null,
          'API_CALLS': null,
          'ADVANCED_ANALYTICS': 1,
          'CUSTOM_BRANDING': 1,
          'WHATSAPP_INTEGRATION': 1,
          'POS_INTEGRATION': 1,
        };
    }
  }

  /// Solo BASIC / PRO / ENTERPRISE se contratan por checkout (upgrade).
  bool get isPurchasable => this == SaasPlanTier.basic || this == SaasPlanTier.pro || this == SaasPlanTier.enterprise;

  int get sortOrder => index;
}

enum MembershipRole {
  owner('OWNER', 'Propietario', Color(0xFFF59E0B)),
  admin('ADMIN', 'Administrador', Color(0xFF8B5CF6)),
  manager('MANAGER', 'Gerente', Color(0xFF3B82F6)),
  staff('MEMBER', 'Personal', Color(0xFF10B981)),
  viewer('VIEWER', 'Consulta', Color(0xFF9CA3AF));

  final String code;
  final String label;
  final Color color;

  const MembershipRole(this.code, this.label, this.color);

  static MembershipRole fromCode(String code) {
    final clean = code.toUpperCase().trim();
    return MembershipRole.values.firstWhere(
      (e) => e.code == clean,
      orElse: () => MembershipRole.staff,
    );
  }

  bool get canManageTeam => this == MembershipRole.owner || this == MembershipRole.admin;
  bool get canManageBilling => this == MembershipRole.owner || this == MembershipRole.admin;
  bool get canManageApiKeys => this == MembershipRole.owner || this == MembershipRole.admin;
  bool get canViewUsage => true;
}

enum InvitationStatus {
  pending('PENDING', 'Pendiente', Color(0xFFF59E0B)),
  accepted('ACCEPTED', 'Aceptada', Color(0xFF10B981)),
  expired('EXPIRED', 'Expirada', Color(0xFF9CA3AF)),
  revoked('REVOKED', 'Revoca', Color(0xFFEF4444));

  final String code;
  final String label;
  final Color color;

  const InvitationStatus(this.code, this.label, this.color);

  static InvitationStatus fromCode(String code) {
    final clean = code.toUpperCase().trim();
    return InvitationStatus.values.firstWhere(
      (e) => e.code == clean,
      orElse: () => InvitationStatus.pending,
    );
  }
}

enum SubscriptionStatus {
  trialing('TRIALING', 'En prueba', Color(0xFF3B82F6)),
  active('ACTIVE', 'Activa', Color(0xFF10B981)),
  pastDue('PAST_DUE', 'Pendiente pago', Color(0xFFF59E0B)),
  canceled('CANCELED', 'Cancelada', Color(0xFFEF4444)),
  incomplete('INCOMPLETE', 'Incompleta', Color(0xFF9CA3AF));

  final String code;
  final String label;
  final Color color;

  const SubscriptionStatus(this.code, this.label, this.color);

  static SubscriptionStatus fromCode(String code) {
    final clean = code.toUpperCase().trim();
    return SubscriptionStatus.values.firstWhere(
      (e) => e.code == clean,
      orElse: () => SubscriptionStatus.incomplete,
    );
  }

  bool get isPaid => this == SubscriptionStatus.active || this == SubscriptionStatus.trialing;
}

enum InvoiceStatus {
  draft('DRAFT', 'Borrador', Color(0xFF9CA3AF)),
  open('OPEN', 'Abierta', Color(0xFF3B82F6)),
  paid('PAID', 'Pagada', Color(0xFF10B981)),
  voided('VOIDED', 'Anulada', Color(0xFFEF4444)),
  uncollectible('UNCOLLECTIBLE', 'Incobrable', Color(0xFF991B1B));

  final String code;
  final String label;
  final Color color;

  const InvoiceStatus(this.code, this.label, this.color);

  static InvoiceStatus fromCode(String code) {
    final clean = code.toUpperCase().trim();
    return InvoiceStatus.values.firstWhere(
      (e) => e.code == clean,
      orElse: () => InvoiceStatus.draft,
    );
  }
}

enum ApiKeyScope {
  read('read', 'Lectura', 'Consultar reservas, clientes, servicios y productos'),
  write('write', 'Escritura', 'Crear y modificar reservas, clientes, servicios y productos'),
  webhooks('webhooks', 'Webhooks', 'Recibir y gestionar eventos de la plataforma'),
  admin('admin', 'Administración', 'Gestión completa del tenant (usar con cuidado)');

  final String code;
  final String label;
  final String description;

  const ApiKeyScope(this.code, this.label, this.description);

  static ApiKeyScope fromCode(String code) {
    return ApiKeyScope.values.firstWhere(
      (e) => e.code == code,
      orElse: () => ApiKeyScope.read,
    );
  }

  static List<ApiKeyScope> fromCodes(List<String> codes) {
    return codes.map((c) => fromCode(c)).toList();
  }

  static List<String> toCodes(List<ApiKeyScope> scopes) {
    return scopes.map((s) => s.code).toList();
  }
}

enum UsageMetricType {
  apiCalls('API_CALLS', 'Llamadas API', Icons.cloud_outlined),
  bookings('ONLINE_BOOKING', 'Reservas online', Icons.calendar_today),
  staff('TEAM_SEATS', 'Asientos de equipo', Icons.people_outline),
  mapVisibility('MAP_VISIBILITY', 'Visibilidad en mapa', Icons.map_outlined),
  analytics('ADVANCED_ANALYTICS', 'Analítica avanzada', Icons.insights_outlined),
  branding('CUSTOM_BRANDING', 'Marca personalizada', Icons.palette_outlined),
  whatsapp('WHATSAPP_INTEGRATION', 'WhatsApp', Icons.chat_outlined),
  pos('POS_INTEGRATION', 'Integración POS', Icons.point_of_sale_outlined);

  final String code;
  final String label;
  final IconData icon;

  const UsageMetricType(this.code, this.label, this.icon);

  /// Features booleanas (1/0), no consumibles por unidades.
  bool get isBoolean =>
      this == UsageMetricType.mapVisibility ||
      this == UsageMetricType.analytics ||
      this == UsageMetricType.branding ||
      this == UsageMetricType.whatsapp ||
      this == UsageMetricType.pos;

  static UsageMetricType fromCode(String code) {
    final clean = code.toUpperCase().trim();
    return UsageMetricType.values.firstWhere(
      (e) => e.code == clean,
      orElse: () => UsageMetricType.apiCalls,
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// MODELS
// ═══════════════════════════════════════════════════════════════

/// Plan SaaS con límites y características
@immutable
class SaasPlan {
  final String id;
  final SaasPlanTier tier;
  final String name;
  final String description;
  final int priceCents; // COP * 100
  final int trialDays;
  final Map<String, int> limits; // metric_code -> limit
  final List<String> features;
  final bool isActive;
  final bool isPopular;

  const SaasPlan({
    required this.id,
    required this.tier,
    required this.name,
    required this.description,
    required this.priceCents,
    required this.trialDays,
    required this.limits,
    required this.features,
    required this.isActive,
    this.isPopular = false,
  });

  factory SaasPlan.fromJson(Map<String, dynamic> json) {
    return SaasPlan(
      id: json['id'] as String? ?? '',
      tier: SaasPlanTier.fromCode(json['tier'] as String? ?? 'FREE_TRIAL'),
      name: json['name'] as String? ?? '',
      description: json['description'] as String? ?? '',
      priceCents: (json['price_cents'] as num? ?? 0).toInt(),
      trialDays: (json['trial_days'] as num? ?? 0).toInt(),
      limits: (json['limits'] as Map<String, dynamic>?)
              ?.map((k, v) => MapEntry(k, (v as num).toInt())) ??
          {},
      features: (json['features'] as List<dynamic>?)
              ?.map((e) => e as String)
              .toList() ??
          [],
      isActive: json['is_active'] as bool? ?? true,
      isPopular: json['is_popular'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'tier': tier.code,
        'name': name,
        'description': description,
        'price_cents': priceCents,
        'trial_days': trialDays,
        'limits': limits,
        'features': features,
        'is_active': isActive,
        'is_popular': isPopular,
      };

  int getLimit(UsageMetricType type) => limits[type.code] ?? 0;
  bool hasFeature(String feature) => features.contains(feature);
}

/// Perfil de negocio con campos SaaS
@immutable
class SaasBusinessProfile {
  final String id;
  final String ownerId;
  final String name;
  final String slug;
  final String? description;
  final String? logoUrl;
  final String timezone;
  final String currency;
  final SaasPlanTier currentPlan;
  final String? planId;
  final DateTime? trialEndsAt;
  final DateTime createdAt;
  final DateTime updatedAt;
  final bool isActive;

  const SaasBusinessProfile({
    required this.id,
    required this.ownerId,
    required this.name,
    required this.slug,
    this.description,
    this.logoUrl,
    required this.timezone,
    required this.currency,
    required this.currentPlan,
    this.planId,
    this.trialEndsAt,
    required this.createdAt,
    required this.updatedAt,
    required this.isActive,
  });

  factory SaasBusinessProfile.fromJson(Map<String, dynamic> json) {
    return SaasBusinessProfile(
      id: json['id'] as String? ?? '',
      ownerId: json['owner_id']?.toString() ?? '',
      name: json['name'] as String? ?? '',
      slug: json['slug'] as String? ?? '',
      description: json['description'] as String?,
      logoUrl: json['logo_url'] as String?,
      timezone: json['timezone'] as String? ?? 'America/Bogota',
      currency: json['currency'] as String? ?? 'COP',
      currentPlan: SaasPlanTier.fromCode(
        _asString(json, ['current_plan', 'saas_plan', 'plan'], 'FREE_TRIAL'),
      ),
      planId: _pick(json, ['plan_id', 'planId']) as String?,
      trialEndsAt: _asDate(json, ['trial_ends_at', 'trialEndsAt']),
      createdAt: _asDate(json, ['created_at', 'createdAt']) ?? DateTime.now(),
      updatedAt: _asDate(json, ['updated_at', 'updatedAt']) ?? DateTime.now(),
      isActive: _pick(json, ['is_active', 'isActive']) as bool? ?? true,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'owner_id': ownerId,
        'name': name,
        'slug': slug,
        'description': description,
        'logo_url': logoUrl,
        'timezone': timezone,
        'currency': currency,
        'current_plan': currentPlan.code,
        'plan_id': planId,
        'trial_ends_at': trialEndsAt?.toIso8601String(),
        'created_at': createdAt.toIso8601String(),
        'updated_at': updatedAt.toIso8601String(),
        'is_active': isActive,
      };

  bool get isOnTrial => currentPlan == SaasPlanTier.freeTrial && trialEndsAt != null;
  bool get isTrialExpired => isOnTrial && DateTime.now().isAfter(trialEndsAt!);
  int get trialDaysRemaining {
    if (!isOnTrial) return 0;
    final diff = trialEndsAt!.difference(DateTime.now());
    return diff.inDays.clamp(0, 999);
  }
}

/// Membresía del usuario en un negocio
@immutable
class Membership {
  final String id;
  final String userId;
  final String businessProfileId;
  final MembershipRole role;
  final DateTime joinedAt;
  final bool isActive;

  const Membership({
    required this.id,
    required this.userId,
    required this.businessProfileId,
    required this.role,
    required this.joinedAt,
    required this.isActive,
  });

  factory Membership.fromJson(Map<String, dynamic> json) {
    return Membership(
      id: json['id'] as String? ?? '',
      userId: json['user_id']?.toString() ?? '',
      businessProfileId: json['business_profile_id'] as String? ?? '',
      role: MembershipRole.fromCode(json['role'] as String? ?? 'STAFF'),
      joinedAt: DateTime.tryParse(json['joined_at'] as String? ?? '') ?? DateTime.now(),
      isActive: json['is_active'] as bool? ?? true,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'user_id': userId,
        'business_profile_id': businessProfileId,
        'role': role.code,
        'joined_at': joinedAt.toIso8601String(),
        'is_active': isActive,
      };
}

/// Miembro del equipo (usuario + membresía)
@immutable
class TeamMember {
  final String id;
  final String userId;
  final String email;
  final String fullName;
  final String? avatarUrl;
  final MembershipRole role;
  final InvitationStatus invitationStatus;
  final DateTime? invitedAt;
  final DateTime? acceptedAt;
  final DateTime? lastActiveAt;
  final bool isOwner;

  const TeamMember({
    required this.id,
    required this.userId,
    required this.email,
    required this.fullName,
    this.avatarUrl,
    required this.role,
    required this.invitationStatus,
    this.invitedAt,
    this.acceptedAt,
    this.lastActiveAt,
    required this.isOwner,
  });

  factory TeamMember.fromJson(Map<String, dynamic> json) {
    // Backend /api/saas/team devuelve { id, user_id, role, status, email, full_name, ... }.
    final rawStatus = _asString(json, ['invitation_status', 'status'], 'ACCEPTED').toUpperCase();
    final role = MembershipRole.fromCode(_asString(json, ['role'], 'MEMBER'));
    InvitationStatus status;
    switch (rawStatus) {
      case 'ACTIVE':
      case 'ACCEPTED':
        status = InvitationStatus.accepted;
        break;
      case 'PENDING':
      case 'INVITED':
        status = InvitationStatus.pending;
        break;
      case 'REVOKED':
        status = InvitationStatus.revoked;
        break;
      default:
        status = InvitationStatus.expired;
    }
    return TeamMember(
      id: _asString(json, ['id', 'membership_id', 'membershipId']),
      userId: _asString(json, ['user_id', 'userId']),
      email: _asString(json, ['email']),
      fullName: _asString(json, ['full_name', 'fullName', 'name']),
      avatarUrl: _pick(json, ['avatar_url', 'avatarUrl']) as String?,
      role: role,
      invitationStatus: status,
      invitedAt: _asDate(json, ['invited_at', 'invitedAt']),
      acceptedAt: _asDate(json, ['accepted_at', 'acceptedAt']),
      lastActiveAt: _asDate(json, ['last_active_at', 'lastActiveAt']),
      isOwner: _pick(json, ['is_owner', 'isOwner']) as bool? ?? role == MembershipRole.owner,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'user_id': userId,
        'email': email,
        'full_name': fullName,
        'avatar_url': avatarUrl,
        'role': role.code,
        'invitation_status': invitationStatus.code,
        'invited_at': invitedAt?.toIso8601String(),
        'accepted_at': acceptedAt?.toIso8601String(),
        'last_active_at': lastActiveAt?.toIso8601String(),
        'is_owner': isOwner,
      };

  bool get isPending => invitationStatus == InvitationStatus.pending;
  bool get isActive => invitationStatus == InvitationStatus.accepted;
}

/// Invitación a equipo
@immutable
class TeamInvitation {
  final String id;
  final String businessProfileId;
  final String email;
  final MembershipRole role;
  final String invitedByUserId;
  final String? invitedByName;
  final InvitationStatus status;
  final DateTime expiresAt;
  final DateTime createdAt;
  final DateTime? acceptedAt;

  const TeamInvitation({
    required this.id,
    required this.businessProfileId,
    required this.email,
    required this.role,
    required this.invitedByUserId,
    this.invitedByName,
    required this.status,
    required this.expiresAt,
    required this.createdAt,
    this.acceptedAt,
  });

  factory TeamInvitation.fromJson(Map<String, dynamic> json) {
    return TeamInvitation(
      id: json['id'] as String? ?? '',
      businessProfileId: json['business_profile_id'] as String? ?? '',
      email: json['email'] as String? ?? '',
      role: MembershipRole.fromCode(json['role'] as String? ?? 'STAFF'),
      invitedByUserId: json['invited_by_user_id']?.toString() ?? '',
      invitedByName: json['invited_by_name'] as String?,
      status: InvitationStatus.fromCode(json['status'] as String? ?? 'PENDING'),
      expiresAt: DateTime.tryParse(json['expires_at'] as String? ?? '') ?? DateTime.now().add(const Duration(days: 7)),
      createdAt: DateTime.tryParse(json['created_at'] as String? ?? '') ?? DateTime.now(),
      acceptedAt: json['accepted_at'] != null
          ? DateTime.tryParse(json['accepted_at'] as String)
          : null,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'business_profile_id': businessProfileId,
        'email': email,
        'role': role.code,
        'invited_by_user_id': invitedByUserId,
        'invited_by_name': invitedByName,
        'status': status.code,
        'expires_at': expiresAt.toIso8601String(),
        'created_at': createdAt.toIso8601String(),
        'accepted_at': acceptedAt?.toIso8601String(),
      };

  bool get isExpired => DateTime.now().isAfter(expiresAt);
  bool get isPending => status == InvitationStatus.pending && !isExpired;
}

/// Suscripción Stripe
@immutable
class Subscription {
  final String id;
  final String businessProfileId;
  final String stripeSubscriptionId;
  final String stripeCustomerId;
  final SaasPlanTier planTier;
  final SubscriptionStatus status;
  final DateTime currentPeriodStart;
  final DateTime currentPeriodEnd;
  final DateTime? trialEndsAt;
  final DateTime? canceledAt;
  final bool cancelAtPeriodEnd;
  final int quantity;

  const Subscription({
    required this.id,
    required this.businessProfileId,
    required this.stripeSubscriptionId,
    required this.stripeCustomerId,
    required this.planTier,
    required this.status,
    required this.currentPeriodStart,
    required this.currentPeriodEnd,
    this.trialEndsAt,
    this.canceledAt,
    required this.cancelAtPeriodEnd,
    required this.quantity,
  });

  factory Subscription.fromJson(Map<String, dynamic> json) {
    // Acepta camelCase (backend SaaS: plan/periodStart/periodEnd) y snake_case (Stripe).
    final periodStart = _asDate(json, ['current_period_start', 'periodStart', 'currentPeriodStart']);
    final periodEnd = _asDate(json, ['current_period_end', 'periodEnd', 'currentPeriodEnd']);
    return Subscription(
      id: _asString(json, ['id', 'stripe_subscription_id']),
      businessProfileId: _asString(json, ['business_profile_id', 'tenantId', 'tenant_id']),
      stripeSubscriptionId: _asString(json, ['stripe_subscription_id', 'id']),
      stripeCustomerId: _asString(json, ['stripe_customer_id', 'customer', 'customerId']),
      planTier: SaasPlanTier.fromCode(
        _asString(json, ['plan_tier', 'plan', 'currentPlan', 'saas_plan'], 'FREE_TRIAL'),
      ),
      status: SubscriptionStatus.fromCode(_asString(json, ['status'], 'INCOMPLETE')),
      currentPeriodStart: periodStart ?? DateTime.now(),
      currentPeriodEnd: periodEnd ?? DateTime.now(),
      trialEndsAt: _asDate(json, ['trial_ends_at', 'trialEndsAt']),
      canceledAt: _asDate(json, ['canceled_at', 'canceledAt']),
      cancelAtPeriodEnd: _pick(json, ['cancel_at_period_end', 'cancelAtPeriodEnd']) as bool? ?? false,
      quantity: _asInt(json, ['quantity'], 1),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'business_profile_id': businessProfileId,
        'stripe_subscription_id': stripeSubscriptionId,
        'stripe_customer_id': stripeCustomerId,
        'plan_tier': planTier.code,
        'status': status.code,
        'current_period_start': currentPeriodStart.toIso8601String(),
        'current_period_end': currentPeriodEnd.toIso8601String(),
        'trial_ends_at': trialEndsAt?.toIso8601String(),
        'canceled_at': canceledAt?.toIso8601String(),
        'cancel_at_period_end': cancelAtPeriodEnd,
        'quantity': quantity,
      };

  bool get isOnTrial => trialEndsAt != null && DateTime.now().isBefore(trialEndsAt!);
  bool get isActive => status == SubscriptionStatus.active || status == SubscriptionStatus.trialing;
  int get daysUntilRenewal => currentPeriodEnd.difference(DateTime.now()).inDays.clamp(0, 999);

  /// Alias de [planTier] para uso directo en pantallas.
  SaasPlanTier get tier => planTier;
  int get trialDaysLeft {
    if (trialEndsAt == null) return 0;
    return trialEndsAt!.difference(DateTime.now()).inDays.clamp(0, 999);
  }
}

/// Factura
@immutable
class Invoice {
  final String id;
  final String businessProfileId;
  final String stripeInvoiceId;
  final String number;
  final InvoiceStatus status;
  final int amountCents; // COP * 100
  final int amountPaidCents;
  final int amountDueCents;
  final String currency;
  final DateTime issuedAt;
  final DateTime? dueAt;
  final DateTime? paidAt;
  final String? pdfUrl;
  final String? hostedInvoiceUrl;
  final Map<String, dynamic>? metadata;

  const Invoice({
    required this.id,
    required this.businessProfileId,
    required this.stripeInvoiceId,
    required this.number,
    required this.status,
    required this.amountCents,
    required this.amountPaidCents,
    required this.amountDueCents,
    required this.currency,
    required this.issuedAt,
    this.dueAt,
    this.paidAt,
    this.pdfUrl,
    this.hostedInvoiceUrl,
    this.metadata,
  });

  factory Invoice.fromJson(Map<String, dynamic> json) {
    // Backend: { id, number, status, currency, subtotal, tax, total, amountPaid, dueDate, paidAt, createdAt }
    final total = _pick(json, ['total', 'amount_cents']);
    final amountCents = total is num
        ? (json.containsKey('amount_cents') ? total.toInt() : (total * 100).toInt())
        : _asInt(json, ['amount_cents']);
    final paid = _pick(json, ['amountPaid', 'amount_paid', 'amount_paid_cents']);
    final amountPaidCents = paid is num ? (paid * 100).toInt() : 0;
    return Invoice(
      id: _asString(json, ['id']),
      businessProfileId: _asString(json, ['business_profile_id', 'tenantId', 'tenant_id']),
      stripeInvoiceId: _asString(json, ['stripe_invoice_id']),
      number: _asString(json, ['number', 'invoice_number']),
      status: InvoiceStatus.fromCode(_asString(json, ['status'], 'DRAFT')),
      amountCents: amountCents,
      amountPaidCents: amountPaidCents,
      amountDueCents: (amountCents - amountPaidCents).clamp(0, amountCents),
      currency: _asString(json, ['currency'], 'COP'),
      issuedAt: _asDate(json, ['issued_at', 'createdAt', 'periodStart']) ?? DateTime.now(),
      dueAt: _asDate(json, ['due_at', 'dueDate']),
      paidAt: _asDate(json, ['paid_at', 'paidAt']),
      pdfUrl: _pick(json, ['pdf_url', 'pdfUrl']) as String?,
      hostedInvoiceUrl: _pick(json, ['hosted_invoice_url', 'hostedInvoiceUrl']) as String?,
      metadata: json['metadata'] as Map<String, dynamic>?,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'business_profile_id': businessProfileId,
        'stripe_invoice_id': stripeInvoiceId,
        'number': number,
        'status': status.code,
        'amount_cents': amountCents,
        'amount_paid_cents': amountPaidCents,
        'amount_due_cents': amountDueCents,
        'currency': currency,
        'issued_at': issuedAt.toIso8601String(),
        'due_at': dueAt?.toIso8601String(),
        'paid_at': paidAt?.toIso8601String(),
        'pdf_url': pdfUrl,
        'hosted_invoice_url': hostedInvoiceUrl,
        'metadata': metadata,
      };

  String get formattedAmount {
    final pesos = amountCents / 100;
    return '\$${pesos.toStringAsFixed(0).replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]}.')} ${currency}';
  }
}

/// Métrica de uso
@immutable
class UsageMetric {
  final UsageMetricType type;
  final int current;
  final int limit;
  final int? projected;
  final DateTime periodStart;
  final DateTime periodEnd;

  const UsageMetric({
    required this.type,
    required this.current,
    required this.limit,
    this.projected,
    required this.periodStart,
    required this.periodEnd,
  });

  factory UsageMetric.fromJson(Map<String, dynamic> json) {
    // Backend: { feature, used, limit ('unlimited'|null|int), remaining, percentage, status }
    final rawLimit = _pick(json, ['limit', 'limitValue', 'limit_value']);
    final limit = rawLimit is num ? rawLimit.toInt() : 0; // 0 = ilimitado
    final used = _asInt(json, ['current', 'used', 'currentValue', 'current_value']);
    return UsageMetric(
      type: UsageMetricType.fromCode(_asString(json, ['type', 'feature'])),
      current: used,
      limit: limit,
      projected: _pick(json, ['projected']) is num ? (_pick(json, ['projected']) as num).toInt() : null,
      periodStart: _asDate(json, ['period_start', 'periodStart']) ?? DateTime.now(),
      periodEnd: _asDate(json, ['period_end', 'periodEnd']) ?? DateTime.now(),
    );
  }

  Map<String, dynamic> toJson() => {
        'type': type.code,
        'current': current,
        'limit': limit,
        'projected': projected,
        'period_start': periodStart.toIso8601String(),
        'period_end': periodEnd.toIso8601String(),
      };

  double get progress => limit > 0 ? (current / limit).clamp(0.0, 1.0) : 0.0;
  int get remaining => (limit - current).clamp(0, limit);
  bool get isNearLimit => progress >= 0.8;
  bool get isOverLimit => current > limit;
  String get formattedCurrent => type.isBoolean ? (current > 0 ? 'Incluido' : 'No incluido') : current.toString();
  String get formattedLimit => type.isBoolean
      ? ((limit > 0) ? 'Incluido' : 'No incluido')
      : (limit <= 0 ? 'Ilimitado' : limit.toString());
}

/// Alertas de uso
@immutable
class UsageAlert {
  final String id;
  final String businessProfileId;
  final UsageMetricType metricType;
  final double threshold; // 0.8 = 80%
  final int currentValue;
  final int limitValue;
  final DateTime triggeredAt;
  final bool acknowledged;
  final String? message;

  const UsageAlert({
    required this.id,
    required this.businessProfileId,
    required this.metricType,
    required this.threshold,
    required this.currentValue,
    required this.limitValue,
    required this.triggeredAt,
    required this.acknowledged,
    this.message,
  });

  factory UsageAlert.fromJson(Map<String, dynamic> json) {
    final limit = _asInt(json, ['limit_value', 'limitValue', 'limit']);
    final current = _asInt(json, ['current_value', 'currentValue', 'used']);
    return UsageAlert(
      id: _asString(json, ['id', 'feature', 'metric_type']),
      businessProfileId: _asString(json, ['business_profile_id', 'tenantId', 'tenant_id']),
      metricType: UsageMetricType.fromCode(
        _asString(json, ['metric_type', 'metricType', 'feature', 'type']),
      ),
      threshold: (_pick(json, ['threshold']) as num? ?? 0.8).toDouble(),
      currentValue: current,
      limitValue: limit,
      triggeredAt: _asDate(json, ['triggered_at', 'triggeredAt', 'createdAt']) ?? DateTime.now(),
      acknowledged: _pick(json, ['acknowledged']) as bool? ?? false,
      message: _pick(json, ['message']) as String?,
    );
  }

  /// Porcentaje consumido del límite (0 si es ilimitado).
  double get percentageUsed {
    if (limitValue <= 0) return 0;
    return (currentValue / limitValue) * 100;
  }

  /// Severidad derivada: crítico al superar el límite, aviso cerca de él.
  String get severity => percentageUsed >= 100 ? 'critical' : 'warning';

  Map<String, dynamic> toJson() => {
        'id': id,
        'business_profile_id': businessProfileId,
        'metric_type': metricType.code,
        'threshold': threshold,
        'current_value': currentValue,
        'limit_value': limitValue,
        'triggered_at': triggeredAt.toIso8601String(),
        'acknowledged': acknowledged,
        'message': message,
      };
}

/// Resumen de métricas de uso
@immutable
class UsageSummary {
  final List<UsageMetric> metrics;
  final List<UsageAlert> alerts;
  final DateTime periodStart;
  final DateTime periodEnd;

  const UsageSummary({
    required this.metrics,
    required this.alerts,
    required this.periodStart,
    required this.periodEnd,
  });

  factory UsageSummary.fromJson(Map<String, dynamic> json) {
    // Backend: { plan, period: {start, end}, usage: [...], summary: {...} }
    final period = json['period'];
    final periodMap = period is Map<String, dynamic> ? period : const <String, dynamic>{};
    final rawUsage = _pick(json, ['metrics', 'usage']);
    final rawAlerts = _pick(json, ['alerts']);
    final periodStart =
        _asDate(json, ['period_start', 'periodStart']) ?? _asDate(periodMap, ['start']);
    final periodEnd =
        _asDate(json, ['period_end', 'periodEnd']) ?? _asDate(periodMap, ['end']);
    return UsageSummary(
      metrics: (rawUsage as List<dynamic>?)
              ?.whereType<Map<String, dynamic>>()
              .map((e) => UsageMetric.fromJson(e))
              .toList() ??
          [],
      alerts: (rawAlerts as List<dynamic>?)
              ?.whereType<Map<String, dynamic>>()
              .map((e) => UsageAlert.fromJson(e))
              .toList() ??
          [],
      periodStart: periodStart ?? DateTime.now(),
      periodEnd: periodEnd ?? DateTime.now(),
    );
  }

  UsageMetric? getMetric(UsageMetricType type) {
    try {
      return metrics.firstWhere((m) => m.type == type);
    } catch (_) {
      return null;
    }
  }

  int get staffCount => getMetric(UsageMetricType.staff)?.current ?? 0;
  int get bookingsThisMonth => getMetric(UsageMetricType.bookings)?.current ?? 0;
  int get apiCallsThisMonth => getMetric(UsageMetricType.apiCalls)?.current ?? 0;
  List<UsageAlert> get activeAlerts => alerts.where((a) => !a.acknowledged).toList();
}

/// API Key
@immutable
class ApiKey {
  final String id;
  final String businessProfileId;
  final String name;
  final String keyPrefix; // glsk_live_ / glsk_test_
  final String? keySuffix; // Últimos 4 caracteres (solo al crear)
  final List<ApiKeyScope> scopes;
  final int rateLimit; // requests/minute
  final DateTime? lastUsedAt;
  final DateTime? expiresAt;
  final DateTime createdAt;
  final bool isActive;
  final String? createdByUserId;
  /// Key completa — el backend solo la devuelve en la respuesta de creación.
  final String? rawKey;
  final DateTime? revokedAt;

  const ApiKey({
    required this.id,
    required this.businessProfileId,
    required this.name,
    required this.keyPrefix,
    this.keySuffix,
    required this.scopes,
    required this.rateLimit,
    this.lastUsedAt,
    this.expiresAt,
    required this.createdAt,
    required this.isActive,
    this.createdByUserId,
    this.rawKey,
    this.revokedAt,
  });

  factory ApiKey.fromJson(Map<String, dynamic> json) {
    return ApiKey(
      id: _asString(json, ['id']),
      businessProfileId: _asString(json, ['business_profile_id', 'tenantId', 'tenant_id']),
      name: _asString(json, ['name']),
      keyPrefix: _asString(json, ['key_prefix', 'keyPrefix']),
      keySuffix: _pick(json, ['key_suffix', 'keySuffix']) as String?,
      scopes: ApiKeyScope.fromCodes(
        (_pick(json, ['scopes']) as List<dynamic>? ?? const [])
            .map((e) => e.toString())
            .toList(),
      ),
      rateLimit: _asInt(json, ['rate_limit', 'rateLimit'], 60),
      lastUsedAt: _asDate(json, ['last_used_at', 'lastUsedAt']),
      expiresAt: _asDate(json, ['expires_at', 'expiresAt']),
      createdAt: _asDate(json, ['created_at', 'createdAt']) ?? DateTime.now(),
      isActive: _pick(json, ['is_active', 'isActive']) as bool? ?? true,
      createdByUserId: _pick(json, ['created_by_user_id', 'createdBy'])?.toString(),
      rawKey: _pick(json, ['key', 'raw_key', 'rawKey']) as String?,
      revokedAt: _asDate(json, ['revoked_at', 'revokedAt']),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'business_profile_id': businessProfileId,
        'name': name,
        'key_prefix': keyPrefix,
        'key_suffix': keySuffix,
        'scopes': ApiKeyScope.toCodes(scopes),
        'rate_limit': rateLimit,
        'last_used_at': lastUsedAt?.toIso8601String(),
        'expires_at': expiresAt?.toIso8601String(),
        'created_at': createdAt.toIso8601String(),
        'is_active': isActive,
        'created_by_user_id': createdByUserId,
      };

  String get displayKey => keySuffix != null ? '$keyPrefix••••$keySuffix' : '$keyPrefix••••••••';
  bool get isExpired => expiresAt != null && DateTime.now().isAfter(expiresAt!);
  String get scopesDisplay => scopes.map((s) => s.label).join(', ');

  /// Alias de [keyPrefix] / key completa si acaba de crearse.
  String get prefix => keyPrefix;
  String get key => rawKey ?? displayKey;
  bool get isRevoked => revokedAt != null || !isActive;
}

/// Request para crear API Key
@immutable
class CreateApiKeyRequest {
  final String name;
  final List<ApiKeyScope> scopes;
  final int? rateLimit;
  final int? expiresInDays;

  const CreateApiKeyRequest({
    required this.name,
    required this.scopes,
    this.rateLimit,
    this.expiresInDays,
  });

  Map<String, dynamic> toJson() => {
        'name': name,
        'scopes': ApiKeyScope.toCodes(scopes),
        if (rateLimit != null) 'rateLimit': rateLimit,
        if (expiresInDays != null) 'expiresInDays': expiresInDays,
      };
}

/// Request para crear business profile (onboarding)
@immutable
class CreateBusinessProfileRequest {
  final String name;
  final String slug;
  final String? description;
  final String timezone;
  final String currency;
  final String planId; // tier code or plan ID

  const CreateBusinessProfileRequest({
    required this.name,
    required this.slug,
    this.description,
    required this.timezone,
    required this.currency,
    required this.planId,
  });

  Map<String, dynamic> toJson() => {
        'name': name,
        'slug': slug,
        'description': description,
        'timezone': timezone,
        'currency': currency,
        'plan_id': planId,
      };
}

/// Request para invitar miembro
@immutable
class InviteMemberRequest {
  final String email;
  final MembershipRole role;

  const InviteMemberRequest({
    required this.email,
    required this.role,
  });

  Map<String, dynamic> toJson() => {
        'email': email,
        'role': role.code,
      };
}

/// Request para checkout Stripe
@immutable
class CreateCheckoutRequest {
  final String planId;
  final String successUrl;
  final String cancelUrl;
  final String currency;
  final String? promotionCode;

  const CreateCheckoutRequest({
    required this.planId,
    required this.successUrl,
    required this.cancelUrl,
    this.currency = 'COP',
    this.promotionCode,
  });

  Map<String, dynamic> toJson() => {
        'plan_id': planId,
        'success_url': successUrl,
        'cancel_url': cancelUrl,
        if (promotionCode != null) 'promotion_code': promotionCode,
      };
}

/// Respuesta de checkout
@immutable
class CheckoutSessionResponse {
  final String sessionId;
  final String url;
  final DateTime expiresAt;

  const CheckoutSessionResponse({
    required this.sessionId,
    required this.url,
    required this.expiresAt,
  });

  factory CheckoutSessionResponse.fromJson(Map<String, dynamic> json) {
    return CheckoutSessionResponse(
      sessionId: _asString(json, ['sessionId', 'session_id', 'paymentLinkId']),
      url: _asString(json, ['url', 'checkoutUrl', 'checkout_url']),
      expiresAt: _asDate(json, ['expires_at', 'expiresAt']) ??
          DateTime.now().add(const Duration(hours: 1)),
    );
  }
}