/// GlowIcon Migration Adapter
///
/// Provides a transition layer allowing gradual migration from
/// Material Icons / Icons.* to GlowIcon without changing all call sites at once.
///
/// Usage:
///   // Before migration:
///   Icon(Icons.search)
///
///   // After adding adapter (no code change needed at call site):
///   GlowIconAdapter.search()
///
///   // Full migration:
///   GlowIcon.search()
///
/// MIGRADO PASO 6: Internamente usa [colorRole] semántico en lugar de [color] explícito.
/// El parámetro [color] se mantiene para backward compatibility (override manual).
/// Si se proporciona [color], tiene prioridad sobre [colorRole] (comportamiento original).

library glow_icon_adapter;

import 'package:flutter/material.dart';
import 'glow_icon.dart';
import 'glow_icon_registry.dart';

/// Adapter that mimics Material Icons API but resolves through GlowIcon.
///
/// This allows drop-in replacement:
///   Icon(Icons.search)  →  GlowIconAdapter.search()
///   Icon(Icons.home)    →  GlowIconAdapter.home()
///   etc.
class GlowIconAdapter {
  GlowIconAdapter._();

  // =========================================================================
  // CORE ICONS - Direct mapping to GlowIcon semantic names
  // =========================================================================

  static Widget home({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.home(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.primary,
        semanticLabel: semanticLabel,
      );

  static Widget search({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.search(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.primary,
        semanticLabel: semanticLabel,
      );

  static Widget menu({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.menu(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.neutral,
        semanticLabel: semanticLabel,
      );

  static Widget close({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.close(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.neutral,
        semanticLabel: semanticLabel,
      );

  static Widget arrowBack({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.back(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.neutral,
        semanticLabel: semanticLabel,
      );

  static Widget arrowForward({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.forward(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.neutral,
        semanticLabel: semanticLabel,
      );

  static Widget moreHoriz({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.more(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.neutral,
        semanticLabel: semanticLabel,
      );

  static Widget person({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.profile(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.secondary,
        semanticLabel: semanticLabel,
      );

  static Widget favorite({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.heart(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.accent,
        semanticLabel: semanticLabel,
      );

  static Widget shoppingBag({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.bag(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.accent,
        semanticLabel: semanticLabel,
      );

  static Widget shoppingCart({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.cart(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.accent,
        semanticLabel: semanticLabel,
      );

  static Widget calendarToday({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.calendar(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.primary,
        semanticLabel: semanticLabel,
      );

  static Widget accessTime({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.clock(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.neutral,
        semanticLabel: semanticLabel,
      );

  static Widget locationOn({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.location(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.neutral,
        semanticLabel: semanticLabel,
      );

  static Widget settings({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.settings(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.neutral,
        semanticLabel: semanticLabel,
      );

  static Widget notifications({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.notification(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.primary,
        semanticLabel: semanticLabel,
      );

  // =========================================================================
  // PROPRIETARY ICONS - New GlowApp-specific icons
  // =========================================================================

  static Widget glow({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.glow(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.aura,
        semanticLabel: semanticLabel,
      );

  static Widget aura({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.aura(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.aura,
        semanticLabel: semanticLabel,
      );

  static Widget concierge({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.concierge(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.secondary,
        semanticLabel: semanticLabel,
      );

  static Widget beautyRitual({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.beautyRitual(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.accent,
        semanticLabel: semanticLabel,
      );

  static Widget glowRecommendation({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.glowRecommendation(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.aura,
        semanticLabel: semanticLabel,
      );

  static Widget maleGrooming({
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      GlowIcon.maleGrooming(
        size: size ?? 24.0,
        color: color,
        colorRole: color != null ? null : GlowIconColorRole.secondary,
        semanticLabel: semanticLabel,
      );

  // =========================================================================
  // FALLBACK - For any Material Icon not yet migrated
  // =========================================================================

  /// Generic fallback that uses Material Icons for unmapped icons.
  /// Usage: GlowIconAdapter.fallback(Icons.some_icon)
  static Widget fallback(
    IconData iconData, {
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) =>
      Icon(
        iconData,
        key: key,
        size: size,
        color: color,
        semanticLabel: semanticLabel,
        textDirection: textDirection,
      );

  /// Map Material IconData to GlowIcon semantic name (for programmatic migration).
  static String? mapMaterialToSemantic(IconData iconData) {
    // This is a partial map - extend as needed
    final Map<int, String> codePointMap = {
      Icons.home_rounded.codePoint: 'home',
      Icons.search_rounded.codePoint: 'search',
      Icons.menu_rounded.codePoint: 'menu',
      Icons.close_rounded.codePoint: 'close',
      Icons.arrow_back_rounded.codePoint: 'back',
      Icons.arrow_forward_rounded.codePoint: 'forward',
      Icons.more_horiz_rounded.codePoint: 'more',
      Icons.person_rounded.codePoint: 'profile',
      Icons.favorite_rounded.codePoint: 'heart',
      Icons.shopping_bag_rounded.codePoint: 'bag',
      Icons.shopping_cart_rounded.codePoint: 'cart',
      Icons.calendar_today_rounded.codePoint: 'calendar',
      Icons.access_time_rounded.codePoint: 'clock',
      Icons.location_on_rounded.codePoint: 'location',
      Icons.settings_rounded.codePoint: 'settings',
      Icons.notifications_rounded.codePoint: 'notification',
    };

    return codePointMap[iconData.codePoint];
  }

  /// Try to resolve an IconData to GlowIcon, fallback to Material.
  static Widget resolveOrFallback(
    IconData iconData, {
    Key? key,
    double? size,
    Color? color,
    String? semanticLabel,
    TextDirection? textDirection,
  }) {
    final semanticName = mapMaterialToSemantic(iconData);
    if (semanticName != null && GlowIconRegistry.has(semanticName)) {
      return GlowIcon.resolve(
        semanticName,
        size: size ?? 24.0,
        color: color,
        semanticLabel: semanticLabel,
      );
    }
    return fallback(
      iconData,
      key: key,
      size: size,
      color: color,
      semanticLabel: semanticLabel,
      textDirection: textDirection,
    );
  }
}