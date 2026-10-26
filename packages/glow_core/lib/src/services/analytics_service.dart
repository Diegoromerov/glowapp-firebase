// lib/services/analytics_service.dart
import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'api_service.dart';
import 'auth_service.dart';

class AnalyticsService {
  static final AnalyticsService _instance = AnalyticsService._internal();
  factory AnalyticsService() => _instance;
  AnalyticsService._internal();

  String? _sessionId;
  String get sessionId => _sessionId ??= _generateUUIDv4();
  set sessionId(String value) => _sessionId = value;
  final List<Map<String, dynamic>> _queue = [];
  Timer? _flushTimer;
  bool _isSending = false;
  bool? _telemetryEnabledCache;
  DateTime? _cacheTimestamp;
  static const Duration _cacheValidity = Duration(minutes: 5);

  void init() {
    sessionId = _generateUUIDv4();
    _startTimer();
    if (kDebugMode) {
      print('📊 AnalyticsService: Inicializado con Session ID $sessionId');
    }
  }

  Future<bool> _getTelemetryEnabled() async {
      // Verificar cache primero
      if (_telemetryEnabledCache != null &&
          _cacheTimestamp != null &&
          DateTime.now().difference(_cacheTimestamp!) < _cacheValidity) {
        return _telemetryEnabledCache!;
      }

      try {
        // Si no hay usuario logueado, por defecto permitir telemetría (comportamiento anterior)
        final token = await AuthService.getToken();
        if (token == null || token.isEmpty) {
          _telemetryEnabledCache = true;
          _cacheTimestamp = DateTime.now();
          return true;
        }

        final headers = await ApiService.getAuthHeaders();
        final uri = Uri.parse('${ApiService.baseUrl}/api/users/preferences');
        final response = await http.get(uri, headers: headers).timeout(const Duration(seconds: 10));
      
        if (response.statusCode == 200) {
          final data = json.decode(response.body);
          _telemetryEnabledCache = data['data']?['telemetry_enabled'] ?? true;
        } else {
          _telemetryEnabledCache = true; // Default a true si falla
        }
      } catch (e) {
        if (kDebugMode) {
          print('⚠️ AnalyticsService: Error obteniendo preferencia telemetría, default true: $e');
        }
        _telemetryEnabledCache = true;
      }
    
      _cacheTimestamp = DateTime.now();
      return _telemetryEnabledCache!;
    }

  void invalidateTelemetryCache() {
    _telemetryEnabledCache = null;
    _cacheTimestamp = null;
  }

  void logEvent({
    required String eventType,
    required String screenName,
    String? elementId,
    Map<String, dynamic>? metadata,
  }) {
    _getTelemetryEnabled().then((enabled) {
      if (!enabled) {
        if (kDebugMode) {
          print('📊 AnalyticsService: Telemetría deshabilitada por preferencia de usuario, evento [$eventType] descartado');
        }
        return;
      }

      final event = {
        'session_id': sessionId,
        'event_type': eventType,
        'screen_name': screenName,
        'element_id': elementId,
        'metadata': metadata,
        'creado_en': DateTime.now().toUtc().toIso8601String(),
      };

      synchronized(() {
        _queue.add(event);
        if (kDebugMode) {
          print(
              '📊 AnalyticsService: Evento encolado [$eventType] en screen [$screenName]. Cola: ${_queue.length}');
        }
      });

      // Enviar inmediatamente si superamos el umbral
      if (_queue.length >= 10) {
        flushEvents();
      }
    });
  }

  void logScreenView(String screenName, {Map<String, dynamic>? metadata}) {
    logEvent(
      eventType: 'SCREEN_VIEW',
      screenName: screenName,
      metadata: metadata,
    );
  }

  void logAddToCart({required String productId, required String productName, required double price, Map<String, dynamic>? metadata}) {
    logEvent(
      eventType: 'ADD_TO_CART',
      screenName: '/store',
      elementId: productId,
      metadata: {
        'product_name': productName,
        'price': price,
        ...?metadata,
      },
    );
  }

  void logInitiateCheckout({required String itemType, required String itemId, required double totalAmount, Map<String, dynamic>? metadata}) {
    logEvent(
      eventType: 'INITIATE_CHECKOUT',
      screenName: '/checkout',
      elementId: itemId,
      metadata: {
        'item_type': itemType, // 'service' | 'product' | 'course'
        'total_amount': totalAmount,
        ...?metadata,
      },
    );
  }

