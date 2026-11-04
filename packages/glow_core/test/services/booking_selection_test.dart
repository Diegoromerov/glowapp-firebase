// packages/glow_core/test/services/booking_selection_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/src/services/booking_selection.dart';

void main() {
  final servicios = <Map<String, dynamic>>[
    {'id': 'a', 'name': 'Balayage'},
    {'id': 'b', 'name': 'Corte'},
  ];

  group('sanearSeleccionDeServicios', () {
    test('quita duplicados conservando el orden', () {
      expect(sanearSeleccionDeServicios(servicios, ['b', 'a', 'b']), ['b', 'a']);
    });

    test('descarta ids que ya no están en el catálogo del prestador', () {
      expect(sanearSeleccionDeServicios(servicios, ['a', 'borrado']), ['a']);
    });

    test('descarta vacíos y espacios', () {
      expect(sanearSeleccionDeServicios(servicios, ['', '  ', 'a']), ['a']);
    });

    test('si todo es inválido devuelve lista vacía', () {
      expect(sanearSeleccionDeServicios(servicios, ['borrado']), isEmpty);
    });
  });

  group('esServiciosNoEncontrados', () {
    test('sólo es true con 404 y el código del backend', () {
      expect(
        esServiciosNoEncontrados(404, '{"code":"SERVICES_NOT_FOUND"}'),
        isTrue,
      );
      expect(esServiciosNoEncontrados(404, '{"error":"otra cosa"}'), isFalse);
      expect(esServiciosNoEncontrados(500, '{"code":"SERVICES_NOT_FOUND"}'), isFalse);
    });

    test('no revienta con cuerpos no JSON', () {
      expect(esServiciosNoEncontrados(404, '<html>404</html>'), isFalse);
    });
  });
}
