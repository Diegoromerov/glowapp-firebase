import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:glow_core/core/theme/tokens.dart';
import '../provider/business/business_onboarding_screen.dart';

class SalonHubScreen extends StatelessWidget {
  const SalonHubScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: obsidianBg,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 22.0, vertical: 24.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Encabezado de Marca
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: gold871.withOpacity(0.15),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: gold871.withOpacity(0.4)),
                        ),
                        child: const Icon(Icons.spa, color: gold871, size: 24),
                      ),
                      const SizedBox(width: 12),
                      const Text(
                        'GLOWAPP BUSINESS',
                        style: TextStyle(
                          fontFamily: 'Inter',
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 2.0,
                          color: gold871,
                        ),
                      ),
                    ],
                  ),
                  TextButton.icon(
                    onPressed: () {
                      HapticFeedback.lightImpact();
                      Navigator.pushReplacementNamed(context, '/salon');
                    },
                    icon: const Icon(Icons.arrow_forward, size: 16, color: Colors.white70),
                    label: const Text(
                      'Ir a SaaS',
                      style: TextStyle(color: Colors.white70, fontSize: 13),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 28),

              // Titulo y Subtitulo
              const Text(
                'Bienvenido, Líder.',
                style: TextStyle(
                  fontFamily: 'CormorantGaramond',
                  fontSize: 32,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                  letterSpacing: 0.5,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Selecciona el momento actual de tu negocio para activar las herramientas adecuadas a tu etapa.',
                style: TextStyle(
                  fontSize: 15,
                  color: Colors.white70,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 28),

              // Opcion 1: Construir desde cero
              _buildOptionCard(
                context: context,
                badgeText: 'FASE DE INCUBACION',
                badgeColor: const Color(0xFFF59E0B),
                icon: Icons.rocket_launch_rounded,
                title: 'Construir mi Salón desde Cero',
                subtitle:
                    'Te guiamos paso a paso: trámites de apertura, Cámara de Comercio, Concepto Sanitario, Manual RH1 y bioseguridad.',
                highlightActionText: 'Iniciar Ruta de Creación ➔',
                onTap: () {
                  HapticFeedback.mediumImpact();
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => const BusinessOnboardingScreen(),
                    ),
                  );
                },
              ),
              const SizedBox(height: 18),

              // Opcion 2: Negocio existente / Blindaje
              _buildOptionCard(
                context: context,
                badgeText: 'AUDITORIA & BLINDAJE',
                badgeColor: const Color(0xFF10B981),
                icon: Icons.verified_user_rounded,
                title: 'Tengo Salón: Auditar y Blindar',
                subtitle:
                    'Evalúa en 3 minutos la salud legal y sanitaria de tu peluquería. Detecta riesgos, contratos de sillas y evita sanciones.',
                highlightActionText: 'Hacer Diagnóstico de Salud ➔',
                onTap: () {
                  HapticFeedback.mediumImpact();
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => const BusinessOnboardingScreen(),
                    ),
                  );
                },
              ),
              const SizedBox(height: 18),

              // Opcion 3: Operacion Directa con SaaS
              _buildOptionCard(
                context: context,
                badgeText: 'CONTROL INMEDIATO',
                badgeColor: const Color(0xFF38BDF8),
                icon: Icons.dashboard_customize_rounded,
                title: 'Entrar Directo al SaaS del Salón',
                subtitle:
                    'Accede al centro de operaciones: agenda de citas, gestión de colaboradores, cálculo de comisiones y visibilidad en el mapa.',
                highlightActionText: 'Abrir Tablero Operativo ➔',
                isPrimaryGold: true,
                onTap: () {
                  HapticFeedback.heavyImpact();
                  Navigator.pushReplacementNamed(context, '/salon');
                },
              ),
              const SizedBox(height: 32),

              // Nota de confianza
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.04),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: Colors.white.withOpacity(0.08)),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.sync_alt_rounded, color: gold871, size: 24),
                    SizedBox(width: 14),
                    Expanded(
                      child: Text(
                        'Todos los caminos integran automáticamente tu operación en el SaaS de GlowApp.',
                        style: TextStyle(
                          fontSize: 12,
                          color: Colors.white60,
                          height: 1.35,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildOptionCard({
    required BuildContext context,
    required String badgeText,
    required Color badgeColor,
    required IconData icon,
    required String title,
    required String subtitle,
    required String highlightActionText,
    required VoidCallback onTap,
    bool isPrimaryGold = false,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Ink(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: isPrimaryGold
                ? const Color(0xFF262018)
                : const Color(0xFF1E1E24),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: isPrimaryGold
                  ? gold871
                  : Colors.white.withOpacity(0.12),
              width: isPrimaryGold ? 1.5 : 1.0,
            ),
            boxShadow: isPrimaryGold
                ? [
                    BoxShadow(
                      color: gold871.withOpacity(0.18),
                      blurRadius: 18,
                      offset: const Offset(0, 4),
                    ),
                  ]
                : null,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: badgeColor.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: badgeColor.withOpacity(0.4)),
                    ),
                    child: Text(
                      badgeText,
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.8,
                        color: badgeColor,
                      ),
                    ),
                  ),
                  Icon(icon, color: isPrimaryGold ? gold871 : Colors.white70, size: 26),
                ],
              ),
              const SizedBox(height: 14),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                  letterSpacing: 0.2,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                subtitle,
                style: const TextStyle(
                  fontSize: 13,
                  color: Colors.white70,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Text(
                    highlightActionText,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.bold,
                      color: isPrimaryGold ? gold871 : const Color(0xFF60A5FA),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
