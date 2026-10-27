import 'package:flutter/material.dart';
import 'package:glow_core/models/owner_dashboard_metrics.dart';
import 'package:glow_core/services/active_salon_service.dart';
import 'package:glow_core/services/api_service.dart';
import 'package:glow_core/widgets/owner/cross_tenant_warning_banner.dart';

class OwnerDashboardScreen extends StatefulWidget {
  final Map<String, dynamic>? initialMetricsJson;
  final List<Map<String, dynamic>>? initialSalones;

  const OwnerDashboardScreen({
    super.key,
    this.initialMetricsJson,
    this.initialSalones,
  });

  @override
  State<OwnerDashboardScreen> createState() => _OwnerDashboardScreenState();
}

class _OwnerDashboardScreenState extends State<OwnerDashboardScreen> {
  bool _isLoading = true;
  String? _errorMessage;
  List<Map<String, dynamic>> _salones = [];
  OwnerDashboardMetrics? _metrics;

  @override
  void initState() {
    super.initState();
    ActiveSalonService.instance.addListener(_onActiveSalonChanged);

    if (widget.initialMetricsJson != null) {
      _salones = widget.initialSalones ?? [];
      try {
        _metrics = OwnerDashboardMetrics.fromJson(widget.initialMetricsJson!);
        _isLoading = false;
      } catch (e) {
        _errorMessage = e.toString();
        _isLoading = false;
      }
    } else {
      _loadData();
    }
  }

  @override
  void dispose() {
    ActiveSalonService.instance.removeListener(_onActiveSalonChanged);
    super.dispose();
  }

  void _onActiveSalonChanged() {
    if (mounted) {
      _loadMetrics();
    }
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final salonesRes = await ApiService.fetchOwnerSalones();
      if (salonesRes['success'] == true && salonesRes['salones'] is List) {
        _salones = List<Map<String, dynamic>>.from(salonesRes['salones']);
      }
      await _loadMetrics();
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = 'Error al cargar datos del propietario: ${e.toString()}';
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _loadMetrics() async {
    final activeId = ActiveSalonService.instance.activeSalonId;
    try {
      final metricsRes = await ApiService.fetchOwnerDashboardMetrics(salonId: activeId);
      if (mounted) {
        setState(() {
          if (metricsRes['success'] == true && metricsRes['metrics'] is Map) {
            _metrics = OwnerDashboardMetrics.fromJson(Map<String, dynamic>.from(metricsRes['metrics']));
          } else {
            _metrics = null;
          }
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = 'Error al cargar métricas: ${e.toString()}';
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _handleSwitchSalon(int? salonId) async {
    if (salonId == null) {
      await ActiveSalonService.instance.clear();
      return;
    }

    try {
      final res = await ApiService.switchSalon(salonId);
      if (res['success'] == true && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(res['message'] ?? 'Sede seleccionada correctamente'),
            backgroundColor: const Color(0xFF059669),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error al cambiar de sede: $e'),
            backgroundColor: const Color(0xFFDC2626),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final activeSalonId = ActiveSalonService.instance.activeSalonId;

    return Scaffold(
      backgroundColor: const Color(0xFFF9FAFB),
      appBar: AppBar(
        title: const Text(
          'Dashboard Propietario',
          style: TextStyle(
            fontFamily: 'Didot',
            fontWeight: FontWeight.bold,
          ),
        ),
        backgroundColor: Colors.white,
        elevation: 1.0,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _errorMessage != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        _errorMessage!,
                        style: const TextStyle(color: Colors.red),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: _loadData,
                        child: const Text('Reintentar'),
                      ),
                    ],
                  ),
                )
              : SingleChildScrollView(
                  padding: const EdgeInsets.only(bottom: 32.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // 🔹 Selector de Sede Activa
                      _buildBranchSelector(activeSalonId),

                      // 🔹 Banner de Advertencia Cross-Tenant
                      if (_metrics != null)
                        CrossTenantWarningBanner(
                          isCrossTenant: _metrics!.prestadoresCrossTenant,
                          advertencia: _metrics!.advertencia,
                          prestadoresExternos: _metrics!.prestadoresExternos,
                        ),

                      // 🔹 Badges de Estado e Indicadores
                      if (_metrics != null) _buildStateBadges(_metrics!),

                      // 🔹 Resumen Financiero
                      if (_metrics != null) _buildFinancialCards(_metrics!),

                      // 🔹 Desglose por Sede
                      if (_metrics != null) _buildBranchBreakdown(_metrics!.desglosePorSede),

                      // 🔹 Top Prestadores
                      if (_metrics != null) _buildTopProviders(_metrics!.topPrestadores),
                    ],
                  ),
                ),
    );
  }

  Widget _buildBranchSelector(int? activeSalonId) {
    return Container(
      margin: const EdgeInsets.all(16.0),
      padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12.0),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0F000000),
            blurRadius: 4.0,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          const Icon(Icons.storefront, color: Color(0xFF4F46E5)),
          const SizedBox(width: 12.0),
          const Text(
            'Sede Activa:',
            style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14.0),
          ),
          const SizedBox(width: 12.0),
          Expanded(
            child: DropdownButtonHideUnderline(
              child: DropdownButton<int?>(
                value: activeSalonId,
                isExpanded: true,
                items: [
                  const DropdownMenuItem<int?>(
                    value: null,
                    child: Text('Todas las Sedes (Consolidado)'),
                  ),
                  ..._salones.map((s) {
                    return DropdownMenuItem<int?>(
                      value: s['id'] as int?,
                      child: Text(s['nombre_salon'] ?? 'Sede ${s['id']}'),
                    );
                  }),
                ],
                onChanged: _handleSwitchSalon,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStateBadges(OwnerDashboardMetrics metrics) {
    if (!metrics.sedesCompartidas && !metrics.prestadoresCrossTenant) {
      return const SizedBox.shrink();
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 4.0),
      child: Wrap(
        spacing: 8.0,
        runSpacing: 4.0,
        children: [
          if (metrics.sedesCompartidas)
            const Chip(
              avatar: Icon(Icons.share, size: 16, color: Color(0xFF1E40AF)),
              label: Text(
                'Sedes Compartidas (Intra-Propietario)',
                style: TextStyle(fontSize: 11, color: Color(0xFF1E40AF)),
              ),
              backgroundColor: Color(0xFFDBEAFE),
            ),
          if (metrics.prestadoresCrossTenant)
            const Chip(
              avatar: Icon(Icons.warning, size: 16, color: Color(0xFF92400E)),
              label: Text(
                'Cross-Tenant (Salones de Otro Dueño)',
                style: TextStyle(fontSize: 11, color: Color(0xFF92400E)),
              ),
              backgroundColor: Color(0xFFFEF3C7),
            ),
        ],
      ),
    );
  }

  Widget _buildFinancialCards(OwnerDashboardMetrics metrics) {
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Resumen Financiero',
            style: TextStyle(
              fontFamily: 'Didot',
              fontWeight: FontWeight.bold,
              fontSize: 16.0,
            ),
          ),
          const SizedBox(height: 12.0),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisSpacing: 12.0,
            mainAxisSpacing: 12.0,
            childAspectRatio: 1.5,
            children: [
              _metricCard('Ingresos Brutos', '\$${metrics.ingresosBrutos.toStringAsFixed(0)}', Colors.blue),
              _metricCard('Comisión Plataforma', '\$${metrics.comisionPlataforma.toStringAsFixed(0)}', Colors.orange),
              _metricCard('Impuestos de Estado', '\$${metrics.impuestosEstado.toStringAsFixed(0)}', Colors.purple),
              _metricCard('Neto Negocio', '\$${metrics.ingresosNetosNegocio.toStringAsFixed(0)}', Colors.green, isBold: true),
              _metricCard('Neto Prestadores', '\$${metrics.pagoNetoPrestadores.toStringAsFixed(0)}', Colors.teal),
              _metricCard('Citas Totales', '${metrics.totalCitas} citas', Colors.indigo),
            ],
          ),
        ],
      ),
    );
  }

