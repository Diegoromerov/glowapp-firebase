// Bandeja de resultados del home.
//
// La lista va VISIBLE, no detrás de un panel: es lo que hacen Airbnb, Uber y
// Google Maps. Tres posiciones (asomo, media, completa) y el mapa queda detrás,
// así el usuario conserva el contexto espacial sin tener que adivinar que existe
// una lista.
import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';

/// Posición de la bandeja, para instrumentar el embudo.
enum PosicionBandeja { asomo, media, completa }

class HomeResultsSheet extends StatefulWidget {
  final List<ProviderModel> proveedores;
  final void Function(ProviderModel) onSelect;
  final void Function(PosicionBandeja) onPosicion;
  final Widget Function(ProviderModel) construirTarjeta;
  final Widget? encabezado;

  /// Texto cuando no hay nadie en el radio actual.
  final String? mensajeVacio;
  final VoidCallback? onAmpliarRadio;

  /// Altura inicial. 0.52 en el mapa; 0.9 en el modo «solo lista».
  final double tamanoInicial;
  final double espacioInferior;

  const HomeResultsSheet({
    super.key,
    required this.proveedores,
    required this.onSelect,
    required this.onPosicion,
    required this.construirTarjeta,
    this.encabezado,
    this.mensajeVacio,
    this.onAmpliarRadio,
    this.tamanoInicial = 0.52,
    this.espacioInferior = 24,
  });

  @override
  State<HomeResultsSheet> createState() => _HomeResultsSheetState();
}

class _HomeResultsSheetState extends State<HomeResultsSheet> {
  final _controller = DraggableScrollableController();
  PosicionBandeja _ultima = PosicionBandeja.asomo;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_avisarPosicion);
  }

  @override
  void dispose() {
    _controller.removeListener(_avisarPosicion);
    _controller.dispose();
    super.dispose();
  }

  void _avisarPosicion() {
    final t = _controller.size;
    final actual = t < 0.25
        ? PosicionBandeja.asomo
        : t < 0.6
        ? PosicionBandeja.media
        : PosicionBandeja.completa;
    if (actual != _ultima) {
      _ultima = actual;
      widget.onPosicion(actual);
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      controller: _controller,
      initialChildSize: widget.tamanoInicial,
      minChildSize: 0.25,
      maxChildSize: 0.9,
      snap: true,
      snapSizes: const [0.25, 0.52, 0.9],
      builder: (context, scrollController) {
        return Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
            boxShadow: [
              BoxShadow(
                color: Color(0x14000000),
                blurRadius: 12,
                offset: Offset(0, -4),
              ),
            ],
          ),
          child: Column(
            children: [
              // 44 px: zona del pulgar y objetivo táctil correcto.
              SizedBox(
                height: 44,
                child: Center(
                  child: Container(
                    width: 44,
                    height: 4,
                    decoration: BoxDecoration(
                      color: const Color(0xFFE0D8CE),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
              ),
              Expanded(
                child: ListView.separated(
                  controller: scrollController,
                  padding: EdgeInsets.fromLTRB(
                    16,
                    0,
                    16,
                    widget.espacioInferior,
                  ),
                  itemCount: widget.proveedores.length +
                      (widget.encabezado != null ? 1 : 0) +
                      (widget.proveedores.isEmpty ? 1 : 0),
                  separatorBuilder: (_, index) =>
                      widget.encabezado != null && index == 0
                          ? const SizedBox(height: 0)
                          : const SizedBox(height: 10),
                  itemBuilder: (context, index) {
                    if (widget.encabezado != null && index == 0) {
                      return widget.encabezado!;
                    }
                    final providerIndex =
                        index - (widget.encabezado != null ? 1 : 0);
                    if (widget.proveedores.isEmpty) {
                      return SizedBox(height: 220, child: _vacio());
                    }
                    final p = widget.proveedores[providerIndex];
                    final nombre = p.businessName.isNotEmpty
                        ? p.businessName
                        : p.fullName;
                    final calificacion = p.rating > 0
                        ? 'Calificación ${p.rating.toStringAsFixed(1)}.'
                        : 'Sin calificaciones.';
                    final disponibilidad =
                        p.availableToday && p.nextSlotToday != null
                        ? 'Disponible hoy a las ${p.nextSlotToday}.'
                        : 'Sin disponibilidad hoy.';
                    return Semantics(
                      button: true,
                      label:
                          '$nombre. $calificacion '
                          '${(p.distanceMeters / 1000).toStringAsFixed(1)} kilómetros. '
                          '$disponibilidad',
                      child: GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onTap: () => widget.onSelect(p),
                        child: widget.construirTarjeta(p),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _vacio() {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.explore_off_outlined,
              size: 40,
              color: Color(0xFFC5A052),
            ),
            const SizedBox(height: 12),
            Text(
              widget.mensajeVacio ?? 'No hay prestadores en esta zona.',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 14, color: Color(0xFF6B6259)),
            ),
            if (widget.onAmpliarRadio != null) ...[
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: widget.onAmpliarRadio,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFC5A052),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(30),
                  ),
                ),
                child: const Text('Ampliar la búsqueda'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Chip de disponibilidad de la tarjeta: «Hoy 09:00».
/// Se usa también fuera de la bandeja, por eso vive aquí.
class ChipDisponibilidad extends StatelessWidget {
  final ProviderModel proveedor;

  const ChipDisponibilidad({super.key, required this.proveedor});

  @override
  Widget build(BuildContext context) {
    final hueco = proveedor.nextSlotToday;
    final disponible = proveedor.availableToday && hueco != null;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: disponible ? const Color(0xFFEAF3EC) : const Color(0xFFF4EFEA),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            disponible ? Icons.schedule : Icons.event_busy,
            size: 12,
            color: disponible
                ? const Color(0xFF4A5D4E)
                : const Color(0xFF8A7F72),
          ),
          const SizedBox(width: 4),
          Text(
            disponible ? 'Hoy $hueco' : 'Sin hueco hoy',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: disponible
                  ? const Color(0xFF4A5D4E)
                  : const Color(0xFF8A7F72),
            ),
          ),
        ],
      ),
    );
  }
}
