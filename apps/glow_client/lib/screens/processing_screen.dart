import 'dart:async';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:glow_core/services/biometric_service.dart';
import '../../services/location_service.dart';
import '../../models/biometric_result.dart';
import 'results_screen.dart';

class ProcessingScreen extends StatefulWidget {
  final Uint8List faceImage;
  final Uint8List handsImage;

  /// Y-F4: geometría medida por ML Kit (yaw, roll, pitch, faceRatio, aspectRatio).
  /// El backend la revalida y la guarda con la sesión; si falta, el análisis sigue
  /// pero queda marcado como «sin geometría».
  final Map<String, dynamic>? geometry;

  const ProcessingScreen({
    super.key,
    required this.faceImage,
    required this.handsImage,
    this.geometry,
  });

  @override
  State<ProcessingScreen> createState() => _ProcessingScreenState();
}

class _ProcessingScreenState extends State<ProcessingScreen> {
  double _progress = 0.0;
  String _status = 'Preparando imágenes...';
  bool _isComplete = false;
  bool _showRetry = false;
  String? _errorDetail;
  Timer? _timeoutTimer;

  @override
  void initState() {
    super.initState();
    _startProcessing();
    // Fix 5: Timer de advertencia ajustado a 30s (antes 12s)
    _timeoutTimer = Timer(const Duration(seconds: 30), () {
      if (mounted && !_isComplete) {
        setState(() {
          _status = '⏳ Está tomando más tiempo de lo esperado...';
          _showRetry = true;
        });
      }
    });
  }

  @override
  void dispose() {
    _timeoutTimer?.cancel();
    super.dispose();
  }

  Future<void> _startProcessing() async {
    try {
      // Etapa 1: Obtener ubicación (real)
      _updateProgress(10, 'Obteniendo ubicación...');
      final position = await LocationService.getCurrentPosition();

      // Etapa 2: Compresión y preparación de imágenes (real — se ejecuta en Isolate)
      _updateProgress(25, 'Comprimiendo imágenes...');

      // Etapa 3: Envío y análisis con IA (real — la llamada HTTP al backend)
      _updateProgress(40, 'Analizando rostro y manos con IA...');
      final resultData = await BiometricService.analyze(
        faceImageBytes: widget.faceImage,
        handsImageBytes: widget.handsImage,
        lat: position?.latitude,
        lng: position?.longitude,
        // Y-F4: sin esto el backend no puede distinguir una foto torcida de un
        // cliente que no valida nada.
        geometry: widget.geometry,
      );

      // Etapa 4: Procesamiento de resultados
      _updateProgress(90, 'Procesando resultados...');
      final parsedResult = BiometricResult.fromJson(resultData);

      if (!mounted) return;
      if (mounted) {
        setState(() {
          _progress = 100;
          _status = '✅ ¡Completado!';
          _isComplete = true;
          _showRetry = false;
        });
      }

      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
              builder: (_) => ResultsScreen(result: parsedResult)),
        );
      });
    } catch (e, stack) {
      debugPrint('❌ [PROCESSING SCREEN] Error en el análisis biométrico: $e\n$stack');
      // A360-2026-09-22/C-05: antes se navegaba a ResultsScreen con datos mock
      // generados localmente (glowScore 84, bioAge 26…) tras el texto
      // "✨ Generando diagnóstico de demostración…". No existe tal diagnóstico:
      // se muestra un estado de error y NO se navega a resultados.
      if (mounted) {
        setState(() {
          _isComplete = true;
          _showRetry = true;
          _status = '❌ No pudimos generar tu diagnóstico';
          _errorDetail = e.toString().replaceFirst('Exception: ', '');
        });
      }
    }
  }

  void _updateProgress(double value, String status) {
    if (mounted) {
      setState(() {
        _progress = value;
        _status = status;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Padding(
            padding: const EdgeInsets.all(32.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 80,
                  height: 80,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: const Color(0xFFF3D59B).withValues(alpha: 0.25),
                    border: Border.all(color: const Color(0xFFC5A052), width: 1.5),
                  ),
                  child: _errorDetail != null
                      ? const Center(
                          child: Icon(
                            Icons.error_outline,
                            color: Color(0xFFB3261E),
                            size: 40,
                          ),
                        )
                      : const Center(
                          child: CircularProgressIndicator(
                            color: Color(0xFFC5A052),
                            strokeWidth: 2.5,
                          ),
                        ),
                ),
                const SizedBox(height: 32),
                Text(
                  _status,
                  style: const TextStyle(
                    fontFamily: 'CormorantGaramond',
                    color: Color(0xFF1F1A15),
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                // Barra de progreso
                Container(
                  width: 280,
                  height: 6,
                  decoration: BoxDecoration(
                    color: const Color(0xFFE8DFD8),
                    borderRadius: BorderRadius.circular(3),
                  ),
                  child: FractionallySizedBox(
                    alignment: Alignment.centerLeft,
                    widthFactor: (_progress / 100).clamp(0.0, 1.0),
                    child: Container(
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                        ),
                        borderRadius: BorderRadius.circular(3),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  '${_progress.toInt()}%',
                  style: const TextStyle(
                    fontFamily: 'Inter',
                    color: Color(0xFF8E7D7A),
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (_showRetry) ...[
                  if (_errorDetail != null) ...[
                    const SizedBox(height: 16),
                    Text(
                      _errorDetail!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontFamily: 'Inter',
                        fontSize: 12,
                        color: Color(0xFF8E7D7A),
                      ),
                    ),
                  ],
                  const SizedBox(height: 32),
                  Container(
                    height: 52,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(16),
                      gradient: const LinearGradient(
                        colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFFC5A052).withValues(alpha: 0.35),
                          blurRadius: 10,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: ElevatedButton(
                      onPressed: () {
                        setState(() {
                          _isComplete = false;
                          _showRetry = false;
                          _progress = 0.0;
                          _errorDetail = null;
                          _status = 'Preparando imágenes...';
                        });
                        _startProcessing();
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.transparent,
                        shadowColor: Colors.transparent,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                        padding: const EdgeInsets.symmetric(horizontal: 32),
                      ),
                      child: const Text(
                        'Reintentar',
                        style: TextStyle(
                          fontFamily: 'Inter',
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF1F1A15),
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
