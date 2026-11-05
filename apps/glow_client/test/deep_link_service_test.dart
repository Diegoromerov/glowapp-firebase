// Ítem 14: la tabla de rutas de los enlaces entrantes. Se prueba sin red ni
// dispositivo porque lo único que puede fallar aquí es la traducción de URL.

import 'package:flutter_test/flutter_test.dart';
import 'package:glow_client/services/deep_link_service.dart';

void main() {
  group('DeepLinkService.mapear', () {
    test('seguimiento de cita aterriza en Mis citas, no en un mapa inventado', () {
      final d = DeepLinkService.mapear(
        Uri.parse('https://glowapp-client.web.app/booking-tracking/abc-123'),
      );
      expect(d, isNotNull);
      expect(d!.ruta, '/my-bookings');
      expect(d.aviso, isNotNull);
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

    test('enlace desconocido vuelve al inicio con aviso', () {
      final d = DeepLinkService.mapear(
        Uri.parse('https://glowapp-client.web.app/algo-raro'),
      );
      expect(d!.ruta, '/home');
      expect(d.aviso, isNotNull);
    });

    test('otra app no se toca', () {
      expect(
        DeepLinkService.mapear(Uri.parse('https://example.com/provider-detail/1')),
        isNull,
      );
    });
  });
}
