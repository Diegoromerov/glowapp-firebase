import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Servicio centralizado para gestionar el contexto de la Sede Activa en Flutter.
/// Encapsula SharedPreferences y ofrece un getter síncrono cacheado `activeSalonId`.
class ActiveSalonService extends ChangeNotifier {
  static const String _prefKey = 'active_salon_id';

  static final ActiveSalonService instance = ActiveSalonService._internal();

  ActiveSalonService._internal();

  int? _cachedSalonId;
  bool _initialized = false;

  /// Getter síncrono cacheado para lectura inmediata desde `ApiService._getAuthHeaders()`
  int? get activeSalonId => _cachedSalonId;

  /// Indica si el servicio ya ha sido inicializado desde SharedPreferences
  bool get isInitialized => _initialized;

  /// Inicializa la caché leyendo SharedPreferences al arrancar la app
  Future<void> init([SharedPreferences? mockPrefs]) async {
    try {
      final prefs = mockPrefs ?? await SharedPreferences.getInstance();
      final rawValue = prefs.get(_prefKey);
      _cachedSalonId = normalizeSalonId(rawValue);
      _initialized = true;
      notifyListeners();
    } catch (e) {
      if (kDebugMode) {
        print('⚠️ Error al inicializar ActiveSalonService: $e');
      }
      _cachedSalonId = null;
      _initialized = true;
    }
  }

  /// Normalización estricta de valores almacenados o recibidos.
  /// Devuelve `null` si el valor es nulo, vacio, 'null', '0', 0, negativo o no numérico.
  static int? normalizeSalonId(dynamic rawValue) {
    if (rawValue == null) return null;

    if (rawValue is int) {
      return rawValue > 0 ? rawValue : null;
    }

    if (rawValue is String) {
      final trimmed = rawValue.trim();
      if (trimmed.isEmpty ||
          trimmed == 'null' ||
          trimmed == '0' ||
          trimmed == 'undefined') {
        return null;
      }
      final parsed = int.tryParse(trimmed);
      if (parsed != null && parsed > 0) {
        return parsed;
      }
    }

    return null;
  }

  /// Establece una sede activa y persiste el cambio en SharedPreferences
  Future<void> setActiveSalon(int id, [SharedPreferences? mockPrefs]) async {
    final normalized = normalizeSalonId(id);
    _cachedSalonId = normalized;
    notifyListeners();

    try {
      final prefs = mockPrefs ?? await SharedPreferences.getInstance();
      if (normalized != null) {
        await prefs.setInt(_prefKey, normalized);
      } else {
        await prefs.remove(_prefKey);
      }
    } catch (e) {
      if (kDebugMode) {
        print('⚠️ Error al guardar active_salon_id en prefs: $e');
      }
    }
  }

  /// Limpia la sede activa seleccionada
  Future<void> clear([SharedPreferences? mockPrefs]) async {
    _cachedSalonId = null;
    notifyListeners();

    try {
      final prefs = mockPrefs ?? await SharedPreferences.getInstance();
      await prefs.remove(_prefKey);
    } catch (e) {
      if (kDebugMode) {
        print('⚠️ Error al limpiar active_salon_id en prefs: $e');
      }
    }
  }

  /// Aplica la respuesta del servidor (switch-salon) al store de forma pura y testeable.
  /// Devuelve true si el store fue actualizado con una sede activa válida.
  static Future<bool> applySwitchSalonResponse(Map<String, dynamic>? response, [SharedPreferences? mockPrefs]) async {
    if (response == null || response['success'] != true) {
      return false;
    }
    final rawId = response['active_salon_id'];
    final normalizedId = normalizeSalonId(rawId);
    if (normalizedId != null) {
      await instance.setActiveSalon(normalizedId, mockPrefs);
      return true;
    }
    return false;
  }
}
