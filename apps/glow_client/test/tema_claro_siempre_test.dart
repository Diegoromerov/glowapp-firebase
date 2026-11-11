// Regla del Director: la app se ve CLARA en todo momento; la única excepción es
// el selector Hombres, donde la interfaz entera es oscura.
//
// Este test fija las dos mitades de la regla y, además, el defecto concreto que
// se reportó: con el móvil en modo oscuro los campos de formulario tomaban la
// paleta oscura (`surfaceLevel0` #0A0C10) dentro de tarjetas fijas en blanco.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:glow_core/glow_core.dart';
import 'package:glow_client/main.dart';
import 'package:glow_client/screens/auth/login_screen.dart';

const _crema = Color(0xFFFCF8F6); // Token.light.surfaceLevel0
const _obsidiana = Color(0xFF0A0C10); // Token.dark.surfaceLevel0

MaterialApp _app(WidgetTester tester) =>
    tester.widget<MaterialApp>(find.byType(MaterialApp));

void main() {
  tearDown(() {
    // El modo de audiencia es estado global: no debe filtrarse entre tests.
    AudienceService.currentAudience.value = AudienceMode.all;
  });

  testWidgets('móvil en oscuro NO tiñe la app: sigue clara', (tester) async {
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
    AudienceService.currentAudience.value = AudienceMode.women;

    await tester.pumpWidget(const ProviderScope(child: GlowClientApp()));
    await tester.pump(const Duration(milliseconds: 300));

    final app = _app(tester);
    expect(app.themeMode, ThemeMode.light,
        reason: 'la app no debe seguir el brillo del sistema');
    expect(app.theme?.brightness, Brightness.light);
    expect(app.theme?.scaffoldBackgroundColor, _crema);

    // Y que lo que recibe la pantalla montada sea claro de verdad, no sólo el
    // `theme` declarado (con `ThemeMode.system` se resolvería el oscuro).
    final montado = find.byType(Scaffold);
    if (montado.evaluate().isNotEmpty) {
      expect(Theme.of(tester.element(montado.first)).brightness,
          Brightness.light,
          reason: 'la pantalla en curso debe resolver tema claro');
    }
  });

  testWidgets('el campo de formulario toma el relleno claro, no el oscuro',
      (tester) async {
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
    AudienceService.currentAudience.value = AudienceMode.women;

    await tester.pumpWidget(const ProviderScope(child: GlowClientApp()));
    await tester.pump(const Duration(milliseconds: 300));

    await tester.pumpWidget(MaterialApp(
      theme: _app(tester).theme,
      home: const Scaffold(body: S4TextField(hint: 'Correo electrónico')),
    ));
    await tester.pump();

    final campo = tester.widget<TextField>(find.byType(TextField));
    expect(campo.decoration?.fillColor, _crema,
        reason: 'con el móvil en oscuro el campo salía casi negro sobre '
            'tarjeta blanca (surfaceLevel0 #0A0C10)');
  });

  testWidgets('selector Hombres: la interfaz entera es oscura', (tester) async {
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.light;
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
    AudienceService.currentAudience.value = AudienceMode.men;

    await tester.pumpWidget(const ProviderScope(child: GlowClientApp()));
    await tester.pump(const Duration(milliseconds: 300));

    final app = _app(tester);
    expect(app.theme?.brightness, Brightness.dark,
        reason: 'Hombres debe ser oscuro aunque el sistema esté en claro');
    expect(app.theme?.scaffoldBackgroundColor, _obsidiana);

    // Los componentes resuelven la paleta por brillo: en Hombres tienen que
    // recibir la gama obsidiana, no la clara.
    await tester.pumpWidget(MaterialApp(
      theme: app.theme,
      home: const Scaffold(body: S4TextField(hint: 'Correo electrónico')),
    ));
    await tester.pump();
    final campo = tester.widget<TextField>(find.byType(TextField));
    expect(campo.decoration?.fillColor, _obsidiana,
        reason: 'en Hombres el relleno del campo también es oscuro');
  });

  testWidgets('en Hombres el login sigue claro: sin campos oscuros',
      (tester) async {
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
    AudienceService.currentAudience.value = AudienceMode.men;

    await tester.pumpWidget(const ProviderScope(child: GlowClientApp()));
    await tester.pump(const Duration(milliseconds: 300));

    tester.state<NavigatorState>(find.byType(Navigator).first)
        .pushNamed('/auth/login');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));

    final login = find.byType(LoginScreen);
    expect(login, findsOneWidget, reason: 'la ruta /auth/login debe abrirse');
    expect(Theme.of(tester.element(login)).brightness, Brightness.light,
        reason: 'las pantallas de acceso van siempre claras, también en Hombres');

    final campo = tester.widget<TextField>(
        find.descendant(of: login, matching: find.byType(TextField)).first);
    expect(campo.decoration?.fillColor, _crema,
        reason: 'en Hombres el login no debe pintar los campos obsidiana');
  });
}
