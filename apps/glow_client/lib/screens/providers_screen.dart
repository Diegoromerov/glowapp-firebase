// frontend/lib/screens/providers_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert';
import 'dart:ui';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';

import 'package:glow_core/glow_core.dart';

class ProvidersScreen extends StatefulWidget {
  const ProvidersScreen({super.key});

  @override
  State<ProvidersScreen> createState() => _ProvidersScreenState();
}

class _ProvidersScreenState extends State<ProvidersScreen> with TickerProviderStateMixin implements NavigationDelegate {
  late final MapController _mapController;
  List<ProviderModel> _allProviders = [];
  List<ProviderModel> _filteredProviders = [];
  ProviderModel? _selectedProvider;
  String _selectedCategory = 'all';
  bool _isLoading = true;
  String? _errorMessage;

  // ignore: unused_field
  bool _hasToken = false;
  // ignore: unused_field
  String? _userRole;

  // ignore: unused_field
  bool _showTutorial = false;
  // ignore: unused_field
  int _tutorialStep = 0;
  // ignore: unused_field
  bool _isMapMenuOpen = false;

  // GlowGuide Integration (I1)
  // ignore: unused_field
  late final GlowGuideEngine _glowGuideEngine;
  // ignore: unused_field
  late final ScreenVisibilityObserver _screenVisibilityObserver;
  // ignore: unused_field
  late final AudioEngine _audioEngine;
  // ignore: unused_field
  late final PersistenceEngine _persistenceEngine;

  // Legacy Mutex state
  // ignore: unused_field
  bool _enableGlowGuide = false;
  // ignore: unused_field
  bool _enableLegacy = false;

  // Start trigger idempotency guard (I3-START)
  // ignore: unused_field
  bool _glowGuideStartScheduled = false;

  final TextEditingController _searchController = TextEditingController();
  final LatLng _bogotaCenter = const LatLng(4.6735, -74.1422);
  LatLng? _userLocation;

  @override
  void initState() {
    super.initState();
    _mapController = MapController();
    _loadProviders();
    _loadUserRole();
    _determineUserLocation();
    _resolveGuideMutex();
    AudienceService.currentAudience.addListener(_onAudienceChanged);

    // Obtener motor global de GlowGuideService
    GlowGuideService.instance.initialize();
    _glowGuideEngine = GlowGuideService.instance.engine!;
    _glowGuideEngine.addListener(_onGlowGuideStateChanged);
  }

  void _onGlowGuideStateChanged(GlowGuideState state) {
    if (!mounted) return;
    final isStep08 = state.currentStepId == 'step_08_despedida';
    if (_isMapMenuOpen != isStep08) {
      setState(() {
        _isMapMenuOpen = isStep08;
      });
    }
  }

  @override
  void dispose() {
    _glowGuideEngine.removeListener(_onGlowGuideStateChanged);
    AudienceService.currentAudience.removeListener(_onAudienceChanged);
    _searchController.dispose();
    _glowGuideEngine.dispose();
    super.dispose();
  }

  // ===== NavigationDelegate implementation (I1) =====

  @override
  Future<NavigationResult> navigate({
    required String routeName,
    Map<String, dynamic>? arguments,
    required Duration timeout,
  }) async {
    try {
      if (!mounted) {
        return NavigationResult.cancelled(routeName);
      }
      await Navigator.of(context).pushNamed(routeName, arguments: arguments);
      return NavigationResult.success(routeName);
    } catch (e) {
      return NavigationResult.failure(routeName, e.toString());
    }
  }

  @override
  Future<NavigationResult> returnToHome({required Duration timeout}) async {
    try {
      if (!mounted) {
        return NavigationResult.cancelled('/home');
      }
      Navigator.of(context).popUntil((route) => route.settings.name == '/home');
      return NavigationResult.success('/home');
    } catch (e) {
      return NavigationResult.failure('/home', e.toString());
    }
  }

  @override
  void cancelPending() {
    // No-op: navigation operations are short-lived and don't hold pending state
    // beyond the single push call. The ScreenVisibilityObserver handles
    // pending visibility waits separately.
  }

  @override
  void _onAudienceChanged() {
    if (mounted) {
      _filterProviders();
    }
  }

  /// Legacy Mutex: resuelve qué guía mostrar (GlowGuide o Legacy), nunca ambos.
  Future<void> _resolveGuideMutex() async {
    final prefs = await SharedPreferences.getInstance();

    // 1. New completion key = true → no guide
    final glowguideCompleted =
        prefs.getBool('glowguide_completed_glow_welcome_v1') ?? false;
    if (glowguideCompleted) {
      if (mounted) {
        setState(() {
          _enableGlowGuide = false;
          _enableLegacy = false;
        });
      }
      return;
    }

    // 2. Legacy seen = true → migrate new completion → no guide
    final legacySeen = prefs.getBool('seen_aura_tutorial') ?? false;
    if (legacySeen) {
      await prefs.setBool('glowguide_completed_glow_welcome_v1', true);
      if (mounted) {
        setState(() {
          _enableGlowGuide = false;
          _enableLegacy = false;
        });
      }
      return;
    }

    // 3. Neither completed → allow GlowGuide
    if (mounted) {
      setState(() {
        _enableGlowGuide = true;
        _enableLegacy = false;
      });
      // I3-START: programar inicio del Engine solo si corresponde
      _startGlowGuideWhenReady();
    }
  }

