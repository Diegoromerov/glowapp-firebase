// frontend/lib/services/notification_service.dart
import 'dart:async';
import 'package:flutter/material.dart';
import '../shared/theme.dart';

class NotificationService {
  static final NotificationService _instance = NotificationService._internal();
  factory NotificationService() => _instance;

  // A360-2026-09-22/C-08: el constructor ya NO arranca un generador de
  // notificaciones falsas cada 45 s (ofertas y nombres inventados) cuyo timer
  // nunca se cancelaba. La única instancia de navigatorKey vive aquí y la
  // comparte el MaterialApp (ver main.dart y GlowGuideService).
  NotificationService._internal();

  static final GlobalKey<NavigatorState> navigatorKey =
      GlobalKey<NavigatorState>();

  final StreamController<Map<String, dynamic>> _notificationController =
      StreamController<Map<String, dynamic>>.broadcast();

  Stream<Map<String, dynamic>> get notificationsStream =>
      _notificationController.stream;

  /// Publica una notificación in-app con datos REALES aportados por quien la
  /// dispara (p. ej. una validación médica que sí ocurrió). No inventa
  /// contenido: sin datos reales no hay notificación (A360-2026-09-22/C-08).
  void notify({required String title, required String body}) {
    if (title.trim().isEmpty || body.trim().isEmpty) return;
    final notification = {
      'id': DateTime.now().millisecondsSinceEpoch.toString(),
      'title': title,
      'body': body,
      'timestamp': DateTime.now().toIso8601String(),
    };
    _notificationController.add(notification);
    showInAppNotification(notification);
  }

  void showInAppNotification(Map<String, dynamic> notification) {
    final context = navigatorKey.currentState?.overlay?.context;
    if (context == null) return;

    final overlayState = navigatorKey.currentState?.overlay;
    if (overlayState == null) return;

    late OverlayEntry overlayEntry;
    overlayEntry = OverlayEntry(
      builder: (context) {
        return Positioned(
          top: MediaQuery.of(context).padding.top + 10,
          left: 16,
          right: 16,
          child: Material(
            color: Colors.transparent,
            child: TweenAnimationBuilder<double>(
              duration: const Duration(milliseconds: 300),
              tween: Tween(begin: 0.0, end: 1.0),
              builder: (context, value, child) {
                return Transform.translate(
                  offset: Offset(0, -20 * (1.0 - value)),
                  child: Opacity(
                    opacity: value,
                    child: child,
                  ),
                );
              },
              child: Container(
                decoration: BoxDecoration(
                  color: AppTheme.background.withOpacity(0.95),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: AppTheme.primary.withOpacity(0.3),
                    width: 1.5,
                  ),
                  boxShadow: AppTheme.cardShadow,
                ),
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: const BoxDecoration(
                        color: Color(0xFFFFF8F0),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.notifications_active,
                        color: AppTheme.primary,
                        size: 24,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            notification['title'] ?? 'Notificación',
                            style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 14,
                              color: AppTheme.info,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            notification['body'] ?? '',
                            style: const TextStyle(
                              fontSize: 12,
                              color: Colors.black87,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      icon:
                          const Icon(Icons.close, size: 18, color: Colors.grey),
                      onPressed: () {
                        overlayEntry.remove();
                      },
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );

    overlayState.insert(overlayEntry);

    Timer(const Duration(seconds: 4), () {
      if (overlayEntry.mounted) {
        overlayEntry.remove();
      }
    });
  }

  void dispose() {
    _notificationController.close();
  }
}
