// frontend/lib/screens/salon/caja_screen.dart
// E-05 (D-GL-027) — Caja del salón.
//
// REGLAS DE ESTA PANTALLA
//  · Todo importe que se muestra viene de la API. Aquí no se suma nada por
//    cuenta propia ni se rellenan huecos con ceros inventados.
//  · Si no hay movimientos, se dice que no hay movimientos.
//  · El alcance lo decide el backend: `SALON` para administración y recepción,
//    `PROPIO` para el colaborador. La UI sólo lo refleja.
//  · Registrar sólo aparece si la API dice `puede_registrar`.
//  · La constancia es de pago, no una factura electrónica.

import 'package:flutter/material.dart';

import 'package:glow_core/core/theme/tokens.dart';
import 'package:glow_core/design/icons/glow_icon.dart';
import 'package:glow_core/services/api_service.dart';

/// Formato COP sin decimales: 1.234.567
String formatearCop(num monto, {bool conSigno = false}) {
  final negativo = monto < 0;
  final entero = monto.abs().round().toString();
  final buffer = StringBuffer();
  for (var i = 0; i < entero.length; i++) {
    if (i > 0 && (entero.length - i) % 3 == 0) buffer.write('.');
    buffer.write(entero[i]);
  }
  final signo = negativo ? '−' : (conSigno ? '+' : '');
  return '$signo\$${buffer.toString()}';
}

class CajaScreen extends StatefulWidget {
  final int salonId;

  /// Punto de entrada de los widget tests: sin red.
  final bool cargarDatos;

  /// Datos inyectados para probar el render sin backend.
  final Map<String, dynamic>? resumenInicial;
  final List<Map<String, dynamic>>? movimientosIniciales;

  const CajaScreen({
    super.key,
    required this.salonId,
    this.cargarDatos = true,
    this.resumenInicial,
    this.movimientosIniciales,
  });

  @override
  State<CajaScreen> createState() => _CajaScreenState();
}

