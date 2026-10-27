// frontend/lib/screens/ideas/makeup_lookbook_screen.dart
import 'package:flutter/material.dart';
import '../../services/social_share_service.dart';
import '../../models/biometric_result.dart';
import 'vto_live_screen.dart';

class MakeupLook {
  final String id;
  final String title;
  final String subtitle;
  final String category;
  final String description;
  final String finishType;
  final List<ColorSwatchData> swatches;
  final List<String> keyProducts;
  final String iconEmoji;

  const MakeupLook({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.category,
    required this.description,
    required this.finishType,
    required this.swatches,
    required this.keyProducts,
    required this.iconEmoji,
  });
}

class ColorSwatchData {
  final String name;
  final Color color;
  final String hex;

  const ColorSwatchData({
    required this.name,
    required this.color,
    required this.hex,
  });
}

class MakeupLookbookScreen extends StatefulWidget {
  final BiometricResult? biometricResult;

  const MakeupLookbookScreen({super.key, this.biometricResult});

  @override
  State<MakeupLookbookScreen> createState() => _MakeupLookbookScreenState();
}

class _MakeupLookbookScreenState extends State<MakeupLookbookScreen> {
  String _selectedCategory = 'Todos';
  final TextEditingController _customPromptController = TextEditingController();
  bool _isGeneratingCustomLook = false;

  final List<String> _categories = [
    'Todos',
    'Glow Natural',
    'Novias',
    'Social Glam',
    'Editorial',
  ];

  final List<MakeupLook> _looks = const [
    MakeupLook(
      id: 'clean_girl',
      title: 'Clean Girl Glow',
      subtitle: 'Glass skin minimalista con destellos dorados',
      category: 'Glow Natural',
      description: 'Piel ultra fresca hidratada, cejas laminadas al natural, bálsamo labial jugoso y toques de iluminador champagne en pómulos y puente nasal.',
      finishType: 'Dewy / Glass Skin',
      iconEmoji: '✨',
      swatches: [
        ColorSwatchData(name: 'Champagne Glow', color: Color(0xFFF3E5AB), hex: '#F3E5AB'),
        ColorSwatchData(name: 'Soft Peach Lip', color: Color(0xFFE58C73), hex: '#E58C73'),
        ColorSwatchData(name: 'Dewy Cheek', color: Color(0xFFF8B195), hex: '#F8B195'),
      ],
      keyProducts: [
        'Serum Iluminador Ácido Hialurónico',
        'Tinta Ligera con SPF 50',
        'Aceite Labial Con Péptidos',
      ],
    ),
    MakeupLook(
      id: 'novia_radiante',
      title: 'Novia Radiante (Bridal)',
      subtitle: 'Elegancia atemporal de larga duración a prueba de lágrimas',
      category: 'Novias',
      description: 'Ahumado satinado en tonos café suave y perla, pestañas wispy individuales, rubor rosa empolvado y labios nude de fijación 24H.',
      finishType: 'Satin Velour 24H',
      iconEmoji: '👰',
      swatches: [
        ColorSwatchData(name: 'Pearl Shimmer', color: Color(0xFFF0EAE1), hex: '#F0EAE1'),
        ColorSwatchData(name: 'Dusty Rose Blush', color: Color(0xFFD8A499), hex: '#D8A499'),
        ColorSwatchData(name: 'Velvet Nude Lip', color: Color(0xFFC48B71), hex: '#C48B71'),
      ],
      keyProducts: [
        'Primer Matificante & Hidratante Dual',
        'Bruma Fijadora Waterproof HD',
        'Labial Indeleble Infundido en Karité',
      ],
    ),
    MakeupLook(
      id: 'social_glam',
      title: 'Social Glam Gala',
      subtitle: 'Contorno esculpido & ojos felinos de alto impacto',
      category: 'Social Glam',
      description: 'Delineado alado difuminado con destellos cobrizos, contorno en crema sellado al milímetro y labios terracota vino irresistibles.',
      finishType: 'Ultra-Glam Mate Luminoso',
      iconEmoji: '🍸',
      swatches: [
        ColorSwatchData(name: 'Bronze Accent', color: Color(0xFFCD7F32), hex: '#CD7F32'),
        ColorSwatchData(name: 'Sculpt Shadow', color: Color(0xFF8B5A2B), hex: '#8B5A2B'),
        ColorSwatchData(name: 'Deep Terracotta', color: Color(0xFF9E4738), hex: '#9E4738'),
      ],
      keyProducts: [
        'Paleta de Sombras Pigmentos Puros',
        'Stick Contorno Esculpido 3D',
        'Iluminador en Polvo Baked Gold',
      ],
    ),
    MakeupLook(
      id: 'editorial_euphoria',
      title: 'Editorial Sunset Euphoria',
      subtitle: 'Colorimetría cromática vanguardista inspirada en pasarela',
      category: 'Editorial',
      description: 'Líneas gráficas en lavanda y coral metalizado, piel porcelana reflectiva y microglitter holográfico en lagrimal.',
      finishType: 'Holographic Editorial',
      iconEmoji: '🔮',
      swatches: [
        ColorSwatchData(name: 'Vibrant Lilac', color: Color(0xFFB39DDB), hex: '#B39DDB'),
        ColorSwatchData(name: 'Sunset Coral', color: Color(0xFFFF8A80), hex: '#FF8A80'),
        ColorSwatchData(name: 'Prism Hologram', color: Color(0xFF80DEEA), hex: '#80DEEA'),
      ],
      keyProducts: [
        'Delineador Gel Neón Pigmentado',
        'Pigmento Suelto Multicromático',
        'Gloss Cristal Plumping Efecto Espejo',
      ],
    ),
  ];

