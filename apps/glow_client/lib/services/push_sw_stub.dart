// Sin web no hay service worker: no-op para que el código compile en móvil.
Future<void> registrarServiceWorkerPush(String query) async {}

/// En móvil la suscripción la gestiona el SDK del sistema: siempre "hay".
Future<bool> haySuscripcionPush() async => true;
