// lib/screens/profile/biometric_history_screen.dart
import 'package:flutter/material.dart';
import 'package:glow_core/core/theme/belleza_luxe_gradients.dart';

class BiometricHistoryScreen extends StatelessWidget {
  const BiometricHistoryScreen({super.key});

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
          'HISTORIAL BIOMÉTRICO',
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
              // TARJETA DE RESUMEN AURA AI
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(LuxeSpacing.xl),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF2C2623), Color(0xFF1E1A18)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.15),
                      blurRadius: 12,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // BADGE AUDITORÍA PRIVACIDAD CERO-HUELLA
                    Container(
                      margin: const EdgeInsets.only(bottom: 12),
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: const Color(0xFF059669).withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: const Color(0xFF059669), width: 0.8),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.verified_user_outlined, color: Color(0xFF10B981), size: 12),
                          SizedBox(width: 6),
                          Text(
                            'AUDITORÍA CERO-HUELLA: IMAGEN DE ORIGEN PURGADA',
                            style: TextStyle(
                              fontFamily: 'JetBrainsMono',
                              fontSize: 8,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFF10B981),
                              letterSpacing: 0.8,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'AURA AI DIAGNOSTICS',
                          style: TextStyle(
                            fontFamily: 'JetBrainsMono',
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFFC5A052),
                            letterSpacing: 1.5,
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(
                            color: const Color(0xFFC5A052).withValues(alpha: 0.2),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: const Color(0xFFC5A052), width: 0.8),
                          ),
                          child: const Text(
                            'ÚLTIMO ESCANEO: HOY',
                            style: TextStyle(
                              fontFamily: 'JetBrainsMono',
                              fontSize: 9,
                              color: Color(0xFFC5A052),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Container(
                          width: 64,
                          height: 64,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(color: const Color(0xFFC5A052), width: 2),
                            image: const DecorationImage(
                              image: AssetImage('images/glow_ia_mesh_avatar.webp'),
                              fit: BoxFit.cover,
                            ),
                          ),
                        ),
                        const SizedBox(width: 16),
                        const Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '94 / 100',
                              style: TextStyle(
                                fontFamily: 'Didot',
                                fontSize: 26,
                                fontWeight: FontWeight.bold,
                                color: Colors.white,
                              ),
                            ),
                            Text(
                              'Puntaje de Salud Cutánea',
                              style: TextStyle(
                                fontFamily: 'CormorantGaramond',
                                fontSize: 14,
                                color: LuxeColors.nude300,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              const SizedBox(height: LuxeSpacing.xxl),

              const Text(
                'REGISTROS PREVIOS',
                style: TextStyle(
                  fontFamily: 'JetBrainsMono',
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  color: LuxeColors.nude500,
                  letterSpacing: 1.2,
                ),
              ),
              const SizedBox(height: 12),

              _buildScanRecordTile(
                date: '28 de Julio, 2026',
                score: '92/100',
                status: 'Hidratación Óptima',
                details: 'Textura uniforme, poros refinados',
              ),
              _buildScanRecordTile(
                date: '14 de Julio, 2026',
                score: '88/100',
                status: 'Sensibilidad Ligera',
                details: 'Recomendación: Suero Calmante Aura',
              ),
              _buildScanRecordTile(
                date: '01 de Julio, 2026',
                score: '85/100',
                status: 'Inicio de Diagnóstico',
                details: 'Perfil biométrico inicial registrado',
              ),
            ],
          ),
        ),
      ),
    ),
  ),
);
  }

  static Widget _buildScanRecordTile({
    required String date,
    required String score,
    required String status,
    required String details,
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
          const Icon(Icons.face_retouching_natural, color: LuxeColors.nude700, size: 28),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  date,
                  style: const TextStyle(
                    fontFamily: 'Didot',
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                    color: LuxeColors.nude900,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '$status • $details',
                  style: const TextStyle(
                    fontFamily: 'CormorantGaramond',
                    fontSize: 13,
                    color: LuxeColors.nude600,
                  ),
                ),
              ],
            ),
          ),
          Text(
            score,
            style: const TextStyle(
              fontFamily: 'JetBrainsMono',
              fontSize: 13,
              fontWeight: FontWeight.bold,
              color: LuxeColors.nude900,
            ),
          ),
        ],
      ),
    );
  }
}
