// Registro del dispositivo para notificaciones push (FCM).
//
// FCM es gratuito y es el canal que faltaba: el código de confirmación ya se ve
// en la app, pero el cliente necesita enterarse de que el servicio terminó. El
// token se envía al backend, que lo guarda en `usuarios.fcm_token`.
//
// Nada de esto puede romper el arranque: si el usuario niega el permiso, si el
// navegador no soporta push o si Firebase no está configurado, se sigue igual.
import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:glow_core/services.dart';

import '../firebase_options.dart';
import 'push_sw_stub.dart' if (dart.library.js_interop) 'push_sw_web.dart';

class PushService {
  /// Clave VAPID pública del proyecto (las VAPID son públicas por diseño: el
  /// secreto es la privada, que solo tiene Firebase).
  static const String _vapidKey =
      'BPesRggflU9ZV1O0hRwynJoXNEvF3eXUVvhtWZDRoGUOob8dsD-4XS6oX2FIszHQOiRJN8IewGtO4syKTkd3m7s';

  static bool _listo = false;

  /// Pide permiso, obtiene el token y lo registra en el backend.
  /// Se llama después del login: sin usuario no hay a quién notificar.
  static Future<void> iniciar() async {
    if (_listo) return;
    if (!DefaultFirebaseOptions.estaConfigurado) {
      debugPrint('PushService: Firebase sin configurar en este build');
      return;
    }

    try {
      if (kIsWeb) await _registrarServiceWorker();

      final messaging = FirebaseMessaging.instance;
      final permisos = await messaging.requestPermission();
      if (permisos.authorizationStatus == AuthorizationStatus.denied) {
        debugPrint('PushService: permiso denegado');
        return;
      }

      final token = await messaging.getToken(
        vapidKey: kIsWeb ? _vapidKey : null,
      );
      if (token == null || token.isEmpty) return;

      await _registrar(token);
      _listo = true;

      // El token rota: sin esto las notificaciones dejan de llegar en silencio.
      messaging.onTokenRefresh.listen(_registrar);
      FirebaseMessaging.onMessage.listen(_enPrimerPlano);
    } catch (e) {
      debugPrint('PushService: $e');
    }
  }

  static Future<void> _registrar(String token) async {
    try {
      await ApiService.registerFcmToken(token, kIsWeb ? 'web' : 'mobile');
    } catch (e) {
      debugPrint('PushService: no se pudo registrar el token: $e');
    }
  }

  /// En web el token exige un service worker registrado en el alcance raíz.
  static Future<void> _registrarServiceWorker() async {
    final params = Uri(queryParameters: {
      'apiKey': FirebaseConfig.apiKey,
      'projectId': FirebaseConfig.projectId,
      'messagingSenderId': FirebaseConfig.messagingSenderId,
      'appId': FirebaseConfig.webAppId,
    }).query;
    // FCM en web exige un service worker en el alcance raíz; su configuración
    // viaja en la query para no dejar claves en un archivo estático.
    await registrarServiceWorkerPush(params);
  }

  /// Con la app en primer plano FCM no pinta la notificación: se ignora a
  /// propósito porque el aviso relevante ya se ve en la pantalla de citas.
  static void _enPrimerPlano(RemoteMessage message) {
    debugPrint('PushService: ${message.notification?.title ?? message.data}');
  }
}
