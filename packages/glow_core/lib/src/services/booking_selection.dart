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

/// La selección quedó vacía: o no había nada elegido o el catálogo cambió y
/// ninguno de los ids elegidos sigue existiendo. No se llama a la API.
class SeleccionDeServiciosVaciaException implements Exception {
  const SeleccionDeServiciosVaciaException();

  @override
  String toString() => 'SeleccionDeServiciosVaciaException';
}

/// Resultado de crear una reserva, con lo que realmente se envió y el catálogo
/// vigente (para que la pantalla pueda repintar nombres y precios).
class ReservaCreada {
  const ReservaCreada({
    required this.respuesta,
    required this.serviciosUsados,
    required this.catalogo,
  });

  final Map<String, dynamic> respuesta;
  final List<String> serviciosUsados;
  final List<Map<String, dynamic>> catalogo;
}

/// Crea la reserva saneando la selección y, si el backend responde
/// `SERVICES_NOT_FOUND`, recarga el catálogo y reintenta [reintentos] veces.
///
/// Convierte un 404 opaco en un camino con salida: el servicio que ya no
/// existe desaparece de la selección y, si no queda ninguno, la pantalla puede
/// pedirle a la clienta que elija de nuevo en vez de mostrar «Exception: …».
Future<ReservaCreada> crearReservaConCatalogoFresco({
  required List<Map<String, dynamic>> catalogo,
  required Iterable<String> seleccion,
  required Future<Map<String, dynamic>> Function(List<String> servicioIds) crear,
  required Future<List<Map<String, dynamic>>> Function() recargarCatalogo,
  int reintentos = 1,
}) async {
  var catalogoActual = catalogo;
  var ids = sanearSeleccionDeServicios(catalogoActual, seleccion);
  if (ids.isEmpty) throw const SeleccionDeServiciosVaciaException();

  var restantes = reintentos;
  while (true) {
    try {
      final respuesta = await crear(ids);
      return ReservaCreada(
        respuesta: respuesta,
        serviciosUsados: ids,
        catalogo: catalogoActual,
      );
    } on ServiciosNoEncontradosException {
      if (restantes <= 0) rethrow;
      restantes--;
      catalogoActual = await recargarCatalogo();
      ids = sanearSeleccionDeServicios(catalogoActual, ids);
      if (ids.isEmpty) throw const SeleccionDeServiciosVaciaException();
    }
  }
}
