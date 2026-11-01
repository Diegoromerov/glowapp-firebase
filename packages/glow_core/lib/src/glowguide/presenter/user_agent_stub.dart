// Implementación neutra: fuera de web no hay user-agent de navegador.
//
// Se elige por import condicional desde glowguide_presenter.dart:
//   import 'user_agent_stub.dart' if (dart.library.js) 'user_agent_web.dart';
//
// Devolver cadena vacía es correcto: en VM (tests, iOS, Android, desktop) el
// presentador no consulta el user-agent, usa defaultTargetPlatform.
String userAgent() => '';
