import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';

class ColorPaletteWidget extends StatelessWidget {
  final String hexColor;
  final String title;

  const ColorPaletteWidget({
    super.key,
    required this.hexColor,
    this.title = 'Tu Paleta de Colores',
  });

  @override
  Widget build(BuildContext context) {
    final color = Color(int.parse(hexColor.replaceFirst('#', '0xFF')));
    
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            Row(
              children: [
                Container(
                  width: 60,
                  height: 60,
                  decoration: BoxDecoration(
                    color: color,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.grey[300]!),
                  ),
                ),
                const SizedBox(width: 16),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Color Base', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
                    Text(hexColor.toUpperCase(), style: TextStyle(fontSize: 14, color: Colors.grey[600], fontFamily: 'monospace')),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text('Tonos complementarios sugeridos:', style: TextStyle(fontSize: 13, color: Colors.grey[600])),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _buildSwatch(_shiftHue(color, 30)),
                _buildSwatch(_shiftHue(color, -30)),
                _buildSwatch(_shiftHue(color, 180)),
                _buildSwatch(_shiftHue(color, 150)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSwatch(Color color) {
    return Column(
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: Colors.grey[300]!),
          ),
        ),
        const SizedBox(height: 2),
        Text('#${color.value.toRadixString(16).substring(2).toUpperCase()}', 
             style: TextStyle(fontSize: 10, color: Colors.grey[600])),
      ],
    );
  }

  Color _shiftHue(Color color, double degrees) {
    final hsl = HSLColor.fromColor(color);
    return hsl.withHue((hsl.hue + degrees) % 360).toColor();
  }
}