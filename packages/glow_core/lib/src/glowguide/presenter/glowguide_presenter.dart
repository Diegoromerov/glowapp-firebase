// lib/glowguide/presenter/glowguide_presenter.dart
// Presentador visual para GlowGuide
// Reproduce la secuencia automática de videos con audio en cada pantalla sin botones de siguiente.

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import '../engine/glowguide_engine.dart';
import '../state/glowguide_state.dart';
import '../model/glowguide_step.dart';

/// Callback para cuando el usuario interactúa con el presenter
typedef GlowGuidePresenterCallback = void Function(GlowGuidePresenterAction action);

/// Acciones que el presenter puede solicitar al Engine
enum GlowGuidePresenterAction {
  next,
  previous,
  dismiss,
  replay,
  pause,
  resume,
}

/// Presentador visual de GlowGuide
class GlowGuidePresenter extends StatefulWidget {
  final GlowGuideEngine engine;
  final GlowGuidePresenterCallback? onAction;
  final Widget? child;
  final bool allowVideoTapToAdvance;

  const GlowGuidePresenter({
    super.key,
    required this.engine,
    this.onAction,
    this.child,
    this.allowVideoTapToAdvance = true,
  });

  @override
  State<GlowGuidePresenter> createState() => _GlowGuidePresenterState();
}

class _GlowGuidePresenterState extends State<GlowGuidePresenter> with WidgetsBindingObserver {
  GlowGuideState _currentState = GlowGuideState.initial;
  GlowGuideStep? _currentStep;

