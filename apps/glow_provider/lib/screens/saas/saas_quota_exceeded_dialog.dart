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
    final quota = _quotaDescription(error.feature);
    final usage = error.current != null && error.limit != null
        ? ' ${quota.periodLabel}: ${error.current} de ${error.limit} ${quota.unit}.'
        : '';

    return AlertDialog(
      title: Text(quota.title),
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

  _QuotaDescription _quotaDescription(String? feature) {
    switch (feature?.toUpperCase()) {
      case 'DIRECT_BOOKINGS':
        return const _QuotaDescription(
          title: 'Límite mensual de reservas alcanzado',
          periodLabel: 'Uso del mes',
          unit: 'reservas',
        );
      case 'TEAM_SEATS':
        return const _QuotaDescription(
          title: 'Cupo del equipo alcanzado',
          periodLabel: 'Miembros incluidos',
          unit: 'miembros',
        );
      case 'RESOURCES':
        return const _QuotaDescription(
          title: 'Límite de recursos alcanzado',
          periodLabel: 'Recursos registrados',
          unit: 'recursos',
        );
      case 'API_CALLS':
        return const _QuotaDescription(
          title: 'Límite mensual de integraciones alcanzado',
          periodLabel: 'Solicitudes del mes',
          unit: 'solicitudes',
        );
      default:
        return const _QuotaDescription(
          title: 'Límite del plan alcanzado',
          periodLabel: 'Uso actual',
          unit: 'unidades',
        );
    }
  }
}

class _QuotaDescription {
  const _QuotaDescription({
    required this.title,
    required this.periodLabel,
    required this.unit,
  });

  final String title;
  final String periodLabel;
  final String unit;
}
