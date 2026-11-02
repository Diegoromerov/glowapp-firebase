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

  /// Ruta a la que lleva cada paso, en el mismo orden que [_sections].
  /// El guide no es un paginador: navega la app por sus secciones mientras el
  /// video explica cada una (asi funciona la version de referencia en
  /// glowapp-frontend-production). Los pasos 6..8 vuelven a Home porque
  /// AuraChat y Mapa viven en el mismo shell.
  static const List<String> _routes = [
    '/home',
    '/my-bookings',
    '/store',
    '/ideas/aura-welcome',
    '/profile',
    '/chat',
    '/home',
    '/home',
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
        // Antes era `custom('client_tab')`, que el engine ignora
        // (`case GlowGuideActionType.custom: break;`): el video se veia pero la
        // app nunca cambiaba de seccion. `navigate` si la ejecuta mediante
        // GlowGuideService.navigatorKey.
        action: GlowGuideAction.navigate(
          route: _routes[index],
          estimatedDurationMs: 900,
          blocking: true,
        ),
        uiTargetKey: 'client_tab_$index',
        nextStepId: index < _sections.length - 1
            ? 'step_${(order + 1).toString().padLeft(2, '0')}_${_sections[index + 1].toLowerCase()}'
            : null,
        metadata: {'section': section, 'tabIndex': index, 'route': _routes[index]},
      );
    },
  );
}