  List<MakeupLook> get _filteredLooks {
    if (_selectedCategory == 'Todos') return _looks;
    return _looks.where((l) => l.category == _selectedCategory).toList();
  }

  void _bookMakeupArtist(MakeupLook look) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        padding: const EdgeInsets.all(24),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(look.iconEmoji, style: const TextStyle(fontSize: 28)),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Reservar: ${look.title}',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                      ),
                      Text(
                        'Estilo ${look.category} • GlowApp Match',
                        style: TextStyle(fontSize: 12, color: Colors.grey[600]),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            const Text(
              'GlowApp conectará tu pasaporte biométrico con las mejores maquilladoras profesionales verificadas de tu zona para recrear este look exacto.',
              style: TextStyle(fontSize: 13, height: 1.4, color: Colors.black87),
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: () {
                Navigator.pop(ctx);
                Navigator.pushNamedAndRemoveUntil(context, '/home', (route) => false);
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('Filtrando profesionales especializados en "${look.title}"...'),
                    backgroundColor: const Color(0xFFC5A052),
                  ),
                );
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFC5A052),
                minimumSize: const Size(double.infinity, 50),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              child: const Text(
                'Ver Maquilladoras Disponibles Ahora',
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
              ),
            ),
            const SizedBox(height: 10),
            Center(
              child: Text(
                '🔒 Pago protegido con depósito en garantía Wompi',
                style: TextStyle(fontSize: 11, color: Colors.grey[500]),
              ),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  void _handleCustomPromptGenerate() {
    final text = _customPromptController.text.trim();
    if (text.isEmpty) return;

    setState(() => _isGeneratingCustomLook = true);
    Future.delayed(const Duration(milliseconds: 1400), () {
      if (!mounted) return;
      setState(() => _isGeneratingCustomLook = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('✨ Paleta IA generada para "$text". Aplicando en VTO...'),
          backgroundColor: const Color(0xFFC5A052),
        ),
      );
    });
  }

  @override
  void dispose() {
    _customPromptController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Color(0xFF1F1A15)),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Lookbook IA & Filtros Virtuales',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF1F1A15)),
            ),
            Text(
              'Media.io x GlowApp Engine',
              style: TextStyle(fontSize: 11, color: Color(0xFFC5A052), fontWeight: FontWeight.w600),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.share_outlined, color: Color(0xFF1F1A15)),
            onPressed: () async {
              await SocialShareService.showConsentModal(
                context,
                platformName: 'Instagram Stories',
                contentTypeLabel: 'Lookbook de Maquillaje IA',
              );
            },
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Prompt Generator banner (Media.io style)
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF2C2420), Color(0xFF1F1A15)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.08),
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.auto_awesome, color: Color(0xFFF3D59B), size: 18),
                      const SizedBox(width: 8),
                      const Text(
                        'Generador Prompt-to-Makeup IA',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const Spacer(),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: const Color(0xFFC5A052).withValues(alpha: 0.3),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: const Text(
                          'MEDIA.IO SPEC',
                          style: TextStyle(fontSize: 9, color: Color(0xFFF3D59B), fontWeight: FontWeight.bold),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Escribe cualquier inspiración y nuestra IA sintetizará la paleta y técnica profesional exacta:',
                    style: TextStyle(color: Colors.white70, fontSize: 12),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _customPromptController,
                          style: const TextStyle(color: Colors.white, fontSize: 13),
                          decoration: InputDecoration(
                            hintText: 'Ej: Gala dorada veneciana con labios ciruela...',
                            hintStyle: TextStyle(color: Colors.white.withValues(alpha: 0.4), fontSize: 12),
                            filled: true,
                            fillColor: Colors.white.withValues(alpha: 0.08),
                            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(10),
                              borderSide: BorderSide.none,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      ElevatedButton(
                        onPressed: _isGeneratingCustomLook ? null : _handleCustomPromptGenerate,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFFC5A052),
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        ),
                        child: _isGeneratingCustomLook
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : const Text('Crear', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Category Filter Pills
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: _categories.map((cat) {
                  final isSelected = _selectedCategory == cat;
                  return Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(cat),
                      selected: isSelected,
                      selectedColor: const Color(0xFFF3D59B).withValues(alpha: 0.4),
                      backgroundColor: Colors.white,
                      labelStyle: TextStyle(
                        fontSize: 12,
                        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                        color: isSelected ? const Color(0xFF1F1A15) : Colors.grey[700],
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(20),
                        side: BorderSide(
                          color: isSelected ? const Color(0xFFC5A052) : const Color(0xFFEADBCE),
                        ),
                      ),
                      onSelected: (val) {
                        if (val) setState(() => _selectedCategory = cat);
                      },
                    ),
                  );
                }).toList(),
              ),
            ),
            const SizedBox(height: 16),

            // Looks List
            ..._filteredLooks.map((look) => _buildLookCard(look)),
          ],
        ),
      ),
    );
  }

  Widget _buildLookCard(MakeupLook look) {
    return Container(
      margin: const EdgeInsets.only(bottom: 20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFEADBCE), width: 1.2),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 8,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Card Header
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: const Color(0xFFFAF5ED),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFF3D59B)),
                  ),
                  child: Center(
                    child: Text(look.iconEmoji, style: const TextStyle(fontSize: 24)),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              look.title,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                                color: Color(0xFF1F1A15),
                              ),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF3D59B).withValues(alpha: 0.3),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              look.finishType,
                              style: const TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w700,
                                color: Color(0xFF8B6B23),
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        look.subtitle,
                        style: TextStyle(fontSize: 12, color: Colors.grey[600]),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Description
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text(
              look.description,
              style: const TextStyle(fontSize: 12, height: 1.35, color: Colors.black87),
            ),
          ),
          const SizedBox(height: 12),

          // Color Palette Swatches
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'PALETA ARMONIZADA DE TONOS:',
                  style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, letterSpacing: 0.8, color: Color(0xFF8E7D7A)),
                ),
                const SizedBox(height: 8),
                Row(
                  children: look.swatches.map((swatch) {
                    return Expanded(
                      child: Container(
                        margin: const EdgeInsets.only(right: 6),
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFAF8F5),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: Colors.black12),
                        ),
                        child: Column(
                          children: [
                            Container(
                              width: 24,
                              height: 24,
                              decoration: BoxDecoration(
                                color: swatch.color,
                                shape: BoxShape.circle,
                                border: Border.all(color: Colors.black26),
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              swatch.name,
                              style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w600),
                              textAlign: TextAlign.center,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            Text(
                              swatch.hex,
                              style: TextStyle(fontSize: 8, color: Colors.grey[600]),
                            ),
                          ],
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // Action Buttons: VTO Live + Reservar
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFFAF8F5),
              borderRadius: const BorderRadius.vertical(bottom: Radius.circular(16)),
              border: Border(top: BorderSide(color: Colors.grey.withValues(alpha: 0.15))),
            ),
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () {
                          if (widget.biometricResult != null) {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => VtoLiveScreen(biometricResult: widget.biometricResult!),
                              ),
                            );
                          } else {
                            Navigator.pushNamed(context, '/ideas');
                          }
                        },
                        icon: const Icon(Icons.camera_alt_outlined, size: 16, color: Color(0xFFC5A052)),
                        label: const Text(
                          'Probar en VTO Live',
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF1F1A15)),
                        ),
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: Color(0xFFC5A052)),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                          padding: const EdgeInsets.symmetric(vertical: 10),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                ElevatedButton.icon(
                  onPressed: () => _bookMakeupArtist(look),
                  icon: const Icon(Icons.auto_awesome, size: 16, color: Colors.white),
                  label: const Text(
                    '✨ Quiero este Look: Reservar Maquilladora',
                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFC5A052),
                    minimumSize: const Size(double.infinity, 44),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    elevation: 1,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
