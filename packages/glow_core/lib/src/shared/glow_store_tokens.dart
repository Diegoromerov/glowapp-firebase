// frontend/lib/shared/glow_store_tokens.dart
import 'package:flutter/material.dart';
import '../core/theme/tokens.dart';
import 'mens_theme.dart';

/// Sistema Visual Premium GlowStore — FASE 1A (Updated for S1)
///
/// Define el lenguaje visual unificado para el e-commerce de belleza editorial:
/// - Paleta cromática S1-compliant (Cream Silk, Rose Gold, Gold Champán 871, Aura Teal)
/// - Jerarquía de Superficies (Nivel 0: Fondo, Nivel 1: Contenido, Nivel 2: Cristal, Nivel 3: CTA)
/// - Jerarquía de Border Radii (Controles, CTA, Cards, Chips, Superficies)
/// - Sombras y Elevación (Warm, S1-compliant)
/// - Mapeo Tipográfico (Editorial, UI, Datos)
/// - Estados Interactivos (S1 Interaction System)
/// - Paridad de Audiencias (Women, Men, Unisex) via Token.expression
class GlowStoreTokens {
  GlowStoreTokens._();

  // ===========================================================================
  // 1. PALETA VISUAL DE MARCA (S1 Compliant)
  // ===========================================================================
  // Foundation
  static const Color creamSilk = Color(0xFFFCF8F6);       // Women L0
  static const Color obsidianBg = Color(0xFF0A0C10);      // Men L0
  static const Color warmWhite = Color(0xFFF2EFEA);       // Men L1 alt

  // Accents
  static const Color roseGold = Color(0xFFD4AF7A);        // Women primary
  static const Color warmBrown = Color(0xFF5A3A2A);       // Women secondary
  static const Color champagne = Color(0xFFD9A27F);       // Women tertiary
  static const Color gold871 = Color(0xFFC5A052);         // Global brand primary
  static const Color champagneMen = Color(0xFFD4AF37);    // Men primary
  static const Color copper = Color(0xFFB8734A);          // Men tertiary
  static const Color bronzeAccent = Color(0xFFC5A059);    // Men border

  // AURA
  static const Color auraTeal = Color(0xFF164C46);        // AURA intelligence

  // Neutral Scale (Nude 50-900) — Warm, shared
  static const Color nude50 = Color(0xFFFAF8F5);
  static const Color nude100 = Color(0xFFF4EFEA);
  static const Color nude200 = Color(0xFFE8E0D5);
  static const Color nude300 = Color(0xFFD6C8B8);
  static const Color nude400 = Color(0xFFB8A898);
  static const Color nude500 = Color(0xFF9E8C78);
  static const Color nude600 = Color(0xFF857360);
  static const Color nude700 = Color(0xFF6B5E50);
  static const Color nude800 = Color(0xFF453A2E);
  static const Color nude900 = Color(0xFF1F1A15);

  // Semantic Status (S1)
  static const Color stateSuccess = Color(0xFF16A34A);
  static const Color stateSuccessBg = Color(0xFFDCFCE7);
  static const Color stateWarning = Color(0xFFD97706);
  static const Color stateWarningBg = Color(0xFFFEF3C7);
  static const Color stateError = Color(0xFFDC2626);
  static const Color stateErrorBg = Color(0xFFFEE2E2);
  static const Color stateInfo = Color(0xFF06B6D4);
  static const Color stateInfoBg = Color(0xFFECFEFF);
  static const Color stateInProgress = Color(0xFF8B5CF6);
  static const Color stateInProgressBg = Color(0xFFEDE9FE);
  static const Color stateUnavailable = Color(0xFF9CA3AF); // Neutral grey for unavailable

  // ===========================================================================
  // 2. JERARQUÍA DE SUPERFICIES (S1 Surface System L0-L3 + variants)
  // ===========================================================================
  /// Nivel 0 — Fondo Principal (Cream Silk / Obsidian Bg)
  static Color surfaceLevel0({required bool isMen, bool isDark = false}) {
    if (isMen) return obsidianBg;
    if (isDark) return const Color(0xFF18171C);
    return creamSilk;
  }

  /// Nivel 1 — Superficie de Contenido / Cards (White / Obsidian Card)
  static Color surfaceLevel1({required bool isMen, bool isDark = false}) {
    if (isMen) return MensTheme.obsidianCard;
    if (isDark) return const Color(0xFF24232B);
    return Colors.white;
  }

  /// Nivel 2 — Superficie Premium Glass / Frosted (Nude100 85% / Obsidian Glass 85%)
  static Color surfaceLevel2({required bool isMen, bool isDark = false}) {
    if (isMen) return MensTheme.obsidianCard.withOpacity(0.85);
    if (isDark) return const Color(0xFF24232B).withOpacity(0.85);
    return nude100.withOpacity(0.85);
  }

  /// Nivel 3 — Superficie de Selección / CTA (Gold871 / Champagne Gold)
  static Color surfaceLevel3({required bool isMen}) {
    if (isMen) return champagneMen;
    return gold871;
  }

