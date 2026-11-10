// Registro del service worker en web (con configuracion por query string).
import 'dart:js_interop';

import 'package:web/web.dart' as web;

Future<void> registrarServiceWorkerPush(String query) async {
  // El alcance importa: `/firebase-cloud-messaging-push-scope` es el que usa el
  // SDK de Firebase. En `/` pelea con el service worker de Flutter (solo cabe
  // uno por alcance) y los push se pierden: en consola se veía como
  // "Updating service worker" y "prepareServiceWorker took more than 4000ms".
  await web.window.navigator.serviceWorker
      .register(
        '/firebase-messaging-sw.js?$query'.toJS,
        web.RegistrationOptions(
          scope: '/firebase-cloud-messaging-push-scope',
        ),
      )
      .toDart;
}

/// ¿La registración de FCM tiene una suscripción push viva?
///
/// Es la comprobación que faltaba: un token FCM puede seguir existiendo en la
/// caché del SDK mientras la suscripción que lo respaldaba desapareció (por
/// ejemplo al mover el service worker de alcance, porque una suscripción muere
/// con su registración). FCM acepta el envío —tiene un token— y no hay nada al
/// otro lado que reciba el push.
Future<bool> haySuscripcionPush() async {
  try {
    final regs = await web.window.navigator.serviceWorker.getRegistrations().toDart;
    for (final r in regs.toDart) {
      if (!r.scope.contains('firebase-cloud-messaging-push-scope')) continue;
      final sub = await r.pushManager.getSubscription().toDart;
      return sub != null;
    }
    return false;
  } catch (_) {
    // Si no se puede comprobar, no se fuerza nada: mejor un push dudoso que
    // borrar el token en cada arranque.
    return true;
  }
}
