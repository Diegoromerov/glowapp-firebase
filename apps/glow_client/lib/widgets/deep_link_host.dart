// apps/glow_client/lib/widgets/deep_link_host.dart
//
// Escucha los enlaces entrantes y navega. Vive dentro de `MaterialApp.builder`
// para tener el Navigator ya montado, igual que GlowGuideHost.
//
// Orden de arranque: enlace inicial → (si hay sesión) destino; si no hay
// sesión, al login con el aviso, sin perder la razón del enlace.

import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';

import '../services/deep_link_service.dart';

class DeepLinkHost extends StatefulWidget {
  final Widget child;

  const DeepLinkHost({super.key, required this.child});

  @override
  State<DeepLinkHost> createState() => _DeepLinkHostState();
}

class _DeepLinkHostState extends State<DeepLinkHost> {
  StreamSubscription<Uri>? _suscripcion;
  String? _ultimoProcesado;
  bool _arrancado = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _arrancar());
  }

  Future<void> _arrancar() async {
    if (_arrancado) return;
    _arrancado = true;

    if (kIsWeb) {
      await _procesar(DeepLinkService.inicialWeb());
      return;
    }

    try {
      final enlaces = AppLinks();
      await _procesar(await enlaces.getInitialLink());
      _suscripcion = enlaces.uriLinkStream.listen(
        (uri) => _procesar(uri),
        onError: (_) {},
      );
    } catch (_) {
      // Sin app_links (escritorio o build sin plugin) la app sigue igual.
    }
  }

  Future<void> _procesar(Uri? uri) async {
    if (uri == null) return;
    final destino = DeepLinkService.mapear(uri);
    if (destino == null) return;

    // Un enlace en caliente puede llegar repetido (initial + stream).
    final clave = '${destino.ruta}|${destino.argumentos}|${uri.path}';
    if (clave == _ultimoProcesado) return;
    _ultimoProcesado = clave;

    final navegador = GlowGuideService.instance.navigatorKey.currentState;
    if (navegador == null) return;

    final haySesion = await AuthService.getToken() != null;
    if (!mounted) return;

    if (!haySesion) {
      // El login no puede recibir argumentos arbitrarios: se avisa y se deja
      // que el usuario vuelva a tocar el enlace desde el correo si quiere.
      navegador.pushNamedAndRemoveUntil('/auth/login', (r) => false);
      _avisar(destino.aviso ??
          'Inicia sesión y vuelve a abrir el enlace del correo.');
      return;
    }

    navegador.pushNamed(destino.ruta, arguments: destino.argumentos);
    if (destino.aviso != null) _avisar(destino.aviso!);
  }

  void _avisar(String texto) {
    final contexto = GlowGuideService.instance.navigatorKey.currentContext;
    if (contexto == null) return;
    ScaffoldMessenger.maybeOf(contexto)?.showSnackBar(
      SnackBar(content: Text(texto)),
    );
  }

  @override
  void dispose() {
    _suscripcion?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
