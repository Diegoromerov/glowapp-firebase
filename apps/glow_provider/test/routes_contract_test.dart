// Guarda contra rutas muertas en glow_provider: un `pushNamed('/x')` cuyo
// destino no está registrado en main.dart no avisa de nada, simplemente
// no navega.
//
// Se leen las dos formas de registro que usa main.dart: el mapa
// `routes: {...}` y los `case` del `switch` de onGenerateRoute.
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

// Sin excepciones: una ruta referenciada que no existe es un botón muerto.
// Si en el futuro aparece una, se arregla o se registra; no se excusa aquí.
const pendientesProvider = <String>{};

void main() {
  test('toda ruta referenciada en provider tiene destino registrado', () {
    final mainDart = File('lib/main.dart').readAsStringSync();

    final registradas = <String>{
      ...RegExp(r"'([/A-Za-z0-9_/\\-]+)'\s*:").allMatches(mainDart).map((m) => m.group(1)!),
      ...RegExp(r"case\s+'([/A-Za-z0-9_/\\-]+)'").allMatches(mainDart).map((m) => m.group(1)!),
    };

    final referidas = <String, List<String>>{};
    final patron = RegExp(
        r"(?:pushNamed|pushReplacementNamed|pushNamedAndRemoveUntil)\(\s*(?:context\s*,\s*)?'([/A-Za-z0-9_/\\-]+)'");

    for (final f in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!f.path.endsWith('.dart')) continue;
      for (final m in patron.allMatches(f.readAsStringSync())) {
        referidas.putIfAbsent(m.group(1)!, () => []).add(f.path);
      }
    }

    final muertas = referidas.entries
        .where((e) => !registradas.contains(e.key))
        .where((e) => !pendientesProvider.contains(e.key))
        .map((e) => '${e.key} → ${e.value.join(', ')}')
        .toList();

    expect(muertas, isEmpty);
  });

  test('las rutas pendientes de provider siguen siendo las esperadas', () {
    final textos = Directory('lib')
        .listSync(recursive: true)
        .whereType<File>()
        .where((f) => f.path.endsWith('.dart'))
        .map((f) => f.readAsStringSync())
        .join('\n');

    for (final ruta in pendientesProvider) {
      expect(textos.contains("'$ruta'"), isTrue,
          reason: 'si $ruta ya no se usa, quitar la excepción de este test');
    }
  });
}