// frontend/lib/screens/auth/google_signin_button_web.dart
import 'dart:js' as js;
import 'package:flutter/material.dart';

/// One Tap (Google Identity Services) - Autenticación automática sin popup.
///
/// Evita COOP porque usa iframe invisible en lugar de popup window.
/// El callback recibe el ID Token directamente.
///
/// Este archivo solo se compila en web (import condicional desde login_screen).

// Función para inicializar One Tap y renderizar el botón personalizado
Widget? googleSignInButton({
  required String clientId,
  required void Function(String idToken) onCredential,
}) {
  // Inicializar One Tap de Google
  _initializeOneTap(clientId, onCredential);

  // Renderizar nuestro botón personalizado (círculo GlowApp)
  // El clic dispará google.accounts.id.prompt() para mostrar One Tap
  return _CustomGoogleButton(onTap: () {
    _promptOneTap();
  });
}

/// Overlay invisible para capturar clics en nuestro botón visual
Widget? googleSignInOverlay() {
  // Con One Tap no necesitamos overlay invisible - nuestro botón llama a prompt()
  return const SizedBox.shrink();
}

/// Inicializa One Tap con el clientId y callback de credenciales
void _initializeOneTap(String clientId, void Function(String) onCredential) {
  final google = js.context['google'];
  if (google == null || google['accounts'] == null || google['accounts']['id'] == null) {
    // GIS library no cargada aún - se reintentará en el botón
    return;
  }

  try {
    // Create callback that bridges to Dart
    final callback = js.allowInterop((credentialResponse) {
      _handleCredential(credentialResponse, onCredential);
    });

    google['accounts']['id'].callMethod('initialize', [
      js.JsObject.jsify({
        'client_id': clientId,
        'callback': callback,
        'auto_select': false,
        'cancel_on_tap_outside': true,
      })
    ]);
  } catch (e) {
    // Silenciar errores de inicialización duplicada
  }
}

/// Dispara el flujo One Tap (muestra el diálogo de Google)
void _promptOneTap() {
  final google = js.context['google'];
  if (google != null && google['accounts'] != null && google['accounts']['id'] != null) {
    try {
      google['accounts']['id'].callMethod('prompt', [js.allowInterop((_) {})]);
    } catch (e) {
      // Silenciar
    }
  }
}

/// Procesa la respuesta de credencial de One Tap
Future<void> _handleCredential(credentialResponse, void Function(String) onCredential) async {
  try {
    final idToken = credentialResponse['credential'];
    if (idToken != null && idToken is String && idToken.isNotEmpty) {
      onCredential(idToken);
    }
  } catch (e) {
    // Silenciar
  }
}

/// Botón personalizado estilo GlowApp (círculo dorado)
class _CustomGoogleButton extends StatelessWidget {
  final VoidCallback onTap;

  const _CustomGoogleButton({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 52,
        height: 52,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: const Color(0xFFF3D59B), // Dorado GlowApp
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.15),
              blurRadius: 8,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: const Center(
          child: Icon(
            Icons.g_mobiledata,
            color: Color(0xFF1F1A15),
            size: 28,
          ),
        ),
      ),
    );
  }
}