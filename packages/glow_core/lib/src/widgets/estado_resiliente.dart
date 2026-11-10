import 'package:flutter/material.dart';

/// Refresco al volver al primer plano (ítem 23 — datos obsoletos).
///
/// Sin esto, una lista cargada ayer se sigue mostrando igual al reabrir la app:
/// la cita que cancelaste en la web sigue apareciendo como activa. El mixin
/// escucha el ciclo de vida y llama a [alVolverAlPrimerPlano] cuando la app
/// pasa de `paused`/`hidden` a `resumed`.
///
/// Se usa como `with RefreshOnResumeMixin` en el `State` de la pantalla y se
/// implementa un único método:
///
/// ```dart
/// class _MisCitasState extends State<MisCitas> with RefreshOnResumeMixin<MisCitas> {
///   @override
///   Future<void> alVolverAlPrimerPlano() => _cargar(silencioso: true);
/// }
/// ```
///
/// La carga debe ser silenciosa: al volver no se muestra spinner ni se
/// reconstruye la lista desde cero, o el usuario ve un parpadeo por algo que
/// no pidió.
mixin RefreshOnResumeMixin<T extends StatefulWidget> on State<T> {
  late final _ObservadorCiclo<T> _observador = _ObservadorCiclo<T>(this);
  AppLifecycleState? _ultimoEstado;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(_observador);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(_observador);
    super.dispose();
  }

  void _cambioDeCiclo(AppLifecycleState state) {
    final veniaDeFondo = _ultimoEstado == AppLifecycleState.paused ||
        _ultimoEstado == AppLifecycleState.hidden;
    _ultimoEstado = state;
    if (state == AppLifecycleState.resumed && veniaDeFondo) {
      // Un fallo al refrescar no debe tumbar la pantalla: se ignora y queda
      // el dato anterior en pantalla, que es mejor que una excepción.
      alVolverAlPrimerPlano().catchError((_) {});
    }
  }

  /// Recarga silenciosa: sin spinner bloqueante ni mensajes de error propios.
  Future<void> alVolverAlPrimerPlano();
}

/// Puente entre el binding y el mixin: el `State` no puede registrarse a sí
/// mismo porque no es un `WidgetsBindingObserver`.
class _ObservadorCiclo<T extends StatefulWidget> with WidgetsBindingObserver {
  _ObservadorCiclo(this.dueno);

  final RefreshOnResumeMixin<T> dueno;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) =>
      dueno._cambioDeCiclo(state);
}

/// Estado vacío reutilizable (ítem 15).
///
/// Existe porque cada pantalla se lo inventaba a su manera y en tres de ellas
/// brillaba por su ausencia: la lista quedaba en blanco y parecía un fallo. Un
/// vacío honesto dice qué no hay y cuál es el siguiente paso.
class EstadoVacio extends StatelessWidget {
  const EstadoVacio({
    super.key,
    required this.icono,
    required this.titulo,
    this.detalle,
    this.accionEtiqueta,
    this.onAccion,
  });

  final IconData icono;
  final String titulo;
  final String? detalle;
  final String? accionEtiqueta;
  final VoidCallback? onAccion;

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icono, size: 56, color: muted.withValues(alpha: 0.7)),
            const SizedBox(height: 14),
            Text(
              titulo,
              textAlign: TextAlign.center,
              style: const TextStyle(
                  fontSize: 15.5, fontWeight: FontWeight.w700),
            ),
            if (detalle != null) ...[
              const SizedBox(height: 6),
              Text(
                detalle!,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: muted, height: 1.35),
              ),
            ],
            if (accionEtiqueta != null && onAccion != null) ...[
              const SizedBox(height: 18),
              OutlinedButton.icon(
                onPressed: onAccion,
                icon: const Icon(Icons.refresh, size: 18),
                label: Text(accionEtiqueta!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
