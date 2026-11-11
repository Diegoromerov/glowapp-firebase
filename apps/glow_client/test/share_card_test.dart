// Tarjeta 9:16 para publicar el resultado en TikTok / Instagram.
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:glow_core/glow_core.dart';

Widget _enmarcada(Widget hijo, GlobalKey? llave) => MaterialApp(
      home: Scaffold(
        body: Center(
          child: SizedBox(
            // Sólo se fija el ancho: la altura la decide la tarjeta. Si se fija
            // también la altura, el AspectRatio obedece a la caja y el 9:16 no
            // se está probando.
            width: anchoLogicoTarjeta,
            child: llave == null
                ? hijo
                : RepaintBoundary(key: llave, child: hijo),
          ),
        ),
      ),
    );

/// `setSurfaceSize` sólo se puede llamar dentro de un test: la superficie por
/// defecto (800x600) no da para una tarjeta de 640 de alto.
Future<void> _superficieAlta(WidgetTester tester) async {
  await tester.binding.setSurfaceSize(const Size(400, 1000));
  addTearDown(() => tester.binding.setSurfaceSize(null));
}

void main() {
  testWidgets('la tarjeta es vertical 9:16', (tester) async {
    await _superficieAlta(tester);
    await tester.pumpWidget(_enmarcada(
      const ShareCard(titulo: 'Palette DNA', subtitulo: 'Otoño cálido'),
      null,
    ));
    await tester.pump();

    final caja = tester.getSize(find.byType(ShareCard));
    expect(caja.width / caja.height, closeTo(9 / 16, 0.01),
        reason: 'una historia es 9:16; otra relación se recorta al publicar');
    expect(caja.height, closeTo(anchoLogicoTarjeta / (9 / 16), 1),
        reason: 'con 360 de ancho la tarjeta debe medir 640 de alto');
  });

  testWidgets('lleva marca, título, líneas y pie', (tester) async {
    await _superficieAlta(tester);
    await tester.pumpWidget(_enmarcada(
      const ShareCard(
        titulo: 'Palette DNA',
        subtitulo: 'Otoño cálido · subtono dorado',
        lineas: ['Base: marfil', 'Labios: terracota'],
      ),
      null,
    ));
    await tester.pump();

    expect(find.text('GLOWAPP'), findsOneWidget);
    expect(find.text('Palette DNA'), findsOneWidget);
    expect(find.text('Base: marfil'), findsOneWidget);
    expect(find.text('glowapp-client.web.app'), findsOneWidget);
  });

  testWidgets('exportar produce un PNG de 1080x1920', (tester) async {
    await _superficieAlta(tester);
    final llave = GlobalKey();
    await tester.pumpWidget(_enmarcada(
      const ShareCard(titulo: 'Palette DNA'),
      llave,
    ));
    await tester.pumpAndSettle();

    Uint8List? png;
    int? ancho;
    int? alto;
    await tester.runAsync(() async {
      png = await exportarTarjetaPng(llave, pixelRatio: 3);
      if (png != null) {
        final codec = await ui.instantiateImageCodec(png!);
        final frame = await codec.getNextFrame();
        ancho = frame.image.width;
        alto = frame.image.height;
        frame.image.dispose();
      }
    });

    expect(png, isNotNull, reason: 'sin bytes no hay nada que compartir');
    // Firma PNG: la imagen no puede ser basura.
    expect(png!.sublist(0, 4), [0x89, 0x50, 0x4E, 0x47]);
    expect(ancho, 1080);
    expect(alto, 1920);
  });
}
