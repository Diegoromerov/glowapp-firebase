// packages/glow_core/lib/src/services/booking_selection.dart
import 'dart:convert';

/// Saneamiento de la selección de servicios antes de crear una reserva.
///
/// El backend exige que TODOS los ids enviados existan y sean del prestador;
/// si no, responde 404 `SERVICES_NOT_FOUND`. Un id duplicado (la UI permite
/// tocar la misma tarjeta dos veces) o un id de un catálogo cacheado que ya
/// cambió convertían eso en un callejón sin salida para la clienta.

/// Ids de [seleccionados] que existen en [servicios], sin duplicados y en orden.
List<String> sanearSeleccionDeServicios(
  List<Map<String, dynamic>> servicios,
  Iterable<String> seleccionados,
) {
  final disponibles = <String>{
    for (final s in servicios)
      if (s['id'] != null) s['id'].toString(),
  };
  final vistos = <String>{};
  final limpios = <String>[];
  for (final id in seleccionados) {
    final limpio = id.trim();
    if (limpio.isEmpty) continue;
    if (!disponibles.contains(limpio)) continue;
    if (!vistos.add(limpio)) continue;
    limpios.add(limpio);
  }
  return limpios;
}

/// `true` si la respuesta es el 404 `SERVICES_NOT_FOUND` del backend.
bool esServiciosNoEncontrados(int statusCode, String body) {
  if (statusCode != 404) return false;
  try {
    final data = jsonDecode(body);
    if (data is Map) return data['code'] == 'SERVICES_NOT_FOUND';
  } catch (_) {
    // Cuerpo no JSON (proxy, HTML): no es el error del catálogo.
  }
  return false;
}

/// El backend rechazó la reserva porque el catálogo cambió bajo los pies.
///
/// La pantalla que la recibe sabe recargar el detalle del prestador y
/// reintentar una vez; cualquier otro error sigue siendo un mensaje de texto.
class ServiciosNoEncontradosException implements Exception {
  const ServiciosNoEncontradosException();

  @override
  String toString() => 'ServiciosNoEncontradosException';
}