  /// I3-START: programa el inicio de GlowGuide de forma idempotente,
  /// después de que Home haya renderizado su primer frame.
  /// Solo consume el resultado del mutex (_enableGlowGuide); no re-resuelve
  /// persistencia ni legacy.
  void _startGlowGuideWhenReady() {
    // Guardia local contra doble scheduling
    if (_glowGuideStartScheduled) return;
    if (!_enableGlowGuide || _enableLegacy) return;

    _glowGuideStartScheduled = true;

    // Post-frame: garantizar que Home ya renderizó antes de iniciar.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // Revalidar guards en el momento real del frame
      if (!mounted) return;
      if (!_enableGlowGuide) return;
      if (_glowGuideEngine.isActive || _glowGuideEngine.isCompleted || _glowGuideEngine.isDismissed) {
        return;
      }
      _glowGuideEngine.start();
    });
  }

  Future<void> _checkTutorial() async {
    final prefs = await SharedPreferences.getInstance();
    final seen = prefs.getBool('seen_aura_tutorial') ?? false;
    if (!seen && mounted) {
      setState(() {
        _showTutorial = true;
        _tutorialStep = 0;
      });
    }
  }

  Future<void> _completeTutorial() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('seen_aura_tutorial', true);
    if (mounted) {
      setState(() {
        _showTutorial = false;
      });
      _searchController.clear();
      _animatedMapMove(_userLocation ?? _bogotaCenter, 13.5);
    }
  }

  void _animatedMapMove(LatLng destLocation, double destZoom) {
    // Animate map movement smoothly over 1000 milliseconds
    final latTween = Tween<double>(begin: _mapController.camera.center.latitude, end: destLocation.latitude);
    final lngTween = Tween<double>(begin: _mapController.camera.center.longitude, end: destLocation.longitude);
    final zoomTween = Tween<double>(begin: _mapController.camera.zoom, end: destZoom);

    final controller = AnimationController(duration: const Duration(milliseconds: 1000), vsync: this);
    final animation = CurvedAnimation(parent: controller, curve: Curves.fastOutSlowIn);

    controller.addListener(() {
      if (mounted) {
        _mapController.move(
          LatLng(latTween.evaluate(animation), lngTween.evaluate(animation)),
          zoomTween.evaluate(animation),
        );
      }
    });

    animation.addStatusListener((status) {
      if (status == AnimationStatus.completed || status == AnimationStatus.dismissed) {
        controller.dispose();
      }
    });

    controller.forward();
  }



  void _handleTutorialStepChange(int newStep) {
    setState(() {
      _tutorialStep = newStep;
    });

    if (_tutorialStep == 1 && _filteredProviders.isNotEmpty) {
      final firstProv = _filteredProviders.first;
      _animatedMapMove(LatLng(firstProv.latitude, firstProv.longitude), 15.0);
    } else {
      _animatedMapMove(_userLocation ?? _bogotaCenter, 13.5);
    }
  }

  Future<void> _determineUserLocation() async {
    try {
      final pos = await getWebGeolocation();
      final lat = pos['lat']!;
      final lon = pos['lon']!;
      if (mounted) {
        setState(() {
          _userLocation = LatLng(lat, lon);
        });
        _mapController.move(_userLocation!, 13.5);
        _loadProviders();
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _userLocation = _bogotaCenter;
        });
        _loadProviders();
      }
    }
  }

  void _showManualLocationPicker() {
    final addressController = TextEditingController(text: "Bogota, Colombia");
    bool resolving = false;

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setStateModal) {
            return AlertDialog(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
              title: Row(
                children: [
                  Icon(Icons.location_off, color: AppTheme.primary, size: 28),
                  SizedBox(width: 8),
                  Text(
                    'Ingresa tu Ubicación',
                    style: TextStyle(fontWeight: FontWeight.bold),
                  ),
                ],
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'No pudimos acceder a tu GPS. Por favor escribe tu dirección, barrio o ciudad:',
                    style: TextStyle(fontSize: 14, color: Colors.black54),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: addressController,
                    decoration: const InputDecoration(
                      labelText: 'Dirección o Barrio',
                      hintText: 'Ej. Bogota, Colombia',
                      border: OutlineInputBorder(),
                    ),
                    enabled: !resolving,
                  ),
                  if (resolving) ...[
                    const SizedBox(height: 16),
                    Center(
                      child: CircularProgressIndicator(color: AppTheme.primary),
                    )
                  ]
                ],
              ),
              actions: [
                TextButton(
                  onPressed: resolving ? null : () {
                    Navigator.pop(context);
                    setState(() {
                      _userLocation = _bogotaCenter;
                    });
                    _loadProviders();
                  },
                  child: const Text('Usar Bogotá (Defecto)', style: TextStyle(color: Colors.grey)),
                ),
                ElevatedButton(
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: AppTheme.primary,
                                    foregroundColor: Colors.white,
                                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                                  ),
                  onPressed: resolving ? null : () async {
                    final address = addressController.text.trim();
                    if (address.isEmpty) return;

                    setStateModal(() {
                      resolving = true;
                    });

                    try {
                      // Obtener coordenadas a partir de texto - usando getCurrentPosition como fallback
                      final position = await Geolocator.getCurrentPosition();
                      if (context.mounted) {
                        Navigator.pop(context);
                        setState(() {
                          _userLocation = LatLng(position.latitude, position.longitude);
                        });
                        _mapController.move(_userLocation!, 13.5);
                        _loadProviders();
                      }
                    } catch (e) {
                      setStateModal(() {
                        resolving = false;
                      });
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('No pudimos localizar esa dirección. Intenta otra.')),
                      );
                    }
                  },
                  child: const Text('Buscar', style: TextStyle(fontWeight: FontWeight.bold)),
                ),
              ],
            );
          }
        );
      },
    );
  }

  Future<void> _loadProviders() async {
    if (!mounted) return;
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    // 1. Cargar datos cacheados localmente de SecureStorage para visualización inmediata
    try {
      final String? cachedJson = await SecureStorageService().read('cached_providers');
      if (cachedJson != null) {
        final List<dynamic> decoded = json.decode(cachedJson);
        final cachedProviders = decoded.map((jsonObj) => ProviderModel.fromJson(jsonObj)).toList();
        if (mounted) {
          setState(() {
            _allProviders = cachedProviders;
            _filterProviders();
            _isLoading = false;
          });
        }
      }
    } catch (e) {
      debugPrint('Error leyendo caché seguro local: $e');
    }

    // 2. Realizar la petición asíncrona de red para actualizar la información (con reintentos y retroceso exponencial)
    int retries = 0;
    const int maxRetries = 3;
    int delayMs = 1000;
    List<ProviderModel>? providers;
    
    while (retries < maxRetries) {
      try {
        providers = await ApiService.fetchProvidersSecured(
          latitude: _userLocation?.latitude,
          longitude: _userLocation?.longitude,
        );
        break;
      } catch (e) {
        retries++;
        if (retries >= maxRetries) {
          if (!mounted) return;
          // Si ya cargó del caché no pisamos los datos con un error
          if (_allProviders.isEmpty) {
            setState(() {
              _errorMessage = 'Fallo de conexión tras varios intentos: ${e.toString()}';
              _isLoading = false;
            });
          } else {
            setState(() {
              _isLoading = false;
            });
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('Sin conexión. Mostrando datos sin conexión.'),
                backgroundColor: AppTheme.primary,
              ),
            );
          }
          return;
        }
        debugPrint('Fallo al cargar prestadores. Reintentando en ${delayMs}ms (Intento $retries de $maxRetries)...');
        await Future.delayed(Duration(milliseconds: delayMs));
        delayMs *= 2; // Retroceso exponencial
      }
    }

    if (providers != null) {
      if (!mounted) return;
      setState(() {
        _allProviders = providers!;
        _filterProviders();
        _isLoading = false;
      });

      // 3. Guardar en caché el nuevo listado usando SecureStorage
      try {
        final rawList = providers.map((p) => p.toJson()).toList();
        await SecureStorageService().write('cached_providers', json.encode(rawList));
      } catch (cacheErr) {
        debugPrint('Error guardando en caché segura: $cacheErr');
      }
    }
  }

  void _filterProviders() {
    final audience = AudienceService.currentAudience.value;

    setState(() {
      _filteredProviders = _allProviders.where((p) {
        final matchesCat = _providerMatchesCategory(p, _selectedCategory);
        
        bool matchesAudience = true;
        final desc = p.description.toLowerCase();
        final biz = p.businessName.toLowerCase();
        final name = p.fullName.toLowerCase();

        if (audience == AudienceMode.men) {
          final isMakeupOrNails = desc.contains('maquillaje') || desc.contains('manicura') || desc.contains('pedicura') || desc.contains('uñas');
          final isBarberOrMen = desc.contains('barber') ||
              desc.contains('hombres') ||
              desc.contains('corte masculino') ||
              desc.contains('barba') ||
              biz.contains('barber') ||
              biz.contains('hombres') ||
              biz.contains('barba');
          
          matchesAudience = isBarberOrMen && !isMakeupOrNails;
        } else if (audience == AudienceMode.women) {
          matchesAudience = !desc.contains('exclusivo hombres') && !biz.contains('barberia masculina');
        }

        return matchesCat && matchesAudience;
      }).toList();
    });
  }

  bool _providerMatchesCategory(ProviderModel provider, String category) {
    if (category == 'all') return true;
    final desc = provider.description.toLowerCase();
    final biz = provider.businessName.toLowerCase();
    final name = provider.fullName.toLowerCase();

    if (category == 'hair') {
      return desc.contains('hair') ||
          desc.contains('corte') ||
          desc.contains('balayage') ||
          biz.contains('hair') ||
          biz.contains('corte') ||
          name.contains('mari');
    }
    if (category == 'nails') {
      return desc.contains('nails') ||
          desc.contains('manicur') ||
          desc.contains('uña') ||
          biz.contains('nails') ||
          biz.contains('manicur') ||
          name.contains('carlos');
    }
    if (category == 'makeup') {
      return desc.contains('makeup') ||
          desc.contains('maquillaj') ||
          biz.contains('makeup') ||
          biz.contains('maquillaj');
    }
    return true;
  }

  Future<void> _loadUserRole() async {
    final token = await AuthService.getToken();
    if (mounted) {
      setState(() {
        _hasToken = token != null;
      });
    }
    if (token != null) {
      try {
        final parts = token.split('.');
        if (parts.length >= 2) {
          String payload = parts[1].replaceAll('-', '+').replaceAll('_', '/');
          while (payload.length % 4 != 0) {
            payload += '=';
          }
          final decoded = utf8.decode(base64.decode(payload));
          final data = json.decode(decoded);
          if (mounted) {
            setState(() => _userRole = data['role']);
          }
        }
      } catch (_) {}
    }
  }

  Future<void> _checkAuthAndNavigate(String routeName) async {
    final token = await AuthService.getToken();
    if (token == null) {
      if (mounted) {
        Navigator.pushNamed(context, '/login');
      }
    } else {
      if (mounted) {
        final result = await Navigator.pushNamed(context, routeName);
        if (result != null && result is Map<String, dynamic>) {
          if (result['action'] == 'filter_map') {
            final category = result['category'] ?? 'all';
            setState(() {
              _selectedCategory = category;
              _filterProviders();
            });
            // Auto scroll or zoom to filtered providers if needed
            if (_filteredProviders.isNotEmpty) {
              _mapController.move(
                LatLng(_filteredProviders.first.latitude, _filteredProviders.first.longitude),
                14.5
              );
            }
          }
        }
      }
    }
  }



  void _navigateToAIChat(String message) {
    Navigator.pushNamed(
      context,
      '/chat/detail',
      arguments: {
        'partnerId': '00000000-0000-0000-0000-000000000000',
        'partnerName': 'Asistente de Belleza & Tips IA',
        'partnerRole': 'admin',
        'partnerAvatar': '',
        'initialMessage': message.trim().isNotEmpty ? message.trim() : null,
      },
    );
  }

  /*
  void _showSOSConfirmationDialog() {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
          title: Row(
            children: [
              Icon(Icons.warning_amber_rounded,
                  color: Color(0xFFDC2626), size: 28),
              SizedBox(width: 8),
              Text(
                '🚨 ALERTA SOS',
                style: TextStyle(
                    fontWeight: FontWeight.bold, color: Color(0xFFDC2626)),
              ),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '¿Estás en peligro o necesitas asistencia inmediata?',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 15,
                    color: Colors.black87),
              ),
              SizedBox(height: 12),
              Text(
                'Al confirmar, se enviará una alerta silenciosa con tu ubicación actual a la central de seguridad de la plataforma y te daremos la opción de llamar directamente al número de emergencias (123).',
                style: TextStyle(
                    fontSize: 13.5, height: 1.4, color: Colors.black54),
              ),
            ],
          ),
          actionsAlignment: MainAxisAlignment.spaceBetween,
          actionsPadding:
              const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(
                'Cancelar',
                style:
                    TextStyle(color: Colors.grey, fontWeight: FontWeight.bold),
              ),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFDC2626),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20)),
                elevation: 0,
                padding:
                    const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              ),
              onPressed: () async {
                Navigator.pop(context); // Cerrar diálogo primero
                await _triggerSOSAlert();
              },
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.security, size: 18),
                  SizedBox(width: 6),
                  Text('SÍ, ENVIAR SOS',
                      style: TextStyle(fontWeight: FontWeight.bold)),
                ],
              ),
            ),
          ],
        );
      },
    );
  }

  Future<void> _triggerSOSAlert() async {
    setState(() {
      _isLoading = true;
    });

    try {
      String? activeBookingId;
      try {
        final clientBookings = await ApiService.fetchClientBookings();
        final inProgressBooking = clientBookings.firstWhere(
          (b) => (b['status'] as String? ?? '').toUpperCase() == 'EN_PROGRESO',
        );
        activeBookingId = inProgressBooking['id']?.toString();
      } catch (_) {
        // Ignorar si no hay citas en progreso o si falla la búsqueda
      }

      // Registrar evento de telemetría de botón SOS presionado
      final double lat = _userLocation?.latitude ?? _bogotaCenter.latitude;
      final double lon = _userLocation?.longitude ?? _bogotaCenter.longitude;

      AnalyticsService().logEvent(
        eventType: 'SOS_TRIGGERED',
        screenName: '/home',
        elementId: 'sos_client_fab',
        metadata: {
          'booking_id': activeBookingId,
          'latitude': lat,
          'longitude': lon,
        },
      );

      final res = await ApiService.triggerSOS(
        bookingId: activeBookingId,
        latitude: lat,
        longitude: lon,
      );

      if (!mounted) return;
      setState(() {
        _isLoading = false;
      });

      _showSOSTriggeredSheet(res['message'] ?? 'Alerta enviada correctamente.');
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('�?Error al enviar alerta SOS: $e'),
          backgroundColor: Colors.redAccent,
        ),
      );
    }
  }

  void _showSOSTriggeredSheet(String message) {
    showModalBottomSheet(
      context: context,
      isDismissible: false,
      enableDrag: false,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.only(
              topLeft: Radius.circular(28),
              topRight: Radius.circular(28),
            ),
          ),
          padding: EdgeInsets.only(
            left: 24,
            right: 24,
            top: 24,
            bottom: MediaQuery.of(context).viewInsets.bottom + 24,
          ),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.check_circle_outline,
                    color: Colors.green, size: 52),
                SizedBox(height: 12),
                Text(
                  'Alerta SOS Registrada',
                  style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 20,
                      color: Colors.black87),
                ),
                SizedBox(height: 8),
                Text(
                  message,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      color: Colors.grey[600], fontSize: 14, height: 1.4),
                ),
                SizedBox(height: 16),
                ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFDC2626),
                    foregroundColor: Colors.white,
                    minimumSize: const Size(double.infinity, 48),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(24)),
                    elevation: 2,
                  ),
                  onPressed: () {
                    Navigator.pop(context);
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('📞 Marcando al 123 (Emergencias)...'),
                        backgroundColor: Color(0xFFDC2626),
                      ),
                    );
                  },
                  icon: Icon(Icons.phone_in_talk_rounded),
                  label: Text(
                     'LLAMAR A EMERGENCIAS (123)',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                  ),
                ),
                SizedBox(height: 8),
                OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(double.infinity, 44),
                    side: BorderSide(color: Color(0xFFE8D7D3), width: 1.5),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(22)),
                  ),
                  onPressed: () => Navigator.pop(context),
                  child: Text(
                    'Entendido / Cerrar',
                    style: TextStyle(
                        color: AppTheme.primary, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
  */

  Future<void> _openBookingDirectly(BuildContext context, ProviderModel provider, [String? initialServiceId]) async {
    try {
      final details = await ApiService.fetchProviderDetails(provider.id);
      final services = (details['services'] as List?)?.cast<Map<String, dynamic>>() ?? [];
      if (context.mounted) {
        Navigator.pushNamed(
          context,
          '/booking',
          arguments: {
            'providerId': provider.id,
            'providerName': provider.businessName.isNotEmpty ? provider.businessName : provider.fullName,
            'services': services,
            'initialServiceId': initialServiceId,
          },
        );
      }
    } catch (_) {
      if (context.mounted) {
        Navigator.pushNamed(
          context,
          '/booking',
          arguments: {
            'providerId': provider.id,
            'providerName': provider.businessName.isNotEmpty ? provider.businessName : provider.fullName,
            'services': const [],
            'initialServiceId': initialServiceId,
          },
        );
      }
    }
  }

  void _showQuickViewSheet(ProviderModel provider) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return ClipRRect(
          borderRadius: const BorderRadius.only(
            topLeft: Radius.circular(32),
            topRight: Radius.circular(32),
          ),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
            child: Container(
              decoration: BoxDecoration(
                color: const Color(0xFFFAF8F5).withValues(alpha: 0.92), // Nude Seda Satinado
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(32),
                  topRight: Radius.circular(32),
                ),
                border: Border.all(
                  color: const Color(0xFFC5A052).withValues(alpha: 0.35), // Oro Champán 871
                  width: 1.2,
                ),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFFC5A052).withValues(alpha: 0.15),
                    blurRadius: 24,
                    offset: const Offset(0, -8),
                  ),
                ],
              ),
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 44,
                      height: 4,
                      decoration: BoxDecoration(
                        color: const Color(0xFFC5A052).withValues(alpha: 0.4),
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(2),
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: const Color(0xFFC5A052),
                            width: 2,
                          ),
                        ),
                        child: CircleAvatar(
                          radius: 28,
                          backgroundColor: const Color(0xFFF4EFEA),
                          backgroundImage: provider.avatarUrl.isNotEmpty
                              ? NetworkImage(provider.avatarUrl)
                              : null,
                          child: provider.avatarUrl.isEmpty
                              ? Text(
                                  provider.fullName.isNotEmpty
                                      ? provider.fullName[0].toUpperCase()
                                      : '?',
                                  style: const TextStyle(
                                      fontSize: 20,
                                      color: Color(0xFFC5A052),
                                      fontWeight: FontWeight.bold),
                                )
                              : null,
                        ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    provider.businessName.isNotEmpty
                                        ? provider.businessName
                                        : provider.fullName,
                                    style: const TextStyle(
                                        fontFamily: 'Didot',
                                        fontWeight: FontWeight.bold,
                                        fontSize: 19,
                                        color: Color(0xFF1C1917),
                                        letterSpacing: -0.3),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                if (provider.isVerified) ...[
                                  const SizedBox(width: 4),
                                  const Icon(Icons.verified,
                                      color: Color(0xFFC5A052), size: 18),
                                ],
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text(
                              provider.fullName,
                              style: TextStyle(
                                  fontSize: 13,
                                  color: Colors.grey[700],
                                  fontWeight: FontWeight.w500),
                            ),
                          ],
                        ),
                      ),
                      Container(
                        padding:
                            const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF4EFEA),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(
                            color: const Color(0xFFC5A052).withValues(alpha: 0.3),
                            width: 1,
                          ),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.star,
                                color: Color(0xFFC5A052), size: 15),
                            const SizedBox(width: 4),
                            Text(
                              provider.ratingAvg.toStringAsFixed(1),
                              style: const TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFFC5A052)),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Text(
                    provider.description,
                    style: TextStyle(
                        color: Colors.grey[800], fontSize: 14, height: 1.4),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      const Icon(Icons.location_on,
                          color: Color(0xFFC5A052), size: 16),
                      const SizedBox(width: 4),
                      Text(
                        'A ${(provider.distanceMeters / 1000).toStringAsFixed(1)} km en Fontibón',
                        style: TextStyle(
                            fontSize: 13,
                            color: Colors.grey[800],
                            fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    'Galería del Profesional',
                    style: TextStyle(
                        fontFamily: 'Didot',
                        fontWeight: FontWeight.bold,
                        fontSize: 15,
                        color: Color(0xFF1C1917)),
                  ),
                  const SizedBox(height: 10),
                  FutureBuilder<Map<String, dynamic>>(
                    future: ApiService.fetchProviderDetails(provider.id),
                    builder: (context, snapshot) {
                      if (snapshot.connectionState == ConnectionState.waiting) {
                        return SizedBox(
                          height: 100,
                          child: Row(
                            children: List.generate(
                                2,
                                (index) => Expanded(
                                      child: Container(
                                        margin: const EdgeInsets.only(right: 8),
                                        decoration: BoxDecoration(
                                          color: const Color(0xFFF4EFEA),
                                          borderRadius: BorderRadius.circular(16),
                                        ),
                                        child: const Center(
                                          child: SizedBox(
                                            width: 20,
                                            height: 20,
                                            child: CircularProgressIndicator(
                                                strokeWidth: 2,
                                                color: Color(0xFFC5A052)),
                                          ),
                                        ),
                                      ),
                                    )),
                          ),
                        );
                      }
                      final portfolio =
                          (snapshot.data?['portfolio'] as List<dynamic>?) ?? [];
                      if (portfolio.isEmpty) {
                        return Container(
                          height: 100,
                          width: double.infinity,
                          decoration: BoxDecoration(
                            color: const Color(0xFFF4EFEA),
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(
                              color: const Color(0xFFE8E0D5),
                              width: 1,
                            ),
                          ),
                          child: const Center(
                            child: Text(
                              'No hay fotos cargadas en el portafolio',
                              style: TextStyle(color: Colors.grey, fontSize: 13),
                            ),
                          ),
                        );
                      }
                      return SizedBox(
                        height: 110,
                        child: Row(
                          children: List.generate(
                              portfolio.length > 2 ? 2 : portfolio.length, (idx) {
                            final item = portfolio[idx];
                            final imgUrl = item['image_url'] as String? ?? '';
                            return Expanded(
                              child: Container(
                                margin: EdgeInsets.only(right: idx == 0 ? 8 : 0),
                                decoration: BoxDecoration(
                                  borderRadius: BorderRadius.circular(16),
                                  border: Border.all(
                                    color: const Color(0xFFC5A052).withValues(alpha: 0.3),
                                    width: 1,
                                  ),
                                  image: imgUrl.isNotEmpty
                                      ? DecorationImage(
                                          image: NetworkImage(imgUrl),
                                          fit: BoxFit.cover,
                                        )
                                      : null,
                                  color: const Color(0xFFF4EFEA),
                                ),
                              ),
                            );
                          }),
                        ),
                      );
                    },
                  ),
                  const SizedBox(height: 24),
                  Row(
                    children: [
                      // Chat Directo
                      IconButton(
                        onPressed: () async {
                          final token = await AuthService.getToken();
                          if (token == null) {
                            Navigator.pop(context);
                            Navigator.pushNamed(context, '/login');
                            return;
                          }
                          if (context.mounted) {
                            Navigator.pop(context);
                            Navigator.pushNamed(
                              context,
                              '/chat/detail',
                              arguments: {
                                'partnerId': provider.id,
                                'partnerName': provider.businessName.isNotEmpty
                                    ? provider.businessName
                                    : provider.fullName,
                                'partnerRole': 'provider',
                                'partnerAvatar': provider.avatarUrl,
                              },
                            );
                          }
                        },
                        style: IconButton.styleFrom(
                          backgroundColor: const Color(0xFFF4EFEA),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                            side: const BorderSide(color: Color(0xFFE8E0D5)),
                          ),
                          padding: const EdgeInsets.all(12),
                        ),
                        icon: const Icon(Icons.chat_bubble_outline_rounded, color: Color(0xFFC5A052), size: 20),
                        tooltip: 'Chat Directo',
                      ),
                      const SizedBox(width: 8),
                      // Ver Perfil Completo
                      Expanded(
                        child: OutlinedButton(
                          style: OutlinedButton.styleFrom(
                            side: const BorderSide(color: Color(0xFFC5A052), width: 1.2),
                            foregroundColor: const Color(0xFF8C6F65),
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                          ),
                          onPressed: () {
                            Navigator.pop(context);
                            Navigator.pushNamed(
                              context,
                              '/provider-detail',
                              arguments: {'providerId': provider.id},
                            );
                          },
                          child: const Text(
                            'Ver Perfil',
                            style: TextStyle(
                              fontFamily: 'CormorantGaramond',
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFF1F1A15),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      // Reservar Cita Directa
                      Expanded(
                        child: ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFFC5A052),
                            foregroundColor: const Color(0xFF14100C),
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                            elevation: 2,
                          ),
                          onPressed: () {
                            Navigator.pop(context);
                            _openBookingDirectly(context, provider);
                          },
                          icon: const Icon(Icons.calendar_today_outlined, size: 15, color: Color(0xFF14100C)),
                          label: const Text(
                            'Reservar Cita',
                            style: TextStyle(
                              fontFamily: 'CormorantGaramond',
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFF14100C),
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
        );
      },
    );
  }

  Widget _buildCategorySelector() {
    final categories = [
      {'name': 'Cabello', 'value': 'hair', 'icon': Icons.content_cut_outlined},
      {'name': 'Uñas', 'value': 'nails', 'icon': Icons.brush_outlined},
      {'name': 'Maquillaje', 'value': 'makeup', 'icon': Icons.face_retouching_natural_outlined},
      {'name': 'Todos', 'value': 'all', 'icon': Icons.auto_awesome_outlined},
    ];
    return SizedBox(
      height: 75,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: categories.length,
        itemBuilder: (context, index) {
          final cat = categories[index];
          final val = cat['value'] as String;
          final isSelected = _selectedCategory == val;
          final iconData = cat['icon'] as IconData;

          return GestureDetector(
            onTap: () {
              setState(() {
                _selectedCategory = val;
                _filterProviders();
              });
              AnalyticsService().logEvent(
                eventType: 'CATEGORY_FILTER_SELECTED',
                screenName: '/home',
                elementId: 'category_chip_$val',
                metadata: {'category': val},
              );
            },
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              margin: const EdgeInsets.only(right: 20),
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                                  Container(
                                    width: 46,
                                    height: 46,
                                    decoration: BoxDecoration(
                                      shape: BoxShape.circle,
                                      color: isSelected
                                          ? AppTheme.primary.withValues(alpha: 0.15)
                                          : Colors.grey.shade50,
                                      border: Border.all(
                                        color: isSelected
                                            ? AppTheme.primary
                                            : Colors.grey.shade200,
                                        width: 1.2,
                                      ),
                                    ),
                                    child: Icon(
                                      iconData,
                                      size: 20,
                                      color: isSelected
                                          ? AppTheme.primary
                                          : Colors.grey.shade600,
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    cat['name'] as String,
                                    style: TextStyle(
                                      color: isSelected
                                          ? AppTheme.primary
                                          : Colors.grey.shade600,
                                      fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                                      fontSize: 11,
                                    ),
                                  ),
                                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildNavItem({
    Key? key,
    IconData? icon,
    String? assetPath,
    double? assetSize,
    required String label,
    required VoidCallback onTap,
    Color? color,
  }) {
    final resolvedColor = color ?? AppTheme.text;
    return Expanded(
      key: key,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              assetPath != null
                  ? Image.asset(
                      assetPath,
                      width: assetSize ?? 28,
                      height: assetSize ?? 28,
                      fit: BoxFit.contain,
                    )
                  : Icon(icon ?? Icons.circle, color: resolvedColor, size: 20),
              const SizedBox(height: 3),
              Text(
                label,
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 9.5,
                  fontWeight: FontWeight.bold,
                  color: resolvedColor,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildProminentCenterNavItem({
    IconData? icon,
    String? assetPath,
    List<Color>? gradientColors,
    Color? shadowColor,
    Color? borderColor,
    required String label,
    required VoidCallback onTap,
    Widget? iconWidget,
  }) {
    final colors = gradientColors ?? const [
      Color(0xFFF4EFEA), // LuxeColors.nude100 por defecto
      Color(0xFFC5A052), // LuxeColors.gold871 por defecto
    ];
    final shadow = shadowColor ?? const Color(0xFFC5A052);
    final borderC = borderColor ?? Colors.white;

    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: Transform.translate(
          offset: const Offset(0, -14),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 50,
                height: 50,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(
                    colors: colors,
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: shadow.withValues(alpha: 0.4),
                      blurRadius: 10,
                      spreadRadius: 2,
                      offset: const Offset(0, 4),
                    ),
                  ],
                  border: Border.all(
                    color: borderC,
                    width: 2.5,
                  ),
                ),
                child: ClipOval(
                  child: iconWidget ?? (assetPath != null
                      ? Image.asset(
                          assetPath,
                          fit: BoxFit.cover,
                      )
                      : Icon(
                          icon ?? Icons.auto_awesome,
                          color: Colors.white,
                          size: 26,
                      )),
                ),
              ),
              const SizedBox(height: 2),
              Text(
                label,
                style: const TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w800,
                  color: Color(0xFFB07D62),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static const String _svgCalendarLuxury = '''
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <line x1="7" y1="2" x2="7" y2="5" />
  <line x1="10.3" y1="2" x2="10.3" y2="5" />
  <line x1="13.7" y1="2" x2="13.7" y2="5" />
  <line x1="17" y1="2" x2="17" y2="5" />
  <rect x="3.5" y="4" width="17" height="17" rx="3.5" />
  <line x1="3.5" y1="8.5" x2="20.5" y2="8.5" />
  <path d="M12 10.5 C12 12.8 10.6 14.2 8.5 14.5 C10.6 14.8 12 16.2 12 18.5 C12 16.2 13.4 14.8 15.5 14.5 C13.4 14.2 12 12.8 12 10.5 Z" />
</svg>
''';

  static const String _svgBagLuxury = '''
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8.5 7.5 V5 C8.5 3.3 10 2 12 2 C14 2 15.5 3.3 15.5 5 V7.5" />
  <path d="M5.5 7.5 H18.5 L19.5 20.5 C19.5 21.3 18.8 22 18 22 H6 C5.2 22 4.5 21.3 4.5 20.5 L5.5 7.5 Z" />
  <path d="M9.8 13.2 C9.2 12.6 8.5 12.5 7.8 13 C7.1 13.5 7 14.8 7.8 15.6 C8.5 16.3 9.7 16.3 10 15.3 H8.8" />
  <path d="M12.2 16.5 L14 12.2 L15.8 16.5 M12.8 15.2 H15.2" />
  <path d="M16 10.5 L16.4 11.5 L17.5 11.8 L16.4 12.1 L16 13.1 L15.6 12.1 L14.5 11.8 L15.6 11.5 Z" stroke-width="0.9" />
</svg>
''';

  static const String _svgAuraLuxury = '''
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 3 C12 7.8 8.2 11.8 3.5 12 C8.2 12.2 12 16.2 12 21 C12 16.2 15.8 12.2 20.5 12 C15.8 11.8 12 7.8 12 3 Z" fill="#D4AF37" fill-opacity="0.18" />
  <circle cx="6.5" cy="6.5" r="0.9" fill="#D4AF37" />
  <circle cx="17.5" cy="6.5" r="0.9" fill="#D4AF37" />
  <circle cx="6.5" cy="17.5" r="0.9" fill="#D4AF37" />
  <circle cx="17.5" cy="17.5" r="0.9" fill="#D4AF37" />
</svg>
''';

  static const String _svgProfileLuxury = '''
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M11 4.5 C9.8 5 9.2 6.2 9.2 7.5 C9.2 8.5 8.7 9.2 8 10 L8.8 10.8 C8.2 11.4 8.5 12 8 12.5 C8.8 13.5 9 14.5 8.5 15.5 C9.5 17 10.5 18 11 20" />
  <path d="M11 4.5 C14.5 4.5 16.5 6.5 16.5 10 C17.8 9.2 19.5 10 19.5 12 C19.5 14 17.5 15 16 14 C15.5 16 14 17.5 12.5 18" />
  <path d="M13.5 11.5 C14.2 11.5 14.5 12.2 14.2 13 C13.8 13.5 13.2 13.5 13 13" />
  <path d="M13.8 15 L14.2 15.8 L15 16 L14.2 16.2 L13.8 17 L13.4 16.2 L12.6 16 L13.4 15.8 Z" stroke-width="0.8" fill="#D4AF37" />
  <path d="M10.5 10 L10.8 10.8 L11.6 11 L10.8 11.2 L10.5 12 L10.2 11.2 L9.4 11 L10.2 10.8 Z" stroke-width="0.8" fill="#D4AF37" />
</svg>
''';

  Widget _buildFlatNavItem({
    required Widget iconWidget,
    required String label,
    required VoidCallback onTap,
    bool isMen = false,
  }) {
    return Expanded(
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () {
            HapticFeedback.selectionClick();
            onTap();
          },
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                SizedBox(
                  height: 26,
                  child: Center(child: iconWidget),
                ),
                const SizedBox(height: 4),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.4,
                    color: isMen ? const Color(0xFFE5C158) : const Color(0xFF8C6F65),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildLuxuryCenterMedallion({
    required Widget iconWidget,
    required String label,
    required VoidCallback onTap,
    bool isMen = false,
  }) {
    bool isPressed = false;
    return Expanded(
      child: StatefulBuilder(
        builder: (ctx, setLocalState) {
          return GestureDetector(
            onTapDown: (_) => setLocalState(() => isPressed = true),
            onTapUp: (_) => setLocalState(() => isPressed = false),
            onTapCancel: () => setLocalState(() => isPressed = false),
            onTap: () {
              HapticFeedback.lightImpact();
              onTap();
            },
            child: AnimatedScale(
              scale: isPressed ? 0.93 : 1.0,
              duration: const Duration(milliseconds: 120),
              curve: Curves.easeOutCubic,
              child: Transform.translate(
                offset: const Offset(0, -18),
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 62,
                        height: 62,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          gradient: RadialGradient(
                            center: const Alignment(0.0, -0.25),
                            radius: 0.85,
                            colors: isMen
                                ? const [
                                    Color(0xFF3D3228),
                                    Color(0xFF2A211A),
                                    Color(0xFF1E1712),
                                    Color(0xFF14100C),
                                  ]
                                : const [
                                    Color(0xFFFFFFFF),
                                    Color(0xFFFDFBF7),
                                    Color(0xFFF5EBE1),
                                    Color(0xFFEADCCF),
                                  ],
                            stops: const [0.0, 0.35, 0.75, 1.0],
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: const Color(0xFFD4AF37).withValues(alpha: isMen ? 0.45 : 0.35),
                              blurRadius: 16,
                              spreadRadius: 2,
                              offset: const Offset(0, 6),
                            ),
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.08),
                              blurRadius: 8,
                              offset: const Offset(0, 3),
                            ),
                          ],
                          border: Border.all(
                            color: const Color(0xFFD4AF37),
                            width: 2.2,
                          ),
                        ),
                        child: Center(
                          child: Container(
                            width: 52,
                            height: 52,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: const Color(0xFFD4AF37).withValues(alpha: 0.35),
                                width: 1.0,
                              ),
                            ),
                            child: Center(
                              child: iconWidget,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        label,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.6,
                          color: isMen ? const Color(0xFFE5C158) : const Color(0xFFB8860B),
                        ),
                      ),
                    ],
                  ),
                )
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildSneakPeekCard(ProviderModel p, bool isMen) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: isMen
            ? const Color(0xFF141210).withValues(alpha: 0.94)
            : const Color(0xFFFAF8F5).withValues(alpha: 0.95),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: const Color(0xFFD4AF37).withValues(alpha: isMen ? 0.6 : 0.45),
          width: 1.2,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: isMen ? 0.45 : 0.15),
            blurRadius: 20,
            offset: const Offset(0, 6),
          ),
          BoxShadow(
            color: const Color(0xFFD4AF37).withValues(alpha: isMen ? 0.2 : 0.1),
            blurRadius: 12,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          GestureDetector(
            onTap: () {
              Navigator.pushNamed(
                context,
                '/provider-detail',
                arguments: {'providerId': p.id},
              );
            },
            child: Container(
              width: 54,
              height: 54,
              padding: const EdgeInsets.all(2),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: const Color(0xFFD4AF37), width: 2),
              ),
              child: ClipOval(
                child: p.avatarUrl.isNotEmpty
                    ? Image.network(
                        p.avatarUrl,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => Container(
                          color: isMen ? const Color(0xFF2A231C) : const Color(0xFFE8DED1),
                          child: Center(
                            child: Text(
                              p.fullName.isNotEmpty ? p.fullName[0].toUpperCase() : '?',
                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Color(0xFFD4AF37)),
                            ),
                          ),
                        ),
                      )
                    : Container(
                        color: isMen ? const Color(0xFF2A231C) : const Color(0xFFE8DED1),
                        child: Center(
                          child: Text(
                            p.fullName.isNotEmpty ? p.fullName[0].toUpperCase() : '?',
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Color(0xFFD4AF37)),
                          ),
                        ),
                      ),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                GestureDetector(
                  onTap: () {
                    Navigator.pushNamed(
                      context,
                      '/provider-detail',
                      arguments: {'providerId': p.id},
                    );
                  },
                  behavior: HitTestBehavior.opaque,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Expanded(
                            child: Text(
                              p.fullName.isNotEmpty ? p.fullName : p.businessName,
                              style: TextStyle(
                                fontFamily: 'CormorantGaramond',
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                                color: isMen ? const Color(0xFFFAF8F5) : const Color(0xFF1E1A16),
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.star_rounded, size: 14, color: Color(0xFFD4AF37)),
                              const SizedBox(width: 2),
                              Text(
                                p.rating > 0 ? p.rating.toStringAsFixed(1) : '4.9',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold,
                                  color: isMen ? const Color(0xFFE5C158) : const Color(0xFF3D2E1E),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        p.businessName.isNotEmpty ? p.businessName : 'Estilista Profesional GlowApp',
                        style: TextStyle(
                          fontSize: 11.5,
                          color: isMen ? Colors.white60 : const Color(0xFF6B5E55),
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    // Botón 1: Ver Perfil (Directo al Perfil Completo sin pestañas intermedias)
                    Expanded(
                      flex: 1,
                      child: SizedBox(
                        height: 34,
                        child: OutlinedButton(
                          onPressed: () {
                            Navigator.pushNamed(
                              context,
                              '/provider-detail',
                              arguments: {'providerId': p.id},
                            );
                          },
                          style: OutlinedButton.styleFrom(
                            side: const BorderSide(color: Color(0xFFC5A052), width: 1.2),
                            foregroundColor: isMen ? const Color(0xFFE5C158) : const Color(0xFF8C6F65),
                            padding: const EdgeInsets.symmetric(horizontal: 4),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                          ),
                          child: const Text(
                            'Ver Perfil',
                            style: TextStyle(
                              fontFamily: 'CormorantGaramond',
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                              letterSpacing: 0.2,
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    // Botón 2: Reservar Ya (Acción directa en 2 toques)
                    Expanded(
                      flex: 1,
                      child: SizedBox(
                        height: 34,
                        child: ElevatedButton.icon(
                          onPressed: () => _openBookingDirectly(context, p),
                          icon: const Icon(Icons.bolt_rounded, size: 15, color: Color(0xFF14100C)),
                          label: const Text(
                            'Reservar Ya',
                            style: TextStyle(
                              fontFamily: 'CormorantGaramond',
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFF14100C),
                              letterSpacing: 0.2,
                            ),
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFFC5A052),
                            foregroundColor: const Color(0xFF14100C),
                            padding: const EdgeInsets.symmetric(horizontal: 4),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                            elevation: 2,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    InkWell(
                      onTap: () {
                        setState(() {
                          _selectedProvider = null;
                        });
                      },
                      borderRadius: BorderRadius.circular(18),
                      child: Padding(
                        padding: const EdgeInsets.all(4.0),
                        child: Icon(Icons.close_rounded, size: 18, color: isMen ? Colors.white54 : Colors.black45),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AudienceMode>(
      valueListenable: AudienceService.currentAudience,
      builder: (context, audienceMode, child) {
        final isMen = audienceMode == AudienceMode.men;
        final useDarkMap = isMen || MapSettings.isDark;

        return Scaffold(
          backgroundColor: isMen ? MensTheme.obsidianBg : const Color(0xFFFAF8F5),
          body: Stack(
            children: [
              // Capa 0: Mapa a pantalla completa centrado en Bogotá (CartoDB Voyager / Dark Matter)
              FlutterMap(
                mapController: _mapController,
                options: MapOptions(
                  initialCenter: _bogotaCenter,
                  initialZoom: 13.5,
                ),
                children: [
                  TileLayer(
                    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                    userAgentPackageName: 'com.beautyapp.map',
                    tileBuilder: (context, tileWidget, tile) {
                      if (useDarkMap) {
                        return ColorFiltered(
                          colorFilter: const ColorFilter.matrix(<double>[
                            0.574, -1.43, -0.144, 0, 255,
                            -0.426, -0.43, -0.144, 0, 255,
                            -0.426, -1.43, 0.856, 0, 255,
                            0, 0, 0, 1, 0,
                          ]),
                          child: tileWidget,
                        );
                      }
                      return ColorFiltered(
                        colorFilter: const ColorFilter.matrix(<double>[
                          0.65, 0.25, 0.10, 0, 15,
                          0.20, 0.65, 0.15, 0, 10,
                          0.15, 0.20, 0.50, 0, 0,
                          0,    0,    0,    1, 0,
                        ]),
                        child: tileWidget,
                      );
                    },
                  ),
              // Marcadores Joya de prestadores en el mapa + marcador de ubicación del usuario
              MarkerLayer(
                markers: [
                  if (_userLocation != null)
                    Marker(
                      width: 50,
                      height: 50,
                      point: _userLocation!,
                      child: Container(
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: const Color(0xFFD4AF37).withValues(alpha: 0.2),
                          border: Border.all(
                              color: const Color(0xFFD4AF37), width: 2),
                        ),
                        child: const Center(
                          child: Icon(Icons.my_location,
                              color: Color(0xFFD4AF37), size: 24),
                        ),
                      ),
                    ),
                  ..._filteredProviders.map((p) {
                    final isSelected = _selectedProvider?.id == p.id;
                    return Marker(
                      width: 70,
                      height: 78,
                      point: LatLng(p.latitude, p.longitude),
                      child: GestureDetector(
                        onTap: () {
                          setState(() {
                            _selectedProvider = p;
                          });
                        },
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              padding: const EdgeInsets.all(2.5),
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: isMen ? const Color(0xFF1E1A16) : const Color(0xFFFAF8F5),
                                border: Border.all(
                                  color: isSelected
                                      ? (isMen ? const Color(0xFFE5C158) : const Color(0xFFD4AF37))
                                      : const Color(0xFFC5A052),
                                  width: isSelected ? 3.0 : 2.0,
                                ),
                                boxShadow: [
                                  BoxShadow(
                                    color: const Color(0xFFD4AF37).withValues(alpha: isSelected ? 0.6 : 0.35),
                                    blurRadius: isSelected ? 14 : 8,
                                    spreadRadius: isSelected ? 2 : 0,
                                    offset: const Offset(0, 3),
                                  ),
                                ],
                              ),
                              child: CircleAvatar(
                                radius: 19,
                                backgroundColor: isMen ? const Color(0xFF2A231C) : const Color(0xFFF5EBE6),
                                backgroundImage: p.avatarUrl.isNotEmpty ? NetworkImage(p.avatarUrl) : null,
                                child: p.avatarUrl.isEmpty
                                    ? (p.isSalon
                                        ? const Icon(
                                            Icons.storefront_rounded,
                                            size: 20,
                                            color: Color(0xFFD4AF37),
                                          )
                                        : Text(
                                            p.fullName.isNotEmpty ? p.fullName[0].toUpperCase() : '?',
                                            style: TextStyle(
                                              fontSize: 14,
                                              color: isMen ? const Color(0xFFD4AF37) : AppTheme.primary,
                                              fontWeight: FontWeight.bold,
                                            ),
                                          ))
                                    : null,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                              decoration: BoxDecoration(
                                color: isMen ? const Color(0xFF141210) : const Color(0xFFFDFBF7),
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(
                                  color: const Color(0xFFD4AF37).withValues(alpha: 0.6),
                                  width: 0.8,
                                ),
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.black.withValues(alpha: 0.2),
                                    blurRadius: 4,
                                    offset: const Offset(0, 1),
                                  ),
                                ],
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(Icons.star_rounded, size: 10, color: Color(0xFFD4AF37)),
                                  const SizedBox(width: 1.5),
                                  Text(
                                    p.rating > 0 ? p.rating.toStringAsFixed(1) : '4.9',
                                    style: TextStyle(
                                      fontSize: 9.5,
                                      fontWeight: FontWeight.bold,
                                      color: isMen ? const Color(0xFFE5C158) : const Color(0xFF3D2E1E),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                ],
              ),
            ],
          ),


          // Capa 1: Floating Transaccional Search Bar with Audience Toggle
          Positioned(
            top: MediaQuery.of(context).padding.top + 12,
            left: 16,
            right: 16,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                // Selector Global de Audiencia (Hombres / Mujeres / Todos)
                const Padding(
                  padding: EdgeInsets.only(bottom: 8.0),
                  child: AudienceToggleWidget(compact: false),
                ),
                Container(
                  height: 54,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  decoration: BoxDecoration(
                    color: isMen
                        ? const Color(0xFF141210).withValues(alpha: 0.94)
                        : const Color(0xFFFAF8F5).withValues(alpha: 0.95),
                    borderRadius: BorderRadius.circular(30),
                    border: Border.all(
                      color: const Color(0xFFD4AF37).withValues(alpha: isMen ? 0.6 : 0.45),
                      width: 1.5,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: isMen ? 0.4 : 0.08),
                        blurRadius: 16,
                        offset: const Offset(0, 4),
                      ),
                    ],
                  ),
                  child: Row(
                    children: [
                      InkWell(
                        onTap: () {
                          if (_searchController.text.trim().isNotEmpty) {
                            _navigateToAIChat(_searchController.text);
                          }
                        },
                        borderRadius: BorderRadius.circular(20),
                        child: const Padding(
                          padding: EdgeInsets.all(8.0),
                          child: Icon(Icons.search, color: Color(0xFFD4AF37)),
                        ),
                      ),
                      const SizedBox(width: 2),
                      Expanded(
                        child: TextField(
                          controller: _searchController,
                          textCapitalization: TextCapitalization.sentences,
                          style: TextStyle(
                            color: isMen ? Colors.white : const Color(0xFF1E1A16),
                            fontSize: 13,
                          ),
                          decoration: InputDecoration(
                            hintText: isMen
                                ? 'Buscar estilista o servicio... ✨'
                                : '¿Qué ritual deseas hoy? Pregunta a Aura ✨',
                            hintStyle: TextStyle(
                              fontSize: 12.0,
                              color: isMen
                                  ? const Color(0xFFD4AF37).withValues(alpha: 0.75)
                                  : const Color(0xFF6B5E55).withValues(alpha: 0.8),
                              letterSpacing: 0.1,
                            ),
                            contentPadding: const EdgeInsets.symmetric(vertical: 10),
                            border: InputBorder.none,
                          ),
                          onSubmitted: (val) {
                            if (val.trim().isNotEmpty) {
                              _navigateToAIChat(val);
                            }
                          },
                        ),
                      ),
                      InkWell(
                        onTap: () {
                          Navigator.pushNamed(context, '/my-glow');
                        },
                        borderRadius: BorderRadius.circular(20),
                        child: const Padding(
                          padding: EdgeInsets.all(8.0),
                          child: Icon(Icons.auto_awesome, color: Color(0xFFD4AF37)),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Capa 2: Floating Sneak-Peek Card (Selected Stylist Preview)
          if (_selectedProvider != null)
            Positioned(
              bottom: MediaQuery.of(context).padding.bottom + 98,
              left: 16,
              right: 16,
              child: _buildSneakPeekCard(_selectedProvider!, isMen),
            ),

          // Capa 3: Luxury Navigation Dock (Haute Horlogerie & Quiet Luxury)
          Positioned(
            bottom: MediaQuery.of(context).padding.bottom + 16,
            left: 16,
            right: 16,
            child: Container(
              height: 72,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              decoration: BoxDecoration(
                color: isMen
                    ? const Color(0xFF141210).withValues(alpha: 0.95)
                    : const Color(0xFFFDFBF7),
                borderRadius: BorderRadius.circular(36),
                border: Border.all(
                    color: const Color(0xFFD4AF37).withValues(alpha: isMen ? 0.6 : 0.5),
                    width: 1.5),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: isMen ? 0.45 : 0.08),
                    blurRadius: 20,
                    offset: const Offset(0, 8),
                  ),
                  BoxShadow(
                    color: const Color(0xFFD4AF37).withValues(alpha: isMen ? 0.25 : 0.15),
                    blurRadius: 10,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Row(
                children: [
                  // Botón 1: Citas
                  _buildFlatNavItem(
                    iconWidget: Image.asset(
                      'assets/icons/glow/nav_citas.webp',
                      width: 28,
                      height: 28,
                      fit: BoxFit.contain,
                    ),
                    label: 'Citas',
                    onTap: () => _checkAuthAndNavigate('/client-bookings'),
                    isMen: isMen,
                  ),

                  // Botón 2: GlowShop
                  _buildFlatNavItem(
                    iconWidget: Image.asset(
                      'assets/icons/glow/nav_glowshop.webp',
                      width: 28,
                      height: 28,
                      fit: BoxFit.contain,
                    ),
                    label: 'GlowShop',
                    onTap: () => _checkAuthAndNavigate('/store'),
                    isMen: isMen,
                  ),

                  // Botón 3: Glow IA+ (Medallón Central Elevado)
                  _buildLuxuryCenterMedallion(
                    iconWidget: Image.asset(
                      'assets/icons/glow/nav_glow_ia.webp',
                      width: 32,
                      height: 32,
                      fit: BoxFit.contain,
                    ),
                    label: 'Glow IA+',
                    onTap: () => _checkAuthAndNavigate('/ideas'),
                    isMen: isMen,
                  ),

                  // Botón 4: Perfil
                  _buildFlatNavItem(
                    iconWidget: Image.asset(
                      'assets/icons/glow/nav_perfil.webp',
                      width: 28,
                      height: 28,
                      fit: BoxFit.contain,
                    ),
                    label: 'Perfil',
                    onTap: () => _checkAuthAndNavigate('/profile'),
                    isMen: isMen,
                  ),
                ],
              ),
            ),
          ),

          // Capa: Ajustes de Mapa (Speed Dial Expandible con Capas y Chat)
          Positioned(
            right: 20,
            bottom: MediaQuery.of(context).padding.bottom + (_selectedProvider != null ? 224 : 104),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (_isMapMenuOpen) ...[
                  // Botón 1: Chat y Asistencia
                  FloatingActionButton.small(
                    heroTag: 'home_chat_integrated_fab',
                    tooltip: 'Mensajes y Asistencia',
                    onPressed: () {
                      HapticFeedback.selectionClick();
                      showModalBottomSheet(
                        context: context,
                        backgroundColor: Colors.transparent,
                        builder: (ctx) => Container(
                          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                          decoration: const BoxDecoration(
                            color: Color(0xFFFAF8F5),
                            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                            boxShadow: [
                              BoxShadow(
                                color: Color(0x1A000000),
                                blurRadius: 16,
                                offset: Offset(0, -4),
                              ),
                            ],
                          ),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 40,
                                height: 4,
                                decoration: BoxDecoration(
                                  color: Colors.grey[300],
                                  borderRadius: BorderRadius.circular(2),
                                ),
                              ),
                              const SizedBox(height: 16),
                              const Text(
                                'Canales de Chat y Asistencia',
                                style: TextStyle(
                                  fontFamily: 'CormorantGaramond',
                                  fontSize: 20,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFF1F1A15),
                                ),
                              ),
                              const SizedBox(height: 14),
                              ListTile(
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                                tileColor: Colors.white,
                                leading: Container(
                                  padding: const EdgeInsets.all(8),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFF3D59B).withValues(alpha: 0.3),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: const Icon(Icons.chat_bubble_outline_rounded, color: Color(0xFFC5A052)),
                                ),
                                title: const Text(
                                  'Bandeja de Mensajes GlowApp',
                                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                                ),
                                subtitle: const Text(
                                  'Chats activos con tus estilistas y reservas',
                                  style: TextStyle(fontSize: 12, color: Color(0xFF6B5E55)),
                                ),
                                trailing: const Icon(Icons.arrow_forward_ios, size: 14, color: Color(0xFFC5A052)),
                                onTap: () {
                                  Navigator.pop(ctx);
                                  _checkAuthAndNavigate('/chat');
                                },
                              ),
                              const SizedBox(height: 10),
                              ListTile(
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                                tileColor: Colors.white,
                                leading: Container(
                                  padding: const EdgeInsets.all(8),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFC5A052).withValues(alpha: 0.2),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: const Icon(Icons.storefront_rounded, color: Color(0xFFC5A052)),
                                ),
                                title: const Text(
                                  'Tablero Salón (SaaS)',
                                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                                ),
                                subtitle: const Text(
                                  'Gestión de equipo, suscripciones y miembros',
                                  style: TextStyle(fontSize: 12, color: Color(0xFF6B5E55)),
                                ),
                                trailing: const Icon(Icons.arrow_forward_ios, size: 14, color: Color(0xFFC5A052)),
                                onTap: () {
                                  Navigator.pop(ctx);
                                  _checkAuthAndNavigate('/salon');
                                },
                              ),
                              const SizedBox(height: 10),
                              ListTile(
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                                tileColor: Colors.white,
                                leading: Container(
                                  padding: const EdgeInsets.all(8),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFF25D366).withValues(alpha: 0.15),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: const Icon(Icons.support_agent_rounded, color: Color(0xFF25D366)),
                                ),
                                title: const Text(
                                  'Concierge WhatsApp VIP',
                                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                                ),
                                subtitle: const Text(
                                  'Atención personalizada (+57 300 912 8899)',
                                  style: TextStyle(fontSize: 12, color: Color(0xFF6B5E55)),
                                ),
                                trailing: const Icon(Icons.arrow_forward_ios, size: 14, color: Color(0xFF25D366)),
                                onTap: () {
                                  Navigator.pop(ctx);
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(
                                      content: Text('Conectando con Concierge GlowApp via WhatsApp (+573009128899)...'),
                                      backgroundColor: Color(0xFF8C6F65),
                                    ),
                                  );
                                },
                              ),
                              const SizedBox(height: 8),
                            ],
                          ),
                        ),
                      );
                    },
                    backgroundColor: AppTheme.surface,
                    foregroundColor: const Color(0xFF25D366),
                    elevation: 3,
                    shape: const CircleBorder(),
                    child: const Icon(
                      Icons.chat_bubble_outline_rounded,
                      size: 20,
                    ),
                  ),
                  const SizedBox(height: 10),
                  // Botón 2: Reiniciar Tutorial GlowGuide
                  FloatingActionButton.small(
                    heroTag: 'glowguide_tutorial_restart_fab',
                    tooltip: 'Ver Tutorial GlowGuide',
                    onPressed: () {
                      HapticFeedback.selectionClick();
                      setState(() {
                        _isMapMenuOpen = false;
                      });
                      GlowGuideService.instance.engine?.forceRestart();
                    },
                    backgroundColor: AppTheme.surface,
                    foregroundColor: const Color(0xFFC5A052),
                    elevation: 3,
                    shape: const CircleBorder(),
                    child: const Icon(
                      Icons.play_circle_fill_rounded,
                      size: 20,
                    ),
                  ),
                  const SizedBox(height: 10),
                  // Botón 3: Mi Ubicación
                  FloatingActionButton.small(
                    heroTag: 'my_location_fab',
                    tooltip: 'Centrar Mi Ubicación',
                    onPressed: _determineUserLocation,
                    backgroundColor: AppTheme.surface,
                    foregroundColor: AppTheme.primary,
                    elevation: 3,
                    shape: const CircleBorder(),
                    child: const Icon(Icons.my_location, size: 20),
                  ),
                  const SizedBox(height: 10),
                  // Botón 4: Tablero Salón (SaaS)
                  FloatingActionButton.small(
                    heroTag: 'salon_dashboard_fab',
                    tooltip: 'Tablero Salón (SaaS)',
                    onPressed: () {
                      HapticFeedback.selectionClick();
                      Navigator.pushNamed(context, '/salon');
                    },
                    backgroundColor: const Color(0xFFC5A052),
                    foregroundColor: const Color(0xFF1F1A15),
                    elevation: 4,
                    shape: const CircleBorder(),
                    child: const Icon(Icons.storefront_rounded, size: 20),
                  ),
                  const SizedBox(height: 10),
                ],
                // Botón principal de menú expandible (Capas)
                FloatingActionButton(
                  heroTag: 'map_settings_toggle_fab',
                  tooltip: 'Capas y Opciones',
                  onPressed: () {
                    setState(() {
                      _isMapMenuOpen = !_isMapMenuOpen;
                    });
                  },
                  backgroundColor: AppTheme.primary,
                  foregroundColor: Colors.white,
                  elevation: 4,
                  shape: const CircleBorder(),
                  child: Icon(
                    _isMapMenuOpen ? Icons.close : Icons.layers_outlined,
                    size: 24,
                  ),
                ),
              ],
            ),
          ),

          // Indicador de carga discreto no bloqueante
          if (_isLoading)
            Positioned(
              top: MediaQuery.of(context).padding.top,
              left: 0,
              right: 0,
              child: const LinearProgressIndicator(
                backgroundColor: Colors.transparent,
                color: Color(0xFFD4AF37),
                minHeight: 3,
              ),
            ),

          // Alerta de Error
          if (_errorMessage != null)
            Positioned(
              bottom: 100,
              left: 20,
              right: 20,
              child: Card(
                color: Colors.red[50],
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16)),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: [
                      const Icon(Icons.error_outline, color: Colors.red),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          'No se pudo conectar: $_errorMessage',
                          style:
                              TextStyle(color: Colors.red[800], fontSize: 13),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.refresh, color: Colors.red),
                        onPressed: _loadProviders,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          // Capa: Tutorial interactivo guiado por Aura (LEGACY)
          // Legacy Mutex: solo se renderiza cuando _enableLegacy es true.
          if (_enableLegacy && _showTutorial)
            _buildTutorialOverlay(),
        ],
      ),
    );
      },
    );
  }

  Widget _buildTutorialOverlay() {
    final double topPadding = MediaQuery.of(context).padding.top;
    
    // Contenido dinámico según el paso (0 al 3)
    String stepTitle = '';
    String stepDescription = '';
    Widget? highlightWidget;
    Widget centerGraphic = const SizedBox.shrink();

    if (_tutorialStep == 0) {
      stepTitle = '¡Te doy la bienvenida! 🌸';
      stepDescription = 'Hola, soy Aura, tu asistente personal de belleza. Permíteme guiarte en este recorrido interactivo por GlowApp.';
      centerGraphic = Container(
        width: 140,
        height: 140,
        decoration: BoxDecoration(
          color: Colors.white,
          shape: BoxShape.circle,
          border: Border.all(color: const Color(0xFFD4AF37), width: 3.5),
          image: const DecorationImage(
            image: AssetImage('images/avatar_aura.webp'),
            fit: BoxFit.cover,
          ),
        ),
      );
    } else if (_tutorialStep == 1) {
      stepTitle = '1. Estilistas en el Mapa';
      stepDescription = 'Los estilistas disponibles cerca de tu zona se muestran como círculos con sus fotos. ¡Toca el marcador de Ana Silva para ver su perfil!';
      // Destacamos un marcador del mapa (simulando un toque)
      highlightWidget = Center(
        child: IgnorePointer(
          child: Container(
            width: 70,
            height: 70,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: const Color(0xFFD4AF37), width: 3),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFFD4AF37).withValues(alpha: 0.6),
                  blurRadius: 20,
                  spreadRadius: 6,
                ),
              ],
            ),
            child: const Icon(Icons.touch_app, color: Color(0xFFD4AF37), size: 36),
          ),
        ),
      );
    } else if (_tutorialStep == 2) {
      stepTitle = '2. Perfil Profesional y Portafolio';
      stepDescription = 'Explora la galería de fotos certificadas de trabajos anteriores, opiniones reales y su catálogo de servicios de belleza disponibles.';
      // Renderizamos el perfil detallado del proveedor simulado
      highlightWidget = Positioned(
        top: topPadding + 20,
        left: 20,
        right: 20,
        bottom: MediaQuery.of(context).size.height * 0.45,
        child: Card(
          elevation: 8,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                height: 90,
                decoration: const BoxDecoration(
                  image: DecorationImage(
                    image: AssetImage('images/logo_maestro_v5.webp'),
                    fit: BoxFit.cover,
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: const BoxDecoration(
                        shape: BoxShape.circle,
                        image: DecorationImage(
                          image: AssetImage('images/logo_maestro_v3.webp'),
                          fit: BoxFit.cover,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Ana Silva', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.text)),
                        Text('Estilista Capilar Profesional', style: TextStyle(fontSize: 11, color: Colors.grey)),
                      ],
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Padding(
                padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Text(
                  'Servicios Disponibles:',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.text),
                ),
              ),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  children: [
                    _buildMockServiceTile('Corte de Cabello Dama', '\$45.000 COP'),
                    _buildMockServiceTile('Peinado Especial Fiesta', '\$60.000 COP'),
                  ],
                ),
              ),
            ],
          ),
        ),
      );
    } else if (_tutorialStep == 3) {
      stepTitle = '3. Reserva y Pago Seguro';
      stepDescription = 'Selecciona el día y la hora de tu conveniencia. El pago se procesa por Wompi Bancolombia en modo garantía: el dinero solo se libera cuando ingreses el PIN OTP al finalizar el servicio.';
      centerGraphic = Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFFEAEFEA),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: const Color(0xFF4A5D4E), width: 2),
        ),
        child: const Column(
          children: [
            Icon(Icons.security, color: Color(0xFF4A5D4E), size: 48),
            SizedBox(height: 8),
            Text(
              'Transacción Segura de Pago',
              style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF4A5D4E)),
            ),
            SizedBox(height: 4),
            Text(
              'Depósito de Garantía Wompi Activo\nMonto total: \$45.000 COP',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 11, color: Color(0xFF4A5D4E)),
            ),
          ],
        ),
      );
    }

    return Stack(
      children: [
        // Fondo translúcido que bloquea clics traseros
        GestureDetector(
          onTap: () {}, 
          child: Container(
            color: Colors.black.withValues(alpha: 0.7),
          ),
        ),
        
        // Elemento destacado si aplica en el paso
        if (highlightWidget != null) highlightWidget,

        // Botón "Omitir" rápido en la esquina superior derecha
        Positioned(
          top: topPadding + 16,
          right: 16,
          child: FloatingActionButton.small(
            heroTag: 'tutorial_skip_fab',
            onPressed: _completeTutorial,
            backgroundColor: Colors.white.withValues(alpha: 0.9),
            foregroundColor: AppTheme.text,
            child: const Icon(Icons.close, size: 20),
          ),
        ),

        // Tarjeta interactiva de Aura (centrada en el paso 0, inferior en los demás)
        AnimatedPositioned(
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeInOut,
          left: 20,
          right: 20,
          bottom: _tutorialStep == 0 
              ? MediaQuery.of(context).size.height * 0.25 
              : 20,
          child: Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(28),
              border: Border.all(color: AppTheme.accent.withValues(alpha: 0.4), width: 1.5),
              boxShadow: AppTheme.glassShadow,
            ),
            child: AnimatedSize(
              duration: const Duration(milliseconds: 250),
              curve: Curves.easeInOut,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  AnimatedSwitcher(
                    duration: const Duration(milliseconds: 250),
                    child: centerGraphic is! SizedBox 
                        ? Container(
                            key: ValueKey<int>(_tutorialStep),
                            margin: const EdgeInsets.only(bottom: 20),
                            child: centerGraphic,
                          )
                        : const SizedBox.shrink(),
                  ),
                  AnimatedSwitcher(
                    duration: const Duration(milliseconds: 250),
                    child: Row(
                      key: ValueKey<int>(_tutorialStep),
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (_tutorialStep > 0) ...[
                          Container(
                            width: 58,
                            height: 58,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(color: const Color(0xFFD4AF37), width: 2.0),
                              image: const DecorationImage(
                                image: AssetImage('images/avatar_aura.webp'),
                                fit: BoxFit.cover,
                              ),
                            ),
                          ),
                          const SizedBox(width: 16),
                        ],
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                stepTitle,
                                style: TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.bold,
                                  color: AppTheme.text,
                                  letterSpacing: -0.5,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                stepDescription,
                                style: TextStyle(
                                  fontSize: 14,
                                  color: Colors.grey[700],
                                  height: 1.4,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  
                  // Indicador de progreso con 4 puntos interactivos
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(4, (index) {
                      final bool isActive = _tutorialStep == index;
                      return AnimatedContainer(
                        duration: const Duration(milliseconds: 250),
                        margin: const EdgeInsets.symmetric(horizontal: 4),
                        width: isActive ? 12 : 8,
                        height: 8,
                        decoration: BoxDecoration(
                          color: isActive ? AppTheme.primary :  const Color(0xFFE5CECA),
                          borderRadius: BorderRadius.circular(4),
                        ),
                      );
                    }),
                  ),
                  const SizedBox(height: 20),

                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      TextButton(
                        onPressed: _completeTutorial,
                        child: Text(
                          'Saltar',
                          style: TextStyle(
                            color: Colors.grey[500],
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                      Row(
                        children: [
                          if (_tutorialStep > 0)
                            Padding(
                              padding: const EdgeInsets.only(right: 8),
                              child: OutlinedButton(
                                style: OutlinedButton.styleFrom(
                                  side: BorderSide(color: AppTheme.accent),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(20),
                                  ),
                                ),
                                onPressed: () => _handleTutorialStepChange(_tutorialStep - 1),
                                child: Text(
                                  'Atrás',
                                  style: TextStyle(color: AppTheme.text),
                                ),
                              ),
                            ),
                          ElevatedButton(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppTheme.primary,
                              foregroundColor: Colors.white,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(20),
                              ),
                              elevation: 0,
                            ),
                            onPressed: () {
                              if (_tutorialStep < 3) {
                                _handleTutorialStepChange(_tutorialStep + 1);
                              } else {
                                _completeTutorial();
                              }
                            },
                            child: Text(
                              _tutorialStep == 3 ? 'Finalizar' : 'Siguiente',
                              style: const TextStyle(fontWeight: FontWeight.bold),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  // Helpers para los Mocks Visuales del Tutorial
  Widget _buildMockServiceTile(String title, String price) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.grey[50],
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.grey[200]!),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(title, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500)),
            Text(price, style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.primary)),
          ],
        ),
      ),
    );
  }
}
