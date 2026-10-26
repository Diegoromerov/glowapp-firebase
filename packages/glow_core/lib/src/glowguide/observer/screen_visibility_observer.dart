// lib/glowguide/observer/screen_visibility_observer.dart
// Implementación de ScreenVisibilityObserver (NavigatorObserver)
// Registrado en navigatorObservers del MaterialApp para confirmar visibilidad de ruta.

import '../contracts/screen_visibility.dart';

/// Observer singleton compartido.
/// Registrado en MaterialApp.navigatorObservers y usado por el Engine
/// para confirmar cuándo una ruta se vuelve visible.
///
/// didPush() confirma que Navigator realizó el push de la ruta objetivo.
/// NO garantiza renderizado completo.
class ScreenVisibilityObserverSingleton {
  ScreenVisibilityObserverSingleton._();
  static final ScreenVisibilityObserver instance = ScreenVisibilityObserver();
}