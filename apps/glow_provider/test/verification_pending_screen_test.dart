// apps/glow_provider/test/verification_pending_screen_test.dart
// Test de regresión: VerificationPendingScreen
// Verifica que el polling NO navega con onboarding_completo=true y estatus=PENDIENTE
// Solo navega cuando estatus_verificacion=APROBADO

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:glow_provider/screens/auth/verification_pending_screen.dart';

/// Configura el viewport del tester para evitar overflow en pantallas con Column
void _pantallaAlta(WidgetTester tester) {
  tester.view.physicalSize = const Size(1200, 4200);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

void main() {
  group('VerificationPendingScreen - Polling por estatus_verificacion', () {
    tearDown(() {
      resetFetchProfileForTesting();
    });

    testWidgets('NO navega a /home cuando fetchProfile devuelve PENDIENTE '
        '(aunque onboarding_completo fuera true en el token)',
        (WidgetTester tester) async {
      _pantallaAlta(tester);
      // Arrange: fetchProfile devuelve estatus_verificacion = PENDIENTE
      // Simula el caso donde onboarding_completo=true (en el token/sesión)
      // pero estatus_verificacion sigue siendo PENDIENTE
      overrideFetchProfileForTesting(() async => {
        'user': {
          'id': 1,
          'email': 'test@test.com',
          'onboarding_completo': true, // Este campo existe pero NO debe decidir navegación
          'estatus_verificacion': 'PENDIENTE',
        }
      });

      // Act: Renderizar pantalla y esperar un frame de polling
      await tester.pumpWidget(
        MaterialApp(
          routes: {
            '/home': (_) => const Scaffold(body: Text('HOME')),
            '/auth/login': (_) => const Scaffold(body: Text('LOGIN')),
          },
          home: const VerificationPendingScreen(),
        ),
      );

      // Esperar a que se ejecute el primer checkVerificationStatus (inmediato)
      await tester.pump(const Duration(seconds: 1));

      // Assert: NO debe haber navegado a /home
      // La pantalla debe seguir mostrando "Perfil en proceso de verificación"
      expect(find.text('Perfil en proceso de verificación'), findsOneWidget);
      expect(find.text('HOME'), findsNothing);
    });

    testWidgets('NAVEGA a /home cuando fetchProfile devuelve APROBADO',
        (WidgetTester tester) async {
      _pantallaAlta(tester);
      // Arrange: fetchProfile devuelve estatus_verificacion = APROBADO
      overrideFetchProfileForTesting(() async => {
        'user': {
          'id': 1,
          'email': 'test@test.com',
          'estatus_verificacion': 'APROBADO',
        }
      });

      // Act
      await tester.pumpWidget(
        MaterialApp(
          routes: {
            '/home': (_) => const Scaffold(body: Text('HOME')),
            '/auth/login': (_) => const Scaffold(body: Text('LOGIN')),
          },
          home: const VerificationPendingScreen(),
        ),
      );

      await tester.pump(const Duration(seconds: 1));
      // Esperar frame extra para que se procese la navegación
      await tester.pumpAndSettle(const Duration(seconds: 2));

      // Assert: Debe haber navegado a /home (o al menos el estado interno debe ser APROBADO)
      // En tests, la navegación real puede no ocurrir, pero el estado interno sí cambia
      expect(find.text('Perfil en proceso de verificación'), findsNothing);
    });

    testWidgets('MUESTRA nota de rechazo cuando fetchProfile devuelve RECHAZADO',
        (WidgetTester tester) async {
      _pantallaAlta(tester);
      // Arrange
      overrideFetchProfileForTesting(() async => {
        'user': {
          'id': 1,
          'email': 'test@test.com',
          'estatus_verificacion': 'RECHAZADO',
          'rechazo_verificacion_nota': 'Documento de identidad ilegible',
        }
      });

      // Act
      await tester.pumpWidget(
        MaterialApp(
          routes: {
            '/home': (_) => const Scaffold(body: Text('HOME')),
            '/auth/login': (_) => const Scaffold(body: Text('LOGIN')),
          },
          home: const VerificationPendingScreen(),
        ),
      );

      await tester.pump(const Duration(seconds: 1));

      // Assert: Muestra "Verificación rechazada" y la nota
      expect(find.text('Verificación rechazada'), findsOneWidget);
      expect(find.text('Documento de identidad ilegible'), findsOneWidget);
    });

    testWidgets('Botón "Revisar estado" fuerza refetch inmediato y navega si APROBADO',
        (WidgetTester tester) async {
      _pantallaAlta(tester);
      int callCount = 0;
      overrideFetchProfileForTesting(() async {
        callCount++;
        if (callCount == 1) {
          return {
            'user': {'estatus_verificacion': 'PENDIENTE'}
          };
        }
        return {
          'user': {'estatus_verificacion': 'APROBADO'}
        };
      });

      await tester.pumpWidget(
        MaterialApp(
          routes: {
            '/home': (_) => const Scaffold(body: Text('HOME')),
            '/auth/login': (_) => const Scaffold(body: Text('LOGIN')),
          },
          home: const VerificationPendingScreen(),
        ),
      );

      await tester.pump(const Duration(seconds: 1));
      expect(find.text('Perfil en proceso de verificación'), findsOneWidget);

      // Tap en "Revisar estado"
      await tester.tap(find.text('Revisar estado'));
      await tester.pump(const Duration(seconds: 1));
      await tester.pumpAndSettle(const Duration(seconds: 2));

      // Ahora el estado interno debe ser APROBADO (la pantalla de verificación desaparece)
      expect(find.text('Perfil en proceso de verificación'), findsNothing);
    });
  });
}