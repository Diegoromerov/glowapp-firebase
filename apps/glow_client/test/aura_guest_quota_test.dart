// apps/glow_client/test/aura_guest_quota_test.dart
//
// Regla: Aura se puede probar sin cuenta, pero solo dos preguntas. Este test
// fija el corte y que el contador persista entre recargas (SharedPreferences).
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_client/services/aura_guest_quota.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('un visitante arranca sin preguntas usadas', () async {
    expect(await AuraGuestQuota.usadas(), 0);
    expect(await AuraGuestQuota.requiereCuenta(), isFalse);
  });

  test('las dos primeras preguntas son libres y la tercera pide cuenta', () async {
    expect(await AuraGuestQuota.requiereCuenta(), isFalse);
    await AuraGuestQuota.registrar(); // pregunta 1

    expect(await AuraGuestQuota.requiereCuenta(), isFalse);
    await AuraGuestQuota.registrar(); // pregunta 2

    expect(await AuraGuestQuota.usadas(), 2);
    expect(await AuraGuestQuota.requiereCuenta(), isTrue,
        reason: 'la tercera pregunta tiene que pedir cuenta');
  });

  test('el contador sobrevive a una recarga', () async {
    await AuraGuestQuota.registrar();
    await AuraGuestQuota.registrar();

    final prefs = await SharedPreferences.getInstance();
    await prefs.reload();

    expect(await AuraGuestQuota.usadas(), 2);
  });

  test('al iniciar sesión la cuota vuelve a cero', () async {
    await AuraGuestQuota.registrar();
    await AuraGuestQuota.registrar();
    await AuraGuestQuota.reiniciar();

    expect(await AuraGuestQuota.usadas(), 0);
    expect(await AuraGuestQuota.requiereCuenta(), isFalse);
  });
}
