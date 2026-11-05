// Verifica las dos pantallas que cierran los bloqueantes de tienda del
// prestador: borrado de cuenta (con confirmación escrita) y política de
// privacidad (10 secciones + enlace publicado).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_provider/screens/profile/account_deletion_screen.dart';
import 'package:glow_provider/screens/profile/privacy_policy_screen.dart';

Widget _envolver(Widget child) => MaterialApp(home: child);

/// Las dos pantallas son ListView: con la superficie por defecto (800x600)
/// Flutter no construye lo que queda fuera de pantalla y los finders fallan
/// por un motivo que no tiene nada que ver con el código de la app.
void _pantallaAlta(WidgetTester tester) {
  tester.view.physicalSize = const Size(1200, 4200);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

void main() {
  testWidgets('borrado de cuenta: el botón sólo se habilita con ELIMINAR',
      (tester) async {
    _pantallaAlta(tester);
    await tester.pumpWidget(
      _envolver(const AccountDeletionScreen(userEmail: 'pro@glowapp.co')),
    );

    final boton = find.widgetWithText(
        FilledButton, 'Eliminar mi cuenta definitivamente');
    expect(boton, findsOneWidget);
    expect(tester.widget<FilledButton>(boton).onPressed, isNull);

    await tester.enterText(find.byType(TextField), 'eliminar');
    await tester.pump();
    expect(tester.widget<FilledButton>(boton).onPressed, isNotNull);

    await tester.enterText(find.byType(TextField), 'otra cosa');
    await tester.pump();
    expect(tester.widget<FilledButton>(boton).onPressed, isNull);
  });

  testWidgets('borrado de cuenta: muestra el correo del titular',
      (tester) async {
    _pantallaAlta(tester);
    await tester.pumpWidget(
      _envolver(const AccountDeletionScreen(userEmail: 'pro@glowapp.co')),
    );
    expect(find.textContaining('pro@glowapp.co'), findsOneWidget);
  });

  testWidgets('privacidad: pinta las 10 secciones y el enlace publicado',
      (tester) async {
    _pantallaAlta(tester);
    await tester.pumpWidget(_envolver(const PrivacyPolicyScreen()));

    for (final seccion in PrivacyPolicyScreen.secciones) {
      expect(find.text(seccion['titulo']!), findsOneWidget,
          reason: 'falta «${seccion['titulo']}»');
    }
    expect(PrivacyPolicyScreen.secciones.length, 10);
    expect(find.byType(OutlinedButton), findsOneWidget);
    expect(PrivacyPolicyScreen.urlPublica,
        'https://glowapp-provider.web.app/privacy.html');
  });
}
