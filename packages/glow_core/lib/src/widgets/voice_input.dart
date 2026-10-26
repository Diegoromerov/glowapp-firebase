import 'package:flutter/material.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;
import 'package:permission_handler/permission_handler.dart';
import '../design/icons/glow_icon_adapter.dart';
import '../services/permission_rationale_service.dart';

/// VoiceInput widget.
/// Calls `onTranscript` with the final recognized text.
/// No other callbacks are exposed.

class VoiceInput extends StatefulWidget {
  final Function(String) onTranscript;

  const VoiceInput({
    super.key,
    required this.onTranscript,
  });

  @override
  _VoiceInputState createState() => _VoiceInputState();
}

class _VoiceInputState extends State<VoiceInput> {
  final stt.SpeechToText _speech = stt.SpeechToText();
  bool _isListening = false;
  bool _isError = false;
  String _errorMessage = '';
  final double _iconSize = 24.0;
  final String _semanticLabel = 'Voice Input';

  @override
  void initState() {
    super.initState();
  }

  Future<void> _startListening() async {
    if (!_isListening) {
      // FIX-FLUTTER-02: rationale en UI antes del prompt del SO.
      final micStatus = await Permission.microphone.status;
      if (micStatus.isDenied) {
        if (!mounted) return;
        final accepted = await PermissionRationaleService.showRationaleDialog(
          context,
          Permission.microphone,
        );
        if (!accepted) return;
      }
      bool available = await _speech.initialize();
      if (!available) {
        setState(() {
          _isError = true;
          _errorMessage = 'No se pudo inicializar el reconocimiento de voz.';
        });
        return;
      }

      setState(() {
        _isListening = true;
      });

      await _speech.listen(
        onResult: (result) {
          if (result.finalResult) {
            setState(() {
              _isListening = false;
            });
            widget.onTranscript(result.recognizedWords);
          }
        },
        localeId: 'es-ES',
      );
    }
  }

  void _cancelListening() {
    if (_isListening) {
      _speech.stop();
      setState(() {
        _isListening = false;
        _isError = false;
      });
      // No limpiar el TextField al cancelar
    }
  }

  @override
  void dispose() {
    _speech.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: _semanticLabel,
      child: GestureDetector(
        onTap: _startListening,
        onLongPress: _startListening,
        onLongPressUp: _cancelListening,
        child: Container(
          width: 48.0,
          height: 48.0,
          padding: const EdgeInsets.all(8.0),
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: _isListening ? Colors.blue[50] : Colors.grey[200],
            border: Border.all(color: Colors.grey),
          ),
          child: _isError
              ? GlowIconAdapter.fallback(Icons.mic_off, size: _iconSize, color: Colors.red)
              : GlowIconAdapter.fallback(
                  _isListening ? Icons.mic : Icons.mic_off,
                  size: _iconSize,
                  color: _isListening ? Colors.blue : Colors.grey,
                ),
        ),
      ),
    );
  }
}
