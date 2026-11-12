
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_client/main.dart';

void main() {
  group('rutaDeArranque', () {
    test('el enlace de invitación abre el registro', () {
      expect(
        rutaDeArranque(Uri.parse('https://x.app/#/register?ref=GLOW927E')),
        '/register?ref=GLOW927E',
      );
    });

    test('una ficha compartida abre su detalle', () {
      expect(
        rutaDeArranque(Uri.parse('https://x.app/#/provider-detail/7')),
        '/provider-detail/7',
      );
    });

    test('sin ruta en la URL, abre el inicio', () {
      expect(rutaDeArranque(Uri.parse('https://x.app/')), '/home');
      expect(rutaDeArranque(Uri.parse('https://x.app')), '/home');
    });

    test('un fragmento vacío no rompe el arranque', () {
      expect(rutaDeArranque(Uri.parse('https://x.app/#')), '/home');
    });
  });
}
