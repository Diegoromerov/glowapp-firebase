// video_mapping.dart
//
// Mapeo stepId -> URLs de video del GlowGuide (MP4 + WebM).
//
// FUENTE UNICA: los videos los sirve el backend Express como estaticos desde
// `backend/public/assets/assets/glowguide/videos`. Verificado el 2026-11-01:
// los 30 archivos (15 pasos x 2 formatos) responden HTTP 200.
//
// NO usar Firebase Storage: los objetos no son publicos.
//   download/storage/v1/...            -> HTTP 400
//   /v0/b/.../o/...?alt=media          -> HTTP 403
// Tampoco Cloudflare Stream: los UID nunca se poblaron
// (iframe.videodelivery.net/UID_C0x era un placeholder en la rama split).

class GlowGuideVideoMap {
  /// Base del API. Se toma del mismo --dart-define que usa ApiService, para que
  /// el mapeo siga al entorno; el host de produccion queda como respaldo.
  static const String _apiBase = String.fromEnvironment(
    'API_URL',
    defaultValue: 'https://glowapp-api-production.up.railway.app',
  );

  /// El backend publica `backend/public` en la raiz, asi que los videos viven
  /// bajo /assets/assets/glowguide/videos (el doble `assets` es el real).
  static const String _videoBase = '$_apiBase/assets/assets/glowguide/videos';

  /// Videos del onboarding CLIENTE (8 pasos) - MP4 (iOS/Safari) + WebM (Chrome/Android)
  static const Map<String, Map<String, String>> client = {
    'step_01_welcome': {
      'mp4': '$_videoBase/step_01_welcome.mp4',
      'webm': '$_videoBase/step_01_welcome.webm',
    },
    'step_02_citas': {
      'mp4': '$_videoBase/step_02_citas.mp4',
      'webm': '$_videoBase/step_02_citas.webm',
    },
    'step_03_glowshop': {
      'mp4': '$_videoBase/step_03_glowshop.mp4',
      'webm': '$_videoBase/step_03_glowshop.webm',
    },
    'step_04_glowia': {
      'mp4': '$_videoBase/step_04_glowia.mp4',
      'webm': '$_videoBase/step_04_glowia.webm',
    },
    'step_05_perfil': {
      'mp4': '$_videoBase/step_05_perfil.mp4',
      'webm': '$_videoBase/step_05_perfil.webm',
    },
    'step_06_aurachat': {
      'mp4': '$_videoBase/step_06_aurachat.mp4',
      'webm': '$_videoBase/step_06_aurachat.webm',
    },
    'step_07_mapa': {
      'mp4': '$_videoBase/step_07_mapa.mp4',
      'webm': '$_videoBase/step_07_mapa.webm',
    },
    'step_08_despedida': {
      'mp4': '$_videoBase/step_08_despedida.mp4',
      'webm': '$_videoBase/step_08_despedida.webm',
    },
  };

  /// Videos del onboarding PROVEEDOR/SALON (7 pasos) - MP4 + WebM
  static const Map<String, Map<String, String>> provider = {
    'step_01_inicio': {
      'mp4': '$_videoBase/step_01_inicio.mp4',
      'webm': '$_videoBase/step_01_inicio.webm',
    },
    'step_02_agenda': {
      'mp4': '$_videoBase/step_02_agenda.mp4',
      'webm': '$_videoBase/step_02_agenda.webm',
    },
    'step_03_wallet': {
      'mp4': '$_videoBase/step_03_wallet.mp4',
      'webm': '$_videoBase/step_03_wallet.webm',
    },
    'step_04_glowshop': {
      'mp4': '$_videoBase/step_04_glowshop.mp4',
      'webm': '$_videoBase/step_04_glowshop.webm',
    },
    'step_05_academia': {
      'mp4': '$_videoBase/step_05_academia.mp4',
      'webm': '$_videoBase/step_05_academia.webm',
    },
    'step_06_chat': {
      'mp4': '$_videoBase/step_06_chat.mp4',
      'webm': '$_videoBase/step_06_chat.webm',
    },
    'step_07_perfil': {
      'mp4': '$_videoBase/step_07_perfil.mp4',
      'webm': '$_videoBase/step_07_perfil.webm',
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

  /// Obtiene la mejor URL segun plataforma (MP4 para iOS/Safari, WebM para resto)
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
