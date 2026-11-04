import 'package:glow_core/glow_core.dart';
import 'package:flutter/material.dart';
/// Pantalla de Bienvenida de "Aura" (IA Asesora de Belleza de GlowApp).
/// Cuenta con el nuevo Emblema Metálico 3D "GA" en Oro Rosa con animación interactiva.
class AuraWelcomeScreen extends StatelessWidget {
  final VoidCallback? onStartRitual;

  const AuraWelcomeScreen({
    super.key,
    this.onStartRitual,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SizedBox.expand(
        child: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                GlowTokens.creamSilk,
                GlowTokens.amber.withValues(alpha: 0.25),
                GlowTokens.terracota.withValues(alpha: 0.4),
                GlowTokens.nightAndean,
              ],
              stops: const [0.0, 0.35, 0.7, 1.0],
            ),
          ),
          child: SafeArea(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 520),
                child: SingleChildScrollView(
                  physics: const BouncingScrollPhysics(),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 16.0),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const SizedBox(height: 12),
                        const Aura3DEmblemWidget(
                          size: 200.0,
                        ),
                        const SizedBox(height: 24),
                        const GlowGlassCard(
                          child: Column(
                            children: [
                              Text(
                                'Hola, soy Aura',
                                style: TextStyle(
                                  fontFamily: 'CormorantGaramond',
                                  fontSize: 32,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFF1F1A15),
                                ),
                                textAlign: TextAlign.center,
                              ),
                              SizedBox(height: 10),
                              Text(
                                'Tu asesora de belleza y bienestar con Inteligencia Artificial. Diagnosticaré tu tipo de piel, rostro e higiene capilar para sugerirte el ritual perfecto.',
                                style: TextStyle(
                                  fontFamily: 'Inter',
                                  fontSize: 14,
                                  color: Color(0xFF4A3E39),
                                  height: 1.4,
                                ),
                                textAlign: TextAlign.center,
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 28),
                        Container(
                          width: double.infinity,
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
                                blurRadius: 14,
                                offset: const Offset(0, 4),
                              ),
                            ],
                          ),
                          child: ElevatedButton(
                            onPressed: onStartRitual,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.transparent,
                              shadowColor: Colors.transparent,
                              foregroundColor: const Color(0xFF1F1A15),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                              elevation: 0,
                            ),
                            child: const Text(
                              'Comenzar mi ritual',
                              style: TextStyle(
                                fontFamily: 'Inter',
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                                color: Color(0xFF1F1A15),
                                letterSpacing: 0.5,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 16),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

