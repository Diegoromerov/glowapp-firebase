// frontend/lib/screens/academy/glow_glass_card.dart
// Widget GlassCard migrado de glowapp_frontend — sin dependencias externas
import 'dart:ui';
import 'package:flutter/material.dart';

/// Tarjeta con efecto glassmorphism reutilizable dentro de GlowAcademy.
class GlowGlassCard extends StatelessWidget {
  final Widget child;
  const GlowGlassCard({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
        child: Container(
          decoration: BoxDecoration(
            color: Colors.white.withOpacity(0.08),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white.withOpacity(0.12), width: 1),
          ),
          padding: const EdgeInsets.all(16),
          child: child,
        ),
      ),
    );
  }
}
