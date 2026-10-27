import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:glow_core/glow_core.dart';


import 'business_document_generator_screen.dart';
import 'business_onboarding_screen.dart';
import 'business_task_detail_screen.dart';

/// GLOWAPP BUSINESS DASHBOARD SCREEN
/// Operating Center: puntaje de cumplimiento, tareas guiadas y hallazgos.
///
/// Esta pantalla era enteramente inventada: el puntaje (0.65), el nombre
/// ('Mi Peluquería Studio'), la etapa, tres tareas y un hallazgo estaban
/// escritos a mano, no llamaba a la API en ningún punto y el «refrescar» era un
/// `Future.delayed(500ms)`.
///
/// Ahora carga el expediente real desde `GET /api/v1/business/summary` y, si el
/// proveedor todavía no tiene expediente (404), lo dice y lleva al diagnóstico
/// en vez de enseñar un negocio que no existe.
class BusinessDashboardScreen extends StatefulWidget {
  /// Servicio inyectable. En la app se resuelve con la sesión real
  /// (`BusinessApiService.fromSession()`); en pruebas se inyecta un doble para
  /// provocar de forma determinista un fallo, un 404 o datos reales, sin
  /// depender de que el entorno de test tenga red (mismo criterio que
  /// `OwnerDashboardScreen`, que recibe sus métricas por constructor).
  final BusinessApiService? api;

  const BusinessDashboardScreen({super.key, this.api});

  @override
  State<BusinessDashboardScreen> createState() => _BusinessDashboardScreenState();
}

class _BusinessDashboardScreenState extends State<BusinessDashboardScreen> {
  bool _loading = true;
  String? _error;
  BusinessProfileModel? _profile;
  List<BusinessTaskModel> _tasks = [];
  List<BusinessFindingModel> _findings = [];

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      // Con un servicio inyectado (pruebas) no se toca la sesión real.
      final api = widget.api ?? await BusinessApiService.fromSession();
      final data = await api.fetchBusinessSummary();

      final profileJson =
          Map<String, dynamic>.from(data['profile'] as Map? ?? {});
      final tasks = (data['tasks'] as List? ?? [])
          .whereType<Map>()
          .map((t) => BusinessTaskModel.fromJson(Map<String, dynamic>.from(t)))
          .toList();
      final findings = (data['findings'] as List? ?? [])
          .whereType<Map>()
          .map((f) => BusinessFindingModel.fromJson(Map<String, dynamic>.from(f)))
          .toList();

