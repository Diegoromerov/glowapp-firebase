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

import 'notificacion_web.dart'
    if (dart.library.js_interop) 'notificacion_web_web.dart' as notif_web;
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:glow_core/services.dart';

import '../firebase_options.dart';
import 'push_sw_stub.dart' if (dart.library.js_interop) 'push_sw_web.dart';

class PushService {
  /// Clave VAPID pública del proyecto (las VAPID son públicas por diseño: el
  /// secreto es la privada, que solo tiene Firebase).
  static const String _vapidKey =
      'BPesRggflU9ZV1O0hRwynJoXNEvF3eXUVvhtWZDRoGUOob8dsD-4XS6oX2FIszHQOiRJN8IewGtO4syKTkd3m7s';

  static bool _listo = false;
  static final FlutterLocalNotificationsPlugin _localNotifications =
      FlutterLocalNotificationsPlugin();

  /// Pide permiso, obtiene el token y lo registra en el backend.
  /// Se llama después del login: sin usuario no hay a quién notificar.
  ///
  /// [forzar] reintenta aunque ya se haya intentado antes: lo usa el botón
  /// manual de Ajustes, porque Chrome ignora una petición de permiso que no
  /// viene de un gesto del usuario y no muestra ningún diálogo.
  static Future<void> iniciar({bool forzar = false}) async {
    if (_listo && !forzar) return;
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

      if (!kIsWeb) {
        await messaging.setForegroundNotificationPresentationOptions(
          alert: true,
          badge: true,
          sound: true,
        );
        await _localNotifications.initialize(
          const InitializationSettings(
            android: AndroidInitializationSettings('@mipmap/ic_launcher'),
            iOS: DarwinInitializationSettings(),
          ),
        );
      }

      final token = await messaging.getToken(
        vapidKey: kIsWeb ? _vapidKey : null,
      );
      if (token == null || token.isEmpty) return;

      await _registrar(token);
      _listo = true;

      // El token rota: sin esto las notificaciones dejan de llegar en silencio.
      messaging.onTokenRefresh.listen(_registrar);
      FirebaseMessaging.onMessage.listen((message) => _enPrimerPlano(message, messaging));
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
  /// Estado actual del permiso de notificaciones.
  static Future<AuthorizationStatus> estadoPermiso() async {
    try {
      final s = await FirebaseMessaging.instance.getNotificationSettings();
      return s.authorizationStatus;
    } catch (_) {
      return AuthorizationStatus.notDetermined;
    }
  }

  /// Activa las notificaciones desde un gesto del usuario (Ajustes).
  static Future<bool> activarDesdeBoton() async {
    await iniciar(forzar: true);
    final estado = await estadoPermiso();
    return estado == AuthorizationStatus.authorized ||
        estado == AuthorizationStatus.provisional;
  }

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

  /// En primer plano iOS presenta el aviso nativamente; Android requiere
  /// mostrarlo con flutter_local_notifications. Nunca se incluye el código.
  static Future<void> _enPrimerPlano(
    RemoteMessage message,
    FirebaseMessaging messaging,
  ) async {
    debugPrint('PushService: ${message.notification?.title ?? message.data}');
    // En web el push en primer plano NO lo pinta el service worker: si aquí no
    // se hace nada, el usuario no ve la notificación aunque FCM la entregó.
    if (kIsWeb) {
      final n = message.notification;
      if (n != null) notif_web.mostrarNotificacionWeb(n.title ?? 'GlowApp', n.body ?? '');
      return;
    }
    if (message.notification == null) return;
    if (defaultTargetPlatform == TargetPlatform.iOS) return;
    const androidDetails = AndroidNotificationDetails(
      'glowapp_updates',
      'Actualizaciones de GlowApp',
      channelDescription: 'Avisos de citas y confirmaciones',
      importance: Importance.high,
      priority: Priority.high,
    );
    await _localNotifications.show(
      message.hashCode,
      message.notification!.title,
      message.notification!.body,
      const NotificationDetails(android: androidDetails),
    );
  }
}
