// La reprogramación era un aviso que abría el perfil del prestador: el usuario
// tocaba "Reprogramar" y no podía reprogramar. Esta prueba fija que la hoja pide
// los huecos reales y aplica el cambio.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_client/widgets/reschedule_sheet.dart';

void main() {
  testWidgets('elige día, franja y aplica el cambio', (tester) async {
    String? fechaPedida;
    String? isoAplicado;

    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: ElevatedButton(
              onPressed: () => showRescheduleSheet(
                context,
                bookingId: 'reserva-1',
                providerId: '5',
                serviceId: 'servicio-1',
                cargarSlots: (fecha) async {
                  fechaPedida = fecha;
                  return [
                    {'time': '10:00', 'is_available': true},
                    {'time': '10:30', 'is_available': false},
                  ];
                },
                aplicar: (iso) async => isoAplicado = iso,
              ),
              child: const Text('abrir'),
            ),
          ),
        ),
      ),
    ));

    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle();

    // El primer día (hoy) se pide al abrir la hoja tras tocarlo.
    await tester.tap(find.text('${DateTime.now().day}').first);
    await tester.pumpAndSettle();
    expect(fechaPedida, isNotNull, reason: 'debe consultar huecos reales');

    // Solo la franja disponible se puede elegir.
    await tester.tap(find.text('10:00'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Confirmar nuevo horario'));
    await tester.pumpAndSettle();

    expect(isoAplicado, isNotNull);
    // La cita se envía en hora de Bogotá (-05:00), sin depender de la zona
    // horaria del runner de CI (que puede ser UTC).
    expect(isoAplicado, endsWith('-05:00'));
    final instanteAplicado = DateTime.parse(isoAplicado!).toUtc();
    final instanteEsperado = DateTime.parse('${fechaPedida}T10:00:00-05:00').toUtc();
    expect(instanteAplicado, instanteEsperado);
  });

  testWidgets('sin franja elegida no se puede confirmar', (tester) async {
    var aplicado = false;
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: ElevatedButton(
              onPressed: () => showRescheduleSheet(
                context,
                bookingId: 'reserva-1',
                providerId: '5',
                serviceId: 'servicio-1',
                cargarSlots: (_) async => [
                  {'time': '10:00', 'is_available': true},
                ],
                aplicar: (_) async => aplicado = true,
              ),
              child: const Text('abrir'),
            ),
          ),
        ),
      ),
    ));

    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Confirmar nuevo horario'));
    await tester.pumpAndSettle();

    expect(aplicado, isFalse, reason: 'la fecha es obligatoria');
  });
}
