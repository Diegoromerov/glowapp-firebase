import 'package:flutter/material.dart';

class MensTheme {
  // Paleta Obsidiana & Oro Champagne
  static const Color obsidianBg = Color(0xFF0A0C10);
  static const Color obsidianCard = Color(0xFF14171F);
  static const Color obsidianCardHover = Color(0xFF1E232E);
  
  static const Color champagneGold = Color(0xFFD4AF37);
  static const Color champagneGoldLight = Color(0xFFE5C158);
  static const Color bronzeAccent = Color(0xFFC5A059);

  // Paleta Cyber Cyan para Scanner Facial IA (Visagismo / Barba / Corte)
  static const Color cyberCyan = Color(0xFF00E5FF);
  static const Color cyberCyanGlow = Color(0x5900E5FF);

  // Textos
  static const Color textPrimary = Color(0xFFF5F6F8);
  static const Color textSecondary = Color(0xFF949AA8);
  static const Color textMuted = Color(0xFF5F6575);

  // Gradientes
  static const LinearGradient goldGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      Color(0xFFD4AF37),
      Color(0xFFAA7C11),
    ],
  );

  static const LinearGradient obsidianGlassGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [
      Color(0xCC14171F),
      Color(0xE60A0C10),
    ],
  );

  // Sombras y Resplandores
  static List<BoxShadow> get goldGlow => [
        BoxShadow(
          color: champagneGold.withValues(alpha: 0.3),
          blurRadius: 16,
          offset: const Offset(0, 4),
        ),
      ];

  static List<BoxShadow> get cyanScannerGlow => [
        BoxShadow(
          color: cyberCyan.withValues(alpha: 0.4),
          blurRadius: 20,
          spreadRadius: 2,
        ),
      ];
}
