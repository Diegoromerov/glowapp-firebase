// lib/core/theme/tokens.dart
// Design System Tokens — GlowApp BELLEZA LUXE
// Single source of truth para colores, spacing, tipografía, shadows, radii, breakpoints
// IMPLEMENTS: GLOWAPP COLOR SYSTEM (S1) — GLOWAPP SOUL v1.0

import 'package:flutter/material.dart';

/// ============================================================================
/// COLOR TOKENS — Semantic naming, Light/Dark parity, Expression-aware
/// ============================================================================

/// S1 Master Palette — Foundation Colors (from glowapp_color_system.json)
const Color _creamSilk = Color(0xFFFCF8F6);           // Women/Neutral L0 background
const Color _obsidianBg = Color(0xFF0A0C10);           // Men L0 background
const Color _warmWhite = Color(0xFFF2EFEA);            // Men secondary surface
const Color _roseGold = Color(0xFFD4AF7A);             // Women primary accent
const Color _warmBrown = Color(0xFF5A3A2A);            // Women secondary
const Color _champagne = Color(0xFFD9A27F);            // Women tertiary
const Color _gold871 = Color(0xFFC5A052);              // Global brand primary
const Color _champagneMen = Color(0xFFD4AF37);         // Men primary accent
const Color _copper = Color(0xFFB8734A);               // Men tertiary
const Color _bronzeAccent = Color(0xFFC5A059);         // Men border accent
const Color _auraTeal = Color(0xFF164C46);             // AURA intelligence layer

// Public aliases for cross-file access
const Color creamSilk = _creamSilk;
const Color obsidianBg = _obsidianBg;
const Color warmWhite = _warmWhite;
const Color roseGold = _roseGold;
const Color warmBrown = _warmBrown;
const Color champagne = _champagne;
const Color gold871 = _gold871;
const Color champagneMen = _champagneMen;
const Color copper = _copper;
const Color bronzeAccent = _bronzeAccent;
const Color auraTeal = _auraTeal;

/// Neutral Scale — Warm, not clinical (nude50-900)
const Map<int, Color> _neutralLight = {
  50: Color(0xFFFAF8F5),   // Warm white
  100: Color(0xFFF4EFEA),  // Surface secondary
  200: Color(0xFFE8E0D5),  // Subtle borders
  300: Color(0xFFD6C8B8),  // Muted borders
  400: Color(0xFFB8A898),  // Dividers
  500: Color(0xFF9E8C78),  // Metadata text
  600: Color(0xFF857360),  // Secondary text
  700: Color(0xFF6B5E50),  // Stronger text
  800: Color(0xFF453A2E),  // Near-black text
  900: Color(0xFF1F1A15),  // Primary text (warm black)
};

const Map<int, Color> _neutralDark = {
  50: Color(0xFF1F1A15),
  100: Color(0xFF2D2523),
  200: Color(0xFF4A3E3D),
  300: Color(0xFF6B5E5A),
  400: Color(0xFF8E7D7A),
  500: Color(0xFFAD8272),
  600: Color(0xFFC5A090),
  700: Color(0xFFDCC8C0),
  800: Color(0xFFE8D7D3),
  900: Color(0xFFFAF8F5),
};

/// Semantic Status Colors — Muted to Glow warmth (no neon)
const Map<String, Color> _statusLight = {
  'success': Color(0xFF16A34A),
  'success_bg': Color(0xFFDCFCE7),
  'success_on': Color(0xFF15803D),
  'warning': Color(0xFFD97706),
  'warning_bg': Color(0xFFFEF3C7),
  'warning_on': Color(0xFF78350F),
  'error': Color(0xFFDC2626),
  'error_bg': Color(0xFFFEE2E2),
  'error_on': Color(0xFF991B1B),
  'info': Color(0xFF06B6D4),
  'info_bg': Color(0xFFECFEFF),
  'info_on': Color(0xFF164E63),
  'in_progress': Color(0xFF8B5CF6),
  'in_progress_bg': Color(0xFFEDE9FE),
  'in_progress_on': Color(0xFF5B21B6),
};

const Map<String, Color> _statusDark = {
  'success': Color(0xFF22C55E),
  'success_bg': Color(0xFF14532D),
  'success_on': Color(0xFFDCFCE7),
  'warning': Color(0xFFF59E0B),
  'warning_bg': Color(0xFF78350F),
  'warning_on': Color(0xFFFEF3C7),
  'error': Color(0xFFEF4444),
  'error_bg': Color(0xFF7F1D1D),
  'error_on': Color(0xFFFEE2E2),
  'info': Color(0xFF22D3EE),
  'info_bg': Color(0xFF164E63),
  'info_on': Color(0xFFECFEFF),
  'in_progress': Color(0xFFA855F7),
  'in_progress_bg': Color(0xFF5B21B6),
  'in_progress_on': Color(0xFFEDE9FE),
};

/// Gradients — Purposeful only (depth, light, transition, AURA behavior)
const LinearGradient _primaryGradientLight = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [_gold871, Color(0xFFB89040)],
);

const LinearGradient _primaryGradientDark = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [_gold871, Color(0xFFC8A858)],
);

const LinearGradient _roseGoldSatinLight = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [Color(0xFFE8B6AD), Color(0xFFB57E74)],
);

const LinearGradient _roseGoldSatinDark = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [Color(0xFFF0C8BC), Color(0xFFC89690)],
);

const LinearGradient _terracottaMatteLight = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [Color(0xFFB57E74), Color(0xFF8C6F65)],
);

const LinearGradient _terracottaMatteDark = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [Color(0xFFC89690), Color(0xFFA08078)],
);

const LinearGradient _premiumGradientLight = LinearGradient(
  begin: Alignment.topCenter,
  end: Alignment.bottomCenter,
  colors: [
    Color(0xFFCFBEB5),
    Color(0xFFCFBEB5),
    Color(0xFFFFF8F0),
  ],
  stops: [0.0, 0.45, 1.0],
);

const LinearGradient _premiumGradientDark = LinearGradient(
  begin: Alignment.topCenter,
  end: Alignment.bottomCenter,
  colors: [
    Color(0xFF4A3E3D),
    Color(0xFF4A3E3D),
    Color(0xFF2D2523),
  ],
  stops: [0.0, 0.45, 1.0],
);

/// Men gold gradient
const LinearGradient _goldGradientMen = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [Color(0xFFD4AF37), Color(0xFFAA7C11)],
);

/// Men obsidian glass gradient
const LinearGradient _obsidianGlassGradient = LinearGradient(
  begin: Alignment.topCenter,
  end: Alignment.bottomCenter,
  colors: [
    Color(0xCC14171F),
    Color(0xE60A0C10),
  ],
);

/// AURA gradient
const LinearGradient _auraGradient = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [Color(0xFF164C46), Color(0xFF0D3630)],
);

/// Scrim bottom gradient for photography
const LinearGradient _scrimBottom = LinearGradient(
  begin: Alignment.topCenter,
  end: Alignment.bottomCenter,
  colors: [
    Colors.transparent,
    Colors.transparent,
    Colors.transparent,
    Color(0x1E2B2420),
    Color(0x592B2420),
  ],
  stops: [0.0, 0.55, 0.68, 0.86, 1.0],
);

/// ============================================================================
/// EXPRESSION CONTEXT — Women / Men / AURA
/// ============================================================================

enum Expression { women, men, aura, neutral }

/// ============================================================================
/// TOKEN CLASS — Immutable, accessible via Token.light / Token.dark
/// Extended with expression-aware resolution
/// ============================================================================

class Token {
  final Brightness brightness;
  final Expression expression;

  // Brand colors (context-aware via expression)
  final Color brandPrimary;
  final Color brandPrimaryOn;
  final Color brandSecondary;
  final Color brandSecondaryOn;
  final Color brandTertiary;
  final Color brandTertiaryOn;

  // Neutral scale
  final Map<int, Color> neutral;

  // Semantic status
  final Map<String, Color> status;

  // Gradients
  final LinearGradient primaryGradient;
  final LinearGradient roseGoldSatin;
  final LinearGradient terracottaMatte;
  final LinearGradient premiumGradient;
  final LinearGradient goldGradientMen;
  final LinearGradient obsidianGlassGradient;
  final LinearGradient auraGradient;
  final LinearGradient scrimBottom;

