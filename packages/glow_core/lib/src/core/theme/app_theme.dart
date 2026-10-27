// lib/core/theme/app_theme.dart
// ThemeData configuration usando Design Tokens (S1 Compliant)
// Reemplaza AppTheme legacy en shared/theme.dart

import 'package:flutter/material.dart';
import 'tokens.dart';
import '../../design/icons/glow_icon.dart';

class AppTheme {
  AppTheme._();

  // ============================================================================
    // COMPATIBILITY GETTERS — Para migración gradual desde legacy AppTheme
    // ============================================================================
    // DEPRECATED: Use Token or GlowTokenContext instead
    @Deprecated('Use Token.light.brandPrimary or context.glowPrimary instead')
    static Color get primary => Token.light.brandPrimary;

    @Deprecated('Use Token.light.brandSecondary or context.glowSecondary instead')
    static Color get accent => Token.light.brandSecondary;

    @Deprecated('Use Token.light.n50 or context.glowSurfaceL0 instead')
    static Color get background => Token.light.n50;

    @Deprecated('Use Token.light.surfaceLevel1 or context.glowSurfaceL1 instead')
    static Color get surface => Token.light.surfaceLevel1;

    @Deprecated('Use Token.light.textPrimary or context.glowTextPrimary instead')
    static Color get text => Token.light.textPrimary;

    @Deprecated('Use Token.light.brandPrimaryOn instead')
    static Color get primaryOn => Token.light.brandPrimaryOn;

    @Deprecated('Use Token.light.brandSecondaryOn instead')
    static Color get secondaryOn => Token.light.brandSecondaryOn;

    @Deprecated('Use AppShadow.card(Token.light) instead')
    static List<BoxShadow> get cardShadow => AppShadow.card(Token.light);

    @Deprecated('Use AppShadow.soft(Token.light) instead')
    static List<BoxShadow> get softShadow => AppShadow.soft(Token.light);

    @Deprecated('Use AppShadow.elevated(Token.light) instead')
    static List<BoxShadow> get glassShadow => AppShadow.elevated(Token.light);

    // State colors — compatibility with legacy AppTheme
    @Deprecated('Use Token.light.error or context.glowError instead')
    static Color get error => Token.light.error;

    @Deprecated('Use Token.light.errorBg or Theme.of(context).colorScheme.errorContainer instead')
    static Color get errorBg => Token.light.errorBg;

    @Deprecated('Use Token.light.success or Theme.of(context).colorScheme.secondary instead')
    static Color get success => Token.light.success;

    @Deprecated('Use Token.light.successBg instead')
    static Color get successBg => Token.light.successBg;

    @Deprecated('Use Token.light.warning or Theme.of(context).colorScheme.tertiary instead')
    static Color get warning => Token.light.warning;

    @Deprecated('Use Token.light.warningBg instead')
    static Color get warningBg => Token.light.warningBg;

    @Deprecated('Use Token.light.info instead')
    static Color get info => Token.light.info;

    @Deprecated('Use Token.light.infoBg instead')
    static Color get infoBg => Token.light.infoBg;

    static final ValueNotifier<bool> isModernTheme = ValueNotifier<bool>(true);

      static Future<void> loadThemePreference() async {}
      static Future<void> toggleTheme() async {}