class _CajaScreenState extends State<CajaScreen> {
  Map<String, dynamic>? _resumen;
  List<Map<String, dynamic>> _movimientos = const [];
  bool _cargando = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _resumen = widget.resumenInicial;
    _movimientos = widget.movimientosIniciales ?? const [];
    if (widget.cargarDatos && widget.resumenInicial == null) {
      _cargar();
    }
  }

  Future<void> _cargar() async {
    setState(() {
      _cargando = true;
      _error = null;
    });
    try {
      final resumen = await ApiService.get('/api/salon/${widget.salonId}/caja/resumen');
      final lista =
          await ApiService.get('/api/salon/${widget.salonId}/caja/movimientos?limite=50');

      if (!mounted) return;
      if (resumen is Map && resumen['success'] == true) {
        setState(() {
          _resumen = Map<String, dynamic>.from(resumen);
          _movimientos = (lista is Map && lista['items'] is List)
              ? (lista['items'] as List)
                  .whereType<Map>()
                  .map((m) => Map<String, dynamic>.from(m))
                  .toList()
              : const [];
          _cargando = false;
        });
      } else {
        setState(() {
          _error = (resumen is Map ? resumen['error']?.toString() : null) ??
              'No se pudo leer la caja.';
          _cargando = false;
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'No se pudo conectar con la caja.';
        _cargando = false;
      });
    }
  }

  Future<void> _abrirRegistro() async {
    final creado = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _FormularioMovimiento(salonId: widget.salonId),
    );
    if (creado == true) _cargar();
  }

  @override
  Widget build(BuildContext context) {
    final t = Token.of(context);

    if (_cargando && _resumen == null) {
      return Center(child: CircularProgressIndicator(color: t.brandPrimary));
    }

    if (_error != null && _resumen == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(Spacing.xxl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.cloud_off_rounded, color: t.textSecondary, size: 30),
              const SizedBox(height: Spacing.md),
              Text(
                _error!,
                textAlign: TextAlign.center,
                style: TypographyTokens.bodySmall(t).copyWith(color: t.textSecondary),
              ),
              const SizedBox(height: Spacing.lg),
              TextButton(
                onPressed: _cargar,
                child: const Text('Reintentar'),
              ),
            ],
          ),
        ),
      );
    }

    final r = _resumen ?? const <String, dynamic>{};
    final ingresos = (r['ingresos'] as num?) ?? 0;
    final gastos = (r['gastos'] as num?) ?? 0;
    final neto = (r['neto'] as num?) ?? 0;
    final alcance = (r['alcance'] ?? 'SALON').toString();
    final puedeRegistrar = r['puede_registrar'] == true;

    return Stack(
      children: [
        RefreshIndicator(
          onRefresh: _cargar,
          color: t.brandPrimary,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              Spacing.lg, Spacing.lg, Spacing.lg, Spacing.xxl + 56,
            ),
            children: [
              Row(
                children: [
                  GlowIcon.resolve('money', size: GlowIconSize.sm, color: t.brandPrimary),
                  const SizedBox(width: Spacing.sm),
                  Expanded(
                    child: Text(
                      alcance == 'SALON' ? 'Caja del salón' : 'Mis movimientos',
                      style: TypographyTokens.h3(t).copyWith(fontSize: 16),
                    ),
                  ),
                  if (_cargando)
                    SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2, color: t.brandPrimary),
                    ),
                ],
              ),
              const SizedBox(height: Spacing.md),
              Row(
                children: [
                  _Kpi(
                    titulo: 'Ingresos',
                    valor: formatearCop(ingresos),
                    color: const Color(0xFF2E7D32),
                    icono: 'arrow_up',
                  ),
                  const SizedBox(width: Spacing.sm),
                  _Kpi(
                    titulo: 'Gastos',
                    valor: formatearCop(gastos),
                    color: const Color(0xFFC62828),
                    icono: 'arrow_down',
                  ),
                  const SizedBox(width: Spacing.sm),
                  _Kpi(
                    titulo: 'Neto',
                    valor: formatearCop(neto),
                    color: neto < 0 ? const Color(0xFFC62828) : t.textPrimary,
                    icono: 'wallet',
                  ),
                ],
              ),
              const SizedBox(height: Spacing.lg),
              if (alcance != 'SALON')
                Container(
                  margin: const EdgeInsets.only(bottom: Spacing.md),
                  padding: const EdgeInsets.all(Spacing.md),
                  decoration: BoxDecoration(
                    color: t.surfaceLevel2,
                    borderRadius: BorderRadius.circular(Radii.sm),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.info_outline, size: 15, color: t.textSecondary),
                      const SizedBox(width: Spacing.xs),
                      Expanded(
                        child: Text(
                          'Ves sólo los movimientos a tu nombre. La caja completa '
                          'del salón la administra el dueño o su equipo.',
                          style: TypographyTokens.bodySmall(t).copyWith(
                            color: t.textSecondary,
                            fontSize: 11,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              Text(
                'Movimientos',
                style: TypographyTokens.body(t).copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: Spacing.sm),
              if (_movimientos.isEmpty)
                Container(
                  padding: const EdgeInsets.all(Spacing.xl),
                  decoration: BoxDecoration(
                    color: t.surfaceLevel1,
                    borderRadius: BorderRadius.circular(Radii.md),
                    border: Border.all(color: t.borderSubtle),
                  ),
                  child: Column(
                    children: [
                      Icon(Icons.receipt_long_outlined, color: t.textSecondary, size: 26),
                      const SizedBox(height: Spacing.sm),
                      Text(
                        'Aún no hay movimientos en este periodo.',
                        textAlign: TextAlign.center,
                        style: TypographyTokens.bodySmall(t).copyWith(color: t.textSecondary),
                      ),
                    ],
                  ),
                )
              else
                ..._movimientos.map((m) => _MovimientoTile(movimiento: m)),
              const SizedBox(height: Spacing.lg),
              Text(
                'Las constancias de pago son comprobantes del salón. '
                'No son facturas electrónicas.',
                style: TypographyTokens.bodySmall(t).copyWith(
                  color: t.textSecondary,
                  fontSize: 10,
                ),
              ),
            ],
          ),
        ),
        if (puedeRegistrar)
          Positioned(
            right: Spacing.lg,
            bottom: Spacing.lg,
            child: FloatingActionButton.extended(
              onPressed: _abrirRegistro,
              backgroundColor: t.brandPrimary,
              foregroundColor: t.brandPrimaryOn,
              icon: const Icon(Icons.add),
              label: const Text('Registrar'),
            ),
          ),
      ],
    );
  }
}

