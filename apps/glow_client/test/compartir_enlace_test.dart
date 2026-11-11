// El enlace que se comparte tiene que ser la página del backend, no el path de
// la web: solo esa página lleva `og:image`, y sin ella el enlace se ve pelado en
// WhatsApp e Instagram. Medido: el path crudo además abría el home.
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glow_core.dart';

void main() {
  group('enlace para compartir un prestador', () {
    test('apunta a la página de compartir de la API', () {
      expect(
        SocialShareService.enlacePrestador(
          baseUrl: 'https://glowapp-api-production.up.railway.app',
          providerId: '3',
        ),
        'https://glowapp-api-production.up.railway.app/s/provider/3',
      );
    });

    test('tolera una barra final en la base', () {
      expect(
        SocialShareService.enlacePrestador(
          baseUrl: 'https://glowapp-api-production.up.railway.app/',
          providerId: '42',
        ),
        'https://glowapp-api-production.up.railway.app/s/provider/42',
      );
    });

    test('no usa el path crudo de la web (sin tarjeta OG)', () {
      final enlace = SocialShareService.enlacePrestador(
        baseUrl: 'https://glowapp-api-production.up.railway.app',
        providerId: '3',
      );
      expect(enlace, isNot(contains('glowapp-client.web.app/provider-detail')));
      expect(enlace, contains('/s/provider/'));
    });
  });
}
