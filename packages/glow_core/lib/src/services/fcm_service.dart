// frontend/lib/services/fcm_service.dart
// Servicio de Push Notifications (FCM) - registro de token, manejo foreground/background, deep-links.
import 'dart:async';
import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
// `debugPrint` y `defaultTargetPlatform` viven en flutter/foundation.dart, la
// MISMA librería que `kIsWeb`: por eso van en este import. Si se deja sólo
// `kIsWeb` en el `show`, el archivo no compila (10 usos de debugPrint y 2 de
// defaultTargetPlatform quedan sin resolver).
import 'package:flutter/foundation.dart'
    show kIsWeb, debugPrint, defaultTargetPlatform;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'api_service.dart';
import 'secure_storage_service.dart';

/// Claves de notificación local (Android/iOS)
const String _notificationChannelId = 'glowapp_default';
const String _notificationChannelName = 'GlowApp Notificaciones';
const String _notificationChannelDescription = 'Notificaciones de citas, pagos y alertas de GlowApp';

/// Payload esperado del backend para deep-linking
class FcmPayload {
  final String type;
  final Map<String, dynamic> data;

  FcmPayload({required this.type, required this.data});

  factory FcmPayload.fromMap(Map<String, dynamic> map) {
    return FcmPayload(
      type: map['type']?.toString() ?? 'unknown',
      data: Map<String, dynamic>.from(map['data'] ?? {}),
    );
  }
}

/// Callbacks de navegación que la app puede sobrescribir
typedef OnPayloadTap = Future<void> Function(FcmPayload payload);

class FcmService {
  FcmService._internal();
  static final FcmService instance = FcmService._internal();

  // PEREZOSO a proposito. `FirebaseMessaging.instance` busca la app '[DEFAULT]' de
  // Firebase y lanza [core/no-app] si no existe. Evaluado como inicializador de campo
  // estalla al CONSTRUIR el singleton -- o sea al pedir FcmService.instance en main(),
  // antes de runApp -- con lo que la app entera quedaba en pantalla en blanco en un
  // build sin configuracion. Con `??=` no se toca Firebase hasta que de verdad se usa.
  FirebaseMessaging? _messagingPerezoso;
  FirebaseMessaging get _messaging =>
      _messagingPerezoso ??= FirebaseMessaging.instance;
  final FlutterLocalNotificationsPlugin _localNotifications = FlutterLocalNotificationsPlugin();

  bool _initialized = false;
  OnPayloadTap? _onPayloadTap;
  StreamSubscription<RemoteMessage>? _messageSub;
  StreamSubscription<RemoteMessage>? _backgroundMessageSub;

  /// Inicializa Firebase, solicita permisos, registra token y configura handlers.
  /// Debe llamarse **temprano** en `main()` antes de `runApp`.
  /// 
  /// [firebaseConfigured] - Indica si Firebase está configurado para este build.
  /// Las apps deben pasar `true` si tienen firebase_options.dart configurado.
  Future<void> initialize({
    required OnPayloadTap onPayloadTap,
    bool firebaseConfigured = true,
  }) async {
    if (_initialized) return;

    _onPayloadTap = onPayloadTap;

    // Sin configuracion de Firebase no hay nada que inicializar.
    if (!firebaseConfigured) {
      debugPrint(
        'FCM deshabilitado: Firebase no esta configurado en este build.',
      );
      return;
    }

    // 1. Inicializar Firebase Core (no-op si ya se hizo)
    try {
      await Firebase.initializeApp();
    } catch (_) {
      // Ya inicializado
    }

    // 2. Configurar notificaciones locales (Android/iOS)
    await _initLocalNotifications();

    // 3. Solicitar permisos (iOS/web)
    await _requestPermissions();

    // 4. Obtener y registrar token FCM
    final tokenRegistrado = await _registerToken();

    // 5. Listener de mensajes en foreground
    _messageSub = FirebaseMessaging.onMessage.listen(_handleForegroundMessage);

    // 6. Listener cuando la app se abre desde notification (background -> foreground)
    _backgroundMessageSub = FirebaseMessaging.onMessageOpenedApp.listen(_handleBackgroundTap);

    // 7. Si la app fue terminada y se abre por notification
    final initialMessage = await _messaging.getInitialMessage();
    if (initialMessage != null) {
      _handleBackgroundTap(initialMessage);
    }

    // 8. Refresh token callback
    _messaging.onTokenRefresh.listen(_onTokenRefresh);

    _initialized = true;
    // El mensaje debe decir la verdad: si el token no se registro, no hay push.
    debugPrint(tokenRegistrado
        ? 'FCM Service inicializado (token registrado)'
        : 'FCM Service inicializado SIN token: no llegaran notificaciones');
  }

