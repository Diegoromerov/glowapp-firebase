// lib/src/glowguide/config/client_guide.dart
// Welcome tour for the eight sections in the client navigation dock.

import '../model/glowguide_action.dart';
import '../model/glowguide_step.dart';

/// Welcome tour for the eight sections in the client navigation dock.
class ClientGuide {
  static const String guideId = 'client_welcome_v1';

  static const List<String> _sections = [
    'Bienvenida',
    'Citas',
    'GlowShop',
    'GlowIA',
    'Perfil',
    'AuraChat',
    'Mapa',
    'Despedida',
  ];

  static final List<GlowGuideStep> steps = List<GlowGuideStep>.generate(
    _sections.length,
    (index) {
      final section = _sections[index];
      final order = index + 1;
      return GlowGuideStep(
        id: 'step_${order.toString().padLeft(2, '0')}_${section.toLowerCase()}',
        order: index,
        estimatedDurationMs: 7000,
        auraContent: const GlowGuideAuraContent(
          // The supplied clips provide their own narration and visuals.
          text: '',
          position: AuraPosition.center,
          visible: true,
          transitionStyle: AuraTransitionStyle.fade,
        ),
        videoAssetId:
            'assets/glowguide/videos/client/step_${order.toString().padLeft(2, '0')}_${section.toLowerCase()}.webm',
        action: GlowGuideAction.custom(
          actionId: 'client_tab',
          parameters: {'index': index},
          estimatedDurationMs: 0,
          blocking: true,
        ),
        nextStepId: index < _sections.length - 1
            ? 'step_${(order + 1).toString().padLeft(2, '0')}_${_sections[index + 1].toLowerCase()}'
            : null,
        metadata: {'section': section, 'tabIndex': index},
      );
    },
  );
}