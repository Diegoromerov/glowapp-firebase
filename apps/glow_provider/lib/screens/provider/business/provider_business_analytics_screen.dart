import 'package:flutter/material.dart';
import 'package:glow_core/services/saas_api_service.dart';

class ProviderBusinessAnalyticsScreen extends StatefulWidget {
  const ProviderBusinessAnalyticsScreen({super.key});

  @override
  State<ProviderBusinessAnalyticsScreen> createState() =>
      _ProviderBusinessAnalyticsScreenState();
}

class _ProviderBusinessAnalyticsScreenState
    extends State<ProviderBusinessAnalyticsScreen> {
  Map<String, dynamic>? _data;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await SaasApiService.getBusinessAnalytics();
      if (!mounted) return;
      setState(() => _data = data);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Map<String, dynamic> _map(Object? value) =>
      value is Map<String, dynamic> ? value : const {};

  double _number(Object? value) =>
      value is num ? value.toDouble() : double.tryParse('$value') ?? 0;

  String _integer(Object? value) => _number(value).round().toString();

  String _percent(Object? value) => value == null
      ? '—'
      : '${_number(value).toStringAsFixed(1).replaceAll(RegExp(r'\.0$'), '')}%';

  String _money(Object? value, String currency) {
    final amount = _number(value).round().toString();
    final grouped = amount.replaceAllMapped(
      RegExp(r'\B(?=(\d{3})+(?!\d))'),
      (_) => '.',
    );
    return currency == 'COP' ? '\$$grouped COP' : '$grouped $currency';
  }

  @override
  Widget build(BuildContext context) {
    final data = _data ?? const <String, dynamic>{};
    final period = _map(data['period']);
    final appointments = _map(data['appointments']);
    final customers = _map(data['customers']);
    final capacity = _map(data['capacity']);
    final inventory = _map(data['inventory']);
    final team = _map(data['team']);
    final cash = _map(data['cash']);
    final currencies = cash['by_currency'] is List
        ? (cash['by_currency'] as List)
            .whereType<Map<String, dynamic>>()
            .toList()
        : <Map<String, dynamic>>[];
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
        title: const Text('Analítica del negocio'),
        backgroundColor: const Color(0xFFFAF8F5),
        foregroundColor: const Color(0xFF1F1A15),
        elevation: 0,
        actions: [
          IconButton(
            tooltip: 'Actualizar',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: _loading && _data == null
          ? const Center(
              child: CircularProgressIndicator(color: Color(0xFFC5A052)),
            )
          : _error != null && _data == null
              ? _errorView()
              : RefreshIndicator(
                  onRefresh: _load,
                  color: const Color(0xFFC5A052),
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(18, 8, 18, 28),
                    children: [
                      _sectionCaption(
                        'PERÍODO',
                        '${period['from'] ?? 'Últimos 30 días'}  —  ${period['to'] ?? ''}',
                      ),
                      const SizedBox(height: 14),
                      _cardGrid([
                        _MetricCard(
                          label: 'Citas',
                          value: _integer(appointments['total']),
                          detail:
                              '${_integer(appointments['completed'])} completadas · ${_integer(appointments['cancelled'])} canceladas',
                        ),
                        _MetricCard(
                          label: 'Finalización',
                          value: _percent(appointments['completion_rate']),
                          detail:
                              'Citas completadas sobre el total del período',
                        ),
                        _MetricCard(
                          label: 'Clientes recurrentes',
                          value: _percent(customers['repeat_rate']),
                          detail:
                              '${_integer(customers['repeat_clients'])} de ${_integer(customers['completed_clients'])} clientes',
                        ),
                        _MetricCard(
                          label: 'Ocupación estimada',
                          value: _percent(capacity['occupancy_rate']),
                          detail: capacity['basis']?.toString() ?? '',
                        ),
                      ]),
                      const SizedBox(height: 18),
                      _sectionCaption('CAJA DEL SALÓN',
                          'Solo movimientos registrados en caja'),
                      const SizedBox(height: 10),
                      if (currencies.isEmpty)
                        _infoCard(
                            'No hay movimientos de caja para este período.')
                      else
                        for (final currencyRow in currencies) ...[
                          _sectionCaption(
                            'MOVIMIENTOS EN ${currencyRow['currency'] ?? 'MONEDA'}',
                            'Moneda reportada por la caja del salón',
                          ),
                          const SizedBox(height: 8),
                          _cardGrid([
                            _MetricCard(
                              label: 'Ingresos',
                              value: _money(currencyRow['income'],
                                  '${currencyRow['currency'] ?? ''}'),
                              detail:
                                  'Servicios ${_money(currencyRow['service_income'], '${currencyRow['currency'] ?? ''}')}',
                            ),
                            _MetricCard(
                              label: 'Gastos',
                              value: _money(currencyRow['expenses'],
                                  '${currencyRow['currency'] ?? ''}'),
                              detail:
                                  '${_integer(currencyRow['movements'])} movimientos en caja',
                            ),
                            _MetricCard(
                              label: 'Neto registrado',
                              value: _money(currencyRow['net'],
                                  '${currencyRow['currency'] ?? ''}'),
                              detail: 'Ingresos menos gastos',
                            ),
                            _MetricCard(
                              label: 'Venta de productos',
                              value: _money(currencyRow['product_income'],
                                  '${currencyRow['currency'] ?? ''}'),
                              detail: 'Ingreso marcado como PRODUCTO',
                            ),
                          ]),
                          const SizedBox(height: 10),
                        ],
                      const SizedBox(height: 18),
                      _sectionCaption(
                          'OPERACIÓN', 'Estado al momento de la consulta'),
                      const SizedBox(height: 10),
                      _cardGrid([
                        _MetricCard(
                          label: 'Equipo activo',
                          value: _integer(team['active_members']),
                          detail: 'Miembros activos del negocio',
                        ),
                        _MetricCard(
                          label: 'Bajo inventario',
                          value: _integer(inventory['low_stock_items']),
                          detail: 'Artículos en o bajo el mínimo',
                        ),
                        _MetricCard(
                          label: 'Productos activos',
                          value: _integer(inventory['active_products']),
                          detail: 'Inventario del salón',
                        ),
                        _MetricCard(
                          label: 'Registros con faltante',
                          value: _integer(inventory['shortage_lines']),
                          detail: 'Líneas de consumo de insumos',
                        ),
                      ]),
                      const SizedBox(height: 14),
                      _infoCard(
                        'Los indicadores son agregados del negocio activo. No se muestran nombres ni datos personales de clientes. Los ingresos salen del libro de caja y no se suman de nuevo desde las reservas o los pagos de GlowApp.',
                      ),
                      if (_error != null) ...[
                        const SizedBox(height: 12),
                        _infoCard('No se pudo actualizar: $_error'),
                      ],
                    ],
                  ),
                ),
    );
  }

  Widget _errorView() {
    final message = _error.toString();
    final planBlocked = message.contains('Plan no incluye esta función');
    final roleBlocked = message.contains('Rol insuficiente');
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              planBlocked
                  ? 'Disponible en el plan Profesional'
                  : roleBlocked
                      ? 'Acceso reservado a la gerencia'
                      : 'No se pudo cargar la analítica',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 10),
            Text(
              planBlocked
                  ? 'La analítica avanzada está incluida en los planes Profesional y Empresarial.'
                  : roleBlocked
                      ? 'Necesitas el rol de propietario, administrador o gerente para ver estos indicadores.'
                      : 'Revisa tu conexión y vuelve a intentarlo.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFF8C7A6B)),
            ),
            const SizedBox(height: 18),
            FilledButton(
                onPressed: _load, child: const Text('Intentar de nuevo')),
          ],
        ),
      ),
    );
  }

  Widget _sectionCaption(String title, String subtitle) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.1,
                  color: Color(0xFF9B7848))),
          const SizedBox(height: 3),
          Text(subtitle,
              style: const TextStyle(fontSize: 13, color: Color(0xFF8C7A6B))),
        ],
      );

  Widget _cardGrid(List<_MetricCard> cards) => LayoutBuilder(
        builder: (context, constraints) {
          final columns = constraints.maxWidth >= 560 ? 2 : 1;
          final width = (constraints.maxWidth - (columns - 1) * 10) / columns;
          return Wrap(
            spacing: 10,
            runSpacing: 10,
            children: cards
                .map((card) => SizedBox(width: width, child: card))
                .toList(),
          );
        },
      );

  Widget _infoCard(String text) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: const Color(0xFFF5EFE7),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFFE9DFD3)),
        ),
        child: Text(text,
            style: const TextStyle(
                fontSize: 13, height: 1.4, color: Color(0xFF6F6257))),
      );
}

class _MetricCard extends StatelessWidget {
  const _MetricCard(
      {required this.label, required this.value, required this.detail});

  final String label;
  final String value;
  final String detail;

  @override
  Widget build(BuildContext context) => Container(
        constraints: const BoxConstraints(minHeight: 112),
        padding: const EdgeInsets.all(15),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFFEDE5DB)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label,
                style: const TextStyle(fontSize: 13, color: Color(0xFF8C7A6B))),
            const SizedBox(height: 6),
            Text(value,
                style: const TextStyle(
                    fontSize: 23,
                    fontWeight: FontWeight.w800,
                    color: Color(0xFF211B15))),
            const SizedBox(height: 4),
            Text(detail,
                style: const TextStyle(
                    fontSize: 12, height: 1.3, color: Color(0xFF8C7A6B))),
          ],
        ),
      );
}
