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
  String? _initializationError;
  Timer? _gisPollTimer;

  static const _gold = Color(0xFFC5A052);
  static const _dark = Color(0xFF1F1A15);

  @override
  void initState() {
    super.initState();
    // GIS se carga async desde index.html; esperar a que esté disponible antes
    // de inicializar, para que el primer toque no se pierda.
    _initialize();
    _gisPollTimer = Timer.periodic(const Duration(milliseconds: 250), (timer) {
      if (_initialized || !mounted) {
        timer.cancel();
        return;
      }
      _initialize();
    });
  }

  @override
  void didUpdateWidget(covariant _GoogleOneTapButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.clientId != widget.clientId) {
      _initialized = false;
      _initializationError = null;
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
    if (_initialized) return;
    if (widget.clientId.isEmpty) {
      _showInitializationError('Falta configurar el cliente OAuth de Google.');
      return;
    }
    if (!_gisReady) return;
    try {
      final callback = (credentialResponse) {
        _promptPending = false;
        final credential = credentialResponse == null
            ? null
            : credentialResponse['credential'];
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
      _initializationError = null;
      _gisPollTimer?.cancel();
      if (mounted) setState(() {});
    } catch (error) {
      _showInitializationError('No se pudo iniciar Google: $error');
    }
  }

  void _prompt() {
    if (_promptPending) return;
    _initialize();
    if (!_initialized) {
      _showInitializationError(
        _initializationError ??
            'Google todavía está cargando. Intenta de nuevo.',
      );
      return;
    }
    setState(() => _promptPending = true);
    try {
      // Sin callback: GIS emite el aviso "uses one of the Google One Tap prompt
      // UI status methods..." en cuanto prompt() recibe un handler (guarda
      // `b && !a.Ec` de su cliente). Con FedCM el handler no aporta nada y la
      // credencial llega por el callback de initialize().
      js.context['google']['accounts']['id'].callMethod('prompt', []);
      // Evita bloquear reintentos si el navegador no muestra el prompt.
      Timer(const Duration(seconds: 10), () {
        if (mounted) setState(() => _promptPending = false);
      });
    } catch (error) {
      _showInitializationError(
          'Google no pudo abrir el inicio de sesión: $error');
      if (mounted) setState(() => _promptPending = false);
    }
  }

  void _showInitializationError(String message) {
    if (!mounted) return;
    setState(() => _initializationError = message);
  }

  @override
  void dispose() {
    _gisPollTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: _prompt,
              customBorder: const CircleBorder(),
              mouseCursor: SystemMouseCursors.click,
              child: Ink(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0xFFF3D59B), // Dorado GlowApp
                  border: Border.all(color: _gold),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFF000000).withOpacity(0.15),
                      blurRadius: 8,
                      offset: const Offset(0, 3),
                    ),
                  ],
                ),
                child: Center(
                  child: _promptPending
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: _dark,
                          ),
                        )
                      : const Icon(
                          Icons.g_mobiledata,
                          color: _dark,
                          size: 28,
                        ),
                ),
              ),
            ),
          ),
          if (_initializationError != null) ...[
            const SizedBox(height: 8),
            SizedBox(
              width: 220,
              child: Text(
                _initializationError!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: _dark, fontSize: 12),
              ),
            ),
          ],
        ],
      );
}
