// Stub for HandOverlayPainter - originally in glow_core but removed during split
// Y-F2: será reemplazado por implementación completa en Fase 6/7
import 'package:flutter/material.dart';

class HandOverlayPainter extends CustomPainter {
  final bool isValid;
  final double quality;
  final Size screenSize;

  HandOverlayPainter({
    required this.isValid,
    required this.quality,
    required this.screenSize,
  });

  @override
  void paint(Canvas canvas, Size size) {
    // Stub: no dibujar nada
  }

  @override
  bool shouldRepaint(covariant HandOverlayPainter oldDelegate) {
    return isValid != oldDelegate.isValid || quality != oldDelegate.quality;
  }
}