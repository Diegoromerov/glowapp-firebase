// video_mapping.dart
//
// Mapeo stepId -> URLs de video del GlowGuide (MP4 + WebM).
//
// FUENTE UNICA: Firebase Storage. Cada app tiene su proyecto y su bucket, y los
// objetos viven en la raiz del bucket.
//
//   cliente  -> gs://glowapp-client.firebasestorage.app/step_01_welcome.mp4 ...
//   provider -> gs://glowapp-provider.firebasestorage.app/step_01_inicio.mp4 ...
//
// OJO: la clave es el **id del paso** (`GlowGuideStep.id`), que NO siempre
// coincide con el nombre del archivo. El primer paso del cliente se llama
// `step_01_bienvenida` pero su video se llama `step_01_welcome.mp4`; los pasos
// del provider se llaman `provider_step_01..07` mientras los archivos son
// `step_01_inicio..step_07_perfil`. Por eso cada entrada declara su objeto.
// (Antes el mapeo usaba el nombre del archivo como clave y ningun paso
// encontraba su video: el primer paso devolvia URL vacia y el resto tampoco.)
//
// El test `test/glowguide/video_mapping_test.dart` verifica que todos los pasos
// de ClientGuide y ProviderGuide tengan URL, para que esto no se repita.
//
// 30 objetos (15 pasos x mp4/webm) verificados el 2026-11-01: HTTP 200 con
// Content-Type correcto y Content-Length identico al tamano del objeto.
//
// POR QUE SE USA storage.googleapis.com Y NO firebasestorage.googleapis.com:
// el endpoint `firebasestorage.googleapis.com/v0/b/.../o/...?alt=media` valida
// Firebase Security Rules y devuelve 403 aun con el objeto publico. El de GCS
// respeta el ACL del objeto (allUsers:READER), que es el que se aplico.
//
// SI SE VUELVEN A SUBIR LOS VIDEOS, el ACL por objeto se pierde: hay que
// reaplicarlo (`allUsers` -> `READER`) o migrar a Storage Rules con
// `allow read: if true;` sobre estas rutas, que sobreviven a la resubida.
//
// NO usar Firebase download/storage/v1 (400) ni Cloudflare Stream: los UID
// nunca se poblaron (iframe.videodelivery.net/UID_C0x era un placeholder).

class GlowGuideVideoMap {
  /// Bucket del proyecto cliente (projectId 634593218804)
  static const String _clientBase =
      'https://storage.googleapis.com/glowapp-client.firebasestorage.app';

  /// Bucket del proyecto provider (projectId 509840252897)
  static const String _providerBase =
      'https://storage.googleapis.com/glowapp-provider.firebasestorage.app';

  /// Videos del onboarding CLIENTE (8 pasos) - MP4 (iOS/Safari) + WebM (Chrome/Android)
  static const Map<String, Map<String, String>> client = {
    // step_01_bienvenida -> step_01_welcome
    'step_01_bienvenida': {
      'mp4': '$_clientBase/step_01_welcome.mp4',
      'webm': '$_clientBase/step_01_welcome.webm',
    },
    // step_02_citas -> step_02_citas
    'step_02_citas': {
      'mp4': '$_clientBase/step_02_citas.mp4',
      'webm': '$_clientBase/step_02_citas.webm',
    },
    // step_03_glowshop -> step_03_glowshop
    'step_03_glowshop': {
      'mp4': '$_clientBase/step_03_glowshop.mp4',
      'webm': '$_clientBase/step_03_glowshop.webm',
    },
    // step_04_glowia -> step_04_glowia
    'step_04_glowia': {
      'mp4': '$_clientBase/step_04_glowia.mp4',
      'webm': '$_clientBase/step_04_glowia.webm',
    },
    // step_05_perfil -> step_05_perfil
    'step_05_perfil': {
      'mp4': '$_clientBase/step_05_perfil.mp4',
      'webm': '$_clientBase/step_05_perfil.webm',
    },
    // step_06_aurachat -> step_06_aurachat
    'step_06_aurachat': {
      'mp4': '$_clientBase/step_06_aurachat.mp4',
      'webm': '$_clientBase/step_06_aurachat.webm',
    },
    // step_07_mapa -> step_07_mapa
    'step_07_mapa': {
      'mp4': '$_clientBase/step_07_mapa.mp4',
      'webm': '$_clientBase/step_07_mapa.webm',
    },
    // step_08_despedida -> step_08_despedida
    'step_08_despedida': {
      'mp4': '$_clientBase/step_08_despedida.mp4',
      'webm': '$_clientBase/step_08_despedida.webm',
    },
  };

  /// Videos del onboarding PROVEEDOR/SALON (7 pasos) - MP4 + WebM
  static const Map<String, Map<String, String>> provider = {
    // provider_step_01 -> step_01_inicio
    'provider_step_01': {
      'mp4': '$_providerBase/step_01_inicio.mp4',
      'webm': '$_providerBase/step_01_inicio.webm',
    },
    // provider_step_02 -> step_02_agenda
    'provider_step_02': {
      'mp4': '$_providerBase/step_02_agenda.mp4',
      'webm': '$_providerBase/step_02_agenda.webm',
    },
    // provider_step_03 -> step_03_wallet
    'provider_step_03': {
      'mp4': '$_providerBase/step_03_wallet.mp4',
      'webm': '$_providerBase/step_03_wallet.webm',
    },
    // provider_step_04 -> step_04_glowshop
    'provider_step_04': {
      'mp4': '$_providerBase/step_04_glowshop.mp4',
      'webm': '$_providerBase/step_04_glowshop.webm',
    },
    // provider_step_05 -> step_05_academia
    'provider_step_05': {
      'mp4': '$_providerBase/step_05_academia.mp4',
      'webm': '$_providerBase/step_05_academia.webm',
    },
    // provider_step_06 -> step_06_chat
    'provider_step_06': {
      'mp4': '$_providerBase/step_06_chat.mp4',
      'webm': '$_providerBase/step_06_chat.webm',
    },
    // provider_step_07 -> step_07_perfil
    'provider_step_07': {
      'mp4': '$_providerBase/step_07_perfil.mp4',
      'webm': '$_providerBase/step_07_perfil.webm',
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
