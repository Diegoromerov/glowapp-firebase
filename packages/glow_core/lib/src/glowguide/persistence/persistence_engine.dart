// lib/glowguide/persistence/persistence_engine.dart
// Implementación de PersistenceAdapter usando SharedPreferences
// El Engine delega persistencia a esta implementación.

import 'package:shared_preferences/shared_preferences.dart';
import '../contracts/persistence_adapter.dart';

/// Implementación concreta de PersistenceAdapter con SharedPreferences.
class PersistenceEngine implements PersistenceAdapter {
  static const String _completedPrefix = 'glowguide_completed_';
  static const String _legacyKey = 'seen_aura_tutorial';

  SharedPreferences? _prefs;

  Future<SharedPreferences> _getPrefs() async {
    _prefs ??= await SharedPreferences.getInstance();
    return _prefs!;
  }

  @override
  Future<bool> isGuideCompleted(String guideId) async {
    try {
      final prefs = await _getPrefs();
      return prefs.getBool('$_completedPrefix$guideId') ?? false;
    } catch (_) {
      // Fail-open: si no se puede leer, asumir no completado
      return false;
    }
  }

  @override
  Future<bool> isGuideDismissed(String guideId) async {
    // dismissed NO se persiste automáticamente (solo estado operacional de sesión)
    return false;
  }

  @override
  Future<void> markGuideCompleted(String guideId) async {
    try {
      final prefs = await _getPrefs();
      await prefs.setBool('$_completedPrefix$guideId', true);
    } catch (e) {
      // Non-blocking: log y reintentar en próximo inicio/migración
      // No lanzar excepción para no bloquear el flujo
      print('GlowGuide persistence write failed: $e');
    }
  }

  @override
  Future<bool> readLegacyTutorialSeen() async {
    try {
      final prefs = await _getPrefs();
      return prefs.getBool(_legacyKey) ?? false;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<void> clearAll() async {
    try {
      final prefs = await _getPrefs();
      final keys = prefs.getKeys().where((k) => k.startsWith(_completedPrefix)).toList();
      for (final key in keys) {
        await prefs.remove(key);
      }
      await prefs.remove(_legacyKey);
    } catch (_) {
      // Ignorar errores en limpieza
    }
  }
}