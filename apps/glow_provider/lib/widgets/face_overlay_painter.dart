// Stub for FaceOverlayPainter - originally in glow_core but removed during split
// Y-F2: será reemplazado por implementación completa en Fase 6/7
import 'package:flutter/material.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';

class FaceOverlayPainter extends CustomPainter {
  final Face? detectedFace;
  final bool isValid;
  final double quality;
  final Size screenSize;

  FaceOverlayPainter({
    required this.detectedFace,
    required this.isValid,
    required this.quality,
    required this.screenSize,
  });

  @override
  void paint(Canvas canvas, Size size) {
    // Stub: no dibujar nada
  }

  @override
  bool shouldRepaint(covariant FaceOverlayPainter oldDelegate) {
    return detectedFace != oldDelegate.detectedFace ||
        isValid != oldDelegate.isValid ||
        quality != oldDelegate.quality;
  }
}