  // Surface hierarchy (L0-L3 + variants)
  final Color surfaceLevel0;      // Scaffold background
  final Color surfaceLevel1;      // Content surface (cards, sheets)
  final Color surfaceLevel2;      // Glass/frosted overlay
  final Color surfaceLevel3;      // CTA/selection surface
  final Color surfaceVariant;     // Input fill, search bars
  final Color surfaceContainer;   // Card container in lists
  final Color surfaceOverlay;     // Modal backdrop
  final Color surfaceGlass;       // Glass morphism
  final Color surfaceInput;       // Text field background
  final Color surfaceSelected;    // Selected chips, items

  // Text system (7 semantic colors)
  final Color textPrimary;
  final Color textSecondary;
  final Color textMuted;
  final Color textDisabled;
  final Color textInverse;
  final Color textAccent;
  final Color textAura;

  // Border system (5 semantic borders)
  final Color borderDefault;
  final Color borderSubtle;
  final Color borderStrong;
  final Color borderFocus;
  final Color borderSelected;

  // Interaction colors
  final Color interactionHover;
  final Color interactionPressed;
  final Color interactionFocus;
  final Color interactionSelected;
  final Color interactionDisabledBg;
  final Color interactionDisabledText;

  // Shadows (warm, not black)
  final Color shadowSoft;
  final Color shadowMedium;
  final Color shadowStrong;
  final Color shadowGoldGlow;
  final Color shadowChampagneGlow;
  final Color shadowAura;
  final Color shadowDrawer;

  const Token({
    required this.brightness,
    required this.expression,
    required this.brandPrimary,
    required this.brandPrimaryOn,
    required this.brandSecondary,
    required this.brandSecondaryOn,
    required this.brandTertiary,
    required this.brandTertiaryOn,
    required this.neutral,
    required this.status,
    required this.primaryGradient,
    required this.roseGoldSatin,
    required this.terracottaMatte,
    required this.premiumGradient,
    required this.goldGradientMen,
    required this.obsidianGlassGradient,
    required this.auraGradient,
    required this.scrimBottom,
    required this.surfaceLevel0,
    required this.surfaceLevel1,
    required this.surfaceLevel2,
    required this.surfaceLevel3,
    required this.surfaceVariant,
    required this.surfaceContainer,
    required this.surfaceOverlay,
    required this.surfaceGlass,
    required this.surfaceInput,
    required this.surfaceSelected,
    required this.textPrimary,
    required this.textSecondary,
    required this.textMuted,
    required this.textDisabled,
    required this.textInverse,
    required this.textAccent,
    required this.textAura,
    required this.borderDefault,
    required this.borderSubtle,
    required this.borderStrong,
    required this.borderFocus,
    required this.borderSelected,
    required this.interactionHover,
    required this.interactionPressed,
    required this.interactionFocus,
    required this.interactionSelected,
    required this.interactionDisabledBg,
    required this.interactionDisabledText,
    required this.shadowSoft,
    required this.shadowMedium,
    required this.shadowStrong,
    required this.shadowGoldGlow,
    required this.shadowChampagneGlow,
    required this.shadowAura,
    required this.shadowDrawer,
  });

  /// Light Theme — Women Expression (default)
  static const Token light = Token(
    brightness: Brightness.light,
    expression: Expression.women,

    // Women brand colors
    brandPrimary: _roseGold,           // #D4AF7A — Rose Gold
    brandPrimaryOn: Color(0xFF2B2420), // Warm black on rose gold
    brandSecondary: _warmBrown,        // #5A3A2A — Warm Brown
    brandSecondaryOn: Color(0xFFFAF8F5), // Cream silk on warm brown
    brandTertiary: _champagne,         // #D9A27F — Champagne
    brandTertiaryOn: Color(0xFF2B2420), // Warm black on champagne

    neutral: _neutralLight,
    status: _statusLight,

    primaryGradient: _primaryGradientLight,
    roseGoldSatin: _roseGoldSatinLight,
    terracottaMatte: _terracottaMatteLight,
    premiumGradient: _premiumGradientLight,
    goldGradientMen: _goldGradientMen,
    obsidianGlassGradient: _obsidianGlassGradient,
    auraGradient: _auraGradient,
    scrimBottom: _scrimBottom,

    // Women surface hierarchy
    surfaceLevel0: _creamSilk,               // #FCF8F6 — Scaffold
    surfaceLevel1: Color(0xFFFFFFFF),        // White — Cards
    surfaceLevel2: Color(0xD9F4EFEA),        // Nude100 85% — Glass
    surfaceLevel3: _gold871,                 // #C5A052 — CTA
    surfaceVariant: Color(0xFFF5EBE6),       // Input fill
    surfaceContainer: Color(0xFFF4EFEA),     // Nude100 — Card containers
    surfaceOverlay: Color(0x80000000),       // Modal backdrop 50%
    surfaceGlass: Color(0xCCFFFFFF),         // Glass 80%
    surfaceInput: Color(0xFFFAF8F5),         // Nude50 — Input bg
    surfaceSelected: Color(0x1FC5A052),      // Gold871 12% — Selected

    // Women text system
    textPrimary: Color(0xFF2B2420),    // Warm black
    textSecondary: Color(0xFF857360),  // Warm muted
    textMuted: Color(0xFF9E8C78),      // Metadata
    textDisabled: Color(0xFFA89F91),   // Disabled
    textInverse: Color(0xFFFAF8F5),    // Cream silk
    textAccent: _gold871,              // Brand gold
    textAura: _auraTeal,               // Aura Teal

    // Women border system
    borderDefault: Color(0xFFE8E0D5),       // Nude200
    borderSubtle: Color(0xFFF3EAE8),        // Hairline
    borderStrong: _gold871,                 // Gold871
    borderFocus: _gold871,                  // Gold871
    borderSelected: _gold871,               // Gold871

    // Interaction states
    interactionHover: Color(0x0D2B2420),      // Warm black 5%
    interactionPressed: Color(0x1A2B2420),    // Warm black 10%
    interactionFocus: _gold871,               // Gold871
    interactionSelected: Color(0x1FC5A052),   // Gold871 12%
    interactionDisabledBg: Color(0xFFF0ECE6), // Disabled bg
    interactionDisabledText: Color(0xFFA89F91), // Disabled text

    // Shadows — Warm, not black
    shadowSoft: Color(0x0A000000),         // 4% black
    shadowMedium: Color(0x0A000000),       // 4% black
    shadowStrong: Color(0x1A000000),       // 10% black
    shadowGoldGlow: Color(0x2EC5A052),     // Gold871 18%
    shadowChampagneGlow: Color(0x4DD4AF37), // Champagne 30%
    shadowAura: Color(0x33164C46),         // Aura Teal 20%
    shadowDrawer: Color(0x14000000),       // 8% black
  );

