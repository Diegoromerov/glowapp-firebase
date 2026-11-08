// lib/services/analytics_service.dart
import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'api_service.dart';
import 'auth_service.dart';

class AnalyticsService {
  static final AnalyticsService _instance = AnalyticsService._internal();
  factory AnalyticsService() => _instance;
  AnalyticsService._internal();

  final List<Map<String, dynamic>> _queue = [];
  Timer? _flushTimer;
  bool _isSending = false;

  void init() {
    _startTimer();
    if (kDebugMode) {
      debugPrint('📊 AnalyticsService: medición interna agregada inicializada');
    }
  }

  void logEvent({
    required String eventType,
    required String screenName,
    String? elementId,
    Map<String, dynamic>? metadata,
  }) {
    // Keep only fixed event/screen labels. IDs, amounts, product names,
    // session identifiers and caller-supplied metadata never leave the device.
    if (!RegExp(r'^[A-Z][A-Z0-9_]{0,59}$').hasMatch(eventType)) return;
    final safeScreen = RegExp(r'^/[A-Za-z0-9_./-]{1,100}$').hasMatch(screenName)
        ? screenName
        : '/other';
    final event = {'event_type': eventType, 'screen_name': safeScreen};
    synchronized(() {
      _queue.add(event);
      if (_queue.length > 200) _queue.removeRange(0, _queue.length - 200);
    });
    if (_queue.length >= 10) flushEvents();
  }

  void logScreenView(String screenName, {Map<String, dynamic>? metadata}) {
    logEvent(
      eventType: 'SCREEN_VIEW',
      screenName: screenName,
      metadata: metadata,
    );
  }

  void logAddToCart(
      {required String productId,
      required String productName,
      required double price,
      Map<String, dynamic>? metadata}) {
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

  void logInitiateCheckout(
      {required String itemType,
      required String itemId,
      required double totalAmount,
      Map<String, dynamic>? metadata}) {
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

  void logPurchaseSuccess(
      {required String transactionId,
      required double totalAmount,
      required String paymentMethod,
      Map<String, dynamic>? metadata}) {
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

  void logViewProviderProfile(
      {required String providerId, required String businessName}) {
    logEvent(
      eventType: 'VIEW_PROVIDER_PROFILE',
      screenName: '/provider-detail',
      elementId: providerId,
      metadata: {
        'business_name': businessName,
      },
    );
  }

  void logCourseLessonView(
      {required String courseId,
      required String lessonId,
      required String lessonTitle}) {
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
      if (await AuthService.getToken() == null) return;
      await ApiService.ensureBaseUrl();
      final headers = await ApiService.getAuthHeaders();
      final uri = Uri.parse('${ApiService.baseUrl}/api/analytics/events');

      if (kDebugMode) {
        debugPrint(
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
          debugPrint(
              '📊 AnalyticsService: Lote de ${eventsToSend.length} eventos enviado con éxito');
        }
      } else {
        if (kDebugMode) {
          debugPrint(
              '❌ AnalyticsService: Fallo al enviar lote. Status: ${response.statusCode}. Reencolando...');
        }
        _requeueEvents(eventsToSend);
      }
    } catch (e) {
      if (kDebugMode) {
        debugPrint(
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