class _Kpi extends StatelessWidget {
  final String titulo;
  final String valor;
  final Color color;
  final String icono;

  const _Kpi({
    required this.titulo,
    required this.valor,
    required this.color,
    required this.icono,
  });

  @override
  Widget build(BuildContext context) {
    final t = Token.of(context);
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(Spacing.md),
        decoration: BoxDecoration(
          color: t.surfaceLevel1,
          borderRadius: BorderRadius.circular(Radii.md),
          border: Border.all(color: t.borderSubtle),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                GlowIcon.resolve(icono, size: GlowIconSize.xs, color: color),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    titulo,
                    style: TypographyTokens.bodySmall(t).copyWith(
                      color: t.textSecondary,
                      fontSize: 10,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                valor,
                style: TypographyTokens.body(t).copyWith(
                  fontWeight: FontWeight.w700,
                  color: color,
                  fontSize: 14,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MovimientoTile extends StatelessWidget {
  final Map<String, dynamic> movimiento;
  const _MovimientoTile({required this.movimiento});

  @override
  Widget build(BuildContext context) {
    final t = Token.of(context);
    final esIngreso = (movimiento['tipo'] ?? '') == 'INGRESO';
    final monto = (movimiento['monto'] as num?) ?? 0;
    final fecha = DateTime.tryParse('${movimiento['fecha_movimiento']}')?.toLocal();

    return Container(
      margin: const EdgeInsets.only(bottom: Spacing.sm),
      padding: const EdgeInsets.all(Spacing.md),
      decoration: BoxDecoration(
        color: t.surfaceLevel1,
        borderRadius: BorderRadius.circular(Radii.md),
        border: Border.all(color: t.borderSubtle),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(7),
            decoration: BoxDecoration(
              color: (esIngreso ? const Color(0xFF2E7D32) : const Color(0xFFC62828))
                  .withOpacity(0.10),
              borderRadius: BorderRadius.circular(Radii.round),
            ),
            child: Icon(
              esIngreso ? Icons.arrow_downward_rounded : Icons.arrow_upward_rounded,
              size: 15,
              color: esIngreso ? const Color(0xFF2E7D32) : const Color(0xFFC62828),
            ),
          ),
          const SizedBox(width: Spacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${movimiento['concepto'] ?? ''}',
                  style: TypographyTokens.bodySmall(t).copyWith(
                    fontWeight: FontWeight.w600,
                    color: t.textPrimary,
                  ),
                ),
                Text(
                  [
                    if (movimiento['metodo_pago'] != null) '${movimiento['metodo_pago']}',
                    if (fecha != null)
                      '${fecha.day.toString().padLeft(2, '0')}/'
                          '${fecha.month.toString().padLeft(2, '0')}',
                    if (movimiento['constancia_ref'] != null)
                      '${movimiento['constancia_ref']}',
                  ].join(' · '),
                  style: TypographyTokens.bodySmall(t).copyWith(
                    color: t.textSecondary,
                    fontSize: 10,
                  ),
                ),
              ],
            ),
          ),
          Text(
            formatearCop(esIngreso ? monto : -monto, conSigno: true),
            style: TypographyTokens.bodySmall(t).copyWith(
              fontWeight: FontWeight.w700,
              color: esIngreso ? const Color(0xFF2E7D32) : const Color(0xFFC62828),
            ),
          ),
        ],
      ),
    );
  }
}

/// Formulario de registro. Sólo se abre si la API dijo `puede_registrar`.
class _FormularioMovimiento extends StatefulWidget {
  final int salonId;
  const _FormularioMovimiento({required this.salonId});

  @override
  State<_FormularioMovimiento> createState() => _FormularioMovimientoState();
}

