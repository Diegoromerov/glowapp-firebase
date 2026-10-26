// lib/glowguide/model/glowguide_action.dart
// Modelo de acción declarativa para GlowGuide

import '../utils/glowguide_utils.dart';

/// Tipos de acciones soportadas por GlowGuide
enum GlowGuideActionType {
  /// Resaltar un elemento en la UI (highlight visual)
  highlight,
  /// Navegar a una ruta
  navigate,
  /// Abrir un widget/pantalla modal
  open,
  /// Cerrar un widget/pantalla modal
  close,
  /// Enfocar un elemento (scroll, focus)
  focus,
  /// Esperar (delay, sincronía con audio)
  wait,
  /// Acción personalizada
  custom,
}

/// Acción declarativa que GlowGuide puede ejecutar
/// En FASE 1 son solo modelos; la ejecución real ocurre en fases posteriores
class GlowGuideAction {
  /// Tipo de acción
  final GlowGuideActionType type;

  /// Identificador del target (ruta, key de widget, etc.)
  final String target;

  /// Parámetros adicionales según el tipo de acción
  final Map<String, dynamic> parameters;

  /// Duración estimada de la acción en ms
  final int estimatedDurationMs;

  /// Si la acción debe completarse antes de avanzar al siguiente paso
  final bool blocking;

  /// Metadatos extensibles
  final Map<String, dynamic> metadata;

  const GlowGuideAction({
    required this.type,
    required this.target,
    this.parameters = const {},
    this.estimatedDurationMs = 1000,
    this.blocking = true,
    this.metadata = const {},
  });

  /// Acción de navegación a ruta
  factory GlowGuideAction.navigate({
    required String route,
    Map<String, dynamic> arguments = const {},
    int estimatedDurationMs = 1500,
    bool blocking = true,
  }) {
    return GlowGuideAction(
      type: GlowGuideActionType.navigate,
      target: route,
      parameters: {'arguments': arguments},
      estimatedDurationMs: estimatedDurationMs,
      blocking: blocking,
    );
  }

  /// Acción de highlight visual
  factory GlowGuideAction.highlight({
    required String uiTargetKey,
    Map<String, dynamic> style = const {},
    int estimatedDurationMs = 2000,
    bool blocking = false,
  }) {
    return GlowGuideAction(
      type: GlowGuideActionType.highlight,
      target: uiTargetKey,
      parameters: {'style': style},
      estimatedDurationMs: estimatedDurationMs,
      blocking: blocking,
    );
  }

  /// Acción de abrir modal/widget
  factory GlowGuideAction.open({
    required String widgetId,
    Map<String, dynamic> config = const {},
    int estimatedDurationMs = 500,
    bool blocking = false,
  }) {
    return GlowGuideAction(
      type: GlowGuideActionType.open,
      target: widgetId,
      parameters: {'config': config},
      estimatedDurationMs: estimatedDurationMs,
      blocking: blocking,
    );
  }

  /// Acción de cerrar
  factory GlowGuideAction.close({
    required String widgetId,
    int estimatedDurationMs = 300,
    bool blocking = false,
  }) {
    return GlowGuideAction(
      type: GlowGuideActionType.close,
      target: widgetId,
      estimatedDurationMs: estimatedDurationMs,
      blocking: blocking,
    );
  }

  /// Acción de focus/scroll
  factory GlowGuideAction.focus({
    required String uiTargetKey,
    Map<String, dynamic> options = const {},
    int estimatedDurationMs = 800,
    bool blocking = true,
  }) {
    return GlowGuideAction(
      type: GlowGuideActionType.focus,
      target: uiTargetKey,
      parameters: {'options': options},
      estimatedDurationMs: estimatedDurationMs,
      blocking: blocking,
    );
  }

  /// Acción de espera
  factory GlowGuideAction.wait({
    required int durationMs,
    String reason = 'wait',
  }) {
    return GlowGuideAction(
      type: GlowGuideActionType.wait,
      target: reason,
      estimatedDurationMs: durationMs,
      blocking: true,
    );
  }

  /// Acción personalizada
  factory GlowGuideAction.custom({
    required String actionId,
    required Map<String, dynamic> parameters,
    int estimatedDurationMs = 1000,
    bool blocking = true,
  }) {
    return GlowGuideAction(
      type: GlowGuideActionType.custom,
      target: actionId,
      parameters: parameters,
      estimatedDurationMs: estimatedDurationMs,
      blocking: blocking,
    );
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is GlowGuideAction &&
        other.type == type &&
        other.target == target &&
        mapEquals(other.parameters, parameters) &&
        other.estimatedDurationMs == estimatedDurationMs &&
        other.blocking == blocking &&
        mapEquals(other.metadata, metadata);
  }

  @override
  int get hashCode {
    return Object.hash(
      type,
      target,
      parameters,
      estimatedDurationMs,
      blocking,
      metadata,
    );
  }

  @override
  String toString() {
    return 'GlowGuideAction(type: $type, target: $target, blocking: $blocking)';
  }
}