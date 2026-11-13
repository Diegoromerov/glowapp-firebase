import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';

/// Selector de canje de puntos del carrito de GlowShop.
///
/// Vive fuera de la pantalla para poder probarlo: las reglas del canje (mínimo,
/// tope, bloques) las calcula el servidor, y este bloque muestra una
/// previsualización con la misma fórmula de `SaldoPuntos`. Si las dos se separan,
/// la clienta ve un total que no es el que se cobra — por eso el bloque tiene
/// sus propios casos de prueba.
class BloqueCanjePuntos extends StatelessWidget {
  const BloqueCanjePuntos({
    super.key,
    required this.saldo,
    required this.valorProductos,
    required this.activo,
    required this.onCambio,
  });

  /// Saldo y reglas vigentes, tal como llegaron del backend.
  final SaldoPuntos saldo;

  /// Valor de los productos del carrito con IVA, redondeado.
  final int valorProductos;

  /// Si la clienta ya activó el canje en este pedido.
  final bool activo;

  final ValueChanged<bool> onCambio;

  @override
  Widget build(BuildContext context) {
    final aplicables = saldo.puntosAplicablesEn(valorProductos);
    final alcanzaElMinimo = valorProductos >= saldo.minimoPedido;

    final String detalle;
    if (!alcanzaElMinimo) {
      detalle = 'Con ${_cop(saldo.minimoPedido)} o más en productos '
          'puedes usar hasta el ${saldo.topePorcentaje}%.';
    } else if (aplicables == 0) {
      detalle = 'Este pedido no admite puntos: el tope del '
          '${saldo.topePorcentaje}% no deja aplicar ni ${saldo.bloqueCanje}.';
    } else if (activo) {
      detalle = 'Se aplican $aplicables puntos '
          '(−${_cop(saldo.pesosDe(aplicables))}) en este pedido.';
    } else {
      detalle = 'Puedes aplicar hasta $aplicables puntos en este pedido.';
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFFBF7EF),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE8D9BC)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.card_giftcard, size: 18, color: Color(0xFFAA7C11)),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Tienes ${saldo.saldo} puntos = ${_cop(saldo.enPesos)}',
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: Color(0xFF1F1A15),
                  ),
                ),
              ),
              Switch(
                value: activo,
                onChanged: aplicables == 0 ? null : onCambio,
              ),
            ],
          ),
          Text(
            detalle,
            style: const TextStyle(
              fontSize: 12,
              height: 1.3,
              color: Color(0xFF6B5A48),
            ),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: () => Navigator.pushNamed(context, '/programa-puntos'),
              style: TextButton.styleFrom(
                padding: EdgeInsets.zero,
                minimumSize: const Size(0, 26),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: const Text(
                'Ver condiciones',
                style: TextStyle(fontSize: 11, decoration: TextDecoration.underline),
              ),
            ),
          ),
        ],
      ),
    );
  }

  static String _cop(int amount) {
    final miles = amount.toString().replaceAllMapped(
          RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'),
          (m) => '${m[1]}.',
        );
    return '\$$miles COP';
  }
}
