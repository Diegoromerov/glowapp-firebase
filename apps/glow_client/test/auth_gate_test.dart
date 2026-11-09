// apps/glow_client/test/auth_gate_test.dart
//
// El flujo nuevo abre la app en modo exploración y pide cuenta solo en la
// acción concreta. Este test fija ese contrato: sin sesión, la acción no se
// ejecuta y aparece la hoja; si el usuario elige seguir explorando, la acción
// queda cancelada sin navegar.
//
// La comprobación de sesión se inyecta para no depender del almacén cifrado,
// que en el entorno de test no responde (el plugin no está registrado).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_client/widgets/auth_gate.dart';

void main() {
  Future<bool> sinSesion() async => false;
  Future<bool> conSesion() async => true;

  Future<void> montar(
    WidgetTester tester,
    List<bool> resultados, {
    Future<bool> Function()? comprobar,
    String accion = 'reservar una cita',
    String? detalle,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () async {
                final ok = await AuthGate.requerir(
                  context,
                  accion: accion,
                  detalle: detalle,
                  comprobarSesion: comprobar ?? sinSesion,
                );
                resultados.add(ok);
              },
              child: const Text('Acción'),
            ),
          ),
        ),
      ),
    );
  }

  testWidgets('sin sesión muestra la hoja con la acción concreta', (tester) async {
    final resultados = <bool>[];
    await montar(tester, resultados);

    await tester.tap(find.text('Acción'));
    await tester.pumpAndSettle();

    expect(find.text('Creá tu cuenta para reservar una cita'), findsOneWidget);
    expect(find.text('Crear cuenta'), findsOneWidget);
    expect(find.text('Ya tengo cuenta'), findsOneWidget);
    expect(find.text('Seguir explorando'), findsOneWidget);
    expect(resultados, isEmpty,
        reason: 'la acción no debe resolverse mientras la hoja está abierta');
  });

  testWidgets('«Seguir explorando» devuelve false y no navega', (tester) async {
    final resultados = <bool>[];
    await montar(tester, resultados);

    await tester.tap(find.text('Acción'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Seguir explorando'));
    await tester.pumpAndSettle();

    expect(resultados, [false]);
    expect(find.text('Creá tu cuenta para reservar una cita'), findsNothing);
  });

  testWidgets('con sesión la acción continúa sin mostrar la hoja', (tester) async {
    final resultados = <bool>[];
    await montar(tester, resultados, comprobar: conSesion);

    await tester.tap(find.text('Acción'));
    await tester.pumpAndSettle();

    expect(resultados, [true]);
    expect(find.text('Crear cuenta'), findsNothing);
  });

  testWidgets('el detalle opcional reemplaza el texto por defecto', (tester) async {
    final resultados = <bool>[];
    await montar(
      tester,
      resultados,
      accion: 'comprar en GlowShop',
      detalle: 'Tu carrito queda guardado mientras te identificás.',
    );

    await tester.tap(find.text('Acción'));
    await tester.pumpAndSettle();

    expect(find.text('Tu carrito queda guardado mientras te identificás.'),
        findsOneWidget);
  });
}
