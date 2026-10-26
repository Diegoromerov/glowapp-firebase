// lib/glowguide/contracts/navigation_delegate.dart
// Contrato de delegación de navegación para GlowGuide
// El Engine NO posee Navigator; delega a NavigationDelegate implementado por Home.

/// Contrato para ejecutar navegación real y confirmar visibilidad de la pantalla objetivo.
abstract class NavigationDelegate {
  /// Solicita navegación a una ruta nombrada.
  /// Retorna un [NavigationResult] que completa cuando la pantalla objetivo
  /// es confirmada visible, o falla/timeout.
  Future<NavigationResult> navigate({
    required String routeName,
    Map<String, dynamic>? arguments,
    required Duration timeout,
  });

  /// Regresa a la ruta home, haciendo pop de rutas intermedias.
  Future<NavigationResult> returnToHome({required Duration timeout});

  /// Cancela cualquier navegación pendiente.
  void cancelPending();
}

/// Resultado de una solicitud de navegación.
class NavigationResult {
  final NavigationStatus status;
  final String? routeName;
  final String? errorMessage;

  const NavigationResult._(this.status, this.routeName, this.errorMessage);

  factory NavigationResult.success(String routeName) =>
      NavigationResult._(NavigationStatus.success, routeName, null);

  factory NavigationResult.failure(String routeName, String error) =>
      NavigationResult._(NavigationStatus.failure, routeName, error);

  factory NavigationResult.timeout(String routeName) =>
      NavigationResult._(NavigationStatus.timeout, routeName, 'Navigation timeout');

  factory NavigationResult.cancelled(String routeName) =>
      NavigationResult._(NavigationStatus.cancelled, routeName, 'Navigation cancelled');
}

enum NavigationStatus { success, failure, timeout, cancelled }