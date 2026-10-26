/// GlowIcon — Main consumer API for GlowApp iconography
///
/// Provides semantic access to icons without exposing implementation details.
/// Integrates with existing theming system (Token, GlowStoreTokens, MensTheme).
///
/// Usage:
///   GlowIcon.search(size: 24, color: context.colors.primary)
///   GlowIcon.aura(size: 28)
///   GlowIcon.home(size: 20, semanticLabel: 'Inicio')
library glow_icon;

import 'package:flutter/material.dart';
import '../../core/theme/tokens.dart';
import 'glow_icon_registry.dart';

/// Semantic icon sizes aligned with design system.
class GlowIconSize {
  GlowIconSize._();

  static const double xs = 16.0;
  static const double sm = 20.0;
  static const double md = 24.0; // Standard interaction size
  static const double lg = 28.0;
  static const double xl = 32.0;
  static const double xxl = 40.0;
  static const double huge = 48.0;
}

/// Semantic icon weights/stroke variants.
class GlowIconWeight {
  GlowIconWeight._();

  static const double light = 1.5;
  static const double regular = 1.75;
  static const double bold = 2.0;
}

/// Semantic color roles for icons.
enum GlowIconColorRole {
  /// Primary action color (Rose Gold for Women, Champagne for Men)
  primary,
  /// Secondary/tertiary color (Warm Brown for Women, Warm White/Sand for Men)
  secondary,
  /// Accent color (Champagne for Women, Copper for Men)
  accent,
  /// AURA intelligence color (Aura Teal)
  aura,
  /// Error/destructive
  error,
  /// Success/positive
  success,
  /// Warning/caution
  warning,
  /// Neutral/on-surface
  neutral,
  /// Disabled/inactive
  disabled,
}

/// Main GlowIcon API — semantic access to icons.
///
/// All icons resolve through [GlowIconRegistry] for implementation flexibility.
class GlowIcon {
  GlowIcon._();

