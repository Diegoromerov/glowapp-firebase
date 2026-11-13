// Motion Tokens - Brand Motion System
// Single source of truth for all motion/animation values across GlowApp
// Used by: glow_client, glow_provider, glow_core widgets

import 'dart:ui';

import 'package:flutter/material.dart';

/// Centralized motion tokens for the "Belleza Luxe" design system.
/// 
/// Provides durations, curves, scales, and stagger values that ensure
/// consistent, on-brand motion across both client and provider apps.
/// 
/// Men's Mode uses overridden tokens (faster, sharper curves) for a
/// more technical/precise feel.
class MotionTokens {
  MotionTokens._();

  // =========================================================================
  // DURATIONS (ms)
  // =========================================================================

  /// Quick micro-interactions: button press, checkbox, toggle
  static const Duration fast = Duration(milliseconds: 150);

  /// Standard transitions: page route, card expand, dialog appear
  static const Duration base = Duration(milliseconds: 250);

  /// Complex orchestrations: hero transitions, multi-step flows
  static const Duration slow = Duration(milliseconds: 400);

  // =========================================================================
  // CURVES (cubic-bezier)
  // =========================================================================

  /// Signature "luxe" easing: smooth deceleration, premium feel
  /// cubic-bezier(0.2, 0, 0, 1) ≈ Curves.easeOutExpo
  static const Curve easeOutExpo = Cubic(0.2, 0.0, 0.0, 1.0);

  /// Balanced easing for most UI transitions
  /// cubic-bezier(0.4, 0, 0.2, 1) ≈ Material standard
  static const Curve easeOutCubic = Cubic(0.4, 0.0, 0.2, 1.0);

  /// Gentle entry/exit for background elements
  /// cubic-bezier(0, 0, 0.2, 1)
  static const Curve easeInOutCubic = Cubic(0.0, 0.0, 0.2, 1.0);

  // =========================================================================
  // STAGGER
  // =========================================================================

  /// Base delay between staggered children (lists, grids, form fields)
  static const Duration staggerBase = Duration(milliseconds: 20);

  // =========================================================================
  // SCALES & OFFSETS
  // =========================================================================

  /// Button press scale (pressed state)
  static const double pressScale = 0.96;

  /// Card hover/tap lift (elevation increase)
  static const double hoverLift = 4.0;

  /// Shared axis transition offset
  static const double sharedAxisOffset = 32.0;

  // =========================================================================
  // MEN'S MODE OVERRIDES
  // =========================================================================
  /// 20% faster, sharper curves for technical/precise feel
  static const Duration fastMen = Duration(milliseconds: 120);
  static const Duration baseMen = Duration(milliseconds: 200);
  static const Duration slowMen = Duration(milliseconds: 320);

  /// cubic-bezier(0.4, 0, 1, 1) - linear-out, no overshoot
  static const Curve easeMen = Cubic(0.4, 0.0, 1.0, 1.0);

  static const Duration staggerBaseMen = Duration(milliseconds: 16);

  // =========================================================================
  // HELPERS
  // =========================================================================

  /// Returns tokens for the current gender mode.
  /// Usage: `MotionTokens.forMode(context).base`
  static MotionTokensMode forMode(BuildContext context) {
    // TODO: Integrate with GenderModeProvider when available
    // final isMensMode = context.watch<GenderModeProvider>().isMensMode;
    final isMensMode = false; // Placeholder
    return isMensMode ? _mensMode : _defaultMode;
  }

  static final _defaultMode = _MotionTokensMode(
    fast: fast,
    base: base,
    slow: slow,
    easeOutExpo: easeOutExpo,
    easeOutCubic: easeOutCubic,
    easeInOutCubic: easeInOutCubic,
    staggerBase: staggerBase,
    pressScale: pressScale,
    hoverLift: hoverLift,
    sharedAxisOffset: sharedAxisOffset,
  );

  static final _mensMode = _MotionTokensMode(
    fast: fastMen,
    base: baseMen,
    slow: slowMen,
    easeOutExpo: easeMen,
    easeOutCubic: easeMen,
    easeInOutCubic: easeMen,
    staggerBase: staggerBaseMen,
    pressScale: pressScale,
    hoverLift: hoverLift,
    sharedAxisOffset: sharedAxisOffset,
  );
}

/// Immutable snapshot of motion tokens for a specific mode.
/// Allows widgets to capture tokens at build time without context dependency.
class MotionTokensMode {
  const MotionTokensMode({
    required this.fast,
    required this.base,
    required this.slow,
    required this.easeOutExpo,
    required this.easeOutCubic,
    required this.easeInOutCubic,
    required this.staggerBase,
    required this.pressScale,
    required this.hoverLift,
    required this.sharedAxisOffset,
  });

  final Duration fast;
  final Duration base;
  final Duration slow;
  final Curve easeOutExpo;
  final Curve easeOutCubic;
  final Curve easeInOutCubic;
  final Duration staggerBase;
  final double pressScale;
  final double hoverLift;
  final double sharedAxisOffset;
}

class _MotionTokensMode extends MotionTokensMode {
  const _MotionTokensMode({
    required super.fast,
    required super.base,
    required super.slow,
    required super.easeOutExpo,
    required super.easeOutCubic,
    required super.easeInOutCubic,
    required super.staggerBase,
    required super.pressScale,
    required super.hoverLift,
    required super.sharedAxisOffset,
  });
}
