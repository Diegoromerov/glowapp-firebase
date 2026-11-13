// lib/screens/invite_welcome_screen.dart
//
// Pantalla de bienvenida para quien llega por un enlace de invitación.
//
// El problema que resuelve: la invitada abría el enlace y aterrizaba en el mapa,
// con el tour encima y sin ninguna señal de que alguien la había invitado. El
// código viajaba en la URL y solo se usaba si esa persona llegaba a registrarse
// por su cuenta, más tarde, acordándose de todo.
//
// Aquí el orden es otro: se le da la bienvenida, se le muestra (y se le deja
// corregir) el código con el que la invitaron, y al continuar ese código queda
// guardado en el dispositivo. La app sigue al inicio como siempre, y cuando la
// persona cree su cuenta el campo de invitación ya viene relleno.
import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Clave donde queda el código hasta que la persona se registre.
const String kClaveCodigoInvitacion = 'codigoInvitacionPendiente';

/// Guarda el código para el registro. Vacío o nulo lo borra.
Future<void> guardarCodigoInvitacionPendiente(String? codigo) async {
  final limpio = normalizarCodigoInvitacion(codigo);
  final prefs = await SharedPreferences.getInstance();
  if (limpio.isEmpty) {
    await prefs.remove(kClaveCodigoInvitacion);
  } else {
    await prefs.setString(kClaveCodigoInvitacion, limpio);
  }
}

/// Código guardado de una invitación anterior, o '' si no hay.
Future<String> leerCodigoInvitacionPendiente() async {
  final prefs = await SharedPreferences.getInstance();
  return prefs.getString(kClaveCodigoInvitacion) ?? '';
}

class InviteWelcomeScreen extends StatefulWidget {
  const InviteWelcomeScreen({super.key, this.codigoInicial});

  /// Código que venía en el enlace. Si viene, el campo aparece relleno.
  final String? codigoInicial;

  @override
  State<InviteWelcomeScreen> createState() => _InviteWelcomeScreenState();
}

class _InviteWelcomeScreenState extends State<InviteWelcomeScreen> {
  late final TextEditingController _ctrl = TextEditingController(
    text: normalizarCodigoInvitacion(
      widget.codigoInicial ?? codigoInvitacionDeLaUrl(Uri.base),
    ),
  );
  bool _guardando = false;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _continuar() async {
    if (_guardando) return;
    setState(() => _guardando = true);
    await guardarCodigoInvitacionPendiente(_ctrl.text);
    if (!mounted) return;
    // Al inicio, como siempre. El código queda guardado y el registro lo usará.
    Navigator.of(context).pushReplacementNamed('/home');
  }

  @override
  Widget build(BuildContext context) {
    final codigo = normalizarCodigoInvitacion(_ctrl.text);
    final hayCodigo = codigo.isNotEmpty;

    return Scaffold(
      backgroundColor: LuxeColors.nude50,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 32),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Container(
                      width: 26,
                      height: 1,
                      color: LuxeColors.gold871.withValues(alpha: .6),
                    ),
                    const SizedBox(width: 9),
                    const Text(
                      'TE INVITARON A GLOWAPP',
                      style: TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 9,
                        letterSpacing: 2.8,
                        fontWeight: FontWeight.w600,
                        color: LuxeColors.gold700,
                      ),
                    ),
                  ]),
                  const SizedBox(height: 18),
                  const Text(
                    'Bienvenida a\nGlow Luxe',
                    style: TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontSize: 44,
                      height: 1.02,
                      letterSpacing: -0.8,
                      fontWeight: FontWeight.w500,
                      color: LuxeColors.nude900,
                    ),
                  ),
                  const SizedBox(height: 14),
                  const Text(
                    'Una amiga te invitó. Cuando crees tu cuenta vas a recibir '
                    'puntos de bienvenida en tu primera compra.',
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 13,
                      height: 1.6,
                      color: LuxeColors.nude600,
                    ),
                  ),
                  const SizedBox(height: 26),

                  const Text(
                    'TU CÓDIGO DE INVITACIÓN',
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 8.5,
                      letterSpacing: 2,
                      fontWeight: FontWeight.w600,
                      color: LuxeColors.nude500,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: LuxeColors.nude900.withValues(alpha: .12),
                      ),
                    ),
                    child: TextField(
                      controller: _ctrl,
                      textCapitalization: TextCapitalization.characters,
                      onChanged: (_) => setState(() {}),
                      decoration: const InputDecoration(
                        border: InputBorder.none,
                        hintText: 'GLOW1234',
                        hintStyle: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 16,
                          color: LuxeColors.nude400,
                          letterSpacing: 3,
                        ),
                      ),
                      style: const TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 3,
                        color: LuxeColors.nude900,
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    hayCodigo
                        ? 'Guardaremos este código para cuando crees tu cuenta.'
                        : 'Puedes continuar sin código y añadirlo después.',
                    style: const TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 11,
                      color: LuxeColors.nude500,
                    ),
                  ),
                  const SizedBox(height: 26),

                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: FilledButton(
                      onPressed: _guardando ? null : _continuar,
                      style: FilledButton.styleFrom(
                        backgroundColor: LuxeColors.nude900,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                      child: Text(
                        hayCodigo ? 'Continuar' : 'Explorar GlowApp',
                        style: const TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          letterSpacing: .4,
                          color: LuxeColors.nude50,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Center(
                    child: TextButton(
                      onPressed: () => Navigator.of(context)
                          .pushReplacementNamed('/home'),
                      child: const Text(
                        'Prefiero ver la app primero',
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 11.5,
                          color: LuxeColors.nude500,
                        ),
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
