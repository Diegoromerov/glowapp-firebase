import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_provider/screens/salon/salon_shell.dart';

void main() {
  testWidgets('agenda vacía guía al salón por los pasos de primera operación',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: const SalonShell(
          cargarDatos: false,
          entitlements: <String>[],
          canShowOnMap: false,
        ),
        onGenerateRoute: (settings) => MaterialPageRoute<void>(
          builder: (_) => Scaffold(body: Text(settings.name ?? 'sin ruta')),
        ),
      ),
    );

    expect(find.text('Prepara tu salón para recibir su primera reserva'),
        findsOneWidget);
    expect(find.text('1. Completa la información del salón'), findsOneWidget);
    expect(find.text('2. Configura cuándo puedes atender'), findsOneWidget);
    expect(
      find.textContaining('aún no puede aparecer en el mapa de clientes'),
      findsOneWidget,
    );
    await tester.tap(find.text('Ver perfil del salón'));
    await tester.pumpAndSettle();
    expect(find.text('/salon/profile'), findsOneWidget);
  });

  testWidgets('la guía confirma cuando el salón sí puede aparecer en el mapa',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: SalonShell(
          cargarDatos: false,
          entitlements: <String>[],
          canShowOnMap: true,
        ),
      ),
    );

    expect(
      find.textContaining('está habilitado para aparecer en el mapa'),
      findsOneWidget,
    );
  });

  testWidgets('sin salón activo la guía no abre agenda de otro tenant',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: SalonShell(cargarDatos: false, entitlements: <String>[]),
      ),
    );

    await tester.scrollUntilVisible(
      find.text('4. Recibe una reserva desde GlowApp'),
      300,
      scrollable: find.byType(Scrollable).first,
    );

    final boton = tester.widget<TextButton>(
      find.widgetWithText(TextButton, 'Ver cómo atender citas'),
    );
    expect(boton.onPressed, isNull);
    await tester.scrollUntilVisible(
      find.textContaining('No se identificó un salón activo'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.textContaining('No se identificó un salón activo'),
        findsOneWidget);
  });
}
