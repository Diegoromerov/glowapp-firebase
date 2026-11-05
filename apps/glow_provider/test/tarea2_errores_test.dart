// Invariante de robustez: ningún mensaje de error crudo puede llegar a la UI.
//
// El problema real no era solo el `Text('$e')` visible: había 37 sitios donde
// el texto se guardaba en `_error` y se pintaba dos capas más abajo, así que
// un grep de `Text(` no los veía. Este test recorre todo `lib/` y falla si
// aparece una interpolación de la excepción sin pasar por `mensajeHumano`.
//
// Quedan fuera a propósito: `debugPrint`, `print` y comentarios (no llegan al
// usuario), y `$error`/`$expiracion` (la expresión regular exige límite de
// palabra para no confundirlos con `$e`).
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glow_core.dart' show mensajeHumano;

void main() {
  test('ninguna excepción cruda se interpola en la UI', () {
    // Tres formas de filtrar el objeto de la excepción a la pantalla:
    //   1. `'... $e'` en un Text/SnackBar o guardado en _error.
    //   2. `_error = e.toString()` → se pinta tal cual.
    //   3. `'${e.toString()}'` dentro de un literal.
    final patrones = <RegExp>[
      RegExp(r'\$e\b'),
      RegExp(r'(_error|_errorMessage)\s*=\s*e\.toString\(\)'),
      RegExp(r'\$\{e\.toString\(\)\}'),
    ];
    final faltas = <String>[];

    for (final f in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!f.path.endsWith('.dart')) continue;
      final lineas = f.readAsLinesSync();
      for (var i = 0; i < lineas.length; i++) {
        final l = lineas[i];
        if (!patrones.any((p) => p.hasMatch(l))) continue;
        if (l.contains('mensajeHumano')) continue;
        if (l.contains('debugPrint') || l.contains('print(')) continue;
        if (l.trimLeft().startsWith('//')) continue;
        faltas.add('${f.path}:${i + 1} → ${l.trim()}');
      }
    }

    expect(
      faltas,
      isEmpty,
      reason: 'Usa mensajeHumano(e) en lugar de interpolar la excepción. Sitios:\n${faltas.join('\n')}',
    );
  });

  test('mensajeHumano traduce los fallos que ve el prestador', () {
    // Contrato mínimo: nunca devuelve el texto técnico tal cual ni una cadena
    // vacía. Si esto cambia en glow_core, el prestador vuelve a mostrar stacks.
    final casos = <String>[
      'SocketException: Failed host lookup',
      'Exception: 500 Internal Server Error',
      'TimeoutException after 0:00:15.000000',
      'Exception: 401 Token inválido',
    ];
    for (final c in casos) {
      final salida = mensajeHumano(Exception(c));
      expect(salida.trim(), isNotEmpty, reason: 'vacío para: $c');
      expect(salida.contains('SocketException'), isFalse, reason: 'crudo: $salida');
      expect(salida.contains('TimeoutException'), isFalse, reason: 'crudo: $salida');
    }
  });
}
