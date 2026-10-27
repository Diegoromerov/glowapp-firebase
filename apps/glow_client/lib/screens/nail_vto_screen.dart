// frontend/lib/screens/ideas/nail_vto_screen.dart
import 'package:glow_core/glow_core.dart';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import '../widgets/nail_vto_painter.dart';

class NailVtoScreen extends StatefulWidget {
  final BiometricResult biometricResult;
  final Uint8List? handsImage;

  const NailVtoScreen({
    super.key,
    required this.biometricResult,
    this.handsImage,
  });

  @override
  State<NailVtoScreen> createState() => _NailVtoScreenState();
}

class _NailVtoScreenState extends State<NailVtoScreen> {
  Color _selectedColor = const Color(0xFFB84A39);
  String _selectedName = 'Terracota Chic';
  String _selectedStyle = 'Almond';
  final String _selectedFinish = 'Brillante';
  final double _opacity = 0.85;

  late List<Map<String, dynamic>> _recommendedNails;
  final List<String> _availableStyles = ['Almond', 'Square', 'Coffin', 'Oval'];

  @override
  void initState() {
    super.initState();
    _loadNailTones();
  }

  void _loadNailTones() {
    final vtoTones = widget.biometricResult.vtoTones;
    if (vtoTones != null && vtoTones['nails'] is List) {
      _recommendedNails = (vtoTones['nails'] as List)
          .whereType<Map<String, dynamic>>()
          .toList();
    } else {
      final subtono = (widget.biometricResult.face?.subtonoMedido ?? false)
          ? widget.biometricResult.face!.subtono
          : 'neutro';
      final isWarm = subtono.toLowerCase().contains('cál');
      _recommendedNails = isWarm
          ? [
              {'name': 'Terracota Warm', 'hex': '#B84A39', 'style': 'Almond'},
              {'name': 'Glitter Gold', 'hex': '#D4AF37', 'style': 'Square'},
              {'name': 'Nude Glam', 'hex': '#C88A68', 'style': 'Oval'},
            ]
          : [
              {'name': 'Deep Burgundy', 'hex': '#4A0E17', 'style': 'Coffin'},
              {'name': 'French Classic', 'hex': '#FFF0F5', 'style': 'Oval'},
              {'name': 'Berry Chic', 'hex': '#9E2A2B', 'style': 'Almond'},
            ];
    }

    if (_recommendedNails.isNotEmpty) {
      final first = _recommendedNails.first;
      _selectedName = first['name'] ?? 'Esmalte';
      _selectedColor = _hexToColor(first['hex'] ?? '#B84A39');
      _selectedStyle = first['style'] ?? 'Almond';
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
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text(
          'VTO Manicura & Uñas • DeepSeek IA',
          style: TextStyle(
            fontFamily: 'CormorantGaramond',
            fontWeight: FontWeight.bold,
            fontSize: 20,
            color: Colors.white,
          ),
        ),
      ),
      body: Stack(
        children: [
          // Foto de manos o visualización simulada
          Positioned.fill(
            child: widget.handsImage != null
                ? Image.memory(
                    widget.handsImage!,
                    fit: BoxFit.cover,
                  )
                : Container(
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        colors: [Color(0xFF2C221D), Color(0xFF151210)],
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                      ),
                    ),
                    child: const Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.back_hand, size: 90, color: Color(0xFFC5A052)),
                          SizedBox(height: 12),
                          Text(
                            'Simulador VTO Nails de Precisión',
                            style: TextStyle(color: Colors.white70, fontSize: 13, fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                    ),
                  ),
          ),

          // Renderizado VTO de Uñas sobre la foto
          Positioned.fill(
            child: CustomPainterWidget(
              painter: NailVtoPainter(
                nailColor: _selectedColor,
                nailStyle: _selectedStyle,
                finish: _selectedFinish,
                opacity: _opacity,
              ),
            ),
          ),

          // Controles de selección VTO Uñas
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 620),
                child: Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Colors.black.withOpacity(0.85),
                borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
                border: Border.all(color: AppTheme.primary.withOpacity(0.3)),
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
                                                      'Estilo $_selectedStyle • Acabado $_selectedFinish',
                                                      style: TextStyle(
                                                        color: AppTheme.primary,
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
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 14),

                  // Selector de Estilo de Uña (Almond, Square, Coffin, Oval)
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: _availableStyles.map((style) {
                        final isSelected = style == _selectedStyle;
                        return Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            label: Text(style),
                            selected: isSelected,
                            selectedColor: AppTheme.primary,
                            backgroundColor: Colors.white10,
                            labelStyle: TextStyle(
                              color: isSelected ? Colors.white : Colors.white70,
                              fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                            ),
                            onSelected: (selected) {
                              if (selected) setState(() => _selectedStyle = style);
                            },
                          ),
                        );
                      }).toList(),
                    ),
                  ),

                  const SizedBox(height: 12),

                  // Carrusel de tonos de esmalte recomendados
                  SizedBox(
                    height: 64,
                    child: ListView.builder(
                      scrollDirection: Axis.horizontal,
                      itemCount: _recommendedNails.length,
                      itemBuilder: (context, index) {
                        final item = _recommendedNails[index];
                        final color = _hexToColor(item['hex'] ?? '#B84A39');
                        final isSelected = item['name'] == _selectedName;

                        return GestureDetector(
                          onTap: () {
                            setState(() {
                              _selectedName = item['name'] ?? 'Esmalte';
                              _selectedColor = color;
                              if (item['style'] != null) _selectedStyle = item['style'];
                            });
                          },
                          child: Container(
                            margin: const EdgeInsets.only(right: 12),
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              color: isSelected ? Colors.white12 : Colors.transparent,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: isSelected ? AppTheme.primary : Colors.white24,
                                width: isSelected ? 2 : 1,
                              ),
                            ),
                            child: Row(
                              children: [
                                Container(
                                  width: 22,
                                  height: 22,
                                  decoration: BoxDecoration(
                                    color: color,
                                    shape: BoxShape.circle,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  item['name'] ?? 'Esmalte',
                                  style: TextStyle(
                                    color: isSelected ? Colors.white : Colors.white70,
                                    fontSize: 12,
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
                                  content: Text('💅 Esmalte "$_selectedName" agregado al carrito'),
                                ),
                              );
                            },
                            icon: const Icon(Icons.shopping_bag_outlined, color: Color(0xFF1F1A15), size: 18),
                            label: const Text(
                              'Comprar Esmalte',
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
                                  content: Text('📍 Agendando Manicura Spa cerca de tu ubicación...'),
                                ),
                              );
                            },
                            icon: const Icon(Icons.calendar_today_outlined, color: Color(0xFFC5A052), size: 18),
                            label: const Text(
                              'Reservar Cita GPS',
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

class CustomPainterWidget extends StatelessWidget {
  final CustomPainter painter;

  const CustomPainterWidget({super.key, required this.painter});

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: painter,
      child: Container(),
    );
  }
}
