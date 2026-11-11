// Tarjeta 9:16 para compartir resultados en TikTok / Instagram.
//
// Por qué una tarjeta y no una captura de la pantalla: la pantalla del pasaporte
// es una columna desplazable; lo que se publica tiene que ser una pieza cuadrada
// con la marca, no un recorte con la barra del sistema. 9:16 es la relación de
// una historia, el formato donde de verdad se comparte.
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import '../core/theme/tokens.dart';

/// Relación de aspecto de la tarjeta (historia vertical).
const double relacionTarjetaCompartir = 9 / 16;

/// Ancho lógico de referencia. Con `pixelRatio` 3 la imagen sale 1080×1920.
const double anchoLogicoTarjeta = 360;

/// Pieza vertical con la marca, un título y líneas de resultado.
class ShareCard extends StatelessWidget {
  final String titulo;
  final String? subtitulo;
  final List<String> lineas;
  final String? imagenUrl;
  final String marca;
  final String pie;

  const ShareCard({
    super.key,
    required this.titulo,
    this.subtitulo,
    this.lineas = const [],
    this.imagenUrl,
    this.marca = 'GlowApp',
    this.pie = 'glowapp-client.web.app',
  });

  @override
  Widget build(BuildContext context) {
    final t = Token.light;
    return AspectRatio(
      aspectRatio: relacionTarjetaCompartir,
      child: Container(
        padding: const EdgeInsets.all(24),
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFF2C2420), Color(0xFF1F1A15)],
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.auto_awesome, size: 16, color: Color(0xFFD4AF37)),
                const SizedBox(width: 8),
                Text(
                  marca.toUpperCase(),
                  style: const TextStyle(
                    color: Color(0xFFD4AF37),
                    fontSize: 12,
                    letterSpacing: 2,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            if (imagenUrl != null)
              Expanded(
                flex: 5,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(18),
                  child: Image.network(
                    imagenUrl!,
                    fit: BoxFit.cover,
                    width: double.infinity,
                    errorBuilder: (_, __, ___) => Container(
                      color: t.surfaceLevel2,
                      alignment: Alignment.center,
                      child: const Icon(Icons.image_outlined,
                          color: Color(0xFFD4AF37), size: 32),
                    ),
                  ),
                ),
              ),
            if (imagenUrl != null) const SizedBox(height: 18),
            Text(
              titulo,
              style: const TextStyle(
                fontFamily: 'CormorantGaramond',
                color: Colors.white,
                fontSize: 26,
                height: 1.15,
                fontWeight: FontWeight.bold,
              ),
            ),
            if (subtitulo != null && subtitulo!.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                subtitulo!,
                style: const TextStyle(
                  color: Color(0xFFE8DFD8),
                  fontSize: 13,
                  height: 1.35,
                ),
              ),
            ],
            const SizedBox(height: 16),
            const Divider(color: Color(0x33D4AF37), height: 1),
            const SizedBox(height: 14),
            ...lineas.map((linea) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    linea,
                    style: const TextStyle(
                      color: Color(0xFFF4EFEA),
                      fontSize: 12,
                      height: 1.4,
                    ),
                  ),
                )),
            const Spacer(),
            Text(
              pie,
              style: const TextStyle(
                color: Color(0xFFB7A99A),
                fontSize: 10,
                letterSpacing: 1,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Exporta el widget capturado por [llave] a PNG.
///
/// Devuelve `null` si el árbol no está montado o el nodo no se ha pintado: no
/// se inventa una imagen vacía para que el share parezca exitoso.
Future<Uint8List?> exportarTarjetaPng(
  GlobalKey llave, {
  double pixelRatio = 3,
}) async {
  final contexto = llave.currentContext;
  if (contexto == null) return null;
  final nodo = contexto.findRenderObject();
  if (nodo is! RenderRepaintBoundary) return null;
  try {
    final imagen = await nodo.toImage(pixelRatio: pixelRatio);
    final bytes = await imagen.toByteData(format: ui.ImageByteFormat.png);
    imagen.dispose();
    return bytes?.buffer.asUint8List();
  } catch (error) {
    debugPrint('No se pudo exportar la tarjeta: $error');
    return null;
  }
}
