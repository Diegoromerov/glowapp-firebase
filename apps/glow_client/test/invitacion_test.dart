// Programa de referidos: el código de invitación que llega por la URL y el
// hecho de que la app lo envíe al registrarse. El backend ya sabía generar el
// código y el mensaje; lo que faltaba era que alguien lo leyera.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glow_core.dart';

void main() {
  group('código de invitación en la URL', () {
    test('lo saca del fragmento del router web', () {
      expect(
        codigoInvitacionDeLaUrl(
            Uri.parse('https://glowapp-client.web.app/#/auth/register?ref=GLOWAB12')),
        'GLOWAB12',
      );
    });

    test('también acepta la query normal', () {
      expect(
        codigoInvitacionDeLaUrl(
            Uri.parse('https://glowapp-client.web.app/?ref=glowzz9')),
        'glowzz9',
      );
    });

    test('sin código, sin invención', () {
      expect(codigoInvitacionDeLaUrl(Uri.parse('https://glowapp-client.web.app/#/auth/register')),
          isNull);
      expect(codigoInvitacionDeLaUrl(Uri.parse('https://glowapp-client.web.app/?ref=%20')),
          isNull);
    });
  });

  test('el registro envía el código de invitación al backend', () {
    final registro = File('lib/screens/auth/register_screen.dart');
    final src = registro.readAsStringSync();
    expect(src, contains('codigoInvitacionDeLaUrl'),
        reason: 'el registro tiene que leer el `?ref=` de la URL');
    expect(src, contains('ref:'), reason: 'y pasarlo a AuthService.register');
  });

  test('la pantalla de invitación consume el endpoint y comparte', () {
    final pantalla = File('lib/screens/invite_friends_screen.dart');
    expect(pantalla.existsSync(), isTrue);
    final src = pantalla.readAsStringSync();
    expect(src, contains('/api/auth/referral-info'),
        reason: 'el código y el mensaje los genera el backend, no la app');
    expect(src, contains('SharePlus.instance.share'),
        reason: 'sin hoja del sistema no se invita a nadie');
  });

  test('Recompensas tiene la entrada al programa', () {
    final recompensas = File('lib/screens/rewards_xp_screen.dart');
    expect(recompensas.readAsStringSync(), contains("'/invite'"),
        reason: 'un programa sin entrada no existe para el usuario');
  });

  test('el premio son \$5.000 en puntos, no \$10.000 ni Wompi', () {
    for (final archivo in [
      File('lib/screens/invite_friends_screen.dart'),
      File('lib/screens/rewards_xp_screen.dart'),
    ]) {
      final src = archivo.readAsStringSync();
      expect(src, isNot(contains('10.000')),
          reason: 'el monto cambió a \$5.000 por decisión del Director');
      expect(src, contains('5.000'), reason: 'el monto vigente es \$5.000');
    }
    final invita = File('lib/screens/invite_friends_screen.dart').readAsStringSync();
    expect(invita, contains('puntos'),
        reason: 'el premio es un fondo de puntos, no saldo en la pasarela');
  });
}