class _FormularioMovimientoState extends State<_FormularioMovimiento> {
  static const _conceptos = [
    'SERVICIO', 'PRODUCTO', 'PROPINA', 'ALQUILER', 'COMISION',
    'INSUMO', 'NOMINA', 'OTRO',
  ];
  static const _metodos = [
    'EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'OTRO',
  ];

  String _tipo = 'INGRESO';
  String _concepto = 'SERVICIO';
  String _metodo = 'EFECTIVO';
  final _monto = TextEditingController();
  final _descripcion = TextEditingController();
  bool _enviando = false;
  String? _error;

  @override
  void dispose() {
    _monto.dispose();
    _descripcion.dispose();
    super.dispose();
  }

  Future<void> _guardar() async {
    final monto = num.tryParse(_monto.text.replaceAll('.', '').replaceAll(',', '.'));
    if (monto == null || monto <= 0) {
      setState(() => _error = 'Escribe un monto mayor que cero.');
      return;
    }

    setState(() {
      _enviando = true;
      _error = null;
    });

    final res = await ApiService.post(
      '/api/salon/${widget.salonId}/caja/movimientos',
      {
        'tipo': _tipo,
        'concepto': _concepto,
        'monto': monto,
        'metodo_pago': _metodo,
        if (_descripcion.text.trim().isNotEmpty) 'descripcion': _descripcion.text.trim(),
      },
    );

    if (!mounted) return;
    if (res is Map && res['success'] == true) {
      Navigator.of(context).pop(true);
      return;
    }
    setState(() {
      _enviando = false;
      _error = (res is Map ? res['error']?.toString() : null) ??
          'No se pudo registrar el movimiento.';
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = Token.of(context);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        padding: const EdgeInsets.all(Spacing.xl),
        decoration: BoxDecoration(
          color: t.surfaceLevel1,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(Radii.lg)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Registrar movimiento',
              style: TypographyTokens.h3(t).copyWith(fontSize: 16),
            ),
            const SizedBox(height: Spacing.md),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'INGRESO', label: Text('Ingreso')),
                ButtonSegment(value: 'GASTO', label: Text('Gasto')),
              ],
              selected: {_tipo},
              onSelectionChanged: (s) => setState(() => _tipo = s.first),
            ),
            const SizedBox(height: Spacing.md),
            TextField(
              controller: _monto,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Monto (COP)',
                hintText: '150000',
              ),
            ),
            const SizedBox(height: Spacing.md),
            DropdownButtonFormField<String>(
              initialValue: _concepto,
              decoration: const InputDecoration(labelText: 'Concepto'),
              items: _conceptos
                  .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                  .toList(),
              onChanged: (v) => setState(() => _concepto = v ?? _concepto),
            ),
            const SizedBox(height: Spacing.md),
            DropdownButtonFormField<String>(
              initialValue: _metodo,
              decoration: const InputDecoration(labelText: 'Método de pago'),
              items: _metodos
                  .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                  .toList(),
              onChanged: (v) => setState(() => _metodo = v ?? _metodo),
            ),
            const SizedBox(height: Spacing.md),
            TextField(
              controller: _descripcion,
              decoration: const InputDecoration(
                labelText: 'Descripción (opcional)',
                hintText: 'Corte de cabello, cliente frecuente',
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: Spacing.sm),
              Text(
                _error!,
                style: TypographyTokens.bodySmall(t).copyWith(
                  color: const Color(0xFFC62828),
                ),
              ),
            ],
            const SizedBox(height: Spacing.lg),
            SizedBox(
              width: double.infinity,
              height: 46,
              child: ElevatedButton(
                onPressed: _enviando ? null : _guardar,
                style: ElevatedButton.styleFrom(
                  backgroundColor: t.brandPrimary,
                  foregroundColor: t.brandPrimaryOn,
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(Radii.round),
                  ),
                ),
                child: _enviando
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text(
                        'Guardar',
                        style: TextStyle(fontWeight: FontWeight.w700),
                      ),
              ),
            ),
            const SizedBox(height: Spacing.sm),
            Text(
              'Se emitirá una constancia de pago con número propio del salón.',
              style: TypographyTokens.bodySmall(t).copyWith(
                color: t.textSecondary,
                fontSize: 10,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