  void logPurchaseSuccess({required String transactionId, required double totalAmount, required String paymentMethod, Map<String, dynamic>? metadata}) {
    logEvent(
      eventType: 'PURCHASE_SUCCESS',
      screenName: '/payment-success',
      elementId: transactionId,
      metadata: {
        'transaction_id': transactionId,
        'total_amount': totalAmount,
        'payment_method': paymentMethod,
        ...?metadata,
      },
    );
  }

  void logViewProviderProfile({required String providerId, required String businessName}) {
    logEvent(
      eventType: 'VIEW_PROVIDER_PROFILE',
      screenName: '/provider-detail',
      elementId: providerId,
      metadata: {
        'business_name': businessName,
      },
    );
  }

  void logCourseLessonView({required String courseId, required String lessonId, required String lessonTitle}) {
    logEvent(
      eventType: 'COURSE_LESSON_VIEW',
      screenName: '/course-detail',
      elementId: lessonId,
      metadata: {
        'course_id': courseId,
        'lesson_title': lessonTitle,
      },
    );
  }

  Future<void> flushEvents() async {
    if (_queue.isEmpty || _isSending) return;

    List<Map<String, dynamic>> eventsToSend = [];
    synchronized(() {
      _isSending = true;
      eventsToSend = List<Map<String, dynamic>>.from(_queue);
      _queue.clear();
    });

    try {
      await ApiService.ensureBaseUrl();
      final headers = await ApiService.getAuthHeaders();
      final uri = Uri.parse('${ApiService.baseUrl}/api/analytics/events');

      if (kDebugMode) {
        print(
            '📊 AnalyticsService: Enviando ${eventsToSend.length} eventos al servidor...');
      }

      final response = await http
          .post(
            uri,
            headers: headers,
            body: json.encode({'events': eventsToSend}),
          )
          .timeout(const Duration(seconds: 15));

      if (response.statusCode == 201 || response.statusCode == 200) {
        if (kDebugMode) {
          print(
              '📊 AnalyticsService: Lote de ${eventsToSend.length} eventos enviado con éxito');
        }
      } else {
        if (kDebugMode) {
          print(
              '❌ AnalyticsService: Fallo al enviar lote. Status: ${response.statusCode}. Reencolando...');
        }
        _requeueEvents(eventsToSend);
      }
    } catch (e) {
      if (kDebugMode) {
        print(
            '❌ AnalyticsService: Error de conexión enviando analíticas: $e. Reencolando...');
      }
      _requeueEvents(eventsToSend);
    } finally {
      _isSending = false;
    }
  }

  void _requeueEvents(List<Map<String, dynamic>> failedEvents) {
    synchronized(() {
      // Reinsertar al inicio para preservar orden relativo si es posible
      _queue.insertAll(0, failedEvents);
      // Evitar crecimiento infinito de la cola si el servidor cae permanentemente (limitar a 200)
      if (_queue.length > 200) {
        _queue.removeRange(200, _queue.length);
      }
    });
  }

  void _startTimer() {
    _flushTimer?.cancel();
    _flushTimer = Timer.periodic(const Duration(seconds: 10), (_) {
      flushEvents();
    });
  }

  void dispose() {
    _flushTimer?.cancel();
    flushEvents(); // Intento de flush final
  }

  // Generador de UUID v4 nativo y seguro
  String _generateUUIDv4() {
    final random = Random.secure();
    final values = List<int>.generate(16, (i) => random.nextInt(256));

    // Set version to 4 (0100)
    values[6] = (values[6] & 0x0f) | 0x40;
    // Set variant to RFC 4122 (10xx)
    values[8] = (values[8] & 0x3f) | 0x80;

    final buffer = StringBuffer();
    for (var i = 0; i < 16; i++) {
      if (i == 4 || i == 6 || i == 8 || i == 10) {
        buffer.write('-');
      }
      buffer.write(values[i].toRadixString(16).padLeft(2, '0'));
    }
    return buffer.toString();
  }

  // Sincronización simple para hilos/async
  void synchronized(VoidCallback action) {
    lockAction() {
      action();
    }

    lockAction();
  }
}

// Observador para capturar cambios de pantallas automáticamente
class AnalyticsRouteObserver extends NavigatorObserver {
  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didPush(route, previousRoute);
    _logScreenView(route);
  }

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    super.didReplace(newRoute: newRoute, oldRoute: oldRoute);
    if (newRoute != null) {
      _logScreenView(newRoute);
    }
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didPop(route, previousRoute);
    if (previousRoute != null) {
      _logScreenView(previousRoute);
    }
  }

  void _logScreenView(Route<dynamic> route) {
    final screenName = route.settings.name;
    if (screenName != null && screenName.isNotEmpty) {
      AnalyticsService().logScreenView(screenName);
    }
  }
}