  /// Variant — Input fill, search bars
  static Color surfaceVariant({required bool isMen, bool isDark = false}) {
    if (isMen) return isDark ? const Color(0xFF4A3E3D) : const Color(0xFFF5EBE6);
    if (isDark) return const Color(0xFF4A3E3D);
    return const Color(0xFFF5EBE6);
  }

  /// Container — Card backgrounds in lists
  static Color surfaceContainer({required bool isMen, bool isDark = false}) {
    if (isMen) return isDark ? const Color(0xFF3D3330) : nude100;
    if (isDark) return const Color(0xFF3D3330);
    return nude100;
  }

  /// Overlay — Modal backdrop
  static Color surfaceOverlay({required bool isMen}) {
    return isMen ? const Color(0xBF000000) : const Color(0x80000000);
  }

  /// Glass — Premium glass morphism
  static Color surfaceGlass({required bool isMen}) {
    return isMen ? MensTheme.obsidianCard.withOpacity(0.85) : Colors.white.withOpacity(0.8);
  }

  /// Input — Text field background
  static Color surfaceInput({required bool isMen, bool isDark = false}) {
    if (isMen) return isDark ? const Color(0xFF2D2523) : nude50;
    if (isDark) return const Color(0xFF2D2523);
    return nude50;
  }

  /// Selected — Selected chips, items
  static Color surfaceSelected({required bool isMen}) {
    return isMen ? champagneMen.withOpacity(0.12) : gold871.withOpacity(0.12);
  }

  // ===========================================================================
  // 3. JERARQUÍA DE BORDER RADIUS (S1 Radii)
  // ===========================================================================
  static const double radiusControl = 8.0;   // Controles pequeños / inputs
  static const double radiusCTA = 12.0;      // Botones principales y secundarios
  static const double radiusCard = 16.0;     // Product Cards y contenedores
  static const double radiusChip = 20.0;     // Category Chips (pill redondeado)
  static const double radiusDrawer = 24.0;   // Cart Drawer y Modales
  static const double radiusFull = 9999.0;   // Avatars, pills

  static const BorderRadius borderControl = BorderRadius.all(Radius.circular(radiusControl));
  static const BorderRadius borderCTA = BorderRadius.all(Radius.circular(radiusCTA));
  static const BorderRadius borderCard = BorderRadius.all(Radius.circular(radiusCard));
  static const BorderRadius borderChip = BorderRadius.all(Radius.circular(radiusChip));
  static const BorderRadius borderDrawer = BorderRadius.only(
    topLeft: Radius.circular(radiusDrawer),
    topRight: Radius.circular(radiusDrawer),
  );
  static const BorderRadius borderFull = BorderRadius.all(Radius.circular(radiusFull));

  // ===========================================================================
  // 4. SOMBRAS Y ELEVACIÓN (S1 Shadow Relation — Warm, not black)
  // ===========================================================================
  /// Sombra ambiental suave
  static final List<BoxShadow> shadowAmbient = [
    BoxShadow(
      color: Colors.black.withOpacity(0.04),
      blurRadius: 8,
      offset: const Offset(0, 2),
    ),
  ];

  /// Sombra de carta estándar
  static final List<BoxShadow> shadowCard = [
    BoxShadow(
      color: Colors.black.withOpacity(0.04),
      blurRadius: 24,
      offset: const Offset(0, 8),
      spreadRadius: -4,
    ),
  ];

  /// Sombra de brillo dorado para elementos destacados (Women)
  static final List<BoxShadow> shadowGoldGlow = [
    BoxShadow(
      color: gold871.withOpacity(0.18),
      blurRadius: 16,
      offset: const Offset(0, 6),
    ),
  ];

  /// Sombra de brillo champán para elementos destacados (Men)
  static final List<BoxShadow> shadowChampagneGlow = [
    BoxShadow(
      color: champagneMen.withOpacity(0.3),
      blurRadius: 16,
      offset: const Offset(0, 4),
    ),
  ];

  /// Sombra AURA para features de inteligencia
  static final List<BoxShadow> shadowAura = [
    BoxShadow(
      color: auraTeal.withOpacity(0.2),
      blurRadius: 20,
      offset: const Offset(0, 0),
      spreadRadius: 2,
    ),
  ];

  /// Sombra de profundidad para paneles flotantes y Cart Drawer
  static final List<BoxShadow> shadowDrawer = [
    BoxShadow(
      color: Colors.black.withOpacity(0.08),
      blurRadius: 24,
      offset: const Offset(-6, 0),
    ),
  ];

  // ===========================================================================
  // 5. TIPOGRAFÍA Y JERARQUÍA EDITORIAL (S1 Typography — Two voices)
  // ===========================================================================
  /// Editorial Display (Cormorant Garamond) — Títulos principales de tienda y banners
  static TextStyle fontEditorialDisplay({Color? color, bool isMen = false}) {
    final t = isMen ? Token.lightMen : Token.light;
    return TextStyle(
      fontFamily: 'CormorantGaramond',
      fontSize: 26,
      fontWeight: FontWeight.bold,
      letterSpacing: 0.8,
      color: color ?? t.textPrimary,
    );
  }

