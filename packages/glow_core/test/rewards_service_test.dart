// La aritmética del canje tal como la ve la app.
//
// El número que se cobra lo calcula el backend, pero la pantalla necesita
// previsualizar cuántos puntos caben en el carrito. Si esta cuenta y la del
// servidor no coinciden, la usuaria ve un total y paga otro: de ahí que las
// reglas (15%, bloques de 100, mínimo de $25.000) se prueben aquí también.
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glow_core.dart';

void main() {
  const saldo = SaldoPuntos(saldo: 500);

  group('SaldoPuntos.puntosAplicablesEn', () {
    test('sin saldo suficiente no aplica nada', () {
      const vacio = SaldoPuntos(saldo: 0);
      expect(vacio.puntosAplicablesEn(50000), 0);
      expect(vacio.tieneSaldo, isFalse);
    });

    test('por debajo del mínimo no aplica, aunque haya saldo', () {
      expect(saldo.puntosAplicablesEn(20000), 0);
    });

    test('el tope del 15% recorta en pedidos pequeños', () {
      // 15% de 25.000 = 3.750 -> 375 puntos -> bloque de 100 = 300
      expect(saldo.puntosAplicablesEn(25000), 300);
    });

    test('desde \$33.334 cabe el premio completo de 500 puntos', () {
      expect(saldo.puntosAplicablesEn(33334), 500);
      expect(saldo.puntosAplicablesEn(33333), 400);
    });

    test('nunca aplica más de lo que tiene', () {
      // Pedido grande: el tope no limita, el saldo sí.
      expect(saldo.puntosAplicablesEn(500000), 500);
    });

    test('el resultado siempre es múltiplo del bloque', () {
      for (final total in [25000, 30000, 33333, 40000, 50000, 89000]) {
        expect(saldo.puntosAplicablesEn(total) % saldo.bloqueCanje, 0);
      }
    });

    test('el descuento nunca supera el 15% del pedido', () {
      for (final total in [25000, 30000, 50000, 89000]) {
        final puntos = saldo.puntosAplicablesEn(total);
        expect(saldo.pesosDe(puntos), lessThanOrEqualTo((total * 0.15).floor()));
      }
    });
  });

  group('SaldoPuntos.desdeJson', () {
    test('interpreta la respuesta del backend', () {
      final s = SaldoPuntos.desdeJson({
        'saldo': 1200,
        'en_espera': 300,
        'valor_punto_cop': 10,
        'bloque_canje': 100,
        'tope_porcentaje': 15,
        'minimo_pedido': 25000,
        'por_vencer': [
          {'puntos': 500, 'vence_en': '2027-11-01T00:00:00.000Z'},
        ],
      });

      expect(s.saldo, 1200);
      expect(s.enPesos, 12000);
      expect(s.enEspera, 300);
      expect(s.porVencer.single.puntos, 500);
      expect(s.porVencer.single.venceEn?.year, 2027);
    });

    test('una respuesta vacía no revienta la pantalla', () {
      final s = SaldoPuntos.desdeJson({});
      expect(s.saldo, 0);
      expect(s.tieneSaldo, isFalse);
      expect(s.porVencer, isEmpty);
    });
  });
}
