// lib/firebase_options.dart
//
// Configuracion de Firebase inyectada en TIEMPO DE BUILD (--dart-define).
//
// Este archivo NO lleva valores a proposito:
//   * La compuerta bloqueante backend/scripts/verifyNoVersionedSecrets.js prohibe
//     claves tipo Google API (AIza...) en el repositorio.
//   * Antes era la plantilla del FlutterFire CLI SIN rellenar y el build la usaba
//     tal cual, asi que la web se desplegaba inicializando Firebase con
//     la clave de ejemplo del CLI (un apiKey invalido) y sin avisar. Verificado
//     contra el despliegue: el bundle servido tenia 0 claves reales.
//
// Las variables viven en el servicio (Railway) y entran al build por --dart-define
// (ver frontend/Dockerfile). El mismo juego alimenta el service worker de FCM, que
// no puede leer dart-defines porque es JavaScript plano: lo genera
// tool/generate_firebase_sw.dart antes del build.

import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

/// Variables de build, compartidas por todas las plataformas.
class FirebaseConfig {
  FirebaseConfig._();

  static const apiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
  static const messagingSenderId =
      String.fromEnvironment('FIREBASE_MESSAGING_SENDER_ID');
  static const storageBucket =
      String.fromEnvironment('FIREBASE_STORAGE_BUCKET');

  // El appId es distinto por plataforma (1:<sender>:web:<hash> y variantes).
  static const webAppId = String.fromEnvironment('FIREBASE_WEB_APP_ID');
  static const androidAppId = String.fromEnvironment('FIREBASE_ANDROID_APP_ID');
  static const iosAppId = String.fromEnvironment('FIREBASE_IOS_APP_ID');
  static const macosAppId = String.fromEnvironment('FIREBASE_MACOS_APP_ID');
  static const windowsAppId = String.fromEnvironment('FIREBASE_WINDOWS_APP_ID');
}

/// Devuelve las variables que faltan para un juego de configuracion dado.
/// Es una funcion pura: se puede probar sin compilar la app (ver
/// test/firebase_options_test.dart).
List<String> faltantesDeConfiguracion({
  required String apiKey,
  required String projectId,
  required String messagingSenderId,
  required String appId,
}) {
  final faltan = <String>[];
  if (apiKey.isEmpty) faltan.add('FIREBASE_API_KEY');
  if (projectId.isEmpty) faltan.add('FIREBASE_PROJECT_ID');
  if (messagingSenderId.isEmpty) faltan.add('FIREBASE_MESSAGING_SENDER_ID');
  if (appId.isEmpty) faltan.add('appId de la plataforma');
  return faltan;
}

/// Se lanza al pedir la configuracion de una plataforma sin haberla inyectado.
class FirebaseConfigFaltante implements Exception {
  final List<String> faltantes;
  const FirebaseConfigFaltante(this.faltantes);

  @override
  String toString() => 'Firebase no esta configurado en este build. '
      'Faltan: ${faltantes.join(', ')}. '
      'Definelas en el servicio y pasalas al build por --dart-define.';
}

class DefaultFirebaseOptions {
  DefaultFirebaseOptions._();

  static String get _appIdDeLaPlataforma {
    if (kIsWeb) return FirebaseConfig.webAppId;
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return FirebaseConfig.androidAppId;
      case TargetPlatform.iOS:
        return FirebaseConfig.iosAppId;
      case TargetPlatform.macOS:
        return FirebaseConfig.macosAppId;
      case TargetPlatform.windows:
        return FirebaseConfig.windowsAppId;
      default:
        return '';
    }
  }

  /// Variables que faltan en este build. Vacio == Firebase utilizable.
  static List<String> get faltantes => faltantesDeConfiguracion(
        apiKey: FirebaseConfig.apiKey,
        projectId: FirebaseConfig.projectId,
        messagingSenderId: FirebaseConfig.messagingSenderId,
        appId: _appIdDeLaPlataforma,
      );

  /// true solo si el build recibio TODO lo necesario para inicializar Firebase.
  /// Quien inicialice Firebase debe consultar esto ANTES: es la guarda que evita
  /// arrancar en silencio con credenciales falsas.
  static bool get estaConfigurado => faltantes.isEmpty;

  static String get _authDomain =>
      '${FirebaseConfig.projectId}.firebaseapp.com';

  static String get _storageBucket => FirebaseConfig.storageBucket.isNotEmpty
      ? FirebaseConfig.storageBucket
      : '${FirebaseConfig.projectId}.appspot.com';

  static FirebaseOptions get currentPlatform {
    if (!estaConfigurado) {
      throw FirebaseConfigFaltante(faltantes);
    }

    if (kIsWeb) {
      return FirebaseOptions(
        apiKey: FirebaseConfig.apiKey,
        appId: FirebaseConfig.webAppId,
        messagingSenderId: FirebaseConfig.messagingSenderId,
        projectId: FirebaseConfig.projectId,
        authDomain: _authDomain,
        storageBucket: _storageBucket,
      );
    }

    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return FirebaseOptions(
          apiKey: FirebaseConfig.apiKey,
          appId: FirebaseConfig.androidAppId,
          messagingSenderId: FirebaseConfig.messagingSenderId,
          projectId: FirebaseConfig.projectId,
          storageBucket: _storageBucket,
        );
      case TargetPlatform.iOS:
        return FirebaseOptions(
          apiKey: FirebaseConfig.apiKey,
          appId: FirebaseConfig.iosAppId,
          messagingSenderId: FirebaseConfig.messagingSenderId,
          projectId: FirebaseConfig.projectId,
          storageBucket: _storageBucket,
          iosBundleId: 'com.glowapp.glow_client',
        );
      case TargetPlatform.macOS:
        return FirebaseOptions(
          apiKey: FirebaseConfig.apiKey,
          appId: FirebaseConfig.macosAppId,
          messagingSenderId: FirebaseConfig.messagingSenderId,
          projectId: FirebaseConfig.projectId,
          storageBucket: _storageBucket,
          iosBundleId: 'com.glowapp.glow_client',
        );
      case TargetPlatform.windows:
        return FirebaseOptions(
          apiKey: FirebaseConfig.apiKey,
          appId: FirebaseConfig.windowsAppId,
          messagingSenderId: FirebaseConfig.messagingSenderId,
          projectId: FirebaseConfig.projectId,
          storageBucket: _storageBucket,
        );
      default:
        throw UnsupportedError(
          'Firebase no esta soportado en ${defaultTargetPlatform.name}.',
        );
    }
  }
}
