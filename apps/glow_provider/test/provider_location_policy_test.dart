import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:glow_provider/utils/provider_location_policy.dart';

void main() {
  group('consentimiento de ubicación en segundo plano', () {
    test('requiere consentimiento explícito de la versión de segundo plano',
        () {
      expect(
        hasBackgroundLocationConsent(
          enabled: true,
          consentVersion: backgroundLocationConsentVersion,
          isWeb: false,
        ),
        isTrue,
      );
      expect(
        hasBackgroundLocationConsent(
          enabled: true,
          consentVersion: '2026-11',
          isWeb: false,
        ),
        isFalse,
      );
      expect(
        hasBackgroundLocationConsent(
          enabled: true,
          consentVersion: backgroundLocationConsentVersion,
          isWeb: true,
        ),
        isFalse,
      );
    });

    test('mantiene la captura al pausar solo con consentimiento vigente', () {
      expect(
        shouldStopLocationTrackingForLifecycle(
          AppLifecycleState.paused,
          hasBackgroundConsent: true,
        ),
        isFalse,
      );
      expect(
        shouldStopLocationTrackingForLifecycle(
          AppLifecycleState.paused,
          hasBackgroundConsent: false,
        ),
        isTrue,
      );
      expect(
        shouldStopLocationTrackingForLifecycle(
          AppLifecycleState.detached,
          hasBackgroundConsent: true,
        ),
        isTrue,
      );
    });
  });
}
