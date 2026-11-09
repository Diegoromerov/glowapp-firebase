// frontend/lib/screens/booking_tracking_screen.dart
import 'dart:async';
import 'dart:convert';
import 'dart:ui' show ImageFilter;
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:web_socket_channel/web_socket_channel.dart'
    as web_socket_channel;
import 'chat_screen.dart';
import 'package:glow_core/glow_core.dart';

class BookingTrackingScreen extends StatefulWidget {
  final Map<String, dynamic> booking;

  const BookingTrackingScreen({
    super.key,
    required this.booking,
  });

  @override
  State<BookingTrackingScreen> createState() => _BookingTrackingScreenState();
}

class _BookingTrackingScreenState extends State<BookingTrackingScreen>
    with SingleTickerProviderStateMixin {
  // Solo se asigna al recibir coordenadas reales por el canal autenticado.
  LatLng? _providerLoc;

  // Canal de WebSocket para tracking GPS real
  web_socket_channel.WebSocketChannel? _wsChannel;
  bool _usingRealGPS = false;
  DateTime? _ultimaUbicacionAt;
  Timer? _vigilarUbicacionTimer;

  late AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    // Controlador para la animación pulsante concéntrica del marcador del proveedor
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat();

    _vigilarUbicacionTimer = Timer.periodic(
      const Duration(seconds: 10),
      (_) {
        final ultima = _ultimaUbicacionAt;
        if (_usingRealGPS &&
            ultima != null &&
            DateTime.now().difference(ultima) > const Duration(seconds: 30)) {
          _marcarSinUbicacion();
        }
      },
    );
    _connectWebSocketTracking();
  }

  @override
  void dispose() {
    _pulseController.dispose();
    _vigilarUbicacionTimer?.cancel();
    _wsChannel?.sink.close();
    super.dispose();
  }

  void _connectWebSocketTracking() async {
    try {
      final wsBase = ApiService.baseUrl.replaceFirst('http', 'ws');
      final wsUrl =
          '$wsBase/chat'; // Reutilizamos el endpoint configurado en index.js
      _wsChannel =
          web_socket_channel.WebSocketChannel.connect(Uri.parse(wsUrl));

      // A360-2026-09-22/C-04: primero se registra la conexión con el token JWT; el
      // servidor sólo deja unirse a la sala de una reserva en la que participes.
      final token = await AuthService.getToken();
      if (token == null || token.isEmpty) {
        debugPrint(
            'WS tracking: sin token, no se registra ni se une a la sala');
        return;
      }
      _wsChannel!.sink.add(jsonEncode({'type': 'register', 'token': token}));

      // Unirse a la sala de la reserva
      final bookingId = widget.booking['id']?.toString();
      if (bookingId != null) {
        _wsChannel!.sink.add(jsonEncode({
          'type': 'join_booking_room',
          'bookingId': bookingId,
          'role': 'client'
        }));
      }

      _wsChannel!.stream.listen((message) {
        try {
          final data = jsonDecode(message);
          if (data['type'] == 'location_received' &&
              data['latitude'] != null &&
              data['longitude'] != null) {
            final latitude = double.tryParse(data['latitude'].toString());
            final longitude = double.tryParse(data['longitude'].toString());
            if (latitude != null &&
                longitude != null &&
                latitude.isFinite &&
                longitude.isFinite &&
                latitude >= -90 &&
                latitude <= 90 &&
                longitude >= -180 &&
                longitude <= 180 &&
                mounted) {
              setState(() {
                _usingRealGPS = true;
                _providerLoc = LatLng(latitude, longitude);
                _ultimaUbicacionAt = DateTime.now();
              });
            }
          }
        } catch (_) {}
      }, onError: (_) => _marcarSinUbicacion(),
          onDone: _marcarSinUbicacion);
    } catch (_) {
      _marcarSinUbicacion();
    }
  }

  void _marcarSinUbicacion() {
    if (!mounted) return;
    setState(() {
      _usingRealGPS = false;
      _providerLoc = null;
      _ultimaUbicacionAt = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final String providerName =
        widget.booking['provider_name'] ?? 'Profesional';
    final String providerBusiness =
        widget.booking['provider_business_name'] ?? 'Studio Profesional';
    final String providerAvatar = widget.booking['provider_avatar_url'] ?? '';
    final String providerId = widget.booking['provider_id']?.toString() ?? '';

    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
        title: const Text(
          'Concierge en Camino',
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
              onTap: () => Navigator.pop(context),
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
                      color: Colors.black.withValues(alpha: 0.04),
                      blurRadius: 6,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: const Icon(Icons.arrow_back_ios_new_rounded,
                    size: 15, color: Color(0xFF1F1A15)),
              ),
            ),
          ),
        ),
      ),
      body: Stack(
        children: [
          // Sin coordenadas reales solo mostramos el estado de conexión.
          if (_providerLoc == null)
            Container(
              color: const Color(0xFFFAF8F5),
              alignment: Alignment.center,
              padding: const EdgeInsets.all(32),
              child: const Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.location_searching,
                      size: 48, color: Color(0xFFC5A052)),
                  SizedBox(height: 12),
                  Text(
                    'Aún no recibimos la ubicación en vivo del prestador.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Color(0xFF6B625A), fontSize: 15),
                  ),
                  SizedBox(height: 6),
                  Text(
                    'Te mostraremos el mapa cuando esté disponible.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Color(0xFF8A7F72), fontSize: 13),
                  ),
                ],
              ),
            )
          else
            FlutterMap(
              options: MapOptions(
                initialCenter: _providerLoc!,
                initialZoom: 15,
              ),
              children: [
                TileLayer(
                  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                  userAgentPackageName: 'com.beautyapp.map',
                ),
                MarkerLayer(
                  markers: [
                    Marker(
                      width: 100,
                      height: 100,
                      point: _providerLoc!,
                      child: AnimatedBuilder(
                        animation: _pulseController,
                        builder: (context, child) => Stack(
                          alignment: Alignment.center,
                          children: [
                            Opacity(
                              opacity: (1 - _pulseController.value)
                                  .clamp(0.0, 1.0),
                              child: Container(
                                width: 35 + (_pulseController.value * 55),
                                height: 35 + (_pulseController.value * 55),
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: const Color(0xFFC5A052)
                                      .withValues(alpha: 0.35),
                                ),
                              ),
                            ),
                            child!,
                          ],
                        ),
                        child: Container(
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(
                                color: const Color(0xFFC5A052), width: 2.5),
                            boxShadow: AppTheme.softShadow,
                          ),
                          child: CircleAvatar(
                            radius: 18,
                            backgroundColor: const Color(0xFFC5A052)
                                .withValues(alpha: 0.2),
                            backgroundImage: providerAvatar.isNotEmpty
                                ? NetworkImage(providerAvatar)
                                : null,
                            child: providerAvatar.isEmpty
                                ? const Icon(Icons.face_retouching_natural,
                                    size: 18, color: Color(0xFFC5A052))
                                : null,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),

          // Botón Tema de Mapa (Claro/Oscuro Limpio)
          if (_providerLoc != null)
            Positioned(
              right: 20,
              bottom: 380,
              child: FloatingActionButton(
              heroTag: 'map_theme_tracking_fab',
              onPressed: () {
                setState(() {
                  MapSettings.isDark = !MapSettings.isDark;
                });
              },
              backgroundColor: Colors.white,
              foregroundColor: const Color(0xFFC5A052),
              tooltip: 'Cambiar tema del mapa',
              child: const Icon(Icons.brightness_6),
              ),
            ),

          // Botón flotante para chatear fácilmente
          if (providerId.isNotEmpty)
            Positioned(
              right: 20,
              bottom: 315,
              child: FloatingActionButton(
              heroTag: 'chat_tracking_fab',
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => ChatScreen(
                      partnerId: providerId,
                      partnerName: providerBusiness,
                      partnerRole: 'provider',
                      partnerAvatar: providerAvatar,
                    ),
                  ),
                );
              },
              backgroundColor: const Color(0xFFC5A052),
              foregroundColor: Colors.white,
              elevation: 6,
              shape: const CircleBorder(),
              child: const Icon(Icons.chat_bubble_rounded, size: 24),
              ),
            ),

          // 3. Capa Inferior: Bottom Status Card (Glassmorphic Redesign with Integrated Escrow PIN)
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
                    filter: ImageFilter.blur(sigmaX: 10.0, sigmaY: 10.0),
                    child: Container(
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.85),
                        borderRadius: BorderRadius.circular(28),
                        border: Border.all(
                            color: const Color(0xFFC5A052).withValues(alpha: 0.2),
                            width: 1.5),
                        boxShadow: AppTheme.cardShadow,
                      ),
                      child: Padding(
                        padding: const EdgeInsets.all(20),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                CircleAvatar(
                                  radius: 26,
                                  backgroundColor:
                                      const Color(0xFFC5A052).withValues(alpha: 0.2),
                                  backgroundImage: providerAvatar.isNotEmpty
                                      ? NetworkImage(providerAvatar)
                                      : null,
                                  child: providerAvatar.isEmpty
                                      ? Text(
                                          providerName.isNotEmpty
                                              ? providerName[0].toUpperCase()
                                              : 'P',
                                          style: const TextStyle(
                                              fontSize: 18,
                                              color: const Color(0xFF8A6A2F),
                                              fontWeight: FontWeight.bold),
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
                                        providerBusiness.isNotEmpty
                                            ? providerBusiness
                                            : providerName,
                                        style: const TextStyle(
                                            fontWeight: FontWeight.bold,
                                            fontSize: 16,
                                            color: Colors.black87),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        providerName,
                                        style: const TextStyle(
                                            fontSize: 13,
                                            color: Colors.black54),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Text(
                              _usingRealGPS
                                  ? 'Ubicación en vivo del prestador'
                                  : 'Esperando ubicación en vivo del prestador',
                              style: TextStyle(
                                fontSize: 13,
                                color: _usingRealGPS
                                    ? const Color(0xFF4A5D4E)
                                    : const Color(0xFF8A7F72),
                              ),
                            ),

                            const Divider(height: 24, color: Color(0xFFF3EAE8)),

                            // Escrow PIN integrado de manera limpia
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 14, vertical: 10),
                              decoration: BoxDecoration(
                                color:
                                    const Color(0xFFC5A052).withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(20),
                                border: Border.all(
                                    color: const Color(0xFFC5A052)
                                        .withValues(alpha: 0.15)),
                              ),
                              child: Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  // Flexible + ellipsis: la fila desbordaba 92 px
                                  // en anchos medios (el test de ruta lo destapo)
                                  // y el aviso quedaba cortado.
                                  const Flexible(
                                    child: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Icon(Icons.vpn_key_rounded,
                                            color: Color(0xFFC5A052),
                                            size: 18),
                                        SizedBox(width: 8),
                                        Flexible(
                                          child: Text(
                                            'Código de confirmación:',
                                            overflow: TextOverflow.ellipsis,
                                            style: TextStyle(
                                                fontSize: 12,
                                                fontWeight: FontWeight.bold,
                                                color: Colors.black87),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  // El código se genera al terminar el servicio y
                                  // se envía por correo: no existe antes, así que
                                  // pintarlo aquí mostraba un valor que el backend
                                  // no acepta.
                                  const Flexible(
                                    child: Text(
                                      'Te lo enviamos por correo',
                                      textAlign: TextAlign.end,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        fontSize: 13,
                                        fontWeight: FontWeight.bold,
                                        color: Color(0xFF881337),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),

                            const SizedBox(height: 12),

                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                // Wompi Badge
                                Row(
                                  children: [
                                    Icon(Icons.shield,
                                        color: const Color(0xFF4A5D4E),
                                        size: 18),
                                    SizedBox(width: 6),
                                    Text(
                                      'Pago Wompi Protegido',
                                      style: TextStyle(
                                          color: const Color(0xFF4A5D4E),
                                          fontSize: 12,
                                          fontWeight: FontWeight.bold),
                                    ),
                                  ],
                                ),
                                Text(
                                  _usingRealGPS ? 'Ubicación actualizada' : 'Sin GPS en vivo',
                                  style: TextStyle(
                                      color: const Color(0xFF8A6A2F),
                                      fontSize: 12,
                                      fontWeight: FontWeight.bold),
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
