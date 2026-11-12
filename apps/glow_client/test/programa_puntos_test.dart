// Condiciones publicadas del programa (F1).
//
// El riesgo que cubre este test no es de código: es que la pantalla prometa algo
// distinto de lo que el backend aplica. Los montos se fijan aquí para que un
// cambio en `programaPuntos.js` sin reflejo en la app se note.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_client/screens/programa_puntos_screen.dart';

void main() {
  testWidgets('publica los montos, topes y vencimiento vigentes', (tester) async {
    // Superficie alta: es una pantalla larga y en 800x600 el último bloque queda
    // fuera del árbol visible.
    await tester.binding.setSurfaceSize(const Size(900, 3000));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(const MaterialApp(home: ProgramaPuntosScreen()));
    await tester.pumpAndSettle();

    // Gana la referente
    expect(find.textContaining('500 puntos'), findsWidgets);
    // Compra mínima para premiar
    expect(find.textContaining(r'$20.000'), findsWidgets);
    // Bienvenida de la invitada
    expect(find.textContaining('100 puntos de bienvenida'), findsWidgets);
    // Canje: tope y mínimo de pedido
    expect(find.textContaining('15%'), findsWidgets);
    expect(find.textContaining(r'$25.000'), findsWidgets);
    // Límites
    expect(find.textContaining('10 premios por mes'), findsWidgets);
    expect(find.textContaining('12 meses'), findsWidgets);
    // No es dinero
    expect(find.textContaining('no se retiran'), findsWidgets);
    // Qué pasa si el pedido se cae
    expect(find.textContaining('24 horas'), findsWidgets);
    expect(find.textContaining('30 días'), findsWidgets);
  });

  testWidgets('dice que es un solo nivel y que no se transfiere', (tester) async {
    await tester.binding.setSurfaceSize(const Size(900, 3000));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(const MaterialApp(home: ProgramaPuntosScreen()));
    await tester.pumpAndSettle();

    expect(find.textContaining('un solo nivel'), findsWidgets);
    expect(find.textContaining('no se transfieren'), findsWidgets);
  });
}
