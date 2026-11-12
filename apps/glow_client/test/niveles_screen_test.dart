
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_client/screens/niveles_screen.dart';

void main() {
  group('escalera del club', () {
    test('los umbrales coinciden con el backend (0/300/900/2000)', () {
      expect(kEscalera.map((e) => e.xp).toList(), [0, 300, 900, 2000]);
      expect(kEscalera.map((e) => e.nombre).toList(),
          ['Glow', 'Pétalo', 'Gold', 'Élite']);
    });

    test('cada nombre del backend cae en su escalón', () {
      expect(indiceDeNivel('Glow'), 0);
      expect(indiceDeNivel('Pétalo'), 1);
      expect(indiceDeNivel('Gold'), 2);
      expect(indiceDeNivel('Élite'), 3);
    });

    test('acentos y mayúsculas no rompen el índice', () {
      expect(indiceDeNivel('PETALO'), 1);
      expect(indiceDeNivel(' petalo '), 1);
      expect(indiceDeNivel('ELITE'), 3);
    });

    test('un nivel desconocido cae al primer escalón, no a -1', () {
      expect(indiceDeNivel('Platino'), 0);
      expect(indiceDeNivel(''), 0);
    });
  });

  group('avance en el tramo', () {
    test('el umbral exacto arranca el tramo en 0', () {
      expect(avanceEnTramo(300, 1), 0);
    });

    test('350 XP es 8% del tramo Pétalo→Gold', () {
      expect(avanceEnTramo(350, 1), closeTo(0.0833, 0.001));
    });

    test('el siguiente umbral llena la barra', () {
      expect(avanceEnTramo(900, 1), 1.0);
    });

    test('nunca se sale de 0..1 aunque el XP se dispare', () {
      expect(avanceEnTramo(99999, 1), 1.0);
      expect(avanceEnTramo(-50, 1), 0.0);
    });

    test('el último nivel está lleno (no promete un siguiente)', () {
      expect(avanceEnTramo(2400, 3), 1.0);
    });
  });
}
