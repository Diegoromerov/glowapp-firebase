// lib/glowguide/model/glowguide_step.dart
// Modelo de paso declarativo para GlowGuide

import 'glowguide_action.dart';
import '../utils/glowguide_utils.dart';

/// Identificador único para guías
typedef GuideId = String;

/// Identificador único para pasos
typedef StepId = String;

/// Representa un paso declarativo dentro de una guía GlowGuide
class GlowGuideStep {
  /// ID único del paso
  final StepId id;

  /// Orden del paso (0-based)
  final int order;

  /// Duración estimada del paso en milisegundos (para sincronía futura)
  final int estimatedDurationMs;

  /// Contenido para Aura (texto, posición, estado visual)
  final GlowGuideAuraContent auraContent;

  /// Audio asociado
  final String? audioAssetId;

  /// Video asociado para demostración en pantalla
  final String? videoAssetId;

  /// Acción declarativa a ejecutar en este paso
  final GlowGuideAction? action;

  /// Key del widget objetivo en la UI real (para highlight/focus)
  final String? uiTargetKey;

  /// ID del siguiente paso (null si es el último)
  final StepId? nextStepId;

  /// Metadatos extensibles para futuras necesidades
  final Map<String, dynamic> metadata;

  const GlowGuideStep({
    required this.id,
    required this.order,
    this.estimatedDurationMs = 5000,
    required this.auraContent,
    this.audioAssetId,
    this.videoAssetId,
    this.action,
    this.uiTargetKey,
    this.nextStepId,
    this.metadata = const {},
  });

  /// Crea una copia con campos actualizados
  GlowGuideStep copyWith({
    StepId? id,
    int? order,
    int? estimatedDurationMs,
    GlowGuideAuraContent? auraContent,
    String? audioAssetId,
    GlowGuideAction? action,
    String? uiTargetKey,
    StepId? nextStepId,
    Map<String, dynamic>? metadata,
  }) {
    return GlowGuideStep(
      id: id ?? this.id,
      order: order ?? this.order,
      estimatedDurationMs: estimatedDurationMs ?? this.estimatedDurationMs,
      auraContent: auraContent ?? this.auraContent,
      audioAssetId: audioAssetId ?? this.audioAssetId,
      action: action ?? this.action,
      uiTargetKey: uiTargetKey ?? this.uiTargetKey,
      nextStepId: nextStepId ?? this.nextStepId,
      metadata: metadata ?? this.metadata,
    );
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is GlowGuideStep &&
        other.id == id &&
        other.order == order &&
        other.estimatedDurationMs == estimatedDurationMs &&
        other.auraContent == auraContent &&
        other.audioAssetId == audioAssetId &&
        other.action == action &&
        other.uiTargetKey == uiTargetKey &&
        other.nextStepId == nextStepId &&
        mapEquals(other.metadata, metadata);
  }

  @override
  int get hashCode {
    return Object.hash(
      id,
      order,
      estimatedDurationMs,
      auraContent,
      audioAssetId,
      action,
      uiTargetKey,
      nextStepId,
      metadata,
    );
  }

  @override
  String toString() {
    return 'GlowGuideStep(id: $id, order: $order, aura: ${auraContent.text}, action: ${action?.type})';
  }
}

/// Contenido declarativo para la presentación de Aura
/// Abstracción que permite definir qué debe mostrar Aura sin
/// acoplarse a assets concretos (imágenes, animaciones, etc.)
class GlowGuideAuraContent {
  /// Texto principal que Aura "dice" en este paso
  final String text;

  /// Texto secundario/descriptivo opcional
  final String? subtitle;

  /// Posición sugerida en pantalla (normalizada 0.0-1.0)
  final AuraPosition? position;

  /// Estado visual de Aura para este paso
  final AuraVisualState visualState;

  /// Si Aura debe estar visible en este paso
  final bool visible;

  /// Estilo de aparición/desaparición
  final AuraTransitionStyle transitionStyle;

  /// Metadatos extensibles (ej: emoción, gesto, etc.)
  final Map<String, dynamic> metadata;

  const GlowGuideAuraContent({
    required this.text,
    this.subtitle,
    this.position,
    this.visualState = AuraVisualState.speaking,
    this.visible = true,
    this.transitionStyle = AuraTransitionStyle.fade,
    this.metadata = const {},
  });

  /// Contenido vacío (para pasos sin Aura visible)
  static const GlowGuideAuraContent hidden = GlowGuideAuraContent(
    text: '',
    visible: false,
    visualState: AuraVisualState.hidden,
  );

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is GlowGuideAuraContent &&
        other.text == text &&
        other.subtitle == subtitle &&
        other.position == position &&
        other.visualState == visualState &&
        other.visible == visible &&
        other.transitionStyle == transitionStyle &&
        mapEquals(other.metadata, metadata);
  }

  @override
  int get hashCode {
    return Object.hash(
      text,
      subtitle,
      position,
      visualState,
      visible,
      transitionStyle,
      metadata,
    );
  }
}

/// Posición sugerida de Aura en pantalla (coordenadas normalizadas)
class AuraPosition {
  final double x; // 0.0 = izquierda, 1.0 = derecha
  final double y; // 0.0 = arriba, 1.0 = abajo
  final double? width; // ancho relativo opcional
  final double? height; // alto relativo opcional

  const AuraPosition({
    required this.x,
    required this.y,
    this.width,
    this.height,
  });

  /// Posición por defecto (centro inferior)
  static const AuraPosition defaultBottom = AuraPosition(
    x: 0.5,
    y: 0.85,
  );

  /// Posición para welcome (centro)
  static const AuraPosition center = AuraPosition(
    x: 0.5,
    y: 0.5,
  );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AuraPosition &&
          other.x == x &&
          other.y == y &&
          other.width == width &&
          other.height == height;

  @override
  int get hashCode => Object.hash(x, y, width, height);
}

/// Estados visuales de Aura
enum AuraVisualState {
  /// Inactivo, no visible
  idle,
  /// Hablando (reproduciendo audio)
  speaking,
  /// Transicionando entre estados/pasos
  transitioning,
  /// Oculto intencionalmente
  hidden,
}

/// Estilos de transición para Aura
enum AuraTransitionStyle {
  /// Fundido suave
  fade,
  /// Deslizamiento
  slide,
  /// Escala
  scale,
  /// Sin transición (inmediato)
  none,
}