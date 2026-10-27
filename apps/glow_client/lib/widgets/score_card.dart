import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';

class ScoreCard extends StatelessWidget {
  final String label;
  final num value;
  final Color color;
  final IconData icon;

  const ScoreCard({
    super.key,
    required this.label,
    required this.value,
    required this.color,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    final doubleValue = value.toDouble();
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.grey[300]!),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 20),
              const SizedBox(width: 8),
              Text(label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
            ],
          ),
          const SizedBox(height: 8),
          LinearProgressIndicator(
            value: doubleValue / 100,
            backgroundColor: Colors.grey[200],
            valueColor: AlwaysStoppedAnimation<Color>(color),
            minHeight: 6,
            borderRadius: BorderRadius.circular(3),
          ),
          const SizedBox(height: 4),
          Text('${doubleValue.toStringAsFixed(0)}%', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: color)),
        ],
      ),
    );
  }
}