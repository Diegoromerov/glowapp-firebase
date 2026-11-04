import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';

class VtoPainter extends CustomPainter {
  final Map<String, dynamic>? faceLandmarks;
  final Map<String, dynamic>? handLandmarks;
  final Size imageSize;
  final bool showFaceMesh;
  final bool showHandMesh;
  final Color? lipstickColor;
  final double lipstickOpacity;
  final String? finish;
  final InputImageRotation? rotation;

  VtoPainter({
    this.faceLandmarks,
    this.handLandmarks,
    required this.imageSize,
    this.showFaceMesh = true,
    this.showHandMesh = true,
    this.lipstickColor,
    this.lipstickOpacity = 0.5,
    this.finish,
    this.rotation,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final scaleX = size.width / imageSize.width;
    final scaleY = size.height / imageSize.height;

    if (showFaceMesh && faceLandmarks != null) {
      _drawFaceMesh(canvas, scaleX, scaleY);
    }

    if (showHandMesh && handLandmarks != null) {
      _drawHandMesh(canvas, scaleX, scaleY);
    }

    if (lipstickColor != null && faceLandmarks != null) {
      _drawLipstick(canvas, scaleX, scaleY);
    }
  }

  void _drawFaceMesh(Canvas canvas, double scaleX, double scaleY) {
    final paint = Paint()
      ..color = AppTheme.primary.withValues(alpha: 0.6)
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;

    final points = faceLandmarks!['points'] as List<dynamic>?;
    if (points != null) {
      for (int i = 0; i < points.length; i += 2) {
        final x = (points[i] as num).toDouble() * scaleX;
        final y = (points[i + 1] as num).toDouble() * scaleY;
        canvas.drawCircle(Offset(x, y), 2, paint);
      }
    }
  }

  void _drawHandMesh(Canvas canvas, double scaleX, double scaleY) {
    final paint = Paint()
      ..color = AppTheme.accent.withValues(alpha: 0.6)
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;

    final points = handLandmarks!['points'] as List<dynamic>?;
    if (points != null) {
      for (int i = 0; i < points.length; i += 2) {
        final x = (points[i] as num).toDouble() * scaleX;
        final y = (points[i + 1] as num).toDouble() * scaleY;
        canvas.drawCircle(Offset(x, y), 2, paint);
      }
    }
  }

  void _drawLipstick(Canvas canvas, double scaleX, double scaleY) {
    final paint = Paint()
      ..color = lipstickColor!.withValues(alpha: lipstickOpacity)
      ..style = PaintingStyle.fill;

    // Simplified lipstick drawing - in production this would use actual lip landmarks
    final points = faceLandmarks!['points'] as List<dynamic>?;
    if (points != null && points.length >= 20) {
      // Approximate lip region using landmark indices (simplified)
      final lipPoints = <Offset>[];
      for (int i = 0; i < points.length; i += 2) {
        final x = (points[i] as num).toDouble() * scaleX;
        final y = (points[i + 1] as num).toDouble() * scaleY;
        lipPoints.add(Offset(x, y));
      }
      // Draw a simple overlay on lower face region
      final path = Path();
      if (lipPoints.length > 10) {
        path.addPolygon(lipPoints.sublist(lipPoints.length ~/ 2), true);
        canvas.drawPath(path, paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) {
    return oldDelegate is VtoPainter &&
        oldDelegate.faceLandmarks != faceLandmarks &&
        oldDelegate.handLandmarks != handLandmarks &&
        oldDelegate.lipstickColor != lipstickColor &&
        oldDelegate.lipstickOpacity != lipstickOpacity &&
        oldDelegate.finish != finish;
  }
}