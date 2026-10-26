// video_mapping.dart
// Mapeo de stepId → Cloudflare Stream URL
// ESTE ARCHIVO SE POBLARÁ EN FASE 7 (tras subir videos a Cloudflare Stream)
// Por ahora: stubs vacíos para que el motor compile

class GlowGuideVideoMap {
  /// Videos del onboarding CLIENTE (8 pasos)
  static const Map<String, String> client = {
    'step_01_welcome': '',           // https://iframe.videodelivery.net/UID_C01
    'step_02_citas': '',             // https://iframe.videodelivery.net/UID_C02
    'step_03_glowshop': '',          // https://iframe.videodelivery.net/UID_C03
    'step_04_glowia': '',            // https://iframe.videodelivery.net/UID_C04
    'step_05_perfil': '',            // https://iframe.videodelivery.net/UID_C05
    'step_06_aurachat': '',          // https://iframe.videodelivery.net/UID_C06
    'step_07_mapa': '',              // https://iframe.videodelivery.net/UID_C07
    'step_08_despedida': '',         // https://iframe.videodelivery.net/UID_C08
  };

  /// Videos del onboarding PROVEEDOR/SALÓN (7 pasos)
  static const Map<String, String> provider = {
    'step_01_inicio': '',            // https://iframe.videodelivery.net/UID_P01
    'step_02_agenda': '',            // https://iframe.videodelivery.net/UID_P02
    'step_03_wallet': '',            // https://iframe.videodelivery.net/UID_P03
    'step_04_glowshop': '',          // https://iframe.videodelivery.net/UID_P04
    'step_05_academia': '',          // https://iframe.videodelivery.net/UID_P05
    'step_06_chat': '',              // https://iframe.videodelivery.net/UID_P06
    'step_07_perfil': '',            // https://iframe.videodelivery.net/UID_P07
  };

  /// Obtiene URL para un step y audiencia
  static String getUrl(String stepId, bool isProvider) {
    final map = isProvider ? provider : client;
    return map[stepId] ?? '';
  }

  /// Verifica si un step tiene URL configurada
  static bool hasUrl(String stepId, bool isProvider) {
    final map = isProvider ? provider : client;
    final url = map[stepId];
    return url != null && url.isNotEmpty;
  }
}