  /// Dark Theme — Men Expression (default dark)
  static const Token dark = Token(
    brightness: Brightness.dark,
    expression: Expression.men,

    // Men brand colors
    brandPrimary: _champagneMen,       // #D4AF37 — Champagne Gold
    brandPrimaryOn: _obsidianBg,       // #0A0C10 — Obsidian on gold
    brandSecondary: _warmWhite,        // #F2EFEA — Warm White
    brandSecondaryOn: _obsidianBg,     // Obsidian on warm white
    brandTertiary: _copper,            // #B8734A — Copper
    brandTertiaryOn: _obsidianBg,      // Obsidian on copper

    neutral: _neutralDark,
    status: _statusDark,

    primaryGradient: _primaryGradientDark,
    roseGoldSatin: _roseGoldSatinDark,
    terracottaMatte: _terracottaMatteDark,
    premiumGradient: _premiumGradientDark,
    goldGradientMen: _goldGradientMen,
    obsidianGlassGradient: _obsidianGlassGradient,
    auraGradient: _auraGradient,
    scrimBottom: _scrimBottom,

    // Men surface hierarchy
    surfaceLevel0: _obsidianBg,                  // #0A0C10 — Scaffold
    surfaceLevel1: Color(0xFF14171F),            // Obsidian Card
    surfaceLevel2: Color(0xD914171F),            // Obsidian Card 85% — Glass
    surfaceLevel3: _champagneMen,                // #D4AF37 — CTA
    surfaceVariant: Color(0xFF4A3E3D),           // Input fill (dark)
    surfaceContainer: Color(0xFF3D3330),         // Card containers (dark)
    surfaceOverlay: Color(0xBF000000),           // Modal backdrop 75%
    surfaceGlass: Color(0xD914171F),             // Glass 85%
    surfaceInput: Color(0xFF2D2523),             // Input bg (dark)
    surfaceSelected: Color(0x1FD4AF37),          // Champagne 12% — Selected

    // Men text system
    textPrimary: Color(0xFFF5F6F8),    // Warm white
    textSecondary: Color(0xFF949AA8),  // Muted
    textMuted: Color(0xFF5F6575),      // Metadata
    textDisabled: Color(0xFF5F6575),   // Disabled
    textInverse: _obsidianBg,          // Obsidian
    textAccent: _champagneMen,         // Champagne Gold
    textAura: _auraTeal,               // Aura Teal

    // Men border system
    borderDefault: Color(0x35C5A059),        // BronzeAccent 20%
    borderSubtle: Color(0x20C5A059),         // BronzeAccent 12%
    borderStrong: _champagneMen,             // Champagne Gold
    borderFocus: _champagneMen,              // Champagne Gold
    borderSelected: _champagneMen,           // Champagne Gold

    // Interaction states
    interactionHover: Color(0x0DFFFFFF),      // White 5%
    interactionPressed: Color(0x1AFFFFFF),    // White 10%
    interactionFocus: _champagneMen,          // Champagne Gold
    interactionSelected: Color(0x1FD4AF37),   // Champagne 12%
    interactionDisabledBg: Color(0xFF1E232E), // Obsidian Card Hover
    interactionDisabledText: Color(0xFF5F6575), // Disabled text

    // Shadows — Warm, not black
    shadowSoft: Color(0x0A000000),         // 4% black
    shadowMedium: Color(0x0A000000),       // 4% black
    shadowStrong: Color(0x33000000),       // 20% black
    shadowGoldGlow: Color(0x2EC5A052),     // Gold871 18%
    shadowChampagneGlow: Color(0x4DD4AF37), // Champagne 30%
    shadowAura: Color(0x33164C46),         // Aura Teal 20%
    shadowDrawer: Color(0x14000000),       // 8% black
  );

  /// Expression-aware token resolution
  static Token of(BuildContext context, {Expression? expression}) {
    final brightness = Theme.of(context).brightness;
    final expr = expression ?? _inferExpression(context);
    
    if (brightness == Brightness.dark) {
      return expr == Expression.women ? _darkWomen : dark; // dark defaults to men
    }
    return expr == Expression.men ? _lightMen : light; // light defaults to women
  }

  static Expression _inferExpression(BuildContext context) {
    // Check for audience service or theme extension
    // For now, default based on brightness
    return Theme.of(context).brightness == Brightness.dark 
        ? Expression.men 
        : Expression.women;
  }

  // Convenience getters — neutral scale
  Color get n50 => neutral[50]!;
  Color get n100 => neutral[100]!;
  Color get n200 => neutral[200]!;
  Color get n300 => neutral[300]!;
  Color get n400 => neutral[400]!;
  Color get n500 => neutral[500]!;
  Color get n600 => neutral[600]!;
  Color get n700 => neutral[700]!;
  Color get n800 => neutral[800]!;
  Color get n900 => neutral[900]!;

  // Aliases used by existing consumers (booking_card, etc.)
  Color get neutral50 => neutral[50]!;
  Color get neutral100 => neutral[100]!;
  Color get neutral500 => neutral[500]!;
  Color get neutral600 => neutral[600]!;

  // Border alias
  Color get outlineVariant => borderSubtle;

  // Surface alias
  Color get surface => surfaceLevel1;

  // Status getters
  Color get success => status['success']!;
  Color get successBg => status['success_bg']!;
  Color get successOn => status['success_on']!;
  Color get warning => status['warning']!;
  Color get warningBg => status['warning_bg']!;
  Color get warningOn => status['warning_on']!;
  Color get error => status['error']!;
  Color get errorBg => status['error_bg']!;
  Color get errorOn => status['error_on']!;
  Color get info => status['info']!;
  Color get infoBg => status['info_bg']!;
  Color get infoOn => status['info_on']!;
  Color get inProgress => status['in_progress']!;
  Color get inProgressBg => status['in_progress_bg']!;
  Color get inProgressOn => status['in_progress_on']!;

  // Expression-specific token accessors
  static Token get women => Token.light;
  static Token get men => _darkMen;
  static Token get aura => _auraToken;
  static Token get lightMen => _lightMen;
  static Token get darkWomen => _darkWomen;
  static Token get auraToken => _auraToken;

  // Public getters for Token internals (required by AppTheme for theme building)
  static Token get lightMenToken => _lightMen;
  static Token get darkWomenToken => _darkWomen;
  static Token get auraTokenInstance => _auraToken;
  
  // Foundation color getters
  static Color get neutralLight => _neutralLight[50]!;
  static Map<int, Color> get neutralLightMap => _neutralLight;
  static Map<int, Color> get neutralDarkMap => _neutralDark;
  static Map<String, Color> get statusLightMap => _statusLight;
  static Map<String, Color> get statusDarkMap => _statusDark;
  static Color get gold871 => _gold871;
  static Color get roseGold => _roseGold;
  static Color get warmBrown => _warmBrown;
  static Color get champagne => _champagne;
  static Color get creamSilk => _creamSilk;
  static Color get obsidianBg => _obsidianBg;
  static Color get warmWhite => _warmWhite;
  static Color get champagneMen => _champagneMen;
  static Color get copper => _copper;
  static Color get bronzeAccent => _bronzeAccent;
  static Color get auraTeal => _auraTeal;
  static LinearGradient get primaryGradientLight => _primaryGradientLight;
  static LinearGradient get roseGoldSatinLight => _roseGoldSatinLight;
  static LinearGradient get terracottaMatteLight => _terracottaMatteLight;
  static LinearGradient get premiumGradientLight => _premiumGradientLight;
  static LinearGradient get goldGradientMenValue => _goldGradientMen;
  static LinearGradient get obsidianGlassGradientValue => _obsidianGlassGradient;
  static LinearGradient get auraGradientValue => _auraGradient;
  static LinearGradient get scrimBottomValue => _scrimBottom;
  static LinearGradient get primaryGradientDark => _primaryGradientDark;
  static LinearGradient get roseGoldSatinDark => _roseGoldSatinDark;
  static LinearGradient get terracottaMatteDark => _terracottaMatteDark;
  static LinearGradient get premiumGradientDark => _premiumGradientDark;

  // Private expression-specific tokens
  static const Token _lightMen = Token(
    brightness: Brightness.light,
    expression: Expression.men,
    brandPrimary: _champagneMen,
    brandPrimaryOn: _obsidianBg,
    brandSecondary: _warmWhite,
    brandSecondaryOn: _obsidianBg,
    brandTertiary: _copper,
    brandTertiaryOn: _obsidianBg,
    neutral: _neutralLight,
    status: _statusLight,
    primaryGradient: _primaryGradientLight,
    roseGoldSatin: _roseGoldSatinLight,
    terracottaMatte: _terracottaMatteLight,
    premiumGradient: _premiumGradientLight,
    goldGradientMen: _goldGradientMen,
    obsidianGlassGradient: _obsidianGlassGradient,
    auraGradient: _auraGradient,
    scrimBottom: _scrimBottom,
    surfaceLevel0: _creamSilk,              // Women L0 even in Men light
    surfaceLevel1: Color(0xFFFFFFFF),
    surfaceLevel2: Color(0xD9F4EFEA),
    surfaceLevel3: _champagneMen,           // Men primary for CTA
    surfaceVariant: Color(0xFFF5EBE6),
    surfaceContainer: Color(0xFFF4EFEA),
    surfaceOverlay: Color(0x80000000),
    surfaceGlass: Color(0xCCFFFFFF),
    surfaceInput: Color(0xFFFAF8F5),
    surfaceSelected: Color(0x1FD4AF37),     // Champagne selected
    textPrimary: Color(0xFF2B2420),
    textSecondary: Color(0xFF857360),
    textMuted: Color(0xFF9E8C78),
    textDisabled: Color(0xFFA89F91),
    textInverse: Color(0xFFFAF8F5),
    textAccent: _champagneMen,
    textAura: _auraTeal,
    borderDefault: Color(0xFFE8E0D5),
    borderSubtle: Color(0xFFF3EAE8),
    borderStrong: _champagneMen,
    borderFocus: _champagneMen,
    borderSelected: _champagneMen,
    interactionHover: Color(0x0D2B2420),
    interactionPressed: Color(0x1A2B2420),
    interactionFocus: _champagneMen,
    interactionSelected: Color(0x1FD4AF37),
    interactionDisabledBg: Color(0xFFF0ECE6),
    interactionDisabledText: Color(0xFFA89F91),
    shadowSoft: Color(0x0A000000),
    shadowMedium: Color(0x0A000000),
    shadowStrong: Color(0x1A000000),
    shadowGoldGlow: Color(0x2EC5A052),
    shadowChampagneGlow: Color(0x4DD4AF37),
    shadowAura: Color(0x33164C46),
    shadowDrawer: Color(0x14000000),
  );

