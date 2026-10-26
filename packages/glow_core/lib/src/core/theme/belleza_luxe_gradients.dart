import 'package:flutter/material.dart';
import '../../core/theme/belleza_luxe_theme.dart';

/// Extensión de Gradientes y Sombras Luxe
class LuxeGradients {
  LuxeGradients._();

  static const LinearGradient goldShimmer = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      LuxeColors.nude100,
      Color(0xFFF9F5EC),
      LuxeColors.nude100,
    ],
  );

  static const LinearGradient goldAccent = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      LuxeColors.goldLight,
      LuxeColors.gold871,
      LuxeColors.goldDark,
    ],
  );
}
