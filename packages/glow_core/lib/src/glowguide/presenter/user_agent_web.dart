// Implementación web del user-agent.
//
// Solo se compila cuando dart.library.js está disponible (dart2js/dartdevc).
// `package:web` depende de `dart:js_interop`, que NO existe en la VM: por eso
// este import jamás puede ser incondicional en código compartido, o
// `flutter test` falla con "Dart library 'dart:js_interop' is not available".
import 'package:web/web.dart' as web;

String userAgent() => web.window.navigator.userAgent;
