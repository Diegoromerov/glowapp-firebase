// apps/glow_client/test/auth_gate_test.dart
//
// El flujo nuevo abre la app en modo exploración y pide cuenta solo en la
// acción concreta. Este test fija ese contrato: sin sesión, la acción no se
// ejecuta y aparece la hoja; si el usuario elige seguir explorando, la acción
// queda cancelada sin navegar.
//
// La comprobación de sesión se inyecta para no depender del almacén cifrado,
// que en el entorno de test no responde (el plugin no está registrado).
import 'dart:io';

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

    expect(find.text('Necesitás una cuenta para reservar una cita'), findsOneWidget);
    expect(find.text('Continuar'), findsOneWidget);
    expect(find.text('Crear cuenta con correo'), findsOneWidget);
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
    expect(find.text('Necesitás una cuenta para reservar una cita'), findsNothing);
  });

  testWidgets('con sesión la acción continúa sin mostrar la hoja', (tester) async {
    final resultados = <bool>[];
    await montar(tester, resultados, comprobar: conSesion);

    await tester.tap(find.text('Acción'));
    await tester.pumpAndSettle();

    expect(resultados, [true]);
    expect(find.text('Continuar'), findsNothing);
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

  /// Regresión: un usuario nuevo que quiere entrar con Google no debe tener que
  /// elegir "Ya tengo cuenta". El primario abre la pantalla donde vive GIS.
  testWidgets('«Continuar» abre /auth/login y «Crear cuenta con correo» abre /auth/register',
      (tester) async {
    Future<void> abrir(bool primario) async {
      await tester.pumpWidget(
        MaterialApp(
          initialRoute: '/',
          routes: {
            '/': (_) => Scaffold(
                  body: Builder(
                    builder: (context) => ElevatedButton(
                      onPressed: () => AuthGate.requerir(
                        context,
                        accion: 'reservar una cita',
                        comprobarSesion: () async => false,
                      ),
                      child: const Text('Abrir'),
                    ),
                  ),
                ),
            '/auth/login': (_) => const Scaffold(body: Text('PANTALLA_LOGIN')),
            '/auth/register': (_) => const Scaffold(body: Text('PANTALLA_REGISTRO')),
          },
        ),
      );
      await tester.tap(find.text('Abrir'));
      await tester.pumpAndSettle();
      await tester.tap(find.text(primario ? 'Continuar' : 'Crear cuenta con correo'));
      await tester.pumpAndSettle();
    }

    await abrir(true);
    expect(find.text('PANTALLA_LOGIN'), findsOneWidget,
        reason: 'el CTA primario debe llevar a la pantalla con Google');

    await tester.pumpWidget(const SizedBox());
    await abrir(false);
    expect(find.text('PANTALLA_REGISTRO'), findsOneWidget,
        reason: 'el camino de correo debe llevar al formulario de registro');
  });

  /// Facebook y Apple solo mostraban "disponible próximamente"; Apple ni tiene
  /// endpoint. El botón muerto en la pantalla de acceso cuesta más que su falta.
  test('el acceso no ofrece proveedores que no funcionan', () {
    final src = File('lib/screens/auth/login_screen.dart').readAsStringSync();
    expect(src.contains("_avisarProximamente('Facebook')"), isFalse);
    expect(src.contains("_avisarProximamente('Apple')"), isFalse);
  });
}
