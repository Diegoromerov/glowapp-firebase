// frontend/lib/screens/auth/google_signin_button_web.dart
import 'dart:async';
import 'dart:js' as js;

import 'package:flutter/material.dart';

/// One Tap (Google Identity Services) - autenticación sin popup.
///
/// Evita COOP: no abre ventana, usa el prompt de GIS y entrega el ID token por
/// el callback de `initialize()`.
///
/// Este archivo solo se compila en web (import condicional desde login_screen).

Widget? googleSignInButton({
  required String clientId,
  required void Function(String idToken) onCredential,
}) =>
    _GoogleOneTapButton(
      clientId: clientId,
      onCredential: onCredential,
    );

/// Overlay invisible: no aplica. El botón propio llama a `prompt()`.
Widget? googleSignInOverlay() => const SizedBox.shrink();

class _GoogleOneTapButton extends StatefulWidget {
  const _GoogleOneTapButton({
    required this.clientId,
    required this.onCredential,
  });

  final String clientId;
  final ValueChanged<String> onCredential;

  @override
  State<_GoogleOneTapButton> createState() => _GoogleOneTapButtonState();
}

class _GoogleOneTapButtonState extends State<_GoogleOneTapButton> {
  bool _initialized = false;
  bool _promptPending = false;

  @override
  void initState() {
    super.initState();
    // Una sola vez por ciclo de vida: llamar initialize() en cada build dispara
    // "google.accounts.id.initialize() is called multiple times" y GIS sólo
    // conserva la última configuración.
    _initialize();
  }

  @override
  void didUpdateWidget(covariant _GoogleOneTapButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.clientId != widget.clientId) {
      _initialized = false;
      _initialize();
    }
  }

  bool get _gisReady {
    final google = js.context['google'];
    return google != null &&
        google['accounts'] != null &&
        google['accounts']['id'] != null;
  }

  void _initialize() {
    if (_initialized || widget.clientId.isEmpty || !_gisReady) return;
    try {
      final callback = (credentialResponse) {
        _promptPending = false;
        final credential =
            credentialResponse == null ? null : credentialResponse['credential'];
        if (credential is String && credential.isNotEmpty) {
          widget.onCredential(credential);
        }
      };
      js.context['google']['accounts']['id'].callMethod('initialize', [
        js.JsObject.jsify({
          'client_id': widget.clientId,
          'callback': callback,
          'auto_select': false,
          'cancel_on_tap_outside': true,
          // One Tap usa use_fedcm_for_prompt; use_fedcm_for_button es del Botón.
          'use_fedcm_for_prompt': true,
        }),
      ]);
      _initialized = true;
    } catch (_) {
      // GIS aún no listo: se reintenta en el siguiente toque.
    }
  }

  void _prompt() {
    if (_promptPending) return;
    _initialize();
    if (!_initialized) return;
    _promptPending = true;
    try {
      // Sin callback: GIS emite el aviso "uses one of the Google One Tap prompt
      // UI status methods..." en cuanto prompt() recibe un handler (guarda
      // `b && !a.Ec` de su cliente). Con FedCM el handler no aporta nada y la
      // credencial llega por el callback de initialize().
      js.context['google']['accounts']['id'].callMethod('prompt', []);
      // Evita bloquear reintentos si el navegador no muestra el prompt.
      Timer(const Duration(seconds: 10), () => _promptPending = false);
    } catch (_) {
      _promptPending = false;
    }
  }

  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: _prompt,
        child: Container(
          width: 52,
          height: 52,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: const Color(0xFFF3D59B), // Dorado GlowApp
            boxShadow: [
              BoxShadow(
                color: const Color(0xFF000000).withOpacity(0.15),
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
