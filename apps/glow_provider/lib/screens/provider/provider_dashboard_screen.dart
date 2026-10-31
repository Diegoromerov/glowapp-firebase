// frontend/lib/screens/provider_dashboard_screen.dart
import 'dart:async';
import 'package:glow_core/services/web_geolocation.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter/services.dart';
import 'package:glow_provider/screens/chat/chat_screen.dart';
import 'provider_route_screen.dart';
import '../wallet/wallet_screen.dart';
import 'provider_ai_copilot_screen.dart';
import '../chat/chat_list_screen.dart';
import 'provider_profile_screen.dart';
import '../store/store_screen.dart';
import '../academy/academy_screen.dart';
import 'package:glow_core/services/api_service.dart';
import 'package:glow_core/services/auth_service.dart';
import 'package:glow_core/services/analytics_service.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'dart:convert';
import 'package:glow_core/services/audio_player.dart';
import 'package:glow_core/services/audience_service.dart';
import 'package:glow_core/shared/theme.dart' hide AppTheme;
import 'package:glow_core/design/icons/glow_icon.dart';
import 'package:glow_core/glowguide/config/provider_guide.dart';
import 'package:glow_core/glowguide/contracts/navigation_delegate.dart';
import 'package:glow_core/glowguide/engine/glowguide_engine.dart';
import 'package:glow_core/glowguide/audio/audio_engine.dart';
import 'package:glow_core/glowguide/persistence/persistence_engine.dart';
import 'package:glow_core/glowguide/observer/screen_visibility_observer.dart';
import 'package:glow_core/glowguide/presenter/glowguide_presenter.dart';
import 'package:glow_core/glow_core.dart';

class ProviderDashboardScreen extends StatefulWidget {
  const ProviderDashboardScreen({super.key});
  @override
  State<ProviderDashboardScreen> createState() =>
      _ProviderDashboardScreenState();
}

class _ProviderDashboardScreenState extends State<ProviderDashboardScreen> {
  List<Map<String, dynamic>> _bookings = [];
  bool _loading = true;
  bool _loadingProfile = true;
  String? _error;
  bool _isActive = true;
  double? _ratingAvg;
  int _ratingCount = 0;

  // Sprint 2 Navigation & Innovation State
  int _currentIndex = 0;
  late final GlowGuideEngine _providerGuideEngine;
  late final AudioEngine _providerGuideAudioEngine;
  late final PersistenceEngine _providerGuidePersistence;
  bool _providerGuideStartScheduled = false;
  String _selectedAgendaFilter = 'TODAS';
  String _agendaSearchQuery = '';
  final TextEditingController _agendaSearchController = TextEditingController();

  // Localized loading states
  final Set<String> _loadingBookings = {};
  bool _loadingSOS = false;
  bool _isTogglingStatus = false;

  WebSocketChannel? _webSocketChannel;

  String? _userRole;

  @override
  void initState() {
    super.initState();
    _loadUserRole();
    _fetchBookings();
    _fetchProfile();
    _initWebSocket();
    _initializeProviderGuide();
  }

