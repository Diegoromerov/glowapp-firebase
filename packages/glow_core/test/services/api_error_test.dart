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

  group('parseSaasQuotaExceeded', () {
    test('preserva el uso, el límite, el plan y la ruta de actualización', () {
      final error = parseSaasQuotaExceeded(
        '{"code":"SAAS_QUOTA_EXCEEDED","error":"Límite alcanzado",'
        '"feature":"DIRECT_BOOKINGS","current":30,"limit":30,'
        '"currentPlan":"FREEMIUM","upgradeUrl":"/api/saas/billing/checkout"}',
      );

      expect(error, isA<SaasQuotaExceededException>());
      expect(error?.message, 'Límite alcanzado');
      expect(error?.feature, 'DIRECT_BOOKINGS');
      expect(error?.current, 30);
      expect(error?.limit, 30);
      expect(error?.plan, 'FREEMIUM');
      expect(error?.upgradeUrl, '/api/saas/billing/checkout');
    });

    test('acepta la forma de cupo de recursos y descarta otros errores', () {
      final error = parseSaasQuotaExceeded(
        '{"code":"SAAS_QUOTA_EXCEEDED","error":"Límite alcanzado",'
        '"feature":"RESOURCES","current":5,"max":5,"plan":"BASIC"}',
      );
      expect(error?.limit, 5);
      expect(error?.plan, 'BASIC');
      expect(parseSaasQuotaExceeded('{"code":"OTHER_ERROR"}'), isNull);
      expect(parseSaasQuotaExceeded('<html>proxy</html>'), isNull);
    });

    test('interpreta el cupo de asientos del equipo', () {
      final error = parseSaasQuotaExceeded(
        '{"code":"SAAS_QUOTA_EXCEEDED","error":"Límite de asientos alcanzado",'
        '"feature":"TEAM_SEATS","current":3,"limit":3,"plan":"FREEMIUM"}',
      );

      expect(error?.feature, 'TEAM_SEATS');
      expect(error?.current, 3);
      expect(error?.limit, 3);
    });
  });
}
