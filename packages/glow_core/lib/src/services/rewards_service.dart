// Saldo del fondo de puntos canjeable y la aritmética que la pantalla necesita.
//
// El saldo NO se calcula en el cliente: lo sirve `GET /api/rewards/points`, que
// ya excluye lo vencido y lo comprometido en pedidos sin pagar. Aquí solo se
// interpreta y se proyecta sobre un pedido concreto, con las mismas reglas que
// aplica el backend (tope del 15%, bloques de 100, mínimo de $25.000). El número
// que se cobra siempre sale del servidor: esto es para mostrar.
import 'package:flutter/foundation.dart';

import 'api_service.dart';

/// Un lote de puntos: lo que se acreditó y cuándo deja de valer.
class LotePuntos {
  final int puntos;
  final DateTime? venceEn;

  const LotePuntos({required this.puntos, this.venceEn});

  factory LotePuntos.desdeJson(Map<String, dynamic> json) {
    final vence = json['vence_en']?.toString();
    return LotePuntos(
      puntos: (json['puntos'] as num?)?.toInt() ?? 0,
      venceEn: vence == null ? null : DateTime.tryParse(vence),
    );
  }
}

/// Lo que la app sabe del saldo de puntos de la usuaria.
class SaldoPuntos {
  final int saldo;
  final int enEspera;
  final int valorPuntoCop;
  final int bloqueCanje;
  final int topePorcentaje;
  final int minimoPedido;
  final List<LotePuntos> porVencer;

  const SaldoPuntos({
    required this.saldo,
    this.enEspera = 0,
    this.valorPuntoCop = 10,
    this.bloqueCanje = 100,
    this.topePorcentaje = 15,
    this.minimoPedido = 25000,
    this.porVencer = const [],
  });

  static const vacio = SaldoPuntos(saldo: 0);

  /// Valor del saldo en pesos.
  int get enPesos => saldo * valorPuntoCop;

  /// `true` si alcanza para al menos un bloque de canje.
  bool get tieneSaldo => saldo >= bloqueCanje;

  /// Puntos que caben en un pedido cuyo valor de productos (con IVA) es
  /// [totalProductos].
  ///
  /// Devuelve 0 si no hay saldo, si el pedido no llega al mínimo o si el tope no
  /// permite ni un bloque. Nunca redondea hacia arriba: quedarse corto es
  /// inofensivo, pasarse rompe la promesa del tope.
  int puntosAplicablesEn(int totalProductos) {
    if (totalProductos < minimoPedido || saldo < bloqueCanje) return 0;
    final descuentoMaximo = (totalProductos * topePorcentaje) ~/ 100;
    final puntosQueCaben =
        (descuentoMaximo ~/ valorPuntoCop ~/ bloqueCanje) * bloqueCanje;
    final disponibles = (saldo ~/ bloqueCanje) * bloqueCanje;
    return puntosQueCaben < disponibles ? puntosQueCaben : disponibles;
  }

  /// Descuento en pesos de [puntos] (útil para mostrar "−$5.000").
  int pesosDe(int puntos) => puntos * valorPuntoCop;

  factory SaldoPuntos.desdeJson(Map<String, dynamic> json) {
    final lotes = (json['por_vencer'] as List?) ?? const [];
    return SaldoPuntos(
      saldo: (json['saldo'] as num?)?.toInt() ?? 0,
      enEspera: (json['en_espera'] as num?)?.toInt() ?? 0,
      valorPuntoCop: (json['valor_punto_cop'] as num?)?.toInt() ?? 10,
      bloqueCanje: (json['bloque_canje'] as num?)?.toInt() ?? 100,
      topePorcentaje: (json['tope_porcentaje'] as num?)?.toInt() ?? 15,
      minimoPedido: (json['minimo_pedido'] as num?)?.toInt() ?? 25000,
      porVencer: lotes
          .whereType<Map>()
          .map((l) => LotePuntos.desdeJson(Map<String, dynamic>.from(l)))
          .toList(),
    );
  }
}

class RewardsService {
  RewardsService._();

  /// Saldo del fondo de puntos. Devuelve `null` si el backend no responde: la
  /// pantalla debe poder seguir funcionando sin mostrar el bloque de canje.
  static Future<SaldoPuntos?> obtenerSaldo() async {
    try {
      final res = await ApiService.get('/api/rewards/points');
      if (res is Map<String, dynamic>) return SaldoPuntos.desdeJson(res);
      if (res is Map) return SaldoPuntos.desdeJson(Map<String, dynamic>.from(res));
      return null;
    } catch (e) {
      debugPrint('⚠️ No se pudo leer el saldo de puntos: $e');
      return null;
    }
  }
}