  void _initializeProviderGuide() {
    _providerGuideAudioEngine = AudioEngine();
    _providerGuidePersistence = PersistenceEngine();
    _providerGuideEngine = GlowGuideEngine(
      steps: ProviderGuide.steps,
      guideId: ProviderGuide.guideId,
      navigationDelegate: ProviderGuideNavigationDelegate(),
      audioController: _providerGuideAudioEngine,
      persistenceAdapter: _providerGuidePersistence,
      screenVisibilityObserver: ScreenVisibilityObserverSingleton.instance,
    );

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _providerGuideStartScheduled) return;
      _providerGuideStartScheduled = true;
      _startProviderGuideIfEligible();
    });
  }

  Future<void> _startProviderGuideIfEligible() async {
    final prefs = await SharedPreferences.getInstance();
    final role = (prefs.getString('userRole') ?? '').toLowerCase();
    if (!mounted || role == 'salon') return;
    await _providerGuideEngine.start();
  }

  Future<void> _loadUserRole() async {
    final prefs = await SharedPreferences.getInstance();
    if (mounted) {
      setState(() {
        _userRole = prefs.getString('userRole');
      });
    }
  }

  @override
  void dispose() {
    _webSocketChannel?.sink.close();
    _providerGuideEngine.dispose();
    super.dispose();
  }

  void _handleProviderGuideAction(GlowGuidePresenterAction action) {
    switch (action) {
      case GlowGuidePresenterAction.next:
        final nextIndex = _providerGuideEngine.state.currentStepIndex + 1;
        if (nextIndex < ProviderGuide.steps.length && mounted) {
          setState(() => _currentIndex = nextIndex);
        }
        _providerGuideEngine.next();
        break;
      case GlowGuidePresenterAction.previous:
        final previousIndex = _providerGuideEngine.state.currentStepIndex - 1;
        if (previousIndex >= 0 && mounted) {
          setState(() => _currentIndex = previousIndex);
        }
        _providerGuideEngine.previous();
        break;
      case GlowGuidePresenterAction.dismiss:
        _providerGuideEngine.dismiss();
        break;
      case GlowGuidePresenterAction.replay:
        _providerGuideEngine.replay();
        break;
      case GlowGuidePresenterAction.pause:
        _providerGuideEngine.pause();
        break;
      case GlowGuidePresenterAction.resume:
        _providerGuideEngine.resume();
        break;
    }
  }

  void _initWebSocket() async {
    try {
      final token = await AuthService.getToken();
      final baseUrl = await AuthService.getBaseUrl();
      final wsBase = baseUrl.replaceFirst('http', 'ws');
      final wsUrl = '$wsBase/chat';

      _webSocketChannel = WebSocketChannel.connect(Uri.parse(wsUrl));

      // Registrar prestador en WebSocket enviando el token
      _webSocketChannel!.sink.add(jsonEncode({
        'type': 'register',
        'token': token,
      }));

      _webSocketChannel!.stream.listen(
        (message) {
          try {
            final data = jsonDecode(message);
            if (data['type'] == 'new_booking') {
              // Reproducir audio "GlowApp"
              playGlowAppAlert();

              // Mostrar alerta visual persistente
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Row(
                      children: [
                        const Icon(Icons.notifications_active, color: Colors.white),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            data['data']['message'] ?? '¡Nueva reserva en GlowApp!',
                            style: const TextStyle(fontWeight: FontWeight.bold),
                          ),
                        ),
                      ],
                    ),
                    backgroundColor: AppTheme.primary,
                    behavior: SnackBarBehavior.floating,
                    duration: const Duration(seconds: 8),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                  ),
                );
                // Actualizar la lista de citas en el dashboard
                _fetchBookings();
              }
            }
          } catch (e) {
            debugPrint('Error decodificando evento WS: $e');
          }
        },
        onError: (err) {
          debugPrint('Error en WebSocket del dashboard: $err');
          // Reconectar automáticamente en 5 segundos
          Future.delayed(const Duration(seconds: 5), () {
            if (mounted) _initWebSocket();
          });
        },
        onDone: () {
          debugPrint('WebSocket del dashboard desconectado.');
          // Reconectar automáticamente en 5 segundos
          Future.delayed(const Duration(seconds: 5), () {
            if (mounted) _initWebSocket();
          });
        },
      );
    } catch (e) {
      debugPrint('Error inicializando WebSocket: $e');
    }
  }

  Future<void> _fetchBookings() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await ApiService.fetchProviderBookings();
      if (mounted) {
        setState(() {
          _bookings = data;
          _loading = false;
        });
      }
    } catch (e) {
      final String errStr = e.toString();
      if (errStr.contains('Token inválido') ||
          errStr.contains('expirado') ||
          errStr.contains('401')) {
        await AuthService.logout();
        if (mounted) {
          Navigator.pushReplacementNamed(context, '/login');
          return;
        }
      }
      if (mounted) {
        setState(() {
          _error = errStr;
          _loading = false;
        });
      }
    }
  }

  Future<void> _fetchProfile() async {
    if (!mounted) return;
    setState(() => _loadingProfile = true);
    try {
      final data = await ApiService.fetchUserProfile();
      if (data['role'] == 'provider' &&
          data['estatus_verificacion'] != 'APROBADO') {
        if (mounted) {
          Navigator.pushReplacementNamed(context, '/verification-pending');
          return;
        }
      }
      if (mounted) {
        setState(() {
          _isActive = data['is_active'] ?? true;
          _ratingAvg = data['rating_avg'] != null
              ? double.tryParse(data['rating_avg'].toString())
              : null;
          _ratingCount =
              int.tryParse(data['rating_count']?.toString() ?? '') ?? 0;
          _loadingProfile = false;
        });

        // Si el proveedor está en línea, refrescamos su ubicación en background
        if (_isActive) {
          _refreshActiveLocation();
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() => _loadingProfile = false);
      }
    }
  }

  Future<void> _refreshActiveLocation() async {
    try {
      final pos = await getWebGeolocation();
      await ApiService.updateProviderStatus(true,
          latitude: pos['lat'], longitude: pos['lon']);
      debugPrint(
          '🟢 Ubicación actualizada automáticamente al cargar perfil: ${pos['lat']}, ${pos['lon']}');
    } catch (e) {
      debugPrint('❌ Error al actualizar ubicación automáticamente: $e');
    }
  }

  Future<void> _handleStartService(String bookingId) async {
    setState(() => _loadingBookings.add(bookingId));
    try {
      await ApiService.startBooking(bookingId);
      HapticFeedback.mediumImpact();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Row(
              children: [
                Icon(Icons.play_circle_fill, color: Colors.white),
                SizedBox(width: 8),
                Text('🚀 Servicio iniciado. ¡A dar el mejor look, vecino!'),
              ],
            ),
            backgroundColor: AppTheme.primary,
            behavior: SnackBarBehavior.floating,
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          ),
        );
      }
      _fetchBookings();
      _fetchProfile();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('❌ Error al iniciar servicio: $e'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _loadingBookings.remove(bookingId));
      }
    }
  }

  void _showSegmentedPinDialog(Map<String, dynamic> booking) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => SegmentedPinDialog(
        booking: booking,
        onSuccess: (res) {
          _fetchBookings();
          _fetchProfile();
          _showPayoutBreakdownDialog(res['booking'] ?? booking,
              immediate: true);
        },
      ),
    );
  }

  void _showPayoutBreakdownDialog(Map<String, dynamic> booking,
      {bool immediate = false}) {
    final double gross = double.tryParse(booking['valor_bruto']?.toString() ??
            booking['total_amount']?.toString() ??
            '0.0') ??
        0.0;
    final double platformCut = double.tryParse(
            booking['comision_plataforma']?.toString() ??
                booking['platform_commission']?.toString() ??
                '0.0') ??
        (gross * 0.20);
    final double stateTax = double.tryParse(
            booking['impuestos_estado']?.toString() ??
                booking['state_tax']?.toString() ??
                '0.0') ??
        (gross * 0.08);
    final double tipAmount = double.tryParse(
            booking['propina']?.toString() ??
                booking['tip_amount']?.toString() ??
                '0.0') ??
        0.0;
    final double productsAmount = double.tryParse(
            booking['monto_productos']?.toString() ??
                booking['products_amount']?.toString() ??
                '0.0') ??
        0.0;
    final double netPayout = double.tryParse(
            booking['pago_neto_prestador']?.toString() ??
                booking['provider_net_amount']?.toString() ??
                '0.0') ??
        (gross - platformCut - stateTax + tipAmount);

    final String nequiAccount =
        booking['numero_cuenta_nequi']?.toString().trim().isNotEmpty == true
            ? booking['numero_cuenta_nequi'].toString()
            : 'No disponible';
    final String wompiRef =
        booking['wompi_reference']?.toString().trim().isNotEmpty == true
            ? booking['wompi_reference'].toString()
            : 'No disponible';
    final String? rawPayoutStatus = booking['payout_status']?.toString();
    final String payoutStatus =
        (rawPayoutStatus == null || rawPayoutStatus.trim().isEmpty)
            ? 'PROCESANDO'
            : rawPayoutStatus.toUpperCase();

    int currentPayoutStep = 2;
    if (payoutStatus == 'PAGADO' || payoutStatus == 'COMPLETADO' || payoutStatus == 'ACREDITADO') {
      currentPayoutStep = 3;
    } else if (payoutStatus == 'PENDIENTE' || payoutStatus == 'ESPERANDO_OTP') {
      currentPayoutStep = 1;
    }

    void copyText(String text, String title) {
      if (text.isEmpty || text == 'No disponible') return;
      Clipboard.setData(ClipboardData(text: text));
      HapticFeedback.lightImpact();
      ScaffoldMessenger.of(context).hideCurrentSnackBar();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Row(
            children: [
              const Icon(Icons.check_circle_outline, color: Color(0xFFC5A052), size: 18),
              const SizedBox(width: 8),
              Text('$title copiado al portapapeles',
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold, color: Color(0xFFFFFDF8))),
            ],
          ),
          backgroundColor: const Color(0xFF1F1A15),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 2),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      );
    }

    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFFFFFDF8),
          insetPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
          contentPadding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(22),
            side: BorderSide(
              color: Color(0xFFD4AF37).withOpacity(0.4),
              width: 1.5,
            ),
          ),
          titlePadding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
          title: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: const Color(0xFFFAF4EB),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: Color(0xFFD4AF37).withOpacity(0.3)),
                ),
                child: Icon(
                  immediate ? Icons.stars_rounded : Icons.receipt_long_outlined,
                  color: const Color(0xFFC5A052),
                  size: 18,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      immediate ? '¡Servicio Completado!' : 'Detalle de Liquidación',
                      style: const TextStyle(
                          fontFamily: 'CormorantGaramond',
                          fontWeight: FontWeight.bold,
                          fontSize: 18,
                          color: Color(0xFF1F1A15)),
                    ),
                    if (wompiRef != 'No disponible')
                      Text(
                        'Ref: ${wompiRef.length > 18 ? '${wompiRef.substring(0, 18)}...' : wompiRef}',
                        style: const TextStyle(fontSize: 10.5, color: Color(0xFF8C7E74), fontStyle: FontStyle.italic),
                      ),
                  ],
                ),
              ),
            ],
          ),
          content: SizedBox(
            width: MediaQuery.of(context).size.width * 0.92,
            child: SingleChildScrollView(
              physics: const BouncingScrollPhysics(),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (immediate) ...[
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF0FDF4),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: const Color(0xFFDCFCE7)),
                      ),
                      child: const Row(
                        children: [
                          Icon(Icons.verified, color: Color(0xFF166534), size: 16),
                          SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'PIN verificado. Los fondos han sido aprobados y la transferencia a tu cuenta está en proceso.',
                              style: TextStyle(fontSize: 11, color: Color(0xFF166534), height: 1.25),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],

                  // ✦ STEPPER VISUAL DE DISPERSIÓN REAL QUIET LUXURY ✦
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFAF6EE),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: Color(0xFFC5A052).withOpacity(0.25), width: 1.2),
                      boxShadow: [
                        BoxShadow(
                          color: Color(0xFFC5A052).withOpacity(0.05),
                          blurRadius: 10,
                          offset: const Offset(0, 3),
                        ),
                      ],
                    ),
                    child: Column(
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            _buildPayoutStepDot('1. PIN', currentPayoutStep >= 0),
                            _buildPayoutStepLine(currentPayoutStep >= 1),
                            _buildPayoutStepDot('2. Wompi', currentPayoutStep >= 1),
                            _buildPayoutStepLine(currentPayoutStep >= 2),
                            _buildPayoutStepDot('3. Proceso', currentPayoutStep >= 2),
                            _buildPayoutStepLine(currentPayoutStep >= 3),
                            _buildPayoutStepDot('4. En Nequi', currentPayoutStep >= 3),
                          ],
                        ),
                        const SizedBox(height: 10),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: const Color(0xFFEFE8DE), width: 0.8),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.bolt_rounded, color: Color(0xFFC5A052), size: 15),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  currentPayoutStep == 3
                                      ? 'Acreditado exitosamente en tu cuenta Nequi.'
                                      : 'Acreditación estimada: En menos de 2 horas vía Wompi/Nequi.',
                                  style: const TextStyle(
                                    fontFamily: 'Inter',
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                    color: Color(0xFF1F1A15),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 12),

                  // 🧾 DESGLOSE FINANCIERO QUIET LUXURY 🧾
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: const Color(0xFFEFE8DE), width: 1.2),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withOpacity(0.03),
                          blurRadius: 12,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Column(
                      children: [
                        _breakdownRow(
                            'Liquidación Bruta', '\$${gross.toStringAsFixed(0)} COP',
                            isBold: true, fontSize: 13.0),
                        if (tipAmount > 0) ...[
                          const SizedBox(height: 4),
                          _breakdownRow('Propina Cliente (100% tuya)', '+\$${tipAmount.toStringAsFixed(0)} COP',
                              color: const Color(0xFF15803D), isBold: true, fontSize: 12.5),
                        ],
                        if (productsAmount > 0) ...[
                          const SizedBox(height: 4),
                          _breakdownRow('Ganancia Venta Productos', '+\$${productsAmount.toStringAsFixed(0)} COP',
                              color: const Color(0xFF15803D), isBold: true, fontSize: 12.5),
                        ],
                        const SizedBox(height: 6),
                        _breakdownRow('Descuento Plataforma (20%)',
                            '-\$${(platformCut + stateTax).toStringAsFixed(0)} COP',
                            color: const Color(0xFFB91C1C), isBold: true, fontSize: 12.5),
                        Padding(
                          padding: const EdgeInsets.only(left: 10.0, top: 4.0),
                          child: Column(
                            children: [
                              _breakdownRow('• Comisión Neta (12%)',
                                  '-\$${platformCut.toStringAsFixed(0)} COP',
                                  color: const Color(0xFF8C7E74), fontSize: 11.0),
                              const SizedBox(height: 2),
                              _breakdownRow('• Impuesto Estatal (8%)',
                                  '-\$${stateTax.toStringAsFixed(0)} COP',
                                  color: const Color(0xFF8C7E74), fontSize: 11.0),
                            ],
                          ),
                        ),
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 10),
                          child: Divider(height: 1, color: Color(0xFFEFE8DE)),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFAF6EE),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: Color(0xFFC5A052).withOpacity(0.3), width: 0.8),
                          ),
                          child: _breakdownRow('Dispersión Nequi (Neto 80%)',
                              '\$${netPayout.toStringAsFixed(0)} COP',
                              color: const Color(0xFFC5A052), isBold: true, fontSize: 14.0),
                        ),
                        const SizedBox(height: 10),
                        // ⚖️ TRANSPARENCIA FISCAL COLOMBIA (CK3) ⚖️
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFAF8F5),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: const Color(0xFFEFE8DE), width: 0.8),
                          ),
                          child: const Row(
                            children: [
                              Icon(Icons.gavel_rounded, size: 12, color: Color(0xFF8C7E74)),
                              SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  'Cumplimiento tributario DIAN Colombia: 12% servicio + 8% retención ReteFuente/ICA.',
                                  style: TextStyle(fontFamily: 'Inter', fontSize: 9.5, color: Color(0xFF8C7E74), height: 1.25),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 12),

                  // 💳 COMPROBANTE DE TRANSACCIÓN & DATOS DE CUENTA QUIET LUXURY 💳
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFAF6EE),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: Color(0xFFC5A052).withOpacity(0.25), width: 1.2),
                      boxShadow: [
                        BoxShadow(
                          color: Color(0xFFC5A052).withOpacity(0.04),
                          blurRadius: 10,
                          offset: const Offset(0, 3),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Row(
                              children: [
                                Icon(Icons.shield_outlined, size: 14, color: Color(0xFFC5A052)),
                                SizedBox(width: 6),
                                Text(
                                  'Estado del Pago:',
                                  style: TextStyle(
                                    fontFamily: 'Inter',
                                    fontSize: 12,
                                    fontWeight: FontWeight.bold,
                                    color: Color(0xFF1F1A15),
                                  ),
                                ),
                              ],
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                              decoration: BoxDecoration(
                                color: currentPayoutStep == 3
                                    ? const Color(0xFFF0FDF4)
                                    : const Color(0xFFFEFCE8),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                  color: currentPayoutStep == 3
                                      ? const Color(0xFFBBF7D0)
                                      : const Color(0xFFFEF08A),
                                  width: 0.8,
                                ),
                              ),
                              child: Text(
                                payoutStatus,
                                style: TextStyle(
                                  fontFamily: 'Inter',
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold,
                                  color: currentPayoutStep == 3
                                      ? const Color(0xFF15803D)
                                      : const Color(0xFFA16207),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Row(
                                children: [
                                  const Icon(Icons.phone_android_rounded, size: 14, color: Color(0xFF8C7E74)),
                                  const SizedBox(width: 6),
                                  Expanded(
                                    child: Text(
                                      'Cuenta Nequi: $nequiAccount',
                                      style: const TextStyle(
                                        fontFamily: 'Inter',
                                        fontSize: 11.5,
                                        fontWeight: FontWeight.w600,
                                        color: Color(0xFF1F1A15),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            if (nequiAccount != 'No disponible')
                              InkWell(
                                onTap: () => copyText(nequiAccount, 'Cuenta Nequi'),
                                borderRadius: BorderRadius.circular(8),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: Colors.white,
                                    borderRadius: BorderRadius.circular(8),
                                    border: Border.all(color: const Color(0xFFEFE8DE)),
                                  ),
                                  child: const Row(
                                    children: [
                                      Icon(Icons.copy_rounded, size: 12, color: Color(0xFFC5A052)),
                                      SizedBox(width: 4),
                                      Text(
                                        'Copiar',
                                        style: TextStyle(fontFamily: 'Inter', fontSize: 10.5, fontWeight: FontWeight.bold, color: Color(0xFFC5A052)),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Row(
                                children: [
                                  const Icon(Icons.receipt_rounded, size: 14, color: Color(0xFF8C7E74)),
                                  const SizedBox(width: 6),
                                  Expanded(
                                    child: Text(
                                      'Ref Wompi: ${wompiRef.length > 18 ? '${wompiRef.substring(0, 18)}...' : wompiRef}',
                                      style: const TextStyle(
                                        fontFamily: 'Inter',
                                        fontSize: 11,
                                        fontStyle: FontStyle.italic,
                                        color: Color(0xFF8C7E74),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            if (wompiRef != 'No disponible')
                              InkWell(
                                onTap: () => copyText(wompiRef, 'Referencia Wompi'),
                                borderRadius: BorderRadius.circular(8),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: Colors.white,
                                    borderRadius: BorderRadius.circular(8),
                                    border: Border.all(color: const Color(0xFFEFE8DE)),
                                  ),
                                  child: const Row(
                                    children: [
                                      Icon(Icons.copy_rounded, size: 12, color: Color(0xFFC5A052)),
                                      SizedBox(width: 4),
                                      Text(
                                        'Copiar',
                                        style: TextStyle(fontFamily: 'Inter', fontSize: 10.5, fontWeight: FontWeight.bold, color: Color(0xFFC5A052)),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          actionsPadding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
          actions: [
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () {
                      final summary = 'Liquidación GlowApp:\nBruta: \$${gross.toStringAsFixed(0)} COP\nNeto Nequi: \$${netPayout.toStringAsFixed(0)} COP\nRef Wompi: $wompiRef';
                      copyText(summary, 'Resumen de Liquidación');
                    },
                    icon: const Icon(Icons.share_outlined, size: 14, color: Color(0xFFC5A052)),
                    label: const Text(
                      'Compartir',
                      style: TextStyle(
                        fontFamily: 'Inter',
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFFC5A052),
                      ),
                    ),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: Color(0xFFC5A052), width: 1),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ElevatedButton(
                    onPressed: () => Navigator.pop(context),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF1F1A15),
                      foregroundColor: const Color(0xFFC5A052),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                        side: const BorderSide(color: Color(0xFFC5A052), width: 1),
                      ),
                      elevation: 0,
                    ),
                    child: const Text(
                      'Entendido',
                      style: TextStyle(
                        fontFamily: 'Inter',
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFFC5A052),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        );
      },
    );
  }

  Widget _buildPayoutStepDot(String label, bool isActive) {
    return Column(
      children: [
        Icon(
          isActive ? Icons.check_circle : Icons.circle_outlined,
          size: 13,
          color: isActive ? const Color(0xFFC5A052) : const Color(0xFFD4CEB8),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: TextStyle(
            fontSize: 9.5,
            fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
            color: isActive ? const Color(0xFF1F1A15) : const Color(0xFF8C7E74),
          ),
        ),
      ],
    );
  }

  Widget _buildPayoutStepLine(bool isActive) {
    return Expanded(
      child: Container(
        height: 2,
        margin: const EdgeInsets.symmetric(horizontal: 2),
        color: isActive ? const Color(0xFFC5A052) : const Color(0xFFEFE8DE),
      ),
    );
  }

  Widget _breakdownRow(String label, String value,
      {Color? color, bool isBold = false, double fontSize = 12}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1.5),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontSize: fontSize,
                fontWeight: isBold ? FontWeight.bold : FontWeight.normal,
                color: const Color(0xFF1F1A15),
              ),
            ),
          ),
          const SizedBox(width: 6),
          Text(
            value,
            style: TextStyle(
              fontSize: fontSize,
              fontWeight: FontWeight.bold,
              color: color ?? const Color(0xFF1F1A15),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCardActionButtons(Map<String, dynamic> b) {
    final status = (b['status'] as String? ?? 'pending').toUpperCase();
    final bookingId = b['id'].toString();

    if (_loadingBookings.contains(bookingId)) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(8.0),
          child: CircularProgressIndicator(
              color: Color(0xFFC5A052), strokeWidth: 2),
        ),
      );
    }

    if (status == 'CONFIRMED' ||
        status == 'CONFIRMADA' ||
        status == 'CHECKIN_REALIZADO') {
      return Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () async {
                final refresh = await Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => ProviderRouteScreen(booking: b),
                  ),
                );
                if (refresh == true) {
                  _fetchBookings();
                  _fetchProfile();
                }
              },
              icon: const Icon(Icons.navigation_outlined, size: 16, color: Color(0xFFC5A052)),
              label:
                  const Text('Iniciar Ruta', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold, color: Color(0xFF1F1A15))),
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFF1F1A15),
                side: const BorderSide(color: Color(0xFFC5A052), width: 1.5),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(30)),
                padding: const EdgeInsets.symmetric(vertical: 10),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: ElevatedButton.icon(
              onPressed: _loadingBookings.contains(bookingId) ? null : () => _handleStartService(bookingId),
              icon: const Icon(Icons.play_arrow_outlined, size: 16, color: Color(0xFFD4AF37)),
              label: const Text('Iniciar Servicio',
                  style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold, color: Color(0xFFFFFDF8))),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF1F1A15),
                foregroundColor: const Color(0xFFFFFDF8),
                elevation: 2,
                shadowColor: Color(0xFFC5A052).withOpacity(0.2),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(30)),
                padding: const EdgeInsets.symmetric(vertical: 10),
              ),
            ),
          ),
        ],
      );
    } else if (status == 'EN_PROGRESO') {
      return Column(
        children: [
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () {
                    final clientId = b['client_id']?.toString();
                    if (clientId == null) return;
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => ChatScreen(
                          partnerId: clientId,
                          partnerName: b['client_name'] ?? 'Cliente',
                          partnerRole: 'client',
                          partnerAvatar: '',
                        ),
                      ),
                    );
                  },
                  icon: const Icon(Icons.chat_bubble_outline_rounded, size: 16, color: Color(0xFFC5A052)),
                  label: const Text('Chat', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold, color: Color(0xFF1F1A15))),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFF1F1A15),
                    side:
                        const BorderSide(color: Color(0xFFC5A052), width: 1.5),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(30)),
                    padding: const EdgeInsets.symmetric(vertical: 10),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () async {
                    final refresh = await Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => ProviderRouteScreen(booking: b),
                      ),
                    );
                    if (refresh == true) {
                      _fetchBookings();
                      _fetchProfile();
                    }
                  },
                  icon: const Icon(Icons.map_outlined, size: 16, color: Color(0xFFC5A052)),
                  label:
                      const Text('Ver Mapa', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold, color: Color(0xFF1F1A15))),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFF1F1A15),
                    side:
                        const BorderSide(color: Color(0xFFC5A052), width: 1.5),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(30)),
                    padding: const EdgeInsets.symmetric(vertical: 10),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _loadingBookings.contains(bookingId)
                  ? null
                  : () => _showCompleteServiceConfirmation(bookingId),
              icon: const Icon(Icons.check_circle_outline_rounded, size: 18, color: Color(0xFFD4AF37)),
              label: const Text(
                'Marcar como completado',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Color(0xFFFFFDF8)),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF1F1A15),
                foregroundColor: const Color(0xFFFFFDF8),
                elevation: 2,
                shadowColor: Color(0xFFC5A052).withOpacity(0.2),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(30)),
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
        ],
      );
    } else if (status == 'ESPERANDO_OTP' || status == 'FINALIZADA_PRESTADOR') {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0xFFECFEFF),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Color(0xFF06B6D4).withOpacity(0.4)),
        ),
        child: Column(
          children: [
            const OtpTimerWidget(),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border:
                    Border.all(color: Color(0xFF06B6D4).withOpacity(0.2)),
              ),
              child: Row(
                children: [
                  const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Color(0xFF06B6D4)),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Esperando confirmación OTP del cliente...',
                      style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.bold,
                          color: Colors.cyan[950]),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 4),
            TextButton(
              onPressed: () => _showSupportEscapeDialog(b),
              child: const Text(
                'El cliente no puede confirmar / Reportar soporte',
                style: TextStyle(
                    fontSize: 11,
                    color: Colors.grey,
                    fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
      );
    } else if (status == 'EN_DISPUTA') {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0xFFFFF7ED),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFFED7AA)),
        ),
        child: const Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.gavel, color: Color(0xFFEA580C), size: 18),
            SizedBox(width: 8),
            Text(
              'Disputa activa — en revisión',
              style: TextStyle(
                  color: Color(0xFF9A3412),
                  fontWeight: FontWeight.w600,
                  fontSize: 13),
            ),
          ],
        ),
      );
    } else if (status == 'COMPLETED' || status == 'COMPLETADA') {
      return Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () => _showPayoutBreakdownDialog(b),
              icon: const Icon(Icons.receipt_long_outlined, size: 16, color: Color(0xFFC5A052)),
              label: const Text('Ver Liquidación',
                  style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold, color: Color(0xFF1F1A15))),
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFF1F1A15),
                side: const BorderSide(color: Color(0xFFC5A052), width: 1.5),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(30)),
                padding: const EdgeInsets.symmetric(vertical: 10),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: ElevatedButton.icon(
              onPressed: () {
                final clientId = b['client_id']?.toString();
                if (clientId == null) return;
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => ChatScreen(
                      partnerId: clientId,
                      partnerName: b['client_name'] ?? 'Cliente',
                      partnerRole: 'client',
                      partnerAvatar: '',
                    ),
                  ),
                );
              },
              icon: const Icon(Icons.chat_bubble_outline_rounded, size: 16, color: Color(0xFFD4AF37)),
              label: const Text('Chatear', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold, color: Color(0xFFFFFDF8))),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF1F1A15),
                foregroundColor: const Color(0xFFFFFDF8),
                elevation: 2,
                shadowColor: Color(0xFFC5A052).withOpacity(0.2),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(30)),
                padding: const EdgeInsets.symmetric(vertical: 10),
              ),
            ),
          ),
        ],
      );
    } else {
      return Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () {
                final clientId = b['client_id']?.toString();
                if (clientId == null) return;
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => ChatScreen(
                      partnerId: clientId,
                      partnerName: b['client_name'] ?? 'Cliente',
                      partnerRole: 'client',
                      partnerAvatar: '',
                    ),
                  ),
                );
              },
              icon: const Icon(Icons.chat_bubble_outline_rounded, size: 16, color: Color(0xFFC5A052)),
              label: const Text('Chat', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold, color: Color(0xFF1F1A15))),
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFF1F1A15),
                side: const BorderSide(color: Color(0xFFC5A052), width: 1.5),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(30)),
                padding: const EdgeInsets.symmetric(vertical: 10),
              ),
            ),
          ),
        ],
      );
    }
  }

  void _showSupportEscapeDialog(Map<String, dynamic> b) {
    final scaffoldMessenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    showDialog(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          backgroundColor: const Color(0xFFFFFDF8),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(24),
            side: BorderSide(
              color: Color(0xFFD4AF37).withOpacity(0.4),
              width: 1.5,
            ),
          ),
          title: const Row(
            children: [
              Icon(Icons.support_agent_outlined, color: Color(0xFFC5A052)),
              SizedBox(width: 8),
              Text('Asistencia / Soporte',
                  style: TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontWeight: FontWeight.bold,
                      fontSize: 20,
                      color: Color(0xFF1F1A15))),
            ],
          ),
          content: const Text(
            'Si el cliente no tiene acceso a internet o no puede ver su código OTP en este momento, puedes solicitar la liberación manual del servicio reportando el caso a soporte o abriendo una disputa temporal.',
            style: TextStyle(fontSize: 13.5, height: 1.4, color: Color(0xFF8C7E74)),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child:
                  const Text('Cancelar', style: TextStyle(color: Color(0xFF8C7E74), fontWeight: FontWeight.bold)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF1F1A15),
                foregroundColor: const Color(0xFFFFFDF8),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20),
                    side: const BorderSide(color: Color(0xFFC5A052), width: 1)),
                elevation: 2,
              ),
              onPressed: () async {
                navigator.pop(); // Cerrar
                setState(() => _loadingBookings.add(b['id'].toString()));
                try {
                  await ApiService.updateBookingStatus(
                      b['id'].toString(), 'EN_DISPUTA');
                  _fetchBookings();
                  if (mounted) {
                    scaffoldMessenger.showSnackBar(
                      const SnackBar(
                        content: Text(
                            '⚠️ Se ha reportado el caso. El servicio se encuentra en revisión de soporte.'),
                        backgroundColor: Color(0xFF1F1A15),
                      ),
                    );
                  }
                } catch (e) {
                  if (mounted) {
                    scaffoldMessenger.showSnackBar(
                      SnackBar(
                          content: Text('Error: $e'),
                          backgroundColor: Colors.redAccent),
                    );
                  }
                } finally {
                  if (mounted) {
                    setState(() => _loadingBookings.remove(b['id'].toString()));
                  }
                }
              },
              child: const Text('Reportar Caso a Soporte',
                  style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFFD4AF37))),
            ),
          ],
        );
      },
    );
  }

  void _showCompleteServiceConfirmation(String bookingId) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFFFFFDF8),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(24),
          side: BorderSide(
            color: Color(0xFFD4AF37).withOpacity(0.4),
            width: 1.5,
          ),
        ),
        title: const Row(
          children: [
            Icon(Icons.check_circle_outline, color: Color(0xFFC5A052)),
            SizedBox(width: 8),
            Text('¿Finalizar Servicio?',
                style: TextStyle(
                    fontFamily: 'CormorantGaramond',
                    fontWeight: FontWeight.bold,
                    fontSize: 20,
                    color: Color(0xFF1F1A15))),
          ],
        ),
        content: const Text(
          '¿Estás seguro de que has terminado el servicio? Al confirmar, el cliente recibirá su código PIN de verificación en su app.',
          style: TextStyle(fontSize: 13.5, height: 1.4, color: Color(0xFF8C7E74)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Volver al servicio',
                style: TextStyle(color: Color(0xFF8C7E74), fontWeight: FontWeight.bold)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF1F1A15),
              foregroundColor: const Color(0xFFFFFDF8),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20),
                  side: const BorderSide(color: Color(0xFFD4AF37), width: 1)),
              elevation: 2,
            ),
            onPressed: () {
              Navigator.pop(context);
              _handleCompleteService(bookingId);
            },
            child: const Text('Sí, Finalizar', style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFFD4AF37))),
          ),
        ],
      ),
    );
  }

  Future<void> _handleCompleteService(String bookingId) async {
    setState(() => _loadingBookings.add(bookingId));
    try {
      await ApiService.post('/api/bookings/$bookingId/complete', {});
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
                '✅ Servicio completado. El cliente recibirá su código de confirmación.'),
            backgroundColor: Color(0xFF16A34A),
            behavior: SnackBarBehavior.floating,
          ),
        );
        _fetchBookings();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content:
                Text('Error: ${e.toString().replaceAll('Exception: ', '')}'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _loadingBookings.remove(bookingId));
      }
    }
  }

  // ─── INNOVATION HELPERS (KAIZEN INNOVATIONS) ───────────────────────

  Map<String, dynamic> _calculateSuggestedDeparture(String scheduledAtIso) {
    try {
      final DateTime serviceTime = DateTime.parse(scheduledAtIso).toLocal();
      final DateTime departureTime =
          serviceTime.subtract(const Duration(minutes: 40));
      final DateTime now = DateTime.now();

      final String hourStr =
          '${departureTime.hour.toString().padLeft(2, '0')}:${departureTime.minute.toString().padLeft(2, '0')}';

      final bool isUrgent =
          now.isAfter(departureTime.subtract(const Duration(minutes: 15))) &&
              now.isBefore(serviceTime);

      return {
        'timeStr': hourStr,
        'isUrgent': isUrgent,
        'text': isUrgent
            ? '🚗 ¡Es momento de salir! (Salida sugerida: $hourStr)'
            : '🚗 Salida sugerida: $hourStr',
      };
    } catch (_) {
      return {'timeStr': '', 'isUrgent': false, 'text': ''};
    }
  }

  Future<void> _showClientNotesDialog(
      String clientId, String clientName) async {
    final prefs = await SharedPreferences.getInstance();
    final String key = 'glowpro_client_notes_$clientId';
    final String existingNote = prefs.getString(key) ?? '';
    final TextEditingController noteController =
        TextEditingController(text: existingNote);

    if (!mounted) return;

    showDialog(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          backgroundColor: const Color(0xFFFFFDF8),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(24),
            side: BorderSide(
              color: Color(0xFFD4AF37).withOpacity(0.4),
              width: 1.5,
            ),
          ),
          title: Row(
            children: [
              const Icon(Icons.note_alt_outlined, color: Color(0xFFC5A052)),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Notas Privadas — $clientName',
                  style: const TextStyle(
                    fontFamily: 'CormorantGaramond',
                    fontWeight: FontWeight.bold,
                    fontSize: 18,
                    color: Color(0xFF1F1A15),
                  ),
                ),
              ),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Escribe notas confidenciales sobre este cliente (alergias, tono preferido, indicaciones del apto). Solo tú podrás verlas en futuras citas.',
                style: TextStyle(
                    fontSize: 12.5, color: Color(0xFF8C7E74), height: 1.4),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: noteController,
                maxLines: 4,
                style: const TextStyle(fontSize: 13, color: Color(0xFF1F1A15)),
                decoration: InputDecoration(
                  hintText:
                      'Ej. Prefiere tono mate, piel sensible a cera caliente, timbre no funciona...',
                  hintStyle: const TextStyle(
                      color: Color(0xFFB0A89F), fontSize: 12.5),
                  filled: true,
                  fillColor: const Color(0xFFFAF6EE),
                  contentPadding: const EdgeInsets.all(12),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(16),
                    borderSide: const BorderSide(color: Color(0xFFEFE8DE)),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(16),
                    borderSide: const BorderSide(
                        color: Color(0xFFD4AF37), width: 1.5),
                  ),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancelar',
                  style: TextStyle(
                      color: Color(0xFF8C7E74), fontWeight: FontWeight.bold)),
            ),
            ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF1F1A15),
                foregroundColor: const Color(0xFFFFFDF8),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20),
                  side: const BorderSide(color: Color(0xFFD4AF37), width: 1),
                ),
                elevation: 2,
              ),
              onPressed: () async {
                await prefs.setString(key, noteController.text.trim());
                if (dialogContext.mounted) {
                  Navigator.pop(dialogContext);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('🔒 Nota guardada de forma segura.'),
                      backgroundColor: Color(0xFF1F1A15),
                      behavior: SnackBarBehavior.floating,
                    ),
                  );
                }
              },
              icon: const Icon(Icons.save_outlined,
                  size: 16, color: Color(0xFFD4AF37)),
              label: const Text('Guardar Nota',
                  style: TextStyle(
                      fontWeight: FontWeight.bold, color: Color(0xFFD4AF37))),
            ),
          ],
        );
      },
    );
  }

  void _showAddToCalendarDialog(Map<String, dynamic> b) {
    final String serviceName = b['service_name'] ?? 'Servicio GlowPro';
    final String clientName = b['client_name'] ?? 'Cliente';
    final String address = b['service_address'] ?? 'Dirección por confirmar';
    final DateTime date = DateTime.parse(b['scheduled_at']).toLocal();
    final DateTime endDate = date.add(const Duration(hours: 1));

    final String dayStr =
        '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')} a las ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';

    String formatIso(DateTime dt) =>
        '${dt.year}${dt.month.toString().padLeft(2, '0')}${dt.day.toString().padLeft(2, '0')}T${dt.hour.toString().padLeft(2, '0')}${dt.minute.toString().padLeft(2, '0')}00';

    final String gCalUrl =
        'https://calendar.google.com/calendar/render?action=TEMPLATE&text=${Uri.encodeComponent('GlowPro: $serviceName — $clientName')}&dates=${formatIso(date)}/${formatIso(endDate)}&details=${Uri.encodeComponent('Cita agendada vía GlowApp con $clientName.')}&location=${Uri.encodeComponent(address)}';

    final String summaryText =
        '📅 CITA GLOWPRO\n• Cliente: $clientName\n• Servicio: $serviceName\n• Fecha: $dayStr\n• Dirección: $address';

    showDialog(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          backgroundColor: const Color(0xFFFFFDF8),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(24),
            side: BorderSide(
              color: Color(0xFFD4AF37).withOpacity(0.4),
              width: 1.5,
            ),
          ),
          title: const Row(
            children: [
              Icon(Icons.calendar_month_outlined, color: Color(0xFFC5A052)),
              SizedBox(width: 8),
              Text(
                'Sincronizar Calendario',
                style: TextStyle(
                  fontFamily: 'CormorantGaramond',
                  fontWeight: FontWeight.bold,
                  fontSize: 18,
                  color: Color(0xFF1F1A15),
                ),
              ),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Sincroniza esta cita con tu calendario personal para recibir recordatorios y no cruzar horarios.',
                style: TextStyle(
                    fontSize: 13, color: Color(0xFF8C7E74), height: 1.4),
              ),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFAF4EB),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFFEFE8DE)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '• Servicio: $serviceName',
                      style: const TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF1F1A15)),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '• Cliente: $clientName',
                      style: const TextStyle(
                          fontSize: 12, color: Color(0xFF4A4036)),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '• Fecha: $dayStr',
                      style: const TextStyle(
                          fontSize: 12, color: Color(0xFF4A4036)),
                    ),
                  ],
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () {
                Clipboard.setData(ClipboardData(text: summaryText));
                Navigator.pop(dialogContext);
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content:
                        Text('📋 Resumen de cita copiado al portapapeles.'),
                    backgroundColor: Color(0xFF1F1A15),
                    behavior: SnackBarBehavior.floating,
                  ),
                );
              },
              child: const Text('Copiar Resumen',
                  style: TextStyle(
                      color: Color(0xFF8C7E74), fontWeight: FontWeight.bold)),
            ),
            ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF1F1A15),
                foregroundColor: const Color(0xFFFFFDF8),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20),
                  side: const BorderSide(color: Color(0xFFD4AF37), width: 1),
                ),
                elevation: 2,
              ),
              onPressed: () {
                Navigator.pop(dialogContext);
                Clipboard.setData(ClipboardData(text: gCalUrl));
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text(
                        '🔗 Enlace de Google Calendar copiado al portapapeles.'),
                    backgroundColor: Color(0xFF1F1A15),
                    behavior: SnackBarBehavior.floating,
                  ),
                );
              },
              icon: const Icon(Icons.open_in_new_rounded,
                  size: 16, color: Color(0xFFD4AF37)),
              label: const Text('Google Calendar',
                  style: TextStyle(
                      fontWeight: FontWeight.bold, color: Color(0xFFD4AF37))),
            ),
          ],
        );
      },
    );
  }

  Future<void> _toggleStatus(bool value) async {
    setState(() {
      _isTogglingStatus = true;
      _isActive = value;
    });
    try {
      double? lat;
      double? lon;
      if (value) {
        try {
          final pos = await getWebGeolocation();
          lat = pos['lat'];
          lon = pos['lon'];
        } catch (e) {
          debugPrint('Error getting geolocation: $e');
        }
      }
      await ApiService.updateProviderStatus(value,
          latitude: lat, longitude: lon);
      HapticFeedback.lightImpact();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(value
                ? '🟢 Ahora estás En Línea'
                : '⚫ Ahora estás Fuera de Línea'),
            backgroundColor: AppTheme.primary,
            behavior: SnackBarBehavior.floating,
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          ),
        );
      }
    } catch (e) {
      setState(() => _isActive = !value);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('❌ Error al cambiar estado: $e'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isTogglingStatus = false);
      }
    }
  }

  int get _todayBookingsCount {
    final now = DateTime.now();
    return _bookings.where((b) {
      try {
        final date = DateTime.parse(b['scheduled_at']);
        return date.year == now.year &&
            date.month == now.month &&
            date.day == now.day;
      } catch (_) {
        return false;
      }
    }).length;
  }

  double get _weeklyNetEarnings {
    final now = DateTime.now();
    final monday = now.subtract(Duration(days: now.weekday - 1));
    final startOfWeek = DateTime(monday.year, monday.month, monday.day);
    final endOfWeek = startOfWeek.add(const Duration(days: 7));

    return _bookings.where((b) {
      final st = (b['status'] as String? ?? '').toUpperCase();
      final isStatusOk = st == 'CONFIRMADA' ||
          st == 'COMPLETADA' ||
          st == 'CONFIRMED' ||
          st == 'COMPLETED' ||
          st == 'EN_PROGRESO';
      if (!isStatusOk) return false;
      try {
        final date = DateTime.parse(b['scheduled_at']);
        return date.isAfter(startOfWeek.subtract(const Duration(seconds: 1))) &&
            date.isBefore(endOfWeek);
      } catch (_) {
        return false;
      }
    }).fold(0.0, (sum, b) {
      final amountStr = b['pago_neto_prestador']?.toString() ??
          b['provider_net_amount']?.toString() ??
          '';
      return sum + (double.tryParse(amountStr) ?? 0.0);
    });
  }

  double get _lastWeeklyNetEarnings {
    final now = DateTime.now();
    final monday = now.subtract(Duration(days: now.weekday - 1));
    final startOfThisWeek = DateTime(monday.year, monday.month, monday.day);
    final startOfLastWeek = startOfThisWeek.subtract(const Duration(days: 7));
    final endOfLastWeek = startOfThisWeek;

    return _bookings.where((b) {
      final st = (b['status'] as String? ?? '').toUpperCase();
      final isStatusOk = st == 'CONFIRMADA' ||
          st == 'COMPLETADA' ||
          st == 'CONFIRMED' ||
          st == 'COMPLETED' ||
          st == 'EN_PROGRESO';
      if (!isStatusOk) return false;
      try {
        final date = DateTime.parse(b['scheduled_at']);
        return date.isAfter(
                startOfLastWeek.subtract(const Duration(microseconds: 1))) &&
            date.isBefore(endOfLastWeek);
      } catch (_) {
        return false;
      }
    }).fold(0.0, (sum, b) {
      final amountStr = b['pago_neto_prestador']?.toString() ??
          b['provider_net_amount']?.toString() ??
          '';
      return sum + (double.tryParse(amountStr) ?? 0.0);
    });
  }

  String get _weeklyNetEarningsWoWText {
    final current = _weeklyNetEarnings;
    final last = _lastWeeklyNetEarnings;
    if (last == 0) {
      return current > 0 ? '+100% vs sem. ant.' : 'Estable vs sem. ant.';
    }
    final diff = ((current - last) / last) * 100;
    final sign = diff >= 0 ? '+' : '';
    return '$sign${diff.toStringAsFixed(0)}% vs sem. ant.';
  }

  // Highlight next appointment finder
  Map<String, dynamic>? get _nextBooking {
    final upcoming = _bookings.where((b) {
      final st = (b['status'] as String? ?? '').toUpperCase();
      return st != 'COMPLETED' &&
          st != 'COMPLETADA' &&
          st != 'CANCELLED' &&
          st != 'CANCELADA' &&
          st != 'PENDIENTE_PAGO';
    }).toList();
    if (upcoming.isEmpty) return null;
    upcoming.sort((a, b) {
      try {
        return DateTime.parse(a['scheduled_at'])
            .compareTo(DateTime.parse(b['scheduled_at']));
      } catch (_) {
        return 0;
      }
    });
    return upcoming.first;
  }

  void _showSOSConfirmationDialog() {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFFFFFDF8),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(28),
            side: BorderSide(
              color: Color(0xFFD4AF37).withOpacity(0.5),
              width: 1.5,
            ),
          ),
          title: const Row(
            children: [
              Icon(Icons.warning_amber_rounded,
                  color: Color(0xFF800A0A), size: 28),
              SizedBox(width: 8),
              Text(
                '🚨 ALERTA SOS',
                style: TextStyle(
                    fontFamily: 'CormorantGaramond',
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF800A0A),
                    fontSize: 22),
              ),
            ],
          ),
          content: const Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '¿Estás en peligro o necesitas asistencia inmediata?',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 15,
                    color: Color(0xFF1F1A15)),
              ),
              SizedBox(height: 12),
              Text(
                'Al confirmar, se enviará una alerta silenciosa con tu ubicación actual a la central de seguridad de la plataforma y te daremos la opción de llamar directamente al número de emergencias (123).',
                style: TextStyle(
                    fontSize: 13.5, height: 1.4, color: Color(0xFF8C7E74)),
              ),
            ],
          ),
          actionsAlignment: MainAxisAlignment.spaceBetween,
          actionsPadding:
              const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text(
                'Cancelar',
                style:
                    TextStyle(color: Color(0xFF8C7E74), fontWeight: FontWeight.bold),
              ),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF800A0A),
                foregroundColor: const Color(0xFFFAF4EB),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20),
                    side: const BorderSide(color: Color(0xFFD4AF37), width: 1)),
                elevation: 3,
                padding:
                    const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              ),
              onPressed: () async {
                Navigator.pop(context);
                await _triggerSOSAlert();
              },
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.security, size: 18, color: Color(0xFFD4AF37)),
                  SizedBox(width: 6),
                  Text('SÍ, ENVIAR SOS',
                      style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFFFAF4EB))),
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
      _loadingSOS = true;
    });

    try {
      String? activeBookingId;
      try {
        final inProgressBooking = _bookings.firstWhere(
          (b) => (b['status'] as String? ?? '').toUpperCase() == 'EN_PROGRESO',
        );
        activeBookingId = inProgressBooking['id']?.toString();
      } catch (_) {
        // Ignorar si no hay citas en progreso
      }

      double lat = 4.6735;
      double lon = -74.1422;
      try {
        final pos = await getWebGeolocation();
        lat = pos['lat'] ?? 4.6735;
        lon = pos['lon'] ?? -74.1422;
      } catch (e) {
        debugPrint('Error getting real geolocation for SOS: $e');
      }

      // Registrar evento de telemetría de botón SOS presionado por prestador
      AnalyticsService().logEvent(
        eventType: 'SOS_TRIGGERED',
        screenName: '/provider',
        elementId: 'sos_provider_fab',
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
      _showSOSTriggeredSheet(res['message'] ?? 'Alerta enviada correctamente.');
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('❌ Error al enviar alerta SOS: $e'),
          backgroundColor: Colors.redAccent,
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _loadingSOS = false;
        });
      }
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
            color: const Color(0xFFFFFDF8),
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(28),
              topRight: Radius.circular(28),
            ),
            border: Border.all(color: Color(0xFFD4AF37).withOpacity(0.5), width: 1.5),
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
                const Icon(Icons.check_circle_outline,
                    color: Color(0xFFC5A052), size: 52),
                const SizedBox(height: 12),
                const Text(
                  'Alerta SOS Registrada',
                  style: TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontWeight: FontWeight.bold,
                      fontSize: 22,
                      color: Color(0xFF1F1A15)),
                ),
                const SizedBox(height: 8),
                Text(
                  message,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                      color: Color(0xFF8C7E74), fontSize: 14, height: 1.4),
                ),
                const SizedBox(height: 16),
                ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF800A0A),
                    foregroundColor: const Color(0xFFFAF4EB),
                    minimumSize: const Size(double.infinity, 48),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(24),
                        side: const BorderSide(color: Color(0xFFD4AF37), width: 1)),
                    elevation: 2,
                  ),
                  onPressed: () {
                    Navigator.pop(context);
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('📞 Marcando al 123 (Emergencias)...'),
                        backgroundColor: Color(0xFF800A0A),
                      ),
                    );
                  },
                  icon: const Icon(Icons.phone_in_talk_rounded, color: Color(0xFFD4AF37)),
                  label: const Text(
                    'LLAMAR A EMERGENCIAS (123)',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: Color(0xFFFAF4EB)),
                  ),
                ),
                const SizedBox(height: 8),
                OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(double.infinity, 44),
                    side: const BorderSide(color: Color(0xFFC5A052), width: 1.5),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(22)),
                  ),
                  onPressed: () => Navigator.pop(context),
                  child: const Text(
                    'Entendido / Cerrar',
                    style: TextStyle(
                        color: Color(0xFF1F1A15), fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  // Next booking card step visual helpers
  Widget _buildStepIndicator(int step, String label, bool isActive) {
    final color = isActive ? const Color(0xFFC5A052) : const Color(0xFFD1C7BD);
    final textColor = isActive ? const Color(0xFF1F1A15) : const Color(0xFF9E948A);
    return Column(
      children: [
        Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: isActive ? const Color(0xFFFAF4EB) : Colors.transparent,
            border: Border.all(color: color, width: isActive ? 2 : 1.5),
          ),
          child: Center(
            child: Text(
              step.toString(),
              style: TextStyle(
                  color: isActive ? const Color(0xFFC5A052) : const Color(0xFF9E948A),
                  fontWeight: FontWeight.bold,
                  fontSize: 12),
            ),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: TextStyle(
              color: textColor, fontSize: 10, fontWeight: isActive ? FontWeight.bold : FontWeight.w500),
        ),
      ],
    );
  }

  Widget _buildStepLine(bool isActive) {
    return Expanded(
      child: Container(
        height: 2,
        color: isActive ? const Color(0xFFC5A052) : const Color(0xFFEFE8DE),
      ),
    );
  }

  String _getStepDescription(int step) {
    switch (step) {
      case 1:
      case 2:
        return '👉 Paso 1 y 2: Dirígete a la ubicación del cliente e inicia el servicio cuando estés listo para comenzar.';
      case 3:
        return '👉 Paso 3: Estás realizando el servicio. Al finalizar, márcalo como completado.';
      case 4:
        return '👉 Paso 4: Pídele al cliente el código PIN de 4 dígitos generado en su pantalla para liberar los fondos.';
      default:
        return '';
    }
  }

  Widget _buildNextBookingActions(Map<String, dynamic> b, int currentStep) {
    if (currentStep == 1 || currentStep == 2) {
      return Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () async {
                final refresh = await Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => ProviderRouteScreen(booking: b),
                  ),
                );
                if (refresh == true) {
                  _fetchBookings();
                  _fetchProfile();
                }
              },
              icon: const Icon(Icons.navigation_outlined, size: 16, color: Color(0xFFC5A052)),
              label: const Text('Salir hacia allá',
                  style:
                      TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold, color: Color(0xFF1F1A15))),
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFF1F1A15),
                side: const BorderSide(color: Color(0xFFC5A052), width: 1.5),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(30)),
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: ElevatedButton.icon(
              onPressed: () => _handleStartService(b['id'].toString()),
              icon: const Icon(Icons.play_arrow_outlined, size: 16, color: Color(0xFFD4AF37)),
              label: const Text('Empezar servicio',
                  style:
                      TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold, color: Color(0xFFFFFDF8))),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF1F1A15),
                foregroundColor: const Color(0xFFFFFDF8),
                elevation: 2,
                shadowColor: Color(0xFFC5A052).withOpacity(0.3),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(30)),
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
        ],
      );
    } else if (currentStep == 3) {
      return SizedBox(
        width: double.infinity,
        child: ElevatedButton.icon(
          onPressed: () => _showCompleteServiceConfirmation(b['id'].toString()),
          icon: const Icon(Icons.check_circle_outline_rounded, size: 18, color: Color(0xFFD4AF37)),
          label: const Text(
            'Terminé el servicio',
            style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.bold, color: Color(0xFFFFFDF8)),
          ),
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF1F1A15),
            foregroundColor: const Color(0xFFFFFDF8),
            elevation: 2,
            shadowColor: Color(0xFFC5A052).withOpacity(0.3),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
            padding: const EdgeInsets.symmetric(vertical: 14),
          ),
        ),
      );
    } else {
      // Step 4: OTP
      return Column(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 14),
            decoration: BoxDecoration(
              color: const Color(0xFFFAF4EB),
              borderRadius: BorderRadius.circular(20),
              border:
                  Border.all(color: Color(0xFFC5A052).withOpacity(0.4)),
            ),
            child: const Row(
              children: [
                SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Color(0xFFC5A052)),
                ),
                SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Esperando que el cliente ingrese el código OTP...',
                    style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF1F1A15)),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _showSegmentedPinDialog(b),
                  icon: const Icon(Icons.pin_outlined,
                      size: 16, color: Color(0xFFC5A052)),
                  label: const Text(
                    'Ingresar PIN del cliente',
                    style: TextStyle(
                        fontSize: 12,
                        color: Color(0xFF1F1A15),
                        fontWeight: FontWeight.bold),
                  ),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: Color(0xFFC5A052)),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(30)),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(
                child: TextButton.icon(
                  onPressed: () => _showSupportEscapeDialog(b),
                  icon: const Icon(Icons.support_agent_outlined,
                      size: 16, color: Color(0xFF9E948A)),
                  label: const Text(
                    'El cliente no puede confirmar / Reportar soporte',
                    style: TextStyle(
                        fontSize: 11,
                        color: Color(0xFF9E948A),
                        fontWeight: FontWeight.bold),
                  ),
                ),
              ),
            ],
          ),
        ],
      );
    }
  }

  Widget _buildNextBookingCard(Map<String, dynamic> b) {
    final date = DateTime.parse(b['scheduled_at']).toLocal();
    final dayStr =
        '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}';
    final hourStr =
        '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
    final clientInitial = (b['client_name'] ?? '?')[0].toUpperCase();
    final status = (b['status'] as String? ?? 'pending').toUpperCase();

    int currentStep = 1;
    if (status == 'EN_PROGRESO') {
      currentStep = 3;
    } else if (status == 'ESPERANDO_OTP' || status == 'FINALIZADA_PRESTADOR') {
      currentStep = 4;
    }

    final bool isLoading = _loadingBookings.contains(b['id'].toString());

    return Container(
      margin: const EdgeInsets.only(bottom: 24),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFDF8),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: const Color(0xFFEFE8DE), width: 1.5),
        boxShadow: [
          BoxShadow(
            color: Color(0xFFC5A052).withOpacity(0.08),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: const BoxDecoration(
              color: Color(0xFF1F1A15),
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(26),
                topRight: Radius.circular(26),
              ),
            ),
            child: Row(
              children: [
                const Icon(Icons.star_rounded, color: Color(0xFFD4AF37), size: 18),
                const SizedBox(width: 6),
                const Text(
                  'PRÓXIMA CITA',
                  style: TextStyle(
                      color: Color(0xFFFAF4EB),
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                      letterSpacing: 1),
                ),
                const Spacer(),
                Text(
                  '$dayStr - $hourStr',
                  style: const TextStyle(
                      color: Color(0xFFD4AF37),
                      fontWeight: FontWeight.bold,
                      fontSize: 12),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Semantics(
                      label: 'Avatar de la cliente: ${b['client_name'] ?? 'Cliente'}',
                      child: CircleAvatar(
                        radius: 22,
                        backgroundColor: const Color(0xFFFAF4EB),
                        child: Text(
                          clientInitial,
                          style: const TextStyle(
                              color: Color(0xFFC5A052),
                              fontWeight: FontWeight.bold,
                              fontSize: 16),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            b['client_name'] ?? 'Cliente',
                            style: const TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.bold,
                                color: Color(0xFF1F1A15)),
                          ),
                          Text(
                            'Servicio: ${b['service_name']}',
                            style: const TextStyle(
                                fontSize: 13,
                                color: Color(0xFF786C60),
                                fontWeight: FontWeight.w500),
                          ),
                        ],
                      ),
                    ),
                    Text(
                      '\$${(double.tryParse(b['total_amount']?.toString() ?? '') ?? 0.0).toStringAsFixed(0)}',
                      style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF1F1A15)),
                    ),
                  ],
                ),
                const SizedBox(height: 12),

                // ─── Innovation 2: Travel & Traffic Assistant ───────────
                () {
                  final departure = _calculateSuggestedDeparture(b['scheduled_at'] ?? '');
                  if (departure['text'].isEmpty) return const SizedBox.shrink();
                  final bool isUrgent = departure['isUrgent'] ?? false;
                  return Container(
                    margin: const EdgeInsets.only(bottom: 12),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: isUrgent ? const Color(0xFFFFF7ED) : const Color(0xFFFAF6EE),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: isUrgent ? const Color(0xFFFED7AA) : const Color(0xFFEFE8DE),
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          isUrgent ? Icons.directions_car_filled_rounded : Icons.access_time_rounded,
                          size: 16,
                          color: isUrgent ? const Color(0xFFEA580C) : const Color(0xFFC5A052),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            departure['text'],
                            style: TextStyle(
                              fontSize: 11.5,
                              fontWeight: FontWeight.bold,
                              color: isUrgent ? const Color(0xFF9A3412) : const Color(0xFF4A4036),
                            ),
                          ),
                        ),
                      ],
                    ),
                  );
                }(),

                // ─── Innovations 1 & 3: Notes & Calendar Quick Actions ─────
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    InkWell(
                      onTap: () {
                        HapticFeedback.lightImpact();
                        _showClientNotesDialog(
                          b['client_id']?.toString() ?? '',
                          b['client_name'] ?? 'Cliente',
                        );
                      },
                      borderRadius: BorderRadius.circular(20),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFAF4EB),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: Color(0xFFD4AF37).withOpacity(0.3)),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.note_alt_outlined, size: 14, color: Color(0xFFC5A052)),
                            SizedBox(width: 4),
                            Text('Notas VIP',
                                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF1F1A15))),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    InkWell(
                      onTap: () {
                        HapticFeedback.lightImpact();
                        _showAddToCalendarDialog(b);
                      },
                      borderRadius: BorderRadius.circular(20),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFAF4EB),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: Color(0xFFD4AF37).withOpacity(0.3)),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.calendar_month_outlined, size: 14, color: Color(0xFFC5A052)),
                            SizedBox(width: 4),
                            Text('Calendario',
                                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF1F1A15))),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 12),
                const Divider(color: Color(0xFFEFE8DE), height: 1),
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFAF6EE),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(
                      color: Color(0xFFD4AF37).withOpacity(0.3),
                      width: 1,
                    ),
                  ),
                  child: Column(
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          _buildStepIndicator(1, "Ruta", currentStep >= 1),
                          _buildStepLine(currentStep >= 2),
                          _buildStepIndicator(2, "Iniciar", currentStep >= 2),
                          _buildStepLine(currentStep >= 3),
                          _buildStepIndicator(3, "Terminar", currentStep >= 3),
                          _buildStepLine(currentStep >= 4),
                          _buildStepIndicator(4, "OTP", currentStep >= 4),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          const Icon(Icons.shield_outlined, size: 14, color: Color(0xFFC5A052)),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              _getStepDescription(currentStep),
                              style: const TextStyle(
                                  fontSize: 12,
                                  fontStyle: FontStyle.italic,
                                  color: Color(0xFF4A4036),
                                  fontWeight: FontWeight.w500),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                if (isLoading)
                  const Center(
                    child: Padding(
                      padding: EdgeInsets.all(8.0),
                      child:
                          CircularProgressIndicator(color: Color(0xFFC5A052)),
                    ),
                  )
                else
                  _buildNextBookingActions(b, currentStep),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildOfflineBanner() {
    if (_isActive) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFFAF4EB),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFEFE8DE)),
      ),
      child: Row(
        children: [
          const Icon(Icons.offline_bolt_rounded, color: Color(0xFFC5A052)),
          const SizedBox(width: 12),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Estás Fuera de Línea',
                  style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF1F1A15),
                      fontSize: 13),
                ),
                Text(
                  'No aparecerás en el mapa de clientes ni recibirás nuevas citas.',
                  style: TextStyle(color: Color(0xFF786C60), fontSize: 11),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: () => _toggleStatus(true),
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text(
              'CONECTAR',
              style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: Color(0xFFC5A052),
                  fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDashboardHome() {
    final next = _nextBooking;

    return RefreshIndicator(
      onRefresh: () async {
        await _fetchBookings();
        await _fetchProfile();
      },
      color: AppTheme.primary,
      child: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
        children: [
          _buildOfflineBanner(),
          // Hero section with luxury gradient
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFFFFFDF8), Color(0xFFFAF2E6)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(24),
              border: Border.all(
                color: const Color(0xFFEFE8DE),
                width: 1.2,
              ),
              boxShadow: [
                BoxShadow(
                  color: Color(0xFFC5A052).withOpacity(0.06),
                  blurRadius: 18,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.stars_rounded,
                        size: 20, color: Color(0xFFC5A052)),
                    SizedBox(width: 8),
                    Text(
                      'Tu Resumen GlowPro',
                      style: TextStyle(
                        fontFamily: 'CormorantGaramond',
                        fontSize: 24,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF1F1A15),
                        letterSpacing: 0.3,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                const Text(
                  'Gestiona tus citas y servicios concierge en tiempo real.',
                  style: TextStyle(
                    fontFamily: 'Inter',
                    fontSize: 13,
                    color: Color(0xFF8C7E74),
                  ),
                ),
                const SizedBox(height: 20),
                Row(
                  children: [
                    Expanded(
                      child: _analyticsCard(
                        'Citas Hoy',
                        _todayBookingsCount.toString(),
                        Icons.today_rounded,
                        AppTheme.primary,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _analyticsCardWithTween(
                        'Ganancia Net',
                        _weeklyNetEarnings,
                        Icons.account_balance_wallet_outlined,
                        const Color(0xFF16A34A),
                        subtitle: _weeklyNetEarningsWoWText,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _analyticsCard(
                        'Valoración',
                        _ratingAvg != null
                            ? _ratingAvg!.toStringAsFixed(1)
                            : "--",
                        Icons.star_rounded,
                        const Color(0xFFD97706),
                        subtitle: '$_ratingCount reseñas',
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // ─── GlowPro Co-Pilot IA Card ──────────────────────────
          GestureDetector(
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => const ProviderAiCopilotScreen(),
                ),
              );
            },
            child: Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(24),
                gradient: const LinearGradient(
                  colors: [Color(0xFF1F1A15), Color(0xFF2D241C)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x1A000000),
                    blurRadius: 12,
                    offset: Offset(0, 4),
                  )
                ],
              ),
              child: Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: const Color(0xFFC5A052), width: 1.5),
                      image: const DecorationImage(
                        image: AssetImage('images/avatar_aura.webp'),
                        fit: BoxFit.cover,
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'GlowPro Co-Pilot IA',
                          style: TextStyle(
                            fontFamily: 'CormorantGaramond',
                            fontWeight: FontWeight.bold,
                            fontSize: 18,
                            color: Color(0xFFF7F3ED),
                          ),
                        ),
                        SizedBox(height: 2),
                        Text(
                          'Asistente de inteligencia para ingresos, agenda y promociones.',
                          style: TextStyle(
                            fontFamily: 'Inter',
                            fontSize: 12,
                            color: Color(0xFFB8AAA0),
                            height: 1.3,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: const Color(0xFFC5A052),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.auto_awesome_rounded, size: 14, color: Color(0xFF1F1A15)),
                        SizedBox(width: 4),
                        Text(
                          'Consultar',
                          style: TextStyle(
                            fontFamily: 'Inter',
                            fontWeight: FontWeight.bold,
                            fontSize: 12,
                            color: Color(0xFF1F1A15),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),

          // ─── Prominent Next Booking Card ────────────────────────
          if (next != null) ...[
            _buildNextBookingCard(next),
          ],

          // ─── Banner acceso rápido al Wallet ────────────────────────
          GestureDetector(
            onTap: () {
              setState(() {
                _currentIndex = 2; // Switch to Wallet Tab
              });
            },
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF2A241E), Color(0xFF1F1A15)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: Color(0xFFD4AF37).withOpacity(0.4),
                  width: 1.2,
                ),
                boxShadow: [
                  BoxShadow(
                    color: Color(0xFFC5A052).withOpacity(0.15),
                    blurRadius: 16,
                    offset: const Offset(0, 6),
                  ),
                ],
              ),
              child: Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: Color(0xFFC5A052).withOpacity(0.15),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: Color(0xFFD4AF37).withOpacity(0.3),
                        width: 1,
                      ),
                    ),
                    child: const Icon(Icons.account_balance_wallet_rounded,
                        color: Color(0xFFC5A052), size: 26),
                  ),
                  const SizedBox(width: 14),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Mi Billetera Pro',
                            style: TextStyle(
                                color: Color(0xFFF4EFEA),
                                fontWeight: FontWeight.bold,
                                fontSize: 16)),
                        Text('Ver saldo, solicitar retiros e historial',
                            style:
                                TextStyle(color: Color(0xFFB0A89F), fontSize: 12)),
                      ],
                    ),
                  ),
                  const Icon(Icons.arrow_forward_ios_rounded,
                      color: Color(0xFFC5A052), size: 16),
                ],
              ),
            ),
          ),
          const SizedBox(height: 28),

          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Servicios Activos Recientes',
                style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    letterSpacing: -0.5),
              ),
              Text(
                '${_bookings.length} en total',
                style: const TextStyle(
                    fontSize: 13,
                    color: Colors.grey,
                    fontWeight: FontWeight.bold),
              ),
            ],
          ),
          const SizedBox(height: 12),

          _buildAgendaList(
              limitToRecent: true, excludeBookingId: next?['id']?.toString()),
        ],
      ),
    );
  }

  Widget _buildAgendaHeroBanner() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFFFFDF8), Color(0xFFFAF4EB)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFEFE8DE), width: 1.2),
        boxShadow: [
          BoxShadow(
            color: Color(0xFFC5A052).withOpacity(0.06),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: const Color(0xFFFAF6EE),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Color(0xFFD4AF37).withOpacity(0.3)),
            ),
            child: const Icon(Icons.calendar_month_rounded, color: Color(0xFFC5A052), size: 22),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Control de Agenda Pro',
                  style: TextStyle(
                    fontFamily: 'CormorantGaramond',
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF1F1A15),
                    letterSpacing: 0.3,
                  ),
                ),
                Text(
                  '${_bookings.length} servicios registrados en total',
                  style: const TextStyle(
                    fontSize: 12,
                    color: Color(0xFF8C7E74),
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAgendaSearchBar() {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFFFFDF8),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFEFE8DE), width: 1.2),
        boxShadow: [
          BoxShadow(
            color: Color(0xFFC5A052).withOpacity(0.05),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: TextField(
        controller: _agendaSearchController,
        onChanged: (val) {
          setState(() {
            _agendaSearchQuery = val.trim().toLowerCase();
          });
        },
        style: const TextStyle(fontSize: 13, color: Color(0xFF1F1A15)),
        decoration: InputDecoration(
          hintText: 'Buscar por cliente, servicio o dirección...',
          hintStyle: const TextStyle(color: Color(0xFF9E948A), fontSize: 12.5),
          prefixIcon:
              const Icon(Icons.search_rounded, color: Color(0xFFC5A052), size: 20),
          suffixIcon: _agendaSearchQuery.isNotEmpty
              ? IconButton(
                  icon: const Icon(Icons.clear_rounded,
                      size: 18, color: Color(0xFF8C7E74)),
                  onPressed: () {
                    _agendaSearchController.clear();
                    setState(() {
                      _agendaSearchQuery = '';
                    });
                  },
                )
              : null,
          border: InputBorder.none,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        ),
      ),
    );
  }

  Widget _buildAgendaFilterChips() {
    final filters = [
      {'id': 'TODAS', 'label': 'Todas'},
      {'id': 'PROXIMAS', 'label': 'Próximas'},
      {'id': 'COMPLETADAS', 'label': 'Completadas'},
      {'id': 'CANCELADAS', 'label': 'Canceladas'},
    ];

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      physics: const BouncingScrollPhysics(),
      child: Row(
        children: filters.map((f) {
          final isSelected = _selectedAgendaFilter == f['id'];
          return Padding(
            padding: const EdgeInsets.only(right: 8.0),
            child: InkWell(
              onTap: () {
                HapticFeedback.selectionClick();
                setState(() {
                  _selectedAgendaFilter = f['id']!;
                });
              },
              borderRadius: BorderRadius.circular(20),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                decoration: BoxDecoration(
                  color: isSelected ? const Color(0xFF1F1A15) : const Color(0xFFFFFDF8),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: isSelected ? const Color(0xFFD4AF37) : const Color(0xFFEFE8DE),
                    width: isSelected ? 1.5 : 1,
                  ),
                  boxShadow: isSelected
                      ? [
                          BoxShadow(
                            color: Color(0xFFC5A052).withOpacity(0.2),
                            blurRadius: 8,
                            offset: const Offset(0, 3),
                          )
                        ]
                      : [],
                ),
                child: Text(
                  f['label']!,
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: isSelected ? FontWeight.bold : FontWeight.w600,
                    color: isSelected ? const Color(0xFFD4AF37) : const Color(0xFF786C60),
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildAgendaList(
      {bool limitToRecent = false, String? excludeBookingId, String filter = 'TODAS'}) {
    var filtered = _bookings;
    if (excludeBookingId != null) {
      filtered = filtered
          .where((b) => b['id']?.toString() != excludeBookingId)
          .toList();
    }

    if (filter == 'PROXIMAS') {
      filtered = filtered.where((b) {
        final st = (b['status'] as String? ?? '').toUpperCase();
        return st != 'COMPLETED' &&
            st != 'COMPLETADA' &&
            st != 'CANCELLED' &&
            st != 'CANCELADA';
      }).toList();
    } else if (filter == 'COMPLETADAS') {
      filtered = filtered.where((b) {
        final st = (b['status'] as String? ?? '').toUpperCase();
        return st == 'COMPLETED' || st == 'COMPLETADA';
      }).toList();
    } else if (filter == 'CANCELADAS') {
      filtered = filtered.where((b) {
        final st = (b['status'] as String? ?? '').toUpperCase();
        return st == 'CANCELLED' || st == 'CANCELADA' || st == 'EN_DISPUTA';
      }).toList();
    }

    // ─── Innovation 4: Real-time search query matching ───────────────
    if (_agendaSearchQuery.isNotEmpty) {
      filtered = filtered.where((b) {
        final clientName = (b['client_name'] ?? '').toString().toLowerCase();
        final serviceName = (b['service_name'] ?? '').toString().toLowerCase();
        final address = (b['service_address'] ?? '').toString().toLowerCase();
        return clientName.contains(_agendaSearchQuery) ||
            serviceName.contains(_agendaSearchQuery) ||
            address.contains(_agendaSearchQuery);
      }).toList();
    }

    if (limitToRecent && filtered.length > 3) {
      filtered = filtered.sublist(0, 3);
    }

    if (filtered.isEmpty) {
      String emptyMsg = 'No hay citas agendadas disponibles.';
      if (filter == 'PROXIMAS') emptyMsg = 'No tienes citas próximas agendadas.';
      if (filter == 'COMPLETADAS') emptyMsg = 'No hay citas completadas en tu historial.';
      if (filter == 'CANCELADAS') emptyMsg = 'No tienes citas canceladas o en disputa.';

      return Container(
        height: 160,
        alignment: Alignment.center,
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
        decoration: BoxDecoration(
          color: const Color(0xFFFFFDF8),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(
            color: Color(0xFFD4AF37).withOpacity(0.3),
            width: 1.2,
          ),
          boxShadow: [
            BoxShadow(
              color: Color(0xFFC5A052).withOpacity(0.06),
              blurRadius: 14,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFFAF4EB),
                shape: BoxShape.circle,
                border: Border.all(
                  color: Color(0xFFD4AF37).withOpacity(0.4),
                  width: 1,
                ),
              ),
              child: const Icon(Icons.calendar_today_outlined,
                  color: Color(0xFFC5A052), size: 28),
            ),
            const SizedBox(height: 12),
            Text(
              emptyMsg,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontFamily: 'CormorantGaramond',
                fontSize: 16,
                color: Color(0xFF1F1A15),
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
      );
    }

    return Column(
      children: filtered.map((b) {
        final date = DateTime.parse(b['scheduled_at']).toLocal();
        final dayStr =
            '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}';
        final hourStr =
            '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
        final clientInitial = (b['client_name'] ?? '?')[0].toUpperCase();
        final cardStatus = (b['status'] as String? ?? '').toUpperCase();

        return Stack(
          children: [
            GestureDetector(
              onTap: (cardStatus == 'COMPLETADA' || cardStatus == 'COMPLETED')
                  ? () => _showPayoutBreakdownDialog(b)
                  : null,
              child: Container(
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFFDF8),
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(color: const Color(0xFFEFE8DE), width: 1.2),
                  boxShadow: [
                    BoxShadow(
                      color: Color(0xFFC5A052).withOpacity(0.06),
                      blurRadius: 12,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          InkWell(
                            onTap: () {
                              final clientId = b['client_id']?.toString();
                              if (clientId == null) return;
                              HapticFeedback.lightImpact();
                              Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (_) => ChatScreen(
                                    partnerId: clientId,
                                    partnerName: b['client_name'] ?? 'Cliente',
                                    partnerRole: 'client',
                                    partnerAvatar: '',
                                  ),
                                ),
                              );
                            },
                            borderRadius: BorderRadius.circular(16),
                            child: Row(
                              children: [
                                CircleAvatar(
                                  radius: 20,
                                  backgroundColor: const Color(0xFFFAF4EB),
                                  child: Text(
                                    clientInitial,
                                    style: const TextStyle(
                                        color: Color(0xFFC5A052),
                                        fontWeight: FontWeight.bold),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      b['client_name'] ?? 'Cliente',
                                      style: const TextStyle(
                                          fontSize: 16,
                                          fontWeight: FontWeight.bold,
                                          color: Color(0xFF1F1A15)),
                                    ),
                                    const Row(
                                      children: [
                                        Icon(Icons.chat_bubble_outline_rounded,
                                            size: 12, color: Color(0xFFC5A052)),
                                        SizedBox(width: 4),
                                        Text(
                                          'Contacto seguro vía Chat',
                                          style: TextStyle(
                                              fontSize: 11.5,
                                              color: Color(0xFFC5A052),
                                              fontWeight: FontWeight.w600),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                          const Spacer(),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 10, vertical: 6),
                            decoration: BoxDecoration(
                              color: _statusBgColor(b['status']),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Text(
                              _statusText(b['status']).toUpperCase(),
                              style: TextStyle(
                                color: _statusColor(b['status']),
                                fontWeight: FontWeight.bold,
                                fontSize: 10,
                                letterSpacing: 0.5,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const Divider(height: 24, color: Color(0xFFEFE8DE)),
                      Row(
                        children: [
                          const Icon(Icons.spa_outlined,
                              size: 16, color: Color(0xFF8C7E74)),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              'Servicio: ${b['service_name']}',
                              style: const TextStyle(
                                  fontSize: 14, fontWeight: FontWeight.w500, color: Color(0xFF4A4036)),
                            ),
                          ),
                          Text(
                            '\$${(double.tryParse(b['total_amount']?.toString() ?? '') ?? 0.0).toStringAsFixed(0)}',
                            style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.bold,
                                color: Color(0xFF1F1A15)),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          const Icon(Icons.access_time_outlined,
                              size: 16, color: Color(0xFF8C7E74)),
                          const SizedBox(width: 6),
                          Text(
                            '$dayStr a las $hourStr',
                            style: const TextStyle(
                                fontSize: 14, color: Color(0xFF1F1A15)),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          const Icon(Icons.location_on_outlined,
                              size: 16, color: Color(0xFF8C7E74)),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              (b['service_address']?.toString().isNotEmpty ??
                                      false)
                                  ? 'Dirección: ${b['service_address']}'
                                  : 'Dirección pendiente por confirmar',
                              style: const TextStyle(
                                  fontSize: 13, color: Color(0xFF8C7E74)),
                            ),
                          ),
                          if ((b['service_address']?.toString().isNotEmpty ??
                                  false) &&
                              cardStatus != 'COMPLETADA' &&
                              cardStatus != 'COMPLETED' &&
                              cardStatus != 'CANCELADA' &&
                              cardStatus != 'CANCELLED' &&
                              cardStatus != 'PENDIENTE_PAGO') ...[
                            const SizedBox(width: 6),
                            GestureDetector(
                              onTap: () async {
                                final refresh = await Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) =>
                                        ProviderRouteScreen(booking: b),
                                  ),
                                );
                                if (refresh == true) {
                                  _fetchBookings();
                                  _fetchProfile();
                                }
                              },
                              child: const Icon(
                                Icons.map_outlined,
                                color: Color(0xFFC5A052),
                                size: 20,
                              ),
                            ),
                          ],
                        ],
                      ),
                       const SizedBox(height: 12),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          InkWell(
                            onTap: () {
                              HapticFeedback.lightImpact();
                              _showClientNotesDialog(
                                b['client_id']?.toString() ?? '',
                                b['client_name'] ?? 'Cliente',
                              );
                            },
                            borderRadius: BorderRadius.circular(20),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                color: const Color(0xFFFAF4EB),
                                borderRadius: BorderRadius.circular(20),
                                border: Border.all(color: Color(0xFFD4AF37).withOpacity(0.3)),
                              ),
                              child: const Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(Icons.note_alt_outlined, size: 13, color: Color(0xFFC5A052)),
                                  SizedBox(width: 4),
                                  Text('Notas VIP',
                                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF1F1A15))),
                                ],
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          InkWell(
                            onTap: () {
                              HapticFeedback.lightImpact();
                              _showAddToCalendarDialog(b);
                            },
                            borderRadius: BorderRadius.circular(20),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                color: const Color(0xFFFAF4EB),
                                borderRadius: BorderRadius.circular(20),
                                border: Border.all(color: Color(0xFFD4AF37).withOpacity(0.3)),
                              ),
                              child: const Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(Icons.calendar_month_outlined, size: 13, color: Color(0xFFC5A052)),
                                  SizedBox(width: 4),
                                  Text('Calendario',
                                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF1F1A15))),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      _buildCardActionButtons(b),
                    ],
                  ),
                ),
              ),
            ),
            if (cardStatus == 'PENDIENTE_PAGO')
              Positioned.fill(
                child: Container(
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.85),
                    borderRadius: BorderRadius.circular(24),
                  ),
                  child: Center(
                    child: Card(
                      color: Colors.white,
                      elevation: 4,
                      shadowColor: const Color(0x1F000000),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(20),
                        side: const BorderSide(
                            color: Color(0xFFFEF3C7), width: 1.5),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.all(16.0),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.lock_clock_outlined,
                                color: Color(0xFFD97706), size: 36),
                            const SizedBox(height: 8),
                            const Text(
                              'Pago en Verificación',
                              style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 15,
                                  color: Colors.black87),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Esperando confirmación de la pasarela Wompi...',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                  fontSize: 12, color: Colors.grey[600]),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        );
      }).toList(),
    );
  }

  Widget _buildNavItem({
    required int index,
    required String semanticName,
    required String label,
    String? assetPath,
    bool isMen = false,
  }) {
    final isSelected = _currentIndex == index;
    const activeColor = Color(0xFFC5A052);
    final inactiveColor = isMen ? const Color(0xFFB0A89F) : const Color(0xFF8C7A6B);

    return Expanded(
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () {
            HapticFeedback.selectionClick();
            setState(() {
              _currentIndex = index;
            });
          },
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 6.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Transform.scale(
                  scale: isSelected ? 1.12 : 0.95,
                  child: Opacity(
                    opacity: isSelected ? 1.0 : 0.6,
                    child: assetPath != null
                        ? Image.asset(
                            assetPath,
                            width: 24,
                            height: 24,
                            fit: BoxFit.contain,
                          )
                        : GlowIcon.resolve(
                            semanticName,
                            size: 20,
                            color: isSelected ? activeColor : inactiveColor,
                            semanticLabel: label,
                          ),
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  label,
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 9.5,
                    fontWeight: isSelected ? FontWeight.w800 : FontWeight.w600,
                    color: isSelected ? activeColor : inactiveColor,
                  ),
                ),
                if (isSelected)
                  Container(
                    margin: const EdgeInsets.only(top: 2),
                    width: 4,
                    height: 4,
                    decoration: const BoxDecoration(
                      color: Color(0xFFD4AF37),
                      shape: BoxShape.circle,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildProminentCenterNavItem({
    required int index,
    required String semanticName,
    required String label,
    String? assetPath,
    bool isMen = false,
  }) {
    final isSelected = _currentIndex == index;
    return Expanded(
      child: GestureDetector(
        onTap: () {
          HapticFeedback.mediumImpact();
          setState(() {
            _currentIndex = index;
          });
        },
        child: Transform.translate(
          offset: const Offset(0, -14),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: isMen ? const Color(0xFF2A241E) : const Color(0xFFF5EFE6), // Quiet Luxury Beige background
                  boxShadow: [
                    BoxShadow(
                      color: Color(0xFFD4AF37).withOpacity(isMen ? 0.5 : 0.3),
                      blurRadius: 12,
                      spreadRadius: 1,
                      offset: const Offset(0, 4),
                    ),
                  ],
                  border: Border.all(
                    color: isSelected ? const Color(0xFFD4AF37) : const Color(0xFFE8DFD8),
                    width: 2.5,
                  ),
                ),
                child: Center(
                  child: assetPath != null
                      ? Image.asset(
                          assetPath,
                          width: 28,
                          height: 28,
                          fit: BoxFit.contain,
                        )
                      : GlowIcon.resolve(
                          semanticName,
                          size: 24,
                          color: const Color(0xFFC5A052),
                          semanticLabel: label,
                        ),
                ),
              ),
              const SizedBox(height: 2),
              Text(
                label,
                style: TextStyle(
                  fontSize: 9.5,
                  fontWeight: FontWeight.w800,
                  color: isSelected
                      ? const Color(0xFFC5A052)
                      : (isMen ? const Color(0xFFD4AF37) : const Color(0xFFB07D62)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isMen = AudienceService.currentAudience.value == AudienceMode.men;
    final isPageLoading = (_bookings.isEmpty && _loading) || _loadingProfile;
    if (isPageLoading) {
      return Scaffold(
        body: Center(
          child: CircularProgressIndicator(color: AppTheme.primary),
        ),
      );
    }

    if (_error != null && _bookings.isEmpty) {
      return Scaffold(
        appBar: AppBar(
          title: Text(
            _userRole?.toLowerCase() == 'salon' ? 'Panel Salón SaaS' : 'Panel de Prestador',
          ),
        ),
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextButton(
                onPressed: () {
                  _fetchBookings();
                  _fetchProfile();
                },
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('❌ Error de conexión',
                        style: TextStyle(color: Colors.red, fontSize: 18)),
                    if (_error != null) ...[
                      const SizedBox(height: 8),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 24.0),
                        child: Text(
                          _error!,
                          style: TextStyle(color: Colors.grey[700], fontSize: 14),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ],
                    const SizedBox(height: 8),
                    const Text('Toca para reintentar',
                        style: TextStyle(color: Colors.blue)),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              ElevatedButton.icon(
                onPressed: () async {
                  await AuthService.logout();
                  if (mounted) {
                    Navigator.pushReplacementNamed(context, '/login');
                  }
                },
                icon: const Icon(Icons.logout),
                label: const Text('Cerrar sesión'),
                style: ElevatedButton.styleFrom(
                  foregroundColor: Colors.white,
                  backgroundColor: AppTheme.primary,
                ),
              ),
            ],
          ),
        ),
      );
    }

    // Switch body based on current BottomNavigationBar index
    Widget bodyWidget;
    switch (_currentIndex) {
      case 0:
        bodyWidget = _buildDashboardHome();
        break;
      case 1:
        bodyWidget = RefreshIndicator(
          onRefresh: () async {
            await _fetchBookings();
            await _fetchProfile();
          },
          color: const Color(0xFFC5A052),
          child: ListView(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
            children: [
              _buildAgendaHeroBanner(),
              const SizedBox(height: 16),
              _buildAgendaSearchBar(),
              const SizedBox(height: 14),
              _buildAgendaFilterChips(),
              const SizedBox(height: 20),
              _buildAgendaList(limitToRecent: false, filter: _selectedAgendaFilter),
            ],
          ),
        );
        break;
      case 2:
        bodyWidget = const WalletScreen(isEmbedded: true);
        break;
      case 3:
        bodyWidget = const StoreScreen();
        break;
      case 4:
        bodyWidget = const AcademyScreen();
        break;
      case 5:
        bodyWidget = const ChatListScreen();
        break;
      case 6:
        bodyWidget = const ProviderProfileScreen(isEmbedded: true);
        break;
      default:
        bodyWidget = _buildDashboardHome();
    }

    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: _currentIndex >= 2
          ? null
          : AppBar(
              title: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    _currentIndex == 0 ? Icons.workspace_premium_rounded : Icons.calendar_month_rounded,
                    size: 20,
                    color: const Color(0xFFC5A052),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    _currentIndex == 0
                        ? (_userRole?.toLowerCase() == 'salon' ? 'Panel Salón SaaS' : 'GlowPro Concierge')
                        : 'Mi Agenda Pro',
                    style: const TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF1F1A15),
                      letterSpacing: 0.5,
                    ),
                  ),
                ],
              ),
              backgroundColor: const Color(0xFFFAF8F5),
              foregroundColor: const Color(0xFF1F1A15),
              elevation: 0,
              scrolledUnderElevation: 0,
              centerTitle: false,
              actions: [
                if (_currentIndex == 0) ...[
                  PulsingStatusChip(
                    isActive: _isActive,
                    isToggling: _isTogglingStatus,
                    onChanged: _toggleStatus,
                  ),
                  const SizedBox(width: 10),
                ],
                Padding(
                  padding: const EdgeInsets.only(right: 16),
                  child: Center(
                    child: InkWell(
                      onTap: () {
                        HapticFeedback.lightImpact();
                        _fetchBookings();
                        _fetchProfile();
                      },
                      borderRadius: BorderRadius.circular(20),
                      child: Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          color: Colors.white,
                          shape: BoxShape.circle,
                          border: Border.all(color: const Color(0xFFE8DFD8), width: 1),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withOpacity(0.04),
                              blurRadius: 6,
                              offset: const Offset(0, 2),
                            ),
                          ],
                        ),
                        child: const Icon(Icons.refresh_rounded, size: 18, color: Color(0xFF1F1A15)),
                      ),
                    ),
                  ),
                ),
              ],
            ),
      body: Stack(
        children: [
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 720),
              child: Padding(
                padding: EdgeInsets.only(
                  bottom: _currentIndex == 3 ? 0 : 88.0, // GlowShop manages its own margins
                ),
                child: bodyWidget,
              ),
            ),
          ),
          
          GlowGuidePresenter(
                      engine: _providerGuideEngine,
                      onAction: _handleProviderGuideAction,
                      allowVideoTapToAdvance: false,
                      isProvider: true,
                    ),

          // Luxury Navigation Dock (Haute Horlogerie & Quiet Luxury)
          Positioned(
            bottom: MediaQuery.of(context).padding.bottom + 16,
            left: 16,
            right: 16,
            child: Container(
              height: 72,
              padding: const EdgeInsets.symmetric(horizontal: 4),
              decoration: BoxDecoration(
                color: isMen
                    ? Color(0xFF141210).withOpacity(0.95)
                    : const Color(0xFFFDFBF7),
                borderRadius: BorderRadius.circular(36),
                border: Border.all(
                    color: Color(0xFFD4AF37).withOpacity(isMen ? 0.6 : 0.5),
                    width: 1.5),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(isMen ? 0.45 : 0.08),
                    blurRadius: 20,
                    offset: const Offset(0, 8),
                  ),
                  BoxShadow(
                    color: Color(0xFFD4AF37).withOpacity(isMen ? 0.25 : 0.15),
                    blurRadius: 10,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Row(
                children: [
                  _buildNavItem(
                    index: 0,
                    semanticName: 'home',
                    assetPath: 'assets/icons/glow/nav_provider_home.png',
                    label: 'Inicio',
                    isMen: isMen,
                  ),
                  _buildNavItem(
                    index: 1,
                    semanticName: 'calendar',
                    assetPath: 'assets/icons/glow/nav_citas.webp',
                    label: 'Agenda',
                    isMen: isMen,
                  ),
                  _buildNavItem(
                    index: 2,
                    semanticName: 'wallet',
                    assetPath: 'assets/icons/glow/nav_provider_wallet.png',
                    label: 'Wallet',
                    isMen: isMen,
                  ),

                  // Botón central prominente: GlowShop (Luxe Medallion)
                  _buildProminentCenterNavItem(
                    index: 3,
                    semanticName: 'bag',
                    assetPath: 'assets/icons/glow/nav_glowshop.webp',
                    label: 'GlowShop',
                    isMen: isMen,
                  ),

                  _buildNavItem(
                    index: 4,
                    semanticName: 'school',
                    assetPath: 'assets/icons/glow/nav_provider_academy.png',
                    label: 'Academia',
                    isMen: isMen,
                  ),
                  _buildNavItem(
                    index: 5,
                    semanticName: 'chat',
                    assetPath: 'assets/icons/glow/nav_provider_chat.png',
                    label: 'Chat',
                    isMen: isMen,
                  ),
                  _buildNavItem(
                    index: 6,
                    semanticName: 'profile',
                    assetPath: 'assets/icons/glow/nav_perfil.webp',
                    label: 'Perfil',
                    isMen: isMen,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
      floatingActionButton: Padding(
        padding: const EdgeInsets.only(bottom: 80.0), // push above floating navigation bar
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            FloatingActionButton(
              heroTag: 'aura_copilot_fab',
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => const ProviderAiCopilotScreen(),
                  ),
                );
              },
              backgroundColor: const Color(0xFF1F1A15),
              foregroundColor: const Color(0xFFC5A052),
              elevation: 6,
              shape: CircleBorder(
                side: BorderSide(
                  color: Color(0xFFC5A052).withOpacity(0.8),
                  width: 1.8,
                ),
              ),
              child: const Icon(Icons.auto_awesome_rounded, size: 24, color: Color(0xFFC5A052)),
            ),
            const SizedBox(height: 12),
            FloatingActionButton(
              heroTag: 'sos_provider_fab',
              onPressed: _loadingSOS ? null : _showSOSConfirmationDialog,
              backgroundColor: const Color(0xFF800A0A),
              foregroundColor: const Color(0xFFFAF4EB),
              elevation: 6,
              shape: CircleBorder(
                side: BorderSide(
                  color: Color(0xFFD4AF37).withOpacity(0.8),
                  width: 1.8,
                ),
              ),
              child: _loadingSOS
                  ? const SizedBox(
                      width: 24,
                      height: 24,
                      child: CircularProgressIndicator(
                          strokeWidth: 2.5, color: Color(0xFFD4AF37)),
                    )
                  : const Icon(Icons.emergency_outlined, size: 28, color: Color(0xFFFAF4EB)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _analyticsCard(String label, String value, IconData icon, Color color,
      {String? subtitle}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFEFE8DE), width: 1),
        boxShadow: [
          BoxShadow(
            color: Color(0xFFC5A052).withOpacity(0.05),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: const Color(0xFFFAF6EE),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: Color(0xFFC5A052).withOpacity(0.25),
                width: 0.8,
              ),
            ),
            child: Icon(icon, color: const Color(0xFFC5A052), size: 18),
          ),
          const SizedBox(height: 10),
          Text(
            value,
            style: const TextStyle(
              fontFamily: 'Inter',
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: Color(0xFF1F1A15),
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 3),
          Text(
            label,
            style: const TextStyle(
              fontFamily: 'Inter',
              fontSize: 11,
              color: Color(0xFF8C7E74),
              fontWeight: FontWeight.w600,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 2),
            Text(
              subtitle,
              style: const TextStyle(
                fontFamily: 'Inter',
                fontSize: 9.5,
                color: Color(0xFFA8998C),
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ],
      ),
    );
  }

  Widget _analyticsCardWithTween(
      String label, double targetValue, IconData icon, Color color,
      {String? subtitle}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFEFE8DE), width: 1),
        boxShadow: [
          BoxShadow(
            color: Color(0xFFC5A052).withOpacity(0.05),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: const Color(0xFFFAF6EE),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: Color(0xFFC5A052).withOpacity(0.25),
                width: 0.8,
              ),
            ),
            child: const Icon(Icons.account_balance_wallet_outlined,
                color: Color(0xFFC5A052), size: 18),
          ),
          const SizedBox(height: 10),
          TweenAnimationBuilder<double>(
            tween: Tween<double>(begin: 0.0, end: targetValue),
            duration: const Duration(milliseconds: 1200),
            curve: Curves.easeOut,
            builder: (context, value, child) {
              return Text(
                '\$${value.toStringAsFixed(0)}',
                style: const TextStyle(
                  fontFamily: 'Inter',
                  fontSize: 17,
                  fontWeight: FontWeight.bold,
                  color: Color(0xFF1F1A15),
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              );
            },
          ),
          const SizedBox(height: 3),
          Text(
            label,
            style: const TextStyle(
              fontFamily: 'Inter',
              fontSize: 11,
              color: Color(0xFF8C7E74),
              fontWeight: FontWeight.w600,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 2),
            Text(
              subtitle,
              style: const TextStyle(
                fontFamily: 'Inter',
                fontSize: 9.5,
                color: Color(0xFFA8998C),
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ],
      ),
    );
  }

  Color _statusColor(dynamic status) {
    final s = (status?.toString() ?? '').toUpperCase();
    switch (s) {
      case 'PENDING':
      case 'PENDIENTE_PAGO':
        return const Color(0xFFC5A052);
      case 'CONFIRMED':
      case 'CONFIRMADA':
        return const Color(0xFF1F1A15);
      case 'EN_PROGRESO':
        return const Color(0xFFD4AF37);
      case 'FINALIZADA_PRESTADOR':
        return const Color(0xFF06B6D4);
      case 'COMPLETED':
      case 'COMPLETADA':
        return const Color(0xFF16A34A);
      case 'CANCELLED':
      case 'CANCELADA':
        return const Color(0xFF800A0A);
      default:
        return const Color(0xFF8C7E74);
    }
  }

  Color _statusBgColor(dynamic status) {
    final s = (status?.toString() ?? '').toUpperCase();
    switch (s) {
      case 'PENDING':
      case 'PENDIENTE_PAGO':
        return const Color(0xFFFAF4EB);
      case 'CONFIRMED':
      case 'CONFIRMADA':
        return const Color(0xFFF7F2EA);
      case 'EN_PROGRESO':
        return const Color(0xFF1F1A15);
      case 'FINALIZADA_PRESTADOR':
        return const Color(0xFFECFEFF);
      case 'COMPLETED':
      case 'COMPLETADA':
        return const Color(0xFFF0FDF4);
      case 'CANCELLED':
      case 'CANCELADA':
        return const Color(0xFFFDF2F2);
      default:
        return const Color(0xFFFAF6EE);
    }
  }

  String _statusText(dynamic status) {
    final s = (status?.toString() ?? '').toUpperCase();
    switch (s) {
      case 'PENDING':
      case 'PENDIENTE_PAGO':
        return 'Pendiente Pago';
      case 'CONFIRMED':
      case 'CONFIRMADA':
        return 'Confirmada';
      case 'EN_PROGRESO':
        return 'En Progreso';
      case 'FINALIZADA_PRESTADOR':
        return 'Finalizada';
      case 'COMPLETED':
      case 'COMPLETADA':
        return 'Completada';
      case 'CANCELLED':
      case 'CANCELADA':
        return 'Cancelada';
      default:
        return status?.toString() ?? '';
    }
  }
}

/// Provider's tour changes tabs inside the existing dashboard rather than routes.
class ProviderGuideNavigationDelegate implements NavigationDelegate {
  @override
  Future<NavigationResult> navigate({
    required String routeName,
    Map<String, dynamic>? arguments,
    required Duration timeout,
  }) async => NavigationResult.failure(routeName, 'No route navigation required');

  @override
  Future<NavigationResult> returnToHome({required Duration timeout}) async =>
      NavigationResult.success('/provider');

  @override
  void cancelPending() {}
}

// Pulsing chip state widget
class PulsingStatusChip extends StatefulWidget {
  final bool isActive;
  final bool isToggling;
  final ValueChanged<bool> onChanged;

  const PulsingStatusChip({
    super.key,
    required this.isActive,
    required this.isToggling,
    required this.onChanged,
  });

  @override
  State<PulsingStatusChip> createState() => _PulsingStatusChipState();
}

class _PulsingStatusChipState extends State<PulsingStatusChip>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap:
          widget.isToggling ? null : () => widget.onChanged(!widget.isActive),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: widget.isActive ? const Color(0xFFFAF4EB) : const Color(0xFFF0EBE6),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color:
                widget.isActive ? const Color(0xFFD4AF37) : const Color(0xFFD1C7BD),
            width: 1.2,
          ),
          boxShadow: [
            BoxShadow(
              color: Color(0xFFC5A052).withOpacity(0.08),
              blurRadius: 6,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (widget.isToggling)
              const SizedBox(
                width: 8,
                height: 8,
                child: CircularProgressIndicator(
                    strokeWidth: 1.5, color: Color(0xFFC5A052)),
              )
            else if (widget.isActive)
              ScaleTransition(
                scale: Tween<double>(begin: 0.8, end: 1.2).animate(
                  CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
                ),
                child: Container(
                  width: 8,
                  height: 8,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    color: Color(0xFF16A34A),
                  ),
                ),
              )
            else
              Container(
                width: 8,
                height: 8,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: Color(0xFF9E948A),
                ),
              ),
            const SizedBox(width: 6),
            Text(
              widget.isActive ? 'En Línea' : 'Fuera de Línea',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.bold,
                color: widget.isActive
                    ? const Color(0xFF1F1A15)
                    : const Color(0xFF8C7E74),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// OTP Timer Widget
class OtpTimerWidget extends StatefulWidget {
  const OtpTimerWidget({super.key});

  @override
  State<OtpTimerWidget> createState() => _OtpTimerWidgetState();
}

class _OtpTimerWidgetState extends State<OtpTimerWidget> {
  int _secondsLeft = 300; // 5 minutes
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_secondsLeft > 0) {
        if (mounted) {
          setState(() {
            _secondsLeft--;
          });
        }
      } else {
        _timer?.cancel();
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final minutes = (_secondsLeft ~/ 60).toString().padLeft(2, '0');
    final seconds = (_secondsLeft % 60).toString().padLeft(2, '0');
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0xFFFAF4EB),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFEFE8DE)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.timer_outlined, size: 14, color: Color(0xFFC5A052)),
          const SizedBox(width: 6),
          Text(
            'Tiempo sugerido de confirmación: $minutes:$seconds',
            style: const TextStyle(
                fontSize: 11.5, color: Color(0xFF1F1A15), fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }
}

