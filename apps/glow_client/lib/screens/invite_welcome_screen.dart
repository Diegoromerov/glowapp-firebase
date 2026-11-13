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


/// Muestra la bienvenida de la invitación como hoja inferior.
///
/// Se usa hoja y no ruta a propósito: la persona YA llegó al inicio, el tour
/// corre encima y esto no lo interrumpe. Al continuar guarda el código y cierra.
Future<void> mostrarBienvenidaInvitacion(
  BuildContext context,
  String codigo,
) async {
  final inicial = normalizarCodigoInvitacion(codigo);
  final ctrl = TextEditingController(text: inicial);
  var guardado = false;

  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: LuxeColors.nude50,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (ctx) => Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 22,
        bottom: 22 + MediaQuery.of(ctx).viewInsets.bottom,
      ),
      child: StatefulBuilder(
        builder: (ctx, setEstado) => Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 38,
                height: 4,
                decoration: BoxDecoration(
                  color: LuxeColors.nude300,
                  borderRadius: BorderRadius.circular(9),
                ),
              ),
            ),
            const SizedBox(height: 18),
            const Text(
              'TE INVITARON A GLOWAPP',
              style: TextStyle(
                fontFamily: 'Manrope',
                fontSize: 8.5,
                letterSpacing: 2.6,
                fontWeight: FontWeight.w600,
                color: LuxeColors.gold700,
              ),
            ),
            const SizedBox(height: 10),
            const Text(
              'Bienvenida a\nGlow Luxe',
              style: TextStyle(
                fontFamily: 'CormorantGaramond',
                fontSize: 34,
                height: 1.02,
                fontWeight: FontWeight.w500,
                color: LuxeColors.nude900,
              ),
            ),
            const SizedBox(height: 10),
            const Text(
              'Una amiga te invitó. Guardamos su código para cuando crees tu '
              'cuenta y recibas los puntos de bienvenida.',
              style: TextStyle(
                fontFamily: 'Manrope',
                fontSize: 12,
                height: 1.5,
                color: LuxeColors.nude600,
              ),
            ),
            const SizedBox(height: 18),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(13),
                border: Border.all(
                  color: LuxeColors.nude900.withValues(alpha: .12),
                ),
              ),
              child: TextField(
                controller: ctrl,
                textCapitalization: TextCapitalization.characters,
                onChanged: (_) => setEstado(() {}),
                decoration: InputDecoration(
                  border: InputBorder.none,
                  hintText: 'GLOW1234',
                  hintStyle: const TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 15,
                    color: LuxeColors.nude400,
                    letterSpacing: 2.5,
                  ),
                  suffixIcon: normalizarCodigoInvitacion(ctrl.text).isEmpty
                      ? null
                      : const Icon(Icons.check_circle,
                          color: LuxeColors.gold871, size: 18),
                ),
                style: const TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 2.5,
                  color: LuxeColors.nude900,
                ),
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: FilledButton(
                onPressed: guardado
                    ? null
                    : () async {
                        guardado = true;
                        await guardarCodigoInvitacionPendiente(ctrl.text);
                        if (ctx.mounted) Navigator.of(ctx).pop();
                      },
                style: FilledButton.styleFrom(
                  backgroundColor: LuxeColors.nude900,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(13),
                  ),
                ),
                child: const Text(
                  'Continuar',
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: LuxeColors.nude50,
                  ),
                ),
              ),
            ),
            Center(
              child: TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: const Text(
                  'Ahora no',
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
  );
  ctrl.dispose();
}


/// Tarjeta de invitación pendiente, para pintar SOBRE el inicio.
///
/// Es contenido, no overlay: no necesita Navigator ni hoja modal. Dos capas de
/// overlay fallaron antes (navigatorKey y bottom sheet) y esto no depende de
/// ninguna de las dos.
class TarjetaInvitacionPendiente extends StatefulWidget {
  const TarjetaInvitacionPendiente({super.key});

  @override
  State<TarjetaInvitacionPendiente> createState() =>
      _TarjetaInvitacionPendienteState();
}

