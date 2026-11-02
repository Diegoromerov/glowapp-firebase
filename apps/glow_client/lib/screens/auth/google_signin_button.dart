import 'package:flutter/widgets.dart';

/// Fuera de web no existe el botón de Google Identity Services: devolvemos null
/// y la pantalla de login usa su botón propio, que llama a `GoogleSignIn.signIn()`.
///
/// La variante web está en `google_signin_button_web.dart` y se elige por
/// import condicional (`if (dart.library.js)`), igual que hace glow_core con
/// connectivity_probe.
Widget? googleSignInButton() => null;

/// En móvil/desktop no hay iframe de GIS: el control propio del login llama a
/// `GoogleSignIn.signIn()` directamente, así que no hace falta overlay.
Widget? googleSignInOverlay() => null;
