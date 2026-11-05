// packages/glow_core/lib/src/services/ubicacion_dispositivo_web.dart
//
// Implementación para Flutter web. Se elige por import condicional.
//
// En web el diálogo del navegador lo dispara `getCurrentPosition()`, no existe
// un `requestPermission()` aparte. Por eso:
//   · `ubicacionDisponible()`  consulta la Permissions API y NO llama a
//                              `getCurrentPosition` si el estado es `prompt`:
//                              así el navegador no pregunta al arrancar.
//   · `solicitarUbicacion()`   llama a `getCurrentPosition`, que es lo que
//                              provoca el aviso del navegador.

import 'dart:async';
import 'dart:js' as js;

import 'ubicacion_resultado.dart';

Future<ResultadoUbicacion> ubicacionDisponible() async {
  final estado = await _estadoPermiso();
  if (estado == 'denied') {
    return const ResultadoUbicacion.fallo(EstadoUbicacion.denegadaParaSiempre);
  }
  if (estado == 'granted') {
    return _posicionActual();
  }
  // 'prompt' o 'desconocido': no hay permiso todavía y no lo pedimos aquí.
  return const ResultadoUbicacion.fallo(EstadoUbicacion.denegada);
}

Future<ResultadoUbicacion> solicitarUbicacion() async {
  final estado = await _estadoPermiso();
  if (estado == 'denied') {
    return const ResultadoUbicacion.fallo(EstadoUbicacion.denegadaParaSiempre);
  }
  return _posicionActual();
}

/// Estado del permiso según la Permissions API: granted | prompt | denied.
Future<String> _estadoPermiso() async {
  final completer = Completer<String>();
  try {
    final navigator = js.context['navigator'];
    final permissions = navigator['permissions'];
    if (permissions == null) return 'desconocido';

    final descriptor = js.JsObject.jsify(<String, String>{'name': 'geolocation'});
    final promesa = permissions.callMethod('query', [descriptor]);
    promesa.callMethod('then', [
      (js.JsObject estado) {
        if (!completer.isCompleted) {
          completer.complete(estado['state']?.toString() ?? 'desconocido');
        }
      },
      (dynamic _) {
        if (!completer.isCompleted) completer.complete('desconocido');
      },
    ]);

    return await completer.future.timeout(
      const Duration(seconds: 2),
      onTimeout: () => 'desconocido',
    );
  } catch (_) {
    return 'desconocido';
  }
}

Future<ResultadoUbicacion> _posicionActual() async {
  try {
    final geolocation = js.context['navigator']['geolocation'];
    if (geolocation == null) {
      return const ResultadoUbicacion.fallo(EstadoUbicacion.noDisponible);
    }

    final completer = Completer<ResultadoUbicacion>();
    geolocation.callMethod('getCurrentPosition', [
      (js.JsObject posicion) {
        final coords = posicion['coords'];
        final lat = double.tryParse(coords['latitude']?.toString() ?? '');
        final lon = double.tryParse(coords['longitude']?.toString() ?? '');
        if (!completer.isCompleted) {
          completer.complete(lat != null && lon != null
              ? ResultadoUbicacion.concedida(lat, lon)
              : const ResultadoUbicacion.fallo(EstadoUbicacion.noDisponible));
        }
      },
      (js.JsObject error) {
        if (!completer.isCompleted) {
          // 1 = PERMISSION_DENIED; el navegador no distingue «para siempre».
          final codigo = int.tryParse(error['code']?.toString() ?? '');
          completer.complete(ResultadoUbicacion.fallo(
            codigo == 1
                ? EstadoUbicacion.denegadaParaSiempre
                : EstadoUbicacion.noDisponible,
          ));
        }
      },
      js.JsObject.jsify(<String, dynamic>{
        'enableHighAccuracy': true,
        'timeout': 10000,
      }),
    ]);

    return await completer.future.timeout(
      const Duration(seconds: 11),
      onTimeout: () => const ResultadoUbicacion.fallo(EstadoUbicacion.noDisponible),
    );
  } catch (_) {
    return const ResultadoUbicacion.fallo(EstadoUbicacion.noDisponible);
  }
}
