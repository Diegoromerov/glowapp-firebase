// lib/services/connectivity_probe_io.dart
//
// Implementación del sondeo de alcanzabilidad para plataformas con dart:io
// (Android, iOS, macOS, Linux, Windows).
//
// FIX-FLUTTER-08: se evita añadir connectivity_plus — basta una resolución
// DNS con timeout para saber si el dispositivo tiene red real.

import 'dart:async';
import 'dart:io';

/// Devuelve `true` si [host] resuelve por DNS dentro de [timeout].
///
/// No lanza: cualquier fallo se traduce en `false` (sin conectividad).
Future<bool> probeReachability(String host, Duration timeout) async {
  try {
    final result = await InternetAddress.lookup(host).timeout(timeout);
    return result.isNotEmpty && result.first.rawAddress.isNotEmpty;
  } on SocketException {
    return false;
  } on TimeoutException {
    return false;
  } catch (_) {
    return false;
  }
}
