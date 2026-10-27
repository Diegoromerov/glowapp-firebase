import 'package:flutter/material.dart';
import '../shared/glow_tokens.dart';

/// Widget animado 3D interactivo que renderiza el emblema metálico "GA" de Aura
/// con iluminación satinada Oro Rosa, efecto giroscópico 3D (tilt), sombreado de elevación
/// y pulsación de respiración cromática.
class Aura3DEmblemWidget extends StatefulWidget {
  final double size;
  final Duration duration;

  const Aura3DEmblemWidget({
    super.key,
    this.size = 220.0,
    this.duration = const Duration(seconds: 4),
  });

  @override
  State<Aura3DEmblemWidget> createState() => _Aura3DEmblemWidgetState();
}

class _Aura3DEmblemWidgetState extends State<Aura3DEmblemWidget>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _pulseAnimation;
  late final Animation<double> _rotationAnimation;

  // Rotación 3D por toque (Tilt Effect)
  double _tiltX = 0.0;
  double _tiltY = 0.0;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: widget.duration,
    )..repeat(reverse: true);

    _pulseAnimation = CurvedAnimation(
      parent: _controller,
      curve: Curves.easeInOut,
    );

    _rotationAnimation = Tween<double>(begin: -0.05, end: 0.05).animate(_pulseAnimation);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onPanUpdate(DragUpdateDetails details) {
    setState(() {
      _tiltY += details.delta.dx * 0.005;
      _tiltX -= details.delta.dy * 0.005;
      _tiltX = _tiltX.clamp(-0.4, 0.4);
      _tiltY = _tiltY.clamp(-0.4, 0.4);
    });
  }

  void _onPanEnd(DragEndDetails details) {
    setState(() {
      _tiltX = 0.0;
      _tiltY = 0.0;
    });
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onPanUpdate: _onPanUpdate,
      onPanEnd: _onPanEnd,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, child) {
          final scale = 0.95 + (0.10 * _pulseAnimation.value);
          final rotZ = _rotationAnimation.value;

          return Transform(
            alignment: Alignment.center,
            transform: Matrix4.identity()
              ..setEntry(3, 2, 0.0015) // Perspectiva 3D
              ..rotateX(_tiltX)
              ..rotateY(_tiltY)
              ..rotateZ(rotZ)
              ..scale(scale),
            child: Container(
              width: widget.size,
              height: widget.size,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: GlowTokens.roseGold.withOpacity(0.45 + (0.25 * _pulseAnimation.value)),
                    blurRadius: 32.0,
                    spreadRadius: 4.0,
                    offset: const Offset(0, 10),
                  ),
                  BoxShadow(
                    color: GlowTokens.amber.withOpacity(0.3),
                    blurRadius: 18.0,
                    spreadRadius: 2.0,
                  ),
                ],
              ),
              child: ClipOval(
                child: Stack(
                  children: [
                    // Capa 1: Imagen del Emblema 3D "GA" Oro Rosa
                    Positioned.fill(
                      child: Image.asset(
                        'images/aura_3d_emblem.webp',
                        fit: BoxFit.cover,
                      ),
                    ),

                    // Capa 2: Degradado Satinado Metálico 3D con reflejo dinámico
                    Positioned.fill(
                      child: Container(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [
                              Colors.white.withOpacity(0.25 * (1 - _pulseAnimation.value)),
                              Colors.transparent,
                              GlowTokens.nightAndean.withOpacity(0.15),
                            ],
                            stops: const [0.0, 0.5, 1.0],
                          ),
                        ),
                      ),
                    ),

                    // Capa 3: Brillo especular deslumbrante que se desplaza
                    Positioned(
                      top: widget.size * (0.1 + (0.4 * _pulseAnimation.value)),
                      left: widget.size * (0.1 + (0.4 * _pulseAnimation.value)),
                      child: Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: Colors.white.withOpacity(0.35),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.white.withOpacity(0.35),
                              blurRadius: 15.0,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
