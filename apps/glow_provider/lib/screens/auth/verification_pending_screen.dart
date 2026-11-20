// frontend/lib/screens/auth/verification_pending_screen.dart
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:glow_core/services/auth_service.dart';
import 'package:glow_core/glow_core.dart';

class VerificationPendingScreen extends StatefulWidget {
  const VerificationPendingScreen({super.key});

  @override
  State<VerificationPendingScreen> createState() => _VerificationPendingScreenState();
}

class _VerificationPendingScreenState extends State<VerificationPendingScreen> {
  Timer? _pollingTimer;
  Timer? _startupDelayTimer;
  bool _hasNavigated = false;

  @override
  void initState() {
    super.initState();
    _startPolling();
    _listenForPushApproval();
  }

  @override
  void dispose() {
    _pollingTimer?.cancel();
    _startupDelayTimer?.cancel();
    super.dispose();
  }

  /// Escucha notificaciones push FCM mientras la pantalla está visible (foreground).
  /// Si llega PROVIDER_APPROVED, navega a /home.
  void _listenForPushApproval() {
    // El callback se registra en FcmService.initialize() en main.dart.
    // Aquí solo nos aseguramos de que, si la app está en foreground y llega el push,
    // el handler (_navigateFromPayload) llama al callback que navega.
    // No hay acción extra: el flujo es push -> FcmService._navigateFromPayload -> onPayloadTap.
    // El onPayloadTap se configura en main.dart (ver abajo en build).
  }

  /// Polling cada 30s: consulta /api/auth/session para ver si onboarding_completo cambió a true.
  /// Fallback por si la push no llega o la app estaba terminada y no consumió el deep-link.
  void _startPolling() {
    // Pequeño delay inicial para dar tiempo a que la sesión se hidrate
    _startupDelayTimer = Timer(const Duration(seconds: 3), () {
      _pollingTimer = Timer.periodic(const Duration(seconds: 30), (_) async {
        if (!mounted || _hasNavigated) return;
        try {
          final session = await AuthService.restoreBiometricSession();
          if (session != null) {
            final user = session['user'] as Map<String, dynamic>?;
            final onboardingCompleto = user?['onboarding_completo'] == true;
            if (onboardingCompleto && mounted && !_hasNavigated) {
              _hasNavigated = true;
              _pollingTimer?.cancel();
              _startupDelayTimer?.cancel();
              Navigator.pushNamedAndRemoveUntil(context, '/home', (route) => false);
            }
          }
        } catch (_) {
          // Silencioso: el polling es best-effort
        }
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 28.0),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(
                    width: 90,
                    height: 90,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: Color(0xFFF3D59B).withOpacity(0.2),
                      border: Border.all(color: const Color(0xFFC5A052), width: 2),
                    ),
                    child: const Icon(
                      Icons.verified_user_outlined,
                      size: 48,
                      color: Color(0xFFC5A052),
                    ),
                  ),
                  const SizedBox(height: 32),
                  const Text(
                    'Perfil en proceso de verificación',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontSize: 28,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF1F1A15),
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'El equipo de GlowApp está validando físicamente tus documentos de identidad, RUT y acreditación profesional para garantizar la seguridad del servicio.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontFamily: 'Inter',
                      fontSize: 14,
                      color: Color(0xFF6B5E59),
                      height: 1.5,
                    ),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'Recibirás una notificación y podrás acceder a tu panel de prestador tan pronto como el estado cambie a APROBADO.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontFamily: 'Inter',
                      fontSize: 13,
                      color: Color(0xFF8E7D7A),
                      fontStyle: FontStyle.italic,
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 48),
                  Container(
                    height: 52,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: const Color(0xFFC5A052), width: 1.5),
                    ),
                    child: OutlinedButton.icon(
                      onPressed: () async {
                        await AuthService.logout();
                        if (context.mounted) {
                          Navigator.pushReplacementNamed(context, '/auth/login');
                        }
                      },
                      icon: const Icon(Icons.logout, color: Color(0xFFC5A052)),
                      label: const Text(
                        'Cerrar Sesión',
                        style: TextStyle(
                          fontFamily: 'Inter',
                          color: Color(0xFFC5A052),
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      style: OutlinedButton.styleFrom(
                        side: BorderSide.none,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
