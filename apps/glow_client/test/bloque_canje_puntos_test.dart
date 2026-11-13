import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_client/widgets/bloque_canje_puntos.dart';
import 'package:glow_core/glow_core.dart';

/// Las cuatro reglas del canje, del lado del cliente.
///
/// El servidor recalcula todo al crear el pedido; este bloque solo previsualiza.
/// Si las dos fórmulas se separan, la clienta ve un total que no es el que se
/// cobra — y hasta hoy el cliente no tenía ni un caso de prueba.
SaldoPuntos _saldo({int saldo = 500}) => SaldoPuntos(saldo: saldo);

Widget _envolver(Widget hijo) => MaterialApp(
      home: Scaffold(body: hijo),
      routes: {'/programa-puntos': (_) => const Scaffold(body: Text('CONDICIONES'))},
    );

void main() {
  testWidgets('bajo el mínimo no se puede usar nada y lo dice', (tester) async {
    var cambios = 0;
    await tester.pumpWidget(_envolver(BloqueCanjePuntos(
      saldo: _saldo(),
      valorProductos: 20000, // por debajo de los $25.000
      activo: false,
      onCambio: (_) => cambios++,
    )));

    expect(find.textContaining('Con \$25.000 COP o más'), findsOneWidget);
    final interruptor = tester.widget<Switch>(find.byType(Switch));
    expect(interruptor.onChanged, isNull, reason: 'sin mínimo no se activa');
    expect(cambios, 0);
  });

  testWidgets('el tope del 15 % manda: 100.000 no admiten más de 1.500 puntos',
      (tester) async {
    await tester.pumpWidget(_envolver(BloqueCanjePuntos(
      saldo: _saldo(saldo: 5000), // mucho saldo, el tope es lo que corta
      valorProductos: 100000,
      activo: false,
      onCambio: (_) {},
    )));

    // 15 % de 100.000 = 15.000 pesos = 1.500 puntos
    expect(find.textContaining('hasta 1500 puntos'), findsOneWidget);
  });

  testWidgets('saldo en bloques: 450 puntos aplican 400, no 450',
      (tester) async {
    await tester.pumpWidget(_envolver(BloqueCanjePuntos(
      saldo: _saldo(saldo: 450),
      valorProductos: 100000, // el tope no corta aquí: corta el bloque
      activo: false,
      onCambio: (_) {},
    )));

    expect(find.textContaining('hasta 400 puntos'), findsOneWidget);
  });

  testWidgets('activo muestra el descuento en pesos', (tester) async {
    await tester.pumpWidget(_envolver(BloqueCanjePuntos(
      saldo: _saldo(saldo: 500),
      valorProductos: 100000,
      activo: true,
      onCambio: (_) {},
    )));

    // 500 puntos × $10 = $5.000
    expect(find.textContaining('Se aplican 500 puntos'), findsOneWidget);
    expect(find.textContaining('−\$5.000 COP'), findsOneWidget);
  });

  testWidgets('el interruptor enciende el canje', (tester) async {
    bool? nuevo;
    await tester.pumpWidget(_envolver(BloqueCanjePuntos(
      saldo: _saldo(),
      valorProductos: 100000,
      activo: false,
      onCambio: (v) => nuevo = v,
    )));

    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();

    expect(nuevo, isTrue);
  });

  testWidgets('lleva a las condiciones', (tester) async {
    await tester.pumpWidget(_envolver(BloqueCanjePuntos(
      saldo: _saldo(),
      valorProductos: 100000,
      activo: false,
      onCambio: (_) {},
    )));

    await tester.tap(find.text('Ver condiciones'));
    await tester.pumpAndSettle();

    expect(find.text('CONDICIONES'), findsOneWidget);
  });
}
