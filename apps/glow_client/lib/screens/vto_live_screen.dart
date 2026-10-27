// frontend/lib/screens/ideas/vto_live_screen.dart
import 'package:glow_core/glow_core.dart';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import '../widgets/vto_painter.dart';

class VtoLiveScreen extends StatefulWidget {
  final BiometricResult biometricResult;
  final Uint8List? faceImage;

  const VtoLiveScreen({
    super.key,
    required this.biometricResult,
    this.faceImage,
  });

  @override
  State<VtoLiveScreen> createState() => _VtoLiveScreenState();
}

class _VtoLiveScreenState extends State<VtoLiveScreen> {
  Color _selectedColor = const Color(0xFFE05A47);
  String _selectedName = 'Coral Sunset';
  String _selectedFinish = 'Mate';
  double _opacity = 0.65;

  late List<Map<String, dynamic>> _recommendedLipsticks;

  @override
  void initState() {
    super.initState();
    _loadVtoTones();
  }

  void _loadVtoTones() {
    final vtoTones = widget.biometricResult.vtoTones;
    if (vtoTones != null && vtoTones['lipsticks'] is List) {
      _recommendedLipsticks = (vtoTones['lipsticks'] as List)
          .whereType<Map<String, dynamic>>()
          .toList();
    } else {
      final subtono = (widget.biometricResult.face?.subtonoMedido ?? false)
          ? widget.biometricResult.face!.subtono
          : 'neutro';
      final isWarm = subtono.toLowerCase().contains('cál');
      _recommendedLipsticks = isWarm
          ? [
              {'name': 'Coral Sunset', 'hex': '#E05A47', 'finish': 'Mate'},
              {'name': 'Warm Nude', 'hex': '#C88A68', 'finish': 'Satinado'},
              {'name': 'Terracota Glam', 'hex': '#B84A39', 'finish': 'Mate'},
            ]
          : [
              {'name': 'Berry Crush', 'hex': '#9E2A2B', 'finish': 'Brillante'},
              {'name': 'Pink Rose', 'hex': '#D87093', 'finish': 'Mate'},
              {'name': 'Classic Ruby', 'hex': '#A4161A', 'finish': 'Satinado'},
            ];
    }

    if (_recommendedLipsticks.isNotEmpty) {
      final first = _recommendedLipsticks.first;
      _selectedName = first['name'] ?? 'Tono Sugerido';
      _selectedColor = _hexToColor(first['hex'] ?? '#E05A47');
      _selectedFinish = first['finish'] ?? 'Mate';
    }
  }

  Color _hexToColor(String hexString) {
    final buffer = StringBuffer();
    if (hexString.length == 6 || hexString.length == 7) buffer.write('ff');
    buffer.write(hexString.replaceFirst('#', ''));
    return Color(int.parse(buffer.toString(), radix: 16));
  }

