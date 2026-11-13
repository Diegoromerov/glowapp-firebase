import 'dart:async';

import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../screens/invite_welcome_screen.dart';

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
  const ChipClub({super.key, this.recargarCada, this.cargarNivel});

  /// Para pruebas: permite refrescar sin remontar el widget.
  final Duration? recargarCada;

  /// Para pruebas: sustituye la llamada real al backend.
  final Future<NivelPuntos?> Function()? cargarNivel;

  @override
  State<ChipClub> createState() => _ChipClubState();
}

class _ChipClubState extends State<ChipClub> {
  NivelPuntos? _nivel;
  bool _listo = false;
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
    // La tarjeta de invitación ocupa esta franja: mientras esté pendiente, el
    // chip no aparece para no apilar dos bloques en el mismo sitio.
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getString(kClaveCodigoInvitacion) != null) {
      if (mounted) setState(() => _listo = true);
      return;
    }

    final nivel = await (widget.cargarNivel ?? RewardsService.obtenerNivel)();
    if (!mounted) return;
    setState(() {
      _nivel = nivel;
      _listo = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    // Antes de saber si hay sesión no se pinta nada: un salto de tamaño al
    // cargar se nota más que aparecer medio segundo después.
    if (!_listo || _nivel == null) return const SizedBox.shrink();

    final nivel = _nivel!;
    final paleta = _paletaDe(nivel.nivel);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(99),
        onTap: () => Navigator.of(context).pushNamed('/niveles'),
        child: Ink(
          height: 32,
          padding: const EdgeInsets.symmetric(horizontal: 13),
          decoration: BoxDecoration(
            gradient: paleta.fondo,
            borderRadius: BorderRadius.circular(99),
            boxShadow: [
              BoxShadow(
                color: paleta.sombra.withValues(alpha: 0.55),
                blurRadius: 16,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('❋', style: TextStyle(fontSize: 12, color: paleta.texto)),
              const SizedBox(width: 6),
              Text(
                nivel.nivel,
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.2,
                  color: paleta.texto,
                ),
              ),
              const SizedBox(width: 5),
              Text(
                '${nivel.xp} XP',
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 10,
                  fontWeight: FontWeight.w500,
                  color: paleta.texto.withValues(alpha: 0.72),
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
