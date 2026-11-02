// P-087: al guardar una direccion, el formulario debe CERRARSE y decirle al
// llamador que se guardo.
//
// Antes `_save` invocaba `onSave` sin `await`: el SnackBar salia antes de saber
// si se guardo, la pantalla no se cerraba y un fallo de red se perdia porque el
// try/catch no podia capturar una promesa que nadie esperaba.
//
// El formulario se abre con `initialAddress` ya completo en vez de rellenarlo a
// mano: escribir texto en un desplegable rompe el `DropdownButton` (assert de
// valor unico) y el test fallaria por el andamiaje, no por la conducta.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/widgets/profile/colombian_address_builder.dart';

/// Direccion valida: los valores de los desplegables pertenecen a las listas
/// reales (`_tiposVia` y `_departamentos`), no son inventados.
const direccionValida = <String, dynamic>{
  'tipo_via': 'Calle',
  'numero_principal': '123',
  'ciudad': 'Bogotá',
  'departamento': 'Bogotá D.C.',
  'barrio': 'Chapinero',
};

void main() {
  // El formulario es largo: con la ventana por defecto (800x600) desborda y el
  // fallo seria de layout, no de la conducta que se quiere fijar.
  setUp(() {
    final binding = TestWidgetsFlutterBinding.ensureInitialized();
    binding.window.physicalSizeTestValue = const Size(1200, 2600);
    binding.window.devicePixelRatioTestValue = 1.0;
  });

  tearDown(() {
    final binding = TestWidgetsFlutterBinding.ensureInitialized();
    binding.window.clearPhysicalSizeTestValue();
    binding.window.clearDevicePixelRatioTestValue();
  });

  Future<void> abrirFormulario(
    WidgetTester tester,
    Future<void> Function(Map<String, dynamic>) onSave,
    void Function(bool?) guardarResultado,
  ) async {
    await tester.pumpWidget(MaterialApp(
      // El Scaffold no es decorativo: sin el, `ScaffoldMessenger` encola el
      // SnackBar y nunca lo pinta, asi que el test no podria ver el aviso.
      home: Scaffold(
        body: Builder(
          builder: (context) => ElevatedButton(
          onPressed: () async {
            final r = await showColombianAddressBuilder(
              context: context,
              initialAddress: direccionValida,
              onSave: onSave,
            );
            guardarResultado(r);
          },
          child: const Text('abrir'),
        ),
        ),
      ),
    ));
    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle();
  }

  testWidgets('guardar cierra el formulario y devuelve true', (tester) async {
    bool? resultado;
    var llamado = false;

    await abrirFormulario(tester, (_) async {
      llamado = true;
    }, (r) => resultado = r);

    await tester.tap(find.text('Actualizar').first);
    await tester.pumpAndSettle();

    expect(llamado, isTrue, reason: 'el guardado debe ejecutarse');
    expect(resultado, isTrue,
        reason: 'el llamador necesita saber que se guardo para avisar');
    expect(find.byType(ColombianAddressBuilder), findsNothing,
        reason: 'la pantalla debe cerrarse');
  });

  testWidgets('si el guardado falla, no cierra y lo dice', (tester) async {
    bool? resultado;

    await abrirFormulario(tester, (_) async => throw Exception('sin red'),
        (r) => resultado = r);

    await tester.tap(find.text('Actualizar').first);
    await tester.pumpAndSettle();

    expect(find.byType(ColombianAddressBuilder), findsOneWidget,
        reason: 'no puede cerrar como si hubiera guardado');
    expect(resultado, isNull);
    expect(find.textContaining('No se pudo guardar'), findsOneWidget,
        reason: 'el error tiene que verse: antes se perdia en silencio');
  });
}
