// apps/glow_client/test/booking_sin_datos_inventados_test.dart
//
// Invariante de la pantalla de reserva: no puede rellenar la cuadrícula de
// horarios ni la lista de productos con datos que el backend no devolvió.
//
// Contexto: ante un fallo de red se pintaban 09:00 / 10:30 / 14:00 como
// disponibles y dos productos con ids 101/102 que no existen en el catálogo.
// El usuario elegía una hora que el prestador no tiene y lo descubría al pagar.
//
// Se comprueba sobre el código fuente porque BookingScreen llama a ApiService
// de forma estática (no hay costura para inyectar un fallo en un widget test).
// Si alguien vuelve a meter el fallback, este test falla.

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  late String fuente;

  setUpAll(() {
    fuente = File('lib/screens/booking_screen.dart').readAsStringSync();
  });

  test('no hay horarios inventados', () {
    expect(fuente.contains("'09:00'"), isFalse,
        reason: 'volvió un horario de relleno');
    expect(fuente.contains("'10:30'"), isFalse);
    expect(fuente.contains("'14:00'"), isFalse);
    expect(fuente.contains('fallbackSlots'), isFalse);
  });

  test('no hay productos de relleno', () {
    expect(fuente.contains('fallbackProducts'), isFalse);
    expect(fuente.contains("'Tratamiento Reparador Intenso'"), isFalse);
    expect(fuente.contains("'Óleo Nutritivo Glow'"), isFalse);
  });

  test('no se fabrica la ficha de un producto preseleccionado', () {
    expect(fuente.contains('extraProduct'), isFalse,
        reason: 'volvió la inyección de producto con precio inventado');
  });

  test('el fallo de horarios se muestra con reintento', () {
    expect(fuente.contains('_errorSlots'), isTrue);
    expect(fuente.contains('Reintentar horarios'), isTrue);
  });
}
