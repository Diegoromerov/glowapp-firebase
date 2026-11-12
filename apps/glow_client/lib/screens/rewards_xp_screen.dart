// lib/screens/profile/rewards_xp_screen.dart
import 'package:glow_core/glow_core.dart';
import 'package:flutter/material.dart';
class RewardsXpScreen extends StatelessWidget {
  const RewardsXpScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: LuxeColors.nude50,
      appBar: AppBar(
        backgroundColor: LuxeColors.nude50,
        elevation: 0,
        leading: IconButton(
          tooltip: 'Regresar',
          icon: const Icon(Icons.arrow_back_ios_new, color: LuxeColors.nude900, size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text(
          'CLUB GLOW LUXE & XP',
          style: TextStyle(
            fontFamily: 'Didot',
            fontSize: 15,
            fontWeight: FontWeight.bold,
            color: LuxeColors.nude900,
            letterSpacing: 1.2,
          ),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 680),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(LuxeSpacing.xl),
              child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Programa de referidos: hasta ahora existía en el backend y no
              // tenía entrada en la app.
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () => Navigator.pushNamed(context, '/invite'),
                  icon: const Icon(Icons.card_giftcard, size: 18, color: Color(0xFF8A6A2F)),
                  label: const Text(
                    'Invitar amigas · 500 puntos (hasta \$5.000)',
                    style: TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF8A6A2F),
                    ),
                  ),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    side: const BorderSide(color: Color(0xFFD4AF37)),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14)),
                  ),
                ),
              ),
              const SizedBox(height: 16),

              // Saldo real del fondo de puntos (migración 142). La tarjeta VIP de
              // abajo sigue siendo decorativa: los puntos de dinero se muestran
              // aquí, separados y con su equivalencia en pesos, para que nadie
              // intente gastar el XP de nivel.
              const _TarjetaPuntosCanjeables(),
              const SizedBox(height: 16),

              // TARJETA DORADA DE MEMBRESÍA VIP
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(LuxeSpacing.xl),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFFD4AF37), Color(0xFFAA7C11)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(18),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFFAA7C11).withValues(alpha: 0.3),
                      blurRadius: 16,
                      offset: const Offset(0, 6),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'SOCIO CLUB GLOW LUXE',
                          style: TextStyle(
                            fontFamily: 'Didot',
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                            color: Colors.white,
                            letterSpacing: 1.5,
                          ),
                        ),
                        Icon(Icons.workspace_premium, color: Colors.white, size: 24),
                      ],
                    ),
                    const SizedBox(height: 24),
                    const Text(
                      '350 XP',
                      style: TextStyle(
                        fontFamily: 'Didot',
                        fontSize: 36,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'PUNTOS DE EXPERIENCIA ACUMULADOS',
                      style: TextStyle(
                        fontFamily: 'JetBrainsMono',
                        fontSize: 9,
                        color: Colors.white70,
                        letterSpacing: 1.0,
                      ),
                    ),
                    const SizedBox(height: 20),
                    // BARRA DE PROGRESO AL SIGUIENTE NIVEL
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              'Nivel Actual: Gold',
                              style: TextStyle(fontFamily: 'CormorantGaramond', fontSize: 13, color: Colors.white),
                            ),
                            Text(
                              'Siguiente: Élite Diamond (500 XP)',
                              style: TextStyle(fontFamily: 'CormorantGaramond', fontSize: 13, color: Colors.white),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(10),
                          child: const LinearProgressIndicator(
                            value: 350 / 500,
                            minHeight: 6,
                            backgroundColor: Colors.white24,
                            valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              const SizedBox(height: LuxeSpacing.xxl),

              const Text(
                'BENEFICIOS ACTIVOS Y CUPONES',
                style: TextStyle(
                  fontFamily: 'JetBrainsMono',
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  color: LuxeColors.nude500,
                  letterSpacing: 1.2,
                ),
              ),
              const SizedBox(height: 12),

              _buildBenefitTile(
                icon: Icons.card_giftcard,
                title: '15% OFF en GlowStore',
                subtitle: 'Canjea 200 XP en tu próxima compra de skincare',
              ),
              _buildBenefitTile(
                icon: Icons.star_outline,
                title: 'Atención Prioritaria Concierge',
                subtitle: 'Acceso directo con agentes de belleza VIP',
              ),
              _buildBenefitTile(
                icon: Icons.auto_awesome_outlined,
                title: 'Diagnóstico Facial Aura Ilimitado',
                subtitle: 'Escaneos biométricos 3D sin costo adicional',
              ),
            ],
          ),
        ),
      ),
    ),
  ),
);
  }

  static Widget _buildBenefitTile({
    required IconData icon,
    required String title,
    required String subtitle,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: LuxeColors.nude200),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFFC5A052).withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: const Color(0xFFC5A052), size: 22),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontFamily: 'Didot',
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                    color: LuxeColors.nude900,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: const TextStyle(
                    fontFamily: 'CormorantGaramond',
                    fontSize: 13,
                    color: LuxeColors.nude600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Saldo del fondo de puntos canjeable, separado del XP de nivel.
///
/// El XP no vale pesos y los puntos sí: mezclarlos en una sola cifra hace que la
/// usuaria intente gastar nivel y se decepcione. El número viene del backend
/// (`GET /api/rewards/points`), que ya excluye lo vencido y lo comprometido.
class _TarjetaPuntosCanjeables extends StatelessWidget {
  const _TarjetaPuntosCanjeables();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<SaldoPuntos?>(
      future: RewardsService.obtenerSaldo(),
      builder: (context, snapshot) {
        final cargando = snapshot.connectionState == ConnectionState.waiting;
        final saldo = snapshot.data;

        return Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFE8E0D5)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'PUNTOS PARA DESCUENTOS',
                style: TextStyle(
                  fontFamily: 'JetBrainsMono',
                  fontSize: 9,
                  letterSpacing: 1.2,
                  color: LuxeColors.nude600,
                ),
              ),
              const SizedBox(height: 8),
              if (cargando)
                const SizedBox(
                  height: 20,
                  width: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              if (!cargando && saldo == null)
                const Text(
                  'No pudimos leer tu saldo ahora mismo.',
                  style: TextStyle(
                    fontFamily: 'CormorantGaramond',
                    fontSize: 13,
                    color: LuxeColors.nude600,
                  ),
                ),
              if (saldo != null) ...[
                Text(
                  '${saldo.saldo} puntos = \$${_miles(saldo.enPesos)}',
                  style: const TextStyle(
                    fontFamily: 'Didot',
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                    color: LuxeColors.nude900,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  saldo.tieneSaldo
                      ? 'Se aplican como descuento en GlowShop, hasta el '
                          '${saldo.topePorcentaje}% del valor de los productos '
                          'en un pedido de \$${_miles(saldo.minimoPedido)} o más.'
                      : 'Junta al menos ${saldo.bloqueCanje} puntos para empezar a usarlos.',
                  style: const TextStyle(
                    fontFamily: 'CormorantGaramond',
                    fontSize: 13,
                    height: 1.3,
                    color: LuxeColors.nude600,
                  ),
                ),
                if (saldo.enEspera > 0) ...[
                  const SizedBox(height: 8),
                  Text(
                    '${saldo.enEspera} puntos están en espera de un pedido sin pagar. '
                    'Si no se paga, vuelven solos.',
                    style: const TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontSize: 12,
                      color: LuxeColors.nude600,
                    ),
                  ),
                ],
                if (saldo.porVencer.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Tienes ${saldo.porVencer.first.puntos} puntos que vencen pronto.',
                    style: const TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontSize: 12,
                      color: Color(0xFFAA7C11),
                    ),
                  ),
                ],
              ],
            ],
          ),
        );
      },
    );
  }

  static String _miles(int valor) {
    final texto = valor.toString();
    final buffer = StringBuffer();
    for (var i = 0; i < texto.length; i++) {
      if (i > 0 && (texto.length - i) % 3 == 0) buffer.write('.');
      buffer.write(texto[i]);
    }
    return buffer.toString();
  }
}
