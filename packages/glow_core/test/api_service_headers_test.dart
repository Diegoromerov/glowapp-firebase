// Invariante: toda llamada HTTP del ApiService lleva cabeceras.
//
// El backend exige `X-App-Audience` en todo `/api`, asi que una llamada sin
// cabeceras no llega al handler y responde 400. Esto ya paso dos veces:
// `fetchProvidersSecured` (los prestadores no cargaban) y `fetchProviderDetails`
// (el perfil del prestador decia «Error 400»).
//
// El defecto se lee por sentencia, no por linea: en este archivo las llamadas
// se escriben como `await http\n  .get(...)`, y una revision linea a linea las
// saltaria justo a ellas.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Sentencias que usan `http.<metodo>(`, con su linea de inicio aproximada.
List<MapEntry<int, String>> _sentenciasHttp(String fuente) {
  final resultado = <MapEntry<int, String>>[];
  var inicio = 0;
  for (var i = 0; i < fuente.length; i++) {
    if (fuente[i] != ';') continue;
    final sentencia = fuente.substring(inicio, i + 1);
    final linea = '\n'.allMatches(fuente.substring(0, inicio)).length + 1;
    if (RegExp(r'http\s*\.\s*(get|post|put|patch|delete)\s*\(').hasMatch(sentencia)) {
      resultado.add(MapEntry(linea, sentencia.trim()));
    }
    inicio = i + 1;
  }
  return resultado;
}

void main() {
  test('ninguna sentencia con http.* va sin headers', () {
    final archivo = File('lib/src/services/api_service.dart');
    expect(archivo.existsSync(), isTrue, reason: 'cambio la ruta del servicio');

    final fuente = archivo.readAsStringSync();
    final faltantes = <String>[];

    for (final entrada in _sentenciasHttp(fuente)) {
      final sentencia = entrada.value;
      // El sondeo de salud es la unica excepcion: no necesita audiencia y se
      // usa para saber si el host responde (un 400 ya prueba que si).
      if (sentencia.contains('/api/health')) continue;
      if (!sentencia.contains('headers:')) {
        final resumen = sentencia.replaceAll(RegExp(r'\s+'), ' ');
        faltantes.add('linea ~${entrada.key}: ${resumen.substring(0, resumen.length.clamp(0, 90))}');
      }
    }

    expect(
      faltantes,
      isEmpty,
      reason: 'estas llamadas responderian 400 por falta de X-App-Audience:\n'
          '${faltantes.join('\n')}',
    );
  });

  test('el detector ve tambien las llamadas multilinea (control positivo)', () {
    const muestra = '''
      final a = await http.get(Uri.parse('x'), headers: h);
      final b = await http
          .get(Uri.parse('y'));
    ''';
    final sentencias = _sentenciasHttp(muestra);
    expect(sentencias.length, 2, reason: 'debe ver la de una linea y la partida');
    expect(sentencias.first.value.contains('headers:'), isTrue);
    expect(sentencias.last.value.contains('headers:'), isFalse);
  });
}
