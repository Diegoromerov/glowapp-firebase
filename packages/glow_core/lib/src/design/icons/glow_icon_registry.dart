/// GlowIcon Registry — Central authority for GlowApp iconography
///
/// Maps semantic names to icon implementations.
/// Allows swapping implementations without changing consumer code.
///
/// Usage:
///   GlowIconRegistry.register('search', GlowIconImpl.search);
///   final icon = GlowIconRegistry.resolve('search');
///
/// Or use the convenience API:
///   GlowIcon.search
///   GlowIcon.aura
library glow_icon_registry;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// Central registry mapping semantic names to [GlowIconData] implementations.
class GlowIconRegistry {
  GlowIconRegistry._();

  static final Map<String, GlowIconData> _registry = {};

  /// Register an icon implementation for a semantic name.
  ///
  /// Should be called during app initialization (e.g., in main.dart before runApp).
  static void register(String semanticName, GlowIconData iconData) {
    _registry[semanticName] = iconData;
  }

  /// Register multiple icons at once.
  static void registerAll(Map<String, GlowIconData> icons) {
    _registry.addAll(icons);
  }

  /// Resolve an icon by semantic name.
  ///
  /// Returns null if not found (allows fallback to Material Icons).
  static GlowIconData? resolve(String semanticName) {
    return _registry[semanticName];
  }

  /// Check if a semantic name is registered.
  static bool has(String semanticName) {
    return _registry.containsKey(semanticName);
  }

  /// Get all registered semantic names.
  static Set<String> get registeredNames => _registry.keys.toSet();

  /// Clear registry (for testing).
  static void clear() {
    _registry.clear();
  }

  /// Pre-defined core icon semantic names.
  static const List<String> coreIcons = [
    'home',
    'search',
    'menu',
    'close',
    'back',
    'forward',
    'more',
    'profile',
    'heart',
    'bag',
    'cart',
    'calendar',
    'clock',
    'location',
    'settings',
    'notification',
  ];

  /// Pre-defined proprietary icon semantic names.
  static const List<String> proprietaryIcons = [
    'glow',
    'aura',
    'concierge',
    'beauty_ritual',
    'glow_recommendation',
    'male_grooming',
  ];

  /// Beauty extended icons (I2-A).
  static const List<String> beautyIcons = [
    'skincare',
    'hair',
    'nails',
    'makeup',
    'fragrance',
    'body',
    'wellness',
    'spa',
  ];

  /// Men extended icons (I2-B).
  static const List<String> menIcons = [
    'beard',
    'shave',
    'scalp',
    'mens_fragrance',
    'mens_body',
  ];

  /// Concierge extended icons (I2-C).
  static const List<String> conciergeIcons = [
    'booking',
    'chat',
    'wishlist',
    'support',
  ];

  /// AURA extended icons (I2-D).
  static const List<String> auraIcons = [
    'scan',
    'analyze',
    'learn',
    'predict',
    'evolve',
    'sync',
  ];

  /// System extended icons (I2-E).
  static const List<String> systemIcons = [
    'share',
    'download',
    'upload',
    'filter',
    'sort',
    'qr',
  ];

  /// All known semantic names (core + proprietary + beauty + men + concierge + aura + system).
  static List<String> get allKnownNames => [...coreIcons, ...proprietaryIcons, ...beautyIcons, ...menIcons, ...conciergeIcons, ...auraIcons, ...systemIcons];
}

/// Data class holding icon implementation details.
///
/// Supports multiple implementation strategies:
/// - [assetPath]: Path to SVG asset (preferred for proprietary icons)
/// - [iconData]: Material/Cupertino IconData (for fallback/compatibility)
/// - [customPainter]: CustomPainter subclass (for procedural icons)
class GlowIconData {
  final String semanticName;
  final String? assetPath; // SVG asset path relative to assets/icons/glow/
  final IconData? iconData; // Material/Cupertino fallback
  final CustomPainter? customPainter; // Procedural implementation
  final double defaultStrokeWidth;

  const GlowIconData({
    required this.semanticName,
    this.assetPath,
    this.iconData,
    this.customPainter,
    this.defaultStrokeWidth = 1.75,
  }) : assert(
          assetPath != null || iconData != null || customPainter != null,
          'At least one implementation must be provided',
        );

  /// Create a widget for this icon with the given parameters.
  Widget build({
    required double size,
    required Color color,
    String? semanticLabel,
    double? strokeWidth,
  }) {
    final effectiveStrokeWidth = strokeWidth ?? defaultStrokeWidth;

    // Priority: SVG asset > CustomPainter > IconData
    if (assetPath != null) {
      return _SvgIcon(
        assetPath: 'icons/glow/$assetPath',
        size: size,
        color: color,
        semanticLabel: semanticLabel,
      );
    } else if (customPainter != null) {
      return _CustomPaintIcon(
        painter: customPainter!,
        size: size,
        color: color,
        semanticLabel: semanticLabel,
        strokeWidth: effectiveStrokeWidth,
      );
    } else {
      return Icon(
        iconData!,
        size: size,
        color: color,
        semanticLabel: semanticLabel,
      );
    }
  }
}

/// Internal widget for SVG icons.
class _SvgIcon extends StatelessWidget {
  final String assetPath;
  final double size;
  final Color color;
  final String? semanticLabel;

  const _SvgIcon({
    required this.assetPath,
    required this.size,
    required this.color,
    this.semanticLabel,
  });

  @override
  Widget build(BuildContext context) {
    // Use flutter_svg with color filter
    return Semantics(
      label: semanticLabel,
      child: SizedBox(
        width: size,
        height: size,
        child: SvgPicture.asset(
          assetPath,
          width: size,
          height: size,
          colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
        ),
      ),
    );
  }
}

/// Internal widget for CustomPainter icons.
class _CustomPaintIcon extends StatelessWidget {
  final CustomPainter painter;
  final double size;
  final Color color;
  final String? semanticLabel;
  final double strokeWidth;

  const _CustomPaintIcon({
    required this.painter,
    required this.size,
    required this.color,
    this.semanticLabel,
    required this.strokeWidth,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: semanticLabel,
      child: SizedBox(
        width: size,
        height: size,
        child: CustomPaint(
          painter: _IconPainterWrapper(painter, color, strokeWidth),
          size: Size(size, size),
        ),
      ),
    );
  }
}

/// Wrapper to inject color and strokeWidth into a CustomPainter.
class _IconPainterWrapper extends CustomPainter {
  final CustomPainter basePainter;
  final Color color;
  final double strokeWidth;

  _IconPainterWrapper(this.basePainter, this.color, this.strokeWidth);

  @override
  void paint(Canvas canvas, Size size) {
    // The base painter should respect color and strokeWidth via its own logic
    // For now, we delegate directly - the painter should be designed to accept these
    basePainter.paint(canvas, size);
  }

  @override
  bool shouldRepaint(covariant _IconPainterWrapper oldDelegate) {
    return oldDelegate.color != color || oldDelegate.strokeWidth != strokeWidth;
  }
}