  /// Editorial Section Title — Encabezados de categorías y paneles
  static TextStyle fontEditorialSection({Color? color, bool isMen = false}) {
    final t = isMen ? Token.lightMen : Token.light;
    return TextStyle(
      fontFamily: 'CormorantGaramond',
      fontSize: 18,
      fontWeight: FontWeight.bold,
      letterSpacing: 0.5,
      color: color ?? t.textPrimary,
    );
  }

  /// Product Name — Titular de tarjeta de producto (Cormorant 15w700 per S1)
  static TextStyle fontProductName({Color? color, bool isMen = false}) {
    final t = isMen ? Token.lightMen : Token.light;
    return TextStyle(
      fontFamily: 'CormorantGaramond',
      fontSize: 15,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.2,
      color: color ?? t.textPrimary,
    );
  }

  /// Price Display (JetBrainsMono) — Moneda e importes
  static TextStyle fontPriceDisplay({Color? color, double fontSize = 15, bool isMen = false}) {
    final t = isMen ? Token.lightMen : Token.light;
    return TextStyle(
      fontFamily: 'JetBrainsMono',
      fontSize: fontSize,
      fontWeight: FontWeight.w700,
      letterSpacing: 0.3,
      color: color ?? t.textAccent,
    );
  }

  /// Technical Metadata (JetBrainsMono) — SKU, Especialidad, Badges
  static TextStyle fontMetadata({Color? color, bool isMen = false}) {
    final t = isMen ? Token.lightMen : Token.light;
    return TextStyle(
      fontFamily: 'JetBrainsMono',
      fontSize: 10,
      fontWeight: FontWeight.w600,
      letterSpacing: 1.0,
      color: color ?? t.textMuted,
    );
  }

  /// Functional UI (Manrope) — Búsqueda, botones, navegación
  static TextStyle fontFunctionalUI({
    Color? color,
    FontWeight weight = FontWeight.w500,
    double size = 13,
    double letterSpacing = 0,
    double height = 1.4,
    bool isMen = false,
  }) {
    final t = isMen ? Token.lightMen : Token.light;
    return TextStyle(
      fontFamily: 'Manrope',
      fontSize: size,
      fontWeight: weight,
      letterSpacing: letterSpacing,
      height: height,
      color: color ?? t.textPrimary,
    );
  }

  // ===========================================================================
  // 6. ESTADOS VISUALES INTERACTIVOS (S1 Interaction System)
  // ===========================================================================
  static Color stateNormalBorder({required bool isMen}) {
    return isMen ? bronzeAccent.withOpacity(0.2) : nude200;
  }

  static Color stateHoverBorder({required bool isMen}) {
    return isMen ? champagneMen : gold871;
  }

  static Color stateSelectedBg({required bool isMen}) {
    return surfaceSelected(isMen: isMen);
  }

  static Color stateDisabledBg({required bool isMen, bool isDark = false}) {
    if (isMen) return isDark ? const Color(0xFF1E232E) : const Color(0xFFF0ECE6);
    return isDark ? const Color(0xFF4A3E3D) : const Color(0xFFF0ECE6);
  }

  static Color stateDisabledText({required bool isMen, bool isDark = false}) {
    if (isMen) return isDark ? const Color(0xFF5F6575) : const Color(0xFFA89F91);
    return isDark ? const Color(0xFF6B5E5A) : const Color(0xFFA89F91);
  }

  // ===========================================================================
  // 7. MAPPING DINÁMICO POR AUDIENCIA (S1 Expression-aware)
  // ===========================================================================
  static Color textColor({required bool isMen, bool isDark = false}) {
    if (isMen) return isDark ? MensTheme.textPrimary : const Color(0xFF2B2420);
    if (isDark) return Colors.white;
    return nude900;
  }

  static Color secondaryTextColor({required bool isMen, bool isDark = false}) {
    if (isMen) return isDark ? MensTheme.textSecondary : nude600;
    if (isDark) return const Color(0xFFAD8272);
    return nude600;
  }

  static Color accentColor({required bool isMen}) {
    if (isMen) return champagneMen;
    return gold871;
  }

  static Color borderColor({required bool isMen, bool isDark = false}) {
    if (isMen) return bronzeAccent.withOpacity(0.35);
    if (isDark) return const Color(0xFF33313D);
    return nude200;
  }

  // ===========================================================================
  // 8. TOKEN BRIDGE — Access full Token system
  // ===========================================================================
  /// Get full Token for current context
  static Token tokenFor({required bool isMen, bool isDark = false}) {
    if (isDark) {
      return isMen ? Token.dark : Token.light; // Will use expression inference
    }
    return isMen ? Token.lightMen : Token.light;
  }

  /// Get AURA token
  static Token auraToken() => Token.auraToken;
}