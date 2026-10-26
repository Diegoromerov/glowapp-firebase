// frontend/lib/services/audio_player.dart

export 'audio_player_stub.dart'
    if (dart.library.js) 'web_audio_player.dart';
