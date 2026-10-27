// frontend/lib/screens/ideas/results_screen.dart
import 'package:glow_core/glow_core.dart';
import 'package:flutter/material.dart';
import 'glowstore_recipe_screen.dart';
import 'product_scanner_screen.dart';
import 'vto_live_screen.dart';
import 'nail_vto_screen.dart';
import 'makeup_lookbook_screen.dart';
import 'evolution_screen.dart';
import '../widgets/score_card.dart';
import '../widgets/recommendation_card.dart';
import '../widgets/product_card.dart';
import '../widgets/color_palette.dart';
import '../widgets/glow_score_gauge_widget.dart';
import '../widgets/dermo_families_widget.dart';

// ---------------------------------------------------------------------------
// Tokens de marca para esta pantalla estilo Pasaporte Editorial
// ---------------------------------------------------------------------------
class _PassportColors {
  static const primary = Color(0xFFC5A052); // Haute Joaillerie Gold 871
  static const primaryLight = Color(0xFFF3D59B);
  static const background = Color(0xFFFAF8F5);
  static const surface = Colors.white;
  static const textAccent = Color(0xFF1F1A15);
  static const textEyebrow = Color(0xFF8E7D7A);
}

enum _PassportFilter { rostro, manos }

class ResultsScreen extends StatefulWidget {
  final BiometricResult result;

  const ResultsScreen({super.key, required this.result});

  @override
  State<ResultsScreen> createState() => _ResultsScreenState();
}

class _ResultsScreenState extends State<ResultsScreen> {
  List<ProductDetail> _recommendedProducts = [];
  bool _isLoadingProducts = true;
  bool _productLoadError = false;
  String? _uvRecommendation;
  bool _isLoadingUV = true;

  _PassportFilter _filter = _PassportFilter.rostro;

  final ScrollController _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _loadRecommendedProducts();
    _loadUV();
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadRecommendedProducts() async {
    setState(() {
      _isLoadingProducts = true;
      _productLoadError = false;
    });
    try {
      final products = await BiometricService.getRecommendedProducts();
      if (mounted) {
        setState(() {
          _recommendedProducts = products;
          _isLoadingProducts = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoadingProducts = false;
          _productLoadError = true;
        });
      }
    }
  }

  Future<void> _loadUV() async {
    try {
      final uvData = await BiometricService.getUV();
      if (!mounted) return;
      if (uvData != null && uvData['recommendation'] != null) {
        setState(() {
          _uvRecommendation = uvData['recommendation'];
          _isLoadingUV = false;
        });
      } else {
        setState(() => _isLoadingUV = false);
      }
    } catch (e) {
      if (mounted) setState(() => _isLoadingUV = false);
    }
  }

  String _getHexColorFromSubtono(String subtono) {
    switch (subtono.toLowerCase()) {
      case 'cálido':
        return 'F4A460';
      case 'frío':
        return 'B0C4DE';
      case 'neutro':
      default:
        return 'D4A574';
    }
  }

  void _goBackToIdeas() {
    Navigator.pushNamedAndRemoveUntil(context, '/home', (route) => false);
  }

