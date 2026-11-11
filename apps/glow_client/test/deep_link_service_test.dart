// Ítem 14: la tabla de rutas de los enlaces entrantes. Se prueba sin red ni
// dispositivo porque lo único que puede fallar aquí es la traducción de URL.

import 'package:flutter_test/flutter_test.dart';
import 'package:glow_client/services/deep_link_service.dart';

void main() {
  group('DeepLinkService.mapear', () {
    test('seguimiento de cita abre la reserva indicada', () {
      final d = DeepLinkService.mapear(
        Uri.parse('https://glowapp-client.web.app/booking-tracking/abc-123'),
      );
      expect(d, isNotNull);
      expect(d!.ruta, '/booking-tracking');
      expect(d.argumentos['booking'], {'id': 'abc-123'});
      expect(d.aviso, isNull);
    });

    test('seguimiento acepta el id en query y rechaza links sin id', () {
      final conId = DeepLinkService.mapear(
        Uri.parse('https://glowapp-client.web.app/booking-tracking?id=abc-123'),
      );
      expect(conId!.ruta, '/booking-tracking');
      expect(conId.argumentos['booking'], {'id': 'abc-123'});

      final sinId = DeepLinkService.mapear(
        Uri.parse('https://glowapp-client.web.app/booking-tracking'),
      );
      expect(sinId!.ruta, '/my-bookings');
      expect(sinId.aviso, contains('no indicaba'));
    });

    test('ficha del prestador por ruta limpia', () {
      final d = DeepLinkService.mapear(
        Uri.parse('https://glowapp-client.web.app/provider-detail/42'),
      );
      expect(d!.ruta, '/provider-detail');
      expect(d.argumentos['providerId'], '42');
    });

    test('ficha del prestador por esquema propio y query', () {
      final d = DeepLinkService.mapear(
        Uri.parse('glowapp://provider-detail?id=7'),
      );
      expect(d!.ruta, '/provider-detail');
      expect(d.argumentos['providerId'], '7');
    });

    test('fragmento del router web', () {
      final d = DeepLinkService.mapear(Uri.parse('/#/provider-detail/9'));
      expect(d!.ruta, '/provider-detail');
      expect(d.argumentos['providerId'], '9');
    });

    test('invitación retirada se explica, no rompe', () {
      final d = DeepLinkService.mapear(
        Uri.parse('https://glowapp-client.web.app/auth/accept-invitation'),
      );
      expect(d!.ruta, '/auth/login');
      expect(d.aviso, contains('prestadores'));
    });

    test('enlace desconocido se ignora (antes sacaba al usuario de la app)', () {
      // Cambió a propósito: devolver `/home` con aviso hacía que, sin sesión,
      // el host terminara en pushNamedAndRemoveUntil('/auth/login'). Un enlace
      // roto no debe expulsar a nadie.
      expect(
        DeepLinkService.mapear(Uri.parse('https://glowapp-client.web.app/algo-raro')),
        isNull,
      );
    });

    test('otra app no se toca', () {
      expect(
        DeepLinkService.mapear(
            Uri.parse('https://example.com/provider-detail/1')),
        isNull,
      );
    });
  });

  group('el enlace compartido sobrevive al router', () {
    // Medido con CDP sobre producción: el link del perfil terminaba en el home
    // porque Flutter reescribe la URL como `/provider-detail/3#/home` y el
    // fragmento (ruta interna) tapaba el path del enlace.
    test('el path manda cuando el fragmento es una ruta interna', () {
      final d = DeepLinkService.mapear(
        Uri.parse(
            'https://glowapp-client.web.app/provider-detail/3#/home'),
      );
      expect(d, isNotNull, reason: 'el enlace no puede perderse');
      expect(d!.ruta, '/provider-detail');
      expect(d.argumentos['providerId'], '3');
    });

    test('una ruta interna con path vacío no es un enlace', () {
      expect(
        DeepLinkService.mapear(Uri.parse('https://glowapp-client.web.app/#/home')),
        isNull,
      );
    });

    test('la ficha del prestador es pública; lo personal pide sesión', () {
      expect(DeepLinkService.requiereSesion('/provider-detail'), isFalse,
          reason: 'el catálogo es público: el receptor del share no tiene cuenta');
      expect(DeepLinkService.requiereSesion('/booking-tracking'), isTrue);
      expect(DeepLinkService.requiereSesion('/my-bookings'), isTrue);
    });
  });

  group('la URL de la propia app no es un enlace entrante', () {
    // Bug real: al abrir la web sin sesión, Flutter ponía #/home, el host lo
    // leía como enlace, no había sesión y hacía pushNamedAndRemoveUntil al
    // login. La home nunca se veía.
    for (final ruta in <String>[
      '/#/home',
      '/#/auth/login',
      '/#/auth/register',
      '/#/chat',
      '/#/store',
      '/#/my-bookings',
      '/#/profile',
      '/#/ideas/welcome',
    ]) {
      test('ignora $ruta', () {
        expect(DeepLinkService.mapear(Uri.parse('https://glowapp-client.web.app$ruta')),
            isNull);
      });
    }

    test('un enlace desconocido se ignora en vez de sacar al usuario de la app', () {
      expect(
        DeepLinkService.mapear(
            Uri.parse('https://glowapp-client.web.app/#/no-existe')),
        isNull,
      );
    });

    test('los enlaces de correo siguen funcionando', () {
      final d = DeepLinkService.mapear(
        Uri.parse('https://glowapp-client.web.app/#/booking-tracking/abc-123'),
      );
      expect(d!.ruta, '/booking-tracking');
    });
  });

  group('arranque en web', () {
    test('la URL de la pestaña se traduce al destino del prestador', () {
      DeepLinkService.fijarUrlDeArranqueParaPruebas(
          Uri.parse('http://localhost:8099/provider-detail/3'));
      final inicial = DeepLinkService.inicialWeb();
      expect(inicial, isNotNull, reason: 'el path del enlace debe conservarse');
      final destino = DeepLinkService.mapear(inicial!);
      expect(destino?.ruta, '/provider-detail');
      expect(destino?.argumentos['providerId'], '3');
      expect(DeepLinkService.requiereSesion(destino!.ruta), isFalse);
      DeepLinkService.fijarUrlDeArranqueParaPruebas(null);
    });

    test('la home no es un enlace aunque la URL traiga el fragmento', () {
      DeepLinkService.fijarUrlDeArranqueParaPruebas(
          Uri.parse('http://localhost:8099/#/home'));
      final inicial = DeepLinkService.inicialWeb();
      expect(inicial == null || DeepLinkService.mapear(inicial) == null, isTrue);
      DeepLinkService.fijarUrlDeArranqueParaPruebas(null);
    });
  });
}
