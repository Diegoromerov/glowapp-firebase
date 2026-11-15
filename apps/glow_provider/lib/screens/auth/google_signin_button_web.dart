import 'dart:async';
import 'dart:html' as html;
import 'dart:js' as js;
import 'dart:ui_web' as ui_web;

import 'package:flutter/material.dart';

const _googleButtonViewType = 'glow-provider-google-sign-in';

bool _googleButtonFactoryRegistered = false;
bool _gisInitialized = false;
ValueChanged<String>? _activeCredentialHandler;

void _registerGoogleButtonFactory() {
  if (_googleButtonFactoryRegistered) return;
  ui_web.platformViewRegistry.registerViewFactory(
    _googleButtonViewType,
    (int viewId) => html.DivElement()
      ..style.width = '52px'
      ..style.height = '52px'
      ..style.display = 'flex'
      ..style.alignItems = 'center'
      ..style.justifyContent = 'center',
  );
  _googleButtonFactoryRegistered = true;
}

/// Botón oficial de Google Identity Services para Flutter Web.
/// El iframe de Google recibe directamente el clic del usuario.
Widget? googleSignInButton({
  required String clientId,
  required void Function(String idToken) onCredential,
}) =>
    _GoogleIdentityButton(
      clientId: clientId,
      onCredential: onCredential,
    );

Widget? googleSignInOverlay() => const SizedBox.shrink();

class _GoogleIdentityButton extends StatefulWidget {
  const _GoogleIdentityButton({
    required this.clientId,
    required this.onCredential,
  });

  final String clientId;
  final ValueChanged<String> onCredential;

  @override
  State<_GoogleIdentityButton> createState() => _GoogleIdentityButtonState();
}

class _GoogleIdentityButtonState extends State<_GoogleIdentityButton> {
  Timer? _gisPollTimer;
  int? _viewId;
  bool _rendered = false;
  String? _error;

  bool get _gisReady {
    final google = js.context['google'];
    return google != null &&
        google['accounts'] != null &&
        google['accounts']['id'] != null;
  }

  @override
  void initState() {
    super.initState();
    _registerGoogleButtonFactory();
    _activeCredentialHandler = widget.onCredential;
    _gisPollTimer = Timer.periodic(const Duration(milliseconds: 250), (_) {
      _initializeAndRender();
    });
    _initializeAndRender();
  }

  @override
  void didUpdateWidget(covariant _GoogleIdentityButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    _activeCredentialHandler = widget.onCredential;
    if (oldWidget.clientId != widget.clientId) {
      _error = 'Cambió la configuración de Google. Recarga la página.';
      setState(() {});
    }
  }

  void _onPlatformViewCreated(int viewId) {
    _viewId = viewId;
    _initializeAndRender();
  }

  void _initializeAndRender() {
    if (!mounted || _viewId == null || _rendered) return;
    if (widget.clientId.isEmpty) {
      _setError('Falta configurar el cliente OAuth de Google.');
      _gisPollTimer?.cancel();
      return;
    }
    if (!_gisReady) return;

    try {
      final googleId = js.context['google']['accounts']['id'];
      if (!_gisInitialized) {
        googleId.callMethod('initialize', [
          js.JsObject.jsify({
            'client_id': widget.clientId,
            'callback': (response) {
              final credential =
                  response == null ? null : response['credential'];
              if (credential is String && credential.isNotEmpty) {
                _activeCredentialHandler?.call(credential);
              }
            },
            'auto_select': false,
          }),
        ]);
        _gisInitialized = true;
      }

      final container = ui_web.platformViewRegistry.getViewById(_viewId!);
      googleId.callMethod('renderButton', [
        container,
        js.JsObject.jsify({
          'type': 'icon',
          'theme': 'outline',
          'size': 'large',
          'shape': 'circle',
        }),
      ]);
      _rendered = true;
      _error = null;
      _gisPollTimer?.cancel();
      setState(() {});
    } catch (error) {
      _setError('No se pudo mostrar el acceso de Google: $error');
      _gisPollTimer?.cancel();
    }
  }

  void _setError(String message) {
    if (!mounted || _error == message) return;
    setState(() => _error = message);
  }

  @override
  void dispose() {
    _gisPollTimer?.cancel();
    if (_activeCredentialHandler == widget.onCredential) {
      _activeCredentialHandler = null;
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 52,
          height: 52,
          child: HtmlElementView(
            viewType: _googleButtonViewType,
            onPlatformViewCreated: _onPlatformViewCreated,
          ),
        ),
        if (_error != null) ...[
          const SizedBox(height: 8),
          SizedBox(
            width: 240,
            child: Text(
              _error!,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF1F1A15),
                fontSize: 12,
              ),
            ),
          ),
        ],
      ],
    );
  }
}
