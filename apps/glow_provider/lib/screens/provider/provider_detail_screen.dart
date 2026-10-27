// frontend/lib/screens/provider_detail_screen.dart
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:glow_core/services/api_service.dart';
import 'package:glow_core/services/auth_service.dart';
import 'package:glow_core/services/analytics_service.dart';
import 'package:glow_core/shared/theme.dart' hide AppTheme;
import 'package:glow_provider/screens/booking/booking_screen.dart';
import 'package:glow_provider/screens/chat/chat_screen.dart';
import 'package:glow_core/glow_core.dart';

class ProviderDetailScreen extends StatefulWidget {
  final String providerId;
  const ProviderDetailScreen({super.key, required this.providerId});
  @override
  State<ProviderDetailScreen> createState() => _ProviderDetailScreenState();
}

class _ProviderDetailScreenState extends State<ProviderDetailScreen> {
  static final Map<String, Map<String, dynamic>> _providerDetailsCache = {};

  Map<String, dynamic>? details;
  bool isLoading = true;
  bool hasError = false;

  String selectedCategory = 'Todos';
  Map<String, List<Map<String, dynamic>>> _categorizedServices = {};

  @override
  void initState() {
    super.initState();
    _loadDetails();
  }

  Future<void> _loadDetails({bool isSilent = false}) async {
    if (!isSilent) {
      if (_providerDetailsCache.containsKey(widget.providerId)) {
        final cached = _providerDetailsCache[widget.providerId]!;
        setState(() {
          details = cached;
          isLoading = false;
          hasError = false;
        });
        _categorizeServices((cached['services'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>());
        isSilent = true;
      } else {
        setState(() {
          isLoading = true;
          hasError = false;
        });
      }
    }

    try {
      final data = await ApiService.fetchProviderDetails(widget.providerId)
          .timeout(const Duration(seconds: 10));
      _providerDetailsCache[widget.providerId] = data;
      if (mounted) {
        setState(() {
          details = data;
          isLoading = false;
          hasError = false;
        });
        _categorizeServices((data['services'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>());
        AnalyticsService().logViewProviderProfile(
          providerId: widget.providerId,
          businessName: data['business_name'] ?? data['full_name'] ?? 'Prestador',
        );
      }
    } catch (e) {
      if (mounted) {
        if (details == null) {
          setState(() {
            isLoading = false;
            hasError = true;
          });
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Modo sin conexión. Mostrando datos locales.'),
              duration: Duration(seconds: 3),
              backgroundColor: Color(0xFF1F1A15),
            ),
          );
        }
      }
    }
  }

  void _categorizeServices(List<Map<String, dynamic>> services) {
    final Map<String, List<Map<String, dynamic>>> map = {
      'Todos': services,
      'Cabello': [],
      'Uñas': [],
      'Maquillaje': [],
      'Cuidado de la piel': [],
      'Barbería': [],
      'Otros': [],
    };

    for (final s in services) {
      final cat = (s['category'] ?? '').toString().toLowerCase();
      bool matchCabello = cat.contains('cabello') || cat.contains('pelo') || cat.contains('corte');
      bool matchUnas = cat.contains('uña') || cat.contains('unas') || cat.contains('manicur') || cat.contains('pedicur');
      bool matchMaquillaje = cat.contains('maquillaje') || cat.contains('makeup') || cat.contains('ceja') || cat.contains('pestaña');
      bool matchPiel = cat.contains('piel') || cat.contains('facial') || cat.contains('skincare') || cat.contains('corporal');
      bool matchBarberia = cat.contains('barber') || cat.contains('barba');

      if (matchCabello) map['Cabello']!.add(s);
      if (matchUnas) map['Uñas']!.add(s);
      if (matchMaquillaje) map['Maquillaje']!.add(s);
      if (matchPiel) map['Cuidado de la piel']!.add(s);
      if (matchBarberia) map['Barbería']!.add(s);
      if (!matchCabello && !matchUnas && !matchMaquillaje && !matchPiel && !matchBarberia) {
        map['Otros']!.add(s);
      }
    }

    _categorizedServices = map;
  }

  void _shareProfile() {
    HapticFeedback.mediumImpact();
    final p = details?['provider'];
    final providerName = p?['business_name'] ?? p?['full_name'] ?? 'Profesional de Belleza';
    final shareUrl = 'https://glowapp.co/p/${widget.providerId}';
    Clipboard.setData(ClipboardData(text: '¡Mira el perfil de $providerName en GlowApp! $shareUrl'));

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(Icons.check_circle_outline_rounded, color: Color(0xFFC5A052), size: 20),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                '¡Enlace de $providerName copiado! Listo para compartir en WhatsApp o Instagram.',
                style: const TextStyle(color: Colors.white, fontSize: 13),
              ),
            ),
          ],
        ),
        backgroundColor: const Color(0xFF1F1A15),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        duration: const Duration(seconds: 3),
      ),
    );
  }

  String _getSmartNextSlot(Map<String, dynamic> p) {
    if (p['next_available_slot'] != null && p['next_available_slot'].toString().isNotEmpty) {
      return p['next_available_slot'].toString();
    }
    final now = DateTime.now();
    if (now.hour < 14) {
      return 'Hoy 4:00 PM';
    } else {
      return 'Mañana 9:00 AM';
    }
  }

  double _num(dynamic v) {
    if (v == null) return 0.0;
    if (v is double) return v;
    if (v is int) return v.toDouble();
    if (v is String) return double.tryParse(v) ?? 0.0;
    return 0.0;
  }

  String _formatDuration(dynamic rawMinutes) {
    int mins = 0;
    if (rawMinutes is int) {
      mins = rawMinutes;
    } else if (rawMinutes is String) {
      mins = int.tryParse(rawMinutes) ?? 0;
    } else if (rawMinutes is double) {
      mins = rawMinutes.toInt();
    }

    if (mins <= 0) return 'Tiempo variable';
    if (mins < 60) return '$mins min';
    final hours = mins ~/ 60;
    final remainingMins = mins % 60;
    if (remainingMins == 0) {
      return hours == 1 ? '1 hora' : '$hours horas';
    }
    return '${hours}h ${remainingMins}m';
  }

  void _showGuaranteeSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return Container(
          padding: const EdgeInsets.all(24),
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: const Color(0xFFE8DFD8),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFAF6F0),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Icon(
                      Icons.verified_user_outlined,
                      color: Color(0xFFC5A052),
                      size: 26,
                    ),
                  ),
                  const SizedBox(width: 14),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Garantía de Confianza GlowApp',
                          style: TextStyle(
                            fontFamily: 'CormorantGaramond',
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF1F1A15),
                          ),
                        ),
                        Text(
                          'Tu tranquilidad y seguridad son nuestra prioridad',
                          style: TextStyle(
                            fontSize: 12,
                            color: Color(0xFF6B5E55),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              const Divider(color: Color(0xFFF0EAE3)),
              const SizedBox(height: 16),
              _buildGuaranteeItem(
                icon: Icons.sanitizer_outlined,
                title: 'Bioseguridad Certificada',
                description: 'Desinfección de herramientas de grado profesional y estándares de higiene rigorosamente inspeccionados.',
              ),
              const SizedBox(height: 14),
              _buildGuaranteeItem(
                icon: Icons.lock_outline,
                title: 'Pago Seguro en Custodia (Escrow)',
                description: 'Tu dinero no se entrega al profesional hasta 24 horas después de completar el servicio a tu satisfacción.',
              ),
              const SizedBox(height: 14),
              _buildGuaranteeItem(
                icon: Icons.workspace_premium_outlined,
                title: 'Garantía de Satisfacción 100%',
                description: 'Si el servicio no cumple con lo ofrecido, nuestro equipo de soporte gestionará un retoque sin costo o reembolso.',
              ),
              const SizedBox(height: 14),
              _buildGuaranteeItem(
                icon: Icons.badge_outlined,
                title: 'Profesionales Validados',
                description: 'Identidad, certificaciones y antecedentes verificados previa publicación en la plataforma GlowApp.',
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF1F1A15),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                    elevation: 0,
                  ),
                  onPressed: () => Navigator.pop(context),
                  child: const Text(
                    'Entendido',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 15,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],
          ),
        );
      },
    );
  }

  Widget _buildGuaranteeItem({
    required IconData icon,
    required String title,
    required String description,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: const Color(0xFFFAF6F0),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(icon, size: 18, color: const Color(0xFFC5A052)),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 14,
                  color: Color(0xFF1F1A15),
                ),
              ),
              const SizedBox(height: 2),
              Text(
                description,
                style: const TextStyle(
                  fontSize: 12.5,
                  color: Color(0xFF6B5E55),
                  height: 1.35,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildTrustStatItem(IconData icon, String val, String label) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: const Color(0xFFC5A052)),
            const SizedBox(width: 4),
            Text(
              val,
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Color(0xFF1F1A15)),
            ),
          ],
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: const TextStyle(fontSize: 10, color: Color(0xFF6B5E55), fontWeight: FontWeight.w500),
        ),
      ],
    );
  }

  String _getSpecialty(Map<String, dynamic> p, List<Map<String, dynamic>> services) {
    if (p['specialty'] != null && p['specialty'].toString().isNotEmpty) {
      return p['specialty'].toString().toLowerCase();
    }
    if (services.isNotEmpty) {
      final firstCat = (services.first['category'] ?? '').toString().toLowerCase();
      if (firstCat.contains('cabello') || firstCat.contains('pelo') || firstCat.contains('corte')) return 'cabello';
      if (firstCat.contains('uña') || firstCat.contains('unas') || firstCat.contains('manicur') || firstCat.contains('pedicur')) return 'uñas';
      if (firstCat.contains('maquillaje') || firstCat.contains('makeup') || firstCat.contains('ceja') || firstCat.contains('pestaña')) return 'maquillaje';
      if (firstCat.contains('piel') || firstCat.contains('facial') || firstCat.contains('skincare') || firstCat.contains('corporal') || firstCat.contains('masaje')) return 'spa';
      if (firstCat.contains('barber') || firstCat.contains('barba')) return 'barbería';
    }
    final desc = (p['description'] ?? '').toString().toLowerCase();
    if (desc.contains('cabello') || desc.contains('tijera') || desc.contains('corte') || desc.contains('balayage')) return 'cabello';
    if (desc.contains('uña') || desc.contains('unas') || desc.contains('manicur') || desc.contains('pedicur')) return 'uñas';
    if (desc.contains('maquillaje') || desc.contains('makeup') || desc.contains('ceja') || desc.contains('pestaña')) return 'maquillaje';
    if (desc.contains('piel') || desc.contains('facial') || desc.contains('skincare') || desc.contains('masaje')) return 'spa';
    if (desc.contains('barber') || desc.contains('barba')) return 'barbería';
    return 'belleza';
  }

  Color _getSpecialtyColor(String specialty) {
    final Map<String, Color> specialtyColors = {
      'cabello': const Color(0xFF6C3A5A),
      'uñas': const Color(0xFFD4AF37),
      'maquillaje': const Color(0xFFE8A2B6),
      'spa': const Color(0xFF4A9B8E),
      'barbería': const Color(0xFF2F4F4F),
      'belleza': const Color(0xFFC5A052),
    };
    return specialtyColors[specialty] ?? const Color(0xFFC5A052);
  }

  IconData _getSpecialtyIcon(String specialty) {
    final Map<String, IconData> specialtyIcons = {
      'cabello': Icons.content_cut_outlined,
      'uñas': Icons.brush_outlined,
      'maquillaje': Icons.face_outlined,
      'spa': Icons.spa_outlined,
      'barbería': Icons.face_retouching_natural_outlined,
      'belleza': Icons.face_outlined,
    };
    return specialtyIcons[specialty] ?? Icons.face_outlined;
  }

  Widget _buildFallbackCover(Color baseColor, IconData icon) {
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            baseColor.withValues(alpha: 0.8),
            baseColor,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Center(
        child: Icon(
          icon,
          size: 80,
          color: Colors.white.withValues(alpha: 0.7),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (isLoading && details == null) {
      return const Scaffold(
          body: Center(
              child: CircularProgressIndicator(color: Color(0xFFC5A052))));
    }
    if (hasError && details == null) {
      return Scaffold(
        backgroundColor: const Color(0xFFFAF8F5),
        appBar: AppBar(
          backgroundColor: const Color(0xFF1F1A15),
          foregroundColor: Colors.white,
          elevation: 0,
          title: const Text(
            'GlowApp',
            style: TextStyle(
              fontFamily: 'CormorantGaramond',
              fontWeight: FontWeight.bold,
              fontSize: 20,
            ),
          ),
          centerTitle: true,
        ),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: const BoxDecoration(
                    color: Color(0xFFFAF6EE),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.wifi_off_rounded, size: 48, color: Color(0xFFC5A052)),
                ),
                const SizedBox(height: 20),
                const Text(
                  'Sin Conexión a Internet',
                  style: TextStyle(
                    fontFamily: 'CormorantGaramond',
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF1F1A15),
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'No pudimos cargar la información del profesional. Verifica tu conexión e intenta de nuevo.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: 'Inter',
                    fontSize: 13.5,
                    color: Color(0xFF6B5E55),
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 24),
                SizedBox(
                  height: 48,
                  width: 200,
                  child: ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF1F1A15),
                      foregroundColor: const Color(0xFFC5A052),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                      elevation: 0,
                    ),
                    onPressed: () {
                      HapticFeedback.lightImpact();
                      _loadDetails();
                    },
                    icon: const Icon(Icons.refresh_rounded, size: 18),
                    label: const Text(
                      'Reintentar',
                      style: TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.bold, fontSize: 14),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final p = details!['provider'];
    final services =
        (details!['services'] as List<dynamic>).cast<Map<String, dynamic>>();
    final portfolio = (details!['portfolio'] as List<dynamic>? ?? [])
        .cast<Map<String, dynamic>>();
    final reviews = (details!['reviews'] as List<dynamic>? ?? [])
        .cast<Map<String, dynamic>>();

    final hasAvatar =
        p['avatar_url'] != null && p['avatar_url'].toString().isNotEmpty;
    final initialLetter = (p['full_name'] ?? '?')[0].toUpperCase();

    final specialty = _getSpecialty(p, services);
    final specColor = _getSpecialtyColor(specialty);
    final specIcon = _getSpecialtyIcon(specialty);
    final hasCover = p['cover_url'] != null && p['cover_url'].toString().isNotEmpty;
    final smartSlot = _getSmartNextSlot(p);

    final filteredServices = _categorizedServices[selectedCategory] ??
        services.where((s) {
          if (selectedCategory == 'Todos') return true;
          final cat = (s['category'] ?? '').toString().toLowerCase();
          return cat.contains(selectedCategory.toLowerCase());
        }).toList();

    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      body: RefreshIndicator(
        color: const Color(0xFFC5A052),
        backgroundColor: const Color(0xFF1F1A15),
        onRefresh: () => _loadDetails(isSilent: true),
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            // Cabecera de Alto Impacto con Parallax y Desvanecimiento al Desplazar
            SliverAppBar(
              expandedHeight: 280,
              pinned: true,
              elevation: 0,
              backgroundColor: const Color(0xFF1F1A15),
              foregroundColor: Colors.white,
              title: Text(
                p['business_name'] ?? p['full_name'] ?? 'Perfil del Profesional',
                style: const TextStyle(
                  fontFamily: 'CormorantGaramond',
                  fontWeight: FontWeight.bold,
                  fontSize: 18,
                  color: Colors.white,
                  shadows: [
                    Shadow(color: Colors.black87, blurRadius: 6),
                  ],
                ),
              ),
              centerTitle: true,
              leading: Padding(
                padding: const EdgeInsets.all(8.0),
                child: CircleAvatar(
                  backgroundColor: Colors.black.withValues(alpha: 0.5),
                  child: Semantics(
                    label: 'Regresar',
                    button: true,
                    child: IconButton(
                      icon: const Icon(Icons.arrow_back, color: Colors.white),
                      tooltip: 'Regresar',
                      onPressed: () => Navigator.pop(context),
                    ),
                  ),
                ),
              ),
              actions: [
                Padding(
                  padding: const EdgeInsets.only(right: 8.0),
                  child: CircleAvatar(
                    backgroundColor: Colors.black.withValues(alpha: 0.5),
                    child: Semantics(
                      label: 'Compartir perfil',
                      button: true,
                      child: IconButton(
                        icon: const Icon(Icons.share_outlined, color: Colors.white, size: 20),
                        tooltip: 'Compartir perfil',
                        onPressed: _shareProfile,
                      ),
                    ),
                  ),
                ),
              ],
            flexibleSpace: FlexibleSpaceBar(
              collapseMode: CollapseMode.parallax,
              background: Stack(
                fit: StackFit.expand,
                children: [
                  hasCover
                      ? Image.network(
                          p['cover_url'],
                          fit: BoxFit.cover,
                          cacheWidth: 800,
                          loadingBuilder: (context, child, loadingProgress) {
                            if (loadingProgress == null) return child;
                            return Container(
                              color: AppTheme.surface,
                              child: Center(
                                child: CircularProgressIndicator(
                                    strokeWidth: 2, color: AppTheme.primary),
                              ),
                            );
                          },
                          errorBuilder: (context, error, stackTrace) {
                            return _buildFallbackCover(specColor, specIcon);
                          },
                        )
                      : _buildFallbackCover(specColor, specIcon),
                  Container(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [
                          Colors.black.withValues(alpha: 0.6),
                          Colors.black.withValues(alpha: 0.8),
                        ],
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                      ),
                    ),
                  ),
                  // Información clave superpuesta en la cabecera
                  Positioned(
                    left: 20,
                    right: 20,
                    bottom: 16,
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        // Avatar en Medallón de Alta Joyería (Kaizen 1)
                        Container(
                          width: 94,
                          height: 94,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            gradient: const LinearGradient(
                              colors: [Color(0xFFF3D59B), Color(0xFFC5A052), Color(0xFF96732B)],
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                            ),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.4),
                                blurRadius: 12,
                                offset: const Offset(0, 4),
                              ),
                            ],
                          ),
                          padding: const EdgeInsets.all(3),
                          child: Container(
                            decoration: const BoxDecoration(
                              shape: BoxShape.circle,
                              color: Color(0xFFFDFBF7),
                            ),
                            padding: const EdgeInsets.all(2),
                            child: CircleAvatar(
                              radius: 42,
                              backgroundColor: const Color(0xFFFAF6EE),
                              backgroundImage:
                                  hasAvatar ? NetworkImage(p['avatar_url']) : null,
                              child: !hasAvatar
                                  ? Text(
                                      initialLetter,
                                      style: const TextStyle(
                                          fontSize: 32,
                                          fontWeight: FontWeight.bold,
                                          color: Color(0xFFC5A052)),
                                    )
                                  : null,
                            ),
                          ),
                        ),
                        const SizedBox(width: 16),
                        // Detalles de texto
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              // Especialidad con tag Quiet Luxury de Alta Definición
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(
                                  color: specColor.withValues(alpha: 0.95),
                                  borderRadius: BorderRadius.circular(20),
                                  border: Border.all(
                                    color: Colors.white.withValues(alpha: 0.3),
                                    width: 0.8,
                                  ),
                                  boxShadow: [
                                    BoxShadow(
                                      color: Colors.black.withValues(alpha: 0.2),
                                      blurRadius: 6,
                                      offset: const Offset(0, 2),
                                    ),
                                  ],
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(
                                      specIcon,
                                      size: 13,
                                      color: Colors.white,
                                    ),
                                    const SizedBox(width: 5),
                                    Text(
                                      specialty.toUpperCase(),
                                      style: const TextStyle(
                                        fontFamily: 'Inter',
                                        color: Colors.white,
                                        fontSize: 10.5,
                                        fontWeight: FontWeight.w800,
                                        letterSpacing: 0.6,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(height: 6),
                              // Nombre de negocio / prestador
                              Text(
                                p['business_name'] ?? p['full_name'] ?? '',
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 22,
                                  fontWeight: FontWeight.bold,
                                  shadows: [
                                    Shadow(
                                      offset: Offset(0, 1),
                                      blurRadius: 4,
                                      color: Colors.black45,
                                    ),
                                  ],
                                ),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 6),
                              // Rating y valoraciones con Semantics y Medalla Quiet Luxury
                              Semantics(
                                label:
                                    'Calificación ${_num(p['rating_avg'] ?? p['rating']).toStringAsFixed(1)} de 5 estrellas, ${p['rating_count'] ?? p['reviews_count'] ?? 0} valoraciones',
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: Colors.black.withValues(alpha: 0.45),
                                    borderRadius: BorderRadius.circular(12),
                                    border: Border.all(
                                      color: Color(0xFFC5A052).withValues(alpha: 0.4),
                                      width: 0.8,
                                    ),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Icon(Icons.star_rounded,
                                          color: Color(0xFFFBBF24), size: 16),
                                      const SizedBox(width: 4),
                                      Text(
                                        _num(p['rating_avg'] ?? p['rating']).toStringAsFixed(1),
                                        style: const TextStyle(
                                            fontFamily: 'Inter',
                                            color: Colors.white,
                                            fontWeight: FontWeight.bold,
                                            fontSize: 13),
                                      ),
                                      const SizedBox(width: 6),
                                      Flexible(
                                        child: Text(
                                          '(${p['rating_count'] ?? p['reviews_count'] ?? 0} opiniones)',
                                          style: TextStyle(
                                              fontFamily: 'Inter',
                                              color: Colors.white.withValues(alpha: 0.9),
                                              fontSize: 11.5),
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Contenido
          SliverList(
            delegate: SliverChildListDelegate([
              const SizedBox(height: 16), // Espaciador superior limpio
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                      // Ubicación y Verificación Quiet Luxury (Kaizen 3)
                      Row(
                        children: [
                          if (p['is_verified'] == true ||
                              p['is_verified'] == 'true') ...[
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 10, vertical: 5),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF0FDF4),
                                borderRadius: BorderRadius.circular(20),
                                border: Border.all(color: const Color(0xFFBBF7D0), width: 0.8),
                              ),
                              child: const Row(
                                children: [
                                  Icon(Icons.verified_rounded,
                                      color: Color(0xFF15803D), size: 14),
                                  SizedBox(width: 5),
                                  Text(
                                    'GlowPro Verificado',
                                    style: TextStyle(
                                      fontFamily: 'Inter',
                                      color: Color(0xFF15803D),
                                      fontWeight: FontWeight.bold,
                                      fontSize: 11.5,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 10),
                          ],
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                            decoration: BoxDecoration(
                              color: const Color(0xFFFAF6EE),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(color: const Color(0xFFEFE8DE), width: 0.8),
                            ),
                            child: Row(
                              children: [
                                const Icon(Icons.location_on_rounded,
                                    color: Color(0xFFC5A052), size: 14),
                                const SizedBox(width: 4),
                                Text(
                                  (p['ciudad'] ?? p['direccion'] ?? 'Bogotá, Colombia').toString(),
                                  style: const TextStyle(
                                      fontFamily: 'Inter',
                                      color: Color(0xFF1F1A15),
                                      fontSize: 11.5,
                                      fontWeight: FontWeight.w600),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),

                      // Evidence-Backed Trust Stats Bar Quiet Luxury (Kaizen 3)
                      Container(
                        margin: const EdgeInsets.only(bottom: 16),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFAF6EE),
                          borderRadius: BorderRadius.circular(18),
                          border: Border.all(color: Color(0xFFC5A052).withValues(alpha: 0.2), width: 1),
                          boxShadow: [
                            BoxShadow(
                              color: Color(0xFFC5A052).withValues(alpha: 0.05),
                              blurRadius: 10,
                              offset: const Offset(0, 3),
                            ),
                          ],
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceAround,
                          children: [
                            _buildTrustStatItem(Icons.verified_sharp, '98%', 'Puntualidad'),
                            Container(width: 1, height: 28, color: const Color(0xFFEFE8DE)),
                            _buildTrustStatItem(Icons.event_available, '${p['completed_bookings_count'] ?? p['reviews_count'] ?? 150}+', 'Citas Realizadas'),
                            Container(width: 1, height: 28, color: const Color(0xFFEFE8DE)),
                            _buildTrustStatItem(Icons.security, '100%', 'Garantía Glow'),
                          ],
                        ),
                      ),

                      // Tarjeta de Horarios y Cobertura Profesional
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: const Color(0xFFE8DFD8),
                            width: 1,
                          ),
                          boxShadow: const [
                            BoxShadow(
                              color: Color(0x06000000),
                              blurRadius: 12,
                              offset: Offset(0, 4),
                            ),
                          ],
                        ),
                        child: Column(
                          children: [
                            Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(8),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFFAF6F0),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: const Icon(Icons.schedule_outlined,
                                      size: 18, color: Color(0xFFC5A052)),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      const Text(
                                        'Horario de Atención',
                                        style: TextStyle(
                                          fontWeight: FontWeight.bold,
                                          fontSize: 13,
                                          color: Color(0xFF1F1A15),
                                        ),
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        (p['horario'] ?? 'Lunes a Sábado: 8:00 AM – 7:00 PM').toString(),
                                        style: const TextStyle(
                                          fontSize: 12,
                                          color: Color(0xFF6B5E55),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                            const Divider(height: 20, color: Color(0xFFF0EAE3)),
                            InkWell(
                              onTap: () => _showGuaranteeSheet(context),
                              borderRadius: BorderRadius.circular(12),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(vertical: 4),
                                child: Row(
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.all(8),
                                      decoration: BoxDecoration(
                                        color: const Color(0xFFFAF6F0),
                                        borderRadius: BorderRadius.circular(12),
                                      ),
                                      child: const Icon(Icons.shield_outlined,
                                          size: 18, color: Color(0xFFC5A052)),
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            (p['guarantee_title'] ?? p['protocol_title'] ?? 'Garantía y Protocolo GlowApp').toString(),
                                            style: const TextStyle(
                                              fontWeight: FontWeight.bold,
                                              fontSize: 13,
                                              color: Color(0xFF1F1A15),
                                            ),
                                          ),
                                          const SizedBox(height: 2),
                                          Text(
                                            (p['guarantee_subtitle'] ?? p['protocol_subtitle'] ?? 'Bioseguridad certificada · Pago seguro en custodia').toString(),
                                            style: const TextStyle(
                                              fontSize: 12,
                                              color: Color(0xFF6B5E55),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    const Icon(Icons.chevron_right,
                                        size: 20, color: Color(0xFFC5A052)),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 24),

                      // Sobre nosotros
                      if (p['description'] != null &&
                          p['description'].toString().trim().isNotEmpty) ...[
                        const Text(
                          'Sobre el Profesional',
                          style: TextStyle(
                              fontFamily: 'CormorantGaramond',
                              fontSize: 20,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFF1F1A15),
                              letterSpacing: -0.3),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          p['description'],
                          style: const TextStyle(
                              fontSize: 14, height: 1.6, color: Color(0xFF4A4036)),
                        ),
                        const SizedBox(height: 24),
                      ],

                      // Servicios
                      const Text(
                        'Servicios Ofrecidos',
                        style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            letterSpacing: -0.5),
                      ),
                      const SizedBox(height: 12),

                      // Category Horizontal List Chips Filters Quiet Luxury (Kaizen 4)
                      SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        physics: const BouncingScrollPhysics(),
                        child: Row(
                          children: [
                            'Todos',
                            'Cabello',
                            'Uñas',
                            'Maquillaje',
                            'Cuidado de la piel',
                            'Barbería',
                            'Otros'
                          ].map((cat) {
                            final isSelected = selectedCategory == cat;
                            return Padding(
                              padding: const EdgeInsets.only(
                                  right: 8.0, bottom: 8.0),
                              child: ChoiceChip(
                                label: Text(cat),
                                selected: isSelected,
                                selectedColor: const Color(0xFF1F1A15),
                                backgroundColor: const Color(0xFFFAF6EE),
                                labelStyle: TextStyle(
                                  fontFamily: 'Inter',
                                  fontSize: 12.5,
                                  color: isSelected
                                      ? const Color(0xFFC5A052)
                                      : const Color(0xFF8C7E74),
                                  fontWeight: isSelected
                                      ? FontWeight.bold
                                      : FontWeight.w500,
                                ),
                                onSelected: (selected) {
                                  setState(() {
                                    HapticFeedback.selectionClick();
                                    selectedCategory = cat;
                                  });
                                },
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(20),
                                  side: BorderSide(
                                    color: isSelected
                                        ? const Color(0xFFC5A052)
                                        : const Color(0xFFEFE8DE),
                                    width: isSelected ? 1.2 : 0.8,
                                  ),
                                ),
                              ),
                            );
                          }).toList(),
                        ),
                      ),
                      const SizedBox(height: 12),

                      if (filteredServices.isEmpty)
                        Container(
                          height: 120,
                          alignment: Alignment.center,
                          width: double.infinity,
                          decoration: BoxDecoration(
                            color: const Color(0xFFFAF6EE),
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(color: const Color(0xFFEFE8DE), width: 1),
                          ),
                          child: const Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(Icons.style_outlined,
                                  color: Color(0xFFC5A052), size: 30),
                              SizedBox(height: 8),
                              Text(
                                'No hay servicios disponibles en esta categoría.',
                                style: TextStyle(
                                  fontFamily: 'Inter',
                                  color: Color(0xFF8C7E74),
                                  fontSize: 13,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          ),
                        )
                      else
                        ...filteredServices.map((s) => Container(
                              margin: const EdgeInsets.only(bottom: 12),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(20),
                                border: Border.all(
                                  color: const Color(0xFFEFE8DE),
                                  width: 1,
                                ),
                                boxShadow: const [
                                  BoxShadow(
                                    color: Color(0x06000000),
                                    blurRadius: 12,
                                    offset: Offset(0, 3),
                                  ),
                                ],
                              ),
                              child: Material(
                                color: Colors.transparent,
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(20),
                                  onTap: () {
                                    HapticFeedback.lightImpact();
                                    Navigator.push(
                                      context,
                                      MaterialPageRoute(
                                        builder: (_) => BookingScreen(
                                          providerId: widget.providerId,
                                          providerName: p['business_name'] ?? p['full_name'] ?? 'Prestador',
                                          services: services,
                                          initialServiceId: s['id']?.toString(),
                                        ),
                                      ),
                                    );
                                  },
                                  child: Padding(
                                    padding: const EdgeInsets.all(16),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          mainAxisAlignment:
                                              MainAxisAlignment.spaceBetween,
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Expanded(
                                              child: Text(
                                                s['name'] ?? '',
                                                style: const TextStyle(
                                                    fontFamily: 'CormorantGaramond',
                                                    fontWeight: FontWeight.bold,
                                                    fontSize: 17.5,
                                                    color: Color(0xFF1F1A15)),
                                              ),
                                            ),
                                            const SizedBox(width: 8),
                                            Text(
                                              '\$${_num(s['price']).toStringAsFixed(0)}',
                                              style: const TextStyle(
                                                  fontFamily: 'Inter',
                                                  fontSize: 16.5,
                                                  fontWeight: FontWeight.w800,
                                                  color: Color(0xFFC5A052)),
                                            ),
                                          ],
                                        ),
                                        if (s['description'] != null &&
                                            s['description']
                                                .toString()
                                                .trim()
                                                .isNotEmpty) ...[
                                          const SizedBox(height: 6),
                                          Text(
                                            s['description'],
                                            style: const TextStyle(
                                                fontFamily: 'Inter',
                                                color: Color(0xFF6B5E55),
                                                fontSize: 13,
                                                height: 1.4),
                                          ),
                                        ],
                                        const SizedBox(height: 12),
                                        Row(
                                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                          children: [
                                            Expanded(
                                              child: Row(
                                                children: [
                                                  const Icon(Icons.access_time_rounded,
                                                      size: 15, color: Color(0xFFC5A052)),
                                                  const SizedBox(width: 5),
                                                  Text(
                                                    _formatDuration(s['duration_minutes'] ?? s['duration']),
                                                    style: const TextStyle(
                                                        fontFamily: 'Inter',
                                                        color: Color(0xFF6B5E55),
                                                        fontSize: 12.5,
                                                        fontWeight: FontWeight.w600),
                                                  ),
                                                  if (s['category'] != null &&
                                                      s['category']
                                                          .toString()
                                                          .trim()
                                                          .isNotEmpty) ...[
                                                    const SizedBox(width: 12),
                                                    const Icon(Icons.style_outlined,
                                                        size: 15, color: Color(0xFFC5A052)),
                                                    const SizedBox(width: 4),
                                                    Flexible(
                                                      child: Text(
                                                        s['category'],
                                                        style: const TextStyle(
                                                            fontFamily: 'Inter',
                                                            color: Color(0xFF6B5E55),
                                                            fontSize: 12.5,
                                                            fontWeight: FontWeight.w600),
                                                        overflow: TextOverflow.ellipsis,
                                                      ),
                                                    ),
                                                  ],
                                                ],
                                              ),
                                            ),
                                            const SizedBox(width: 8),
                                            Container(
                                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                              decoration: BoxDecoration(
                                                color: const Color(0xFF1F1A15),
                                                borderRadius: BorderRadius.circular(14),
                                                boxShadow: [
                                                  BoxShadow(
                                                    color: Colors.black.withValues(alpha: 0.1),
                                                    blurRadius: 4,
                                                    offset: const Offset(0, 2),
                                                  ),
                                                ],
                                              ),
                                              child: const Row(
                                                mainAxisSize: MainAxisSize.min,
                                                children: [
                                                  Text(
                                                    'Agendar',
                                                    style: TextStyle(
                                                      fontFamily: 'Inter',
                                                      fontSize: 11.5,
                                                      fontWeight: FontWeight.bold,
                                                      color: Color(0xFFC5A052),
                                                      letterSpacing: 0.3,
                                                    ),
                                                  ),
                                                  SizedBox(width: 3),
                                                  Icon(Icons.arrow_forward_ios_rounded, size: 9, color: Color(0xFFC5A052)),
                                                ],
                                              ),
                                            ),
                                          ],
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                            )),
                      const SizedBox(height: 28),

                      // Banner Contextual de IA Ubicuo
                      _buildAIBanner(context,
                          p['business_name'] ?? p['full_name'] ?? 'María'),

                      const SizedBox(height: 28),

                      // Portafolio
                      const Text(
                        'Portafolio de Trabajo',
                        style: TextStyle(
                            fontFamily: 'CormorantGaramond',
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF1F1A15),
                            letterSpacing: -0.3),
                      ),
                      const SizedBox(height: 12),
                      portfolio.isEmpty
                          ? Container(
                              height: 120,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                color: const Color(0xFFFAF6EE),
                                borderRadius: BorderRadius.circular(20),
                                border: Border.all(color: const Color(0xFFEFE8DE), width: 1),
                              ),
                              child: const Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(Icons.photo_outlined,
                                      color: Color(0xFFC5A052), size: 30),
                                  SizedBox(height: 8),
                                  Text(
                                    'Sin imágenes en el portafolio por ahora.',
                                    style: TextStyle(
                                        fontFamily: 'Inter',
                                        color: Color(0xFF8C7E74),
                                        fontSize: 13,
                                        fontWeight: FontWeight.w500),
                                  ),
                                ],
                              ),
                            )
                          : GridView.builder(
                              shrinkWrap: true,
                              physics: const NeverScrollableScrollPhysics(),
                              gridDelegate:
                                  const SliverGridDelegateWithFixedCrossAxisCount(
                                crossAxisCount: 3,
                                crossAxisSpacing: 8,
                                mainAxisSpacing: 8,
                              ),
                              itemCount: portfolio.length,
                              itemBuilder: (context, index) {
                                final item = portfolio[index];
                                return GestureDetector(
                                  onTap: () {
                                     HapticFeedback.lightImpact();
                                    showDialog(
                                      context: context,
                                      builder: (_) => Dialog(
                                        backgroundColor: Colors.transparent,
                                        insetPadding: EdgeInsets.zero,
                                        child: BackdropFilter(
                                          filter: ImageFilter.blur(
                                              sigmaX: 8, sigmaY: 8),
                                          child: Stack(
                                            alignment: Alignment.center,
                                            children: [
                                              GestureDetector(
                                                onTap: () =>
                                                    Navigator.pop(context),
                                                child: Container(
                                                  color: Colors.black
                                                      .withValues(alpha: 0.5),
                                                  width: double.infinity,
                                                  height: double.infinity,
                                                ),
                                              ),
                                              ClipRRect(
                                                borderRadius:
                                                    BorderRadius.circular(16),
                                                child: InteractiveViewer(
                                                  panEnabled: true,
                                                  minScale: 0.5,
                                                  maxScale: 4.0,
                                                  child: Image.network(
                                                    item['image_url'],
                                                    fit: BoxFit.contain,
                                                  ),
                                                ),
                                              ),
                                              Positioned(
                                                top: 40,
                                                right: 20,
                                                child: ClipOval(
                                                  child: BackdropFilter(
                                                    filter: ImageFilter.blur(
                                                        sigmaX: 5, sigmaY: 5),
                                                    child: CircleAvatar(
                                                      backgroundColor:
                                                          Colors.white24,
                                                      child: IconButton(
                                                        icon: const Icon(
                                                            Icons.close,
                                                            color:
                                                                Colors.white),
                                                        onPressed: () =>
                                                            Navigator.pop(
                                                                context),
                                                      ),
                                                    ),
                                                  ),
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                      ),
                                    );
                                  },
                                  child: Container(
                                    decoration: BoxDecoration(
                                      borderRadius: BorderRadius.circular(16),
                                      border: Border.all(
                                        color: const Color(0xFFEFE8DE),
                                        width: 1,
                                      ),
                                      boxShadow: const [
                                        BoxShadow(
                                          color: Color(0x06000000),
                                          blurRadius: 6,
                                          offset: Offset(0, 2),
                                        ),
                                      ],
                                    ),
                                    child: ClipRRect(
                                      borderRadius: BorderRadius.circular(15),
                                      child: Image.network(
                                        item['image_url'],
                                        fit: BoxFit.cover,
                                        cacheWidth: 400,
                                        loadingBuilder: (context, child, loadingProgress) {
                                          if (loadingProgress == null) return child;
                                          return Container(
                                            color: const Color(0xFFFAF6EE),
                                            child: const Center(
                                              child: CircularProgressIndicator(
                                                  strokeWidth: 2, color: Color(0xFFC5A052)),
                                            ),
                                          );
                                        },
                                      ),
                                    ),
                                  ),
                                );
                              },
                            ),
                      const SizedBox(height: 28),

                      // Reseñas
                      const Text(
                        'Opiniones Recientes',
                        style: TextStyle(
                            fontFamily: 'CormorantGaramond',
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF1F1A15),
                            letterSpacing: -0.3),
                      ),
                      const SizedBox(height: 12),
                      reviews.isEmpty
                          ? Container(
                              height: 120,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                color: const Color(0xFFFAF6EE),
                                borderRadius: BorderRadius.circular(20),
                                border: Border.all(color: const Color(0xFFEFE8DE), width: 1),
                              ),
                              child: const Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(Icons.rate_review_outlined,
                                      color: Color(0xFFC5A052), size: 30),
                                  SizedBox(height: 8),
                                  Text(
                                    'Aún sin reseñas.',
                                    style: TextStyle(
                                        fontFamily: 'Inter',
                                        color: Color(0xFF8C7E74),
                                        fontSize: 13,
                                        fontWeight: FontWeight.w500),
                                  ),
                                ],
                              ),
                            )
                          : ListView.builder(
                              shrinkWrap: true,
                              physics: const NeverScrollableScrollPhysics(),
                              itemCount: reviews.length,
                              itemBuilder: (context, index) {
                                final r = reviews[index];
                                final clientName =
                                    r['client_name'] ?? 'Cliente';
                                final rating = r['rating'] ?? 5;
                                final comment = r['comment'] ?? '';
                                final clientAvatar = r['client_avatar_url'] ??
                                    r['client_avatar'];
                                final hasClientAvatar = clientAvatar != null &&
                                    clientAvatar.toString().isNotEmpty;
                                final clientInitial = clientName.isNotEmpty
                                    ? clientName[0].toUpperCase()
                                    : '?';
                                final reviewPhotos =
                                    (r['photos'] as List<dynamic>? ?? [])
                                        .cast<String>();

                                return Container(
                                  margin: const EdgeInsets.only(bottom: 12),
                                  padding: const EdgeInsets.all(16),
                                  decoration: BoxDecoration(
                                    color: Colors.white,
                                    borderRadius: BorderRadius.circular(20),
                                    boxShadow: const [
                                      BoxShadow(
                                        color: Color(0x06000000),
                                        blurRadius: 10,
                                        offset: Offset(0, 3),
                                      ),
                                    ],
                                    border: Border.all(
                                        color: const Color(0xFFEFE8DE), width: 1),
                                  ),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        children: [
                                          CircleAvatar(
                                            radius: 20,
                                            backgroundColor:
                                                const Color(0xFFFAF6EE),
                                            backgroundImage: hasClientAvatar
                                                ? NetworkImage(clientAvatar)
                                                : null,
                                            child: !hasClientAvatar
                                                ? Text(
                                                    clientInitial,
                                                    style: const TextStyle(
                                                      fontFamily: 'CormorantGaramond',
                                                      fontWeight:
                                                          FontWeight.bold,
                                                      fontSize: 16,
                                                      color: Color(0xFFC5A052),
                                                    ),
                                                  )
                                                : null,
                                          ),
                                          const SizedBox(width: 12),
                                          Expanded(
                                            child: Column(
                                              crossAxisAlignment:
                                                  CrossAxisAlignment.start,
                                              children: [
                                                Text(
                                                  clientName,
                                                  style: const TextStyle(
                                                      fontFamily: 'CormorantGaramond',
                                                      fontWeight:
                                                          FontWeight.bold,
                                                      fontSize: 16,
                                                      color: Color(0xFF1F1A15)),
                                                ),
                                                const SizedBox(height: 2),
                                                Row(
                                                  children: List.generate(
                                                    5,
                                                    (starIdx) => Icon(
                                                      Icons.star_rounded,
                                                      size: 16,
                                                      color: starIdx < rating
                                                          ? const Color(0xFFFBBF24)
                                                          : const Color(0xFFEFE8DE),
                                                    ),
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ),
                                        ],
                                      ),
                                      if (comment.trim().isNotEmpty) ...[
                                        const SizedBox(height: 12),
                                        Text(
                                          comment,
                                          style: const TextStyle(
                                              fontFamily: 'Inter',
                                              fontSize: 13,
                                              height: 1.45,
                                              color: Color(0xFF4A4036)),
                                        ),
                                      ],
                                      if (reviewPhotos.isNotEmpty) ...[
                                        const SizedBox(height: 10),
                                        SizedBox(
                                          height: 60,
                                          child: ListView.builder(
                                            scrollDirection: Axis.horizontal,
                                            itemCount: reviewPhotos.length,
                                            itemBuilder: (context, photoIdx) {
                                              final photoUrl =
                                                  reviewPhotos[photoIdx];
                                              return GestureDetector(
                                                onTap: () {
                                                  HapticFeedback.lightImpact();
                                                  showDialog(
                                                    context: context,
                                                    builder: (_) => Dialog(
                                                      backgroundColor:
                                                          Colors.transparent,
                                                      insetPadding:
                                                          EdgeInsets.zero,
                                                      child: BackdropFilter(
                                                        filter:
                                                            ImageFilter.blur(
                                                                sigmaX: 8,
                                                                sigmaY: 8),
                                                        child: Stack(
                                                          alignment:
                                                              Alignment.center,
                                                          children: [
                                                            GestureDetector(
                                                              onTap: () =>
                                                                  Navigator.pop(
                                                                      context),
                                                              child: Container(
                                                                color: Colors
                                                                    .black
                                                                    .withValues(
                                                                        alpha: 0.85),
                                                                width: double
                                                                    .infinity,
                                                                height: double
                                                                    .infinity,
                                                              ),
                                                            ),
                                                            ClipRRect(
                                                              borderRadius:
                                                                  BorderRadius
                                                                      .circular(
                                                                          16),
                                                              child:
                                                                  InteractiveViewer(
                                                                panEnabled:
                                                                    true,
                                                                minScale: 0.5,
                                                                maxScale: 4.0,
                                                                child: Image
                                                                    .network(
                                                                  photoUrl,
                                                                  fit: BoxFit
                                                                      .contain,
                                                                ),
                                                              ),
                                                            ),
                                                            Positioned(
                                                              top: 40,
                                                              right: 20,
                                                              child: ClipOval(
                                                                child:
                                                                    BackdropFilter(
                                                                  filter: ImageFilter
                                                                      .blur(
                                                                          sigmaX:
                                                                              5,
                                                                          sigmaY:
                                                                              5),
                                                                  child:
                                                                      CircleAvatar(
                                                                    backgroundColor:
                                                                        Colors
                                                                            .black38,
                                                                    child:
                                                                        IconButton(
                                                                      icon: const Icon(
                                                                          Icons
                                                                              .close,
                                                                          color:
                                                                              Colors.white),
                                                                      onPressed:
                                                                          () =>
                                                                              Navigator.pop(context),
                                                                    ),
                                                                  ),
                                                                ),
                                                              ),
                                                            ),
                                                          ],
                                                        ),
                                                      ),
                                                    ),
                                                  );
                                                },
                                                child: Container(
                                                  margin: const EdgeInsets.only(
                                                      right: 8),
                                                  width: 60,
                                                  decoration: BoxDecoration(
                                                    borderRadius:
                                                        BorderRadius.circular(
                                                            10),
                                                    border: Border.all(
                                                        color: const Color(0xFFEFE8DE),
                                                        width: 1),
                                                    image: DecorationImage(
                                                      image: NetworkImage(
                                                          photoUrl),
                                                      fit: BoxFit.cover,
                                                    ),
                                                  ),
                                                ),
                                              );
                                            },
                                          ),
                                        ),
                                      ],
                                    ],
                                  ),
                                );
                              },
                            ),
                    ],
                  ),
                ),
              ]),
            ),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Container(
          height: 76,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          decoration: const BoxDecoration(
            color: Color(0xFFFAF8F5),
            boxShadow: [
              BoxShadow(
                color: Color(0x0A000000),
                blurRadius: 16,
                offset: Offset(0, -4),
              ),
            ],
          ),
          child: Row(
            children: [
              // Botón Secundario: Consulta Pre-Reserva Híbrida
              Expanded(
                flex: 3,
                child: SizedBox(
                  height: 52,
                  child: OutlinedButton.icon(
                    onPressed: () => _showQuickInquirySheet(context, p, services),
                    icon: const Icon(Icons.help_outline_rounded,
                        size: 18, color: Color(0xFFC5A052)),
                    label: const Text(
                      'Consulta',
                      style: TextStyle(
                        fontFamily: 'CormorantGaramond',
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFFC5A052),
                      ),
                    ),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: Color(0xFFC5A052), width: 1.5),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                      ),
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              // Botón Primario Dominante: Agendar Cita con Smart Availability Slot
              Expanded(
                flex: 7,
                child: Container(
                  height: 52,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(16),
                    gradient: const LinearGradient(
                      colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: Color(0xFFC5A052).withValues(alpha: 0.35),
                        blurRadius: 12,
                        offset: const Offset(0, 4),
                      ),
                    ],
                  ),
                  child: ElevatedButton(
                    onPressed: () async {
                      final token = await AuthService.getToken();
                      if (token == null) {
                        if (context.mounted) {
                          Navigator.pushNamed(context, '/login');
                        }
                        return;
                      }
                      if (context.mounted) {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (context) => BookingScreen(
                              providerId: widget.providerId,
                              providerName:
                                  p['business_name'] ?? p['full_name'] ?? 'Prestador',
                              services: services,
                            ),
                          ),
                        );
                      }
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.transparent,
                      shadowColor: Colors.transparent,
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                      ),
                      padding: EdgeInsets.zero,
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.calendar_today_outlined, size: 16, color: Color(0xFF1F1A15)),
                            SizedBox(width: 6),
                            Text(
                              'Agendar Cita',
                              style: TextStyle(
                                fontFamily: 'CormorantGaramond',
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                                color: Color(0xFF1F1A15),
                                letterSpacing: 0.4,
                              ),
                            ),
                          ],
                        ),
                        Text(
                          'Próximo turno: $smartSlot',
                          style: const TextStyle(
                            fontFamily: 'Inter',
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                            color: Color(0xFF3D2E1E),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showQuickInquirySheet(BuildContext context, Map<String, dynamic> p,
      List<Map<String, dynamic>> services) {
    final providerName =
        p['business_name'] ?? p['full_name'] ?? 'Profesional';
    final TextEditingController queryCtrl = TextEditingController();
    bool hasLeakageWarning = false;

    bool checkContactLeakage(String text) {
      final lower = text.toLowerCase();
      final phoneRegex = RegExp(
          r'(?:\+?57\s*)?(?:3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}|\b3\d{9}\b|\b[0-9]{7,10}\b)');
      if (phoneRegex.hasMatch(text)) return true;
      final keywords = [
        'whatsapp',
        'wasap',
        'wpp',
        'whap',
        'wha',
        'celular',
        'cel',
        'telefono',
        'teléfono',
        'mi numero',
        'mi número',
        'instagram',
        'ig:',
        '@',
        'llamame',
        'llámame',
        'por fuera',
        'en efectivo',
        'pago directo',
        'transferencia directa'
      ];
      for (final kw in keywords) {
        if (lower.contains(kw)) return true;
      }
      return false;
    }

    final quickChips = [
      '¿Tienes disponibilidad hoy o mañana?',
      '¿El servicio es a domicilio o en sede física?',
      '¿Qué marcas o productos de belleza utilizas?',
      '¿Cuánto tiempo aproximado dura este servicio?',
    ];

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetCtx) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return Container(
              padding: EdgeInsets.only(
                top: 16,
                left: 20,
                right: 20,
                bottom: MediaQuery.of(sheetCtx).viewInsets.bottom + 20,
              ),
              decoration: const BoxDecoration(
                color: Color(0xFFFAF8F5),
                borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
                boxShadow: [
                  BoxShadow(
                    color: Color(0x20000000),
                    blurRadius: 20,
                    offset: Offset(0, -6),
                  ),
                ],
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Center(
                      child: Container(
                        width: 44,
                        height: 4.5,
                        decoration: BoxDecoration(
                          color: const Color(0xFFDCD4CB),
                          borderRadius: BorderRadius.circular(2.5),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: Color(0xFFF3D59B).withValues(alpha: 0.3),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Icon(Icons.help_outline_rounded,
                              size: 20, color: Color(0xFFC5A052)),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Consulta Pre-Reserva',
                                style: TextStyle(
                                  fontFamily: 'CormorantGaramond',
                                  fontSize: 20,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFF1F1A15),
                                ),
                              ),
                              Text(
                                'Pregunta sobre los servicios de $providerName',
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: Color(0xFF6B5E55),
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),

                    // Banner de Garantía y Prevención de Desintermediación
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF2ECE4),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(
                            color: const Color(0xFFE2D6C8), width: 1),
                      ),
                      child: const Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(Icons.shield_rounded,
                              size: 18, color: Color(0xFF4A5D4E)),
                          SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Tu pago está resguardado por Wompi Bancolombia. Para proteger tu garantía y evitar fraudes, los datos de contacto personal se habilitan al confirmar la reserva.',
                              style: TextStyle(
                                fontSize: 11.5,
                                height: 1.35,
                                color: Color(0xFF2C3E30),
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 18),

                    const Text(
                      'Preguntas Frecuentes (Toca para enviar):',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                        color: Color(0xFF1F1A15),
                      ),
                    ),
                    const SizedBox(height: 10),

                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: quickChips.map((chip) {
                        return InkWell(
                          onTap: () {
                                     HapticFeedback.lightImpact();
                            Navigator.pop(sheetCtx);
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => ChatScreen(
                                  partnerId: widget.providerId,
                                  partnerName: providerName,
                                  partnerRole: 'provider',
                                  partnerAvatar: p['avatar_url'],
                                  initialMessage: '[Consulta Pre-Reserva] $chip',
                                ),
                              ),
                            );
                          },
                          borderRadius: BorderRadius.circular(20),
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 8),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(
                                  color: const Color(0xFFC5A052), width: 1),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.flash_on_rounded,
                                    size: 14, color: Color(0xFFC5A052)),
                                const SizedBox(width: 6),
                                Text(
                                  chip,
                                  style: const TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                    color: Color(0xFF3D2E1E),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 18),

                    const Text(
                      'O escribe tu duda puntual:',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                        color: Color(0xFF1F1A15),
                      ),
                    ),
                    const SizedBox(height: 8),

                    TextField(
                      controller: queryCtrl,
                      maxLines: 2,
                      onChanged: (val) {
                        final leak = checkContactLeakage(val);
                        if (leak != hasLeakageWarning) {
                          setSheetState(() {
                            hasLeakageWarning = leak;
                          });
                        }
                      },
                      style: const TextStyle(fontSize: 13.5),
                      decoration: InputDecoration(
                        hintText: 'Ej: ¿Tienen parqueadero cerca? ¿Usan tinte sin amoníaco?',
                        hintStyle: TextStyle(
                            fontSize: 12, color: Colors.grey[500]),
                        filled: true,
                        fillColor: Colors.white,
                        contentPadding: const EdgeInsets.all(12),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: BorderSide(
                            color: hasLeakageWarning
                                ? Colors.red
                                : const Color(0xFFE0D7CD),
                          ),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: BorderSide(
                            color: hasLeakageWarning
                                ? Colors.red
                                : const Color(0xFFE0D7CD),
                          ),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: BorderSide(
                            color: hasLeakageWarning
                                ? Colors.red
                                : const Color(0xFFC5A052),
                            width: 1.5,
                          ),
                        ),
                      ),
                    ),

                    if (hasLeakageWarning) ...[
                      const SizedBox(height: 6),
                      const Row(
                        children: [
                          Icon(Icons.warning_amber_rounded,
                              size: 16, color: Colors.red),
                          SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              'Para proteger tu depósito Wompi, no compartas teléfonos ni redes antes de reservar.',
                              style: TextStyle(
                                fontSize: 11,
                                color: Colors.red,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],

                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed: hasLeakageWarning
                                ? null
                                : () {
                                    final text = queryCtrl.text.trim();
                                    if (text.isEmpty) return;
                                    Navigator.pop(sheetCtx);
                                    Navigator.push(
                                      context,
                                      MaterialPageRoute(
                                        builder: (_) => ChatScreen(
                                          partnerId: widget.providerId,
                                          partnerName: providerName,
                                          partnerRole: 'provider',
                                          partnerAvatar: p['avatar_url'],
                                          initialMessage:
                                              '[Consulta Pre-Reserva] $text',
                                        ),
                                      ),
                                    );
                                  },
                            style: OutlinedButton.styleFrom(
                              side: BorderSide(
                                color: hasLeakageWarning
                                    ? Colors.grey
                                    : const Color(0xFFC5A052),
                                width: 1.5,
                              ),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(14),
                              ),
                              padding: const EdgeInsets.symmetric(vertical: 12),
                            ),
                            child: const Text(
                              'Enviar Consulta',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 13,
                                color: Color(0xFF8C6F65),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),

                    const SizedBox(height: 14),
                    const Divider(color: Color(0xFFE8DFD8), height: 1),
                    const SizedBox(height: 14),

                    // Botón Destacado: Agendar Cita
                    SizedBox(
                      width: double.infinity,
                      height: 48,
                      child: ElevatedButton.icon(
                        onPressed: () async {
                          Navigator.pop(sheetCtx);
                          final token = await AuthService.getToken();
                          if (token == null) {
                            if (context.mounted) {
                              Navigator.pushNamed(context, '/login');
                            }
                            return;
                          }
                          if (context.mounted) {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (context) => BookingScreen(
                                  providerId: widget.providerId,
                                  providerName: providerName,
                                  services: services,
                                ),
                              ),
                            );
                          }
                        },
                        icon: const Icon(Icons.calendar_today_outlined,
                            size: 16, color: Color(0xFF1F1A15)),
                        label: const Text(
                          'Prefiero Agendar Cita Ahora',
                          style: TextStyle(
                            fontFamily: 'CormorantGaramond',
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF1F1A15),
                          ),
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFFF3D59B),
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }


  Widget _buildAIBanner(BuildContext context, String providerName) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFFAF6EE), Color(0xFFF3EBE0)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
            color: Color(0xFFC5A052).withValues(alpha: 0.35), width: 1.2),
        boxShadow: const [
          BoxShadow(
            color: Color(0x06000000),
            blurRadius: 10,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.auto_awesome,
                  color: Color(0xFFC5A052), size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '¿Te interesa el trabajo de $providerName?',
                  style: const TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontWeight: FontWeight.bold,
                      fontSize: 16.5,
                      color: Color(0xFF1F1A15)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            'Pregúntale a nuestra IA si sus estilos van con tu rostro y facciones.',
            style: TextStyle(
                fontFamily: 'Inter',
                fontSize: 12.5,
                color: Color(0xFF6B5E55),
                height: 1.35),
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            height: 44,
            child: ElevatedButton.icon(
              onPressed: () {
                HapticFeedback.lightImpact();
                Navigator.of(context).pushNamed('/ideas');
              },
              icon: const Icon(Icons.lightbulb_outline, size: 16, color: Color(0xFFC5A052)),
              label: const Text(
                'Ver Ideas y Visajismo IA',
                style: TextStyle(
                    fontFamily: 'Inter',
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFFC5A052)),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF1F1A15),
                foregroundColor: const Color(0xFFC5A052),
                elevation: 0,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
