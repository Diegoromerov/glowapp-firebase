
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/src/services/rewards_service.dart';

void main() {
  group('NivelPuntos.desdeJson', () {
    test('lee la respuesta real del backend', () {
      final n = NivelPuntos.desdeJson({
        'nivel': 'Diamante',
        'xp': 2500,
        'xp_siguiente_nivel': null,
        'nivel_siguiente': null,
        'lecturas': {'otorgadas': 6, 'usadas': 1, 'disponibles': 5},
        'costos': {'lectura_sd_cop': 1440, 'lectura_hd_cop': 1920},
      });
      expect(n.nivel, 'Diamante');
      expect(n.disponibles, 5);
      expect(n.costoLecuraHdCop, 1920);
      expect(n.esNivelMaximo, isTrue);
      expect(n.restantesParaSiguiente, 0);
    });

    test('calcula cuánto falta para el siguiente nivel', () {
      final n = NivelPuntos.desdeJson({
        'nivel': 'Pétalo',
        'xp': 420,
        'xp_siguiente_nivel': 900,
        'nivel_siguiente': 'Oro',
        'lecturas': {'otorgadas': 3, 'usadas': 0, 'disponibles': 3},
      });
      expect(n.nivelSiguiente, 'Oro');
      expect(n.restantesParaSiguiente, 480);
      expect(n.esNivelMaximo, isFalse);
    });

    test('si el XP ya pasó la meta no resta negativo', () {
      final n = NivelPuntos.desdeJson({
        'nivel': 'Oro', 'xp': 1200, 'xp_siguiente_nivel': 900,
        'lecturas': {'otorgadas': 1, 'usadas': 0, 'disponibles': 1},
      });
      expect(n.restantesParaSiguiente, 0);
    });

    test('una respuesta incompleta no rompe la pantalla', () {
      final n = NivelPuntos.desdeJson({});
      expect(n.nivel, 'Glow');
      expect(n.disponibles, 0);
      expect(n.costoLecuraHdCop, 1920); // tarifa por defecto
    });
  });
}
