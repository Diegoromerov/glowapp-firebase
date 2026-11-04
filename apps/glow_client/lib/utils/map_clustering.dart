import 'dart:math' as math;

import 'package:latlong2/latlong.dart';

/// Un prestador listo para pintarse como pin.
class PinPunto {
  final String id;
  final LatLng posicion;

  /// Merece pin grande (precio o inicial). El resto van como punto.
  final bool destacado;

  const PinPunto({
    required this.id,
    required this.posicion,
    this.destacado = false,
  });
}

/// Varios pines que se pintan como uno solo.
class GrupoPines {
  final Set<String> ids;
  final LatLng centro;
  final bool destacado;

  const GrupoPines({
    required this.ids,
    required this.centro,
    required this.destacado,
  });

  bool get esCluster => ids.length > 1;
}

/// Distancia en píxeles entre dos coordenadas a un zoom dado (Web Mercator).
///
/// Se mide en píxeles y no en metros porque lo que importa es lo que se ve: dos
/// locales a 300 m pueden estar a 2 px con el mapa alejado y a 200 px acercado.
double pixelesEntre(LatLng a, LatLng b, double zoom) {
  final escala = 256.0 * math.pow(2, zoom);

  double x(double lon) => (lon + 180.0) / 360.0 * escala;
  double y(double lat) {
    final rad = lat * math.pi / 180.0;
    return (1.0 - math.log(math.tan(rad) + 1.0 / math.cos(rad)) / math.pi) / 2.0 * escala;
  }

  final dx = x(a.longitude) - x(b.longitude);
  final dy = y(a.latitude) - y(b.latitude);
  return math.sqrt(dx * dx + dy * dy);
}

/// Agrupa pines que caen a menos de [umbralPx] entre sí.
///
/// Un grupo conserva `destacado` si alguno de sus miembros lo era: si hay un
/// prestador bueno dentro del montón, el montón debe verse.
List<GrupoPines> agruparPines(
  List<PinPunto> pines, {
  required double zoom,
  double umbralPx = 40,
}) {
  final grupos = <GrupoPines>[];

  for (final pin in pines) {
    var indiceDestino = -1;
    for (var i = 0; i < grupos.length; i++) {
      if (pixelesEntre(grupos[i].centro, pin.posicion, zoom) < umbralPx) {
        indiceDestino = i;
        break;
      }
    }

    if (indiceDestino == -1) {
      grupos.add(GrupoPines(
        ids: {pin.id},
        centro: pin.posicion,
        destacado: pin.destacado,
      ));
      continue;
    }

    final actual = grupos[indiceDestino];
    final total = actual.ids.length;
    final centro = LatLng(
      (actual.centro.latitude * total + pin.posicion.latitude) / (total + 1),
      (actual.centro.longitude * total + pin.posicion.longitude) / (total + 1),
    );
    grupos[indiceDestino] = GrupoPines(
      ids: {...actual.ids, pin.id},
      centro: centro,
      destacado: actual.destacado || pin.destacado,
    );
  }

  return grupos;
}
