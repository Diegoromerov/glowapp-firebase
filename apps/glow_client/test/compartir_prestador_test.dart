// Compartir la ficha de un prestador: enlace con tarjeta, registro y XP real.
// Incluye el id público que usa la app del proveedor para compartir su ficha.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:share_plus/share_plus.dart';

import 'package:glow_core/glow_core.dart';

const _base = 'https://glowapp-api-production.up.railway.app';

String _tokenCon(Map<String, dynamic> payload) {
  final b64 = base64Url.encode(utf8.encode(json.encode(payload))).replaceAll('=', '');
  return 'cabecera.$b64.firma';
}

void main() {
  test('si el usuario comparte, se registra y se devuelve el XP del backend', () async {
    String? textoCompartido;
    String? idRegistrado;

    final r = await compartirPrestador(
      providerId: '3',
      baseUrl: _base,
      nombre: 'Carla Makeup Studio',
      compartir: (texto) async {
        textoCompartido = texto;
        return ShareResultStatus.success;
      },
      registrar: (id) async {
        idRegistrado = id;
        return {'success': true, 'xp_awarded': 50, 'duplicate': false};
      },
    );

    expect(r.compartido, isTrue);
    expect(r.xpGanado, 50);
    expect(idRegistrado, '3');
    expect(textoCompartido, contains('/s/provider/3'));
    expect(textoCompartido, contains('Carla Makeup Studio'));
  });

  test('si el usuario cierra la hoja, no se registra nada', () async {
    var registroLlamado = false;

    final r = await compartirPrestador(
      providerId: '3',
      baseUrl: _base,
      compartir: (_) async => ShareResultStatus.dismissed,
      registrar: (_) async {
        registroLlamado = true;
        return {'xp_awarded': 50};
      },
    );

    expect(r.compartido, isFalse);
    expect(r.xpGanado, 0);
    expect(registroLlamado, isFalse);
  });

  test('si el registro falla, el share vale pero el XP es 0 (no se inventa)', () async {
    final r = await compartirPrestador(
      providerId: '3',
      baseUrl: _base,
      compartir: (_) async => ShareResultStatus.success,
      registrar: (_) async => throw Exception('sin red'),
    );

    expect(r.compartido, isTrue);
    expect(r.xpGanado, 0);
  });

  test('un id vacío no abre la hoja ni registra', () async {
    var abierta = false;

    final r = await compartirPrestador(
      providerId: '  ',
      baseUrl: _base,
      compartir: (_) async {
        abierta = true;
        return ShareResultStatus.success;
      },
      registrar: (_) async => {'xp_awarded': 50},
    );

    expect(r.compartido, isFalse);
    expect(abierta, isFalse);
  });

  test('repetido el mismo día el backend devuelve 0 XP y no se anuncia otro', () async {
    final r = await compartirPrestador(
      providerId: '3',
      baseUrl: _base,
      compartir: (_) async => ShareResultStatus.success,
      registrar: (_) async => {'success': true, 'duplicate': true, 'xp_awarded': 0},
    );

    expect(r.compartido, isTrue);
    expect(r.xpGanado, 0);
  });

  group('id público del prestador desde el token', () {
    test('usa el id del payload', () {
      expect(idPublicoDelToken(_tokenCon({'id': 7, 'email': 'a@b.c'})), '7');
    });

    test('acepta userId y sub como alias', () {
      expect(idPublicoDelToken(_tokenCon({'userId': '12'})), '12');
      expect(idPublicoDelToken(_tokenCon({'sub': '34'})), '34');
    });

    test('sin id no inventa uno', () {
      expect(idPublicoDelToken(_tokenCon({'email': 'a@b.c'})), isNull);
      expect(idPublicoDelToken(null), isNull);
      expect(idPublicoDelToken('no-es-un-token'), isNull);
    });
  });
}
