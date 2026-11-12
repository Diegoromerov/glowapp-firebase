
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/src/services/auth_service.dart';

void main() {
  group('normalizarCodigoInvitacion', () {
    test('deja el código tal cual si ya está limpio', () {
      expect(normalizarCodigoInvitacion('GLOW927E'), 'GLOW927E');
    });

    test('quita espacios y pasa a mayúsculas', () {
      expect(normalizarCodigoInvitacion('  glow927e '), 'GLOW927E');
    });

    test('si pegó el enlace completo, saca el ref', () {
      expect(
        normalizarCodigoInvitacion(
            'https://glowapp-client.web.app/#/register?ref=GLOW927E'),
        'GLOW927E',
      );
    });

    test('descarta comillas, guiones y saltos de línea al copiar', () {
      expect(normalizarCodigoInvitacion('"GLOW-927E"\n'), 'GLOW927E');
    });

    test('vacío y nulo no rompen el registro', () {
      expect(normalizarCodigoInvitacion(null), '');
      expect(normalizarCodigoInvitacion('   '), '');
    });
  });
}
