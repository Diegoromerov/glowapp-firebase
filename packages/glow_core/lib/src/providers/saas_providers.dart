// lib/providers/saas_providers.dart
/// SAAS PROVIDERS (Riverpod)
/// State management for SaaS functionality.
/// Providers for BusinessProfile, Team, Billing, Usage, API Keys.
library saas_providers;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/foundation.dart';

import '../models/saas/saas_models.dart';
import '../services/saas_api_service.dart';

// ════════════════════════════════════════════════════════════════
// STATE CLASSES
// ═══════════════════════════════════════════════════════════════

/// Estado genérico para async operations
@immutable
class AsyncState<T> {
  final T? data;
  final Object? error;
  final bool isLoading;
  final StackTrace? stackTrace;

  const AsyncState({
    this.data,
    this.error,
    this.isLoading = false,
    this.stackTrace,
  });

  const AsyncState.loading() : this(isLoading: true);
  const AsyncState.data(T data) : this(data: data);
  const AsyncState.error(Object error, [StackTrace? stackTrace])
      : this(error: error, stackTrace: stackTrace);

  bool get hasData => data != null;
  bool get hasError => error != null;

  T get value {
    if (hasData) return data!;
    throw StateError('No data available');
  }

  @override
  String toString() {
    if (isLoading) return 'AsyncState.loading()';
    if (hasError) return 'AsyncState.error($error)';
    if (hasData) return 'AsyncState.data($data)';
    return 'AsyncState.empty()';
  }
}

/// Estado del Business Profile
@immutable
class BusinessProfileState {
  final SaasBusinessProfile? profile;
  final Membership? membership;
  final bool isLoading;
  final Object? error;

  const BusinessProfileState({
    this.profile,
    this.membership,
    this.isLoading = false,
    this.error,
  });

  BusinessProfileState copyWith({
    SaasBusinessProfile? profile,
    Membership? membership,
    bool? isLoading,
    Object? error,
  }) {
    return BusinessProfileState(
      profile: profile ?? this.profile,
      membership: membership ?? this.membership,
      isLoading: isLoading ?? this.isLoading,
      error: error ?? this.error,
    );
  }

  BusinessProfileState loading() => copyWith(isLoading: true);
  BusinessProfileState loaded(SaasBusinessProfile p, Membership m) =>
      copyWith(profile: p, membership: m, isLoading: false, error: null);
  BusinessProfileState failed(Object e) => copyWith(isLoading: false, error: e);
}

/// Estado del Team
@immutable
class TeamState {
  final List<TeamMember> members;
  final List<TeamInvitation> invitations;
  final bool isLoading;
  final Object? error;

  const TeamState({
    this.members = const [],
    this.invitations = const [],
    this.isLoading = false,
    this.error,
  });

  TeamState copyWith({
    List<TeamMember>? members,
    List<TeamInvitation>? invitations,
    bool? isLoading,
    Object? error,
  }) {
    return TeamState(
      members: members ?? this.members,
      invitations: invitations ?? this.invitations,
      isLoading: isLoading ?? this.isLoading,
      error: error ?? this.error,
    );
  }
}

/// Estado de Billing
@immutable
class BillingState {
  final Subscription? subscription;
  final List<Invoice> invoices;
  final List<Map<String, dynamic>> paymentMethods;
  final Map<String, dynamic>? nextPayment;
  final String? currentPlan;
  final bool isLoading;
  final Object? error;

  const BillingState({
    this.subscription,
    this.invoices = const [],
    this.paymentMethods = const [],
    this.nextPayment,
    this.currentPlan,
    this.isLoading = false,
    this.error,
  });

  BillingState copyWith({
    Subscription? subscription,
    List<Invoice>? invoices,
    List<Map<String, dynamic>>? paymentMethods,
    Map<String, dynamic>? nextPayment,
    String? currentPlan,
    bool? isLoading,
    Object? error,
  }) {
    return BillingState(
      subscription: subscription ?? this.subscription,
      invoices: invoices ?? this.invoices,
      paymentMethods: paymentMethods ?? this.paymentMethods,
      nextPayment: nextPayment ?? this.nextPayment,
      currentPlan: currentPlan ?? this.currentPlan,
      isLoading: isLoading ?? this.isLoading,
      error: error ?? this.error,
    );
  }
}

/// Estado de Usage
@immutable
class UsageState {
  final UsageSummary? summary;
  final bool isLoading;
  final Object? error;

  const UsageState({
    this.summary,
    this.isLoading = false,
    this.error,
  });

  UsageState copyWith({
    UsageSummary? summary,
    bool? isLoading,
    Object? error,
  }) {
    return UsageState(
      summary: summary ?? this.summary,
      isLoading: isLoading ?? this.isLoading,
      error: error ?? this.error,
    );
  }
}

