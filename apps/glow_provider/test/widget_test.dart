// Smoke tests del provider.
//
// 1. La app arranca y construye sin excepciones.
// 2. BookingScreen pinta el paso 1 con un servicio real seleccionable y con la
//    lista vacía (los dos caminos, no solo el degenerado).
//
// Nota: pasar `services: const []` solo ejercita el camino en que no hay
// servicio seleccionado. No es una forma de esquivar un bug de tipado: el
// `orElse` de `_loadRecommendedProducts` devuelve `Map<String, dynamic>`, que es
// el tipo correcto.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:glow_core/glow_core.dart';

import 'package:glow_provider/main.dart';
import 'package:glow_provider/screens/booking/booking_screen.dart';

void main() {
  testWidgets('App provider arranca sin crash', (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: GlowProviderApp()));
    await tester.pump(const Duration(seconds: 1));
    expect(find.byType(GlowProviderApp), findsOneWidget);
    expect(tester.takeException(), isNull,
        reason: 'la app no puede lanzar excepciones al arrancar');
  });

  testWidgets('BookingScreen (agenda) construye paso 1 con servicios vacíos',
      (WidgetTester tester) async {
    // Lista vacía → selectedServiceId queda null → _loadRecommendedProducts
    // retorna temprano en initState (línea 113) y evita peticiones de red.
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: BookingScreen(
            providerId: '3',
            providerName: 'Studio Ana',
            services: const [],
          ),
        ),
      ),
    );

    // Paso 1 (logística) pinta: título "1. Selecciona un Servicio"
    expect(find.text('1. Selecciona un Servicio'), findsOneWidget);

    // Barra de progreso con 4 pasos
    expect(find.text('Cuándo y Dónde'), findsOneWidget);
    expect(find.text('Dirección y Notas'), findsOneWidget);
    expect(find.text('Productos'), findsOneWidget);
    expect(find.text('Confirmación'), findsOneWidget);

    // El widget BookingScreen existe
    expect(find.byType(BookingScreen), findsOneWidget);
  });

  testWidgets('BookingScreen pinta un servicio real y conserva los 4 pasos',
      (WidgetTester tester) async {
    const servicio = <String, dynamic>{
      'id': 'svc-1',
      'name': 'Corte y peinado',
      'price': 65000,
      'duration_minutes': 45,
      'category': 'Cabello',
    };

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: BookingScreen(
            providerId: '3',
            providerName: 'Studio Ana',
            services: const [servicio],
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Corte y peinado'), findsOneWidget,
        reason: 'el servicio pasado debe verse en el paso 1');
    expect(find.text('1. Selecciona un Servicio'), findsOneWidget);
    expect(tester.takeException(), isNull,
        reason: 'un servicio real no puede romper la construccion');
  });
}