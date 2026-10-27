import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';

class GlowScoreGaugeWidget extends StatelessWidget {
  final int glowScore;
  final VoidCallback? onCompareTap;
  final double size;

  const GlowScoreGaugeWidget({
    super.key,
    required this.glowScore,
    this.onCompareTap,
    this.size = 120,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          SizedBox(
            width: size,
            height: size,
            child: CircularProgressIndicator(
              value: glowScore / 100,
              strokeWidth: 12,
              backgroundColor: Colors.grey[200],
              valueColor: AlwaysStoppedAnimation<Color>(_getScoreColor(glowScore.toDouble())),
            ),
          ),
          Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                glowScore.toString(),
                style: TextStyle(fontSize: size * 0.25, fontWeight: FontWeight.bold, color: _getScoreColor(glowScore.toDouble())),
              ),
              if (onCompareTap != null)
                TextButton(
                  onPressed: onCompareTap,
                  child: Text('Comparar', style: TextStyle(fontSize: 12, color: AppTheme.primary)),
                )
              else
                Text('Glow Score', style: TextStyle(fontSize: 12, color: Colors.grey[600])),
            ],
          ),
        ],
      ),
    );
  }

  Color _getScoreColor(double score) {
    if (score >= 80) return AppTheme.success;
    if (score >= 60) return AppTheme.warning;
    return AppTheme.error;
  }
}