/// Estado de API Keys
@immutable
class ApiKeysState {
  final List<ApiKey> keys;
  final bool isLoading;
  final Object? error;

  const ApiKeysState({
    this.keys = const [],
    this.isLoading = false,
    this.error,
  });

  ApiKeysState copyWith({
    List<ApiKey>? keys,
    bool? isLoading,
    Object? error,
  }) {
    return ApiKeysState(
      keys: keys ?? this.keys,
      isLoading: isLoading ?? this.isLoading,
      error: error ?? this.error,
    );
  }
}

/// Estado de Planes
@immutable
class PlansState {
  final List<SaasPlan> plans;
  final bool isLoading;
  final Object? error;

  const PlansState({
    this.plans = const [],
    this.isLoading = false,
    this.error,
  });

  PlansState copyWith({
    List<SaasPlan>? plans,
    bool? isLoading,
    Object? error,
  }) {
    return PlansState(
      plans: plans ?? this.plans,
      isLoading: isLoading ?? this.isLoading,
      error: error ?? this.error,
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// NOTIFIERS
// ═══════════════════════════════════════════════════════════════

class BusinessProfileNotifier extends StateNotifier<BusinessProfileState> {
  BusinessProfileNotifier() : super(const BusinessProfileState());

  Future<void> load() async {
    state = state.loading();
    try {
      final tenant = await SaasApiService.getMyTenant();
      if (tenant != null) {
        state = state.loaded(
          tenant.profile,
          Membership(
            id: '',
            userId: '',
            businessProfileId: tenant.profile.id,
            role: tenant.role,
            joinedAt: tenant.profile.createdAt,
            isActive: true,
          ),
        );
      } else {
        state = state.copyWith(isLoading: false, profile: null);
      }
    } catch (e, st) {
      state = state.failed(e);
      if (kDebugMode) print('BusinessProfileNotifier.load error: $e\n$st');
    }
  }

  /// Provisiona el tenant desde el salón del usuario (idempotente).
  Future<SaasBusinessProfile> create(CreateBusinessProfileRequest request) async {
    state = state.loading();
    try {
      final profile = await SaasApiService.provisionTenant(plan: request.planId);
      state = state.loaded(profile, Membership(
        id: '',
        userId: '',
        businessProfileId: profile.id,
        role: MembershipRole.owner,
        joinedAt: profile.createdAt,
        isActive: true,
      ));
      return profile;
    } catch (e, st) {
      state = state.failed(e);
      if (kDebugMode) print('BusinessProfileNotifier.create error: $e\n$st');
      rethrow;
    }
  }

  Future<void> refresh() => load();
}

class TeamNotifier extends StateNotifier<TeamState> {
  TeamNotifier() : super(const TeamState());

  Future<void> load(String businessProfileId) async {
    state = state.copyWith(isLoading: true);
    try {
      final members = await SaasApiService.getTeamMembers(businessProfileId);
      // El backend no expone un listado aparte de invitaciones: se derivan
      // de las memberships en estado PENDING.
      final invitations = members
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
      state = state.copyWith(
        members: members,
        invitations: invitations,
        isLoading: false,
        error: null,
      );
    } catch (e, st) {
      state = state.copyWith(isLoading: false, error: e);
      if (kDebugMode) print('TeamNotifier.load error: $e\n$st');
    }
  }

  Future<void> invite(String businessProfileId, InviteMemberRequest request) async {
    state = state.copyWith(isLoading: true);
    try {
      await SaasApiService.inviteMember(businessProfileId, request);
      await load(businessProfileId);
    } catch (e, st) {
      state = state.copyWith(isLoading: false, error: e);
      if (kDebugMode) print('TeamNotifier.invite error: $e\n$st');
      rethrow;
    }
  }

  Future<void> updateRole(String businessProfileId, String memberId, MembershipRole role) async {
    state = state.copyWith(isLoading: true);
    try {
      await SaasApiService.updateMemberRole(businessProfileId, memberId, role);
      await load(businessProfileId);
    } catch (e, st) {
      state = state.copyWith(isLoading: false, error: e);
      if (kDebugMode) print('TeamNotifier.updateRole error: $e\n$st');
      rethrow;
    }
  }

  Future<void> remove(String businessProfileId, String memberId) async {
    state = state.copyWith(isLoading: true);
    try {
      await SaasApiService.removeMember(businessProfileId, memberId);
      state = state.copyWith(
        members: state.members.where((m) => m.id != memberId).toList(),
        isLoading: false,
      );
    } catch (e, st) {
      state = state.copyWith(isLoading: false, error: e);
      if (kDebugMode) print('TeamNotifier.remove error: $e\n$st');
      rethrow;
    }
  }

  Future<void> resendInvitation(String businessProfileId, String invitationId) async {
    state = state.copyWith(isLoading: true);
    try {
      await SaasApiService.resendInvitation(businessProfileId, invitationId);
      await load(businessProfileId);
    } catch (e, st) {
      state = state.copyWith(isLoading: false, error: e);
      if (kDebugMode) print('TeamNotifier.resendInvitation error: $e\n$st');
      rethrow;
    }
  }
}

class BillingNotifier extends StateNotifier<BillingState> {
  BillingNotifier() : super(const BillingState());

  Future<void> load(String businessProfileId) async {
    state = state.copyWith(isLoading: true);
    try {
      final summary = await SaasApiService.getBillingSummary();
      final rawSub = summary['subscription'];
      final subscription = rawSub is Map<String, dynamic>
          ? Subscription.fromJson(rawSub)
          : null;

      final rawInvoices = (summary['recentInvoices'] as List<dynamic>?) ?? const [];
      List<Invoice> invoices = rawInvoices
          .whereType<Map<String, dynamic>>()
          .map((j) => Invoice.fromJson(j))
          .toList();

      // El resumen trae solo las 10 recientes: pedimos la lista completa si falla no bloquea.
      try {
        invoices = await SaasApiService.getInvoices(businessProfileId);
      } catch (e) {
        if (kDebugMode) print('⚠️ BillingNotifier.getInvoices (usa recientes): $e');
      }

      List<Map<String, dynamic>> methods = const [];
      try {
        methods = await SaasApiService.getPaymentMethods(businessProfileId);
      } catch (e) {
        if (kDebugMode) print('⚠️ BillingNotifier.getPaymentMethods: $e');
      }

      final rawNext = summary['nextPayment'];
      state = state.copyWith(
        subscription: subscription,
        invoices: invoices,
        paymentMethods: methods,
        nextPayment: rawNext is Map<String, dynamic> ? rawNext : null,
        currentPlan: summary['currentPlan'] as String?,
        isLoading: false,
        error: null,
      );
    } catch (e, st) {
      state = state.copyWith(isLoading: false, error: e);
      if (kDebugMode) print('BillingNotifier.load error: $e\n$st');
    }
  }

  Future<CheckoutSessionResponse> createCheckout(
    String businessProfileId,
    CreateCheckoutRequest request,
  ) async {
    state = state.copyWith(isLoading: true);
    try {
      final session = await SaasApiService.createCheckoutSession(businessProfileId, request);
      state = state.copyWith(isLoading: false);
      return session;
    } catch (e, st) {
      state = state.copyWith(isLoading: false, error: e);
      if (kDebugMode) print('BillingNotifier.createCheckout error: $e\n$st');
      rethrow;
    }
  }

  /// Cambia de plan sin checkout (downgrade o upgrade interno).
  Future<void> changePlan(String businessProfileId, SaasPlanTier tier) async {
    state = state.copyWith(isLoading: true);
    try {
      await SaasApiService.changePlan(tier.code);
      await load(businessProfileId);
    } catch (e, st) {
      state = state.copyWith(isLoading: false, error: e);
      if (kDebugMode) print('BillingNotifier.changePlan error: $e\n$st');
      rethrow;
    }
  }

  /// URL del Stripe Billing Portal (tarjetas, facturas). null si no hay customer Stripe.
  Future<String?> portalUrl({String? returnUrl}) =>
      SaasApiService.createPortalSession(returnUrl: returnUrl);

  Future<Subscription> cancelSubscription(String businessProfileId, {bool atPeriodEnd = true}) async {
    state = state.copyWith(isLoading: true);
    try {
      final sub = await SaasApiService.cancelSubscription(businessProfileId, atPeriodEnd: atPeriodEnd);
      state = state.copyWith(subscription: sub, isLoading: false);
      return sub;
    } catch (e, st) {
      state = state.copyWith(isLoading: false, error: e);
      if (kDebugMode) print('BillingNotifier.cancelSubscription error: $e\n$st');
      rethrow;
    }
  }
}

class UsageNotifier extends StateNotifier<UsageState> {
  UsageNotifier() : super(const UsageState());

  Future<void> load(String businessProfileId) async {
    state = state.copyWith(isLoading: true);
    try {
      final summary = await SaasApiService.getUsageSummary(businessProfileId);
      state = state.copyWith(summary: summary, isLoading: false, error: null);
    } catch (e, st) {
      state = state.copyWith(isLoading: false, error: e);
      if (kDebugMode) print('UsageNotifier.load error: $e\n$st');
    }
  }

  /// Descarta una alerta de la vista.
  /// El backend expone DELETE /usage/alerts/:index; sin índice estable en el
  /// modelo, se descarta localmente y se recarga al refrescar.
  Future<void> dismissAlert(String alertId) async {
    if (state.summary == null) return;
    final updatedAlerts =
        state.summary!.alerts.where((a) => a.id != alertId).toList();
    state = state.copyWith(
      summary: UsageSummary(
        metrics: state.summary!.metrics,
        alerts: updatedAlerts,
        periodStart: state.summary!.periodStart,
        periodEnd: state.summary!.periodEnd,
      ),
    );
  }
}

class ApiKeysNotifier extends StateNotifier<ApiKeysState> {
  ApiKeysNotifier() : super(const ApiKeysState());

  Future<void> load(String businessProfileId) async {
    state = state.copyWith(isLoading: true);
    try {
      final keys = await SaasApiService.getApiKeys(businessProfileId);
      state = state.copyWith(keys: keys, isLoading: false, error: null);
    } catch (e, st) {
      state = state.copyWith(isLoading: false, error: e);
      if (kDebugMode) print('ApiKeysNotifier.load error: $e\n$st');
    }
  }

  Future<ApiKey> create(String businessProfileId, CreateApiKeyRequest request) async {
    state = state.copyWith(isLoading: true);
    try {
      final key = await SaasApiService.createApiKey(businessProfileId, request);
      state = state.copyWith(keys: [...state.keys, key], isLoading: false);
      return key;
    } catch (e, st) {
      state = state.copyWith(isLoading: false, error: e);
      if (kDebugMode) print('ApiKeysNotifier.create error: $e\n$st');
      rethrow;
    }
  }

  Future<void> revoke(String businessProfileId, String keyId) async {
    state = state.copyWith(isLoading: true);
    try {
      await SaasApiService.revokeApiKey(businessProfileId, keyId);
      final keys = await SaasApiService.getApiKeys(businessProfileId);
      state = state.copyWith(keys: keys, isLoading: false);
    } catch (e, st) {
      state = state.copyWith(isLoading: false, error: e);
      if (kDebugMode) print('ApiKeysNotifier.revoke error: $e\n$st');
      rethrow;
    }
  }
}

class PlansNotifier extends StateNotifier<PlansState> {
  PlansNotifier() : super(const PlansState());

  Future<void> load() async {
    state = state.copyWith(isLoading: true);
    try {
      final plans = await SaasApiService.getPlans();
      state = state.copyWith(plans: plans, isLoading: false, error: null);
    } catch (e, st) {
      state = state.copyWith(isLoading: false, error: e);
      if (kDebugMode) print('PlansNotifier.load error: $e\n$st');
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// PROVIDERS
// ═══════════════════════════════════════════════════════════════

final businessProfileProvider =
    StateNotifierProvider<BusinessProfileNotifier, BusinessProfileState>((ref) {
  return BusinessProfileNotifier();
});

final teamProvider =
    StateNotifierProvider<TeamNotifier, TeamState>((ref) {
  return TeamNotifier();
});

final billingProvider =
    StateNotifierProvider<BillingNotifier, BillingState>((ref) {
  return BillingNotifier();
});

final usageProvider =
    StateNotifierProvider<UsageNotifier, UsageState>((ref) {
  return UsageNotifier();
});

final apiKeysProvider =
    StateNotifierProvider<ApiKeysNotifier, ApiKeysState>((ref) {
  return ApiKeysNotifier();
});

final plansProvider =
    StateNotifierProvider<PlansNotifier, PlansState>((ref) {
  return PlansNotifier();
});

// Provider para obtener el businessProfileId actual
final currentBusinessProfileIdProvider = Provider<String?>((ref) {
  final profile = ref.watch(businessProfileProvider).profile;
  return profile?.id;
});

// Provider para verificar si tiene business profile
final hasBusinessProfileProvider = Provider<bool>((ref) {
  return ref.watch(businessProfileProvider).profile != null;
});

// Provider combinado para datos del dashboard SaaS
final saasDashboardProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final businessProfileId = ref.watch(currentBusinessProfileIdProvider);
  if (businessProfileId == null) return {};

  final profile = ref.watch(businessProfileProvider).profile;
  final team = ref.watch(teamProvider);
  final billing = ref.watch(billingProvider);
  final usage = ref.watch(usageProvider);

  return {
    'profile': profile,
    'teamCount': team.members.where((m) => m.isActive).length,
    'pendingInvitations': team.invitations.where((i) => i.isPending).length,
    'subscription': billing.subscription,
    'usageSummary': usage.summary,
  };
});