// frontend/lib/widgets/app_update_gate.dart
//
// FIX-FLUTTER-06 (P1): chequeo de versión mínima en el ARRANQUE de la app.
// Envuelve el árbol de la app, consulta la política publicada por
// `GET /api/health` y, si la versión instalada está por debajo del mínimo
// soportado, muestra el diálogo bloqueante. Es fail-open: si el chequeo falla o
// lanza, la app se usa con normalidad (nunca se deja al usuario sin app).

import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../services/app_update_service.dart';
import 'forced_update_dialog.dart';

class AppUpdateGate extends StatefulWidget {
  /// El árbol real de la app.
  final Widget child;

  /// Inyectable en tests. Por defecto consulta `GET /api/health`.
  final Future<AppUpdateDecision> Function()? check;

  /// Navigator raíz cuando el gate vive por ENCIMA del Navigator
  /// (p. ej. en `MaterialApp.builder`), donde `context` no alcanza la ruta.
  final GlobalKey<NavigatorState>? navigatorKey;

  /// Permite desactivar el chequeo (tests del árbol de la app).
  final bool enabled;

  const AppUpdateGate({
    super.key,
    required this.child,
    this.check,
    this.navigatorKey,
    this.enabled = true,
  });

  @override
  State<AppUpdateGate> createState() => _AppUpdateGateState();
}

class _AppUpdateGateState extends State<AppUpdateGate> {
  bool _bloqueoMostrado = false;

  @override
  void initState() {
    super.initState();
    if (!widget.enabled) return;
    // Tras el primer frame: ya existe el Navigator real.
    WidgetsBinding.instance.addPostFrameCallback((_) => _evaluarPolitica());
  }

  static Future<AppUpdateDecision> _checkContraHealth() async {
    await ApiService.ensureBaseUrl();
    return AppUpdateService.check(baseUrl: ApiService.baseUrl);
  }

  Future<void> _evaluarPolitica() async {
    AppUpdateDecision decision;
    try {
      decision = await (widget.check ?? _checkContraHealth)();
    } catch (_) {
      // Fail-open: un fallo del chequeo nunca bloquea el arranque.
      return;
    }

    if (!mounted || _bloqueoMostrado || !decision.isForced) return;

    final target = widget.navigatorKey?.currentContext ?? context;
    if (!target.mounted) return;

    _bloqueoMostrado = true;
    await showForcedUpdateDialog(target, decision: decision);
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
