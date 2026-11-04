// El orden del home es la decisión de producto: «cerca y disponible hoy». Si se
// rompe, el usuario ve primero a quien no puede atenderlo hasta el jueves.
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glow_core.dart';
import 'package:glow_client/utils/home_ranking.dart';

ProviderModel prov(
  String id, {
  required int metros,
  double nota = 4.5,
  int resenas = 10,
  bool disponibleHoy = false,
  String? hueco,
}) =>
    ProviderModel(
      id: id,
      fullName: id,
      avatarUrl: '',
      businessName: id,
      description: '',
      ratingAvg: nota,
      ratingCount: resenas,
      isVerified: true,
      distanceMeters: metros,
      latitude: 4.65,
      longitude: -74.05,
      availableToday: disponibleHoy,
      nextSlotToday: hueco,
    );

void main() {
  test('quien puede hoy va por delante aunque esté más lejos', () {
    final lista = ordenarParaHome([
      prov('cerca_sin_hueco', metros: 300, nota: 4.9, resenas: 90),
      prov('lejos_con_hueco', metros: 2400, nota: 4.4, resenas: 40, disponibleHoy: true, hueco: '15:30'),
    ]);
    expect(lista.first.id, 'lejos_con_hueco');
  });

  test('entre dos disponibles manda la cercanía por franjas de 1 km', () {
    final lista = ordenarParaHome([
      prov('a', metros: 1900, nota: 4.9, resenas: 80, disponibleHoy: true),
      prov('b', metros: 800, nota: 4.1, resenas: 10, disponibleHoy: true),
    ]);
    expect(lista.first.id, 'b');
  });

  test('en la misma franja manda la nota', () {
    final lista = ordenarParaHome([
      prov('a', metros: 1200, nota: 3.9, resenas: 30, disponibleHoy: true),
      prov('b', metros: 1500, nota: 4.9, resenas: 80, disponibleHoy: true),
    ]);
    expect(lista.first.id, 'b');
  });

  test('sin reseñas no se corona al primero', () {
    final lista = ordenarParaHome([
      prov('nuevo', metros: 400, nota: 5.0, resenas: 0, disponibleHoy: true),
      prov('probado', metros: 700, nota: 4.7, resenas: 60, disponibleHoy: true),
    ]);
    expect(lista.first.id, 'probado');
  });

  test('nadie disponible: se ordena por cercanía', () {
    final lista = ordenarParaHome([
      prov('lejos', metros: 4800),
      prov('cerca', metros: 600),
    ]);
    expect(lista.first.id, 'cerca');
  });
}
