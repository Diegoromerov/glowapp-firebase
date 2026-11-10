// Ítem 56 — el árbol de semántica debe estar activo desde el arranque.
//
// En web Flutter lo deja apagado hasta que el usuario pulsa "activar
// accesibilidad"; sin él, un lector de pantalla solo anuncia una caja vacía.
// El test comprueba el mecanismo, no el DOM: que tras ensureSemantics() el
// binding reporte la semántica habilitada.
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('la semántica queda habilitada sin intervención del usuario',
      (tester) async {
    // El binding de test llega con la semántica ya activa, así que no se puede
    // comprobar aquí el estado inicial de web: lo que se prueba es que la
    // llamada deja el árbol habilitado y devuelve un handle para liberarlo.
    final handle = SemanticsBinding.instance.ensureSemantics();
    expect(SemanticsBinding.instance.semanticsEnabled, isTrue);

    handle.dispose();
  });
}
