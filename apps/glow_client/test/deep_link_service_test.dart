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
}