  @override
  Widget build(BuildContext context) {
    final face = widget.result.face;
    final hands = widget.result.hands;

    return Scaffold(
      backgroundColor: _PassportColors.background,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: Column(
              children: [
                _buildHeader(),
            Expanded(
              child: SingleChildScrollView(
                controller: _scrollController,
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (face != null) _buildHero(face),
                    const SizedBox(height: 16),
                    _buildFilterPills(),
                    const SizedBox(height: 14),
                    if (_filter == _PassportFilter.rostro && face != null)
                      _buildFaceScores(face)
                    else if (_filter == _PassportFilter.manos && hands != null)
                      _buildHandsScores(hands),
                    const SizedBox(height: 20),
                    RecommendationCard(
                      recommendation: widget.result.recommendation ??
                          'No se generaron recomendaciones específicas.',
                    ),
                    const SizedBox(height: 14),
                    if (!_isLoadingUV && _uvRecommendation != null) ...[
                      _buildUVBanner(),
                      const SizedBox(height: 20),
                    ],
                    // Y-F6: la serie completa, para ver el cambio contra escaneos
                    // anteriores y no sólo el veredicto del último.
                    OutlinedButton.icon(
                      onPressed: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => const EvolutionScreen()),
                        );
                      },
                      icon: const Icon(Icons.show_chart, color: _PassportColors.primary),
                      label: const Text(
                        '📈 Ver mi evolución',
                        style: TextStyle(
                          color: _PassportColors.textAccent,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size(double.infinity, 48),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    if (face != null) ...[
                      ColorPaletteWidget(
                        hexColor: _getHexColorFromSubtono(face.subtono),
                      ),
                      const SizedBox(height: 12),
                      ElevatedButton.icon(
                        onPressed: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => VtoLiveScreen(biometricResult: widget.result),
                            ),
                          );
                        },
                        icon: const Icon(Icons.auto_awesome, color: Colors.white),
                        label: const Text(
                          '💄 Probar Maquillaje en VTO Live (DeepSeek IA)',
                          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: _PassportColors.primary,
                          minimumSize: const Size(double.infinity, 48),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      OutlinedButton.icon(
                        onPressed: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => NailVtoScreen(biometricResult: widget.result),
                            ),
                          );
                        },
                        icon: const Icon(Icons.back_hand, color: _PassportColors.primary),
                        label: const Text(
                          '💅 Probar Manicura & Uñas en VTO Live',
                          style: TextStyle(color: _PassportColors.textAccent, fontWeight: FontWeight.bold),
                        ),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(double.infinity, 48),
                          side: const BorderSide(color: _PassportColors.primary),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      OutlinedButton.icon(
                        onPressed: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => MakeupLookbookScreen(biometricResult: widget.result),
                            ),
                          );
                        },
                        icon: const Icon(Icons.palette_outlined, color: _PassportColors.primary),
                        label: const Text(
                          '🎨 Lookbook IA & Filtros Virtuales (Media.io)',
                          style: TextStyle(color: _PassportColors.textAccent, fontWeight: FontWeight.bold),
                        ),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(double.infinity, 48),
                          side: const BorderSide(color: _PassportColors.primary),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      OutlinedButton.icon(
                        onPressed: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => const GlowstoreRecipeScreen(),
                            ),
                          );
                        },
                        icon: const Icon(Icons.shopping_bag_outlined, color: _PassportColors.primary),
                        label: const Text(
                          '🛍️ Ver Receta Personalizada en GlowStore',
                          style: TextStyle(color: _PassportColors.textAccent, fontWeight: FontWeight.bold),
                        ),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(double.infinity, 48),
                          side: const BorderSide(color: _PassportColors.primary),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      // ─── Exportación Social (TikTok / Instagram) ───
                      Row(
                        children: [
                          Expanded(
                            child: ElevatedButton.icon(
                              onPressed: () async {
                                final consent = await SocialShareService.showConsentModal(
                                  context,
                                  platformName: 'TikTok',
                                  contentTypeLabel: 'Colorimetría IA',
                                );
                                if (consent && context.mounted) {
                                  final res = await SocialShareService.logShare(
                                    platform: 'TIKTOK',
                                    contentType: 'AI_COLORIMETRY',
                                  );
                                  if (context.mounted) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(
                                        content: Text(res['message'] ?? '¡Palette DNA compartida en TikTok! +50 XP'),
                                        backgroundColor: const Color(0xFF25F4EE),
                                      ),
                                    );
                                  }
                                }
                              },
                              icon: const Icon(Icons.video_library_rounded, size: 18),
                              label: const Text('TikTok', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: Colors.black,
                                foregroundColor: Colors.white,
                                padding: const EdgeInsets.symmetric(vertical: 12),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: ElevatedButton.icon(
                              onPressed: () async {
                                final consent = await SocialShareService.showConsentModal(
                                  context,
                                  platformName: 'Instagram Stories',
                                  contentTypeLabel: 'Colorimetría IA',
                                );
                                if (consent && context.mounted) {
                                  final res = await SocialShareService.logShare(
                                    platform: 'INSTAGRAM',
                                    contentType: 'AI_COLORIMETRY',
                                  );
                                  if (context.mounted) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(
                                        content: Text(res['message'] ?? '¡Look publicado en Instagram Stories! +50 XP'),
                                        backgroundColor: const Color(0xFFE1306C),
                                      ),
                                    );
                                  }
                                }
                              },
                              icon: const Icon(Icons.camera_alt_outlined, size: 18),
                              label: const Text('Instagram', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFFE1306C),
                                foregroundColor: Colors.white,
                                padding: const EdgeInsets.symmetric(vertical: 12),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 20),
                    ],
                    _buildProductsSection(),
                  ],
                ),
              ),
            ),
            _buildBottomCta(),
          ],
        ),
      ),
    ),
  ),
);
  }

  // ---------------------------------------------------------------------
  // Header simple: back + título, reemplaza el AppBar + TabBar de Material
  // ---------------------------------------------------------------------
  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 4, 16, 4),
      child: Row(
        children: [
          IconButton(
            icon: const Icon(Icons.arrow_back, color: _PassportColors.textAccent),
            onPressed: _goBackToIdeas,
          ),
          const Text(
            'Tu pasaporte',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: _PassportColors.textEyebrow,
            ),
          ),
          const Spacer(),
          IconButton(
            icon: const Icon(Icons.ios_share, size: 18, color: _PassportColors.textAccent),
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Pasaporte listo para compartir'),
                  duration: Duration(seconds: 2),
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------
  // Hero: anillo de score con la edad biométrica como hallazgo principal
  // ---------------------------------------------------------------------
  /// Y-F3: una línea con el veredicto contra el baseline propio.
  /// Devuelve null cuando no hubo comparación: mostrar "sin cambios" cuando en
  /// realidad no se comparó sería una afirmación falsa.
  String? _deltaLabel(BiometricResult result) {
    final verdict = result.deltaVerdict;
    if (verdict == null) return null;

    final glow = result.deltaGlowScore;
    final detalle = (glow != null && glow.abs() >= 1)
        ? ' (Glow ${glow > 0 ? '+' : ''}${glow.toStringAsFixed(0)})'
        : '';

    switch (verdict) {
      case 'MEJORO':
        return 'Mejoró frente a tu escaneo anterior$detalle';
      case 'EMPEORO':
        return 'Empeoró frente a tu escaneo anterior$detalle';
      case 'MIXTO':
        return 'Cambió: unas métricas mejor, otras peor$detalle';
      case 'SIN_CAMBIO':
        return 'Sin cambios medibles frente a tu escaneo anterior';
      case 'SIN_BASELINE':
        return 'Primer escaneo: aún no hay con qué comparar';
      default:
        return null;
    }
  }

  Widget _buildHero(FaceScores face) {
    final hydrationFraction = (face.hydration.clamp(0, 100)) / 100;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        SizedBox(
          width: 64,
          height: 64,
          child: Stack(
            alignment: Alignment.center,
            children: [
              SizedBox(
                width: 64,
                height: 64,
                child: CircularProgressIndicator(
                  value: hydrationFraction,
                  strokeWidth: 6,
                  backgroundColor: _PassportColors.primaryLight.withValues(alpha: 0.3),
                  color: _PassportColors.primary,
                ),
              ),
              Container(
                width: 48,
                height: 48,
                decoration: const BoxDecoration(
                  color: _PassportColors.background,
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: Text(
                  '${face.bioAge}',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: _PassportColors.textAccent,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                face.subtonoMedido
                    ? 'Tono ${face.subtono} · piel ${face.pielTipo ?? 'sin dato'}'
                    : 'Piel ${face.pielTipo ?? 'sin dato'} · subtono sin medir',
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: _PassportColors.textAccent,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'Edad biológica estimada: ${face.bioAge} años',
                style: const TextStyle(
                  fontSize: 11,
                  color: _PassportColors.textEyebrow,
                ),
              ),
              // Y-F3: veredicto del cambio contra el escaneo anterior. Solo se muestra
              // cuando el backend pudo comparar; nunca se inventa una mejora.
              if (_deltaLabel(widget.result) != null) ...[
                const SizedBox(height: 2),
                Text(
                  _deltaLabel(widget.result)!,
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: _PassportColors.textAccent,
                  ),
                ),
              ],
              // Y-F5: si la medición se reutilizó, se dice. Presentar métricas recicladas
              // como un análisis nuevo sería engañoso.
              if (widget.result.cacheHit) ...[
                const SizedBox(height: 2),
                const Text(
                  'Medición reutilizada de tu foto anterior',
                  style: TextStyle(
                    fontSize: 11,
                    fontStyle: FontStyle.italic,
                    color: _PassportColors.textEyebrow,
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------
  // Pills rostro/manos: reemplazan las tabs, solo filtran las score cards.
  // ---------------------------------------------------------------------
  Widget _buildFilterPills() {
    Widget pill(String label, _PassportFilter value) {
      final selected = _filter == value;
      return GestureDetector(
        onTap: () => setState(() => _filter = value),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
          decoration: BoxDecoration(
            color: selected ? _PassportColors.primaryLight.withValues(alpha: 0.35) : Colors.transparent,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: selected ? Colors.transparent : Colors.black12,
            ),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: selected ? _PassportColors.textAccent : Colors.grey[600],
              fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
            ),
          ),
        ),
      );
    }

    return Row(
      children: [
        pill('Rostro', _PassportFilter.rostro),
        const SizedBox(width: 8),
        pill('Manos', _PassportFilter.manos),
      ],
    );
  }

  // ---------------------------------------------------------------------
  // Scores: Evimetra Gauge + GridView 2x2 + Bioderma Clinical Families
  // ---------------------------------------------------------------------
  Widget _buildFaceScores(FaceScores face) {
    final computedGlowScore = widget.result.glowScore ??
        ((face.hydration * 0.35) + ((100 - face.spots) * 0.25) + ((100 - face.pores) * 0.25) + ((100 - face.wrinkles) * 0.15)).round().clamp(0, 100);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        GlowScoreGaugeWidget(
          glowScore: computedGlowScore,
          onCompareTap: () {
            Navigator.pushNamed(context, '/evolution');
          },
        ),
        const SizedBox(height: 12),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 2.6,
          children: [
            ScoreCard(
              label: 'Hidratación',
              value: face.hydration,
              color: _PassportColors.primary,
              icon: Icons.water_drop_outlined,
            ),
            ScoreCard(
              label: 'Arrugas',
              // Menor es mejor: se invierte para que la barra comunique "salud".
              value: 100 - face.wrinkles,
              color: _PassportColors.primary,
              icon: Icons.auto_awesome_outlined,
            ),
            ScoreCard(
              label: 'Manchas',
              value: 100 - face.spots,
              color: _PassportColors.primary,
              icon: Icons.blur_on,
            ),
            ScoreCard(
              label: 'Poros',
              value: 100 - face.pores,
              color: _PassportColors.primary,
              icon: Icons.center_focus_strong_outlined,
            ),
          ],
        ),
        if (widget.result.dermoFamilies != null) ...[
          const SizedBox(height: 14),
          DermoFamiliesWidget(dermoFamilies: widget.result.dermoFamilies!),
        ],
      ],
    );
  }

  Widget _buildHandsScores(HandsDiagnosis hands) {
    Widget row(String label, String value, IconData icon) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: _PassportColors.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.black12),
        ),
        child: Row(
          children: [
            Icon(icon, size: 16, color: _PassportColors.textEyebrow),
            const SizedBox(width: 8),
            Text(label, style: const TextStyle(fontSize: 12, color: Colors.black87)),
            const Spacer(),
            Text(
              value,
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: _PassportColors.textAccent,
              ),
            ),
          ],
        ),
      );
    }

    return Column(
      children: [
        row('Manchas solares', hands.manchasSolares, Icons.wb_sunny_outlined),
        row('Sequedad', hands.sequedad, Icons.water_drop_outlined),
        row('Cutículas', hands.cuticulas, Icons.back_hand_outlined),
        row('Uñas', hands.unas, Icons.brush_outlined),
        row('Edad aparente', '${hands.edadAparente} años', Icons.calendar_today_outlined),
      ],
    );
  }

  Widget _buildUVBanner() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: _PassportColors.surface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.wb_sunny_outlined, size: 18, color: Color(0xFF854F0B)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              _uvRecommendation!,
              style: const TextStyle(fontSize: 12, height: 1.5, color: Colors.black87),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildProductsSection() {
    if (_isLoadingProducts) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: Center(
          child: CircularProgressIndicator(color: _PassportColors.primary),
        ),
      );
    }
    if (_productLoadError) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'No pudimos cargar tus productos recomendados.',
              style: TextStyle(fontSize: 13, color: Colors.black87),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: _loadRecommendedProducts,
              child: const Text('Reintentar', style: TextStyle(color: _PassportColors.primary)),
            ),
          ],
        ),
      );
    }
    if (_recommendedProducts.isEmpty) {
      return const SizedBox();
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Productos recomendados',
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: _PassportColors.textAccent,
          ),
        ),
        const SizedBox(height: 10),
        ..._recommendedProducts.map((p) => ProductCard(product: p)),
      ],
    );
  }

  // ---------------------------------------------------------------------
  // CTA fijo: botón único sólido "Ver rutina recomendada"
  // ---------------------------------------------------------------------
  Widget _buildBottomCta() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      decoration: BoxDecoration(
        color: _PassportColors.surface,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: SizedBox(
        width: double.infinity,
        child: ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: _PassportColors.primary,
            foregroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(10),
            ),
            elevation: 0,
          ),
          onPressed: () {
            Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const ProductScannerScreen()),
            );
          },
          child: const Text(
            'Ver rutina recomendada',
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
          ),
        ),
      ),
    );
  }
}
