// frontend/lib/services/web_audio_player.dart
import 'dart:html' as html;

void playGlowAppAlert() {
  try {
    // En Flutter Web, los assets se exponen bajo la ruta /assets/
    final audio = html.AudioElement('glowapp.mp3');
    audio.play();
    print("🔊 [Audio Alert] Reproduciendo GlowApp en la Web");
  } catch (e) {
    print("❌ Error al reproducir audio en web: $e");
  }
}
