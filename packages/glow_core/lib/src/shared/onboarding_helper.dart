// frontend/lib/shared/onboarding_helper.dart
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'theme.dart';

class OnboardingWalkthroughHelper {
  static const String _clientPrefsKey = 'hide_walkthrough_client';
  static const String _providerPrefsKey = 'hide_walkthrough_provider';

  static Future<void> showWalkthroughIfNeeded(
      BuildContext context, String role) async {
    final prefs = await SharedPreferences.getInstance();
    final bool hideWalkthrough = role == 'client'
        ? (prefs.getBool(_clientPrefsKey) ?? false)
        : (prefs.getBool(_providerPrefsKey) ?? false);

    if (!hideWalkthrough) {
      if (!context.mounted) return;
      _showWalkthroughOverlay(context, role, prefs);
    }
  }

  static void _showWalkthroughOverlay(
      BuildContext context, String role, SharedPreferences prefs) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) {
        return _WalkthroughDialog(role: role, prefs: prefs);
      },
    );
  }
}

class _WalkthroughDialog extends StatefulWidget {
  final String role;
  final SharedPreferences prefs;

  const _WalkthroughDialog({required this.role, required this.prefs});

  @override
  State<_WalkthroughDialog> createState() => _WalkthroughDialogState();
}

class _WalkthroughDialogState extends State<_WalkthroughDialog> {
  int _currentStep = 0;
  bool _dontShowAgain = false;

  List<WalkthroughStep> get _steps {
    if (widget.role == 'client') {
      return [
        WalkthroughStep(
                  title: '¡Te damos la bienvenida, Cliente!',
                  description: 'Aquí tienes una guía interactiva sobre cómo usar tu aplicación de belleza a domicilio.',
                  icon: Icons.face_retouching_natural,
                  imageUrl: 'images/onboarding/onboarding_01.webp', // Fallback gracefully if not loaded
                  simulationText: 'Visualiza prestadores y estilistas profesionales de confianza en el mapa de Fontibón en tiempo real.',
                ),
        WalkthroughStep(
          title: 'Paso 1: Agenda tu Cita',
          description: 'Selecciona un prestador, escoge el servicio y reserva tu horario ideal.',
          icon: Icons.calendar_month_outlined,
          simulationText: 'Simulación: Has seleccionado "Manicura Premium" para mañana a las 3:00 PM. El pago se procesa de manera segura vía Wompi.',
        ),
        WalkthroughStep(
          title: 'Paso 2: Seguimiento e Inicio',
          description: 'Rastrea en vivo al prestador de servicios en su camino a tu domicilio.',
          icon: Icons.location_on_outlined,
          simulationText: 'Simulación: El estilista ha hecho check-in. Puedes chatear en tiempo real y coordinar detalles de llegada.',
        ),
        WalkthroughStep(
          title: 'Paso 3: Seguridad y Calificación',
          description: 'Valida tu servicio con el PIN único que debes proveer al finalizar, agrega propina opcional y califica la experiencia.',
          icon: Icons.security_outlined,
          simulationText: 'Simulación: Al terminar el servicio, dictas tu PIN secreto de 4 dígitos. Se liberan los fondos y puedes dejar una valoración de 5 estrellas.',
        ),
      ];
    } else {
      return [
        WalkthroughStep(
          title: '¡Bienvenido al Panel de Socio Prestador!',
          description: 'Guía interactiva sobre cómo gestionar tus citas de belleza y tus finanzas en la plataforma.',
          icon: Icons.storefront_outlined,
          simulationText: 'Recibe solicitudes de clientes cercanos y configura tu estado en línea/offline fácilmente.',
        ),
        WalkthroughStep(
          title: 'Paso 1: Gestionar Agenda',
          description: 'Mira tus próximas citas pendientes de pago, confirmadas y en progreso desde la vista principal.',
          icon: Icons.assignment_outlined,
          simulationText: 'Simulación: Te ha llegado una reserva de "Corte y Peinado a Domicilio" por \$50,000 COP en Fontibón.',
        ),
        WalkthroughStep(
          title: 'Paso 2: Ruta y Check-In',
          description: 'Navega hacia el domicilio del cliente. Al llegar, realiza check-in con validación GPS.',
          icon: Icons.navigation_outlined,
          simulationText: 'Simulación: Llegas al domicilio y presionas "Registrar Llegada". Tu ubicación GPS se valida contra el radio de tolerancia.',
        ),
        WalkthroughStep(
          title: 'Paso 3: Finalizar y Recibir Fondos',
          description: 'Solicita al cliente su código PIN de 4 dígitos al concluir el servicio para transferir el saldo neto de forma automática a tu billetera.',
          icon: Icons.account_balance_wallet_outlined,
          simulationText: 'Simulación: Ingresas el PIN provisto por el cliente. De forma inmediata se deposita el saldo neto (80%) en tu balance de Nequi.',
        ),
      ];
    }
  }

