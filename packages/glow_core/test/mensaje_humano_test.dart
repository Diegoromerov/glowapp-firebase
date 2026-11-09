// packages/glow_core/test/mensaje_humano_test.dart
//
// El usuario no debe leer nunca "Exception: UNAUTHORIZED" ni un volcado técnico.
// Este test fija las traducciones que la app muestra en pantalla y falla si
// alguien vuelve a devolver el error crudo.

import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glow_core.dart';

void main() {
  test('un 401 de la API se explica como sesión vencida', () {
    expect(
      mensajeHumano(Exception('UNAUTHORIZED')),
      'Tu sesión venció. Vuelve a iniciar sesión.',
    );
    expect(
      mensajeHumano(Exception('Error 401')),
      'Tu sesión venció. Vuelve a iniciar sesión.',
    );
  });

  test('un fallo de red no nombra SocketException', () {
    final texto = mensajeHumano(
      Exception('SocketException: Failed host lookup: glowapp-api'),
    );
    expect(texto, contains('No pudimos conectar'));
    expect(texto, isNot(contains('SocketException')));
  });

  test('un 500 no filtra la traza', () {
    final texto = mensajeHumano(Exception('Error 500'));
    expect(texto, contains('Algo falló de nuestro lado'));
    expect(texto, isNot(contains('Exception')));
  });

  test('el mensaje del backend se conserva sin el prefijo técnico', () {
    expect(
      mensajeHumano(Exception('Credenciales inválidas')),
      'Credenciales inválidas',
    );
  });
}