  @override
  Widget build(BuildContext context) {
    final subtono = (widget.biometricResult.face?.subtonoMedido ?? false)
          ? widget.biometricResult.face!.subtono
          : 'neutro';

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text(
          'VTO Maquillaje • Subtono ${subtono.toUpperCase()}',
          style: const TextStyle(
            fontFamily: 'CormorantGaramond',
            fontWeight: FontWeight.bold,
            fontSize: 20,
            color: Colors.white,
          ),
        ),
      ),
      body: Stack(
        children: [
          // Imagen capturada del usuario o representación VTO con cámara en vivo
          Positioned.fill(
            child: widget.faceImage != null
                ? Image.memory(
                    widget.faceImage!,
                    fit: BoxFit.cover,
                  )
                : Stack(
                    children: [
                      Positioned.fill(
                        child: Image.asset(
                          'images/aura_welcome_poster.webp',
                          fit: BoxFit.cover,
                          alignment: Alignment.topCenter,
                          errorBuilder: (_, __, ___) => Container(
                            color: Colors.grey[900],
                            child: const Center(
                              child: Icon(Icons.face_retouching_natural, size: 100, color: Colors.white30),
                            ),
                          ),
                        ),
                      ),
                      Positioned.fill(
                        child: CustomPaint(
                          painter: VtoPainter(
                            lipstickColor: _selectedColor,
                            lipstickOpacity: _opacity,
                            finish: _selectedFinish,
                            imageSize: const Size(640, 480),
                            rotation: InputImageRotation.rotation0deg,
                          ),
                        ),
                      ),
                    ],
                  ),
          ),

          // Tinte interactivo simulado
          Positioned.fill(
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.black.withOpacity(0.2),
                    Colors.black.withOpacity(0.7),
                  ],
                ),
              ),
            ),
          ),

          // Panel de selección de tonos DeepSeek V4 Flash (VTO UI)
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 600),
                child: Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: Colors.black.withOpacity(0.85),
                    borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
                    border: Border.all(color: const Color(0xFFC5A052).withOpacity(0.3)),
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _selectedName,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 18,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              Text(
                                'Acabado $_selectedFinish • Recomendado por DeepSeek IA',
                                style: const TextStyle(
                                  color: Color(0xFFC5A052),
                                  fontSize: 12,
                                ),
                              ),
                            ],
                          ),
                          Container(
                            width: 32,
                            height: 32,
                            decoration: BoxDecoration(
                              color: _selectedColor,
                              shape: BoxShape.circle,
                              border: Border.all(color: Colors.white, width: 2),
                              boxShadow: [
                                BoxShadow(
                                  color: _selectedColor.withOpacity(0.5),
                                  blurRadius: 8,
                                  spreadRadius: 2,
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),

                      // Selector de Opacidad/Intensidad
                      Row(
                        children: [
                          const Text('Intensidad:', style: TextStyle(color: Colors.white70, fontSize: 12)),
                          Expanded(
                            child: SliderTheme(
                              data: SliderTheme.of(context).copyWith(
                                activeTrackColor: const Color(0xFFC5A052),
                                thumbColor: const Color(0xFFF3D59B),
                                inactiveTrackColor: Colors.white24,
                              ),
                              child: Slider(
                                value: _opacity,
                                min: 0.1,
                                max: 1.0,
                                onChanged: (v) => setState(() => _opacity = v),
                              ),
                            ),
                          ),
                        ],
                      ),

                      // Lista horizontal de tonos sugeridos
                      SizedBox(
                        height: 70,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: _recommendedLipsticks.length,
                          separatorBuilder: (_, __) => const SizedBox(width: 12),
                          itemBuilder: (context, index) {
                            final item = _recommendedLipsticks[index];
                            final color = _hexToColor(item['hex'] ?? '#E05A47');
                            final isSelected = _selectedName == item['name'];

                            return GestureDetector(
                              onTap: () {
                                setState(() {
                                  _selectedName = item['name'] ?? 'Tono';
                                  _selectedColor = color;
                                  _selectedFinish = item['finish'] ?? 'Mate';
                                });
                              },
                              child: AnimatedContainer(
                                duration: const Duration(milliseconds: 200),
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                decoration: BoxDecoration(
                                  color: isSelected ? Colors.white.withOpacity(0.15) : Colors.transparent,
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(
                                    color: isSelected ? const Color(0xFFC5A052) : Colors.transparent,
                                    width: 1.5,
                                  ),
                                ),
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Container(
                                      width: 28,
                                      height: 28,
                                      decoration: BoxDecoration(
                                        color: color,
                                        shape: BoxShape.circle,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      item['name'] ?? 'Tono',
                                      style: TextStyle(
                                        color: isSelected ? Colors.white : Colors.white70,
                                        fontSize: 10,
                                        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                      ),

                      const SizedBox(height: 16),

                      // Botonera de Acción Directa E-Commerce & Citas GPS
                      Row(
                        children: [
                          Expanded(
                            child: Container(
                              height: 46,
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(14),
                                gradient: const LinearGradient(
                                  colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                                  begin: Alignment.topLeft,
                                  end: Alignment.bottomRight,
                                ),
                              ),
                              child: ElevatedButton.icon(
                                onPressed: () {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                      content: Text('🛍️ Tono "$_selectedName" agregado al carrito'),
                                    ),
                                  );
                                },
                                icon: const Icon(Icons.shopping_bag_outlined, color: Color(0xFF1F1A15), size: 18),
                                label: const Text(
                                  'Comprar Tono',
                                  style: TextStyle(
                                    fontFamily: 'Inter',
                                    color: Color(0xFF1F1A15),
                                    fontWeight: FontWeight.bold,
                                    fontSize: 13,
                                  ),
                                ),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: Colors.transparent,
                                  shadowColor: Colors.transparent,
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: SizedBox(
                              height: 46,
                              child: OutlinedButton.icon(
                                onPressed: () {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(
                                      content: Text('📍 Buscando salones con este servicio cerca de ti...'),
                                    ),
                                  );
                                },
                                icon: const Icon(Icons.location_on_outlined, color: Color(0xFFC5A052), size: 18),
                                label: const Text(
                                  'Reservar Cita',
                                  style: TextStyle(
                                    fontFamily: 'Inter',
                                    color: Color(0xFFC5A052),
                                    fontWeight: FontWeight.bold,
                                    fontSize: 13,
                                  ),
                                ),
                                style: OutlinedButton.styleFrom(
                                  side: const BorderSide(color: Color(0xFFC5A052), width: 1.2),
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
