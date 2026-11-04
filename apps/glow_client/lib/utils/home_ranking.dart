import 'package:glow_core/glow_core.dart';

/// Orden del home: «cerca y disponible hoy».
///
/// 1. Quien puede atender **hoy** va primero: una ficha a 300 m con cita el
///    jueves no resuelve «quiero algo ahora».
/// 2. Después, por franja de cercanía de 1 km (evita que 300 m de diferencia
///    pesen más que la calidad).
/// 3. Dentro de la franja, por nota ponderada: sin reseñas no se corona.
///
/// El backend ya devuelve la lista ordenada así; esta función existe para
/// reordenar cuando el usuario cambia filtros en el cliente y para poder probar
/// la regla sin red.
List<ProviderModel> ordenarParaHome(List<ProviderModel> proveedores) {
  final copia = [...proveedores];
  copia.sort((a, b) {
    if (a.availableToday != b.availableToday) return a.availableToday ? -1 : 1;

    final franjaA = a.distanceMeters ~/ 1000;
    final franjaB = b.distanceMeters ~/ 1000;
    if (franjaA != franjaB) return franjaA.compareTo(franjaB);

    final nota = _notaPonderada(b).compareTo(_notaPonderada(a));
    if (nota != 0) return nota;

    // Desempate estable: el más cercano.
    return a.distanceMeters.compareTo(b.distanceMeters);
  });
  return copia;
}

/// Media bayesiana: arranca en 4.0 y se acerca a la nota real con reseñas.
double _notaPonderada(ProviderModel p) {
  const previa = 4.0;
  const peso = 5;
  final n = p.ratingCount;
  return ((p.ratingAvg * n) + (previa * peso)) / (n + peso);
}
