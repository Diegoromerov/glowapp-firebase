// La bandeja es la lista visible del home: si se rompe, el usuario vuelve a
// tener un mapa de pines encimados sin otra forma de elegir.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glow_core.dart';
import 'package:glow_client/widgets/home_results_sheet.dart';

ProviderModel prov(String id, {bool disponible = false, String? hueco}) => ProviderModel(
      id: id,
      fullName: id,
      avatarUrl: '',
      businessName: id,
      description: '',
      ratingAvg: 4.7,
      ratingCount: 20,
      isVerified: true,
      distanceMeters: 800,
      latitude: 4.65,
      longitude: -74.05,
      availableToday: disponible,
      nextSlotToday: hueco,
    );

Widget montar(Widget hijo) => MaterialApp(
      home: Scaffold(body: Stack(children: [const SizedBox.expand(), hijo])),
    );

void main() {
  testWidgets('sin resultados ofrece ampliar la búsqueda', (tester) async {
    var ampliado = false;
    await tester.pumpWidget(montar(HomeResultsSheet(
      proveedores: const [],
      onSelect: (_) {},
      onPosicion: (_) {},
      construirTarjeta: (_) => const SizedBox(height: 90),
      mensajeVacio: 'No hay nadie a 5 km',
      onAmpliarRadio: () => ampliado = true,
      tamanoInicial: 0.9,
    )));
    await tester.pumpAndSettle();

    expect(find.text('No hay nadie a 5 km'), findsOneWidget);
    await tester.tap(find.text('Ampliar la búsqueda'));
    await tester.pumpAndSettle();
    expect(ampliado, isTrue);
  });

  testWidgets('tocar una tarjeta avisa de la selección', (tester) async {
    ProviderModel? elegido;
    await tester.pumpWidget(montar(HomeResultsSheet(
      proveedores: [prov('a'), prov('b')],
      onSelect: (p) => elegido = p,
      onPosicion: (_) {},
      construirTarjeta: (p) => SizedBox(
        height: 90,
        child: Text('tarjeta ${p.id}', textAlign: TextAlign.center),
      ),
      tamanoInicial: 0.9,
    )));
    await tester.pumpAndSettle();

    await tester.tap(find.text('tarjeta b'));
    await tester.pumpAndSettle();

    expect(elegido?.id, 'b');
  });

  testWidgets('el chip muestra el hueco real y no promete si no hay', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Column(children: [
          ChipDisponibilidad(proveedor: prov('a', disponible: true, hueco: '09:00')),
          ChipDisponibilidad(proveedor: prov('b')),
        ]),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Hoy 09:00'), findsOneWidget);
    expect(find.text('Sin hueco hoy'), findsOneWidget);
  });
}
