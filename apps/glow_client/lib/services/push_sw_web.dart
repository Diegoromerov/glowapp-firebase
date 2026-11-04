// Registro del service worker en web (con configuracion por query string).
import 'dart:js_interop';

import 'package:web/web.dart' as web;

Future<void> registrarServiceWorkerPush(String query) async {
  await web.window.navigator.serviceWorker
      .register('/firebase-messaging-sw.js?$query'.toJS)
      .toDart;
}
