import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';

class SaasQuotaExceededDialog extends StatelessWidget {
  const SaasQuotaExceededDialog({
    super.key,
    required this.error,
    required this.onViewBilling,
  });

  final SaasQuotaExceededException error;
  final VoidCallback onViewBilling;

  @override
  Widget build(BuildContext context) {
    final usage = error.current != null && error.limit != null
        ? ' Uso del mes: ${error.current} de ${error.limit} reservas.'
        : '';

    return AlertDialog(
      title: const Text('Límite mensual alcanzado'),
      content: Text(
        '${error.message}$usage Puedes revisar las opciones de tu plan en Facturación.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Entendido'),
        ),
        FilledButton(
          onPressed: () {
            Navigator.pop(context);
            onViewBilling();
          },
          child: const Text('Ver Facturación'),
        ),
      ],
    );
  }
}
