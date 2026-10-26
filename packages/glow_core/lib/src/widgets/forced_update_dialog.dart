// frontend/lib/widgets/forced_update_dialog.dart
//
// FIX-FLUTTER-06 (P1): diálogo de actualización FORZADA. Es deliberadamente
// bloqueante: `barrierDismissible: false` + `PopScope(canPop: false)` para que
// ni el tap fuera del diálogo ni el botón atrás del sistema permitan seguir
// usando una versión por debajo del mínimo soportado.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/app_update_service.dart';

/// Cuerpo del bloqueo por versión mínima. Normalmente se muestra a través de
/// [showForcedUpdateDialog]; se expone como widget público para poder
/// inspeccionarlo en tests de widget.
class ForcedUpdateDialog extends StatelessWidget {
  final AppUpdateDecision decision;

  /// Acción del CTA. Si es null, el diálogo copia el enlace de tienda al
  /// portapapeles (no se usa `url_launcher`: no es dependencia del proyecto y
  /// este fix no añade paquetes nuevos).
  final VoidCallback? onUpdate;

  const ForcedUpdateDialog({
    super.key,
    required this.decision,
    this.onUpdate,
  });

  Future<void> _defaultUpdate(BuildContext context) async {
    await Clipboard.setData(const ClipboardData(text: AppUpdateService.storeUrl));
    if (!context.mounted) return;
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      const SnackBar(
        content: Text('Enlace de la tienda copiado. Actualiza la app para continuar.'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final instalada = decision.currentVersion ?? 'actual';
    final minima = decision.minimumVersion ?? 'la requerida';

    return PopScope(
      canPop: false,
      child: AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.system_update_alt, size: 22),
            SizedBox(width: 8),
            Expanded(child: Text('Actualización requerida')),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Tu versión instalada ($instalada) ya no es compatible con GlowApp.',
              style: const TextStyle(height: 1.35),
            ),
            const SizedBox(height: 10),
            Text(
              'Necesitas la versión $minima o superior para seguir usando la app.',
              style: const TextStyle(height: 1.35, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 10),
            const Text(
              'Actualiza desde la tienda de aplicaciones para continuar.',
              style: TextStyle(height: 1.35),
            ),
          ],
        ),
        actions: [
          FilledButton(
            onPressed: () {
              if (onUpdate != null) {
                onUpdate!();
              } else {
                _defaultUpdate(context);
              }
            },
            child: const Text('Actualizar ahora'),
          ),
        ],
      ),
    );
  }
}

/// Muestra el bloqueo por versión mínima. No puede cerrarse desde la UI.
Future<void> showForcedUpdateDialog(
  BuildContext context, {
  required AppUpdateDecision decision,
  VoidCallback? onUpdate,
}) {
  return showDialog<void>(
    context: context,
    barrierDismissible: false,
    useRootNavigator: true,
    builder: (_) => ForcedUpdateDialog(decision: decision, onUpdate: onUpdate),
  );
}
