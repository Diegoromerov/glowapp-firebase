// Invariante del botón de Google en web.
//
// En web el login solo funciona con el botón OFICIAL de GIS (`renderButton`), y
// el diseño de la app es redondo. Ese círculo sale de la configuración —tipo
// icono, forma pastilla y 40 px de ancho, que con el alto de 40 del tamaño
// grande da radio 20— y NO de recortar el iframe: envolverlo en `ClipOval` o
// taparlo con `Opacity(0.01)` deja el botón sin clics (fue el defecto que
// arregló 3d9cd99e y que este test impide reintroducir).
//
// Se comprueba sobre el código fuente porque el widget de GIS sólo existe con
// `dart.library.js`: en la VM de test la función devuelve null y el botón real
// nunca se construye.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final botonWeb = File('lib/screens/auth/google_signin_button_web.dart');
  final login = File('lib/screens/auth/login_screen.dart');

  test('el botón web de Google es el círculo oficial de GIS', () {
    expect(botonWeb.existsSync(), isTrue, reason: 'falta el archivo del botón web');
    final src = botonWeb.readAsStringSync();

    // El helper que pinta el login (googleSignInButton) es el de la forma redonda.
    final bloque = src.substring(src.indexOf('Widget? googleSignInButton()'));
    expect(bloque, contains('GSIButtonType.icon'),
        reason: 'la forma redonda es el botón de icono, sin texto');
    expect(bloque, contains('GSIButtonShape.pill'),
        reason: 'pill + 40x40 es lo que da el círculo');
    expect(bloque, contains('minimumWidth: 40'),
        reason: 'con 40 de ancho y 40 de alto el radio de la pastilla es 20');
    expect(bloque, isNot(contains('GSIButtonType.standard')),
        reason: 'el botón rectangular "continuar con Google" es el que el Director rechazó');
  });

  test('el login no recorta ni tapa el iframe de GIS', () {
    expect(login.existsSync(), isTrue);
    final src = login.readAsStringSync();
    expect(src, contains('gis_button.googleSignInButton()'),
        reason: 'el login debe pintar el botón oficial de GIS');

    // Cada vez que se usa `googleOverlay` se mira hacia atrás: si justo antes
    // aparece clip u opacidad, el iframe queda recortado o tapado.
    var usos = 0;
    var desde = src.indexOf('googleOverlay');
    while (desde != -1) {
      usos++;
      final contexto = src.substring(desde >= 400 ? desde - 400 : 0, desde);
      expect(contexto, isNot(contains('ClipOval')),
          reason: 'recortar el iframe con ClipOval rompe el área de clic');
      expect(contexto, isNot(contains('Opacity(')),
          reason: 'un iframe de GIS con opacidad 0.01 no entrega clics');
      desde = src.indexOf('googleOverlay', desde + 1);
    }
    expect(usos, greaterThanOrEqualTo(2),
        reason: 'se espera la declaración y al menos un uso en el build');
  });
}
