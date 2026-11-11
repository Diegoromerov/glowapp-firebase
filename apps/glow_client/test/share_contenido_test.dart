// El pasaporte de colorimetría y el lookbook no pueden volver a "compartir" con
// un SnackBar: antes el botón de TikTok/Instagram mostraba «+50 XP» sin abrir la
// hoja del sistema ni registrar nada. Estos invariantes comprueban que el flujo
// real (tarjeta → hoja del sistema → registro) sigue montado.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final pantallas = {
    'pasaporte': (
      File('lib/screens/results_screen.dart'),
      'AI_COLORIMETRY',
      '¡Palette DNA compartida',
    ),
    'lookbook': (
      File('lib/screens/makeup_lookbook_screen.dart'),
      'VTO_LOOK',
      '¡Look publicado en Instagram',
    ),
  };

  pantallas.forEach((nombre, datos) {
    final (archivo, tipoContenido, mensajeFalso) = datos;

    test('$nombre comparte de verdad: tarjeta, hoja del sistema y registro', () {
      expect(archivo.existsSync(), isTrue, reason: 'falta $archivo');
      final src = archivo.readAsStringSync();

      expect(src, contains('exportarTarjetaPng'),
          reason: 'sin imagen no hay nada que publicar en TikTok/Instagram');
      expect(src, contains('SharePlus.instance.share'),
          reason: 'la hoja del sistema es lo que publica');
      expect(src, contains('SocialShareService.logShare'),
          reason: 'el share tiene que quedar registrado');
      expect(src, contains("'$tipoContenido'"),
          reason: 'el tipo de contenido va al backend');
      expect(src, contains('xp_awarded'),
          reason: 'el XP que se anuncia debe venir del backend');
      expect(src, isNot(contains(mensajeFalso)),
          reason: 'ese mensaje era el «éxito» inventado de antes');
    });
  });
}
