// Invariante que faltaba: cada paso del guide debe tener su video.
//
// El 2026-11-01 el mapeo usaba el NOMBRE DEL ARCHIVO como clave mientras los
// pasos usan otro id (`step_01_bienvenida` vs `step_01_welcome.mp4`, y
// `provider_step_01..07` vs `step_01_inicio..step_07_perfil`). Resultado: el
// primer paso del cliente devolvia URL vacia —el reproductor aparecia pero el
// boton "PRESIONE PARA INICIAR" no hacia nada— y en el provider no coincidia
// ningun paso.

import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glowguide/config/client_guide.dart';
import 'package:glow_core/glowguide/config/provider_guide.dart';
import 'package:glow_core/glowguide/config/video_mapping.dart';

void main() {
  const clientBase =
      'https://storage.googleapis.com/glowapp-client.firebasestorage.app/';
  const providerBase =
      'https://storage.googleapis.com/glowapp-provider.firebasestorage.app/';

  group('GlowGuideVideoMap · cliente', () {
    test('todos los pasos tienen mp4 y webm', () {
      for (final step in ClientGuide.steps) {
        final mp4 = GlowGuideVideoMap.getMp4Url(step.id, false);
        final webm = GlowGuideVideoMap.getWebmUrl(step.id, false);

        expect(mp4, isNotEmpty, reason: 'paso sin mp4: ${step.id}');
        expect(webm, isNotEmpty, reason: 'paso sin webm: ${step.id}');
        expect(mp4, startsWith(clientBase), reason: 'mp4 fuera del bucket: ${step.id}');
        expect(webm, startsWith(clientBase), reason: 'webm fuera del bucket: ${step.id}');
        expect(mp4, endsWith('.mp4'));
        expect(webm, endsWith('.webm'));
      }
    });
  });

  group('GlowGuideVideoMap · provider', () {
    test('todos los pasos tienen mp4 y webm', () {
      for (final step in ProviderGuide.steps) {
        final mp4 = GlowGuideVideoMap.getMp4Url(step.id, true);
        final webm = GlowGuideVideoMap.getWebmUrl(step.id, true);

        expect(mp4, isNotEmpty, reason: 'paso sin mp4: ${step.id}');
        expect(webm, isNotEmpty, reason: 'paso sin webm: ${step.id}');
        expect(mp4, startsWith(providerBase), reason: 'mp4 fuera del bucket: ${step.id}');
        expect(webm, startsWith(providerBase), reason: 'webm fuera del bucket: ${step.id}');
      }
    });
  });

  group('GlowGuideVideoMap · integridad', () {
    test('no hay claves sin paso asociado', () {
      final clientIds = ClientGuide.steps.map((s) => s.id).toSet();
      final providerIds = ProviderGuide.steps.map((s) => s.id).toSet();

      for (final key in GlowGuideVideoMap.client.keys) {
        expect(clientIds.contains(key), isTrue, reason: 'clave huerfana en client: $key');
      }
      for (final key in GlowGuideVideoMap.provider.keys) {
        expect(providerIds.contains(key), isTrue, reason: 'clave huerfana en provider: $key');
      }
    });

    test('cada paso apunta a un archivo distinto', () {
      final urls = [
        ...ClientGuide.steps.map((s) => GlowGuideVideoMap.getMp4Url(s.id, false)),
        ...ProviderGuide.steps.map((s) => GlowGuideVideoMap.getMp4Url(s.id, true)),
      ];
      expect(urls.toSet().length, urls.length,
          reason: 'dos pasos comparten URL de video');
    });

    test('hasUrls concuerda con las URLs', () {
      for (final step in ClientGuide.steps) {
        expect(GlowGuideVideoMap.hasUrls(step.id, false), isTrue,
            reason: 'hasUrls falso para ${step.id}');
      }
      for (final step in ProviderGuide.steps) {
        expect(GlowGuideVideoMap.hasUrls(step.id, true), isTrue,
            reason: 'hasUrls falso para ${step.id}');
      }
    });
  });
}
