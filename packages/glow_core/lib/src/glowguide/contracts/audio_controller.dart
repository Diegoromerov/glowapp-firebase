// lib/glowguide/contracts/audio_controller.dart
// Contrato de controlador de audio para GlowGuide
// El Engine NO posee AudioPlayer; delega a AudioController implementado con just_audio.

/// Contrato para gestionar el ciclo de vida de reproducción de audio por paso.
abstract class AudioController {
  /// Inicializa el subsistema de audio (carga assets, prepara player).
  Future<void> initialize();

  /// Reproduce un asset de audio por ID.
  /// Retorna un [AudioPlayback] que emite eventos de completado/error.
  AudioPlayback play(String assetId);

  /// Pausa la reproducción actual.
  Future<void> pause();

  /// Reanuda la reproducción pausada.
  Future<void> resume();

  /// Detiene toda reproducción inmediatamente.
  Future<void> stop();

  /// Libera recursos.
  Future<void> dispose();

  /// Si hay audio reproduciéndose actualmente.
  bool get isPlaying;
}

/// Representa una sesión de reproducción activa con stream de eventos.
abstract class AudioPlayback {
  /// Stream de eventos de reproducción.
  Stream<AudioEvent> get events;

  /// Estado actual de la reproducción.
  AudioPlaybackState get state;

  /// Cancela esta reproducción (stop + cleanup).
  Future<void> cancel();
}

enum AudioPlaybackState { playing, paused, completed, error, cancelled }

enum AudioEventType { started, progress, completed, error, cancelled }

class AudioEvent {
  final AudioEventType type;
  final String assetId;
  final Duration? position;
  final Duration? duration;
  final String? errorMessage;

  const AudioEvent({
    required this.type,
    required this.assetId,
    this.position,
    this.duration,
    this.errorMessage,
  });
}