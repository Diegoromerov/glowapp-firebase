import 'package:flutter/material.dart';
import 'package:rive/rive.dart' hide ImageAsset;
import '../tokens/motion_tokens.dart';

/// Variantes de animación del logo disponibles.
enum GlowLogoVariant {
  /// Animación de entrada (hero/splash) — 1.2s, no loop, hold final frame.
  entrada,

  /// Animación idle/ambient — 3s, loop seamless.
  idle,

  /// Animación de transición entre pantallas — 0.6s, no loop.
  transicion,
}

/// Widget del logo animado de GlowApp usando Rive (con fallback Lottie).
///
/// Uso básico:
/// ```dart
/// GlowLogoAnimation(
///   variant: GlowLogoVariant.entrada,
///   size: 200,
///   onComplete: () => navigateToHome(),
/// )
/// ```
class GlowLogoAnimation extends StatefulWidget {
  final GlowLogoVariant variant;
  final double size;
  final Duration? customDuration;
  final VoidCallback? onComplete;
  final bool useMenTokens;
  final Color? colorFilter;

  const GlowLogoAnimation({
    super.key,
    required this.variant,
    this.size = 200,
    this.customDuration,
    this.onComplete,
    this.useMenTokens = false,
    this.colorFilter,
  });

  @override
  State<GlowLogoAnimation> createState() => _GlowLogoAnimationState();
}

class _GlowLogoAnimationState extends State<GlowLogoAnimation>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  RiveAnimationController? _riveController;
  bool _isRiveLoaded = false;
  String? _riveError;

  // Mapeo de variante a asset Rive
  static const Map<GlowLogoVariant, String> _riveAssets = {
    GlowLogoVariant.entrada: 'assets/motion/logo_entrada.riv',
    GlowLogoVariant.idle: 'assets/motion/logo_idle.riv',
    GlowLogoVariant.transicion: 'assets/motion/logo_transicion.riv',
  };

  // Mapeo de variante a asset Lottie (fallback)
  static const Map<GlowLogoVariant, String> _lottieAssets = {
    GlowLogoVariant.entrada: 'assets/motion/logo_entrada.json',
    GlowLogoVariant.idle: 'assets/motion/logo_idle.json',
    GlowLogoVariant.transicion: 'assets/motion/logo_transicion.json',
  };

  // Duraciones por variante (sobrescribibles con customDuration)
  static const Map<GlowLogoVariant, Duration> _defaultDurations = {
    GlowLogoVariant.entrada: Duration(milliseconds: 1200),
    GlowLogoVariant.idle: Duration(seconds: 3),
    GlowLogoVariant.transicion: Duration(milliseconds: 600),
  };

  @override
  void initState() {
    super.initState();
    final duration = widget.customDuration ?? _defaultDurations[widget.variant]!;
    _controller = AnimationController(vsync: this, duration: duration);
    _loadRive();
  }

  Future<void> _loadRive() async {
    try {
      // Rive se carga automáticamente via RiveAnimation.asset
      // Aquí solo marcamos como cargado; el widget RiveAnimation maneja el estado
      setState(() => _isRiveLoaded = true);
    } catch (e) {
      setState(() => _riveError = e.toString());
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _riveController?.dispose();
    super.dispose();
  }

  void _onRiveInit(Artboard artboard) {
    // Configurar controller según variante
    switch (widget.variant) {
      case GlowLogoVariant.entrada:
        _riveController = OneShotAnimation('entrada', autoplay: true)
          ..addListener(_onAnimationEnd);
        break;
      case GlowLogoVariant.idle:
        _riveController = SimpleAnimation('idle', autoplay: true);
        break;
      case GlowLogoVariant.transicion:
        _riveController = OneShotAnimation('transicion', autoplay: true)
          ..addListener(_onAnimationEnd);
        break;
    }
    artboard.addController(_riveController!);
  }

  void _onAnimationEnd() {
    if (!mounted) return;
    // Para entrada y transición: hold final frame y callback
    if (widget.variant != GlowLogoVariant.idle) {
      _controller.stop();
      widget.onComplete?.call();
    }
  }

  @override
  Widget build(BuildContext context) {
    final tokens = widget.useMenTokens
        ? MotionTokens.forMode(context) // usa Men's Mode tokens
        : MotionTokens.forMode(context); // usa default (placeholder)

    // Color filter para Men's Mode (obsidian/champagne) o default (Gold 871)
    final color = widget.colorFilter ??
        (widget.useMenTokens ? const Color(0xFFF5E6D3) : const Color(0xFFC5A052));

    return SizedBox(
      width: widget.size,
      height: widget.size,
      child: _buildAnimation(color),
    );
  }

  Widget _buildAnimation(Color color) {
    final riveAsset = _riveAssets[widget.variant]!;

    // Intentar Rive primero
    return RepaintBoundary(
      child: RiveAnimation.asset(
        riveAsset,
        fit: BoxFit.contain,
        onInit: _onRiveInit,
        placeholder: _buildPlaceholder(color),
      ),
    );
  }

  Widget _buildPlaceholder(Color color) {
    // Placeholder estático mientras carga Rive
    return Container(
      width: widget.size,
      height: widget.size,
      alignment: Alignment.center,
      child: Icon(
        Icons.auto_awesome,
        size: widget.size * 0.6,
        color: color,
      ),
    );
  }
}

