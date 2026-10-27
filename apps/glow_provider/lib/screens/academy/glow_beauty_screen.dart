// frontend/lib/screens/academy/glow_beauty_screen.dart
// BeautyScreen migrada — adaptada a la paleta oficial AppTheme (fondo crema, tarjetas blancas con sombra)
import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';

// ─── Modelo de item ──────────────────────────────────────────────────────────
class _BeautyItem {
  final String title;
  final String description;
  final IconData icon;
  final Color color;

  _BeautyItem({
    required this.title,
    required this.description,
    required this.icon,
    required this.color,
  });
}

// Lista estática de contenidos educativos armonizada
final List<_BeautyItem> _beautyItems = [
  _BeautyItem(
    title: 'Cuidado de la piel',
    description: 'Rutinas y tips para una piel radiante.',
    icon: Icons.spa,
    color: AppTheme.primary,
  ),
  _BeautyItem(
    title: 'Maquillaje básico',
    description: 'Aprende los fundamentos del maquillaje.',
    icon: Icons.brush,
    color: const Color(0xFFA855F7),
  ),
  _BeautyItem(
    title: 'Color de cabello',
    description: 'Tendencias y cuidados del color.',
    icon: Icons.palette,
    color: const Color(0xFFF59E0B),
  ),
  _BeautyItem(
    title: 'Wellness',
    description: 'Ejercicio y nutrición para la belleza interior.',
    icon: Icons.self_improvement,
    color: const Color(0xFF22C55E),
  ),
  _BeautyItem(
    title: 'Skincare avanzado',
    description: 'Ingredientes activos y protocolos profesionales.',
    icon: Icons.science,
    color: const Color(0xFF3B82F6),
  ),
  _BeautyItem(
    title: 'Uñas & nail art',
    description: 'Técnicas de manicura y diseño artístico.',
    icon: Icons.back_hand,
    color: const Color(0xFFEC4899),
  ),
];

// ─── Pantalla principal ───────────────────────────────────────────────────────
class GlowBeautyScreen extends StatelessWidget {
  const GlowBeautyScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
        title: const Text(
          'Belleza & Educación',
          style: TextStyle(
            fontFamily: 'CormorantGaramond',
            fontWeight: FontWeight.bold,
            letterSpacing: 0.5,
            fontSize: 22,
            color: Color(0xFF1F1A15),
          ),
        ),
        backgroundColor: const Color(0xFFFAF8F5),
        foregroundColor: const Color(0xFF1F1A15),
        elevation: 0,
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 720),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ── Header ──
              const Padding(
                padding: EdgeInsets.fromLTRB(20, 4, 20, 16),
                child: Text(
                  'Aprende, mejora y brilla ✨',
                  style: TextStyle(
                    color: Color(0xFF8E7D7A),
                    fontSize: 14,
                  ),
                ),
              ),

              // ── Grid de tarjetas ──
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: GridView.builder(
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      crossAxisSpacing: 12,
                      mainAxisSpacing: 12,
                      childAspectRatio: 0.95,
                    ),
                    itemCount: _beautyItems.length,
                    itemBuilder: (context, index) {
                      final item = _beautyItems[index];
                      return GestureDetector(
                        onTap: () {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text('Próximamente: \${item.title}'),
                              backgroundColor: AppTheme.primary,
                              behavior: SnackBarBehavior.floating,
                              shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(12)),
                            ),
                          );
                        },
                        child: Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(20),
                            boxShadow: AppTheme.cardShadow,
                            border: Border.all(color: AppTheme.surface, width: 1),
                          ),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Container(
                                width: 56,
                                height: 56,
                                decoration: BoxDecoration(
                                  color: item.color.withValues(alpha: 0.12),
                                  shape: BoxShape.circle,
                                ),
                                child: Icon(item.icon, color: item.color, size: 28),
                              ),
                              const SizedBox(height: 10),
                              Text(
                                item.title,
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.bold,
                                  color: AppTheme.text,
                                ),
                                textAlign: TextAlign.center,
                              ),
                              const SizedBox(height: 4),
                              Text(
                                item.description,
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: Color(0xFF8E7D7A),
                                ),
                                textAlign: TextAlign.center,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
