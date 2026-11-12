import 'package:flutter/material.dart';

/// Condiciones del programa de puntos e invitaciones (R-19/R-21).
///
/// Se publica tal como el backend lo aplica: montos, mínimos, topes, vencimiento
/// y qué pasa cuando un pedido se cae o se reembolsa. Los números de aquí tienen
/// que coincidir con `backend/src/config/programaPuntos.js`; si cambian allí y no
/// aquí, la app estaría prometiendo algo distinto de lo que paga.
class ProgramaPuntosScreen extends StatelessWidget {
  const ProgramaPuntosScreen({super.key});

  static const Color _fondo = Color(0xFFFAF8F5);
  static const Color _tinta = Color(0xFF1F1A15);
  static const Color _secundario = Color(0xFF6F5F4E);
  static const Color _oro = Color(0xFFAA7C11);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _fondo,
      appBar: AppBar(
        title: const Text(
          'Programa de puntos',
          style: TextStyle(
            fontFamily: 'CormorantGaramond',
            fontWeight: FontWeight.bold,
            fontSize: 20,
            color: _tinta,
          ),
        ),
        backgroundColor: _fondo,
        foregroundColor: _tinta,
        elevation: 0,
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 680),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: const [
                Text(
                  'Invita, gana puntos y gástalos en GlowShop',
                  style: TextStyle(
                    fontFamily: 'CormorantGaramond',
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: _tinta,
                  ),
                ),
                SizedBox(height: 6),
                Text(
                  'Estas son las condiciones vigentes del programa. Aplican a todas '
                  'las cuentas de cliente en Colombia.',
                  style: TextStyle(fontSize: 13, height: 1.4, color: _secundario),
                ),
                SizedBox(height: 20),
                _Seccion(
                  titulo: 'Cuánto ganas por invitar',
                  lineas: [
                    'Ganas 500 puntos —equivalentes a \$5.000— por cada amiga que '
                        'se registre con tu código y pague su primera compra.',
                    'La compra debe ser de productos por \$20.000 o más. Un pedido '
                        'menor no genera premio, y no consume la invitación: tu '
                        'amiga puede volver a comprar más adelante.',
                    'Tu amiga recibe 100 puntos de bienvenida en esa misma compra.',
                    'El premio se acredita cuando el pago se confirma, no al '
                        'registrarse ni al reservar un servicio.',
                  ],
                ),
                _Seccion(
                  titulo: 'Cuánto valen y cómo se gastan',
                  lineas: [
                    '1 punto = \$10. Se canjean en bloques de 100 puntos (\$1.000).',
                    'Se aplican como descuento en GlowShop, sobre el valor de los '
                        'productos. No aplican al envío ni a reservas de servicio.',
                    'Puedes usar hasta el 15% del valor de los productos de un '
                        'pedido, y el pedido debe ser de \$25.000 o más.',
                    'Si tu saldo no cabe entero en un pedido, se aplica lo que '
                        'cabe y el resto queda para el siguiente.',
                  ],
                ),
                _Seccion(
                  titulo: 'Límites',
                  lineas: [
                    'Máximo 10 premios por mes calendario, por cuenta.',
                    'Los puntos vencen a los 12 meses de acreditados. La app te '
                        'avisa antes de que venzan.',
                    'El programa es de un solo nivel: ganas por tus invitadas, no '
                        'por las invitadas de ellas.',
                    'Los puntos no son dinero: no se retiran, no se transfieren y '
                        'no se convierten en saldo de la pasarela.',
                  ],
                ),
                _Seccion(
                  titulo: 'Qué pasa si un pedido se cae',
                  lineas: [
                    'Si aplicas puntos y el pedido no se paga en 24 horas, los '
                        'puntos vuelven a tu saldo y el pedido se cancela.',
                    'Si el pedido se reembolsa dentro de los 30 días siguientes, '
                        'el premio que generó se revierte hasta lo que no se haya '
                        'gastado.',
                  ],
                ),
                _Seccion(
                  titulo: 'Uso indebido',
                  lineas: [
                    'No está permitido crear cuentas para invitarse a sí mismo ni '
                        'usar datos de otra persona sin su autorización.',
                    'Las conversiones que detectemos como anómalas quedan en '
                        'revisión y no se acreditan hasta verificarlas.',
                    'GlowApp puede ajustar los montos y topes del programa; los '
                        'cambios aplican hacia adelante y se publican en esta '
                        'pantalla.',
                  ],
                ),
                SizedBox(height: 8),
                Text(
                  'Última actualización: noviembre de 2026',
                  style: TextStyle(fontSize: 11, color: _secundario),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Seccion extends StatelessWidget {
  const _Seccion({required this.titulo, required this.lineas});

  final String titulo;
  final List<String> lineas;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          titulo,
          style: const TextStyle(
            fontFamily: 'CormorantGaramond',
            fontSize: 17,
            fontWeight: FontWeight.bold,
            color: ProgramaPuntosScreen._oro,
          ),
        ),
        const SizedBox(height: 6),
        for (final linea in lineas)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '•  ',
                  style: TextStyle(fontSize: 13, color: ProgramaPuntosScreen._oro),
                ),
                Expanded(
                  child: Text(
                    linea,
                    style: const TextStyle(
                      fontSize: 13,
                      height: 1.45,
                      color: ProgramaPuntosScreen._tinta,
                    ),
                  ),
                ),
              ],
            ),
          ),
        const SizedBox(height: 18),
      ],
    );
  }
}
