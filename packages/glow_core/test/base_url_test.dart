// En release sin `--dart-define=API_URL`, la app no puede quedarse sondeando IPs
// de LAN por HTTP ni caer en silencio a `stagingUrl` (el backend de demostración):
// terminaría mostrando datos del sitio equivocado sin ningún aviso.
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('el sondeo de hosts de LAN está detrás de kDebugMode', () {
    final texto = File('lib/src/services/api_service.dart').readAsStringSync();

    final inicioMetodo = texto.indexOf('static Future<void> ensureBaseUrl');
    final iLoop = texto.indexOf('for (final host in _candidateHosts)');

    expect(inicioMetodo, greaterThan(-1));
    expect(iLoop, greaterThan(inicioMetodo),
        reason: 'el sondeo debe seguir dentro de ensureBaseUrl');

    final antes = texto.substring(inicioMetodo, iLoop);
    expect(RegExp(r'if \(!kDebugMode\)').hasMatch(antes), isTrue,
        reason: 'en release no se sondean hosts de LAN');
    expect(antes.contains('API_URL'), isTrue,
        reason: 'el error debe decir qué falta en la build');
  });
}
