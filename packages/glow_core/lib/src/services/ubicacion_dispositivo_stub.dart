// packages/glow_core/lib/src/services/ubicacion_dispositivo_stub.dart
//
// Implementación para plataformas con `geolocator` (Android, iOS, desktop).
// Se elige por import condicional desde `ubicacion_dispositivo.dart`.
//
// Dos entradas, separadas a propósito (ítem 11 — permisos just-in-time):
//   · `ubicacionDisponible()`  nunca abre el diálogo de permisos.
//   · `solicitarUbicacion()`   sí lo abre; solo debe llamarse tras una acción
//                              explícita del usuario (tocar «Mi ubicación»).

import 'package:geolocator/geolocator.dart';

import 'ubicacion_resultado.dart';

/// Lee la ubicación SOLO si el permiso ya está concedido. No pregunta nada.
Future<ResultadoUbicacion> ubicacionDisponible() async {
  try {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return const ResultadoUbicacion.fallo(EstadoUbicacion.servicioApagado);
    }

    final permiso = await Geolocator.checkPermission();
    if (permiso == LocationPermission.deniedForever) {
      return const ResultadoUbicacion.fallo(EstadoUbicacion.denegadaParaSiempre);
    }
    if (permiso == LocationPermission.denied) {
      return const ResultadoUbicacion.fallo(EstadoUbicacion.denegada);
    }

    return _posicionActual();
  } catch (_) {
    return const ResultadoUbicacion.fallo(EstadoUbicacion.noDisponible);
  }
}

/// Pide el permiso si hace falta y devuelve la ubicación.
/// Llamar únicamente desde un gesto del usuario.
Future<ResultadoUbicacion> solicitarUbicacion() async {
  try {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return const ResultadoUbicacion.fallo(EstadoUbicacion.servicioApagado);
    }

    var permiso = await Geolocator.checkPermission();
    if (permiso == LocationPermission.denied) {
      permiso = await Geolocator.requestPermission();
    }

    if (permiso == LocationPermission.deniedForever) {
      return const ResultadoUbicacion.fallo(EstadoUbicacion.denegadaParaSiempre);
    }
    if (permiso == LocationPermission.denied) {
      return const ResultadoUbicacion.fallo(EstadoUbicacion.denegada);
    }

    return _posicionActual();
  } catch (_) {
    return const ResultadoUbicacion.fallo(EstadoUbicacion.noDisponible);
  }
}

Future<ResultadoUbicacion> _posicionActual() async {
  try {
    final Position posicion = await Geolocator.getCurrentPosition(
      desiredAccuracy: LocationAccuracy.high,
      timeLimit: const Duration(seconds: 10),
    );
    return ResultadoUbicacion.concedida(posicion.latitude, posicion.longitude);
  } catch (_) {
    return const ResultadoUbicacion.fallo(EstadoUbicacion.noDisponible);
  }
}
