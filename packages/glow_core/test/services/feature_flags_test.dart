// packages/glow_core/test/services/feature_flags_test.dart
// Test para FeatureFlags.activo() - Ítem 80

import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glow_core.dart';

void main() {
  group('FeatureFlags', () {
    late FeatureFlags flags;

    setUp(() {
      flags = FeatureFlags.instance;
    });

    test('activo() devuelve true por defecto (fail-open) para bandera inexistente', () {
      flags.fijarParaPruebas({});
      expect(flags.activo('propinas'), isTrue);
      expect(flags.activo('glowstore'), isTrue);
      expect(flags.activo('cualquier_otra'), isTrue);
    });

    test('activo() devuelve true cuando la bandera está explícitamente en true', () {
      flags.fijarParaPruebas({'propinas': true, 'glowstore': true});
      expect(flags.activo('propinas'), isTrue);
      expect(flags.activo('glowstore'), isTrue);
    });

    test('activo() devuelve false cuando la bandera está explícitamente en false', () {
      flags.fijarParaPruebas({'propinas': false, 'glowstore': false});
      expect(flags.activo('propinas'), isFalse);
      expect(flags.activo('glowstore'), isFalse);
    });

    test('activo() es independiente por bandera', () {
      flags.fijarParaPruebas({'propinas': false, 'glowstore': true});
      expect(flags.activo('propinas'), isFalse);
      expect(flags.activo('glowstore'), isTrue);
    });

    test('cargar() no lanza si el backend falla (mantiene estado anterior)', () async {
      flags.fijarParaPruebas({'test_flag': true});
      await flags.cargar(obtener: () async => throw Exception('red caída'));
      expect(flags.activo('test_flag'), isTrue);
    });

    test('valores expone mapa inmodificable', () {
      flags.fijarParaPruebas({'a': true, 'b': false});
      final mapa = flags.valores;
      expect(mapa['a'], isTrue);
      expect(mapa['b'], isFalse);
      // No se puede modificar el mapa devuelto
      expect(() => mapa['c'] = true, throwsUnsupportedError);
    });
  });
}