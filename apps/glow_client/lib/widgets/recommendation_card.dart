import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';

class RecommendationCard extends StatelessWidget {
  final String recommendation;

  const RecommendationCard({
    super.key,
    required this.recommendation,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Recomendación', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Text(recommendation, style: TextStyle(fontSize: 14, color: Colors.grey[600])),
          ],
        ),
      ),
    );
  }
}