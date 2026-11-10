// Ítems 15, 21 y 23 — resiliencia de UI.
//
// Se prueba el comportamiento, no el aspecto: que la franja aparezca solo sin
// red, que el estado vacío explique y ofrezca salida, y que la pantalla recargue
// cuando la app vuelve de verdad del fondo (y no en un simple rebuild).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glow_core.dart';

Widget _envolver(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  tearDown(ConnectivityService.resetForTesting);

  group('FranjaConexion (ítem 21)', () {
    testWidgets('con red no ocupa espacio ni dice nada', (tester) async {
      ConnectivityService.conectado.value = true;
      await tester.pumpWidget(_envolver(const FranjaConexion()));
      await tester.pumpAndSettle();
      expect(find.textContaining('Sin conexión'), findsNothing);
    });

    testWidgets('sin red avisa y ofrece reintentar', (tester) async {
      ConnectivityService.conectado.value = false;
      await tester.pumpWidget(_envolver(const FranjaConexion()));
      await tester.pump();
      expect(find.textContaining('Sin conexión'), findsOneWidget);
      expect(find.text('Reintentar'), findsOneWidget);
    });

    testWidgets('al volver la red, la franja desaparece', (tester) async {
      ConnectivityService.conectado.value = false;
      ConnectivityService.probe = () async => true;
      await tester.pumpWidget(_envolver(const FranjaConexion()));
      await tester.pump();
      expect(find.textContaining('Sin conexión'), findsOneWidget);

      await tester.tap(find.text('Reintentar'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      expect(ConnectivityService.conectado.value, isTrue);
      expect(find.textContaining('Sin conexión'), findsNothing);
    });
  });

  group('EstadoVacio (ítem 15)', () {
    testWidgets('explica el vacío y da una salida', (tester) async {
      var pulsado = false;
      await tester.pumpWidget(_envolver(EstadoVacio(
        icono: Icons.shopping_bag_outlined,
        titulo: 'No hay productos con este filtro',
        detalle: 'Prueba con otra categoría.',
        accionEtiqueta: 'Ver todo',
        onAccion: () => pulsado = true,
      )));
      expect(find.text('No hay productos con este filtro'), findsOneWidget);
      expect(find.text('Prueba con otra categoría.'), findsOneWidget);
      await tester.tap(find.text('Ver todo'));
      expect(pulsado, isTrue);
    });

    testWidgets('sin acción no pinta botón', (tester) async {
      await tester.pumpWidget(_envolver(const EstadoVacio(
        icono: Icons.inbox_outlined,
        titulo: 'Nada por aquí',
      )));
      expect(find.byType(OutlinedButton), findsNothing);
    });
  });

  group('RefreshOnResumeMixin (ítem 23)', () {
    testWidgets('refresca al volver del fondo, no al reconstruir', (tester) async {
      var llamadas = 0;
      await tester.pumpWidget(_envolver(_PantallaPrueba(alRefrescar: () {
        llamadas += 1;
      })));
      expect(llamadas, 0);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(llamadas, 1, reason: 'debe refrescar al volver del fondo');

      // Un rebuild normal no debe contar como vuelta.
      await tester.pumpWidget(_envolver(_PantallaPrueba(alRefrescar: () {
        llamadas += 1;
      })));
      await tester.pump();
      expect(llamadas, 1);
    });
  });
}

class _PantallaPrueba extends StatefulWidget {
  const _PantallaPrueba({required this.alRefrescar});

  final VoidCallback alRefrescar;

  @override
  State<_PantallaPrueba> createState() => _PantallaPruebaState();
}

class _PantallaPruebaState extends State<_PantallaPrueba>
    with RefreshOnResumeMixin<_PantallaPrueba> {
  @override
  Future<void> alVolverAlPrimerPlano() async => widget.alRefrescar();

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
