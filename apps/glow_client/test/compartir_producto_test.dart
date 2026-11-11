// Compartir un producto de GlowShop: enlace con tarjeta y registro (PRODUCT).
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:share_plus/share_plus.dart';

import 'package:glow_core/glow_core.dart';

const _base = 'https://glowapp-api-production.up.railway.app';

void main() {
  test('el enlace apunta a la página del producto', () {
    expect(
      enlaceProducto(baseUrl: _base, productId: '7'),
      'https://glowapp-api-production.up.railway.app/s/product/7',
    );
    expect(
      enlaceProducto(baseUrl: '$_base/', productId: '7'),
      'https://glowapp-api-production.up.railway.app/s/product/7',
    );
  });

  test('al compartir se registra como PRODUCT y se devuelve el XP real', () async {
    String? texto;
    String? registrado;

    final r = await compartirProducto(
      productId: '7',
      baseUrl: _base,
      nombre: 'Sérum Vitamina C',
      compartir: (t) async {
        texto = t;
        return ShareResultStatus.success;
      },
      registrar: (id) async {
        registrado = id;
        return {'success': true, 'xp_awarded': 50};
      },
    );

    expect(r.compartido, isTrue);
    expect(r.xpGanado, 50);
    expect(registrado, '7');
    expect(texto, contains('/s/product/7'));
    expect(texto, contains('Sérum Vitamina C'));
  });

  test('si cierra la hoja no se registra nada', () async {
    var registros = 0;
    final r = await compartirProducto(
      productId: '7',
      baseUrl: _base,
      compartir: (_) async => ShareResultStatus.dismissed,
      registrar: (_) async {
        registros++;
        return {'xp_awarded': 50};
      },
    );
    expect(r.compartido, isFalse);
    expect(registros, 0);
  });

  test('la ficha rápida del producto tiene el botón y usa el helper', () {
    // El cwd de `flutter test` es la carpeta de la app: glow_core está dos
    // niveles arriba.
    final src = File(
            '../../packages/glow_core/lib/src/widgets/product_quick_view_dialog.dart')
        .readAsStringSync();
    expect(src, contains('compartirProducto'));
    expect(src, contains("tooltip: 'Compartir producto'"));
  });

  test('Mis Citas comparte la ficha al terminar el servicio', () {
    final src = File('lib/screens/client_bookings_screen.dart').readAsStringSync();
    expect(src, contains('_compartirCita'));
    expect(src, contains('Compartir mi look'));
    // Sólo cuando el servicio ya ocurrió: compartir una cita pendiente no tiene
    // nada que recomendar.
    expect(src, contains('if (yaOcurrio && !esCancelada)'));
  });
}