/// Variante simplificada para uso sin Rive (solo Lottie o estático).
/// Útil para web o cuando Rive no está disponible.
class GlowLogoAnimationSimple extends StatelessWidget {
  final GlowLogoVariant variant;
  final double size;
  final Duration? customDuration;
  final VoidCallback? onComplete;
  final bool useMenTokens;
  final Color? colorFilter;

  const GlowLogoAnimationSimple({
    super.key,
    required this.variant,
    this.size = 200,
    this.customDuration,
    this.onComplete,
    this.useMenTokens = false,
    this.colorFilter,
  });

  @override
  Widget build(BuildContext context) {
    final color = colorFilter ??
        (useMenTokens ? const Color(0xFFF5E6D3) : const Color(0xFFC5A052));

    // Placeholder estático con animación nativa Flutter
    return SizedBox(
      width: size,
      height: size,
      child: _buildNativeAnimation(context, color),
    );
  }

  Widget _buildNativeAnimation(BuildContext context, Color color) {
    final tokens = MotionTokens.forMode(context);
    final duration = customDuration ??
        {
          GlowLogoVariant.entrada: Duration(milliseconds: 1200),
          GlowLogoVariant.idle: Duration(seconds: 3),
          GlowLogoVariant.transicion: Duration(milliseconds: 600),
        }[variant]!;

    switch (variant) {
      case GlowLogoVariant.entrada:
        return TweenAnimationBuilder<double>(
          tween: Tween(begin: 0.0, end: 1.0),
          duration: duration,
          curve: tokens.easeOutExpo,
          onEnd: onComplete,
          builder: (context, value, child) => Transform.scale(
            scale: 0.3 + (0.7 * value),
            child: Opacity(
              opacity: value,
              child: child,
            ),
          ),
          child: _buildStaticLogo(color),
        );

      case GlowLogoVariant.idle:
        return _IdleLoop(size: size, color: color, tokens: tokens);

      case GlowLogoVariant.transicion:
        return TweenAnimationBuilder<double>(
          tween: Tween(begin: 0.0, end: 1.0),
          duration: duration,
          curve: tokens.easeOutCubic,
          onEnd: onComplete,
          builder: (context, value, child) => Transform.translate(
            offset: Offset(0, 20 * (1 - value)),
            child: Opacity(opacity: value, child: child),
          ),
          child: _buildStaticLogo(color),
        );
    }
  }

  Widget _buildStaticLogo(Color color) {
    return Icon(Icons.auto_awesome, size: size * 0.8, color: color);
  }
}

/// Loop idle nativo (pulse sutil + rotación lenta).
class _IdleLoop extends StatefulWidget {
  final double size;
  final Color color;
  final MotionTokensMode tokens;

  const _IdleLoop({
    required this.size,
    required this.color,
    required this.tokens,
  });

  @override
  State<_IdleLoop> createState() => _IdleLoopState();
}

class _IdleLoopState extends State<_IdleLoop> with SingleTickerProviderStateMixin {
  late final AnimationController _pulseController;
  late final AnimationController _rotateController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 3),
    )..repeat(reverse: true);

    _rotateController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 12),
    )..repeat();
  }

  @override
  void dispose() {
    _pulseController.dispose();
    _rotateController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Listenable.merge([_pulseController, _rotateController]),
      builder: (context, child) {
        final pulse = 0.95 + (0.05 * Curves.easeInOut.transform(_pulseController.value));
        final rotation = _rotateController.value * 0.1; // ±0.1 rad

        return Transform.rotate(
          angle: rotation,
          child: Transform.scale(
            scale: pulse,
            child: child,
          ),
        );
      },
      child: _buildStaticLogo(widget.color),
    );
  }

  Widget _buildStaticLogo(Color color) {
    return Icon(Icons.auto_awesome, size: widget.size * 0.8, color: color);
  }
}