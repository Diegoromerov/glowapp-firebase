import 'dart:async';

/// Reconciliador de respuestas para el chat de AURA.
///
/// Ejecuta un sondeo periódico de respaldo mientras se aguarda la respuesta
/// del asistente AI (AURA), garantizando la entrega visual de los mensajes
/// aunque el push por WebSocket no se reciba o se desfase.
class ReplyReconciler {
  final Duration pollInterval;
  final Duration maxDuration;
  final DateTime Function() getNow;

  Timer? _timer;
  DateTime? _deadline;
  bool _isRunning = false;

  ReplyReconciler({
    this.pollInterval = const Duration(seconds: 4),
    this.maxDuration = const Duration(seconds: 90),
    this.getNow = DateTime.now,
  });

  bool get isRunning => _isRunning;

  /// Inicia la reconciliación llamando a [onPoll] de inmediato y luego cada [pollInterval]
  /// hasta que se llame a [stop] o venza la ventana [maxDuration].
  void start({required Future<void> Function() onPoll}) {
    stop();
    _isRunning = true;
    _deadline = getNow().add(maxDuration);

    // Consulta de inmediato
    onPoll();

    _timer = Timer.periodic(pollInterval, (timer) async {
      if (!_isRunning) {
        timer.cancel();
        return;
      }
      if (_deadline != null && getNow().isAfter(_deadline!)) {
        stop();
        return;
      }
      await onPoll();
    });
  }

  /// Detiene la reconciliación y libera los recursos del temporizador.
  void stop() {
    _timer?.cancel();
    _timer = null;
    _deadline = null;
    _isRunning = false;
  }
}
