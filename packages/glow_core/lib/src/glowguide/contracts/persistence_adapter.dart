// lib/glowguide/contracts/persistence_adapter.dart
// Contrato de adaptador de persistencia para GlowGuide
// El Engine NO posee SharedPreferences; delega a PersistenceAdapter.

/// Contrato para leer/escribir estado de completado de guías.
abstract class PersistenceAdapter {
  /// Lee si una guía está completada.
  Future<bool> isGuideCompleted(String guideId);

  /// Lee si una guía fue descartada (estado operacional de sesión, no persistido automáticamente).
  Future<bool> isGuideDismissed(String guideId);

  /// Escribe estado de completado.
  Future<void> markGuideCompleted(String guideId);

  /// Lee clave legacy para migración.
  Future<bool> readLegacyTutorialSeen();

  /// Limpia todo estado de GlowGuide (testing/debug).
  Future<void> clearAll();
}

/// Claves canónicas:
/// - glowguide_completed_<guideId> (bool)
/// Legacy: seen_aura_tutorial (bool)
///
/// NO persistir:
/// - currentStep
/// - resume state
/// - dismissed (solo estado operacional de sesión)