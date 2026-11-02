import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/src/services/api_error.dart';

void main() {
  group('extractApiError', () {
    test('usa el mensaje del servidor cuando el cuerpo es JSON', () {
      expect(
        extractApiError(400, '{"error":"costo debe ser un número"}'),
        'costo debe ser un número',
      );
    });

    test('usa message cuando no hay error', () {
      expect(
        extractApiError(409, '{"message":"Ya hay un pago en curso"}'),
        'Ya hay un pago en curso',
      );
    });

    test('no revienta con el HTML de un 502', () {
      final msg = extractApiError(502, '<html><body>Bad Gateway</body></html>');
      expect(msg, contains('502'));
      expect(msg.toLowerCase(), contains('servidor'));
    });

    test('cuerpo vacío devuelve un mensaje con el status', () {
      expect(extractApiError(504, ''), contains('504'));
    });

    test('respeta el fallback aportado por la llamada', () {
      expect(
        extractApiError(500, 'no-json', fallback: 'Error al obtener productos'),
        contains('Error al obtener productos'),
      );
    });

    test('nunca devuelve el HTML crudo al usuario', () {
      final msg = extractApiError(502, '<html><body>Bad Gateway</body></html>');
      expect(msg.contains('<html'), isFalse);
    });
  });
}
