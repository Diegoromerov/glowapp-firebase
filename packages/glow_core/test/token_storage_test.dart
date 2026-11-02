// Invariante de seguridad: el token de sesión vive en el almacenamiento seguro.
//
// Comprobado al auditar: `auth_service` guarda el token con
// `SecureStorageService().write('token', …)` y en SharedPreferences solo deja
// metadatos (userId, userName, userRole, activeBusinessProfileId). Esta prueba
// existe para que nadie lo degrade sin darse cuenta: en Android/iOS las prefs van
// en texto plano y entran en la copia de seguridad del dispositivo.
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('auth_service no guarda credenciales en SharedPreferences', () {
    final texto = File('lib/src/services/auth_service.dart').readAsStringSync();

    final escrituras = RegExp(r"prefs\.set(?:String|Bool)\(\s*'([^']+)'")
        .allMatches(texto)
        .map((m) => m.group(1)!)
        .where((clave) =>
            RegExp(r'token|jwt|refresh|password|secret', caseSensitive: false)
                .hasMatch(clave))
        .toList();

    expect(escrituras, isEmpty,
        reason: 'las credenciales van a SecureStorageService, no a prefs');
  });

  test('el token se escribe en el almacenamiento seguro', () {
    final texto = File('lib/src/services/auth_service.dart').readAsStringSync();
    expect(texto.contains("SecureStorageService().write('token'"), isTrue);
  });
}
