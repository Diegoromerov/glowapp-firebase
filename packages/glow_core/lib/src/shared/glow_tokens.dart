import 'package:flutter/material.dart';
import 'theme.dart';

/// Tokens de diseño principales para la identidad de marca GlowApp.
class GlowTokens {
  GlowTokens._();

  // ---------------------------------------------------------------------------
  // PALETA DE COLORES
  // ---------------------------------------------------------------------------
  /// Cream Silk (#FCF8F6) - Fondo suave / superficie clara
  static const Color creamSilk = Color(0xFFFCF8F6);

  /// Terracota (#C89D93) - Primario suave / acentos cálidos
  static const Color terracota = AppTheme.primary;

  /// Rose Gold (#D4AF7A) - Acentuación premium / detalles
  static const Color roseGold = Color(0xFFD4AF7A);

  /// Night Andean (#2B2420) - Texto primario / superficies oscuras
  static const Color nightAndean = Color(0xFF2B2420);

  /// Emerald (#50C878) - Estado éxito / verificación
  static const Color emerald = Color(0xFF50C878);

  /// Amber (#E8B4A0) - Advertencias / highlights secundarios
  static const Color amber = Color(0xFFE8B4A0);

  // ---------------------------------------------------------------------------
  // FAMILIAS TIPOGRÁFICAS
  // ---------------------------------------------------------------------------
  static const String fontPlayfairDisplay = 'PlayfairDisplay';
  static const String fontInter = 'Inter';
  static const String fontJetBrainsMono = 'JetBrainsMono';
}
