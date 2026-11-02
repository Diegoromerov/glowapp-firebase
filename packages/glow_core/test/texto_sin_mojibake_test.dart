// El sheet de pago llegó del monolito con la codificación rota: los textos que
// ve el usuario decían "tokenizaciÃ³n", "CÃ³digo". La regla es simple: en lib/ no
// debe quedar ni un Ã ni un Â, porque siempre son UTF-8 leído como latin-1.
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('ningún archivo .dart de lib/ contiene mojibake', () {
    final conProblemas = <String>[];

    for (final f in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!f.path.endsWith('.dart')) continue;
      final n = RegExp(r'[ÃÂ]').allMatches(f.readAsStringSync()).length;
      if (n > 0) conProblemas.add('${f.path}: $n');
    }

    expect(conProblemas, isEmpty);
  });
}
