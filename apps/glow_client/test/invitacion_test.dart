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

  test('el estímulo es del referente y la pantalla lo explica', () {
    final src = File('lib/screens/invite_friends_screen.dart').readAsStringSync();
    expect(src, contains('Gana'), reason: 'habla en segunda persona al referente');
    expect(src, contains('referidos_convertidos'),
        reason: 'muestra cuántos invitados ya compraron');
    expect(src, contains('tu red crece'),
        reason: 'el efecto red es parte de la mecánica: el referido pasa a referente');
    // El premio NO se le promete al invitado en el mensaje que se comparte.
    final backend = File('../backend/src/controllers/authController.js');
    if (backend.existsSync()) {
      final msg = backend.readAsStringSync();
      expect(msg, isNot(contains('te acreditamos')),
          reason: 'ese texto prometía el premio a quien recibe la invitación');
    }
  });

  group('R-21: el premio se promete en puntos, nunca como una compra', () {
    test('la pantalla promete 500 puntos y dice que son hasta \$5.000', () {
      final src = File('lib/screens/invite_friends_screen.dart').readAsStringSync();
      expect(src, contains('500 puntos'),
          reason: 'el crédito se promete como valor en puntos');
      expect(src, contains(r'hasta \$5.000'),
          reason: 'el tope del 15% por pedido hace que \$5.000 no quepan de una vez');
      expect(src, isNot(contains(r"'Gana \$5.000 COP")),
          reason: 'prometer \$5.000 pelados es una promesa que la mecánica no cumple');
    });

    test('la entrada de Recompensas habla en puntos, no en pesos', () {
      final src = File('lib/screens/rewards_xp_screen.dart').readAsStringSync();
      expect(src, contains('500 puntos (hasta'));
      expect(src, isNot(contains("Invitar amigas · \$5.000 COP en puntos")));
    });
  });

  group('sesión caída en Invitar amigas', () {
    test('esErrorDeSesion reconoce un 401 y no confunde una caída de red', () {
      expect(esErrorDeSesion(Exception('Error 401')), isTrue);
      expect(esErrorDeSesion(Exception('UNAUTHORIZED')), isTrue);
      expect(esErrorDeSesion(Exception('SocketException: Failed host lookup')), isFalse);
      expect(esErrorDeSesion(Exception('Error 500')), isFalse);
    });

    test('con la sesión caída la pantalla manda a iniciar sesión, no a reintentar', () {
      final src = File('lib/screens/invite_friends_screen.dart').readAsStringSync();
      expect(src, contains('_errorEsSesion = esErrorDeSesion(e)'),
          reason: 'hay que distinguir sesión de red para no ofrecer el botón que falla');
      expect(src, contains("pushNamed('/auth/login')"),
          reason: 'el visitante sin sesión necesita una salida, no un bucle');
    });
  });
}
