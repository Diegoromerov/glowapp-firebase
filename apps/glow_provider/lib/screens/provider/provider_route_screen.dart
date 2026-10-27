// frontend/lib/screens/provider_route_screen.dart
import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:glow_provider/screens/chat/chat_screen.dart';
import 'package:glow_core/services/api_service.dart';
import 'package:glow_core/shared/theme.dart' hide AppTheme;
import 'package:glow_core/glow_core.dart';

class ProviderRouteScreen extends StatefulWidget {
  final Map<String, dynamic> booking;

  const ProviderRouteScreen({
    super.key,
    required this.booking,
  });

  @override
  State<ProviderRouteScreen> createState() => _ProviderRouteScreenState();
}

class _ProviderRouteScreenState extends State<ProviderRouteScreen>
    with SingleTickerProviderStateMixin {
  // Coordenadas fijas del cliente en Fontibón
  final LatLng _clientLoc = const LatLng(4.6735, -74.1422);

  // Coordenadas iniciales del prestador
  late LatLng _providerLoc;

  double _progress = 0.0;
  Timer? _moveTimer;
  int _minutesRemaining = 8;
  bool _isArrived = false;
  bool _isStartingService = false;

  late AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    // Inicia un poco al noreste del cliente
    _providerLoc = const LatLng(4.6795, -74.1310);
    _startRouteSimulation();

    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat();
  }

  @override
  void dispose() {
    _moveTimer?.cancel();
    _pulseController.dispose();
    super.dispose();
  }

  void _startRouteSimulation() {
    _moveTimer = Timer.periodic(const Duration(seconds: 2), (timer) {
      if (!mounted) return;
      setState(() {
        if (_progress < 1.0) {
          _progress +=
              0.1; // Incrementa 10% cada 2 segundos (20 segundos total)
          if (_progress > 1.0) _progress = 1.0;

          final double lat =
              4.6795 + (_clientLoc.latitude - 4.6795) * _progress;
          final double lon =
              -74.1310 + (_clientLoc.longitude - (-74.1310)) * _progress;
          _providerLoc = LatLng(lat, lon);

          _minutesRemaining = (8 * (1.0 - _progress)).round();
          if (_minutesRemaining < 1) _minutesRemaining = 1;

          if (_progress >= 1.0) {
            _isArrived = true;
            HapticFeedback.lightImpact();
            _moveTimer?.cancel();
          }
        }
      });
    });
  }

  Future<void> _handleStartService() async {
    setState(() => _isStartingService = true);
    try {
      await ApiService.startBooking(widget.booking['id'].toString());
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
        Navigator.pop(
            context, true); // Retorna true para refrescar el dashboard
      }
    } catch (e) {
      setState(() => _isStartingService = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('❌ Error al iniciar servicio: $e'),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final String clientName = widget.booking['client_name'] ?? 'Cliente';
    final String serviceName = widget.booking['service_name'] ?? 'Servicio';
    final String clientId = widget.booking['client_id']?.toString() ?? '';
    final String serviceAddress =
        widget.booking['service_address']?.toString() ?? '';
    final String status =
        (widget.booking['status'] as String? ?? '').toUpperCase();
    final bool isInProgress = status == 'EN_PROGRESO';

    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
        title: const Text(
          'Trayecto a Domicilio',
          style: TextStyle(
            fontFamily: 'CormorantGaramond',
            fontWeight: FontWeight.bold,
            letterSpacing: 0.5,
            fontSize: 22,
            color: Color(0xFF1F1A15),
          ),
        ),
        backgroundColor: const Color(0xFFFAF8F5),
        elevation: 0,
        leading: Padding(
          padding: const EdgeInsets.only(left: 12.0),
          child: Center(
            child: InkWell(
              onTap: () => Navigator.pop(context, false),
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
                child: const Icon(Icons.arrow_back_ios_new_rounded, size: 15, color: Color(0xFF1F1A15)),
              ),
            ),
          ),
        ),
      ),
      body: Stack(
        children: [
          // 1. Capa de Mapa (OSM via flutter_map)
          FlutterMap(
            options: MapOptions(
              initialCenter: LatLng(
                  (_clientLoc.latitude + _providerLoc.latitude) / 2,
                  (_clientLoc.longitude + _providerLoc.longitude) / 2),
              initialZoom: 14.2,
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.beautyapp.map',
              ),
              PolylineLayer(
                polylines: [
                  Polyline(
                    points: [_providerLoc, _clientLoc],
                    color: AppTheme.primary,
                    strokeWidth: 4.5,
                  ),
                ],
              ),
              MarkerLayer(
                markers: [
                  // Marcador Cliente (Destino)
                  Marker(
                    width: 50,
                    height: 50,
                    point: _clientLoc,
                    child: Container(
                      decoration: BoxDecoration(
                        color: AppTheme.surface,
                        shape: BoxShape.circle,
                        boxShadow: AppTheme.softShadow,
                      ),
                      child: Icon(Icons.home_work,
                          color: AppTheme.info, size: 28),
                    ),
                  ),
                  // Marcador Prestador (Origen móvil) con doble anillo de pulso concéntrico
                  Marker(
                    width: 80,
                    height: 80,
                    point: _providerLoc,
                    child: AnimatedBuilder(
                      animation: _pulseController,
                      builder: (context, child) {
                        return Stack(
                          alignment: Alignment.center,
                          children: [
                            // Primera anilla de pulso
                            Opacity(
                              opacity: (1.0 - _pulseController.value)
                                  .clamp(0.0, 1.0),
                              child: Container(
                                width: 40 + (_pulseController.value * 40),
                                height: 40 + (_pulseController.value * 40),
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  border: Border.all(
                                    color:
                                        AppTheme.primary.withOpacity(0.6),
                                    width: 2,
                                  ),
                                ),
                              ),
                            ),
                            // Segunda anilla de pulso (desfasada)
                            Opacity(
                              opacity:
                                  (1.0 - ((_pulseController.value + 0.5) % 1.0))
                                      .clamp(0.0, 1.0),
                              child: Container(
                                width: 40 +
                                    (((_pulseController.value + 0.5) % 1.0) *
                                        40),
                                height: 40 +
                                    (((_pulseController.value + 0.5) % 1.0) *
                                        40),
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  border: Border.all(
                                    color:
                                        AppTheme.primary.withOpacity(0.4),
                                    width: 2,
                                  ),
                                ),
                              ),
                            ),
                            // El avatar del prestador
                            Container(
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                border: Border.all(
                                    color: AppTheme.primary, width: 2.5),
                                boxShadow: AppTheme.softShadow,
                              ),
                              child: CircleAvatar(
                                radius: 18,
                                backgroundColor: AppTheme.background,
                                child: Icon(Icons.content_cut,
                                    size: 18, color: AppTheme.primary),
                              ),
                            ),
                          ],
                        );
                      },
                    ),
                  ),
                ],
              ),
            ],
          ),

          // 2. Capa Superior: Dirección y Cita Card (Glassmorphic)
          Positioned(
            top: 16,
            left: 16,
            right: 16,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(24),
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
                child: Container(
                  decoration: BoxDecoration(
                    color: AppTheme.surface.withOpacity(0.7),
                    borderRadius: BorderRadius.circular(24),
                    border: Border.all(
                        color: AppTheme.surface.withOpacity(0.5),
                        width: 1.5),
                    boxShadow: AppTheme.cardShadow,
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 20, vertical: 16),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(Icons.location_on,
                                color: AppTheme.primary, size: 20),
                            SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                serviceAddress.isNotEmpty
                                    ? serviceAddress
                                    : 'Dirección pendiente por confirmar',
                                style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    color: Colors.grey[800],
                                    fontSize: 13.5),
                              ),
                            ),
                          ],
                        ),
                        SizedBox(height: 10),
                        Divider(
                            height: 1,
                            color: AppTheme.primary.withOpacity(0.2)),
                        SizedBox(height: 10),
                        Text(
                          'Servicio: $serviceName',
                          style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 14,
                              color: Colors.black87),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Cliente: $clientName',
                          style:
                              const TextStyle(fontSize: 13, color: Colors.grey),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),

          // Botón Tema de Mapa (Claro/Oscuro Limpio)
          Positioned(
            right: 20,
            bottom: 220,
            child: FloatingActionButton(
              heroTag: 'map_theme_route_fab',
              onPressed: () {
                setState(() {
                  MapSettings.isDark = !MapSettings.isDark;
                });
              },
              backgroundColor: AppTheme.surface,
              foregroundColor: AppTheme.primary,
              elevation: 4,
              shape: const CircleBorder(),
              child: Icon(
                MapSettings.isDark
                    ? Icons.light_mode_outlined
                    : Icons.dark_mode_outlined,
                size: 22,
              ),
            ),
          ),

          // 3. Capa Inferior: Drawer de Estado y Botón de Inicio (Glassmorphic)
          Positioned(
            left: 16,
            right: 16,
            bottom: 24,
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 620),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(28),
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
                child: Container(
                  decoration: BoxDecoration(
                    color: AppTheme.surface.withOpacity(0.7),
                    borderRadius: BorderRadius.circular(28),
                    border: Border.all(
                        color: AppTheme.surface.withOpacity(0.5),
                        width: 1.5),
                    boxShadow: AppTheme.cardShadow,
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Row(
                          children: [
                            CircleAvatar(
                              radius: 24,
                              backgroundColor: AppTheme.background,
                              child: Text(
                                clientName.isNotEmpty
                                    ? clientName[0].toUpperCase()
                                    : 'C',
                                style: TextStyle(
                                    fontSize: 16,
                                    color: AppTheme.primary,
                                    fontWeight: FontWeight.bold),
                              ),
                            ),
                            SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    clientName,
                                    style: const TextStyle(
                                        fontWeight: FontWeight.bold,
                                        fontSize: 16,
                                        color: Colors.black87),
                                  ),
                                  SizedBox(height: 2),
                                  Text(
                                    isInProgress
                                        ? '⚡ Servicio en Progreso'
                                        : (_isArrived
                                            ? '🟢 Has llegado al destino'
                                            : '🚙 En camino al domicilio'),
                                    style: TextStyle(
                                      fontSize: 13,
                                      color: isInProgress
                                          ? AppTheme.primary
                                          : (_isArrived
                                              ? AppTheme.success
                                              : Colors.grey),
                                      fontWeight: isInProgress
                                          ? FontWeight.bold
                                          : FontWeight.normal,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            if (!_isArrived)
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 12, vertical: 8),
                                decoration: BoxDecoration(
                                  color: AppTheme.errorBg,
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                child: Text(
                                  '$_minutesRemaining min',
                                  style: TextStyle(
                                      fontSize: 14,
                                      color: AppTheme.error,
                                      fontWeight: FontWeight.bold),
                                ),
                              ),
                          ],
                        ),
                        Divider(
                            height: 24,
                            color: AppTheme.primary.withOpacity(0.2)),
                        Row(
                          children: [
                            GestureDetector(
                              onTap: () {
                                if (clientId.isNotEmpty) {
                                  Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                      builder: (_) => ChatScreen(
                                        partnerId: clientId,
                                        partnerName: clientName,
                                        partnerRole: 'client',
                                        partnerAvatar: '',
                                      ),
                                    ),
                                  );
                                }
                              },
                              child: CircleAvatar(
                                radius: 22,
                                backgroundColor: AppTheme.primary,
                                child: Icon(Icons.chat_bubble_outline_rounded,
                                    color: Colors.white, size: 18),
                              ),
                            ),
                            const SizedBox(width: 16),
                            // Botón Iniciar Servicio
                            Expanded(
                              child: isInProgress
                                  ? ElevatedButton(
                                      onPressed: () =>
                                          Navigator.pop(context, false),
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor: AppTheme.primary,
                                        foregroundColor: Colors.white,
                                        padding: const EdgeInsets.symmetric(
                                            vertical: 14),
                                        shape: RoundedRectangleBorder(
                                            borderRadius:
                                                BorderRadius.circular(30)),
                                        elevation: 0,
                                      ),
                                      child: const Text(
                                        'Volver al Panel',
                                        style: TextStyle(
                                            fontWeight: FontWeight.bold,
                                            fontSize: 14),
                                      ),
                                    )
                                  : _isStartingService
                                      ? Center(
                                          child: CircularProgressIndicator(
                                              color: AppTheme.primary))
                                      : Container(
                                          height: 48,
                                          decoration: BoxDecoration(
                                            borderRadius: BorderRadius.circular(16),
                                            gradient: const LinearGradient(
                                              colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                                              begin: Alignment.topLeft,
                                              end: Alignment.bottomRight,
                                            ),
                                            boxShadow: [
                                              BoxShadow(
                                                color: Color(0xFFC5A052).withOpacity(0.35),
                                                blurRadius: 10,
                                                offset: const Offset(0, 4),
                                              ),
                                            ],
                                          ),
                                          child: ElevatedButton(
                                            onPressed: _handleStartService,
                                            style: ElevatedButton.styleFrom(
                                              backgroundColor: Colors.transparent,
                                              shadowColor: Colors.transparent,
                                              foregroundColor: const Color(0xFF1F1A15),
                                              elevation: 0,
                                              shape: RoundedRectangleBorder(
                                                borderRadius: BorderRadius.circular(16),
                                              ),
                                            ),
                                            child: const Text(
                                              'Iniciar Servicio',
                                              style: TextStyle(
                                                fontFamily: 'Inter',
                                                fontWeight: FontWeight.bold,
                                                fontSize: 14,
                                                color: Color(0xFF1F1A15),
                                              ),
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
          ),
        ),
      ),
    ],
  ),
);
  }
}
