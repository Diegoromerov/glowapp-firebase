import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/src/services/payload.dart';

void main() {
  group('asMapList', () {
    test('devuelve los elementos cuando data es una lista de mapas', () {
      final r = asMapList([
        {'id': 1},
        {'id': 2},
      ]);
      expect(r.length, 2);
      expect(r.first['id'], 1);
    });

    test('devuelve vacío cuando data falta (null)', () {
      expect(asMapList(null), isEmpty);
    });

    test('devuelve vacío cuando data es un objeto', () {
      expect(asMapList({'id': 1}), isEmpty);
    });

    test('descarta elementos que no son mapas sin lanzar', () {
      final r = asMapList([
        {'id': 1},
        'basura',
        42,
      ]);
      expect(r.length, 1);
    });

    test('copia a Map<String, dynamic> para evitar casts posteriores', () {
      final r = asMapList([
        <String, Object>{'a': 1},
      ]);
      expect(r.single, isA<Map<String, dynamic>>());
    });
  });
}
