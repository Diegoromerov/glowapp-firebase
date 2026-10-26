// lib/glowguide/state/glowguide_state.dart
// Estado inmutable para GlowGuide

import 'package:flutter/foundation.dart';

/// Estados conceptuales del flujo GlowGuide
enum GlowGuideStatus {
  /// Estado inicial, antes de iniciar
  idle,
  /// Iniciando el flujo
  starting,
  /// Reproduciendo/ejecutando paso actual
  playing,
  /// Ejecutando una acción (navegación, highlight, etc.)
  executingAction,
  /// Pausado por el usuario
  paused,
  /// Completado exitosamente
  completed,
  /// Descartado por el usuario
  dismissed,
}

/// Estado inmutable de GlowGuide
@immutable
class GlowGuideState {
  /// Estado actual del flujo
  final GlowGuideStatus status;

  /// ID del paso actual (null si no hay paso activo)
  final String? currentStepId;

  /// Orden del paso actual (0-based)
  final int currentStepIndex;

  /// Total de pasos en la guía actual
  final int totalSteps;

  /// Información contextual para transiciones
  final Map<String, dynamic> transitionContext;

  /// Si hay un paso siguiente disponible
  final bool hasNext;

  /// Si hay un paso anterior disponible
  final bool hasPrevious;

  /// Si la guía está en reproducción automática
  final bool isAutoPlaying;

  /// Mensaje de error si aplica
  final String? error;

  const GlowGuideState({
    this.status = GlowGuideStatus.idle,
    this.currentStepId,
    this.currentStepIndex = 0,
    this.totalSteps = 0,
    this.transitionContext = const {},
    this.hasNext = false,
    this.hasPrevious = false,
    this.isAutoPlaying = false,
    this.error,
  });

  /// Estado inicial vacío
  static const GlowGuideState initial = GlowGuideState();

  /// Crea una copia con campos actualizados
  GlowGuideState copyWith({
    GlowGuideStatus? status,
    String? currentStepId,
    int? currentStepIndex,
    int? totalSteps,
    Map<String, dynamic>? transitionContext,
    bool? hasNext,
    bool? hasPrevious,
    bool? isAutoPlaying,
    String? error,
  }) {
    return GlowGuideState(
      status: status ?? this.status,
      currentStepId: currentStepId ?? this.currentStepId,
      currentStepIndex: currentStepIndex ?? this.currentStepIndex,
      totalSteps: totalSteps ?? this.totalSteps,
      transitionContext: transitionContext ?? this.transitionContext,
      hasNext: hasNext ?? this.hasNext,
      hasPrevious: hasPrevious ?? this.hasPrevious,
      isAutoPlaying: isAutoPlaying ?? this.isAutoPlaying,
      error: error ?? this.error,
    );
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is GlowGuideState &&
        other.status == status &&
        other.currentStepId == currentStepId &&
        other.currentStepIndex == currentStepIndex &&
        other.totalSteps == totalSteps &&
        mapEquals(other.transitionContext, transitionContext) &&
        other.hasNext == hasNext &&
        other.hasPrevious == hasPrevious &&
        other.isAutoPlaying == isAutoPlaying &&
        other.error == error;
  }

  @override
  int get hashCode {
    return Object.hash(
      status,
      currentStepId,
      currentStepIndex,
      totalSteps,
      transitionContext,
      hasNext,
      hasPrevious,
      isAutoPlaying,
      error,
    );
  }

  @override
  String toString() {
    return 'GlowGuideState(status: $status, step: $currentStepId ($currentStepIndex/${totalSteps - 1}), hasNext: $hasNext, hasPrevious: $hasPrevious)';
  }
}