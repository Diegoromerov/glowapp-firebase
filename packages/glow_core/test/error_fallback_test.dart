import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glow_core.dart';

void main() {
  testWidgets('muestra mensaje y codigo, nunca el detalle tecnico', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: ErrorFallback(codigo: 'A3F9')));
    expect(find.textContaining('Algo salió mal'), findsOneWidget);
    expect(find.textContaining('A3F9'), findsOneWidget,
        reason: 'el usuario debe poder citar un codigo');
    expect(find.textContaining('Exception'), findsNothing,
        reason: 'no se filtran detalles internos en release');
  });
}