// Segmented Pin Input Dialog
class SegmentedPinDialog extends StatefulWidget {
  final Map<String, dynamic> booking;
  final Function(Map<String, dynamic>) onSuccess;

  const SegmentedPinDialog({
    super.key,
    required this.booking,
    required this.onSuccess,
  });

  @override
  State<SegmentedPinDialog> createState() => _SegmentedPinDialogState();
}

class _SegmentedPinDialogState extends State<SegmentedPinDialog> {
  final List<TextEditingController> _controllers =
      List.generate(4, (_) => TextEditingController());
  final List<FocusNode> _focusNodes = List.generate(4, (_) => FocusNode());
  bool _isSubmitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _focusNodes[0].requestFocus();
      }
    });
  }

  @override
  void dispose() {
    for (var c in _controllers) {
      c.dispose();
    }
    for (var f in _focusNodes) {
      f.dispose();
    }
    super.dispose();
  }

  Future<void> _submitPin() async {
    final pin = _controllers.map((c) => c.text).join();
    if (pin.length != 4) return;

    setState(() {
      _isSubmitting = true;
      _error = null;
    });

    try {
      double providerLat;
      double providerLon;
      double clientLat;
      double clientLon;

      try {
        final pos = await getWebGeolocation();
        providerLat = pos['lat']!;
        providerLon = pos['lon']!;
        clientLat = providerLat;
        clientLon = providerLon;
      } catch (e) {
        debugPrint('Error obteniendo geolocalización real: $e');
        throw Exception('No se pudo verificar tu geolocalización. Asegúrate de activar el GPS y dar permisos de ubicación.');
      }

      final res = await ApiService.completeBooking(
        widget.booking['id'].toString(),
        pin,
        providerLat: providerLat,
        providerLon: providerLon,
        clientLat: clientLat,
        clientLon: clientLon,
      );
      HapticFeedback.mediumImpact();
      if (mounted) {
        Navigator.pop(context);
        widget.onSuccess(res);
      }
    } catch (e) {
      HapticFeedback.vibrate();
      if (mounted) {
        setState(() {
          _isSubmitting = false;
          _error = e.toString().replaceAll('Exception:', '').replaceAll('Exception: ', '');
          for (var c in _controllers) {
            c.clear();
          }
          _focusNodes[0].requestFocus();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(24),
        side: BorderSide(
          color: Color(0xFFD4AF37).withOpacity(0.4),
          width: 1.5,
        ),
      ),
      backgroundColor: const Color(0xFFFFFDF8),
      title: const Row(
        children: [
          Icon(Icons.verified_user_outlined, color: Color(0xFFC5A052)),
          SizedBox(width: 8),
          Text(
            'Verificación Escrow',
            style: TextStyle(
              fontFamily: 'CormorantGaramond',
              fontWeight: FontWeight.bold,
              fontSize: 20,
              color: Color(0xFF1F1A15),
            ),
          ),
        ],
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Pídele al cliente el PIN de 4 dígitos generado en su pantalla para liberar los fondos.',
            style: TextStyle(fontSize: 13, color: Color(0xFF8C7E74)),
          ),
          const SizedBox(height: 20),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: List.generate(4, (index) {
              return Container(
                width: 50,
                height: 50,
                decoration: BoxDecoration(
                  color: const Color(0xFFFAF4EB),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: _focusNodes[index].hasFocus
                        ? const Color(0xFFD4AF37)
                        : const Color(0xFFE8DFD8),
                    width: _focusNodes[index].hasFocus ? 2 : 1,
                  ),
                ),
                child: Semantics(
                  label: 'Dígito del PIN ${index + 1}',
                  textField: true,
                  child: TextFormField(
                    controller: _controllers[index],
                    focusNode: _focusNodes[index],
                    keyboardType: TextInputType.number,
                    maxLength: 1,
                    obscureText: true,
                    obscuringCharacter: '●',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFFC5A052)),
                    decoration: const InputDecoration(
                      counterText: '',
                      border: InputBorder.none,
                    ),
                    onChanged: (val) {
                      HapticFeedback.selectionClick();
                      if (val.length == 1) {
                        if (index < 3) {
                          _focusNodes[index + 1].requestFocus();
                        } else {
                          _submitPin();
                        }
                      } else if (val.isEmpty && index > 0) {
                        _focusNodes[index - 1].requestFocus();
                      }
                    },
                  ),
                ),
              );
            }),
          ),
          if (_isSubmitting) ...[
            SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: AppTheme.primary),
                ),
                SizedBox(width: 8),
                Text(
                  '📡 Validando proximidad GPS (PostGIS)...',
                  style: TextStyle(
                      fontSize: 12,
                      color: Colors.grey,
                      fontWeight: FontWeight.w500),
                ),
              ],
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(
              _error!,
              style: const TextStyle(
                  color: Colors.redAccent,
                  fontSize: 12,
                  fontWeight: FontWeight.bold),
              textAlign: TextAlign.center,
            ),
          ],
        ],
      ),
      actions: [
        TextButton(
          onPressed: _isSubmitting ? null : () => Navigator.pop(context),
          child: const Text('Cancelar', style: TextStyle(color: Colors.grey)),
        ),
      ],
    );
  }
}
