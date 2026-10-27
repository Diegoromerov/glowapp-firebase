import 'package:flutter/material.dart';

/// Tokens de Color del Design System BELLEZA LUXE
class LuxeColors {
  LuxeColors._();

  // Nudes & Neutrales High-End
  static const Color nude50 = Color(0xFFFAF8F5);
  static const Color nude100 = Color(0xFFF4EFEA);
  static const Color nude200 = Color(0xFFE8E0D5);
  static const Color nude300 = Color(0xFFD6C8B8);
  static const Color nude400 = Color(0xFFB8A894);
  static const Color nude500 = Color(0xFF9E8C78);
  static const Color nude600 = Color(0xFF857360);
  static const Color nude700 = Color(0xFF6B5A48);
  static const Color nude800 = Color(0xFF453A2E);
  static const Color nude900 = Color(0xFF1F1A15);

  // Acentos de Lujo (Oro Champán 871) - escalas completas
  static const Color gold50 = Color(0xFFFDF8F0);
  static const Color gold100 = Color(0xFFF8EED9);
  static const Color gold200 = Color(0xFFF0DDAD);
  static const Color gold300 = Color(0xFFE8CC81);
  static const Color gold871 = Color(0xFFC5A052);
  static const Color gold700 = Color(0xFF96732B);
  static const Color goldDark = Color(0xFF7A5C1F);
  static const Color goldLight = Color(0xFFE8D49E);

  // Sombras y Transparencias
  static final Color shadowGold = gold871.withOpacity(0.25);
  static final Color overlayDark = nude900.withOpacity(0.65);
}

/// Tipografía Editorial Belleza Luxe
class LuxeTypography {
  LuxeTypography._();

  static const TextStyle displaySm = TextStyle(
    fontFamily: 'Didot',
    fontSize: 22,
    fontWeight: FontWeight.bold,
    color: LuxeColors.nude900,
    letterSpacing: -0.44, // -0.02em
  );

  static const TextStyle displayMd = TextStyle(
    fontFamily: 'Didot',
    fontSize: 28,
    fontWeight: FontWeight.bold,
    color: LuxeColors.nude900,
    letterSpacing: -0.56,
  );

  static const TextStyle monoMd = TextStyle(
    fontFamily: 'JetBrainsMono',
    fontSize: 16,
    fontWeight: FontWeight.w600,
    color: LuxeColors.gold871,
    letterSpacing: 0.5,
  );

  static const TextStyle monoSm = TextStyle(
    fontFamily: 'JetBrainsMono',
    fontSize: 12,
    fontWeight: FontWeight.w500,
    color: LuxeColors.nude500,
  );

  static const TextStyle bodyMd = TextStyle(
    fontFamily: 'CormorantGaramond',
    fontSize: 15,
    fontWeight: FontWeight.normal,
    color: LuxeColors.nude900,
    height: 1.618, // Golden Ratio
  );

  static const TextStyle bodySm = TextStyle(
    fontFamily: 'Inter',
    fontSize: 13,
    fontWeight: FontWeight.w400,
    color: LuxeColors.nude500,
  );
}

/// Espaciados y Radios de Borde
class LuxeSpacing {
  LuxeSpacing._();

  static const double sm = 6.5;
  static const double md = 10.5;
  static const double lg = 14.0;
  static const double xl = 17.0;
  static const double xxl = 24.0;
}
