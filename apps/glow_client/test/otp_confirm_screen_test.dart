// La pantalla de confirmación era un stub: aceptaba cualquier código de 6 dígitos
// y devolvía `true` sin consultar al backend, que es quien valida el código y
// libera el pago. Estas pruebas fijan la conducta correcta.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_client/screens/otp_confirm_screen.dart';

void main() {
  Future<void> escribirCodigo(WidgetTester tester, String codigo) async {
    for (var i = 0; i < 6; i++) {
      await tester.enterText(find.byType(TextField).at(i), codigo[i]);
      await tester.pump();
    }
  }

  testWidgets('un código rechazado NO cierra la pantalla', (tester) async {
    var llamadas = 0;
    await tester.pumpWidget(MaterialApp(
      home: OtpConfirmScreen(
        bookingId: 'reserva-1',
        servicioNombre: 'Manicure',
        prestadorNombre: 'Aura',
        valorBruto: 50000,
        verificar: (codigo) async {
          llamadas++;
          return false;
        },
      ),
    ));

    await escribirCodigo(tester, '123456');
    await tester.pump(const Duration(seconds: 2));

    expect(llamadas, 1, reason: 'debe consultar al backend, no decidir solo');
    expect(find.byType(OtpConfirmScreen), findsOneWidget,
        reason: 'si el código es rechazado, la pantalla sigue abierta');
    expect(find.textContaining('incorrecto'), findsOneWidget,
        reason: 'el usuario debe saber que el código no sirvió');
  });

  testWidgets('un código aceptado cierra con true', (tester) async {
    bool? resultado;
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => ElevatedButton(
          onPressed: () async {
            resultado = await Navigator.push<bool>(
              context,
              MaterialPageRoute(
                builder: (_) => OtpConfirmScreen(
                  bookingId: 'reserva-1',
                  servicioNombre: 'Manicure',
                  prestadorNombre: 'Aura',
                  valorBruto: 50000,
                  verificar: (_) async => true,
                ),
              ),
            );
          },
          child: const Text('abrir'),
        ),
      ),
    ));

    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle();
    await escribirCodigo(tester, '654321');
    await tester.pumpAndSettle();

    expect(resultado, isTrue);
  });

  testWidgets('si la verificación falla por red, avisa y no cierra', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: OtpConfirmScreen(
        bookingId: 'reserva-1',
        servicioNombre: 'Manicure',
        prestadorNombre: 'Aura',
        valorBruto: 50000,
        verificar: (_) async => throw Exception('sin red'),
      ),
    ));

    await escribirCodigo(tester, '111111');
    await tester.pump(const Duration(seconds: 2));

    expect(find.byType(OtpConfirmScreen), findsOneWidget);
    expect(find.textContaining('No se pudo verificar'), findsOneWidget);
  });
}