      // ============================================================================
      // COMPATIBILITY METHODS — Para migración gradual desde legacy AppTheme
      // ============================================================================
      @Deprecated('Use custom InputDecoration with Token colors instead')
      static InputDecoration inputDecoration({
        required String hintText,
        required IconData prefixIcon,
        String? labelText,
        Widget? suffixIcon,
      }) {
        return InputDecoration(
          hintText: hintText,
          labelText: labelText,
          hintStyle: TextStyle(color: Token.light.textMuted, fontSize: 14),
          labelStyle: TextStyle(color: Token.light.textSecondary, fontSize: 14),
          prefixIcon: Icon(prefixIcon, color: Token.light.brandPrimary, size: 22),
          suffixIcon: suffixIcon,
          floatingLabelBehavior: FloatingLabelBehavior.auto,
          filled: true,
          fillColor: Token.light.surfaceLevel1.withValues(alpha: 0.8),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
            borderSide: BorderSide(color: Token.light.borderDefault, width: 1),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
            borderSide: BorderSide(color: Token.light.borderDefault, width: 1),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
            borderSide: BorderSide(color: Token.light.brandPrimary, width: 1.8),
          ),
          contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
        );
      }

      /// Light Theme — Women Expression (default)
  static ThemeData light() {
    const t = Token.light;

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: ColorScheme.light(
        primary: t.brandPrimary,
        onPrimary: t.brandPrimaryOn,
        secondary: t.brandSecondary,
        onSecondary: t.brandSecondaryOn,
        tertiary: t.brandTertiary,
        onTertiary: t.brandTertiaryOn,
        surface: t.surfaceLevel1,
        onSurface: t.textPrimary,
        surfaceContainerHighest: t.surfaceContainer,
        outline: t.borderDefault,
        outlineVariant: t.borderSubtle,
        error: t.error,
        onError: t.errorOn,
        errorContainer: t.errorBg,
        onErrorContainer: t.errorOn,
      ),
      scaffoldBackgroundColor: t.surfaceLevel0,
      cardColor: t.surfaceLevel1,
      dividerColor: t.borderSubtle,
      shadowColor: t.shadowSoft,

      // AppBar
      appBarTheme: AppBarTheme(
        backgroundColor: t.surfaceLevel1,
        foregroundColor: t.textPrimary,
        elevation: 0,
        centerTitle: false,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: AppTypography.headlineMedium(t),
        iconTheme: IconThemeData(color: t.textPrimary, size: 24),
        actionsIconTheme: IconThemeData(color: t.textPrimary, size: 24),
      ),

      // Bottom Navigation
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: t.surfaceLevel1,
        selectedItemColor: t.brandPrimary,
        unselectedItemColor: t.textMuted,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
        landscapeLayout: BottomNavigationBarLandscapeLayout.centered,
        selectedLabelStyle: AppTypography.labelSmall(t),
        unselectedLabelStyle: AppTypography.labelSmall(t),
      ),

      // Floating Action Button
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: t.brandPrimary,
        foregroundColor: t.brandPrimaryOn,
        elevation: 0,
        shape: const CircleBorder(),
        focusElevation: 2,
        hoverElevation: 1,
      ),

      // Card
      cardTheme: CardThemeData(
        color: t.surfaceLevel1,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shadowColor: t.shadowSoft,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.radiusCard),
          side: BorderSide(color: t.borderSubtle, width: 1),
        ),
        margin: EdgeInsets.zero,
      ),

      // Elevated Button — Primary CTA
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: t.brandPrimary,
          foregroundColor: t.brandPrimaryOn,
          elevation: 0,
          shadowColor: t.shadowGoldGlow,
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.xl,
            vertical: Spacing.md,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.round),
          ),
          textStyle: AppTypography.labelLarge(t),
          minimumSize: const Size(48, 48),
        ).copyWith(
          overlayColor: WidgetStateProperty.resolveWith<Color?>((states) {
            if (states.contains(WidgetState.pressed)) {
              return t.brandPrimaryOn.withValues(alpha: 0.1);
            }
            if (states.contains(WidgetState.hovered)) {
              return t.brandPrimaryOn.withValues(alpha: 0.05);
            }
            return null;
          }),
        ),
      ),

      // Outlined Button — Secondary CTA
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: t.brandPrimary,
          side: BorderSide(color: t.brandPrimary, width: 1.5),
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.xl,
            vertical: Spacing.md,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.round),
          ),
          textStyle: AppTypography.labelLarge(t).copyWith(color: t.brandPrimary),
          minimumSize: const Size(48, 48),
        ).copyWith(
          backgroundColor: WidgetStateProperty.resolveWith<Color?>((states) {
            if (states.contains(WidgetState.pressed)) {
              return t.brandPrimary.withValues(alpha: 0.1);
            }
            if (states.contains(WidgetState.hovered)) {
              return t.brandPrimary.withValues(alpha: 0.05);
            }
            return null;
          }),
        ),
      ),

      // Text Button — Ghost/Tertiary CTA
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: t.brandSecondary,
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.lg,
            vertical: Spacing.sm,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.round),
          ),
          textStyle: AppTypography.labelLarge(t).copyWith(color: t.brandSecondary),
          minimumSize: const Size(48, 48),
        ),
      ),

      // Input Decoration
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: t.surfaceVariant,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: Spacing.xl,
          vertical: Spacing.md,
        ),
        labelStyle: AppTypography.bodyMedium(t).copyWith(color: t.textSecondary),
        hintStyle: AppTypography.bodyMedium(t).copyWith(color: t.textMuted),
        floatingLabelStyle: AppTypography.bodyMedium(t).copyWith(color: t.brandPrimary),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.radiusControl),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.radiusControl),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.radiusControl),
          borderSide: BorderSide(color: t.borderFocus, width: 1.8),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.radiusControl),
          borderSide: BorderSide(color: t.error, width: 1.5),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.radiusControl),
          borderSide: BorderSide(color: t.error, width: 2),
        ),
        disabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.radiusControl),
          borderSide: BorderSide(color: t.borderSubtle, width: 1),
        ),
      ),

      // Chip
      chipTheme: ChipThemeData(
        backgroundColor: t.surfaceVariant,
        selectedColor: t.brandPrimary.withValues(alpha: 0.15),
        disabledColor: t.n100,
        padding: const EdgeInsets.symmetric(
          horizontal: Spacing.md,
          vertical: Spacing.xs,
        ),
        labelStyle: AppTypography.bodySmall(t),
        secondaryLabelStyle: AppTypography.bodySmall(t).copyWith(color: t.brandPrimary),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.pill),
          side: BorderSide(color: t.borderSubtle),
        ),
        side: BorderSide(color: t.borderSubtle),
        labelPadding: EdgeInsets.zero,
      ),

      // Divider
      dividerTheme: DividerThemeData(
        color: t.borderSubtle,
        thickness: 1,
        space: 1,
        indent: 0,
        endIndent: 0,
      ),

      // List Tile
      listTileTheme: ListTileThemeData(
        contentPadding: const EdgeInsets.symmetric(
          horizontal: Spacing.lg,
          vertical: Spacing.xs,
        ),
        titleTextStyle: AppTypography.titleMedium(t),
        subtitleTextStyle: AppTypography.bodySmall(t),
        leadingAndTrailingTextStyle: AppTypography.bodyMedium(t),
        iconColor: t.textSecondary,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.lg),
        ),
        tileColor: Colors.transparent,
        selectedTileColor: t.brandPrimary.withValues(alpha: 0.08),
        selectedColor: t.brandPrimary,
      ),

      // Dialog
      dialogTheme: DialogThemeData(
        backgroundColor: t.surfaceLevel1,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shadowColor: t.shadowStrong,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.xxxl),
        ),
        titleTextStyle: AppTypography.headlineSmall(t),
        contentTextStyle: AppTypography.bodyMedium(t),
        alignment: Alignment.center,
      ),

      // Bottom Sheet
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: t.surfaceLevel1,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shadowColor: t.shadowStrong,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(Radii.xxxl),
            topRight: Radius.circular(Radii.xxxl),
          ),
        ),
        clipBehavior: Clip.antiAlias,
        constraints: const BoxConstraints(minWidth: double.infinity),
        modalBackgroundColor: t.surfaceOverlay,
      ),

      // SnackBar
      snackBarTheme: SnackBarThemeData(
        backgroundColor: t.textPrimary,
        contentTextStyle: AppTypography.bodyMedium(t).copyWith(color: t.textInverse),
        actionTextColor: t.brandPrimary,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.xl),
        ),
        elevation: 0,
      ),

      // Tab Bar
      tabBarTheme: TabBarThemeData(
        labelColor: t.brandPrimary,
        unselectedLabelColor: t.textMuted,
        indicatorColor: t.brandPrimary,
        indicatorSize: TabBarIndicatorSize.label,
        labelStyle: AppTypography.labelMedium(t),
        unselectedLabelStyle: AppTypography.labelMedium(t),
        dividerColor: Colors.transparent,
        overlayColor: WidgetStateProperty.resolveWith<Color?>((states) {
          if (states.contains(WidgetState.pressed)) {
            return t.brandPrimary.withValues(alpha: 0.1);
          }
          return null;
        }),
      ),

      // Progress Indicator
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: t.brandPrimary,
        linearTrackColor: t.n200,
        circularTrackColor: t.n200,
      ),

      // Slider
      sliderTheme: SliderThemeData(
        activeTrackColor: t.brandPrimary,
        inactiveTrackColor: t.n200,
        thumbColor: t.brandPrimary,
        overlayColor: t.brandPrimary.withValues(alpha: 0.15),
        valueIndicatorColor: t.brandPrimary,
        valueIndicatorTextStyle: AppTypography.labelSmall(t).copyWith(color: t.brandPrimaryOn),
        trackHeight: 4,
      ),

      // Switch
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith<Color>((states) {
          if (states.contains(WidgetState.selected)) return t.brandPrimary;
          return t.n400;
        }),
        trackColor: WidgetStateProperty.resolveWith<Color>((states) {
          if (states.contains(WidgetState.selected)) {
            return t.brandPrimary.withValues(alpha: 0.5);
          }
          return t.n300;
        }),
        trackOutlineColor: WidgetStateProperty.resolveWith<Color?>((states) {
          return null;
        }),
      ),

      // Checkbox
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith<Color>((states) {
          if (states.contains(WidgetState.selected)) return t.brandPrimary;
          return Colors.transparent;
        }),
        checkColor: WidgetStateProperty.all(t.brandPrimaryOn),
        side: BorderSide(color: t.borderDefault, width: 1.5),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.sm),
        ),
        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        visualDensity: VisualDensity.compact,
      ),

      // Radio
      radioTheme: RadioThemeData(
        fillColor: WidgetStateProperty.resolveWith<Color>((states) {
          if (states.contains(WidgetState.selected)) return t.brandPrimary;
          return t.n400;
        }),
      ),

      // Tooltip
      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: t.textPrimary,
          borderRadius: BorderRadius.circular(Radii.md),
          boxShadow: AppShadow.card(t),
        ),
        textStyle: AppTypography.bodySmall(t).copyWith(color: t.textInverse),
        padding: const EdgeInsets.symmetric(
          horizontal: Spacing.md,
          vertical: Spacing.sm,
        ),
        preferBelow: true,
        verticalOffset: 8,
      ),

      // Extensions para acceso fácil a tokens custom
      extensions: const <ThemeExtension<dynamic>>[
        GlowTokensExtension(token: t),
        GlowIconThemeExtension(isMenMode: false),
      ],
    );
  }

  /// Dark Theme — Men Expression (default)
  static ThemeData dark() {
    const t = Token.dark;

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: ColorScheme.dark(
        primary: t.brandPrimary,
        onPrimary: t.brandPrimaryOn,
        secondary: t.brandSecondary,
        onSecondary: t.brandSecondaryOn,
        tertiary: t.brandTertiary,
        onTertiary: t.brandTertiaryOn,
        surface: t.surfaceLevel1,
        onSurface: t.textPrimary,
        surfaceContainerHighest: t.surfaceContainer,
        outline: t.borderDefault,
        outlineVariant: t.borderSubtle,
        error: t.error,
        onError: t.errorOn,
        errorContainer: t.errorBg,
        onErrorContainer: t.errorOn,
      ),
      scaffoldBackgroundColor: t.surfaceLevel0,
      cardColor: t.surfaceLevel1,
      dividerColor: t.borderSubtle,
      shadowColor: t.shadowSoft,

      appBarTheme: AppBarTheme(
        backgroundColor: t.surfaceLevel1,
        foregroundColor: t.textPrimary,
        elevation: 0,
        centerTitle: false,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: AppTypography.headlineMedium(t),
        iconTheme: IconThemeData(color: t.textPrimary, size: 24),
        actionsIconTheme: IconThemeData(color: t.textPrimary, size: 24),
      ),

      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: t.surfaceLevel1,
        selectedItemColor: t.brandPrimary,
        unselectedItemColor: t.textMuted,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
        selectedLabelStyle: AppTypography.labelSmall(t),
        unselectedLabelStyle: AppTypography.labelSmall(t),
      ),

      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: t.brandPrimary,
        foregroundColor: t.brandPrimaryOn,
        elevation: 0,
        shape: const CircleBorder(),
        focusElevation: 2,
        hoverElevation: 1,
      ),

      cardTheme: CardThemeData(
        color: t.surfaceLevel1,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shadowColor: t.shadowSoft,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.radiusCard),
          side: BorderSide(color: t.borderSubtle, width: 1),
        ),
        margin: EdgeInsets.zero,
      ),

      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: t.brandPrimary,
          foregroundColor: t.brandPrimaryOn,
          elevation: 0,
          shadowColor: t.shadowChampagneGlow,
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.xl,
            vertical: Spacing.md,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.round),
          ),
          textStyle: AppTypography.labelLarge(t),
          minimumSize: const Size(48, 48),
        ).copyWith(
          overlayColor: WidgetStateProperty.resolveWith<Color?>((states) {
            if (states.contains(WidgetState.pressed)) {
              return t.brandPrimaryOn.withValues(alpha: 0.1);
            }
            if (states.contains(WidgetState.hovered)) {
              return t.brandPrimaryOn.withValues(alpha: 0.05);
            }
            return null;
          }),
        ),
      ),

      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: t.brandPrimary,
          side: BorderSide(color: t.brandPrimary, width: 1.5),
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.xl,
            vertical: Spacing.md,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.round),
          ),
          textStyle: AppTypography.labelLarge(t).copyWith(color: t.brandPrimary),
          minimumSize: const Size(48, 48),
        ).copyWith(
          backgroundColor: WidgetStateProperty.resolveWith<Color?>((states) {
            if (states.contains(WidgetState.pressed)) {
              return t.brandPrimary.withValues(alpha: 0.1);
            }
            if (states.contains(WidgetState.hovered)) {
              return t.brandPrimary.withValues(alpha: 0.05);
            }
            return null;
          }),
        ),
      ),

      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: t.brandSecondary,
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.lg,
            vertical: Spacing.sm,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.round),
          ),
          textStyle: AppTypography.labelLarge(t).copyWith(color: t.brandSecondary),
          minimumSize: const Size(48, 48),
        ),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: t.surfaceVariant,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: Spacing.xl,
          vertical: Spacing.md,
        ),
        labelStyle: AppTypography.bodyMedium(t).copyWith(color: t.textSecondary),
        hintStyle: AppTypography.bodyMedium(t).copyWith(color: t.textMuted),
        floatingLabelStyle: AppTypography.bodyMedium(t).copyWith(color: t.brandPrimary),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.radiusControl),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.radiusControl),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.radiusControl),
          borderSide: BorderSide(color: t.borderFocus, width: 1.8),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.radiusControl),
          borderSide: BorderSide(color: t.error, width: 1.5),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.radiusControl),
          borderSide: BorderSide(color: t.error, width: 2),
        ),
        disabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.radiusControl),
          borderSide: BorderSide(color: t.borderSubtle, width: 1),
        ),
      ),

      chipTheme: ChipThemeData(
        backgroundColor: t.surfaceVariant,
        selectedColor: t.brandPrimary.withValues(alpha: 0.2),
        disabledColor: t.n800,
        padding: const EdgeInsets.symmetric(
          horizontal: Spacing.md,
          vertical: Spacing.xs,
        ),
        labelStyle: AppTypography.bodySmall(t),
        secondaryLabelStyle: AppTypography.bodySmall(t).copyWith(color: t.brandPrimary),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.pill),
          side: BorderSide(color: t.borderSubtle),
        ),
        side: BorderSide(color: t.borderSubtle),
        labelPadding: EdgeInsets.zero,
      ),

      dividerTheme: DividerThemeData(
        color: t.borderSubtle,
        thickness: 1,
        space: 1,
      ),

      listTileTheme: ListTileThemeData(
        contentPadding: const EdgeInsets.symmetric(
          horizontal: Spacing.lg,
          vertical: Spacing.xs,
        ),
        titleTextStyle: AppTypography.titleMedium(t),
        subtitleTextStyle: AppTypography.bodySmall(t),
        iconColor: t.textSecondary,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.lg),
        ),
        tileColor: Colors.transparent,
        selectedTileColor: t.brandPrimary.withValues(alpha: 0.12),
        selectedColor: t.brandPrimary,
      ),

      dialogTheme: DialogThemeData(
        backgroundColor: t.surfaceLevel1,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shadowColor: t.shadowStrong,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.xxxl),
        ),
        titleTextStyle: AppTypography.headlineSmall(t),
        contentTextStyle: AppTypography.bodyMedium(t),
        alignment: Alignment.center,
      ),

      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: t.surfaceLevel1,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shadowColor: t.shadowStrong,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.xxxl)),
        ),
        modalBackgroundColor: t.surfaceOverlay,
      ),

      snackBarTheme: SnackBarThemeData(
        backgroundColor: t.n100,
        contentTextStyle: AppTypography.bodyMedium(t).copyWith(color: t.textPrimary),
        actionTextColor: t.brandPrimary,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.xl),
        ),
        elevation: 0,
      ),

      tabBarTheme: TabBarThemeData(
        labelColor: t.brandPrimary,
        unselectedLabelColor: t.textMuted,
        indicatorColor: t.brandPrimary,
        indicatorSize: TabBarIndicatorSize.label,
        labelStyle: AppTypography.labelMedium(t),
        unselectedLabelStyle: AppTypography.labelMedium(t),
        dividerColor: Colors.transparent,
      ),

      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: t.brandPrimary,
        linearTrackColor: t.n800,
        circularTrackColor: t.n800,
      ),

      sliderTheme: SliderThemeData(
        activeTrackColor: t.brandPrimary,
        inactiveTrackColor: t.n700,
        thumbColor: t.brandPrimary,
        overlayColor: t.brandPrimary.withValues(alpha: 0.15),
        valueIndicatorColor: t.brandPrimary,
        valueIndicatorTextStyle: AppTypography.labelSmall(t).copyWith(color: t.brandPrimaryOn),
        trackHeight: 4,
      ),

      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith<Color>((states) {
          if (states.contains(WidgetState.selected)) return t.brandPrimary;
          return t.n500;
        }),
        trackColor: WidgetStateProperty.resolveWith<Color>((states) {
          if (states.contains(WidgetState.selected)) {
            return t.brandPrimary.withValues(alpha: 0.5);
          }
          return t.n700;
        }),
        trackOutlineColor: WidgetStateProperty.resolveWith<Color?>((states) {
          return null;
        }),
      ),

      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith<Color>((states) {
          if (states.contains(WidgetState.selected)) return t.brandPrimary;
          return Colors.transparent;
        }),
        checkColor: WidgetStateProperty.all(t.brandPrimaryOn),
        side: BorderSide(color: t.borderDefault, width: 1.5),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.sm),
        ),
        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        visualDensity: VisualDensity.compact,
      ),

      radioTheme: RadioThemeData(
        fillColor: WidgetStateProperty.resolveWith<Color>((states) {
          if (states.contains(WidgetState.selected)) return t.brandPrimary;
          return t.n500;
        }),
      ),

      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: t.textPrimary,
          borderRadius: BorderRadius.circular(Radii.md),
          boxShadow: AppShadow.card(t),
        ),
        textStyle: AppTypography.bodySmall(t).copyWith(color: t.textInverse),
        padding: const EdgeInsets.symmetric(
          horizontal: Spacing.md,
          vertical: Spacing.sm,
        ),
        preferBelow: true,
        verticalOffset: 8,
      ),

      // Extensions
      extensions: const <ThemeExtension<dynamic>>[
        GlowTokensExtension(token: t),
        GlowIconThemeExtension(isMenMode: true),
      ],
    );
  }

  /// Expression-aware theme (Women/Men/AURA)
  static ThemeData expression({required Expression expression, Brightness? brightness}) {
    final isDark = brightness != null ? brightness == Brightness.dark : false;
    
    switch (expression) {
      case Expression.women:
        return isDark ? _womenDark() : light();
      case Expression.men:
        return isDark ? dark() : _menLight();
      case Expression.aura:
        return _auraTheme();
      case Expression.neutral:
        return isDark ? _neutralDark() : _neutralLight();
    }
  }

  static ThemeData _menLight() {
    final t = Token.lightMenToken;
    return _buildTheme(t, Brightness.light, isMenMode: true);
  }

  static ThemeData _womenDark() {
    final t = Token.darkWomenToken;
    return _buildTheme(t, Brightness.dark, isMenMode: false);
  }

  static ThemeData _auraTheme() {
    final t = Token.auraTokenInstance;
    return _buildTheme(t, Brightness.light, isMenMode: false);
  }

  static ThemeData _neutralLight() {
    // Neutral light uses women tokens but with gold871 as primary
    final t = Token(
      brightness: Brightness.light,
      expression: Expression.neutral,
      brandPrimary: Token.gold871,
      brandPrimaryOn: const Color(0xFF2B2420),
      brandSecondary: Token.roseGold,
      brandSecondaryOn: Colors.white,
      brandTertiary: Token.copper,
      brandTertiaryOn: Colors.white,
      neutral: Token.neutralLightMap,
      status: Token.statusLightMap,
      primaryGradient: Token.primaryGradientLight,
      roseGoldSatin: Token.roseGoldSatinLight,
      terracottaMatte: Token.terracottaMatteLight,
      premiumGradient: Token.premiumGradientLight,
      goldGradientMen: Token.goldGradientMenValue,
      obsidianGlassGradient: Token.obsidianGlassGradientValue,
      auraGradient: Token.auraGradientValue,
      scrimBottom: Token.scrimBottomValue,
      surfaceLevel0: Token.creamSilk,
      surfaceLevel1: Colors.white,
      surfaceLevel2: const Color(0xD9F4EFEA),
      surfaceLevel3: Token.gold871,
      surfaceVariant: const Color(0xFFF5EBE6),
      surfaceContainer: const Color(0xFFF4EFEA),
      surfaceOverlay: const Color(0x80000000),
      surfaceGlass: const Color(0xCCFFFFFF),
      surfaceInput: const Color(0xFFFAF8F5),
      surfaceSelected: const Color(0x1FC5A052),
      textPrimary: const Color(0xFF2B2420),
      textSecondary: const Color(0xFF857360),
      textMuted: const Color(0xFF9E8C78),
      textDisabled: const Color(0xFFA89F91),
      textInverse: const Color(0xFFFAF8F5),
      textAccent: Token.gold871,
      textAura: Token.auraTeal,
      borderDefault: const Color(0xFFE8E0D5),
      borderSubtle: const Color(0xFFF3EAE8),
      borderStrong: Token.gold871,
      borderFocus: Token.gold871,
      borderSelected: Token.gold871,
      interactionHover: const Color(0x0D2B2420),
      interactionPressed: const Color(0x1A2B2420),
      interactionFocus: Token.gold871,
      interactionSelected: const Color(0x1FC5A052),
      interactionDisabledBg: const Color(0xFFF0ECE6),
      interactionDisabledText: const Color(0xFFA89F91),
      shadowSoft: const Color(0x0A000000),
      shadowMedium: const Color(0x0A000000),
      shadowStrong: const Color(0x1A000000),
      shadowGoldGlow: const Color(0x2EC5A052),
      shadowChampagneGlow: const Color(0x4DD4AF37),
      shadowAura: const Color(0x33164C46),
      shadowDrawer: const Color(0x14000000),
    );
    return _buildTheme(t, Brightness.light, isMenMode: false);
  }

  static ThemeData _neutralDark() {
    // Neutral dark uses men tokens but with gold871 as primary
    final t = Token(
      brightness: Brightness.dark,
      expression: Expression.neutral,
      brandPrimary: Token.gold871,
      brandPrimaryOn: const Color(0xFF1C1917),
      brandSecondary: Token.champagneMen,
      brandSecondaryOn: const Color(0xFF1C1917),
      brandTertiary: Token.copper,
      brandTertiaryOn: const Color(0xFF1C1917),
      neutral: Token.neutralDarkMap,
      status: Token.statusDarkMap,
      primaryGradient: Token.primaryGradientDark,
      roseGoldSatin: Token.roseGoldSatinDark,
      terracottaMatte: Token.terracottaMatteDark,
      premiumGradient: Token.premiumGradientDark,
      goldGradientMen: Token.goldGradientMenValue,
      obsidianGlassGradient: Token.obsidianGlassGradientValue,
      auraGradient: Token.auraGradientValue,
      scrimBottom: Token.scrimBottomValue,
      surfaceLevel0: const Color(0xFF18171C),
      surfaceLevel1: const Color(0xFF24232B),
      surfaceLevel2: const Color(0xD924232B),
      surfaceLevel3: Token.gold871,
      surfaceVariant: const Color(0xFF4A3E3D),
      surfaceContainer: const Color(0xFF3D3330),
      surfaceOverlay: const Color(0xBF000000),
      surfaceGlass: const Color(0xD924232B),
      surfaceInput: const Color(0xFF2D2523),
      surfaceSelected: const Color(0x1FC5A052),
      textPrimary: const Color(0xFFFAF8F5),
      textSecondary: const Color(0xFFAD8272),
      textMuted: const Color(0xFFC5A090),
      textDisabled: const Color(0xFF6B5E5A),
      textInverse: Token.obsidianBg,
      textAccent: Token.gold871,
      textAura: Token.auraTeal,
      borderDefault: const Color(0xFF33313D),
      borderSubtle: const Color(0xFF2A2830),
      borderStrong: Token.gold871,
      borderFocus: Token.gold871,
      borderSelected: Token.gold871,
      interactionHover: const Color(0x0DFFFFFF),
      interactionPressed: const Color(0x1AFFFFFF),
      interactionFocus: Token.gold871,
      interactionSelected: const Color(0x1FC5A052),
      interactionDisabledBg: const Color(0xFF4A3E3D),
      interactionDisabledText: const Color(0xFF6B5E5A),
      shadowSoft: const Color(0x0A000000),
      shadowMedium: const Color(0x0A000000),
      shadowStrong: const Color(0x33000000),
      shadowGoldGlow: const Color(0x2EC5A052),
      shadowChampagneGlow: const Color(0x4DD4AF37),
      shadowAura: const Color(0x33164C46),
      shadowDrawer: const Color(0x14000000),
    );
    return _buildTheme(t, Brightness.dark, isMenMode: true);
  }

  static ThemeData _buildTheme(Token t, Brightness brightness, {bool isMenMode = false}) {
    final isDark = brightness == Brightness.dark;
    
    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: ColorScheme(
        brightness: brightness,
        primary: t.brandPrimary,
        onPrimary: t.brandPrimaryOn,
        secondary: t.brandSecondary,
        onSecondary: t.brandSecondaryOn,
        tertiary: t.brandTertiary,
        onTertiary: t.brandTertiaryOn,
        error: t.error,
        onError: t.errorOn,
        errorContainer: t.errorBg,
        onErrorContainer: t.errorOn,
        surface: t.surfaceLevel1,
        onSurface: t.textPrimary,
        surfaceContainerHighest: t.surfaceContainer,
        outline: t.borderDefault,
        outlineVariant: t.borderSubtle,
        shadow: t.shadowSoft,
        inverseSurface: t.surfaceLevel0,
        onInverseSurface: t.textInverse,
        inversePrimary: t.brandPrimary,
      ),
      scaffoldBackgroundColor: t.surfaceLevel0,
      cardColor: t.surfaceLevel1,
      dividerColor: t.borderSubtle,
      shadowColor: t.shadowSoft,

      appBarTheme: AppBarTheme(
        backgroundColor: t.surfaceLevel1,
        foregroundColor: t.textPrimary,
        elevation: 0,
        centerTitle: false,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: AppTypography.headlineMedium(t),
        iconTheme: IconThemeData(color: t.textPrimary, size: 24),
        actionsIconTheme: IconThemeData(color: t.textPrimary, size: 24),
      ),

      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: t.surfaceLevel1,
        selectedItemColor: t.brandPrimary,
        unselectedItemColor: t.textMuted,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
        selectedLabelStyle: AppTypography.labelSmall(t),
        unselectedLabelStyle: AppTypography.labelSmall(t),
      ),

      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: t.brandPrimary,
        foregroundColor: t.brandPrimaryOn,
        elevation: 0,
        shape: const CircleBorder(),
        focusElevation: 2,
        hoverElevation: 1,
      ),

      cardTheme: CardThemeData(
        color: t.surfaceLevel1,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shadowColor: t.shadowSoft,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.radiusCard),
          side: BorderSide(color: t.borderSubtle, width: 1),
        ),
        margin: EdgeInsets.zero,
      ),

      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: t.brandPrimary,
          foregroundColor: t.brandPrimaryOn,
          elevation: 0,
          shadowColor: isDark ? t.shadowChampagneGlow : t.shadowGoldGlow,
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.xl,
            vertical: Spacing.md,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.round),
          ),
          textStyle: AppTypography.labelLarge(t),
          minimumSize: const Size(48, 48),
        ).copyWith(
          overlayColor: WidgetStateProperty.resolveWith<Color?>((states) {
            if (states.contains(WidgetState.pressed)) {
              return t.brandPrimaryOn.withValues(alpha: 0.1);
            }
            if (states.contains(WidgetState.hovered)) {
              return t.brandPrimaryOn.withValues(alpha: 0.05);
            }
            return null;
          }),
        ),
      ),

      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: t.brandPrimary,
          side: BorderSide(color: t.brandPrimary, width: 1.5),
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.xl,
            vertical: Spacing.md,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.round),
          ),
          textStyle: AppTypography.labelLarge(t).copyWith(color: t.brandPrimary),
          minimumSize: const Size(48, 48),
        ).copyWith(
          backgroundColor: WidgetStateProperty.resolveWith<Color?>((states) {
            if (states.contains(WidgetState.pressed)) {
              return t.brandPrimary.withValues(alpha: 0.1);
            }
            if (states.contains(WidgetState.hovered)) {
              return t.brandPrimary.withValues(alpha: 0.05);
            }
            return null;
          }),
        ),
      ),

      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: t.brandSecondary,
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.lg,
            vertical: Spacing.sm,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.round),
          ),
          textStyle: AppTypography.labelLarge(t).copyWith(color: t.brandSecondary),
          minimumSize: const Size(48, 48),
        ),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: t.surfaceVariant,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: Spacing.xl,
          vertical: Spacing.md,
        ),
        labelStyle: AppTypography.bodyMedium(t).copyWith(color: t.textSecondary),
        hintStyle: AppTypography.bodyMedium(t).copyWith(color: t.textMuted),
        floatingLabelStyle: AppTypography.bodyMedium(t).copyWith(color: t.brandPrimary),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.radiusControl),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.radiusControl),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.radiusControl),
          borderSide: BorderSide(color: t.borderFocus, width: 1.8),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.radiusControl),
          borderSide: BorderSide(color: t.error, width: 1.5),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.radiusControl),
          borderSide: BorderSide(color: t.error, width: 2),
        ),
        disabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.radiusControl),
          borderSide: BorderSide(color: t.borderSubtle, width: 1),
        ),
      ),

      chipTheme: ChipThemeData(
        backgroundColor: t.surfaceVariant,
        selectedColor: t.brandPrimary.withValues(alpha: 0.15),
        disabledColor: isDark ? t.n800 : t.n100,
        padding: const EdgeInsets.symmetric(
          horizontal: Spacing.md,
          vertical: Spacing.xs,
        ),
        labelStyle: AppTypography.bodySmall(t),
        secondaryLabelStyle: AppTypography.bodySmall(t).copyWith(color: t.brandPrimary),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.pill),
          side: BorderSide(color: t.borderSubtle),
        ),
        side: BorderSide(color: t.borderSubtle),
        labelPadding: EdgeInsets.zero,
      ),

      dividerTheme: DividerThemeData(
        color: t.borderSubtle,
        thickness: 1,
        space: 1,
      ),

      listTileTheme: ListTileThemeData(
        contentPadding: const EdgeInsets.symmetric(
          horizontal: Spacing.lg,
          vertical: Spacing.xs,
        ),
        titleTextStyle: AppTypography.titleMedium(t),
        subtitleTextStyle: AppTypography.bodySmall(t),
        leadingAndTrailingTextStyle: AppTypography.bodyMedium(t),
        iconColor: t.textSecondary,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.lg),
        ),
        tileColor: Colors.transparent,
        selectedTileColor: t.brandPrimary.withValues(alpha: isDark ? 0.12 : 0.08),
        selectedColor: t.brandPrimary,
      ),

      dialogTheme: DialogThemeData(
        backgroundColor: t.surfaceLevel1,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shadowColor: t.shadowStrong,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.xxxl),
        ),
        titleTextStyle: AppTypography.headlineSmall(t),
        contentTextStyle: AppTypography.bodyMedium(t),
        alignment: Alignment.center,
      ),

      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: t.surfaceLevel1,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shadowColor: t.shadowStrong,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.xxxl)),
        ),
        modalBackgroundColor: t.surfaceOverlay,
      ),

      snackBarTheme: SnackBarThemeData(
        backgroundColor: isDark ? t.n100 : t.textPrimary,
        contentTextStyle: AppTypography.bodyMedium(t).copyWith(
          color: isDark ? t.textPrimary : t.textInverse),
        actionTextColor: t.brandPrimary,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.xl),
        ),
        elevation: 0,
      ),

      tabBarTheme: TabBarThemeData(
        labelColor: t.brandPrimary,
        unselectedLabelColor: t.textMuted,
        indicatorColor: t.brandPrimary,
        indicatorSize: TabBarIndicatorSize.label,
        labelStyle: AppTypography.labelMedium(t),
        unselectedLabelStyle: AppTypography.labelMedium(t),
        dividerColor: Colors.transparent,
      ),

      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: t.brandPrimary,
        linearTrackColor: isDark ? t.n800 : t.n200,
        circularTrackColor: isDark ? t.n800 : t.n200,
      ),

      sliderTheme: SliderThemeData(
        activeTrackColor: t.brandPrimary,
        inactiveTrackColor: isDark ? t.n700 : t.n200,
        thumbColor: t.brandPrimary,
        overlayColor: t.brandPrimary.withValues(alpha: 0.15),
        valueIndicatorColor: t.brandPrimary,
        valueIndicatorTextStyle: AppTypography.labelSmall(t).copyWith(color: t.brandPrimaryOn),
        trackHeight: 4,
      ),

      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith<Color>((states) {
          if (states.contains(WidgetState.selected)) return t.brandPrimary;
          return isDark ? t.n500 : t.n400;
        }),
        trackColor: WidgetStateProperty.resolveWith<Color>((states) {
          if (states.contains(WidgetState.selected)) {
            return t.brandPrimary.withValues(alpha: 0.5);
          }
          return isDark ? t.n700 : t.n300;
        }),
        trackOutlineColor: WidgetStateProperty.resolveWith<Color?>((states) {
          return null;
        }),
      ),

      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith<Color>((states) {
          if (states.contains(WidgetState.selected)) return t.brandPrimary;
          return Colors.transparent;
        }),
        checkColor: WidgetStateProperty.all(t.brandPrimaryOn),
        side: BorderSide(color: t.borderDefault, width: 1.5),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.sm),
        ),
        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        visualDensity: VisualDensity.compact,
      ),

      radioTheme: RadioThemeData(
        fillColor: WidgetStateProperty.resolveWith<Color>((states) {
          if (states.contains(WidgetState.selected)) return t.brandPrimary;
          return isDark ? t.n500 : t.n400;
        }),
      ),

      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: t.textPrimary,
          borderRadius: BorderRadius.circular(Radii.md),
          boxShadow: AppShadow.card(t),
        ),
        textStyle: AppTypography.bodySmall(t).copyWith(color: t.textInverse),
        padding: const EdgeInsets.symmetric(
          horizontal: Spacing.md,
          vertical: Spacing.sm,
        ),
        preferBelow: true,
        verticalOffset: 8,
      ),

      extensions: <ThemeExtension<dynamic>>[
        GlowTokensExtension(token: t),
        GlowIconThemeExtension(isMenMode: isMenMode),
      ],
    );
  }
}