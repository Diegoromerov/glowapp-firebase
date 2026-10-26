/// Modelo de datos para las métricas del Dashboard de Propietario Consolidado.
/// Mapea de forma estricta los campos del backend (/api/v1/owner/dashboard-metrics).
class OwnerDashboardMetrics {
  final double ingresosBrutos;
  final double comisionPlataforma;
  final double impuestosEstado;
  final double ingresosNetosNegocio;
  final double pagoNetoPrestadores;
  final int totalCitas;
  final bool sedesCompartidas;
  final bool prestadoresCrossTenant;
  final List<dynamic> prestadoresExternos;
  final String? advertencia;
  final List<dynamic> desglosePorSede;
  final List<dynamic> topPrestadores;

  OwnerDashboardMetrics({
    required this.ingresosBrutos,
    required this.comisionPlataforma,
    required this.impuestosEstado,
    required this.ingresosNetosNegocio,
    required this.pagoNetoPrestadores,
    required this.totalCitas,
    required this.sedesCompartidas,
    required this.prestadoresCrossTenant,
    this.prestadoresExternos = const [],
    this.advertencia,
    this.desglosePorSede = const [],
    this.topPrestadores = const [],
  });

  factory OwnerDashboardMetrics.fromJson(Map<String, dynamic> json) {
    if (!json.containsKey('comision_plataforma')) {
      throw ArgumentError('El payload de métricas requiere el campo "comision_plataforma" (singular).');
    }
    if (!json.containsKey('ingresos_netos_negocio')) {
      throw ArgumentError('El payload de métricas requiere el campo "ingresos_netos_negocio" del servidor.');
    }

    return OwnerDashboardMetrics(
      ingresosBrutos: (json['ingresos_brutos'] ?? 0).toDouble(),
      comisionPlataforma: (json['comision_plataforma'] ?? 0).toDouble(),
      impuestosEstado: (json['impuestos_estado'] ?? 0).toDouble(),
      ingresosNetosNegocio: (json['ingresos_netos_negocio'] ?? 0).toDouble(),
      pagoNetoPrestadores: (json['pago_neto_prestadores'] ?? 0).toDouble(),
      totalCitas: json['total_citas'] ?? 0,
      sedesCompartidas: json['sedes_compartidas'] == true,
      prestadoresCrossTenant: json['prestadores_cross_tenant'] == true,
      prestadoresExternos: json['prestadores_externos'] is List
          ? json['prestadores_externos'] as List
          : const [],
      advertencia: json['advertencia'] as String?,
      desglosePorSede: json['desglose_por_sede'] is List
          ? json['desglose_por_sede'] as List
          : const [],
      topPrestadores: json['top_prestadores'] is List
          ? json['top_prestadores'] as List
          : const [],
    );
  }
}
