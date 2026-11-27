import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glow_core.dart';
import 'package:glow_provider/screens/saas/saas_quota_exceeded_dialog.dart';

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

  testWidgets('muestra cupo de equipo con unidad correcta', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SaasQuotaExceededDialog(
            error: const SaasQuotaExceededException(
              message: 'Límite de asientos alcanzado',
              feature: 'TEAM_SEATS',
              current: 3,
              limit: 3,
            ),
            onViewBilling: () {},
          ),
        ),
      ),
    );

    expect(find.text('Cupo del equipo alcanzado'), findsOneWidget);
    expect(find.textContaining('3 de 3 miembros'), findsOneWidget);
  });

  testWidgets('muestra el total de recursos sin llamarlo uso mensual', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SaasQuotaExceededDialog(
            error: const SaasQuotaExceededException(
              message: 'Límite de recursos alcanzado para el plan actual.',
              feature: 'RESOURCES',
              current: 5,
              limit: 5,
            ),
            onViewBilling: () {},
          ),
        ),
      ),
    );

    expect(find.text('Límite de recursos alcanzado'), findsOneWidget);
    expect(find.textContaining('5 de 5 recursos'), findsOneWidget);
    expect(find.textContaining('Uso del mes'), findsNothing);
  });
}
