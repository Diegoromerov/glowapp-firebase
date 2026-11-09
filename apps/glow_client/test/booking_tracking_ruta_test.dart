import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_client/main.dart';

void main() {
  testWidgets('/booking-tracking pinta la pantalla real, no el stub',
      (tester) async {
    await tester.pumpWidget(const ProviderScope(child: GlowClientApp()));
    // La home tiene animaciones continuas (pulso del mapa) y la pantalla de
    // seguimiento usa AnimationController.repeat(): pumpAndSettle nunca puede
    // asentarse. Se avanza el reloj en pasos fijos, que es lo que este test
    // necesita para comprobar el router.
    await tester.pump(const Duration(milliseconds: 800));

    final nav = tester.state<NavigatorState>(find.byType(Navigator).first);
    nav.pushNamed('/booking-tracking', arguments: {
      'id': 'b-1',
      'estado': 'EN_PROGRESO',
      'service_address': 'Calle 100 #15-20, Bogota',
    });
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    // Hoy el router devuelve _StubScreen('Tracking reserva: b-1').
    expect(find.textContaining('Tracking reserva'), findsNothing);
  });
}