  Future<void> _handleClose() async {
    if (_dontShowAgain) {
      final key = widget.role == 'client'
          ? OnboardingWalkthroughHelper._clientPrefsKey
          : OnboardingWalkthroughHelper._providerPrefsKey;
      await widget.prefs.setBool(key, true);
    }
    if (mounted) {
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    final step = _steps[_currentStep];
    final isLast = _currentStep == _steps.length - 1;

    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
      backgroundColor: Colors.white,
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Header: Step indicators
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Instrucciones (${_currentStep + 1}/${_steps.length})',
                  style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      color: AppTheme.primary,
                      fontSize: 12,
                      letterSpacing: 0.5),
                ),
                Row(
                  children: List.generate(_steps.length, (idx) {
                    return Container(
                      margin: const EdgeInsets.symmetric(horizontal: 2.5),
                      width: _currentStep == idx ? 16 : 6,
                      height: 6,
                      decoration: BoxDecoration(
                        color: _currentStep == idx
                            ? AppTheme.primary
                            : const Color(0xFFE8D7D3),
                        borderRadius: BorderRadius.circular(3),
                      ),
                    );
                  }),
                ),
              ],
            ),
            const SizedBox(height: 20),

            // Step Icon Circle
            Center(
              child: Container(
                padding: const EdgeInsets.all(18),
                decoration: const BoxDecoration(
                  color: Color(0xFFFFF5F3),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  step.icon,
                  size: 44,
                  color: AppTheme.primary,
                ),
              ),
            ),
            const SizedBox(height: 20),

            // Step Title
            Text(
              step.title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 18,
                  color: Color(0xFF4A3E3D),
                  letterSpacing: -0.5),
            ),
            const SizedBox(height: 10),

            // Step Description
            Text(
              step.description,
              textAlign: TextAlign.center,
              style: const TextStyle(
                  fontSize: 13.5, color: Colors.grey, height: 1.4),
            ),
            const SizedBox(height: 16),

            // Simulation Widget
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFFAF6F4),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFF3EAE8)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.play_circle_outline,
                          color: AppTheme.primary, size: 18),
                      SizedBox(width: 6),
                      Text(
                        'Simulación de Uso',
                        style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.primary),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    step.simulationText,
                    style: const TextStyle(
                        fontSize: 12, color: Colors.black87, height: 1.35),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Don't show again Checkbox
            CheckboxListTile(
              value: _dontShowAgain,
              onChanged: (val) => setState(() => _dontShowAgain = val ?? false),
              title: const Text(
                'No volver a mostrar instructivo',
                style: TextStyle(fontSize: 12, color: Colors.black87),
              ),
              activeColor: AppTheme.primary,
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
            ),
            const SizedBox(height: 16),

            // Navigation Buttons
            Row(
              children: [
                if (_currentStep > 0)
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => setState(() => _currentStep--),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppTheme.primary,
                        side: const BorderSide(color: Color(0xFFE8D7D3)),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(30)),
                        padding: const EdgeInsets.symmetric(vertical: 12),
                      ),
                      child: const Text('Atrás',
                          style: TextStyle(fontWeight: FontWeight.bold)),
                    ),
                  ),
                if (_currentStep > 0) const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: isLast
                        ? _handleClose
                        : () => setState(() => _currentStep++),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.primary,
                      foregroundColor: Colors.white,
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(30)),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                    child: Text(
                      isLast ? '¡Comenzar!' : 'Siguiente',
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class WalkthroughStep {
  final String title;
  final String description;
  final IconData icon;
  final String? imageUrl;
  final String simulationText;

  WalkthroughStep({
    required this.title,
    required this.description,
    required this.icon,
    this.imageUrl,
    required this.simulationText,
  });
}