  /// Solicita permisos de notificación (iOS, Web)
  Future<void> _requestPermissions() async {
    if (kIsWeb) {
      // En web, getToken() pide permiso internamente
      return;
    }

    final settings = await _messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
      provisional: false,
      carPlay: false,
      criticalAlert: false,
    );
    debugPrint('Permisos FCM: ${settings.authorizationStatus}');
  }

  /// Inicializa flutter_local_notifications (canal Android, permisos iOS)
  Future<void> _initLocalNotifications() async {
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosInit = DarwinInitializationSettings(
      requestAlertPermission: false, // ya pedimos con FCM
      requestBadgePermission: false,
      requestSoundPermission: false,
    );
    const initSettings = InitializationSettings(android: androidInit, iOS: iosInit);

    await _localNotifications.initialize(
      initSettings,
      onDidReceiveNotificationResponse: (details) {
        _handleLocalNotificationTap(details.payload);
      },
    );

    // Crear canal Android (requerido en Android 8+)
    const androidChannel = AndroidNotificationChannel(
      _notificationChannelId,
      _notificationChannelName,
      description: _notificationChannelDescription,
      importance: Importance.high,
      playSound: true,
    );
    await _localNotifications
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(androidChannel);
  }

  /// Obtiene token FCM y lo envía al backend (público para uso desde AuthService)
  Future<void> registerToken() async {
    await _registerToken();
  }

  /// Obtiene token FCM y lo envía al backend
  /// Devuelve true SOLO si el token quedo registrado: quien llame no debe
  /// cantar exito si esto devuelve false.
  Future<bool> _registerToken() async {
    try {
      String? token;
      if (kIsWeb) {
        // Web SIEMPRE exige VAPID key (Firebase Console -> Cloud Messaging ->
        // Web configuration). Sin ella getToken() falla con un error opaco de
        // service worker, asi que se comprueba antes y se dice que falta.
        const vapidKey = String.fromEnvironment('FCM_VAPID_KEY');
        if (vapidKey.isEmpty) {
          debugPrint('FCM web sin FCM_VAPID_KEY: no se puede obtener token. '
              'Definela en el servicio y pasala al build por --dart-define.');
          return false;
        }
        token = await _messaging.getToken(vapidKey: vapidKey);
      } else {
        token = await _messaging.getToken();
      }

      if (token != null && token.isNotEmpty) {
        await _sendTokenToBackend(token);
        debugPrint('FCM Token registrado: ${token.substring(0, 20)}...');
        return true;
      }

      debugPrint('FCM Token vacío');
      return false;
    } catch (e) {
      debugPrint('Error obteniendo/registrando FCM token: $e');
      return false;
    }
  }

  /// Envía el token al backend (POST /api/auth/fcm-token)
  Future<void> _sendTokenToBackend(String token) async {
    final authToken = await SecureStorageService().read('token');
    if (authToken == null) {
      debugPrint('No hay auth token, no se puede registrar FCM token');
      return;
    }

    try {
      await ApiService.post('/api/auth/fcm-token', {
        'fcm_token': token,
        'device_os': kIsWeb ? 'web' : (defaultTargetPlatform.name), // android / ios / linux / macos / windows / fuchsia
      });
    } catch (e) {
      debugPrint('Error enviando FCM token al backend: $e');
    }
  }

  /// Callback cuando FCM refresca el token
  void _onTokenRefresh(String newToken) {
    debugPrint('FCM Token refrescado');
    _sendTokenToBackend(newToken);
  }

  /// Maneja mensaje recibido con app en foreground
  void _handleForegroundMessage(RemoteMessage message) {
    debugPrint('FCM Foreground: ${message.messageId} - ${message.notification?.title}');

    // Mostrar notificación local (para que se vea en bandeja aunque app esté abierta)
    _showLocalNotification(message);

    // Si hay callback de navegación, NO navegar automáticamente en foreground
    // (el usuario decide si toca la notificación)
  }

  /// Maneja tap en notificación (app en background/killed -> foreground)
  void _handleBackgroundTap(RemoteMessage message) {
    debugPrint('FCM Background tap: ${message.messageId}');
    _navigateFromPayload(message.data);
  }

  /// Maneja tap en notificación local (flutter_local_notifications)
  void _handleLocalNotificationTap(String? payloadStr) {
    if (payloadStr == null || payloadStr.isEmpty) return;
    try {
      final payload = json.decode(payloadStr) as Map<String, dynamic>;
      _navigateFromPayload(payload);
    } catch (_) {}
  }

  /// Navega según payload del mensaje
  void _navigateFromPayload(Map<String, dynamic> data) {
    final payload = FcmPayload.fromMap(data);
    _onPayloadTap?.call(payload);
  }

  /// Muestra notificación local (flutter_local_notifications)
  Future<void> _showLocalNotification(RemoteMessage message) async {
    final title = message.notification?.title ?? 'GlowApp';
    final body = message.notification?.body ?? '';
    final payload = json.encode(message.data);

    const androidDetails = AndroidNotificationDetails(
      _notificationChannelId,
      _notificationChannelName,
      channelDescription: _notificationChannelDescription,
      importance: Importance.high,
      priority: Priority.high,
      playSound: true,
      icon: '@mipmap/ic_launcher',
    );
    const iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
    );
    const details = NotificationDetails(android: androidDetails, iOS: iosDetails);

    await _localNotifications.show(
      message.messageId?.hashCode ?? DateTime.now().millisecondsSinceEpoch,
      title,
      body,
      details,
      payload: payload,
    );
  }

  /// Limpieza al logout
  Future<void> clearTokenOnLogout() async {
    final authToken = await SecureStorageService().read('token');
    if (authToken != null) {
      try {
        // Opcional: notificar al backend que el token ya no es válido
        await ApiService.post('/api/auth/fcm-token', {
          'fcm_token': '',
          'device_os': kIsWeb ? 'web' : defaultTargetPlatform.name,
        });
      } catch (_) {}
    }
    // El token FCM en dispositivo se invalida solo; al próximo login se registrará uno nuevo.
  }

  void dispose() {
    _messageSub?.cancel();
    _backgroundMessageSub?.cancel();
    _initialized = false;
  }
}