  Widget _metricCard(String label, String value, Color accentColor, {bool isBold = false}) {
    return Container(
      padding: const EdgeInsets.all(12.0),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12.0),
        border: Border.all(color: accentColor.withValues(alpha: 0.3)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A000000),
            blurRadius: 4.0,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 12.0,
              color: Colors.grey[600],
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 6.0),
          Text(
            value,
            style: TextStyle(
              fontSize: isBold ? 18.0 : 16.0,
              fontWeight: isBold ? FontWeight.bold : FontWeight.w600,
              color: isBold ? accentColor : Colors.black87,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBranchBreakdown(List desglose) {
    if (desglose.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Desglose por Sede',
            style: TextStyle(
              fontFamily: 'Didot',
              fontWeight: FontWeight.bold,
              fontSize: 16.0,
            ),
          ),
          const SizedBox(height: 8.0),
          ...desglose.map((item) {
            final Map m = item is Map ? item : {};
            final salonId = m['salon_id'];
            final bruto = (m['ingresos_brutos'] ?? 0).toDouble();
            final neto = (m['ingresos_netos_negocio'] ?? 0).toDouble();
            final citas = m['total_citas'] ?? 0;

            return Card(
              margin: const EdgeInsets.symmetric(vertical: 4.0),
              child: ListTile(
                title: Text('Sede ID: $salonId'),
                subtitle: Text('Citas: $citas | Bruto: \$${bruto.toStringAsFixed(0)}'),
                trailing: Text(
                  'Neto Negocio\n\$${neto.toStringAsFixed(0)}',
                  textAlign: TextAlign.right,
                  style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.green),
                ),
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildTopProviders(List topPrestadores) {
    if (topPrestadores.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Top Colaboradores',
            style: TextStyle(
              fontFamily: 'Didot',
              fontWeight: FontWeight.bold,
              fontSize: 16.0,
            ),
          ),
          const SizedBox(height: 8.0),
          ...topPrestadores.map((p) {
            final Map item = p is Map ? p : {};
            final nombre = item['nombre'] ?? 'Prestador #${item['provider_id']}';
            final generados = (item['ingresos_generados'] ?? 0).toDouble();
            final citas = item['total_citas'] ?? 0;

            return ListTile(
              leading: const CircleAvatar(
                child: Icon(Icons.person),
              ),
              title: Text(nombre.toString()),
              subtitle: Text('$citas citas atedidas'),
              trailing: Text(
                '\$${generados.toStringAsFixed(0)}',
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
            );
          }),
        ],
      ),
    );
  }
}
