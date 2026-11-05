// packages/glow_core/lib/src/services/ubicacion_resultado.dart
//
// Resultado tipado de una petición de ubicación (ítem 11 de la auditoría).
//
// Antes, `getWebGeolocation()` devolvía siempre un `Map` con coordenadas: si el
// permiso estaba denegado, el GPS apagado o el usuario bloqueaba la app, la
// pantalla recibía el centro de Bogotá y seguía como si todo hubiera ido bien.
// El resultado era indistinguible de un éxito, así que la app nunca podía
// explicar nada ni ofrecer los ajustes.
//
// Este tipo separa «no hay ubicación» de «hay ubicación» y dice POR QUÉ.

/// Estado final de un intento de obtener la ubicación del dispositivo.
enum EstadoUbicacion {
  /// Hay coordenadas utilizables.
  concedida,

  /// El usuario denegó el permiso en este intento (se le puede volver a pedir).
  denegada,

  /// El sistema ya no preguntará más: solo se resuelve desde los ajustes.
  denegadaParaSiempre,

  /// El servicio de ubicación del dispositivo está apagado (GPS/ubicación off).
  servicioApagado,

  /// La plataforma no expone ubicación o la llamada falló.
  noDisponible,
}

/// Coordenadas más el motivo cuando no las hay.
class ResultadoUbicacion {
  const ResultadoUbicacion._(this.estado, this.lat, this.lon);

  const ResultadoUbicacion.concedida(double lat, double lon)
      : this._(EstadoUbicacion.concedida, lat, lon);

  const ResultadoUbicacion.fallo(EstadoUbicacion estado)
      : this._(estado, null, null);

  final EstadoUbicacion estado;
  final double? lat;
  final double? lon;

  /// `true` solo cuando hay coordenadas reales.
  bool get ok => estado == EstadoUbicacion.concedida && lat != null && lon != null;

  @override
  String toString() => 'ResultadoUbicacion(${estado.name}, lat: $lat, lon: $lon)';
}
