// frontend/lib/screens/ideas/evolution_screen.dart
//
// Y-F6 — Mi evolución: la serie de escaneos con su GlowScore y su veredicto.
//
// Antes de esto el delta existía y sólo se veía el de la última medición. Esta
// pantalla no calcula nada: pinta lo que el backend guardó, y cuando un escaneo
// viejo no tiene puntaje lo dice en vez de rellenarlo.

import 'package:flutter/material.dart';

import 'package:glow_core/services/biometric_service.dart';

class EvolutionScreen extends StatefulWidget {
  const EvolutionScreen({super.key});

  @override
  State<EvolutionScreen> createState() => _EvolutionScreenState();
}

class _EvolutionScreenState extends State<EvolutionScreen> {
  late Future<List<Map<String, dynamic>>> _future;
  bool _mostrarGuia = true;

  @override
  void initState() {
    super.initState();
    _future = BiometricService.getHistory();
  }

  Future<void> _recargar() async {
    final futura = BiometricService.getHistory();
    setState(() => _future = futura);
    await futura.catchError((_) => <Map<String, dynamic>>[]);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mi evolución'),
        actions: [
          IconButton(
            tooltip: 'Recargar',
            icon: const Icon(Icons.refresh),
            onPressed: _recargar,
          ),
        ],
      ),
      body: FutureBuilder<List<Map<String, dynamic>>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasError) {
            return _Estado(
              icono: Icons.cloud_off,
              titulo: 'No pudimos cargar tu historial',
              detalle: '${snapshot.error}',
              accion: TextButton.icon(
                onPressed: _recargar,
                icon: const Icon(Icons.refresh),
                label: const Text('Reintentar'),
              ),
            );
          }

          final escaneos = snapshot.data ?? const [];
          if (escaneos.isEmpty) {
            return const _Estado(
              icono: Icons.auto_awesome_outlined,
              titulo: 'Todavía no hay mediciones',
              detalle: 'Cuando hagas tu primer escaneo aparecerá aquí, con su puntaje y '
                  'la comparación contra tu siguiente medición.',
            );
          }

          return RefreshIndicator(
            onRefresh: _recargar,
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
              itemCount: escaneos.length + (_mostrarGuia ? 2 : 1),
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                if (index == 0) {
                  if (!_mostrarGuia) return const SizedBox.shrink();
                  return _Guia(
                    onCerrar: () => setState(() => _mostrarGuia = false),
                  );
                }
                final i = _mostrarGuia ? index - 1 : index;
                if (i >= escaneos.length) {
                  return const SizedBox.shrink();
                }
                return _FichaEscaneo(
                  escaneo: escaneos[i],
                  esElPrimero: i == 0,
                );
              },
            ),
          );
        },
      ),
    );
  }
}

class _Guia extends StatelessWidget {
  final VoidCallback onCerrar;
  const _Guia({required this.onCerrar});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.info_outline, size: 18, color: theme.colorScheme.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Tu cambio se mide contra ti',
                  style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold),
                ),
              ),
              IconButton(
                visualDensity: VisualDensity.compact,
                icon: const Icon(Icons.close, size: 18),
                onPressed: onCerrar,
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Cada puntaje se compara con tu escaneo anterior. No es un diagnóstico: es la '
            'diferencia medida entre dos fotos tuyas.',
            style: theme.textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}

class _FichaEscaneo extends StatelessWidget {
  final Map<String, dynamic> escaneo;
  final bool esElPrimero;
  const _FichaEscaneo({required this.escaneo, required this.esElPrimero});

  // Sin `intl` con locale: los datos de mes en español exigen inicializar la librería
  // en el arranque y aquí no hace falta. Formato explícito y predecible.
  static const List<String> _meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];

  String _fechaLegible(DateTime? fecha) {
    if (fecha == null) return 'Fecha desconocida';
    return '${fecha.day} de ${_meses[fecha.month - 1]} de ${fecha.year}';
  }

  /// Color según el veredicto guardado. Sin veredicto conocido, gris: no se adivina.
  Color _colorVeredicto(String? veredicto, ColorScheme scheme) {
    switch (veredicto) {
      case 'MEJORO':
        return Colors.green.shade700;
      case 'EMPEORO':
        return Colors.orange.shade800;
      case 'MIXTO':
        return Colors.blue.shade700;
      case 'SIN_CAMBIO':
        return scheme.outline;
      default:
        return scheme.outline;
    }
  }

  String _textoVeredicto(String? veredicto) {
    switch (veredicto) {
      case 'MEJORO':
        return 'Mejoró';
      case 'EMPEORO':
        return 'Empeoró';
      case 'MIXTO':
        return 'Cambios mixtos';
      case 'SIN_CAMBIO':
        return 'Sin cambio medible';
      default:
        return 'Sin comparación';
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    final glowScore = escaneo['glowScore'];
    final fecha = DateTime.tryParse('${escaneo['capturedAt']}')?.toLocal();
    final comparacion = escaneo['comparison'] as Map<String, dynamic>?;

    final veredicto = comparacion?['verdict'] as String?;
    final delta = comparacion?['deltaGlowScore'];
    final deltaNumero = delta is num ? delta.toDouble() : null;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Puntaje
          SizedBox(
            width: 62,
            child: Column(
              children: [
                Text(
                  glowScore == null ? '—' : '$glowScore',
                  style: theme.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: scheme.primary,
                  ),
                ),
                Text(
                  glowScore == null ? 'sin puntaje' : 'Glow',
                  style: theme.textTheme.labelSmall?.copyWith(color: scheme.outline),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  fecha == null ? 'Fecha desconocida' : _fechaLegible(fecha),
                  style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: _colorVeredicto(veredicto, scheme).withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        _textoVeredicto(veredicto),
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: _colorVeredicto(veredicto, scheme),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    if (deltaNumero != null) ...[
                      const SizedBox(width: 8),
                      Text(
                        '${deltaNumero >= 0 ? '+' : ''}${deltaNumero.toStringAsFixed(1)} pts',
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: deltaNumero >= 0 ? Colors.green.shade700 : Colors.orange.shade800,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ],
                ),
                if (comparacion == null) ...[
                  const SizedBox(height: 6),
                  Text(
                    esElPrimero ? 'Esta es la referencia: no hay con qué compararla.' : 'Sin comparación guardada.',
                    style: theme.textTheme.bodySmall?.copyWith(color: scheme.outline),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Estado extends StatelessWidget {
  final IconData icono;
  final String titulo;
  final String detalle;
  final Widget? accion;

  const _Estado({required this.icono, required this.titulo, required this.detalle, this.accion});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icono, size: 48, color: theme.colorScheme.outline),
            const SizedBox(height: 16),
            Text(titulo, style: theme.textTheme.titleMedium, textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Text(detalle, style: theme.textTheme.bodySmall, textAlign: TextAlign.center),
            if (accion != null) ...[const SizedBox(height: 12), accion!],
          ],
        ),
      ),
    );
  }
}
