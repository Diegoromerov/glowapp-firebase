// lib/glowguide/audio/audio_engine.dart
// Implementación de AudioController usando just_audio
// El Engine delega reproducción de audio a esta implementación.

import 'dart:async';
import 'package:just_audio/just_audio.dart';
import '../contracts/audio_controller.dart';

/// Implementación concreta de AudioController con just_audio.
class AudioEngine implements AudioController {
  final AudioPlayer _player = AudioPlayer();
  bool _initialized = false;
  _AudioPlaybackController? _currentPlayback;

  @override
  Future<void> initialize() async {
    if (_initialized) return;
    // just_audio no requiere inicialización explícita
    _initialized = true;
  }

  @override
  AudioPlayback play(String assetId) {
    final controller = _AudioPlaybackController(assetId);
    _currentPlayback = controller;

    _player.setAsset(assetId).then((_) {
      _player.play();
      controller.emit(AudioEvent(type: AudioEventType.started, assetId: assetId));
    }).catchError((Object e) {
      controller.emit(AudioEvent(
        type: AudioEventType.error,
        assetId: assetId,
        errorMessage: e.toString(),
      ));
      controller.complete();
    });

    // Escuchar completado por processing state
    _player.playerStateStream.listen((PlayerState state) {
      if (state.processingState == ProcessingState.completed) {
        controller.emit(AudioEvent(
          type: AudioEventType.completed,
          assetId: assetId,
        ));
        controller.complete();
      }
    }, onError: (Object e) {
      controller.emit(AudioEvent(
        type: AudioEventType.error,
        assetId: assetId,
        errorMessage: e.toString(),
      ));
      controller.complete();
    });

    return controller;
  }

  @override
  Future<void> pause() async {
    await _player.pause();
    _currentPlayback?.emit(AudioEvent(
      type: AudioEventType.progress,
      assetId: _currentPlayback?.assetId ?? '',
    ));
  }

  @override
  Future<void> resume() async {
    await _player.play();
  }

  @override
  Future<void> stop() async {
    await _player.stop();
    _currentPlayback?.emit(AudioEvent(
      type: AudioEventType.cancelled,
      assetId: _currentPlayback?.assetId ?? '',
    ));
    _currentPlayback = null;
  }

  @override
  Future<void> dispose() async {
    await _currentPlayback?.cancel();
    await _player.dispose();
    _initialized = false;
  }

  @override
  bool get isPlaying => _player.playing;
}

/// Controlador interno de reproducción con stream de eventos.
class _AudioPlaybackController implements AudioPlayback {
  final String assetId;
  final StreamController<AudioEvent> _events = StreamController<AudioEvent>.broadcast();
  AudioPlaybackState _state = AudioPlaybackState.playing;

  _AudioPlaybackController(this.assetId);

  @override
  Stream<AudioEvent> get events => _events.stream;

  @override
  AudioPlaybackState get state => _state;

  @override
  Future<void> cancel() async {
    if (_state != AudioPlaybackState.completed && _state != AudioPlaybackState.cancelled) {
      _state = AudioPlaybackState.cancelled;
      emit(AudioEvent(type: AudioEventType.cancelled, assetId: assetId));
      _state = AudioPlaybackState.cancelled;
    }
    await _events.close();
  }

  /// Emite un evento al stream (método público interno).
  void emit(AudioEvent event) {
    if (!_events.isClosed) {
      _events.add(event);
    }
  }

  /// Completa la reproducción (método público interno).
  void complete() {
    if (_state != AudioPlaybackState.cancelled) {
      _state = AudioPlaybackState.completed;
    }
  }
}