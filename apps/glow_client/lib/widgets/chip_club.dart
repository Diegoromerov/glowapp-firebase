import 'dart:async';

import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';


/// El nivel, a la vista, en el inicio.
///
/// El Club estaba a dos toques de profundidad (Perfil → tile) y quien no entraba
/// nunca sabía que existía. Este chip hace dos cosas a la vez: abre el Club con
/// un toque y pone el progreso delante cada vez que se mira el mapa. Un programa
/// de niveles funciona cuando el nivel se ve sin buscarlo.
///
/// Se esconde cuando no hay sesión —un botón que lleva a un login es peor que no
/// tenerlo— y mientras hay una invitación pendiente, que ocupa el mismo sitio.
class ChipClub extends StatefulWidget {
  const ChipClub({super.key, this.recargarCada, this.cargarNivel, this.consultarSesion});

  /// Para pruebas: permite refrescar sin remontar el widget.
  final Duration? recargarCada;

  /// Para pruebas: sustituye la llamada real al backend.
  final Future<NivelPuntos?> Function()? cargarNivel;

  /// Para pruebas: sustituye la comprobación de sesión.
  final Future<bool> Function()? consultarSesion;

  @override
  State<ChipClub> createState() => _ChipClubState();
}

class _ChipClubState extends State<ChipClub> {
  NivelPuntos? _nivel;
  bool _listo = false;
  bool _haySesion = false;
  Timer? _temporizador;

  @override
  void initState() {
    super.initState();
    _cargar();
    if (widget.recargarCada != null) {
      _temporizador = Timer.periodic(widget.recargarCada!, (_) => _cargar());
    }
  }

  @override
  void dispose() {
    _temporizador?.cancel();
    super.dispose();
  }

  Future<void> _cargar() async {
    // El chip NO se esconde por un código de invitación guardado.
    //
    // Lo hacía, para no chocar con la tarjeta de invitación, y el resultado fue
    // el peor: a quien le quedaba un código viejo en las preferencias —de una
    // prueba, de un enlace abierto una vez— el Club le desaparecía para siempre
    // y nada lo reparaba. Ahora la tarjeta se encoge para dejarle sitio.
    final nivel = await (widget.cargarNivel ?? RewardsService.obtenerNivel)();
    final sesion = await (widget.consultarSesion ??
        () async => await AuthService.getToken() != null)();
    if (!mounted) return;
    setState(() {
      _nivel = nivel;
      _haySesion = sesion;
      _listo = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    // Antes de saber si hay sesión no se pinta nada: un salto de tamaño al
    // cargar se nota más que aparecer medio segundo después.
    if (!_listo || !_haySesion) return const SizedBox.shrink();

    // Si el backend no responde, el acceso al Club no puede desaparecer: se
    // muestra sin cifras. Un error de red no debe cerrar una puerta.
    if (_nivel == null) return _chipSinDatos();

    final nivel = _nivel!;
    final paleta = _paletaDe(nivel.nivel);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(99),
        onTap: () => Navigator.of(context).pushNamed('/niveles'),
        child: Ink(
          height: 42,
          padding: const EdgeInsets.symmetric(horizontal: 18),
          decoration: BoxDecoration(
            gradient: paleta.fondo,
            borderRadius: BorderRadius.circular(99),
            boxShadow: [
              BoxShadow(
                color: paleta.sombra.withValues(alpha: 0.55),
                blurRadius: 18,
                offset: const Offset(0, 7),
              ),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('❋', style: TextStyle(fontSize: 16, color: paleta.texto)),
              const SizedBox(width: 8),
              Text(
                nivel.nivel,
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.2,
                  color: paleta.texto,
                ),
              ),
              const SizedBox(width: 7),
              Text(
                '${nivel.xp} XP',
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  color: paleta.texto.withValues(alpha: 0.88),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// El acceso al Club cuando el backend no responde: sin cifras, pero abierto.
  Widget _chipSinDatos() {
    final paleta = _paletaDe('');
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(99),
        onTap: () => Navigator.of(context).pushNamed('/niveles'),
        child: Ink(
          height: 42,
          padding: const EdgeInsets.symmetric(horizontal: 18),
          decoration: BoxDecoration(
            gradient: paleta.fondo,
            borderRadius: BorderRadius.circular(99),
            boxShadow: [
              BoxShadow(
                color: paleta.sombra.withValues(alpha: 0.55),
                blurRadius: 18,
                offset: const Offset(0, 7),
              ),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('❋', style: TextStyle(fontSize: 16, color: paleta.texto)),
              const SizedBox(width: 8),
              Text(
                'Mi Club',
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: paleta.texto,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// El nivel se nota desde fuera del Club: Pétalo claro, Oro dorado, Élite
  /// oscuro. Un chip siempre igual no comunica que se subió.
  _PaletaChip _paletaDe(String nivel) {
    switch (nivel.toLowerCase()) {
      case 'oro':
      case 'gold':
        return _PaletaChip(
          fondo: const LinearGradient(
            colors: [Color(0xFFC5A052), Color(0xFF8A6626)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          texto: const Color(0xFF221A0E),
          sombra: const Color(0xFF8A6626),
        );
      case 'diamante':
      case 'élite':
      case 'elite':
        return _PaletaChip(
          fondo: const LinearGradient(
            colors: [Color(0xFF2A2622), Color(0xFF141210)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          texto: const Color(0xFFE8D49E),
          sombra: const Color(0xFF000000),
        );
      default:
        return _PaletaChip(
          fondo: const LinearGradient(
            colors: [Color(0xFFFAF6EE), Color(0xFFEADFC8)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          texto: const Color(0xFF6B5A48),
          sombra: const Color(0xFFB8A894),
        );
    }
  }
}

class _PaletaChip {
  const _PaletaChip({
    required this.fondo,
    required this.texto,
    required this.sombra,
  });

  final LinearGradient fondo;
  final Color texto;
  final Color sombra;
}
