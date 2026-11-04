// Stub for QualityIndicator - originally in glow_core but removed during split
// Y-F2: será reemplazado por implementación completa en Fase 6/7
import 'package:flutter/material.dart';

class QualityIndicator extends StatelessWidget {
  final double quality;

  const QualityIndicator({super.key, required this.quality});

  @override
  Widget build(BuildContext context) {
    final isGood = quality >= 70;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: isGood ? Colors.green.withValues(alpha: 0.2) : Colors.orange.withValues(alpha: 0.2),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isGood ? Colors.green : Colors.orange,
          width: 1,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            isGood ? Icons.check_circle : Icons.warning_amber_rounded,
            color: isGood ? Colors.green : Colors.orange,
            size: 16,
          ),
          const SizedBox(width: 6),
          Text(
            'Calidad: ${quality.toStringAsFixed(0)}%',
            style: TextStyle(
              color: isGood ? Colors.green : Colors.orange,
              fontWeight: FontWeight.bold,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}