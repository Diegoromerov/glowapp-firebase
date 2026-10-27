// frontend/lib/screens/academy/academy_screen.dart
// Hub principal de GlowAcademy — usa la paleta oficial AppTheme
import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';
import 'glow_nback_screen.dart';
import 'glow_beauty_screen.dart';
import 'glow_color_screen.dart';

class AcademyScreen extends StatelessWidget {
  const AcademyScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 24, 20, 100),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // ── Header ────────────────────────────────────────────────────
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      gradient: AppTheme.premiumGradient,
                      borderRadius: BorderRadius.circular(24),
                      boxShadow: AppTheme.cardShadow,
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.3),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.auto_stories,
                              color: Colors.white, size: 28),
                        ),
                        const SizedBox(width: 14),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'GlowAcademy',
                              style: TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.bold,
                                color: Colors.white,
                                letterSpacing: -0.3,
                              ),
                            ),
                            Text(
                              'Aprende · Crece · Brilla',
                              style: TextStyle(
                                  color: Colors.white70,
                                  fontSize: 12),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 28),

                  // ── Sección título ────────────────────────────────────────────
                  Text(
                    'Módulos de formación',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.bold,
                      color: AppTheme.text,
                      letterSpacing: -0.3,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Selecciona un módulo para comenzar',
                    style: TextStyle(fontSize: 13, color: Color(0xFF8E7D7A)),
                  ),

                  const SizedBox(height: 16),

                  // ── Tarjeta: Entrenamiento Cognitivo ─────────────────────────
                  _ModuleCard(
                    icon: Icons.psychology_outlined,
                    gradient: AppTheme.terracottaMatteGradient,
                    tag: 'NEUROCIENCIA',
                    title: 'Entrenamiento Cognitivo',
                    subtitle: 'Juego N‑Back',
                    description:
                        'Mejora tu memoria de trabajo y concentración con ejercicios N‑Back de dificultad progresiva.',
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                          builder: (_) => const GlowNBackScreen()),
                    ),
                  ),

                  const SizedBox(height: 14),

                  // ── Tarjeta: Belleza & Educación ──────────────────────────────
                  _ModuleCard(
                    icon: Icons.spa_outlined,
                    gradient: AppTheme.roseGoldSatinGradient,
                    tag: 'BELLEZA',
                    title: 'Belleza & Educación',
                    subtitle: 'Tutoriales y guías',
                    description:
                        'Explora rutinas de cuidado de piel, maquillaje, color de cabello, wellness y más.',
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                          builder: (_) => const GlowBeautyScreen()),
                    ),
                  ),

                  const SizedBox(height: 14),

                  // ── Tarjeta: Colorimetría Capilar ────────────────────────────────
                  _ModuleCard(
                    icon: Icons.palette_outlined,
                    gradient: AppTheme.premiumGradient,
                    tag: 'COLOR DE CABELLO',
                    title: 'Colorimetría Capilar',
                    subtitle: 'Curso profesional',
                    description:
                        'Domina el arte del color en el cabello, desde fundamentos hasta técnicas avanzadas.',
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                          builder: (_) => const GlowColorScreen()),
                    ),
                  ),

                  const SizedBox(height: 28),

                  // ── Footer ────────────────────────────────────────────────────
                  Center(
                    child: Text(
                      'GlowAcademy • Formación profesional',
                      style: TextStyle(
                          color: AppTheme.primary.withValues(alpha: 0.5),
                          fontSize: 11),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ─── Widget tarjeta de módulo ─────────────────────────────────────────────────
class _ModuleCard extends StatelessWidget {
  final IconData icon;
  final LinearGradient gradient;
  final String tag;
  final String title;
  final String subtitle;
  final String description;
  final VoidCallback onTap;

  const _ModuleCard({
    required this.icon,
    required this.gradient,
    required this.tag,
    required this.title,
    required this.subtitle,
    required this.description,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            gradient: gradient,
            borderRadius: BorderRadius.circular(20),
            boxShadow: [
              BoxShadow(
                color: gradient.colors.first.withValues(alpha: 0.3),
                blurRadius: 16,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.25),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Icon(icon, color: Colors.white, size: 28),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        tag,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 0.5,
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                        letterSpacing: -0.3,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      description,
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 12,
                        height: 1.3,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: Colors.white70, size: 24),
            ],
          ),
        ),
      ),
    );
  }
}
