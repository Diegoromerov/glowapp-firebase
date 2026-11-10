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
