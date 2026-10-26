import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum AudienceMode {
  all,
  men,
  women,
}

class AudienceService {
  static const String _prefKey = 'user_audience_mode';

  /// Notificador de estado reactivo global
  static final ValueNotifier<AudienceMode> currentAudience =
      ValueNotifier<AudienceMode>(AudienceMode.all);

  /// Carga la preferencia guardada
  static Future<void> init() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedValue = prefs.getString(_prefKey);
      if (savedValue != null) {
        if (savedValue == 'men') {
          currentAudience.value = AudienceMode.men;
        } else if (savedValue == 'women') {
          currentAudience.value = AudienceMode.women;
        } else {
          currentAudience.value = AudienceMode.all;
        }
      }
    } catch (e) {
      debugPrint('Error cargando la preferencia de audiencia: $e');
    }
  }

  /// Cambia el modo de audiencia y lo persiste
  static Future<void> setAudience(AudienceMode mode) async {
    currentAudience.value = mode;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefKey, mode.name);
    } catch (e) {
      debugPrint('Error guardando la preferencia de audiencia: $e');
    }
  }

  /// Retorna true si el modo de hombres está activo
  static bool get isMenMode => currentAudience.value == AudienceMode.men;

  /// Retorna el filtro de API o backend equivalente
  static String get apiFilter {
    switch (currentAudience.value) {
      case AudienceMode.men:
        return 'male';
      case AudienceMode.women:
        return 'female';
      case AudienceMode.all:
      default:
        return 'all';
    }
  }
}
