// apps/glow_client/lib/services/aura_guest_quota.dart
//
// Aura es la puerta de entrada al producto: se puede conversar sin cuenta, pero
// no indefinidamente. Se permiten dos preguntas anónimas; a la tercera se pide
// cuenta. El contador vive en el dispositivo para sobrevivir a recargas en web.
import 'package:shared_preferences/shared_preferences.dart';

class AuraGuestQuota {
  AuraGuestQuota._();

  /// Preguntas que un visitante puede hacer sin cuenta.
  static const int preguntasLibres = 2;

  static const String _clave = 'aura_preguntas_sin_cuenta';

  /// Preguntas ya enviadas como visitante.
  static Future<int> usadas() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getInt(_clave) ?? 0;
    } catch (_) {
      return 0;
    }
  }

  /// Suma una pregunta enviada y devuelve el total.
  static Future<int> registrar() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final total = (prefs.getInt(_clave) ?? 0) + 1;
      await prefs.setInt(_clave, total);
      return total;
    } catch (_) {
      // Sin almacenamiento no se puede contar: se deja pasar y el gate real
      // queda del lado del servidor.
      return 0;
    }
  }

  /// True cuando la próxima pregunta ya exige cuenta.
  static Future<bool> requiereCuenta() async =>
      await usadas() >= preguntasLibres;

  /// Se llama al iniciar sesión: la cuenta arranca con el contador limpio.
  static Future<void> reiniciar() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_clave);
    } catch (_) {
      // nada que limpiar
    }
  }
}
