// La hoja de reseña nueva: estrellas, aspectos y comentario, en ese orden y con
// lo opcional realmente opcional. La propina ya no vive aquí: pedir dinero en la
// misma pantalla que pide una opinión sesga la nota.
//
// `onSubmit` es la costura de prueba: ApiService es estático y no se inyecta, así
// que sin ella este test tocaría la red.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_client/widgets/service_review_sheet.dart';

void main() {
  Future<void> abrirHoja(
    WidgetTester tester,
    ReviewSubmit onSubmit,
  ) async {
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: ElevatedButton(
              onPressed: () => showServiceReviewSheet(
                context,
                bookingId: 'reserva-1',
                providerName: 'Aura',
                onSubmit: onSubmit,
              ),
              child: const Text('abrir'),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle();
  }

  testWidgets('pide la nota antes de dejar publicar', (tester) async {
    var enviado = false;
    await abrirHoja(tester, (r, c, a) async => enviado = true);

    await tester.tap(find.text('Publicar reseña'));
    await tester.pumpAndSettle();

    expect(enviado, isFalse, reason: 'sin estrellas no hay reseña');
    expect(find.textContaining('Toca las estrellas'), findsOneWidget);
  });

  testWidgets('envía nota, aspectos y comentario', (tester) async {
    int? nota;
    List<String>? aspectos;
    String? comentario;
    await abrirHoja(tester, (r, c, a) async {
      nota = r;
      aspectos = a;
      comentario = c;
    });

    // 4 estrellas
    await tester.tap(find.byTooltip('4 de 5'));
    await tester.pump();
    // dos aspectos
    await tester.tap(find.text('Puntualidad'));
    await tester.pump();
    await tester.tap(find.text('Trato'));
    await tester.pump();
    // comentario
    await tester.enterText(find.byType(TextField), 'Muy amable y puntual');
    await tester.pump();

    await tester.tap(find.text('Publicar reseña'));
    await tester.pumpAndSettle();

    expect(nota, 4);
    expect(aspectos, containsAll(<String>['Puntualidad', 'Trato']));
    expect(comentario, 'Muy amable y puntual');
  });

  testWidgets('la propina ya no está en la hoja de reseña', (tester) async {
    await abrirHoja(tester, (r, c, a) async {});

    expect(find.textContaining('propina'), findsNothing,
        reason: 'mezclar dinero con la opinión sesga la calificación');
  });
}
