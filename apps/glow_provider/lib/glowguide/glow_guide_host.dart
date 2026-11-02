import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';

/// Monta el GlowGuide del PROVEEDOR por encima del Navigator.
///
/// Igual que en el cliente (apps/glow_client/lib/glowguide/glow_guide_host.dart).
/// Antes el presenter vivía dentro de `ProviderDashboardScreen`, así que
/// cualquier ruta que se abriera encima (una cita, el detalle de un servicio, un
/// curso) lo tapaba y el guide desaparecía a mitad del recorrido.
///
/// El engine es único y vive en [GlowGuideService.instance]; aquí solo se pinta.
/// La navegación del guide del provider no son rutas: sus secciones son pestañas
/// del dashboard y las mueve `_onProviderGuideStateChanged` al escuchar el
/// estado del engine.
class GlowGuideProviderHost extends StatelessWidget {
  final Widget child;

  const GlowGuideProviderHost({super.key, required this.child});

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
          isProvider: true,
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
