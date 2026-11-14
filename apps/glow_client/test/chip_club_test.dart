import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glow_core.dart';
import 'package:glow_client/widgets/chip_club.dart';
import 'package:shared_preferences/shared_preferences.dart';

NivelPuntos _nivel(String nombre, int xp) => NivelPuntos(
      nivel: nombre,
      xp: xp,
      otorgadas: 0,
      usadas: 0,
      disponibles: 2,
      xpSiguienteNivel: 900,
      nivelSiguiente: 'Gold',
    );

Widget _envolver(Widget hijo) => MaterialApp(
      home: Scaffold(body: Center(child: hijo)),
      routes: {
        '/niveles': (_) => const Scaffold(body: Text('PANTALLA DEL CLUB')),
      },
    );

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('sin sesión no pinta nada: un botón que lleva a un login es peor',
      (tester) async {
    await tester.pumpWidget(_envolver(
      ChipClub(cargarNivel: () async => _nivel('Pétalo', 350), consultarSesion: () async => false),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Pétalo'), findsNothing);
    expect(find.byType(InkWell), findsNothing);
  });

  testWidgets('muestra el nivel y el XP', (tester) async {
    await tester.pumpWidget(_envolver(
      ChipClub(cargarNivel: () async => _nivel('Pétalo', 350), consultarSesion: () async => true),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Pétalo'), findsOneWidget);
    expect(find.text('350 XP'), findsOneWidget);
    expect(find.text('❋'), findsOneWidget);
  });

  testWidgets('un toque abre el Club', (tester) async {
    await tester.pumpWidget(_envolver(
      ChipClub(cargarNivel: () async => _nivel('Pétalo', 350), consultarSesion: () async => true),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.byType(InkWell));
    await tester.pumpAndSettle();

    expect(find.text('PANTALLA DEL CLUB'), findsOneWidget);
  });

  testWidgets('un código de invitación viejo ya no lo esconde', (tester) async {
    // Se escondía con un código pendiente, y a quien le quedaba uno de una
    // prueba el Club le desaparecía para siempre, sin nada que lo reparara.
    SharedPreferences.setMockInitialValues(
      {'codigoInvitacionPendiente': 'GLOW6DF8'},
    );

    await tester.pumpWidget(_envolver(
      ChipClub(cargarNivel: () async => _nivel('Pétalo', 350), consultarSesion: () async => true),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Pétalo'), findsOneWidget);
  });

  testWidgets('si el backend no responde, el acceso sigue abierto', (tester) async {
    await tester.pumpWidget(_envolver(
      ChipClub(cargarNivel: () async => null, consultarSesion: () async => true),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Mi Club'), findsOneWidget);
  });

  testWidgets('el nivel se nota desde fuera: Oro no se pinta como Pétalo',
      (tester) async {
    Color colorDeFondo() {
      final ink = tester.widget<Ink>(
        find.descendant(of: find.byType(ChipClub), matching: find.byType(Ink)).first,
      );
      final deco = ink.decoration as BoxDecoration;
      return (deco.gradient as LinearGradient).colors.first;
    }

    await tester.pumpWidget(_envolver(
      ChipClub(key: const ValueKey('a'), cargarNivel: () async => _nivel('Pétalo', 350), consultarSesion: () async => true),
    ));
    await tester.pumpAndSettle();
    final petalo = colorDeFondo();

    // Key distinta: sin ella el State se reutiliza y no recarga el nivel.
    await tester.pumpWidget(_envolver(
      ChipClub(key: const ValueKey('b'), cargarNivel: () async => _nivel('Oro', 950), consultarSesion: () async => true),
    ));
    await tester.pumpAndSettle();
    final oro = colorDeFondo();

    expect(petalo, isNot(oro));
  });
}
