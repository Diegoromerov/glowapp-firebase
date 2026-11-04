// Los pines se pintaban uno encima de otro: con 3 prestadores en la misma cuadra
// el usuario solo veía uno y tenía que hacer zoom para descubrir el resto.
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:glow_client/utils/map_clustering.dart';

void main() {
  const a = LatLng(4.6500, -74.0500);
  const b = LatLng(4.65005, -74.05005); // ~7 m: mismo punto en pantalla
  const lejos = LatLng(4.6600, -74.0600);
  // ~78 m al norte: a zoom 13 son < 1 px (se agrupan), a zoom 19 son ~200 px
  // (se separan). Con 7 m no se separan ni con el mapa al máximo.
  const mediano = LatLng(4.6507, -74.0500);

  test('dos pines casi en el mismo sitio se agrupan al alejar', () {
    final grupos = agruparPines([
      const PinPunto(id: 'a', posicion: a),
      const PinPunto(id: 'b', posicion: b),
    ], zoom: 13);

    expect(grupos.length, 1);
    expect(grupos.single.ids, {'a', 'b'});
    expect(grupos.single.esCluster, isTrue);
  });

  test('a zoom alto dos pines a 78 m se separan', () {
    final grupos = agruparPines([
      const PinPunto(id: 'a', posicion: a),
      const PinPunto(id: 'b', posicion: mediano),
    ], zoom: 19);

    expect(grupos.length, 2);
  });

  test('un pin destacado dentro del grupo marca el grupo entero', () {
    final grupos = agruparPines([
      const PinPunto(id: 'a', posicion: a),
      const PinPunto(id: 'b', posicion: b, destacado: true),
    ], zoom: 13);

    expect(grupos.single.destacado, isTrue,
        reason: 'si hay un buen prestador en el montón, el montón debe verse');
  });

  test('pines lejanos no se agrupan', () {
    final grupos = agruparPines([
      const PinPunto(id: 'a', posicion: a),
      const PinPunto(id: 'lejos', posicion: lejos),
    ], zoom: 13);

    expect(grupos.length, 2);
  });

  test('un solo pin sigue siendo un grupo de uno', () {
    final grupos = agruparPines([
      const PinPunto(id: 'a', posicion: a, destacado: true),
    ], zoom: 14);

    expect(grupos.single.ids, {'a'});
    expect(grupos.single.esCluster, isFalse);
  });
}