  /// Resolve and build an icon by semantic name.
  ///
  /// [size] - Visual size of the icon (default: 24)
  /// [color] - Explicit color override (optional)
  /// [colorRole] - Semantic color role (resolved via theme if [color] not provided)
  /// [semanticLabel] - Accessibility label
  /// [strokeWidth] - Stroke weight override (default: 1.75)
  /// [weight] - Semantic weight variant
  static Widget resolve(
    String semanticName, {
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) {
    final iconData = GlowIconRegistry.resolve(semanticName);

    if (iconData == null) {
      // Fallback to Material Icons for unmigrated icons
      return _materialFallback(semanticName, size, color, semanticLabel);
    }

    final effectiveColor = color ??
        (colorRole != null
            ? _resolveColorRole(colorRole)
            : null);

    return iconData.build(
      size: size,
      color: effectiveColor ?? _defaultColor(),
      semanticLabel: semanticLabel,
      strokeWidth: strokeWidth ?? weight?.toDouble() ?? iconData.defaultStrokeWidth,
    );
  }

  /// Resolve color from semantic role using current theme context.
  /// This is a placeholder - in practice, consumers should pass explicit colors
  /// or use a BuildContext extension.
  static Color? _resolveColorRole(GlowIconColorRole role) {
    // This would need BuildContext - see extension below
    return null;
  }

  static Color _defaultColor() => const Color(0xFF1C1917); // LuxeColors.nude900

  // =========================================================================
  // CORE ICONS (16 P0 icons)
  // =========================================================================

  static Widget home({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('home',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Inicio',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget search({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('search',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Buscar',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget menu({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('menu',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Menú',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget close({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('close',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Cerrar',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget back({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('back',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Atrás',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget forward({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('forward',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Adelante',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget more({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('more',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Más opciones',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget profile({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('profile',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Perfil',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget heart({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('heart',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Favorito',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget bag({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('bag',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Bolsa',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget cart({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('cart',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Carrito',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget calendar({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('calendar',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Calendario',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget clock({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('clock',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Reloj',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget location({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('location',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Ubicación',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget settings({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('settings',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Ajustes',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget notification({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('notification',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Notificaciones',
          strokeWidth: strokeWidth,
          weight: weight);

  // =========================================================================
  // PROPRIETARY ICONS (6 I1 icons)
  // =========================================================================

  static Widget glow({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('glow',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Glow',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget aura({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('aura',
          size: size,
          color: color,
          colorRole: colorRole ?? GlowIconColorRole.aura,
          semanticLabel: semanticLabel ?? 'Aura',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget concierge({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('concierge',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Concierge',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget beautyRitual({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('beauty_ritual',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Ritual de belleza',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget glowRecommendation({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('glow_recommendation',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Recomendación Glow',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget maleGrooming({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('male_grooming',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Grooming masculino',
          strokeWidth: strokeWidth,
          weight: weight);

  // =========================================================================
  // BEAUTY EXTENDED ICONS (8 I2-A icons)
  // =========================================================================

  static Widget skincare({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('skincare',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Cuidado de la piel',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget hair({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('hair',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Cabello',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget nails({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('nails',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Manicure',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget makeup({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('makeup',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Maquillaje',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget fragrance({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('fragrance',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Fragancia',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget body({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('body',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Cuidado corporal',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget wellness({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('wellness',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Bienestar',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget spa({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('spa',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Spa',
          strokeWidth: strokeWidth,
          weight: weight);

  // =========================================================================
  // MEN EXTENDED ICONS (5 I2-B icons)
  // =========================================================================

  static Widget beard({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('beard',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Barba',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget shave({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('shave',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Afeitado',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget scalp({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('scalp',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Cuero cabelludo',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget mensFragrance({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('mens_fragrance',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Fragancia masculina',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget mensBody({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('mens_body',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Cuidado corporal masculino',
          strokeWidth: strokeWidth,
          weight: weight);

  // =========================================================================
  // CONCIERGE EXTENDED ICONS (4 I2-C icons)
  // =========================================================================

  static Widget booking({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('booking',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Reserva',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget chat({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('chat',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Chat',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget wishlist({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('wishlist',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Lista de deseos',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget support({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('support',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Soporte',
          strokeWidth: strokeWidth,
          weight: weight);

  // =========================================================================
  // AURA EXTENDED ICONS (6 I2-D icons)
  // =========================================================================

  static Widget scan({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('scan',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Escanear',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget analyze({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('analyze',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Analizar',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget learn({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('learn',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Aprender',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget wallet({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('wallet',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Billetera',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget school({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('school',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Escuela',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget predict({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('predict',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Predecir',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget evolve({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('evolve',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Evolucionar',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget sync({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('sync',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Sincronizar',
          strokeWidth: strokeWidth,
          weight: weight);

  // =========================================================================
  // SYSTEM EXTENDED ICONS (6 I2-E icons)
  // =========================================================================

  static Widget share({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('share',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Compartir',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget download({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('download',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Descargar',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget upload({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('upload',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Subir',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget filter({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('filter',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Filtrar',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget sort({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('sort',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Ordenar',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget qr({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('qr',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Código QR',
          strokeWidth: strokeWidth,
          weight: weight);

  // =========================================================================
  // NEW ICONS FOR BOOKING / PROVIDER DETAIL / LOGIN
  // =========================================================================

  static Widget note({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('note',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Nota',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget check({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('check',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Verificado',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget radioSelected({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('radio_selected',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Seleccionado',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget radioUnselected({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('radio_unselected',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'No seleccionado',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget plus({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('plus',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Añadir',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget minus({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('minus',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Quitar',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget security({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('security',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Seguridad',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget verified({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('verified',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Verificado',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget person({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('person',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Persona',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget contentCut({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('content_cut',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Corte de cabello',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget brush({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('brush',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Uñas',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget face({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('face',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Maquillaje',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget faceRetouching({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('face_retouching',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Barbería',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget style({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('style',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Estilo',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget photo({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('photo',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Foto',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget email({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('email',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Correo',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget lock({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('lock',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Contraseña',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget visibility({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('visibility',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Ver contraseña',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget visibilityOff({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('visibility_off',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Ocultar contraseña',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget star({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('star',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Estrella',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget google({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('google',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Google',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget outlook({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('outlook',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Outlook',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget apple({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('apple',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Apple',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget localOffer({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('local_offer',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Oferta local',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget peopleAlt({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('people_alt',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Personas',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget chevronLeft({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('chevron_left',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Anterior',
          strokeWidth: strokeWidth,
          weight: weight);

  static Widget chevronRight({
    double size = GlowIconSize.md,
    Color? color,
    GlowIconColorRole? colorRole,
    String? semanticLabel,
    double? strokeWidth,
    GlowIconWeight? weight,
  }) =>
      resolve('chevron_right',
          size: size,
          color: color,
          colorRole: colorRole,
          semanticLabel: semanticLabel ?? 'Siguiente',
          strokeWidth: strokeWidth,
          weight: weight);

  // =========================================================================
  // FALLBACK
  // =========================================================================

  static Widget _materialFallback(
    String name,
    double size,
    Color? color,
    String? semanticLabel,
  ) {
    // Map common semantic names to Material Icons as fallback
    final Map<String, IconData> fallbackMap = {
      'home': Icons.home_rounded,
      'search': Icons.search_rounded,
      'menu': Icons.menu_rounded,
      'close': Icons.close_rounded,
      'back': Icons.arrow_back_rounded,
      'forward': Icons.arrow_forward_rounded,
      'more': Icons.more_horiz_rounded,
      'profile': Icons.person_rounded,
      'heart': Icons.favorite_rounded,
      'bag': Icons.shopping_bag_rounded,
      'cart': Icons.shopping_cart_rounded,
      'calendar': Icons.calendar_today_rounded,
      'clock': Icons.access_time_rounded,
      'location': Icons.location_on_rounded,
      'settings': Icons.settings_rounded,
      'notification': Icons.notifications_rounded,
      'wallet': Icons.account_balance_wallet_rounded,
      'school': Icons.auto_stories_rounded,
      'scan': Icons.camera_front_rounded,
      'learn': Icons.school_rounded,
      'note': Icons.note_alt_outlined,
      'check': Icons.check_rounded,
      'radio_selected': Icons.radio_button_checked_rounded,
      'radio_unselected': Icons.radio_button_off_rounded,
      'plus': Icons.add_rounded,
      'minus': Icons.remove_rounded,
      'security': Icons.security_rounded,
      'verified': Icons.verified_rounded,
      'person': Icons.person_rounded,
      'content_cut': Icons.content_cut_outlined,
      'brush': Icons.brush_outlined,
      'face': Icons.face_outlined,
      'face_retouching': Icons.face_retouching_natural_outlined,
      'style': Icons.style_outlined,
      'photo': Icons.photo_outlined,
      'email': Icons.email_outlined,
      'lock': Icons.lock_outlined,
      'visibility': Icons.visibility_outlined,
      'visibility_off': Icons.visibility_off_outlined,
      'star': Icons.star_rounded,
      'google': Icons.g_mobiledata_rounded,
      'outlook': Icons.mail_outline_rounded,
      'apple': Icons.apple_rounded,
      'chevron_left': Icons.chevron_left_rounded,
      'chevron_right': Icons.chevron_right_rounded,
      'local_offer': Icons.local_offer_rounded,
      'people_alt': Icons.people_alt_outlined,
    };

    final iconData = fallbackMap[name];
    if (iconData != null) {
      return Icon(
        iconData,
        size: size,
        color: color ?? _defaultColor(),
        semanticLabel: semanticLabel,
      );
    }

    // Ultimate fallback
    return Icon(
      Icons.help_outline_rounded,
      size: size,
      color: color ?? _defaultColor(),
      semanticLabel: semanticLabel ?? name,
    );
  }
}

/// ThemeExtension for GlowIcon semantic colors with real audience.
class GlowIconThemeExtension extends ThemeExtension<GlowIconThemeExtension> {
  final bool isMenMode;

  const GlowIconThemeExtension({this.isMenMode = false});

  @override
  GlowIconThemeExtension copyWith({bool? isMenMode}) {
    return GlowIconThemeExtension(isMenMode: isMenMode ?? this.isMenMode);
  }

  @override
  GlowIconThemeExtension lerp(ThemeExtension<GlowIconThemeExtension>? other, double t) {
    if (other is! GlowIconThemeExtension) return this;
    return GlowIconThemeExtension(
      isMenMode: t < 0.5 ? isMenMode : other.isMenMode,
    );
  }

  Color resolveColor(GlowIconColorRole role) {
    final token = isMenMode ? Token.dark : Token.light;

    switch (role) {
      case GlowIconColorRole.primary:
        return token.brandPrimary;
      case GlowIconColorRole.secondary:
        return token.brandSecondary;
      case GlowIconColorRole.accent:
        return token.brandTertiary;
      case GlowIconColorRole.aura:
        return token.textAura;
      case GlowIconColorRole.error:
        return token.error;
      case GlowIconColorRole.success:
        return token.success;
      case GlowIconColorRole.warning:
        return token.warning;
      case GlowIconColorRole.neutral:
        return token.textPrimary;
      case GlowIconColorRole.disabled:
        return token.interactionDisabledText;
    }
  }
}

/// BuildContext convenience extension — delegates to registered ThemeExtension.
extension GlowIconThemeContext on BuildContext {
  Color glowIconColor(GlowIconColorRole role) {
    final ext = Theme.of(this).extension<GlowIconThemeExtension>();
    if (ext != null) {
      return ext.resolveColor(role);
    }

    final token = Token.of(this);

    switch (role) {
      case GlowIconColorRole.primary:
        return token.brandPrimary;
      case GlowIconColorRole.aura:
        return token.textAura;
      case GlowIconColorRole.disabled:
        return token.interactionDisabledText;
      default:
        return token.textPrimary;
    }
  }
}

/// Convenience extension for weight enum.
extension GlowIconWeightExt on GlowIconWeight {
  double toDouble() {
    switch (this) {
      case GlowIconWeight.light:
        return GlowIconWeight.light;
      case GlowIconWeight.regular:
        return GlowIconWeight.regular;
      case GlowIconWeight.bold:
        return GlowIconWeight.bold;
    }
    throw StateError('Unknown GlowIconWeight: $this');
  }
}