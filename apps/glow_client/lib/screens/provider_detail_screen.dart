// Detalle del prestador del lado cliente.
//
// Antes esta ruta era `_StubScreen('Detalle proveedor: ... / Pantalla en
// desarrollo')` aunque siete pantallas ya navegaban aquí y el backend llevaba
// tiempo sirviendo el dato completo (`GET /api/providers/:id` →
// provider + services + portfolio + reviews).
//
// El modelo de la ficha sigue al del seed histórico (`prestadores-demo-11.sql`,
// «Valeria Tobon Makeup»): foto, razón comercial, descripción, calificación,
// servicios con precio y duración, y portafolio.
import 'package:flutter/material.dart';

import 'package:glow_core/glow_core.dart';

class ProviderDetailScreen extends StatefulWidget {
  const ProviderDetailScreen({
    super.key,
    required this.providerId,
    this.nombreInicial,
    this.avatarInicial,
  });

  final String providerId;

  /// Datos que la pantalla anterior ya tenía: permiten pintar la cabecera al
  /// instante en vez de un esqueleto gris mientras llega la respuesta.
  final String? nombreInicial;
  final String? avatarInicial;

  @override
  State<ProviderDetailScreen> createState() => _ProviderDetailScreenState();
}

class _ProviderDetailScreenState extends State<ProviderDetailScreen> {
  bool _cargando = true;
  String? _error;
  Map<String, dynamic>? _detalle;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() {
      _cargando = true;
      _error = null;
    });
    try {
      final data = await ApiService.fetchProviderDetails(widget.providerId);
      if (!mounted) return;
      setState(() {
        _detalle = data;
        _cargando = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'No se pudo cargar el perfil. $e';
        _cargando = false;
      });
    }
  }

  Map<String, dynamic> get _perfil =>
      (_detalle?['provider'] as Map?)?.cast<String, dynamic>() ?? const {};

  List<Map<String, dynamic>> get _servicios =>
      ((_detalle?['services'] as List?) ?? const [])
          .map((e) => (e as Map).cast<String, dynamic>())
          .toList();

  List<Map<String, dynamic>> get _portafolio =>
      ((_detalle?['portfolio'] as List?) ?? const [])
          .map((e) => (e as Map).cast<String, dynamic>())
          .toList();

  List<Map<String, dynamic>> get _resenas =>
      ((_detalle?['reviews'] as List?) ?? const [])
          .map((e) => (e as Map).cast<String, dynamic>())
          .toList();

  String get _negocio {
    final b = (_perfil['business_name'] ?? '').toString().trim();
    if (b.isNotEmpty) return b;
    return (_perfil['full_name'] ?? widget.nombreInicial ?? 'Prestador').toString();
  }

  String get _avatar {
    final a = (_perfil['avatar_url'] ?? '').toString().trim();
    return a.isNotEmpty ? a : (widget.avatarInicial ?? '');
  }

  static String _cop(dynamic valor) {
    final numero = double.tryParse(valor?.toString() ?? '') ?? 0;
    final entero = numero.round().toString();
    final buffer = StringBuffer();
    for (var i = 0; i < entero.length; i++) {
      if (i > 0 && (entero.length - i) % 3 == 0) buffer.write('.');
      buffer.write(entero[i]);
    }
    return '\$${buffer.toString()}';
  }

  static String _estrellas(dynamic valor) {
    final r = (double.tryParse(valor?.toString() ?? '') ?? 0);
    final llenas = r.round().clamp(0, 5);
    return '★' * llenas + '☆' * (5 - llenas);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF121212),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        foregroundColor: Colors.white,
        title: Text(
          _cargando ? 'Perfil' : _negocio,
          style: const TextStyle(
            fontFamily: 'CormorantGaramond',
            fontSize: 20,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      body: _cargando
          ? const Center(child: CircularProgressIndicator(strokeWidth: 2))
          : _error != null
              ? _buildError()
              : _buildContenido(),
    );
  }

  Widget _buildError() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off_outlined, color: Color(0xFFBDBDBD), size: 36),
            const SizedBox(height: 12),
            Text(
              _error!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFFBDBDBD), height: 1.4),
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: _cargar,
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFFE8C4B8),
                side: const BorderSide(color: Color(0xFFE8C4B8)),
              ),
              child: const Text('Reintentar'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildContenido() {
    return RefreshIndicator(
      onRefresh: _cargar,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          _buildCabecera(),
          const SizedBox(height: 22),
          _seccion('Servicios', _buildServicios()),
          if (_portafolio.isNotEmpty) ...[
            const SizedBox(height: 22),
            _seccion('Portafolio', _buildPortafolio()),
          ],
          const SizedBox(height: 22),
          _seccion('Reseñas', _buildResenas()),
        ],
      ),
    );
  }

  Widget _buildCabecera() {
    final nombre = (_perfil['full_name'] ?? widget.nombreInicial ?? '').toString();
    final verificado = _perfil['is_verified'] == true;
    final rating = _perfil['rating_avg'];
    final votos = _perfil['rating_count'] ?? 0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipOval(
              child: SizedBox(
                width: 76,
                height: 76,
                child: _avatar.isEmpty
                    ? const ColoredBox(
                        color: Color(0xFF2A2A2A),
                        child: Icon(Icons.person, color: Color(0xFF8A8A8A), size: 34),
                      )
                    : Image.network(
                        _avatar,
                        fit: BoxFit.cover,
                        // Una foto que no carga no puede reventar la ficha.
                        errorBuilder: (_, __, ___) => const ColoredBox(
                          color: Color(0xFF2A2A2A),
                          child: Icon(Icons.person, color: Color(0xFF8A8A8A), size: 34),
                        ),
                      ),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _negocio,
                    style: const TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontSize: 22,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                  if (nombre.isNotEmpty && nombre != _negocio)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        nombre,
                        style: const TextStyle(color: Color(0xFFBDBDBD), fontSize: 13),
                      ),
                    ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Text(
                        _estrellas(rating),
                        style: const TextStyle(color: Color(0xFFE8C4B8), fontSize: 13),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        '${(double.tryParse(rating?.toString() ?? '') ?? 0).toStringAsFixed(1)} '
                        '($votos)',
                        style: const TextStyle(color: Color(0xFF8A8A8A), fontSize: 12),
                      ),
                    ],
                  ),
                  if (verificado)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: const Color(0xFF1E3A2F),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.verified, size: 13, color: Color(0xFF7FD1A6)),
                            SizedBox(width: 4),
                            Text(
                              'Verificado',
                              style: TextStyle(color: Color(0xFF7FD1A6), fontSize: 11),
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
        if ((_perfil['description'] ?? '').toString().trim().isNotEmpty) ...[
          const SizedBox(height: 14),
          Text(
            _perfil['description'].toString(),
            style: const TextStyle(color: Color(0xFFCFCFCF), fontSize: 13.5, height: 1.5),
          ),
        ],
      ],
    );
  }

  Widget _seccion(String titulo, Widget hijo) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          titulo.toUpperCase(),
          style: const TextStyle(
            color: Color(0xFF8A8A8A),
            fontSize: 11,
            letterSpacing: 1.4,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 10),
        hijo,
      ],
    );
  }

  Widget _buildServicios() {
    if (_servicios.isEmpty) {
      return const Text(
        'Este prestador aún no ha publicado servicios.',
        style: TextStyle(color: Color(0xFF8A8A8A), fontSize: 13),
      );
    }
    return Column(
      children: _servicios.map((s) {
        final duracion = s['duration_minutes'] ?? 0;
        final categoria = (s['category'] ?? '').toString();
        return Container(
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xFF1C1C1C),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: const Color(0xFF2A2A2A)),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      s['name'].toString(),
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 14.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if ((s['description'] ?? '').toString().trim().isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 3),
                        child: Text(
                          s['description'].toString(),
                          style: const TextStyle(color: Color(0xFF9A9A9A), fontSize: 12),
                        ),
                      ),
                    const SizedBox(height: 6),
                    Text(
                      '${duracion.toString()} min'
                      '${categoria.isEmpty ? '' : ' · $categoria'}',
                      style: const TextStyle(color: Color(0xFF8A8A8A), fontSize: 11.5),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    _cop(s['price']),
                    style: const TextStyle(
                      color: Color(0xFFE8C4B8),
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 6),
                  TextButton(
                    onPressed: () => _reservar(s),
                    style: TextButton.styleFrom(
                      backgroundColor: const Color(0xFFE8C4B8),
                      foregroundColor: const Color(0xFF121212),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                      minimumSize: Size.zero,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(20),
                      ),
                    ),
                    child: const Text('Reservar', style: TextStyle(fontSize: 12)),
                  ),
                ],
              ),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _buildPortafolio() {
    return SizedBox(
      height: 128,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: _portafolio.length,
        separatorBuilder: (_, __) => const SizedBox(width: 10),
        itemBuilder: (_, i) {
          final item = _portafolio[i];
          return ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: SizedBox(
              width: 128,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  Image.network(
                    item['image_url'].toString(),
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) =>
                        const ColoredBox(color: Color(0xFF2A2A2A)),
                  ),
                  if ((item['title'] ?? '').toString().isNotEmpty)
                    Positioned(
                      left: 0,
                      right: 0,
                      bottom: 0,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                        color: Colors.black.withValues(alpha: 0.55),
                        child: Text(
                          item['title'].toString(),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: Colors.white, fontSize: 10.5),
                        ),
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

  Widget _buildResenas() {
    if (_resenas.isEmpty) {
      return const Text(
        'Todavía no hay reseñas de este prestador.',
        style: TextStyle(color: Color(0xFF8A8A8A), fontSize: 13),
      );
    }
    return Column(
      children: _resenas.map((r) {
        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _estrellas(r['rating']),
                style: const TextStyle(color: Color(0xFFE8C4B8), fontSize: 12),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      (r['comment'] ?? '').toString(),
                      style: const TextStyle(color: Color(0xFFCFCFCF), fontSize: 13, height: 1.4),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      (r['client_name'] ?? 'Cliente').toString(),
                      style: const TextStyle(color: Color(0xFF7A7A7A), fontSize: 11),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }

  void _reservar(Map<String, dynamic> servicio) {
    Navigator.pushNamed(
      context,
      '/booking',
      arguments: {
        'providerId': widget.providerId,
        'providerName': _negocio,
        'serviceId': servicio['id'],
        'serviceName': servicio['name'],
        'servicePrice': servicio['price'],
        'serviceDuration': servicio['duration_minutes'],
      },
    );
  }
}
