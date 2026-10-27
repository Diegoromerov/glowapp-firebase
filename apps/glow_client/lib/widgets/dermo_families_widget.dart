import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';

class DermoFamiliesWidget extends StatelessWidget {
  final dynamic dermoFamilies;

  const DermoFamiliesWidget({
    super.key,
    required this.dermoFamilies,
  });

  @override
  Widget build(BuildContext context) {
    final families = dermoFamilies is Map ? [dermoFamilies] : (dermoFamilies as List? ?? []);
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Familias Dermatológicas', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            ...families.map((family) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: (family['color'] as Color? ?? AppTheme.primary).withOpacity(0.1),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(
                      family['icon'] as IconData? ?? Icons.category,
                      color: family['color'] as Color? ?? AppTheme.primary,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(family['name'] as String? ?? 'Familia', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                        Text(family['description'] as String? ?? '', style: TextStyle(fontSize: 13, color: Colors.grey[600])),
                      ],
                    ),
                  ),
                  Text('${family['score']?.toStringAsFixed(0) ?? '0'}%', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: AppTheme.primary)),
                ],
              ),
            )),
          ],
        ),
      ),
    );
  }
}