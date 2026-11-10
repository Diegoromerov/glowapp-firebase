import 'package:flutter/material.dart';

import '../services/connectivity_service.dart';

/// Franja de estado de conexión (ítem 21).
///
/// `ConnectivityService` es un singleton con estado estático y sin stream: aquí
/// se comprueba al arrancar y cada vez que la app vuelve al primer plano, y se
/// pinta una franja solo cuando no hay red. Sin conexión la app no se queda
/// muda con un spinner infinito: dice qué pasa y ofrece reintentar.
///
/// No hay sondeo periódico a propósito: un `Timer.periodic` gasta batería en
/// segundo plano y deja timers colgando en las pruebas. Volver al primer plano
/// cubre el caso real —el usuario sale a mirar el wifi y regresa—.
///
/// Se monta una sola vez en `MaterialApp.builder`, no en cada pantalla.
class FranjaConexion extends StatefulWidget {
  const FranjaConexion({super.key});

  /// Se conserva por compatibilidad con quien lo consulte; no hay sondeo
  /// periódico (ver la nota de la clase).
  static const Duration intervalo = Duration(seconds: 20);

  @override
  State<FranjaConexion> createState() => _FranjaConexionState();
}

class _FranjaConexionState extends State<FranjaConexion> {
  bool _comprobando = false;

  Future<void> _comprobar() async {
    if (_comprobando) return;
    _comprobando = true;
    await ConnectivityService.check(force: true);
    _comprobando = false;
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: ConnectivityService.conectado,
      builder: (context, conectado, _) {
        if (conectado) return const SizedBox.shrink();
        return _franja(context);
      },
    );
  }

  Widget _franja(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.errorContainer,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(
            children: [
              Icon(Icons.cloud_off_outlined,
                  size: 18, color: scheme.onErrorContainer),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Sin conexión. Revisa tu red y reintenta.',
                  style: TextStyle(
                      fontSize: 12.5,
                      color: scheme.onErrorContainer,
                      fontWeight: FontWeight.w500),
                ),
              ),
              TextButton(
                onPressed: _comprobar,
                child: Text('Reintentar',
                    style: TextStyle(
                        fontSize: 12.5,
                        color: scheme.onErrorContainer,
                        fontWeight: FontWeight.w700)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