  static const Token _darkWomen = Token(
    brightness: Brightness.dark,
    expression: Expression.women,
    brandPrimary: _roseGold,
    brandPrimaryOn: Color(0xFF2B2420),
    brandSecondary: _warmBrown,
    brandSecondaryOn: Color(0xFFFAF8F5),
    brandTertiary: _champagne,
    brandTertiaryOn: Color(0xFF2B2420),
    neutral: _neutralDark,
    status: _statusDark,
    primaryGradient: _primaryGradientDark,
    roseGoldSatin: _roseGoldSatinDark,
    terracottaMatte: _terracottaMatteDark,
    premiumGradient: _premiumGradientDark,
    goldGradientMen: _goldGradientMen,
    obsidianGlassGradient: _obsidianGlassGradient,
    auraGradient: _auraGradient,
    scrimBottom: _scrimBottom,
    surfaceLevel0: _obsidianBg,             // Dark L0
    surfaceLevel1: Color(0xFF24232B),       // Dark card
    surfaceLevel2: Color(0xD924232B),       // Dark glass
    surfaceLevel3: _gold871,                // Gold871 CTA
    surfaceVariant: Color(0xFF4A3E3D),
    surfaceContainer: Color(0xFF3D3330),
    surfaceOverlay: Color(0xBF000000),
    surfaceGlass: Color(0xD924232B),
    surfaceInput: Color(0xFF2D2523),
    surfaceSelected: Color(0x1FC5A052),
    textPrimary: Color(0xFFFAF8F5),
    textSecondary: Color(0xFFAD8272),
    textMuted: Color(0xFFC5A090),
    textDisabled: Color(0xFF6B5E5A),
    textInverse: _obsidianBg,
    textAccent: _gold871,
    textAura: _auraTeal,
    borderDefault: Color(0xFF33313D),
    borderSubtle: Color(0xFF2A2830),
    borderStrong: _gold871,
    borderFocus: _gold871,
    borderSelected: _gold871,
    interactionHover: Color(0x0DFFFFFF),
    interactionPressed: Color(0x1AFFFFFF),
    interactionFocus: _gold871,
    interactionSelected: Color(0x1FC5A052),
    interactionDisabledBg: Color(0xFF4A3E3D),
    interactionDisabledText: Color(0xFF6B5E5A),
    shadowSoft: Color(0x0A000000),
    shadowMedium: Color(0x0A000000),
    shadowStrong: Color(0x33000000),
    shadowGoldGlow: Color(0x2EC5A052),
    shadowChampagneGlow: Color(0x4DD4AF37),
    shadowAura: Color(0x33164C46),
    shadowDrawer: Color(0x14000000),
  );

  static const Token _auraToken = Token(
    brightness: Brightness.light,
    expression: Expression.aura,
    brandPrimary: _auraTeal,
    brandPrimaryOn: Colors.white,
    brandSecondary: _auraTeal,
    brandSecondaryOn: Colors.white,
    brandTertiary: _auraTeal,
    brandTertiaryOn: Colors.white,
    neutral: _neutralLight,
    status: _statusLight,
    primaryGradient: _auraGradient,
    roseGoldSatin: _auraGradient,
    terracottaMatte: _auraGradient,
    premiumGradient: _auraGradient,
    goldGradientMen: _auraGradient,
    obsidianGlassGradient: _auraGradient,
    auraGradient: _auraGradient,
    scrimBottom: _scrimBottom,
    surfaceLevel0: _creamSilk,
    surfaceLevel1: Colors.white,
    surfaceLevel2: Color(0x15164C46),       // Aura surface 8%
    surfaceLevel3: _auraTeal,
    surfaceVariant: Color(0x0D164C46),      // Aura subtle 5%
    surfaceContainer: Color(0x0D164C46),
    surfaceOverlay: Color(0x80000000),
    surfaceGlass: Color(0xCCFFFFFF),
    surfaceInput: Color(0xFFFAF8F5),
    surfaceSelected: Color(0x15164C46),
    textPrimary: Color(0xFF2B2420),
    textSecondary: Color(0xFF857360),
    textMuted: Color(0xFF9E8C78),
    textDisabled: Color(0xFFA89F91),
    textInverse: Colors.white,
    textAccent: _auraTeal,
    textAura: _auraTeal,
    borderDefault: Color(0x0D164C46),
    borderSubtle: Color(0x08164C46),
    borderStrong: _auraTeal,
    borderFocus: _auraTeal,
    borderSelected: _auraTeal,
    interactionHover: Color(0x0D164C46),
    interactionPressed: Color(0x1A164C46),
    interactionFocus: _auraTeal,
    interactionSelected: Color(0x15164C46),
    interactionDisabledBg: Color(0x40164C46),
    interactionDisabledText: Color(0x40164C46),
    shadowSoft: Color(0x0A000000),
    shadowMedium: Color(0x0A000000),
    shadowStrong: Color(0x1A000000),
    shadowGoldGlow: Color(0x2EC5A052),
    shadowChampagneGlow: Color(0x4DD4AF37),
    shadowAura: Color(0x33164C46),
    shadowDrawer: Color(0x14000000),
  );
}

/// Expression-specific light/men token for light theme with men expression
const Token _darkMen = Token(
  brightness: Brightness.dark,
  expression: Expression.men,
  brandPrimary: _champagneMen,
  brandPrimaryOn: _obsidianBg,
  brandSecondary: _warmWhite,
  brandSecondaryOn: _obsidianBg,
  brandTertiary: _copper,
  brandTertiaryOn: _obsidianBg,
  neutral: _neutralDark,
  status: _statusDark,
  primaryGradient: _primaryGradientDark,
  roseGoldSatin: _roseGoldSatinDark,
  terracottaMatte: _terracottaMatteDark,
  premiumGradient: _premiumGradientDark,
  goldGradientMen: _goldGradientMen,
  obsidianGlassGradient: _obsidianGlassGradient,
  auraGradient: _auraGradient,
  scrimBottom: _scrimBottom,
  surfaceLevel0: _obsidianBg,
  surfaceLevel1: Color(0xFF14171F),
  surfaceLevel2: Color(0xD914171F),
  surfaceLevel3: _champagneMen,
  surfaceVariant: Color(0xFF4A3E3D),
  surfaceContainer: Color(0xFF3D3330),
  surfaceOverlay: Color(0xBF000000),
  surfaceGlass: Color(0xD914171F),
  surfaceInput: Color(0xFF2D2523),
  surfaceSelected: Color(0x1FD4AF37),
  textPrimary: Color(0xFFF5F6F8),
  textSecondary: Color(0xFF949AA8),
  textMuted: Color(0xFF5F6575),
  textDisabled: Color(0xFF5F6575),
  textInverse: _obsidianBg,
  textAccent: _champagneMen,
  textAura: _auraTeal,
  borderDefault: Color(0x35C5A059),
  borderSubtle: Color(0x20C5A059),
  borderStrong: _champagneMen,
  borderFocus: _champagneMen,
  borderSelected: _champagneMen,
  interactionHover: Color(0x0DFFFFFF),
  interactionPressed: Color(0x1AFFFFFF),
  interactionFocus: _champagneMen,
  interactionSelected: Color(0x1FD4AF37),
  interactionDisabledBg: Color(0xFF1E232E),
  interactionDisabledText: Color(0xFF5F6575),
  shadowSoft: Color(0x0A000000),
  shadowMedium: Color(0x0A000000),
  shadowStrong: Color(0x33000000),
  shadowGoldGlow: Color(0x2EC5A052),
  shadowChampagneGlow: Color(0x4DD4AF37),
  shadowAura: Color(0x33164C46),
  shadowDrawer: Color(0x14000000),
);

