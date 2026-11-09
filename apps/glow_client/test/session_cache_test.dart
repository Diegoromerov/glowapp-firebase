// apps/glow_client/test/session_cache_test.dart
//
// El bug: el gate leía el almacén cifrado en cada toque con un tope de 1,5 s.
// En web esa lectura puede tardar, y una lectura lenta se interpretaba como
// "sin sesión": un usuario autenticado recibía la hoja de login. Ahora la
// sesión se recuerda en memoria (hidratada al arrancar y al hacer login) y el
// gate consulta ese flag antes de tocar el almacén.
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glow_core.dart';
import 'package:glow_client/widgets/auth_gate.dart';
import 'dart:io';

void main() {
  tearDown(() => AuthService.marcarSesion(false));

  test('marcarSesion mantiene el estado en memoria', () {
    AuthService.marcarSesion(true);
    expect(AuthService.sesionActivaEnMemoria, isTrue);

    AuthService.marcarSesion(false);
    expect(AuthService.sesionActivaEnMemoria, isFalse);
  });

  test('con la sesión en memoria el gate no consulta el almacén', () async {
    AuthService.marcarSesion(true);
    // Sin tocar el almacén (que en test no responde), tieneSesion resuelve al
    // instante gracias al cache: si dependiera del almacén, esto colgaría.
    expect(await AuthGate.tieneSesion().timeout(const Duration(seconds: 1)), isTrue);
  });

  test('el gate usa el cache antes de leer el token', () {
    final src = File('lib/widgets/auth_gate.dart').readAsStringSync();
    expect(src.contains('sesionActivaEnMemoria'), isTrue,
        reason: 'el gate perdió el cache en memoria y vuelve a leer en cada toque');
    expect(src.contains('milliseconds: 1500'), isFalse,
        reason: 'volvió el tope de 1,5 s que convertía lentitud en "sin sesión"');
  });

  test('Glow IA+ pide cuenta al analizar, no al abrir la pantalla', () {
    final capture = File('lib/screens/capture_screen.dart').readAsStringSync();
    expect(capture.contains("accion: 'analizar con Glow IA+'"), isTrue,
        reason: 'la captura debe exigir cuenta en el momento de analizar');

    final welcome = File('lib/screens/welcome_screen.dart').readAsStringSync();
    final inicio = welcome.indexOf('Future<void> _checkExistingConsent() async {');
    final fin = welcome.indexOf('bool _consentAccepted', inicio);
    expect(inicio, greaterThan(-1));
    expect(fin, greaterThan(inicio));
    final bloque = welcome.substring(inicio, fin);
    expect(bloque.contains('AuthGate.requerir'), isFalse,
        reason: 'volvió a pedir login al entrar a Glow IA+');
  });

  test('el chat de Aura se reconoce por nombre además del id', () {
    final chat = File('lib/screens/chat_screen.dart').readAsStringSync();
    expect(chat.contains("contains('aura')"), isTrue,
        reason: 'un deep link a Aura caería en la rama de prestador');
  });
}
