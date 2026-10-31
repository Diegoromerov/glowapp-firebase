// video_mapping.dart
// Mapeo de stepId → Firebase Storage URLs (MP4 + WebM)
// Cloudflare Stream UIDs se poblarán cuando se desbloquee pago

class GlowGuideVideoMap {
  /// Helper: URL firmada para un archivo (ya vienen firmadas desde mediaLink)
    // static String _url(String url) => url; // Unused, kept for reference

  /// Videos del onboarding CLIENTE (8 pasos) — MP4 (iOS/Safari) + WebM (Chrome/Android)
  /// URLs obtenidas de Firebase Storage mediaLink (públicas, firmadas con generation token)
  static const Map<String, Map<String, String>> client = {
    'step_01_welcome': {
      'mp4': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-client.firebasestorage.app/o/step_01_welcome.mp4?generation=1793424929556808&alt=media',
      'webm': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-client.firebasestorage.app/o/step_01_welcome.webm?generation=1793423408194677&alt=media',
    },
    'step_02_citas': {
      'mp4': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-client.firebasestorage.app/o/step_02_citas.mp4?generation=1793424929599040&alt=media',
      'webm': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-client.firebasestorage.app/o/step_02_citas.webm?generation=1793423407462402&alt=media',
    },
    'step_03_glowshop': {
      'mp4': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-client.firebasestorage.app/o/step_03_glowshop.mp4?generation=1793424928891142&alt=media',
      'webm': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-client.firebasestorage.app/o/step_03_glowshop.webm?generation=1793423408198897&alt=media',
    },
    'step_04_glowia': {
      'mp4': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-client.firebasestorage.app/o/step_04_glowia.mp4?generation=1793424929659765&alt=media',
      'webm': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-client.firebasestorage.app/o/step_04_glowia.webm?generation=1793423408058845&alt=media',
    },
    'step_05_perfil': {
      'mp4': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-client.firebasestorage.app/o/step_05_perfil.mp4?generation=1793424928537476&alt=media',
      'webm': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-client.firebasestorage.app/o/step_05_perfil.webm?generation=1793423409269013&alt=media',
    },
    'step_06_aurachat': {
      'mp4': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-client.firebasestorage.app/o/step_06_aurachat.mp4?generation=1793424932237966&alt=media',
      'webm': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-client.firebasestorage.app/o/step_06_aurachat.webm?generation=1793423404217276&alt=media',
    },
    'step_07_mapa': {
      'mp4': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-client.firebasestorage.app/o/step_07_mapa.mp4?generation=1793424932863032&alt=media',
      'webm': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-client.firebasestorage.app/o/step_07_mapa.webm?generation=1793423404689606&alt=media',
    },
    'step_08_despedida': {
      'mp4': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-client.firebasestorage.app/o/step_08_despedida.mp4?generation=1793424931906132&alt=media',
      'webm': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-client.firebasestorage.app/o/step_08_despedida.webm?generation=1793423403684021&alt=media',
    },
  };

  /// Videos del onboarding PROVEEDOR/SALÓN (7 pasos) — MP4 + WebM
  static const Map<String, Map<String, String>> provider = {
    'step_01_inicio': {
      'mp4': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-provider.firebasestorage.app/o/step_01_inicio.mp4?generation=1793423982815171&alt=media',
      'webm': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-provider.firebasestorage.app/o/step_01_inicio.webm?generation=1793423587642458&alt=media',
    },
    'step_02_agenda': {
      'mp4': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-provider.firebasestorage.app/o/step_02_agenda.mp4?generation=1793423982432878&alt=media',
      'webm': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-provider.firebasestorage.app/o/step_02_agenda.webm?generation=1793423589062291&alt=media',
    },
    'step_03_wallet': {
      'mp4': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-provider.firebasestorage.app/o/step_03_wallet.mp4?generation=1793423986125310&alt=media',
      'webm': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-provider.firebasestorage.app/o/step_03_wallet.webm?generation=1793423588733260&alt=media',
    },
    'step_04_glowshop': {
      'mp4': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-provider.firebasestorage.app/o/step_04_glowshop.mp4?generation=1793423982904872&alt=media',
      'webm': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-provider.firebasestorage.app/o/step_04_glowshop.webm?generation=1793423588322724&alt=media',
    },
    'step_05_academia': {
      'mp4': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-provider.firebasestorage.app/o/step_05_academia.mp4?generation=1793423980707330&alt=media',
      'webm': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-provider.firebasestorage.app/o/step_05_academia.webm?generation=1793423587033637&alt=media',
    },
    'step_06_chat': {
      'mp4': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-provider.firebasestorage.app/o/step_06_chat.mp4?generation=1793423983548019&alt=media',
      'webm': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-provider.firebasestorage.app/o/step_06_chat.webm?generation=1793423587838998&alt=media',
    },
    'step_07_perfil': {
      'mp4': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-provider.firebasestorage.app/o/step_07_perfil.mp4?generation=1793423981968728&alt=media',
      'webm': 'https://storage.googleapis.com/download/storage/v1/b/glowapp-provider.firebasestorage.app/o/step_07_perfil.webm?generation=1793423588305141&alt=media',
    },
  };

  /// Obtiene URL MP4 para un step y audiencia
  static String getMp4Url(String stepId, bool isProvider) {
    final map = isProvider ? provider : client;
    return map[stepId]?['mp4'] ?? '';
  }

  /// Obtiene URL WebM para un step y audiencia
  static String getWebmUrl(String stepId, bool isProvider) {
    final map = isProvider ? provider : client;
    return map[stepId]?['webm'] ?? '';
  }

  /// Obtiene la mejor URL según plataforma (MP4 para iOS/Safari, WebM para resto)
  static String getBestUrl(String stepId, bool isProvider) {
    // En runtime el presenter detecta user-agent y elige
    final mp4 = getMp4Url(stepId, isProvider);
    final webm = getWebmUrl(stepId, isProvider);
    return mp4.isNotEmpty ? mp4 : webm; // fallback
  }

  /// Verifica si un step tiene URLs configuradas
  static bool hasUrls(String stepId, bool isProvider) {
    final map = isProvider ? provider : client;
    final urls = map[stepId];
    return urls != null && (urls['mp4']?.isNotEmpty == true || urls['webm']?.isNotEmpty == true);
  }
}