class _TarjetaInvitacionPendienteState
    extends State<TarjetaInvitacionPendiente> {
  final _ctrl = TextEditingController();
  bool _visible = false;
  bool _guardado = false;

  @override
  void initState() {
    super.initState();
    final delEnlace = normalizarCodigoInvitacion(
      codigoInvitacionDeLaUrl(Uri.base) ?? '',
    );
    if (delEnlace.isEmpty) return;
    _ctrl.text = delEnlace;
    _visible = true;
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_visible) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      decoration: BoxDecoration(
        color: LuxeColors.nude50,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: LuxeColors.gold871.withValues(alpha: .45)),
        boxShadow: [
          BoxShadow(
            color: LuxeColors.nude900.withValues(alpha: .16),
            blurRadius: 22,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'TE INVITARON A GLOWAPP',
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 8.5,
                    letterSpacing: 2.4,
                    fontWeight: FontWeight.w600,
                    color: LuxeColors.gold700,
                  ),
                ),
              ),
              InkWell(
                onTap: () => setState(() => _visible = false),
                child: const Padding(
                  padding: EdgeInsets.all(4),
                  child: Icon(Icons.close,
                      size: 16, color: LuxeColors.nude500),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            'Tu amiga te dejó un código',
            style: TextStyle(
              fontFamily: 'CormorantGaramond',
              fontSize: 21,
              fontWeight: FontWeight.w500,
              color: LuxeColors.nude900,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Guárdalo y lo aplicamos cuando crees tu cuenta.',
            style: TextStyle(
              fontFamily: 'Manrope',
              fontSize: 11,
              color: LuxeColors.nude600,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(11),
                    border: Border.all(
                      color: LuxeColors.nude900.withValues(alpha: .12),
                    ),
                  ),
                  child: TextField(
                    controller: _ctrl,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(
                      border: InputBorder.none,
                      hintText: 'GLOW1234',
                      hintStyle: TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 13,
                        color: LuxeColors.nude400,
                        letterSpacing: 2,
                      ),
                    ),
                    style: const TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 2,
                      color: LuxeColors.nude900,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                height: 42,
                child: FilledButton(
                  onPressed: _guardado
                      ? null
                      : () async {
                          await guardarCodigoInvitacionPendiente(_ctrl.text);
                          if (!mounted) return;
                          setState(() {
                            _guardado = true;
                            _visible = false;
                          });
                        },
                  style: FilledButton.styleFrom(
                    backgroundColor: LuxeColors.nude900,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(11),
                    ),
                  ),
                  child: Text(
                    _guardado ? 'Guardado' : 'Guardar',
                    style: const TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 11.5,
                      fontWeight: FontWeight.w700,
                      color: LuxeColors.nude50,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}


/// Después de crear la cuenta: ¿quedó aplicada la invitación?
///
/// Sin esto la usuaria guarda un código, entra con Google y no tiene forma de
/// saber si valió. Se consulta el backend y se le dice, con nombre y apellido:
/// o queda aplicada, o el código no sirvió.
Future<void> confirmarInvitacionAplicada(BuildContext context) async {
  final pendiente = await leerCodigoInvitacionPendiente();
  if (pendiente.isEmpty) return;

  final messenger = ScaffoldMessenger.of(context);
  try {
    final res = await ApiService.get('/api/auth/referral-info');
    final data = res is Map ? Map<String, dynamic>.from(res) : null;
    final por = data?['invitada_por'];

    if (por is Map && (por['nombre'] ?? '').toString().isNotEmpty) {
      messenger.showSnackBar(
        SnackBar(
          backgroundColor: LuxeColors.nude900,
          content: Text(
            'Invitación de ${por['nombre']} aplicada. Tus puntos de bienvenida '
            'llegan con tu primera compra.',
            style: const TextStyle(fontFamily: 'Manrope', fontSize: 12),
          ),
        ),
      );
      await guardarCodigoInvitacionPendiente('');
    } else {
      messenger.showSnackBar(
        const SnackBar(
          backgroundColor: Color(0xFF8A3B2E),
          content: Text(
            'No pudimos aplicar tu código de invitación. Revísalo o pídele a '
            'quien te invitó que te comparta el enlace.',
            style: TextStyle(fontFamily: 'Manrope', fontSize: 12),
          ),
        ),
      );
    }
  } catch (_) {
    // Si falla la consulta, no se molesta a la usuaria con un error técnico.
  }
}
