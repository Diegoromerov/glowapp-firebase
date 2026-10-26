// lib/services/superadmin_api_service.dart
/// CLIENTE DE LA API SUPERADMIN
/// Contra `backend/src/routes/superAdminRoutes.js` (montado en `/api/superadmin`).
/// El backend exige `authMiddleware` + `superAdminGuard`: sin token de SuperAdmin
/// responde 403, y 401 si no hay sesión. Aquí no se adivina el rol en el cliente:
/// la autoridad es el servidor.
library superadmin_api_service;

import 'package:flutter/foundation.dart';
import 'api_service.dart';
import '../models/superadmin/superadmin_models.dart';

class SuperAdminForbidden implements Exception {
  final String message;
  const SuperAdminForbidden([this.message = 'Se requiere rol SuperAdmin']);
  @override
  String toString() => message;
}

class SuperAdminApiService {
  static const String _basePath = '/api/superadmin';

  /// Traduce el 403/401 del backend a una excepción distinguible: la pantalla de
  /// acceso restringido no debe confundirse con un error de red.
  static Never _mapForbidden(Object error) {
    final text = error.toString();
    if (text.contains('403') || text.contains('401') || text.contains('SuperAdmin')) {
      throw const SuperAdminForbidden();
    }
    throw error;
  }

  /// GET /dashboard → { summary, planDistribution, topApiUsage }
  static Future<SuperAdminDashboard> getDashboard() async {
    try {
      final response = await ApiService.get('$_basePath/dashboard');
      return SuperAdminDashboard.fromJson((response as Map<String, dynamic>?) ?? const {});
    } catch (e) {
      if (kDebugMode) print('❌ SuperAdminApiService.getDashboard: $e');
      _mapForbidden(e);
    }
  }

  /// GET /tenants?page=&limit=&search=&plan=
  static Future<TenantPage> getTenants({
    int page = 1,
    int limit = 20,
    String? search,
    String? plan,
  }) async {
    final params = <String, String>{
      'page': '$page',
      'limit': '$limit',
      if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
      if (plan != null && plan.isNotEmpty) 'plan': plan,
    };
    final query = params.entries
        .map((e) => '${Uri.encodeQueryComponent(e.key)}=${Uri.encodeQueryComponent(e.value)}')
        .join('&');
    try {
      final response = await ApiService.get('$_basePath/tenants?$query');
      return TenantPage.fromJson((response as Map<String, dynamic>?) ?? const {});
    } catch (e) {
      if (kDebugMode) print('❌ SuperAdminApiService.getTenants: $e');
      _mapForbidden(e);
    }
  }

  /// PATCH /tenants/:id/plan → { message, tenantId, newPlan }
  static Future<String> changePlan(String tenantId, String plan, {String? reason}) async {
    try {
      final response = await ApiService.patch(
        '$_basePath/tenants/$tenantId/plan',
        {'plan': plan, if (reason != null && reason.isNotEmpty) 'reason': reason},
      );
      final data = (response as Map<String, dynamic>?) ?? const {};
      return data['message']?.toString() ?? 'Plan actualizado';
    } catch (e) {
      if (kDebugMode) print('❌ SuperAdminApiService.changePlan: $e');
      _mapForbidden(e);
    }
  }

  /// POST /tenants/:id/suspend → { message }
  static Future<String> suspendTenant(String tenantId, {bool suspend = true, String? reason}) async {
    try {
      final response = await ApiService.post(
        '$_basePath/tenants/$tenantId/suspend',
        {
          'suspend': suspend,
          if (reason != null && reason.isNotEmpty) 'reason': reason,
        },
      );
      final data = (response as Map<String, dynamic>?) ?? const {};
      return data['message']?.toString() ?? 'Tenant actualizado';
    } catch (e) {
      if (kDebugMode) print('❌ SuperAdminApiService.suspendTenant: $e');
      _mapForbidden(e);
    }
  }

  /// GET /revenue → { mrrHistory, revenueByPlan, pendingInvoices }
  static Future<RevenueSnapshot> getRevenue() async {
    try {
      final response = await ApiService.get('$_basePath/revenue');
      return RevenueSnapshot.fromJson((response as Map<String, dynamic>?) ?? const {});
    } catch (e) {
      if (kDebugMode) print('❌ SuperAdminApiService.getRevenue: $e');
      _mapForbidden(e);
    }
  }

  /// GET /usage → { aggregated, exceededLimits }
  static Future<UsageSnapshot> getUsage() async {
    try {
      final response = await ApiService.get('$_basePath/usage');
      return UsageSnapshot.fromJson((response as Map<String, dynamic>?) ?? const {});
    } catch (e) {
      if (kDebugMode) print('❌ SuperAdminApiService.getUsage: $e');
      _mapForbidden(e);
    }
  }
}
