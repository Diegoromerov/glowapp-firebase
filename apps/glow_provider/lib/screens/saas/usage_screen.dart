// lib/screens/saas/usage_screen.dart
import 'package:glow_core/models/saas/saas_models.dart';
import 'package:glow_core/glow_core.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Uso y métricas: consumo real del período por feature,
/// límites del plan y alertas de uso.
class UsageScreen extends ConsumerStatefulWidget {
  const UsageScreen({super.key});

  @override
  ConsumerState<UsageScreen> createState() => _UsageScreenState();
}

class _UsageScreenState extends ConsumerState<UsageScreen> {
  static const _bg = Color(0xFFFAF8F5);
  static const _ink = Color(0xFF1F1A15);
  static const _muted = Color(0xFF8C7E74);
  static const _line = Color(0xFFEFE8DE);
  static const _blue = Color(0xFF3B82F6);
  static const _green = Color(0xFF10B981);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _ensureLoaded());
  }

  Future<void> _ensureLoaded() async {
    if (ref.read(businessProfileProvider).profile == null) {
      await ref.read(businessProfileProvider.notifier).load();
    }
    final id = ref.read(currentBusinessProfileIdProvider) ?? '';
    if (ref.read(usageProvider).summary == null) {
      await ref.read(usageProvider.notifier).load(id);
    }
    if (ref.read(billingProvider).subscription == null) {
      await ref.read(billingProvider.notifier).load(id);
    }
  }

  @override
  Widget build(BuildContext context) {
    final profileState = ref.watch(businessProfileProvider);
    final businessProfileId = ref.watch(currentBusinessProfileIdProvider) ?? '';
    final usage = ref.watch(usageProvider);
    final subscription = ref.watch(billingProvider).subscription;

    if (profileState.profile == null) {
      return Scaffold(
        backgroundColor: _bg,
        appBar: AppBar(title: const Text('Uso y Métricas'), backgroundColor: _bg, foregroundColor: _ink),
        body: profileState.isLoading
            ? const Center(child: CircularProgressIndicator())
            : const Center(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Text(
                    'Activa tu cuenta SaaS desde Facturación para ver el consumo.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 13, color: _muted, height: 1.5),
                  ),
                ),
              ),
      );
    }

    final summary = usage.summary;
    final tier = subscription?.tier ?? SaasPlanTier.freeTrial;
    final alerts = summary?.alerts ?? const <UsageAlert>[];

    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        title: const Text('Uso y Métricas'),
        backgroundColor: _bg,
        foregroundColor: _ink,
        elevation: 0,
        actions: [
          IconButton(
            tooltip: 'Actualizar',
            icon: const Icon(Icons.refresh_rounded, color: Color(0xFFC5A052)),
            onPressed: () => ref.read(usageProvider.notifier).load(businessProfileId),
          ),
        ],
      ),
      body: usage.isLoading && summary == null
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: () async {
                await ref.read(usageProvider.notifier).load(businessProfileId);
                await ref.read(billingProvider.notifier).load(businessProfileId);
              },
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _periodHeader(summary, tier),
                  const SizedBox(height: 16),
                  if (usage.error != null) _errorBanner(usage.error),
                  _kpiGrid(summary, tier),
                  const SizedBox(height: 16),
                  if (alerts.isNotEmpty) ...[
                    _alertsSection(alerts),
                    const SizedBox(height: 16),
                  ],
                  _consumptionChart(summary, tier),
                  const SizedBox(height: 16),
                  _limitsTable(summary, tier),
                  if (summary != null && summary.metrics.isEmpty) ...[
                    const SizedBox(height: 16),
                    const Text(
                      'El período aún no registra consumo. Las métricas aparecen en cuanto '
                      'la plataforma registre reservas o llamadas a la API.',
                      style: TextStyle(fontSize: 12, color: _muted, height: 1.5),
                    ),
                  ],
                ],
              ),
            ),
    );
  }

  Widget _errorBanner(Object? error) {
    if (error == null) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.red.withOpacity(0.06),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.red.withOpacity(0.3)),
      ),
      child: Text('No se pudo cargar el uso: $error',
          style: const TextStyle(fontSize: 12, color: Colors.red)),
    );
  }

  // ───────────────────────── Encabezado ─────────────────────────

  Widget _periodHeader(UsageSummary? summary, SaasPlanTier tier) {
    final start = summary?.periodStart;
    final end = summary?.periodEnd;
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: tier.color.withOpacity(0.12),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: tier.color.withOpacity(0.4)),
          ),
          child: Text('Plan ${tier.label}',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: tier.color)),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            start != null && end != null
                ? 'Período ${_formatDate(start)} – ${_formatDate(end)}'
                : 'Período actual',
            style: const TextStyle(fontSize: 12, color: _muted),
          ),
        ),
      ],
    );
  }

  // ───────────────────────── KPIs ─────────────────────────

  Widget _kpiGrid(UsageSummary? summary, SaasPlanTier tier) {
    final metrics = summary?.metrics ?? const <UsageMetric>[];

    UsageMetric? metricOf(UsageMetricType t) {
      for (final m in metrics) {
        if (m.type == t) return m;
      }
      return null;
    }

    final api = metricOf(UsageMetricType.apiCalls);
    final bookings = metricOf(UsageMetricType.bookings);
    final seats = metricOf(UsageMetricType.staff);

    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisSpacing: 12,
      mainAxisSpacing: 12,
      childAspectRatio: 1.45,
      children: [
        _kpiCard('Llamadas API', api, _blue, Icons.api_rounded),
        _kpiCard('Reservas online', bookings, _green, Icons.event_available_rounded),
        _kpiCard('Asientos de equipo', seats, const Color(0xFF8B5CF6), Icons.people_rounded),
        _alertsKpi(summary),
      ],
    );
  }

  Widget _kpiCard(String title, UsageMetric? metric, Color color, IconData icon) {
    final used = metric?.current ?? 0;
    final limit = metric?.limit ?? 0;
    final unlimited = limit <= 0;
    final progress = unlimited ? 0.0 : (used / limit).clamp(0.0, 1.0);
    final capColor = progress >= 0.9
        ? Colors.red
        : progress >= 0.75
            ? Colors.amber.shade800
            : color;

    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: _line),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 18, color: color),
                const Spacer(),
                Text(
                  unlimited ? '∞' : '${(progress * 100).round()}%',
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: capColor),
                ),
              ],
            ),
            const Spacer(),
            Text(_formatNumber(used),
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: _ink)),
            Text(
              unlimited ? 'Ilimitado' : 'de ${_formatNumber(limit)}',
              style: const TextStyle(fontSize: 11, color: _muted),
            ),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: unlimited ? 0.08 : progress,
                minHeight: 5,
                backgroundColor: color.withOpacity(0.12),
                valueColor: AlwaysStoppedAnimation<Color>(capColor),
              ),
            ),
            const SizedBox(height: 6),
            Text(title, style: const TextStyle(fontSize: 11, color: _muted)),
          ],
        ),
      ),
    );
  }

  Widget _alertsKpi(UsageSummary? summary) {
    final alerts = summary?.alerts ?? const <UsageAlert>[];
    final critical = alerts.where((a) => a.severity == 'critical').length;
    final color = alerts.isEmpty ? _green : (critical > 0 ? Colors.red : Colors.amber.shade800);

    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: _line),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(alerts.isEmpty ? Icons.check_circle_rounded : Icons.warning_amber_rounded,
                    size: 18, color: color),
                const Spacer(),
                if (critical > 0)
                  Text('$critical críticas',
                      style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.red)),
              ],
            ),
            const Spacer(),
            Text('${alerts.length}',
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: _ink)),
            Text(alerts.isEmpty ? 'Sin alertas' : 'alertas de uso',
                style: const TextStyle(fontSize: 11, color: _muted)),
            const SizedBox(height: 6),
            Text(
              alerts.isEmpty ? 'Todo dentro de los límites' : 'Revisa el detalle abajo',
              style: TextStyle(fontSize: 10, color: color),
            ),
          ],
        ),
      ),
    );
  }

  // ───────────────────────── Alertas ─────────────────────────

  Widget _alertsSection(List<UsageAlert> alerts) {
    return _card(
      title: 'Alertas de Uso',
      subtitle: '${alerts.length} alerta(s) del período',
      children: alerts
          .map((a) {
            final isCritical = a.severity == 'critical';
            final color = isCritical ? Colors.red : Colors.amber.shade800;
            return Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: color.withOpacity(0.06),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: color.withOpacity(0.3)),
              ),
              child: Row(
                children: [
                  Icon(isCritical ? Icons.error_rounded : Icons.warning_amber_rounded,
                      size: 18, color: color),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(a.metricType.label,
                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: color)),
                        Text(
                          a.limitValue > 0
                              ? '${_formatNumber(a.currentValue)} de ${_formatNumber(a.limitValue)} '
                                  '(${a.percentageUsed.toStringAsFixed(0)}%)'
                              : '${_formatNumber(a.currentValue)} consumidos',
                          style: const TextStyle(fontSize: 11, color: _muted),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: 'Descartar',
                    icon: const Icon(Icons.close_rounded, size: 16, color: _muted),
                    onPressed: () => ref.read(usageProvider.notifier).dismissAlert(a.id),
                  ),
                ],
              ),
            );
          })
          .toList(),
    );
  }

  // ───────────────────────── Gráfico ─────────────────────────

  Widget _consumptionChart(UsageSummary? summary, SaasPlanTier tier) {
    // Métricas consumibles (no booleanas) con límite definido.
    final rows = (summary?.metrics ?? const <UsageMetric>[])
        .where((m) => !m.type.isBoolean && m.limit > 0)
        .toList();

    if (rows.isEmpty) {
      return _card(
        title: 'Consumo vs Límite',
        subtitle: 'Sin métricas con límite en el período.',
        children: const [],
      );
    }

    final groups = <BarChartGroupData>[];
    for (var i = 0; i < rows.length; i++) {
      final m = rows[i];
      final over = m.current > m.limit;
      groups.add(
        BarChartGroupData(
          x: i,
          barsSpace: 4,
          barRods: [
            BarChartRodData(
              toY: m.current.toDouble(),
              width: 14,
              borderRadius: BorderRadius.circular(4),
              color: over ? Colors.red : (_progressColor(m.progress) ?? tier.color),
            ),
            BarChartRodData(
              toY: m.limit.toDouble(),
              width: 14,
              borderRadius: BorderRadius.circular(4),
              color: _line,
            ),
          ],
        ),
      );
    }

    final maxY = rows
        .map((m) => (m.current > m.limit ? m.current : m.limit).toDouble())
        .reduce((a, b) => a > b ? a : b);

    return _card(
      title: 'Consumo vs Límite',
      subtitle: 'Barra de color: consumo · Barra gris: límite del plan',
      children: [
        SizedBox(
          height: 200,
          child: BarChart(
            BarChartData(
              alignment: BarChartAlignment.spaceAround,
              maxY: maxY * 1.15,
              gridData: FlGridData(
                show: true,
                drawVerticalLine: false,
                getDrawingHorizontalLine: (_) => const FlLine(color: _line, strokeWidth: 1),
              ),
              borderData: FlBorderData(show: false),
              titlesData: FlTitlesData(
                topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                leftTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 40,
                    getTitlesWidget: (value, meta) => Text(
                      _formatNumber(value.round()),
                      style: const TextStyle(fontSize: 9, color: _muted),
                    ),
                  ),
                ),
                bottomTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 34,
                    getTitlesWidget: (value, meta) {
                      final idx = value.toInt();
                      if (idx < 0 || idx >= rows.length) return const SizedBox.shrink();
                      final label = rows[idx].type.label;
                      return Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(
                          label.length > 12 ? '${label.substring(0, 11)}…' : label,
                          style: const TextStyle(fontSize: 9, color: _muted),
                          textAlign: TextAlign.center,
                        ),
                      );
                    },
                  ),
                ),
              ),
              barGroups: groups,
            ),
          ),
        ),
      ],
    );
  }

  Color? _progressColor(double progress) {
    if (progress >= 0.9) return Colors.red;
    if (progress >= 0.75) return Colors.amber.shade800;
    return null;
  }

  // ───────────────────────── Tabla de límites ─────────────────────────

  Widget _limitsTable(UsageSummary? summary, SaasPlanTier tier) {
    final limits = tier.limits;
    final metrics = summary?.metrics ?? const <UsageMetric>[];

    int usedFor(String code) {
      for (final m in metrics) {
        if (m.type.code == code) return m.current;
      }
      return 0;
    }

    final rows = <Widget>[];
    limits.forEach((code, limit) {
      final type = UsageMetricType.fromCode(code);
      final used = usedFor(code);
      final isBool = type.isBoolean;

      if (isBool) {
        final included = (limit ?? 0) > 0;
        rows.add(_limitRow(
          label: type.label,
          value: included ? 'Incluido' : 'No incluido',
          progress: null,
          color: included ? _green : _muted,
        ));
        return;
      }

      if (limit == null) {
        rows.add(_limitRow(label: type.label, value: 'Ilimitado', progress: null, color: _green));
        return;
      }

      final progress = limit > 0 ? (used / limit).clamp(0.0, 1.0) : 0.0;
      final color = _progressColor(progress) ?? tier.color;
      rows.add(_limitRow(
        label: type.label,
        value: '${_formatNumber(used)} / ${_formatNumber(limit)}',
        progress: progress,
        color: color,
      ));
    });

    return _card(
      title: 'Límites del Plan ${tier.label}',
      subtitle: 'Consumo del período actual frente al plan contratado',
      children: rows,
    );
  }

  Widget _limitRow({
    required String label,
    required String value,
    required double? progress,
    required Color color,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(label, style: const TextStyle(fontSize: 12, color: _ink)),
              ),
              Text(value,
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: color)),
            ],
          ),
          if (progress != null) ...[
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(3),
              child: LinearProgressIndicator(
                value: progress,
                minHeight: 5,
                backgroundColor: _line,
                valueColor: AlwaysStoppedAnimation<Color>(color),
              ),
            ),
          ],
        ],
      ),
    );
  }

  // ───────────────────────── Helpers UI ─────────────────────────

  Widget _card({
    required String title,
    required String subtitle,
    required List<Widget> children,
  }) {
    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: _line),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: _ink)),
            const SizedBox(height: 4),
            Text(subtitle, style: const TextStyle(fontSize: 11, color: _muted, height: 1.4)),
            if (children.isNotEmpty) const SizedBox(height: 14),
            ...children,
          ],
        ),
      ),
    );
  }

  String _formatDate(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';

  String _formatNumber(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(n % 1000 == 0 ? 0 : 1)}K';
    return n.toString();
  }
}
