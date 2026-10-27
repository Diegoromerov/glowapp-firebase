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
                      color: const Color(0xFFAA7C11).withOpacity(0.3),
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
              color: const Color(0xFFC5A052).withOpacity(0.12),
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
