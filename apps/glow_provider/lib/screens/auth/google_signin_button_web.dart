import 'package:flutter/widgets.dart';
import 'package:google_sign_in_web/web_only.dart' as web_only;

/// Botón oficial de Google Identity Services.
///
/// Por qué este botón y no `GoogleSignIn.signIn()`: en google_sign_in_web 0.12
/// `signIn()` ya no entrega credenciales en web. Abre el popup de OAuth, el
/// cross-origin-opener-policy bloquea la detección de `window.closed` y la
/// promesa expira sin usuario. El único flujo soportado es renderizar el botón
/// de GIS y escuchar `GoogleSignIn.onCurrentUserChanged`.
///
/// Este archivo sólo se compila en web (import condicional desde login_screen).
Widget? googleSignInButton() => web_only.renderButton(
      configuration: web_only.GSIButtonConfiguration(
        type: web_only.GSIButtonType.standard,
        theme: web_only.GSIButtonTheme.outline,
        size: web_only.GSIButtonSize.large,
        text: web_only.GSIButtonText.continueWith,
        shape: web_only.GSIButtonShape.rectangular,
        minimumWidth: 120,
        locale: 'es',
      ),
    );
