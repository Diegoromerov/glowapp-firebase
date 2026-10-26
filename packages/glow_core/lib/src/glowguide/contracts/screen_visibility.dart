// lib/glowguide/contracts/screen_visibility.dart
// Contrato de confirmación de visibilidad de pantalla para GlowGuide
// Utiliza NavigatorObserver como mecanismo primario aprobado.

import 'dart:async';
import 'package:flutter/widgets.dart';

typedef ScreenVisibilityCallback = void Function(String routeName, ScreenVisibilityStatus);

enum ScreenVisibilityStatus { visible, hidden, removed }

/// Observer que confirma cuando una ruta se vuelve visible mediante NavigatorObserver.
/// didPush() confirma que Navigator realizó el push de la ruta objetivo.
/// NO garantiza renderizado completo; solo confirmación de push.
class ScreenVisibilityObserver extends NavigatorObserver {
  final Map<String, Completer<ScreenVisibilityStatus>> _pending = {};

  /// Registra interés en la visibilidad de una ruta.
  /// Completa cuando la ruta es empujada (didPush), o timeout.
  Future<ScreenVisibilityStatus> waitForVisible(
    String routeName,
    Duration timeout,
  ) {
    final completer = Completer<ScreenVisibilityStatus>();
    _pending[routeName] = completer;

    // Timeout de seguridad
    Future.delayed(timeout, () {
      final pending = _pending.remove(routeName);
      if (pending != null && !pending.isCompleted) {
        pending.complete(ScreenVisibilityStatus.hidden);
      }
    });

    return completer.future;
  }

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    final name = route.settings.name;
    if (name != null && _pending.containsKey(name)) {
      final pending = _pending.remove(name);
      if (pending != null && !pending.isCompleted) {
        pending.complete(ScreenVisibilityStatus.visible);
      }
    }
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    final name = route.settings.name;
    if (name != null && _pending.containsKey(name)) {
      final pending = _pending.remove(name);
      if (pending != null && !pending.isCompleted) {
        pending.complete(ScreenVisibilityStatus.removed);
      }
    }
  }
}