      if (!mounted) return;
      setState(() {
        _profile = BusinessProfileModel.fromJson(profileJson);
        _tasks = tasks;
        _findings = findings;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        // El 404 no es un fallo del servidor: significa que este proveedor
        // todavía no hizo el diagnóstico, y la salida es otra.
        _error = e.toString().contains('404')
            ? 'Todavía no tienes un expediente de negocio. Empieza con el diagnóstico.'
            : 'No se pudo cargar tu Business Center: $e';
        _profile = null;
        _tasks = [];
        _findings = [];
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.surface,
      appBar: AppBar(
        title: const Text(
          'GlowApp Business Center',
          style: TextStyle(fontWeight: FontWeight.bold, letterSpacing: 0.5),
        ),
        backgroundColor: AppTheme.background,
        foregroundColor: Colors.white,
        elevation: 0,
        actions: [
          IconButton(
            icon: Icon(Icons.dashboard_customize, color: AppTheme.warning),
            tooltip: 'Ir a mi Tablero SaaS',
            onPressed: () {
              HapticFeedback.mediumImpact();
              Navigator.pushReplacementNamed(context, '/salon');
            },
          ),
          IconButton(
            icon: const Icon(Icons.add_business),
            tooltip: 'Nuevo Diagnóstico',
            onPressed: () {
              HapticFeedback.lightImpact();
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const BusinessOnboardingScreen()),
              );
            },
          ),
          IconButton(
            icon: const Icon(Icons.description_outlined),
            tooltip: 'Documentos Legal',
            onPressed: () {
              HapticFeedback.lightImpact();
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const BusinessDocumentGeneratorScreen()),
              );
            },
          ),
        ],
      ),
      body: RefreshIndicator(
        color: AppTheme.warning,
        backgroundColor: AppTheme.background,
        // Refresco real: vuelve a pedir el expediente a la API. Antes esto era
        // un `Future.delayed(500ms)` que simulaba una recarga.
        onRefresh: _cargar,
        child: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(48),
          child: CircularProgressIndicator(),
        ),
      );
    }

    if (_profile == null) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(24),
        children: [
          const SizedBox(height: 60),
          Icon(
            Icons.business_center_outlined,
            size: 56,
            color: AppTheme.background.withValues(alpha: 0.35),
          ),
          const SizedBox(height: 16),
          Text(
            _error ?? 'Sin expediente de negocio.',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 14, color: Colors.black87),
          ),
          const SizedBox(height: 24),
          Center(
            child: ElevatedButton.icon(
              onPressed: () {
                HapticFeedback.lightImpact();
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const BusinessOnboardingScreen()),
                );
              },
              icon: const Icon(Icons.add_business),
              label: const Text('Hacer el diagnóstico'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.warning,
                foregroundColor: AppTheme.background,
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              ),
            ),
          ),
        ],
      );
    }

    return SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header Card Belleza Luxe
          _buildHeaderCard(),
          const SizedBox(height: 24),

          // Active Tasks Header
          Text(
            'Ruta de Trámites & Tareas Guiadas',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: AppTheme.background,
                ),
          ),
          const SizedBox(height: 12),

          if (_tasks.isEmpty)
            _buildEstadoVacio('Aún no tienes tareas asignadas.')
          else
            ..._tasks.map(
              (t) => _buildTaskCard(task: t),
            ),

          const SizedBox(height: 24),
          // Findings & Audit
          Text(
            'Hallazgos de Auditoría (Continuidad)',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: AppTheme.background,
                ),
          ),
          const SizedBox(height: 12),

          if (_findings.isEmpty)
            _buildEstadoVacio('Sin hallazgos de auditoría.')
          else
            ..._findings.map(
              (f) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _buildFindingCard(
                  title: f.title,
                  subtitle: f.description.isEmpty
                      ? 'Riesgo ${f.riskLevel.label}'
                      : f.description,
                  risk: f.riskLevel,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildEstadoVacio(String mensaje) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.background.withValues(alpha: 0.12)),
      ),
      child: Text(
        mensaje,
        style: const TextStyle(fontSize: 12, color: Colors.black54),
      ),
    );
  }

  Widget _buildHeaderCard() {
    final profile = _profile!;
    // El `compliance_score` que devuelve la API ya viene en escala 0-100
    // (businessDiagnosticService.getProfileSummary), no en fracción: el 0.65
    // inventado de antes era otra escala.
    final score = profile.complianceScore.clamp(0, 100).round();
    final modo = profile.onboardingMode == 'EXISTING_BUSINESS'
        ? 'Modo: Negocio Existente'
        : 'Modo: Negocio Nuevo';
    final etapa = profile.lifecycleStage.replaceAll('_', ' ');

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppTheme.background,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.12),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  profile.name,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Etapa: $etapa',
                  style: TextStyle(color: AppTheme.surface, fontSize: 12),
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppTheme.warning,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    modo,
                    style: TextStyle(color: AppTheme.background, fontSize: 10, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
          ),
          // Compliance Gauge
          Semantics(
            label: 'Nivel de cumplimiento del negocio: $score%',
            child: Container(
              width: 76,
              height: 76,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: AppTheme.warning, width: 4),
              ),
              child: Center(
                child: Text(
                  '$score%',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 18,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTaskCard({required BusinessTaskModel task}) {
    return Semantics(
      button: true,
      label: 'Tarea: ${task.title}. Estado: ${task.status.label}',
      child: Card(
        margin: const EdgeInsets.only(bottom: 12),
        elevation: 1,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        child: ListTile(
          onTap: () async {
            HapticFeedback.lightImpact();
            // Se pasa la tarea real: la pantalla de detalle necesita su id para
            // avanzar la etapa contra el backend (antes se abría sin ningún dato
            // y mostraba un trámite inventado).
            await Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => BusinessTaskDetailScreen(task: task)),
            );
            // Al volver, la etapa puede haber cambiado en el servidor.
            if (mounted) _cargar();
          },
          leading: CircleAvatar(
            backgroundColor: AppTheme.primary.withValues(alpha: 0.12),
            child: Icon(task.stage.icon, color: AppTheme.primary, size: 20),
          ),
          title: Text(task.title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
          subtitle: Text(
            'Etapa: ${task.stage.code} ➔ ${task.description.isEmpty ? 'Sin descripción' : task.description}',
            style: const TextStyle(fontSize: 12, color: Colors.black54),
          ),
          trailing: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: task.status.color.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              task.status.label,
              style: TextStyle(color: task.status.color, fontWeight: FontWeight.bold, fontSize: 10),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildFindingCard({
    required String title,
    required String subtitle,
    required FindingRiskLevel risk,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: risk.color.withValues(alpha: 0.08),
        border: Border.all(color: risk.color.withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(Icons.warning_amber_rounded, color: risk.color, size: 30),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: AppTheme.background)),
                const SizedBox(height: 4),
                Text(subtitle, style: const TextStyle(fontSize: 12, color: Colors.black87)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