  @override
  void initState() {
    super.initState();
    _currentState = widget.engine.state;
    _currentStep = widget.engine.currentStep;
    widget.engine.addListener(_onEngineStateChanged);
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    widget.engine.removeListener(_onEngineStateChanged);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  void _onEngineStateChanged(GlowGuideState newState) {
    if (mounted) {
      setState(() {
        _currentState = newState;
        _currentStep = widget.engine.currentStep;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.engine.isActive && !widget.engine.isCompleted) {
      return widget.child ?? const SizedBox.shrink();
    }

    if (!_isVisibleState(_currentState.status) || _currentStep == null) {
      return const SizedBox.shrink();
    }

    final auraContent = _currentStep!.auraContent;
    if (!auraContent.visible) {
      return const SizedBox.shrink();
    }

    final position = auraContent.position;
    final alignment = _calculateAlignment(position);
    final disableAnimations = MediaQuery.of(context).disableAnimations;
    final videoPath = _currentStep!.videoAssetId ?? 'assets/glowguide/videos/aura_pilot.webm';

    final screenSize = MediaQuery.of(context).size;
    final isCenter = position == AuraPosition.center;
    final videoWidth = isCenter
        ? (screenSize.width * 0.86).clamp(300.0, 420.0)
        : (screenSize.width * 0.72).clamp(260.0, 340.0);

    return AnimatedSwitcher(
      duration: disableAnimations ? Duration.zero : const Duration(milliseconds: 350),
      transitionBuilder: (Widget child, Animation<double> animation) {
        if (disableAnimations) return child;
        return FadeTransition(
          opacity: animation,
          child: ScaleTransition(
            scale: Tween<double>(begin: 0.94, end: 1.0).animate(animation),
            child: child,
          ),
        );
      },
      child: SafeArea(
        key: ValueKey<String>('glowguide_step_${_currentStep!.id}'),
        child: Align(
          alignment: alignment,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              // Reproductor de Video de Aura
              SizedBox(
                width: videoWidth,
                child: GlowStepVideoPlayer(
                  key: ValueKey<String>(videoPath),
                  videoAssetPath: videoPath,
                  isFirstStep: _currentStep!.order == 0,
                  allowTapToAdvance: widget.allowVideoTapToAdvance,
                  onVideoEnded: () {
                    // Avance automático al terminar el video
                    widget.onAction?.call(GlowGuidePresenterAction.next);
                  },
                ),
              ),

              // Botón Discreto de Cerrar
              Positioned(
                top: -8,
                right: -8,
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: () => widget.onAction?.call(GlowGuidePresenterAction.dismiss),
                    borderRadius: BorderRadius.circular(16),
                    child: Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: const Color(0xFF141210).withValues(alpha: 0.85),
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: const Color(0xFFC5A052).withValues(alpha: 0.8),
                          width: 1.2,
                        ),
                      ),
                      child: const Icon(Icons.close_rounded, color: Colors.white70, size: 14),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Alignment _calculateAlignment(AuraPosition? position) {
    final x = (position?.x ?? AuraPosition.defaultBottom.x).clamp(0.0, 1.0);
    final y = (position?.y ?? AuraPosition.defaultBottom.y).clamp(0.0, 1.0);
    final ax = (x * 2.0) - 1.0;
    final ay = (y * 2.0) - 1.0;
    return Alignment(ax * 0.82, ay * 0.82);
  }

  bool _isVisibleState(GlowGuideStatus status) {
    return status == GlowGuideStatus.playing ||
           status == GlowGuideStatus.executingAction ||
           status == GlowGuideStatus.paused;
  }
}

/// Reproductor de Video para los Pasos de GlowGuide
class GlowStepVideoPlayer extends StatefulWidget {
  final String videoAssetPath;
  final bool isFirstStep;
  final bool allowTapToAdvance;
  final VoidCallback? onVideoEnded;

  const GlowStepVideoPlayer({
    super.key,
    required this.videoAssetPath,
    this.isFirstStep = false,
    this.allowTapToAdvance = true,
    this.onVideoEnded,
  });

  @override
  State<GlowStepVideoPlayer> createState() => _GlowStepVideoPlayerState();
}

class _GlowStepVideoPlayerState extends State<GlowStepVideoPlayer> {
  late VideoPlayerController _controller;
  bool _isInitialized = false;
  bool _hasError = false;
  bool _hasEnded = false;
  bool _isMuted = false;
  bool _hasUserStarted = false;
  double _opacity = 1.0;

  @override
  void initState() {
    super.initState();
    _initVideo();
  }

  @override
  void didUpdateWidget(GlowStepVideoPlayer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.videoAssetPath != widget.videoAssetPath) {
      _controller.removeListener(_onVideoStateChanged);
      _controller.dispose();
      _initVideo();
    }
  }

  void _initVideo() {
    _isInitialized = false;
    _hasError = false;
    _hasEnded = false;
    _isMuted = false;
    _opacity = 1.0;

    _tryLoadVideoAsset(widget.videoAssetPath);
  }

  void _tryLoadVideoAsset(String path) {
    _controller = VideoPlayerController.asset(
      path,
      videoPlayerOptions: VideoPlayerOptions(mixWithOthers: true),
    );

    _controller.initialize().then((_) {
      if (mounted) {
        _controller.setLooping(false); // Reproducción única por paso
        _controller.setVolume(1.0);     // SONIDO ACTIVO POR DEFECTO
        _controller.addListener(_onVideoStateChanged);

        // Si no es el primer paso, iniciar reproducción inmediatamente
        if (!widget.isFirstStep || _hasUserStarted) {
          _controller.play().catchError((err) {
            debugPrint('⚠️ Web autoplay con sonido restringido por navegador: $err');
            if (mounted) {
              setState(() {
                _isMuted = true;
              });
              _controller.setVolume(0.0);
              _controller.play();
            }
          });
        }

        setState(() {
          _isInitialized = true;
        });
      }
    }).catchError((err) {
      debugPrint('⚠️ Error al inicializar video ($path): $err');
      if (path.endsWith('.webm')) {
        final fallbackMp4 = path.replaceAll('.webm', '.mp4');
        debugPrint('🔄 Intentando fallback a .mp4: $fallbackMp4');
        _controller.dispose();
        _tryLoadVideoAsset(fallbackMp4);
      } else if (mounted) {
        setState(() {
          _hasError = true;
        });
      }
    });
  }

  void _startPlayback() {
    if (!_isInitialized) return;
    setState(() {
      _hasUserStarted = true;
      _isMuted = false;
    });
    _controller.setVolume(1.0);
    _controller.play();
  }

  void _onVideoStateChanged() async {
    if (_isInitialized &&
        _controller.value.isInitialized &&
        !_controller.value.isPlaying &&
        _controller.value.position >= _controller.value.duration &&
        !_hasEnded &&
        (!widget.isFirstStep || _hasUserStarted)) {
      _hasEnded = true;
      debugPrint('🎬 Video completado: ${widget.videoAssetPath}. Avanzando automáticamente...');

      // Desvanecer suavemente el reproductor al finalizar el último video (Despedida)
      if (widget.videoAssetPath.contains('step_08_despedida') && mounted) {
        setState(() {
          _opacity = 0.0;
        });
        await Future.delayed(const Duration(milliseconds: 850));
      }

      widget.onVideoEnded?.call();
    }
  }

  void _handleTap() {
    if (widget.isFirstStep && !_hasUserStarted) {
      _startPlayback();
      return;
    }

    if (_isMuted && _isInitialized) {
      setState(() {
        _isMuted = false;
      });
      _controller.setVolume(1.0);
      if (!_controller.value.isPlaying) {
        _controller.play();
      }
    } else if (widget.allowTapToAdvance) {
      widget.onVideoEnded?.call();
    }
  }

  @override
  void dispose() {
    _controller.removeListener(_onVideoStateChanged);
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final showStartButton = widget.isFirstStep && !_hasUserStarted;

    return AnimatedOpacity(
      opacity: _opacity,
      duration: const Duration(milliseconds: 850),
      curve: Curves.easeOutCubic,
      child: GestureDetector(
        onTap: _handleTap,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(24),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            border: Border.all(
              color: const Color(0xFFC5A052),
              width: 2.0,
            ),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFFC5A052).withValues(alpha: 0.4),
                blurRadius: 20,
                spreadRadius: 2,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Stack(
            alignment: Alignment.center,
            children: [
              if (_isInitialized && !_hasError && _controller.value.isInitialized)
                AspectRatio(
                  aspectRatio: _controller.value.aspectRatio > 0 ? _controller.value.aspectRatio : 1.0,
                  child: VideoPlayer(_controller),
                )
              else
                AspectRatio(
                  aspectRatio: 1.0,
                  child: Container(
                    color: const Color(0xFF141210).withValues(alpha: 0.2),
                  ),
                ),

              // Botón "PRESIONE PARA INICIAR" en el primer paso (Home) sobre contenedor traslúcido
              if (showStartButton)
                Container(
                  color: Colors.transparent, // Caja 100% Traslúcida
                  alignment: Alignment.center,
                  padding: const EdgeInsets.all(12),
                  child: ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFFC5A052).withValues(alpha: 0.92),
                      foregroundColor: const Color(0xFF141210),
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
                      elevation: 8,
                      shadowColor: const Color(0xFFC5A052).withValues(alpha: 0.5),
                    ),
                    onPressed: _startPlayback,
                    icon: const Icon(Icons.play_arrow_rounded, size: 22, color: Color(0xFF141210)),
                    label: const Text(
                      'PRESIONE PARA INICIAR',
                      style: TextStyle(
                        fontFamily: 'JetBrainsMono',
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.8,
                        color: Color(0xFF141210),
                      ),
                    ),
                  ),
                ),

              if (_isMuted && !showStartButton)
                Positioned(
                  bottom: 12,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.7),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFC5A052), width: 1),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.volume_off_rounded, color: Color(0xFFC5A052), size: 12),
                        SizedBox(width: 4),
                        Text(
                          'Toca para sonido',
                          style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    ),
  );
}
}