/// ============================================================================
/// SPACING TOKENS — 4px base unit
/// ============================================================================

class Spacing {
  static const double xs = 4.0;
  static const double sm = 8.0;
  static const double md = 12.0;
  static const double lg = 16.0;
  static const double xl = 20.0;
  static const double xxl = 24.0;
  static const double xxxl = 32.0;
  static const double huge = 48.0;
  static const double massive = 64.0;
  static const double giant = 80.0;
}

/// ============================================================================
/// BORDER RADIUS TOKENS
/// ============================================================================

class Radii {
  static const double xs = 4.0;
  static const double sm = 8.0;
  static const double md = 12.0;
  static const double lg = 16.0;
  static const double xl = 20.0;
  static const double xxl = 24.0;
  static const double xxxl = 28.0;
  static const double round = 30.0;    // Buttons
  static const double pill = 100.0;    // Chips
  static const double circle = 9999.0; // Avatars
  
  // Legacy compatibility
  static const double radiusControl = round;
  static const double radiusCard = lg;
}

/// ============================================================================
/// SHADOW TOKENS — Warm shadows per S1
/// ============================================================================

class AppShadow {
  static List<BoxShadow> soft(Token t) => [
    BoxShadow(
      color: t.shadowSoft,
      blurRadius: 8,
      offset: const Offset(0, 2),
    ),
  ];

  static List<BoxShadow> card(Token t) => [
    BoxShadow(
      color: t.shadowMedium,
      blurRadius: 24,
      offset: const Offset(0, 8),
      spreadRadius: -4,
    ),
  ];

  static List<BoxShadow> elevated(Token t) => [
    BoxShadow(
      color: t.shadowStrong,
      blurRadius: 32,
      offset: const Offset(0, 16),
    ),
  ];

  static List<BoxShadow> glow(Token t, {Color? color}) => [
    BoxShadow(
      color: (color ?? t.brandPrimary).withOpacity(0.35),
      blurRadius: 16,
      offset: const Offset(0, 6),
    ),
  ];

  static List<BoxShadow> aura(Token t) => [
    BoxShadow(
      color: t.shadowAura,
      blurRadius: 20,
      offset: const Offset(0, 0),
      spreadRadius: 2,
    ),
  ];

  static List<BoxShadow> drawer(Token t) => [
    BoxShadow(
      color: t.shadowDrawer,
      blurRadius: 24,
      offset: const Offset(-6, 0),
    ),
  ];
}

/// ============================================================================
/// OPACITY TOKENS — Semantic opacity per S1
/// ============================================================================

class OpacityTokens {
  // Overlays
  static const double scrimLight = 0.5;
  static const double scrimDark = 0.75;
  static const double modalBackdropLight = 0.5;
  static const double modalBackdropDark = 0.75;

  // Glass
  static const double glassLight = 0.85;
  static const double glassDark = 0.85;
  static const double glassMen = 0.85;

  // Disabled
  static const double disabledBg = 0.35;
  static const double disabledText = 0.4;
  static const double disabledBorder = 0.3;

  // Hover
  static const double hoverOverlay = 0.05;
  static const double hoverBorder = 0.8;

  // Selected
  static const double selectedBg = 0.12;
  static const double selectedBorder = 1.0;

  // Shadows
  static const double shadowAmbient = 0.04;
  static const double shadowCard = 0.08;
  static const double shadowDrawer = 0.08;
  static const double shadowGlow = 0.18;
  static const double shadowStrong = 0.2;

  // Image overlays
  static const double gradientStart = 0.0;
  static const double gradientMid = 0.2;
  static const double gradientStrong = 0.6;
  static const double gradientEnd = 0.8;
}

/// ============================================================================
/// THEME EXTENSION — Access Token in BuildContext via Theme.of(context).extension<GlowTokensExtension>()
/// ============================================================================

class GlowTokensExtension extends ThemeExtension<GlowTokensExtension> {
  final Token token;

  const GlowTokensExtension({required this.token});

  @override
  GlowTokensExtension copyWith({Token? token}) {
    return GlowTokensExtension(token: token ?? this.token);
  }

  @override
  GlowTokensExtension lerp(ThemeExtension<GlowTokensExtension>? other, double t) {
    if (other is GlowTokensExtension) {
      return GlowTokensExtension(token: other.token);
    }
    return this;
  }
}

/// ============================================================================
/// BUILDCONTEXT EXTENSION — Easy token access
/// ============================================================================

extension GlowTokenContext on BuildContext {
  Token get glowTokens {
    final extension = Theme.of(this).extension<GlowTokensExtension>();
    return extension?.token ?? Token.of(this);
  }

  // Expression-aware token access
  Token get glowTokensWomen => Token.light;
  Token get glowTokensMen => Token.dark;
  Token get glowTokensAura => Token._auraToken;
}

extension GlowColorSchemeContext on BuildContext {
  ColorScheme get glowColorScheme => Theme.of(this).colorScheme;
  
  // S1 Semantic color roles
  Color get glowPrimary => glowTokens.brandPrimary;
  Color get glowPrimaryOn => glowTokens.brandPrimaryOn;
  Color get glowSecondary => glowTokens.brandSecondary;
  Color get glowSecondaryOn => glowTokens.brandSecondaryOn;
  Color get glowTertiary => glowTokens.brandTertiary;
  Color get glowTertiaryOn => glowTokens.brandTertiaryOn;
  
  // Surface hierarchy
  Color get glowSurfaceL0 => glowTokens.surfaceLevel0;
  Color get glowSurfaceL1 => glowTokens.surfaceLevel1;
  Color get glowSurfaceL2 => glowTokens.surfaceLevel2;
  Color get glowSurfaceL3 => glowTokens.surfaceLevel3;
  
  // Text
  Color get glowTextPrimary => glowTokens.textPrimary;
  Color get glowTextSecondary => glowTokens.textSecondary;
  Color get glowTextMuted => glowTokens.textMuted;
  Color get glowTextDisabled => glowTokens.textDisabled;
  Color get glowTextInverse => glowTokens.textInverse;
  Color get glowTextAccent => glowTokens.textAccent;
  Color get glowTextAura => glowTokens.textAura;
  
  // Borders
  Color get glowBorderDefault => glowTokens.borderDefault;
  Color get glowBorderSubtle => glowTokens.borderSubtle;
  Color get glowBorderStrong => glowTokens.borderStrong;
  Color get glowBorderFocus => glowTokens.borderFocus;
  Color get glowBorderSelected => glowTokens.borderSelected;
  
  // Semantic states
  Color get glowSuccess => glowTokens.success;
  Color get glowWarning => glowTokens.warning;
  Color get glowError => glowTokens.error;
  Color get glowInfo => glowTokens.info;
  Color get glowInProgress => glowTokens.inProgress;
  
  // AURA
  Color get glowAura => _auraTeal;
  Color get glowAuraSurface => const Color(0x15164C46);
  Color get glowAuraSubtle => const Color(0x0D164C46);
}

/// ============================================================================
/// S2 TYPOGRAPHY SYSTEM — Single Source of Truth
/// Two-voice architecture: Cormorant Garamond (Editorial) + Manrope (Functional) + JetBrains Mono (Data)
/// Implements: GLOWAPP_TYPOGRAPHY_SYSTEM.md / glowapp_typography_system.json
/// ============================================================================

/// Typography Family Constants
class TypographyFamilies {
  TypographyFamilies._();
  static const String editorial = 'CormorantGaramond';
  static const String functional = 'Manrope';
  static const String data = 'JetBrainsMono';
}

