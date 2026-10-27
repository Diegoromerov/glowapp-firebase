// Stub for NailVtoPainter - originally in glow_core but removed during split
// Y-F2: será reemplazado por implementación completa en Fase 6/7
import 'package:flutter/material.dart';
import 'dart:typed_data';

class NailVtoPainter extends CustomPainter {
  final Color nailColor;
  final String nailStyle;
  final String finish;
  final double opacity;

  NailVtoPainter({
    required this.nailColor,
    required this.nailStyle,
    required this.finish,
    required this.opacity,
  });

  @override
  void paint(Canvas canvas, Size size) {
    // Stub: no dibujar nada
  }

  @override
  bool shouldRepaint(covariant NailVtoPainter oldDelegate) {
    return nailColor != oldDelegate.nailColor ||
        nailStyle != oldDelegate.nailStyle ||
        finish != oldDelegate.finish ||
        opacity != oldDelegate.opacity;
  }
}

// Wrapper widget for CustomPainter
class CustomPainterWidget extends StatelessWidget {
  final CustomPainter painter;

  const CustomPainterWidget({super.key, required this.painter});

  @override
  Widget build(BuildContext context) {
    return CustomPaint(painter: painter);
  }
}
