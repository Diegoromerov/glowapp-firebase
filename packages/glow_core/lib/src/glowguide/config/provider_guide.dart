import '../model/glowguide_action.dart';
import '../model/glowguide_step.dart';

/// Welcome tour for the seven sections in the provider navigation dock.
class ProviderGuide {
  static const String guideId = 'provider_welcome_v1';

  static const List<String> _sections = [
    'Inicio',
    'Agenda',
    'Wallet',
    'GlowShop',
    'Academia',
    'Chat',
    'Perfil',
  ];

  static final List<GlowGuideStep> steps = List<GlowGuideStep>.generate(
    _sections.length,
    (index) {
      final section = _sections[index];
      final order = index + 1;
      return GlowGuideStep(
        id: 'provider_step_${order.toString().padLeft(2, '0')}',
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
            'assets/glowguide/videos/provider/step_${order.toString().padLeft(2, '0')}_${section.toLowerCase()}.webm',
        action: GlowGuideAction.custom(
          actionId: 'provider_tab',
          parameters: {'index': index},
          estimatedDurationMs: 0,
          blocking: true,
        ),
        nextStepId: index < _sections.length - 1
            ? 'provider_step_${(order + 1).toString().padLeft(2, '0')}'
            : null,
        metadata: {'section': section, 'tabIndex': index},
      );
    },
  );
}
