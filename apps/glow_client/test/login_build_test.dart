// Diagnóstico temporal: reproducir en test el fallo de la pantalla de login
// (null check operator) para obtener la línea exacta en vez del bundle minificado.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glow_core.dart';

import 'package:glow_client/screens/auth/login_screen.dart';

void main() {
  testWidgets('login se construye sin lanzar', (tester) async {
    await tester.binding.setSurfaceSize(const Size(420, 900));
    await tester.pumpWidget(const MaterialApp(
      home: LoginScreen(),
    ));
    await tester.pump(const Duration(milliseconds: 300));
    expect(tester.takeException(), isNull);
  });
}