/// Typography Weight Constants
class TypographyWeights {
  TypographyWeights._();
  // Editorial (Cormorant)
  static const FontWeight editorialLight = FontWeight.w300;
  static const FontWeight editorialRegular = FontWeight.w400;
  static const FontWeight editorialMedium = FontWeight.w500;
  static const FontWeight editorialSemiBold = FontWeight.w600;
  static const FontWeight editorialBold = FontWeight.w700;

  // Functional (Manrope)
  static const FontWeight functionalLight = FontWeight.w300;
  static const FontWeight functionalRegular = FontWeight.w400;
  static const FontWeight functionalMedium = FontWeight.w500;
  static const FontWeight functionalSemiBold = FontWeight.w600;
  static const FontWeight functionalBold = FontWeight.w700;
  static const FontWeight functionalExtraBold = FontWeight.w800;

  // Data (JetBrains Mono)
  static const FontWeight dataMedium = FontWeight.w500;
  static const FontWeight dataSemiBold = FontWeight.w600;
  static const FontWeight dataBold = FontWeight.w700;
}

/// Complete S2 Typography Scale — Authoritative Token System
class TypographyTokens {
  TypographyTokens._();

  // ===========================================================================
  // DISPLAY SCALE (Cormorant Garamond — Editorial Voice)
  // ===========================================================================
  static TextStyle displayXL(Token t) => TextStyle(
    fontFamily: TypographyFamilies.editorial,
    fontSize: 48,
    fontWeight: TypographyWeights.editorialLight,
    height: 1.1,
    letterSpacing: -1.0,
    color: t.textPrimary,
  );

  static TextStyle displayL(Token t) => TextStyle(
    fontFamily: TypographyFamilies.editorial,
    fontSize: 40,
    fontWeight: TypographyWeights.editorialLight,
    height: 1.15,
    letterSpacing: -0.8,
    color: t.textPrimary,
  );

  static TextStyle displayM(Token t) => TextStyle(
    fontFamily: TypographyFamilies.editorial,
    fontSize: 32,
    fontWeight: TypographyWeights.editorialRegular,
    height: 1.2,
    letterSpacing: -0.5,
    color: t.textPrimary,
  );

  static TextStyle displayS(Token t) => TextStyle(
    fontFamily: TypographyFamilies.editorial,
    fontSize: 26,
    fontWeight: TypographyWeights.editorialMedium,
    height: 1.25,
    letterSpacing: -0.3,
    color: t.textPrimary,
  );

  // ===========================================================================
  // HEADING SCALE (Cormorant Garamond — Editorial Voice)
  // ===========================================================================
  static TextStyle h1(Token t) => TextStyle(
    fontFamily: TypographyFamilies.editorial,
    fontSize: 28,
    fontWeight: TypographyWeights.editorialSemiBold,
    height: 1.25,
    letterSpacing: -0.5,
    color: t.textPrimary,
  );

  static TextStyle h2(Token t) => TextStyle(
    fontFamily: TypographyFamilies.editorial,
    fontSize: 22,
    fontWeight: TypographyWeights.editorialSemiBold,
    height: 1.3,
    letterSpacing: -0.3,
    color: t.textPrimary,
  );

  static TextStyle h3(Token t) => TextStyle(
    fontFamily: TypographyFamilies.editorial,
    fontSize: 18,
    fontWeight: TypographyWeights.editorialSemiBold,
    height: 1.35,
    letterSpacing: -0.2,
    color: t.textPrimary,
  );

  static TextStyle h4(Token t) => TextStyle(
    fontFamily: TypographyFamilies.editorial,
    fontSize: 16,
    fontWeight: TypographyWeights.editorialSemiBold,
    height: 1.4,
    letterSpacing: 0,
    color: t.textPrimary,
  );

  // ===========================================================================
  // BODY SCALE (Manrope — Functional Voice)
  // ===========================================================================
  static TextStyle bodyLarge(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 16,
    fontWeight: TypographyWeights.functionalRegular,
    height: 1.6,
    letterSpacing: 0,
    color: t.textPrimary,
  );

  static TextStyle body(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 14,
    fontWeight: TypographyWeights.functionalRegular,
    height: 1.55,
    letterSpacing: 0.1,
    color: t.textPrimary,
  );

  static TextStyle bodySmall(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 12,
    fontWeight: TypographyWeights.functionalRegular,
    height: 1.5,
    letterSpacing: 0.2,
    color: t.textSecondary,
  );

  // ===========================================================================
  // UI LABEL SCALE (Manrope — Functional Voice)
  // ===========================================================================
  static TextStyle labelLarge(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 14,
    fontWeight: TypographyWeights.functionalSemiBold,
    height: 1.4,
    letterSpacing: 0.1,
    color: t.textPrimary,
  );

  static TextStyle labelMedium(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 12,
    fontWeight: TypographyWeights.functionalSemiBold,
    height: 1.4,
    letterSpacing: 0.5,
    color: t.textPrimary,
  );

  static TextStyle labelSmall(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 10,
    fontWeight: TypographyWeights.functionalSemiBold,
    height: 1.3,
    letterSpacing: 0.8,
    color: t.textSecondary,
  );

  // ===========================================================================
  // BUTTON TYPOGRAPHY (Manrope)
  // ===========================================================================
  static TextStyle buttonPrimary(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 16,
    fontWeight: TypographyWeights.functionalSemiBold,
    height: 1.3,
    letterSpacing: 0.2,
    color: t.brandPrimaryOn,
  );

  static TextStyle buttonSecondary(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 14,
    fontWeight: TypographyWeights.functionalSemiBold,
    height: 1.3,
    letterSpacing: 0.2,
    color: t.brandPrimary,
  );

  // ===========================================================================
  // NAVIGATION & TAB TYPOGRAPHY (Manrope)
  // ===========================================================================
  static TextStyle navigation(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 13,
    fontWeight: TypographyWeights.functionalMedium,
    height: 1.4,
    letterSpacing: 0.3,
    color: t.textPrimary,
  );

  static TextStyle tab(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 13,
    fontWeight: TypographyWeights.functionalSemiBold,
    height: 1.3,
    letterSpacing: 0.3,
    color: t.textPrimary,
  );

  // ===========================================================================
  // INPUT TYPOGRAPHY (Manrope)
  // ===========================================================================
  static TextStyle input(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 16,
    fontWeight: TypographyWeights.functionalRegular,
    height: 1.5,
    letterSpacing: 0,
    color: t.textPrimary,
  );

  static TextStyle inputHint(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 16,
    fontWeight: TypographyWeights.functionalRegular,
    height: 1.5,
    letterSpacing: 0,
    color: t.textMuted,
  );

  static TextStyle inputLabel(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 13,
    fontWeight: TypographyWeights.functionalMedium,
    height: 1.4,
    letterSpacing: 0.1,
    color: t.textSecondary,
  );

  // ===========================================================================
  // CHIP & BADGE TYPOGRAPHY (Manrope)
  // ===========================================================================
  static TextStyle chip(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 12,
    fontWeight: TypographyWeights.functionalMedium,
    height: 1.4,
    letterSpacing: 0.3,
    color: t.textPrimary,
  );

  static TextStyle badge(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 10,
    fontWeight: TypographyWeights.functionalSemiBold,
    height: 1.3,
    letterSpacing: 0.5,
    color: t.textPrimary,
  );

  // ===========================================================================
  // TOOLTIP TYPOGRAPHY (Manrope)
  // ===========================================================================
  static TextStyle tooltip(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 12,
    fontWeight: TypographyWeights.functionalRegular,
    height: 1.4,
    letterSpacing: 0.2,
    color: t.textInverse,
  );

  // ===========================================================================
  // DIALOG / BOTTOM SHEET (Mixed Voices)
  // ===========================================================================
  static TextStyle dialogTitle(Token t) => TextStyle(
    fontFamily: TypographyFamilies.editorial,
    fontSize: 20,
    fontWeight: TypographyWeights.editorialSemiBold,
    height: 1.3,
    letterSpacing: -0.3,
    color: t.textPrimary,
  );

  static TextStyle dialogBody(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 14,
    fontWeight: TypographyWeights.functionalRegular,
    height: 1.55,
    letterSpacing: 0.1,
    color: t.textPrimary,
  );

