// lib/glowguide/contracts/failure_policy.dart
// Política de fallos/timeout unificada para GlowGuide
// Cada operación bloqueante debe tener: éxito, fallo, cancelación, timeout.

/// Constantes de timeout
class FailurePolicy {
  /// Timeout de confirmación de visibilidad de navegación
  static const Duration navigationTimeout = Duration(seconds: 5);

  /// Timeout de completado de audio (protección ante evento faltante)
  static const Duration audioCompletionTimeout = Duration(seconds: 30);

  /// Timeout de inicialización de audio
  static const Duration audioInitTimeout = Duration(seconds: 3);

  /// Reintentos máximos de navegación
  static const int maxNavigationRetries = 1;

  /// Comportamiento ante timeout de navegación
  static NavigationTimeoutBehavior navigationTimeoutBehavior =
      NavigationTimeoutBehavior.skipStep;

  /// Comportamiento ante error de audio
  static AudioErrorBehavior audioErrorBehavior =
      AudioErrorBehavior.skipAudioContinueStep;

  /// Comportamiento ante ruta no disponible
  static RouteUnavailableBehavior routeUnavailableBehavior =
      RouteUnavailableBehavior.skipStep;
}

/// Comportamientos ante fallos
enum NavigationTimeoutBehavior { skipStep, dismissGuide, retryOnce }
enum AudioErrorBehavior { skipAudioContinueStep, pauseGuide, dismissGuide }
enum RouteUnavailableBehavior { skipStep, dismissGuide, showError }

/// Garantía de persistencia:
/// "Completion persistence is non-blocking; write failures are logged and retried on the next startup/migration opportunity."
/// NO se afirma garantía absoluta de persistencia.