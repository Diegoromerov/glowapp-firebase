// Ítem 12 — los mensajes de permiso denegado deben decir cómo revertirlo.
//
// Caso real que motivó esto: el plugin de cámara devuelve
// `CameraAccessDeniedWithoutPrompt` y `CameraAccessRestricted`, que antes caían
// en «No se pudo abrir la cámara»: un callejón sin salida para el usuario.
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glow_core.dart';

void main() {
  group('mensajePermisoDenegado', () {
    test('en web manda al candado de la barra de direcciones', () {
      final m = mensajePermisoDenegado('la cámara', esWeb: true);
      expect(m, contains('candado'));
      expect(m, contains('la cámara'));
    });

    test('en móvil permanente manda a Ajustes de la aplicación', () {
      final m = mensajePermisoDenegado('la ubicación', esWeb: false, permanente: true);
      expect(m, contains('Ajustes'));
      expect(m, contains('Permisos'));
      expect(m, contains('la ubicación'));
    });

    test('sin recurso no deja frases rotas', () {
      final m = mensajePermisoDenegado('   ', esWeb: false);
      expect(m, contains('este permiso'));
      expect(m, isNot(contains('  ')));
    });
  });

  group('esDenegacionDeCamara', () {
    test('reconoce los cuatro códigos de denegación', () {
      for (final c in [
        'cameraPermission',
        'CameraAccessDenied',
        'CameraAccessDeniedWithoutPrompt',
        'CameraAccessRestricted',
      ]) {
        expect(esDenegacionDeCamara(c), isTrue, reason: c);
      }
    });

    test('no confunde un fallo de hardware con una denegación', () {
      expect(esDenegacionDeCamara('cameraNotFound'), isFalse);
      expect(esDenegacionDeCamara(null), isFalse);
    });
  });
}
