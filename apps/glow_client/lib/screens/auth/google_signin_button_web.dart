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
///
/// Forma redonda: `icon` (sin texto) + `pill` con ancho 40 = alto 40 del tamaño
/// grande, así el radio de la pastilla es 20 y el resultado es un círculo. El
/// único trabajo del login es centrarlo a 52 px de alto con padding; no se
/// recorta con ClipOval ni se tapa con nada, porque un iframe de GIS tapado u
/// oculto deja de entregar clics (fue el defecto del overlay con opacidad 0.01).
Widget? googleSignInButton() => web_only.renderButton(
      configuration: web_only.GSIButtonConfiguration(
        type: web_only.GSIButtonType.icon,
        theme: web_only.GSIButtonTheme.outline,
        size: web_only.GSIButtonSize.large,
        shape: web_only.GSIButtonShape.pill,
        minimumWidth: 40,
        locale: 'es',
      ),
    );

/// Variante "invisible" del botón de GIS, heredada del diseño anterior.
///
/// NO USAR: un iframe de GIS tapado con opacidad 0.01 no entrega clics. Es el
/// defecto que dejó el login de Google muerto en web hasta 3d9cd99e; el botón
/// visible de arriba (`googleSignInButton`, círculo oficial) es el que funciona.
/// Se conserva sólo porque el login del proveedor todavía la referencia.
Widget? googleSignInOverlay() => web_only.renderButton(
      configuration: web_only.GSIButtonConfiguration(
        type: web_only.GSIButtonType.icon,
        theme: web_only.GSIButtonTheme.outline,
        size: web_only.GSIButtonSize.large,
        // El enum de esta version solo tiene rectangular y pill; el ClipOval
        // del login es quien le da la forma circular.
        shape: web_only.GSIButtonShape.pill,
        minimumWidth: 52,
        locale: 'es',
      ),
    );
