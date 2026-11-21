// frontend/lib/screens/provider_route_screen.dart
import 'dart:async';
import 'dart:convert';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:web_socket_channel/web_socket_channel.dart' as web_socket_channel;
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
  LatLng? _clientLoc;
  LatLng? _providerLoc;
  final MapController _mapController = MapController();
  bool _mapReady = false;
  bool _hasFitLocations = false;
  String _locationMessage = 'Buscando la dirección y ubicación real…';
  bool _isStartingService = false;

  late AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _loadRealLocations();
    _conectarSala();

    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat();
  }


  // ── Envío de ubicación real al cliente (esta pantalla es del prestador) ──
  //
  // El backend exige estar registrado con token y unido a la sala del booking;
  // con eso, cada `location_update` actualiza perfiles_prestador.ubicacion y se
  // retransmite como `location_received` al cliente en la misma sala.
  web_socket_channel.WebSocketChannel? _wsChannel;
  StreamSubscription<Position>? _geoSub;
  bool _compartiendo = false;

  Future<void> _conectarSala() async {
    try {
      final base = ApiService.baseUrl.replaceFirst('http', 'ws');
      _wsChannel =
          web_socket_channel.WebSocketChannel.connect(Uri.parse('$base/chat'));
      final token = await AuthService.getToken();
      if (token == null || token.isEmpty) return;
      _wsChannel!.sink.add(jsonEncode({'type': 'register', 'token': token}));
      final bookingId = widget.booking['id']?.toString();
      if (bookingId != null && bookingId.isNotEmpty) {
        _wsChannel!.sink.add(jsonEncode({
          'type': 'join_booking_room',
          'bookingId': bookingId,
          'role': 'provider',
        }));
      }
    } catch (e) {
      debugPrint('WS provider: $e');
    }
  }

  /// Arranca o detiene el envío de la posición real del prestador.
  Future<void> _alternarCompartir() async {
    if (_compartiendo) {
      await _geoSub?.cancel();
      _geoSub = null;
      if (mounted) setState(() => _compartiendo = false);
      return;
    }

    final bookingId = widget.booking['id']?.toString();
    if (bookingId == null || bookingId.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('La reserva no tiene identificador')),
      );
      return;
    }

    try {
      var permiso = await Geolocator.checkPermission();
      if (permiso == LocationPermission.denied) {
        permiso = await Geolocator.requestPermission();
      }
      if (permiso == LocationPermission.denied ||
          permiso == LocationPermission.deniedForever ||
          permiso == LocationPermission.unableToDetermine) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Sin permiso de ubicación no se puede compartir'),
            ),
          );
        }
        return;
      }

      const settings = LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 10,
      );

      _geoSub = Geolocator.getPositionStream(locationSettings: settings).listen((pos) {
        _wsChannel?.sink.add(jsonEncode({
          'type': 'location_update',
          'bookingId': bookingId,
          'latitude': pos.latitude,
          'longitude': pos.longitude,
        }));
        if (mounted) {
          setState(() {
            _providerLoc = LatLng(pos.latitude, pos.longitude);
          });
          _fitMapToLocations();
        }
      }, onError: (e) {
        debugPrint('GPS provider: $e');
        _geoSub?.cancel();
        _geoSub = null;
        if (mounted) {
          setState(() {
            _compartiendo = false;
            _locationMessage = 'No se pudo compartir la ubicación del dispositivo.';
          });
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('No se pudo obtener la ubicación. Revisa el GPS y los permisos.'),
            ),
          );
        }
      });

      if (mounted) setState(() => _compartiendo = true);
    } catch (e) {
      debugPrint('No se pudo iniciar el GPS: $e');
    }
  }

  @override
  void dispose() {
    _geoSub?.cancel();
    _wsChannel?.sink.close();
    _pulseController.dispose();
    _mapController.dispose();
    super.dispose();
  }

  Future<void> _loadRealLocations() async {
    LatLng? destination;
    final address = widget.booking['service_address']?.toString().trim() ?? '';
    final addressMessage = address.isEmpty
        ? 'La cita no tiene una dirección para mostrar.'
        : 'No pudimos ubicar la dirección de la cita.';

    if (address.isNotEmpty) {
      try {
        final locations = await locationFromAddress(address);
        if (locations.isNotEmpty) {
          destination = LatLng(locations.first.latitude, locations.first.longitude);
        }
      } catch (e) {
        debugPrint('No se pudo geocodificar la dirección de la cita: $e');
      }
    }

    LatLng? providerLocation;
    final currentLocation = await ubicacionDisponible();
    if (currentLocation.ok) {
      providerLocation = LatLng(currentLocation.lat!, currentLocation.lon!);
    }

    if (!mounted) return;
    setState(() {
      _clientLoc = destination;
      _providerLoc = providerLocation;
      _locationMessage = destination != null && providerLocation != null
          ? 'Ubicación real del prestador y destino de la cita.'
          : destination != null
              ? 'Destino ubicado. Comparte tu ubicación para mostrar tu posición.'
              : addressMessage;
    });
    _fitMapToLocations();
  }

  void _fitMapToLocations() {
    if (!_mapReady || _hasFitLocations) return;
    final points = [
      if (_clientLoc != null) _clientLoc!,
      if (_providerLoc != null) _providerLoc!,
    ];
    if (points.isEmpty) return;
    if (points.length == 1) {
      _mapController.move(points.single, 14.2);
      return;
    }
    if (const Distance().distance(points.first, points.last) < 20) {
      _mapController.move(points.first, 15);
      _hasFitLocations = true;
      return;
    }
    _mapController.fitCamera(
      CameraFit.bounds(
        bounds: LatLngBounds.fromPoints(points),
        padding: const EdgeInsets.all(64),
      ),
    );
    _hasFitLocations = true;
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
            content: Text('❌ Error al iniciar servicio: ${mensajeHumano(e)}'),
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
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _alternarCompartir,
        backgroundColor:
            _compartiendo ? const Color(0xFF881337) : const Color(0xFFC5A052),
        foregroundColor: Colors.white,
        icon:
            Icon(_compartiendo ? Icons.stop_circle_outlined : Icons.share_location),
        label: Text(_compartiendo ? 'Detener envío' : 'Compartir ubicación'),
      ),
      body: Stack(
        children: [
          // 1. Capa de Mapa (OSM via flutter_map)
          FlutterMap(
            options: MapOptions(
              initialCenter: const LatLng(4.653, -74.083),
              initialZoom: 11,
              onMapReady: () {
                _mapReady = true;
                _fitMapToLocations();
              },
            ),
            mapController: _mapController,
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.beautyapp.map',
              ),
              MarkerLayer(
                markers: [
                  // Marcador Cliente (Destino)
                  if (_clientLoc != null)
                    Marker(
                    width: 50,
                    height: 50,
                    point: _clientLoc!,
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
                  if (_providerLoc != null)
                    Marker(
                    width: 80,
                    height: 80,
                    point: _providerLoc!,
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
                                        : _locationMessage,
                                    style: TextStyle(
                                      fontSize: 13,
                                      color: isInProgress
                                          ? AppTheme.primary
                                          : (_clientLoc != null &&
                                                  _providerLoc != null
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
