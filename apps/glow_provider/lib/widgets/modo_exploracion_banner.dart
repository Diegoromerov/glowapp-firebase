import 'package:flutter/material.dart';
import 'package:glow_core/services/auth_service.dart';

/// Aviso de Modo Exploración (D-GL-031).
///
/// El proveedor entra sin documentos y puede armar su negocio, pero no cobrar.
/// Este banner le dice en qué estado está y qué le falta, en vez de dejar que
/// choque con un error al intentar publicar.
///
/// No se muestra nada si la cuenta está habilitada o si la consulta falla: un
/// aviso permanente por un fallo de red sería peor que no tenerlo.
class ModoExploracionBanner extends StatefulWidget {
  const ModoExploracionBanner({super.key});

  @override
  State<ModoExploracionBanner> createState() => _ModoExploracionBannerState();
}

class _ModoExploracionBannerState extends State<ModoExploracionBanner> {
  Map<String, dynamic>? _capacidades;
  bool _cargado = false;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    final datos = await AuthService.obtenerCapacidadesProveedor();
    if (!mounted) return;
    setState(() {
      _capacidades = datos;
      _cargado = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!_cargado) return const SizedBox.shrink();

    final datos = _capacidades;
    if (datos == null) return const SizedBox.shrink();

    final estado = (datos['estado_operativo'] ?? 'HABILITADO').toString().toUpperCase();
    final vencida = datos['vencida'] == true;
    if (estado == 'HABILITADO') return const SizedBox.shrink();

    final bloqueo = datos['bloqueo'];
    final mensaje = bloqueo is Map
        ? (bloqueo['mensaje'] ?? '').toString()
        : 'Tu cuenta está en Modo Exploración.';
    final diasRestantes = datos['dias_restantes'];

    final esSuspendido = estado == 'SUSPENDIDO';
    final color = esSuspendido ? const Color(0xFFB3261E) : const Color(0xFFC5A052);
    final icono = esSuspendido ? Icons.block_rounded : Icons.explore_outlined;
    final titulo = esSuspendido
        ? 'Cuenta suspendida'
        : vencida
            ? 'Exploración terminada'
            : 'Modo Exploración';

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withOpacity(0.10),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withOpacity(0.45)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icono, color: color, size: 22),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  titulo,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                    color: const Color(0xFF1F1A15),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  mensaje,
                  style: const TextStyle(fontSize: 12, color: Color(0xFF6B5E59)),
                ),
                if (!esSuspendido && !vencida && diasRestantes is int && diasRestantes <= 7)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      'Te quedan $diasRestantes días de exploración.',
                      style: TextStyle(fontSize: 11, color: color),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
