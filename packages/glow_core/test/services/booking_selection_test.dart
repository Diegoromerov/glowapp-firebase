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

  group('crearReservaConCatalogoFresco', () {
    test('camino feliz: crea una sola vez con la selección saneada', () async {
      var llamadas = 0;
      List<String>? idsRecibidos;

      final resultado = await crearReservaConCatalogoFresco(
        catalogo: servicios,
        seleccion: ['a', 'a'],
        crear: (ids) async {
          llamadas++;
          idsRecibidos = ids;
          return {'booking_id': 'b1'};
        },
        recargarCatalogo: () async => fail('no debe recargar en el camino feliz'),
      );

      expect(llamadas, 1);
      expect(idsRecibidos, ['a']);
      expect(resultado.serviciosUsados, ['a']);
      expect(resultado.respuesta['booking_id'], 'b1');
    });

    test('si el catálogo cambió, recarga y reintenta UNA vez con los ids que sobreviven', () async {
      var llamadas = 0;
      var recargas = 0;
      List<String>? idsDelReintento;

      final resultado = await crearReservaConCatalogoFresco(
        catalogo: [
          {'id': 'viejo', 'name': 'Balayage'},
          {'id': 'vigente', 'name': 'Corte'},
        ],
        seleccion: ['viejo', 'vigente'],
        crear: (ids) async {
          llamadas++;
          if (llamadas == 1) throw const ServiciosNoEncontradosException();
          idsDelReintento = ids;
          return {'booking_id': 'b2'};
        },
        recargarCatalogo: () async {
          recargas++;
          return [
            {'id': 'vigente', 'name': 'Corte'},
          ];
        },
      );

      expect(llamadas, 2);
      expect(recargas, 1);
      expect(idsDelReintento, ['vigente']);
      expect(resultado.respuesta['booking_id'], 'b2');
      expect(resultado.catalogo.single['id'], 'vigente');
    });

    test('si tras recargar no queda ningún servicio válido, avisa sin reintentar', () async {
      var llamadas = 0;

      await expectLater(
        crearReservaConCatalogoFresco(
          catalogo: [
            {'id': 'viejo', 'name': 'Balayage'},
          ],
          seleccion: ['viejo'],
          crear: (ids) async {
            llamadas++;
            throw const ServiciosNoEncontradosException();
          },
          recargarCatalogo: () async => [
            {'id': 'otro', 'name': 'Corte'},
          ],
        ),
        throwsA(isA<SeleccionDeServiciosVaciaException>()),
      );

      expect(llamadas, 1, reason: 'no debe reintentar sin ids válidos');
    });

    test('un error distinto se propaga sin recargar el catálogo', () async {
      var recargas = 0;

      await expectLater(
        crearReservaConCatalogoFresco(
          catalogo: servicios,
          seleccion: ['a'],
          crear: (ids) async => throw Exception('500 sin conexión'),
          recargarCatalogo: () async {
            recargas++;
            return servicios;
          },
        ),
        throwsA(isA<Exception>()),
      );

      expect(recargas, 0);
    });

    test('selección vacía no llama a la API', () async {
      var llamadas = 0;

      await expectLater(
        crearReservaConCatalogoFresco(
          catalogo: servicios,
          seleccion: const [],
          crear: (ids) async {
            llamadas++;
            return {'booking_id': 'x'};
          },
          recargarCatalogo: () async => servicios,
        ),
        throwsA(isA<SeleccionDeServiciosVaciaException>()),
      );

      expect(llamadas, 0);
    });
  });
}
