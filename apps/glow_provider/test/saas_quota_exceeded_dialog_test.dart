import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glow_core.dart';
import 'package:glow_provider/screens/booking/saas_quota_exceeded_dialog.dart';

void main() {
  testWidgets('muestra el consumo y permite abrir Facturación', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => showDialog<void>(
                context: context,
                builder: (_) => SaasQuotaExceededDialog(
                  error: const SaasQuotaExceededException(
                    message: 'El plan alcanzó el límite mensual de reservas.',
                    feature: 'DIRECT_BOOKINGS',
                    current: 30,
                    limit: 30,
                    plan: 'FREEMIUM',
                  ),
                  onViewBilling: () =>
                      Navigator.pushNamed(context, '/saas/billing'),
                ),
              ),
              child: const Text('Abrir diálogo'),
            ),
          ),
        ),
        routes: {
          '/saas/billing': (_) =>
              const Scaffold(body: Text('Pantalla de Facturación')),
        },
      ),
    );

    await tester.tap(find.text('Abrir diálogo'));
    await tester.pumpAndSettle();

    expect(find.textContaining('30 de 30 reservas'), findsOneWidget);
    await tester.tap(find.text('Ver Facturación'));
    await tester.pumpAndSettle();
    expect(find.text('Pantalla de Facturación'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
