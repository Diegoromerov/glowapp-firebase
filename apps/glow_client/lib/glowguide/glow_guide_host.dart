import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';

/// Monta el GlowGuide POR ENCIMA del Navigator.
///
/// En la app de referencia (`glowapp-frontend-production`) el presenter vive en
/// `MaterialApp.builder`, no dentro de una pantalla. Esa es la diferencia que
/// hace que el guide funcione como navegación: el paso ejecuta
/// `GlowGuideAction.navigate(route: ...)`, la app cambia de sección y el video
/// sigue visible porque está encima de las rutas.
///
/// Montado dentro de `ProvidersScreen` (como estaba), la ruta nueva tapaba el
/// presenter y el guide desaparecía al primer paso.
///
/// El engine es único y vive en [GlowGuideService.instance]; aquí solo se pinta.
/// Por eso el presenter no intercepta taps cuando el guide está apagado: su
/// `build` devuelve un `SizedBox.shrink()` y un box vacío no absorbe hit-testing.
class GlowGuideHost extends StatelessWidget {
  final Widget child;

  const GlowGuideHost({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    final engine = GlowGuideService.instance.engine;
    if (engine == null) return child;

    return Stack(
      fit: StackFit.expand,
      children: [
        child,
        GlowGuidePresenter(
          engine: engine,
          isProvider: false,
          allowVideoTapToAdvance: false,
          onAction: (action) {
            switch (action) {
              case GlowGuidePresenterAction.next:
                engine.next();
                break;
              case GlowGuidePresenterAction.previous:
                engine.previous();
                break;
              case GlowGuidePresenterAction.dismiss:
                engine.dismiss();
                break;
              case GlowGuidePresenterAction.replay:
                engine.replay();
                break;
              case GlowGuidePresenterAction.pause:
                engine.pause();
                break;
              case GlowGuidePresenterAction.resume:
                engine.resume();
                break;
            }
          },
        ),
      ],
    );
  }
}