  static TextStyle bottomSheetTitle(Token t) => TextStyle(
    fontFamily: TypographyFamilies.editorial,
    fontSize: 18,
    fontWeight: TypographyWeights.editorialSemiBold,
    height: 1.3,
    letterSpacing: -0.2,
    color: t.textPrimary,
  );

  static TextStyle bottomSheetBody(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 14,
    fontWeight: TypographyWeights.functionalRegular,
    height: 1.55,
    letterSpacing: 0.1,
    color: t.textPrimary,
  );

  // ===========================================================================
  // PRICE / MONETARY TYPOGRAPHY (JetBrains Mono — Data Voice)
  // ===========================================================================
  static TextStyle priceDisplay(Token t) => TextStyle(
    fontFamily: TypographyFamilies.data,
    fontSize: 24,
    fontWeight: TypographyWeights.dataBold,
    height: 1.2,
    letterSpacing: 0.3,
    color: t.textAccent,
  );

  static TextStyle priceLarge(Token t) => TextStyle(
    fontFamily: TypographyFamilies.data,
    fontSize: 20,
    fontWeight: TypographyWeights.dataBold,
    height: 1.2,
    letterSpacing: 0.2,
    color: t.textAccent,
  );

  static TextStyle priceMedium(Token t) => TextStyle(
    fontFamily: TypographyFamilies.data,
    fontSize: 16,
    fontWeight: TypographyWeights.dataSemiBold,
    height: 1.2,
    letterSpacing: 0.2,
    color: t.textAccent,
  );

  static TextStyle priceSmall(Token t) => TextStyle(
    fontFamily: TypographyFamilies.data,
    fontSize: 13,
    fontWeight: TypographyWeights.dataSemiBold,
    height: 1.2,
    letterSpacing: 0.3,
    color: t.textAccent,
  );

  static TextStyle priceMicro(Token t) => TextStyle(
    fontFamily: TypographyFamilies.data,
    fontSize: 11,
    fontWeight: TypographyWeights.dataMedium,
    height: 1.2,
    letterSpacing: 0.4,
    color: t.textMuted,
  );

  static TextStyle previousPrice(Token t) => TextStyle(
    fontFamily: TypographyFamilies.data,
    fontSize: 14,
    fontWeight: TypographyWeights.dataMedium,
    height: 1.2,
    letterSpacing: 0.2,
    color: t.textMuted,
    decoration: TextDecoration.lineThrough,
    decorationColor: t.textMuted,
    decorationThickness: 1.5,
  );

  static TextStyle discountBadge(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 11,
    fontWeight: TypographyWeights.functionalSemiBold,
    height: 1.2,
    letterSpacing: 0.5,
    color: t.brandPrimaryOn,
  );

  static TextStyle subtotal(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 14,
    fontWeight: TypographyWeights.functionalMedium,
    height: 1.3,
    letterSpacing: 0.2,
    color: t.textPrimary,
  );

  static TextStyle total(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 20,
    fontWeight: TypographyWeights.functionalBold,
    height: 1.2,
    letterSpacing: 0.3,
    color: t.textPrimary,
  );

  static TextStyle tip(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 14,
    fontWeight: TypographyWeights.functionalMedium,
    height: 1.3,
    letterSpacing: 0.2,
    color: t.textPrimary,
  );

  static TextStyle checkoutFinal(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 22,
    fontWeight: TypographyWeights.functionalBold,
    height: 1.15,
    letterSpacing: 0.2,
    color: t.textPrimary,
  );

  // ===========================================================================
  // AURA TYPOGRAPHY (Same two-voice architecture + Aura Teal color)
  // ===========================================================================
  static TextStyle auraDisplay(Token t) => TextStyle(
    fontFamily: TypographyFamilies.editorial,
    fontSize: 28,
    fontWeight: TypographyWeights.editorialRegular,
    height: 1.2,
    letterSpacing: -0.5,
    color: t.textAura,
  );

  static TextStyle auraHeadline(Token t) => TextStyle(
    fontFamily: TypographyFamilies.editorial,
    fontSize: 20,
    fontWeight: TypographyWeights.editorialSemiBold,
    height: 1.3,
    letterSpacing: -0.3,
    color: t.textAura,
  );

  static TextStyle auraBody(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 14,
    fontWeight: TypographyWeights.functionalRegular,
    height: 1.6,
    letterSpacing: 0.1,
    color: t.textPrimary,
  );

  static TextStyle auraLabel(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 12,
    fontWeight: TypographyWeights.functionalSemiBold,
    height: 1.4,
    letterSpacing: 0.5,
    color: t.textAura,
  );

  static TextStyle auraPrice(Token t) => TextStyle(
    fontFamily: TypographyFamilies.data,
    fontSize: 16,
    fontWeight: TypographyWeights.dataBold,
    height: 1.2,
    letterSpacing: 0.2,
    color: t.textAura,
  );

  static TextStyle auraCTA(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 16,
    fontWeight: TypographyWeights.functionalSemiBold,
    height: 1.3,
    letterSpacing: 0.2,
    color: t.brandPrimaryOn,
  );

  static TextStyle auraMetadata(Token t) => TextStyle(
    fontFamily: TypographyFamilies.data,
    fontSize: 10,
    fontWeight: TypographyWeights.dataSemiBold,
    height: 1.2,
    letterSpacing: 1.0,
    color: t.textMuted,
  );

  static TextStyle conciergeMessage(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 14,
    fontWeight: TypographyWeights.functionalRegular,
    height: 1.7,
    letterSpacing: 0.1,
    color: t.textPrimary,
  );

  // ===========================================================================
  // CONCIERGE TYPOGRAPHY
  // ===========================================================================
  static TextStyle conciergeDisplay(Token t) => TextStyle(
    fontFamily: TypographyFamilies.editorial,
    fontSize: 24,
    fontWeight: TypographyWeights.editorialRegular,
    height: 1.25,
    letterSpacing: -0.3,
    color: t.textPrimary,
  );

  static TextStyle conciergeBody(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 15,
    fontWeight: TypographyWeights.functionalRegular,
    height: 1.7,
    letterSpacing: 0.1,
    color: t.textPrimary,
  );

  static TextStyle conciergeLabel(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 12,
    fontWeight: TypographyWeights.functionalMedium,
    height: 1.4,
    letterSpacing: 0.3,
    color: t.textPrimary,
  );

  static TextStyle conciergeAction(Token t) => TextStyle(
    fontFamily: TypographyFamilies.functional,
    fontSize: 16,
    fontWeight: TypographyWeights.functionalSemiBold,
    height: 1.3,
    letterSpacing: 0.2,
    color: t.brandPrimaryOn,
  );
}

/// ============================================================================
/// BUILDCONTEXT EXTENSION — Easy token access for TypographyTokens
/// ============================================================================

extension TypographyTokensContext on BuildContext {
  /// Get the appropriate Token for the current context (expression-aware)
  Token get typographyToken => glowTokens;
  
  /// Convenience accessors for specific expressions
  Token get typographyTokenWomen => Token.women;
  Token get typographyTokenMen => Token.men;
  Token get typographyTokenAura => Token.aura;
  Token get typographyTokenLightMen => Token.lightMen;
  Token get typographyTokenDarkWomen => Token.darkWomen;
}

/// ============================================================================
/// TYPOGRAPHY TOKENS — Context-Aware API
/// ============================================================================

extension TypographyTokensContextAPI on BuildContext {
  /// Get the resolved Token for the current BuildContext
  Token get typographyToken => glowTokens;
  
  // DISPLAY SCALE — Context-aware
  TextStyle get displayXLContext => TypographyTokens.displayXL(typographyToken);
  TextStyle get displayLContext => TypographyTokens.displayL(typographyToken);
  TextStyle get displayMContext => TypographyTokens.displayM(typographyToken);
  TextStyle get displaySContext => TypographyTokens.displayS(typographyToken);

  // HEADING SCALE — Context-aware
  TextStyle get h1Context => TypographyTokens.h1(typographyToken);
  TextStyle get h2Context => TypographyTokens.h2(typographyToken);
  TextStyle get h3Context => TypographyTokens.h3(typographyToken);
  TextStyle get h4Context => TypographyTokens.h4(typographyToken);

