// lib/services/connectivity_service.dart
//
// FIX-FLUTTER-08 (P1) — Detección de conectividad sin dependencias externas.
//
// El audit detectó que la app no tenía ninguna noción de conectividad
// (no se podía usar connectivity_plus sin añadir dependencias). Este servicio
// resuelve el problema con un sondeo DNS inyectable a través de un import
// condicional, de modo que funciona en móvil/escritorio (dart:io) y compila
// también en web.

import 'dart:async';

import 'package:flutter/foundation.dart';

import 'connectivity_probe_stub.dart'
    if (dart.library.io) 'connectivity_probe_io.dart' as probe_impl;

/// Error lanzado cuando una petición se descarta porque no hay conectividad.
///
/// Es distinto de un timeout: no se consumió el timeout de red porque la
/// petición nunca se envió.
class OfflineException implements Exception {
  const OfflineException([this.message = 'Sin conexión a internet']);

  final String message;

  @override
  String toString() => 'OfflineException: $message';
}

/// Monitorea la conectividad de red mediante un sondeo DNS.
///
/// Es un singleton estático: el estado es compartido por todo el proceso y las
/// pruebas pueden inyectar un [probe] determinista sin tocar la red real.
class ConnectivityService {
  ConnectivityService._();

  static final ConnectivityService instance = ConnectivityService._();

  factory ConnectivityService() => instance;

  /// Host usado para el sondeo de alcanzabilidad.
  static String probeHost = 'one.one.one.one';

  /// Tiempo máximo que puede tardar el sondeo.
  static Duration probeTimeout = const Duration(seconds: 3);

  /// Ventana durante la cual se reutiliza el último resultado conocido.
  ///
  /// Evita una resolución DNS por cada petición HTTP.
  static Duration cacheTtl = const Duration(seconds: 10);

  /// Sondeo de conectividad. Inyectable para pruebas.
  static Future<bool> Function() probe = _platformProbe;

  static bool _isConnected = true; // optimista hasta demostrar lo contrario
  static DateTime? _lastCheck;

  /// Último estado de conectividad conocido. Optimista por defecto para no
  /// bloquear la primera petición de la app.
  static bool get isConnected => _isConnected;

  static Future<bool> _platformProbe() =>
      probe_impl.probeReachability(probeHost, probeTimeout);

  /// Comprueba la conectividad, reutilizando el resultado cacheado salvo que
  /// [force] sea `true`.
  ///
  /// Nunca lanza: un fallo del sondeo se interpreta como "sin conectividad".
  static Future<bool> check({bool force = false}) async {
    final now = DateTime.now();
    if (!force &&
        _lastCheck != null &&
        now.difference(_lastCheck!) < cacheTtl) {
      return _isConnected;
    }

    bool reachable;
    try {
      reachable = await probe().timeout(probeTimeout + const Duration(seconds: 1));
    } catch (_) {
      reachable = false;
    }

    _isConnected = reachable;
    _lastCheck = now;
    if (kDebugMode && !reachable) {
      debugPrint('📴 ConnectivityService: sin conexión detectada');
    }
    return reachable;
  }

  /// Restaura el estado y el sondeo por defecto. Solo para pruebas.
  @visibleForTesting
  static void resetForTesting() {
    _isConnected = true;
    _lastCheck = null;
    probeHost = 'one.one.one.one';
    probeTimeout = const Duration(seconds: 3);
    cacheTtl = const Duration(seconds: 10);
    probe = _platformProbe;
  }
}
