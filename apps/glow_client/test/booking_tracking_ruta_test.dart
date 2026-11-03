import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_client/main.dart';

void main() {
  testWidgets('/booking-tracking pinta la pantalla real, no el stub',
      (tester) async {
    await tester.pumpWidget(const ProviderScope(child: GlowClientApp()));
    await tester.pumpAndSettle();

    final nav = tester.state<NavigatorState>(find.byType(Navigator).first);
    nav.pushNamed('/booking-tracking', arguments: {
      'id': 'b-1',
      'estado': 'EN_PROGRESO',
      'service_address': 'Calle 100 #15-20, Bogota',
    });
    await tester.pump();

    // Hoy el router devuelve _StubScreen('Tracking reserva: b-1').
    expect(find.textContaining('Tracking reserva'), findsNothing);
  });
}