  // BODY SCALE — Context-aware
  TextStyle get bodyLargeContext => TypographyTokens.bodyLarge(typographyToken);
  TextStyle get bodyContext => TypographyTokens.body(typographyToken);
  TextStyle get bodySmallContext => TypographyTokens.bodySmall(typographyToken);

  // LABEL SCALE — Context-aware
  TextStyle get labelLargeContext => TypographyTokens.labelLarge(typographyToken);
  TextStyle get labelMediumContext => TypographyTokens.labelMedium(typographyToken);
  TextStyle get labelSmallContext => TypographyTokens.labelSmall(typographyToken);

  // UI TYPOGRAPHY — Context-aware
  TextStyle get buttonPrimaryContext => TypographyTokens.buttonPrimary(typographyToken);
  TextStyle get buttonSecondaryContext => TypographyTokens.buttonSecondary(typographyToken);
  TextStyle get navigationContext => TypographyTokens.navigation(typographyToken);
  TextStyle get inputContext => TypographyTokens.input(typographyToken);
  TextStyle get inputHintContext => TypographyTokens.inputHint(typographyToken);
  TextStyle get inputLabelContext => TypographyTokens.inputLabel(typographyToken);
  TextStyle get chipContext => TypographyTokens.chip(typographyToken);
  TextStyle get badgeContext => TypographyTokens.badge(typographyToken);
  TextStyle get tooltipContext => TypographyTokens.tooltip(typographyToken);

  // DIALOG / BOTTOM SHEET — Context-aware
  TextStyle get dialogTitleContext => TypographyTokens.dialogTitle(typographyToken);
  TextStyle get dialogBodyContext => TypographyTokens.dialogBody(typographyToken);
  TextStyle get bottomSheetTitleContext => TypographyTokens.bottomSheetTitle(typographyToken);
  TextStyle get bottomSheetBodyContext => TypographyTokens.bottomSheetBody(typographyToken);

  // PRICE / MONETARY — Context-aware
  TextStyle get priceDisplayContext => TypographyTokens.priceDisplay(typographyToken);
  TextStyle get priceLargeContext => TypographyTokens.priceLarge(typographyToken);
  TextStyle get priceMediumContext => TypographyTokens.priceMedium(typographyToken);
  TextStyle get priceSmallContext => TypographyTokens.priceSmall(typographyToken);
  TextStyle get priceMicroContext => TypographyTokens.priceMicro(typographyToken);
  TextStyle get previousPriceContext => TypographyTokens.previousPrice(typographyToken);
  TextStyle get discountBadgeContext => TypographyTokens.discountBadge(typographyToken);
  TextStyle get subtotalContext => TypographyTokens.subtotal(typographyToken);
  TextStyle get totalContext => TypographyTokens.total(typographyToken);
  TextStyle get tipContext => TypographyTokens.tip(typographyToken);
  TextStyle get checkoutFinalContext => TypographyTokens.checkoutFinal(typographyToken);

  // AURA TYPOGRAPHY — Context-aware (uses Aura Teal from resolved token)
  TextStyle get auraDisplayContext => TypographyTokens.auraDisplay(typographyToken);
  TextStyle get auraHeadlineContext => TypographyTokens.auraHeadline(typographyToken);
  TextStyle get auraBodyContext => TypographyTokens.auraBody(typographyToken);
  TextStyle get auraLabelContext => TypographyTokens.auraLabel(typographyToken);
  TextStyle get auraPriceContext => TypographyTokens.auraPrice(typographyToken);
  TextStyle get auraCTAContext => TypographyTokens.auraCTA(typographyToken);
  TextStyle get auraMetadataContext => TypographyTokens.auraMetadata(typographyToken);
  TextStyle get conciergeMessageContext => TypographyTokens.conciergeMessage(typographyToken);

  // CONCIERGE TYPOGRAPHY — Context-aware
  TextStyle get conciergeDisplayContext => TypographyTokens.conciergeDisplay(typographyToken);
  TextStyle get conciergeBodyContext => TypographyTokens.conciergeBody(typographyToken);
  TextStyle get conciergeLabelContext => TypographyTokens.conciergeLabel(typographyToken);
  TextStyle get conciergeActionContext => TypographyTokens.conciergeAction(typographyToken);
}


/// ============================================================================
/// APP TYPOGRAPHY — Compatibility Bridge (DEPRECATED)
/// Maps legacy AppTypography API to S2 TypographyTokens
/// @deprecated Use TypographyTokens directly; this bridge enables gradual migration
/// ============================================================================

@Deprecated('Use TypographyTokens from tokens.dart instead')
class AppTypography {
  AppTypography._();

  // Editorial Voice — Cormorant Garamond
  static TextStyle headlineMedium(Token t) => TypographyTokens.h2(t);
  static TextStyle headlineSmall(Token t) => TypographyTokens.h3(t);
  static TextStyle titleMedium(Token t) => TypographyTokens.h3(t);
  static TextStyle titleSmall(Token t) => TypographyTokens.h4(t);

  // Functional Voice — Manrope
  static TextStyle bodyMedium(Token t) => TypographyTokens.body(t);
  static TextStyle bodySmall(Token t) => TypographyTokens.bodySmall(t);

  // UI Labels — Manrope
  static TextStyle labelLarge(Token t) => TypographyTokens.labelLarge(t);
  static TextStyle labelMedium(Token t) => TypographyTokens.labelMedium(t);
  static TextStyle labelSmall(Token t) => TypographyTokens.labelSmall(t);

  // Data Voice — JetBrains Mono (for prices/monetary)
  static TextStyle monoLarge(Token t) => TypographyTokens.priceLarge(t);
  static TextStyle monoMedium(Token t) => TypographyTokens.priceMedium(t);
}

/// ============================================================================
/// BACKWARD COMPATIBILITY — AppTheme legacy getters (deprecated)
/// ============================================================================

class AppTheme {
  AppTheme._();

  // DEPRECATED: Use Token or GlowTokenContext instead
  static Color get primary => Token.light.brandPrimary;
  static Color get accent => Token.light.brandSecondary;
  static Color get background => Token.light.n50;
  static Color get surface => Token.light.surfaceLevel1;
  static Color get text => Token.light.textPrimary;
  static Color get primaryOn => Token.light.brandPrimaryOn;
  static Color get secondaryOn => Token.light.brandSecondaryOn;

  static List<BoxShadow> get cardShadow => AppShadow.card(Token.light);
  static List<BoxShadow> get softShadow => AppShadow.soft(Token.light);
  static List<BoxShadow> get glassShadow => AppShadow.elevated(Token.light);

  static const LinearGradient premiumGradient = _premiumGradientLight;
  static const LinearGradient roseGoldSatinGradient = _roseGoldSatinLight;
  static const LinearGradient terracottaMatteGradient = _terracottaMatteLight;

  // Legacy status colors (deprecated - use Token.status)
  static const Color success = Color(0xFF16A34A);
  static const Color successBg = Color(0xFFDCFCE7);
  static const Color error = Color(0xFFDC2626);
  static const Color errorBg = Color(0xFFFEE2E2);
  static const Color warning = Color(0xFFD97706);
  static const Color warningBg = Color(0xFFFEF3C7);
  static const Color info = Color(0xFF06B6D4);
  static const Color infoBg = Color(0xFFECFEFF);

  static Future<void> loadThemePreference() async {}
  static Future<void> toggleTheme() async {}

  static InputDecoration inputDecoration({
    required String hintText,
    required IconData prefixIcon,
    String? labelText,
    Widget? suffixIcon,
  }) {
    const t = Token.light;
    return InputDecoration(
      hintText: hintText,
      labelText: labelText,
      hintStyle: TextStyle(color: t.textMuted, fontSize: 14),
      labelStyle: TextStyle(color: t.textSecondary, fontSize: 14),
      prefixIcon: Icon(prefixIcon, color: t.brandPrimary, size: 22),
      suffixIcon: suffixIcon,
      floatingLabelBehavior: FloatingLabelBehavior.auto,
      filled: true,
      fillColor: t.surfaceVariant,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        borderSide: BorderSide(color: t.borderDefault, width: 1),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        borderSide: BorderSide(color: t.borderDefault, width: 1),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        borderSide: BorderSide(color: t.borderFocus, width: 1.8),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
    );
  }
}