// apps/glow_provider/lib/screens/auth/verification_pending_screen.dart
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:glow_core/services/auth_service.dart';
import 'package:glow_core/glow_core.dart';

/// FetchProfile function para inyección en tests (AuthService.fetchProfile es static)
Future<Map<String, dynamic>?> Function() _fetchProfileFn = AuthService.fetchProfile;

/// Permite sobrescribir fetchProfile para tests. Llamar antes de pumpWidget.
void overrideFetchProfileForTesting(Future<Map<String, dynamic>?> Function() fn) {
  _fetchProfileFn = fn;
}

/// Resetea al servicio real. Llamar en tearDown.
void resetFetchProfileForTesting() {
  _fetchProfileFn = AuthService.fetchProfile;
}

class VerificationPendingScreen extends StatefulWidget {
  const VerificationPendingScreen({super.key});

  @override
  State<VerificationPendingScreen> createState() => _VerificationPendingScreenState();
}

class _VerificationPendingScreenState extends State<VerificationPendingScreen>
    with WidgetsBindingObserver {
  Timer? _pollingTimer;
  bool _hasNavigated = false;
  String _currentStatus = 'PENDIENTE';
  String? _rejectionNote;
  bool _isChecking = false;

  /// Obtiene la función de fetchProfile (real o mockeada en tests)
  Future<Map<String, dynamic>?> Function() get _fetchProfile => _fetchProfileFn;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _startPolling();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _pollingTimer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);
    if (state == AppLifecycleState.resumed && !_hasNavigated) {
      _checkVerificationStatus();
    }
  }

  /// Polling cada 30s: consulta /api/users/profile y compara estatus_verificacion.
  /// Fallback por si la push no llega o la app estaba terminada.
  void _startPolling() {
    _pollingTimer = Timer.periodic(const Duration(seconds: 30), (_) async {
      if (!mounted || _hasNavigated) return;
      await _checkVerificationStatus();
    });
    // Chequeo inicial inmediato
    _checkVerificationStatus();
  }

  Future<void> _checkVerificationStatus() async {
    if (_isChecking || _hasNavigated) return;
    setState(() => _isChecking = true);
    try {
          final profile = await _fetchProfile();
      if (!mounted || _hasNavigated) return;
      if (profile == null) return;

      final user = profile['user'] as Map<String, dynamic>?;
      if (user == null) return;

      final estatus = user['estatus_verificacion']?.toString() ?? 'PENDIENTE';
      final nota = user['rechazo_verificacion_nota']?.toString();

      if (estatus == _currentStatus && nota == _rejectionNote) return;

      setState(() {
        _currentStatus = estatus;
        _rejectionNote = nota;
      });

      switch (estatus) {
        case 'APROBADO':
          _navigateToHome();
          break;
        case 'RECHAZADO':
          // No navegamos; mostramos la nota en la UI
          break;
        case 'PENDIENTE':
        default:
          // Seguimos en polling
          break;
      }
    } catch (_) {
      // Silencioso: el polling es best-effort
    } finally {
      if (mounted) setState(() => _isChecking = false);
    }
  }

  void _navigateToHome() {
    if (!_hasNavigated && mounted) {
      _hasNavigated = true;
      _pollingTimer?.cancel();
      Navigator.pushNamedAndRemoveUntil(context, '/home', (route) => false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isRejected = _currentStatus == 'RECHAZADO';

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
                      color: isRejected
                                                ? const Color(0xFFFDE8E8)
                                                : const Color(0xFFF3D59B).withValues(alpha: 0.2),
                      border: Border.all(
                        color: isRejected
                            ? const Color(0xFFE57373)
                            : const Color(0xFFC5A052),
                        width: 2,
                      ),
                    ),
                    child: Icon(
                      isRejected
                          ? Icons.verified_user_outlined
                          : Icons.verified_user_outlined,
                      size: 48,
                      color: isRejected
                          ? const Color(0xFFE57373)
                          : const Color(0xFFC5A052),
                    ),
                  ),
                  const SizedBox(height: 32),
                  Text(
                    isRejected ? 'Verificación rechazada' : 'Perfil en proceso de verificación',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontSize: 28,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF1F1A15),
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    isRejected
                        ? 'El equipo de GlowApp no pudo validar tu documentación. Revisa el motivo y corrige lo necesario para volver a enviar.'
                        : 'El equipo de GlowApp está validando tus documentos de identidad, RUT y acreditación profesional para garantizar la seguridad del servicio.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontFamily: 'Inter',
                      fontSize: 14,
                      color: Color(0xFF6B5E59),
                      height: 1.5,
                    ),
                  ),
                  if (isRejected && _rejectionNote != null) ...[
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFDE8E8),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFE57373)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Row(
                            children: [
                              Icon(Icons.info_outline, color: Color(0xFFE57373), size: 20),
                              SizedBox(width: 8),
                              Text(
                                'Motivo del rechazo:',
                                style: TextStyle(
                                  fontFamily: 'Inter',
                                  fontSize: 13,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFFE57373),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text(
                            _rejectionNote!,
                            style: const TextStyle(
                              fontFamily: 'Inter',
                              fontSize: 13,
                              color: Color(0xFF8E7D7A),
                              height: 1.4,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 12),
                  Text(
                    isRejected
                        ? 'Corrige la documentación y vuelve a enviar desde tu perfil para reiniciar la verificación.'
                        : 'Recibirás una notificación y podrás acceder a tu panel de prestador tan pronto como el estado cambie a APROBADO.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontFamily: 'Inter',
                      fontSize: 13,
                      color: Color(0xFF8E7D7A),
                      fontStyle: FontStyle.italic,
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 48),
                  // Botón "Revisar estado"
                  Container(
                    height: 52,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: const Color(0xFFC5A052),
                        width: 1.5,
                      ),
                    ),
                    child: OutlinedButton.icon(
                      onPressed: _isChecking ? null : _checkVerificationStatus,
                      icon: _isChecking
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Color(0xFFC5A052),
                              ),
                            )
                          : const Icon(Icons.refresh, color: Color(0xFFC5A052)),
                      label: Text(
                        _isChecking ? 'Comprobando...' : 'Revisar estado',
                        style: const TextStyle(
                          fontFamily: 'Inter',
                          color: Color(0xFFC5A052),
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      style: OutlinedButton.styleFrom(
                        side: BorderSide.none,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  // Botón "Cerrar Sesión"
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
