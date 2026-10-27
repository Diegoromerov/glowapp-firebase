import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:glow_core/glow_core.dart';



/// GLOWAPP BUSINESS TASK DETAIL SCREEN
///
/// Detalle de UNA tarea real del Business Center.
///
/// Antes esta pantalla era enteramente inventada: cinco pasos con normativa
/// escrita a mano ("Ley 9 de 1979 / Decreto 1879", "Concepto Sanitario"), un
/// botón que "descargaba" un PDF sin descargar nada (solo un SnackBar), una caja
/// "Aura sugiere" con texto fijo, y una carga de evidencia que únicamente
/// cambiaba un bool para afirmar "Certificado_Sanitario_2026.pdf (Cargado)" y
/// "Evidencia enviada exitosamente para revisión administrativa". No llamaba a
/// la API en ningún punto.
///
/// Ahora muestra la tarea que recibe y avanza la etapa contra el backend real
/// (POST /api/v1/business/tasks/:id/advance). Lo que el backend no entrega no se
/// pinta: nada de texto normativo de relleno ni de éxito fabricado.
///
/// La evidencia ahora se sube de verdad: el botón abre el selector de imágenes,
/// el archivo viaja en multipart al endpoint (POST /tasks/:id/evidence) y la
/// pantalla muestra la ruta que devuelve el SERVIDOR. Antes no existía ninguna
/// vía de subida y el servidor aceptaba una ruta declarada por el cliente; por
/// eso la carga se había retirado en lugar de fingir un envío.
class BusinessTaskDetailScreen extends StatefulWidget {
  /// Tarea real a mostrar. La pantalla no tiene datos por defecto: si no se le
  /// pasa ninguna, lo dice, en lugar de enseñar un trámite que no existe.
  final BusinessTaskModel? task;

  const BusinessTaskDetailScreen({super.key, this.task});

  @override
  State<BusinessTaskDetailScreen> createState() => _BusinessTaskDetailScreenState();
}

class _BusinessTaskDetailScreenState extends State<BusinessTaskDetailScreen> {
  BusinessTaskModel? _task;
  bool _avanzando = false;
  bool _subiendoEvidencia = false;
  String? _error;

  /// Ruta REAL que devolvió el servidor al guardar el archivo. Se muestra solo
  /// después de que el servidor la confirma: no se afirma un envío que no ocurrió.
  String? _evidenciaEnviada;

  @override
  void initState() {
    super.initState();
    _task = widget.task;
  }

  Future<void> _avanzar() async {
    final actual = _task;
    if (actual == null || _avanzando || actual.id.isEmpty) return;

    setState(() {
      _avanzando = true;
      _error = null;
    });

    try {
      final api = await BusinessApiService.fromSession();
      final actualizada = await api.advanceTask(taskId: actual.id, action: 'NEXT');
      if (!mounted) return;
      setState(() {
        _task = actualizada;
        _avanzando = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Etapa actualizada: ${actualizada.stage.label}'),
          backgroundColor: actualizada.status.color,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'No se pudo avanzar la tarea: $e';
        _avanzando = false;
      });
    }
  }

  /// Abre el selector de imágenes y SUBE el archivo al servidor.
  ///
  /// Si el usuario cancela no se afirma nada. La ruta que se muestra abajo es la
  /// que devolvió el servidor al guardar el archivo, nunca una inventada aquí.
  Future<void> _adjuntarEvidencia() async {
    final actual = _task;
    if (actual == null || _subiendoEvidencia || actual.id.isEmpty) return;

    final elegido = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (elegido == null) return;

    setState(() {
      _subiendoEvidencia = true;
      _error = null;
    });

    try {
      final api = await BusinessApiService.fromSession();
      final data = await api.uploadEvidence(taskId: actual.id, filePath: elegido.path);
      if (!mounted) return;
      final evidencia = (data['evidence'] as Map?)?.cast<String, dynamic>() ?? data;
      setState(() {
        _evidenciaEnviada = evidencia['file_path']?.toString();
        _subiendoEvidencia = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'No se pudo subir la evidencia: $e';
        _subiendoEvidencia = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final tarea = _task;

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: Text(
          tarea?.title.isNotEmpty == true ? tarea!.title : 'Detalle de la tarea',
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
        ),
        backgroundColor: AppTheme.primary,
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      body: tarea == null ? _buildSinTarea() : _buildTarea(tarea),
    );
  }

  Widget _buildSinTarea() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.inbox_outlined, size: 56, color: AppTheme.primary.withOpacity(0.3)),
            const SizedBox(height: 16),
            Text(
              'No se recibió ninguna tarea que mostrar.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.primary),
            ),
            const SizedBox(height: 8),
            const Text(
              'Abre esta pantalla desde la lista de tareas del Business Center.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, color: Colors.black54),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTarea(BusinessTaskModel tarea) {
    final etapaActual = TaskStage.values.indexOf(tarea.stage);
    final esUltimaEtapa = etapaActual >= TaskStage.values.length - 1;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Estado real de la tarea, tal como lo devuelve el backend.
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: tarea.status.color.withOpacity(0.10),
              border: Border.all(color: tarea.status.color.withOpacity(0.4)),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(tarea.stage.icon, color: AppTheme.primary, size: 22),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        tarea.stage.label,
                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: AppTheme.primary),
                      ),
                    ),
                    Text(
                      tarea.status.label,
                      style: TextStyle(color: tarea.status.color, fontWeight: FontWeight.bold, fontSize: 11),
                    ),
                  ],
                ),
                if (tarea.description.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(
                    tarea.description,
                    style: const TextStyle(fontSize: 13, height: 1.4, color: Colors.black87),
                  ),
                ],
                if (tarea.dueDate.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Text(
                    'Fecha límite: ${tarea.dueDate}',
                    style: const TextStyle(fontSize: 12, color: Colors.black54),
                  ),
                ],
              ],
            ),
          ),

          const SizedBox(height: 24),
          Text(
            'Flujo guiado',
            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: AppTheme.primary),
          ),
          const SizedBox(height: 4),
          const Text(
            'La etapa actual la marca el backend; desde aquí solo se avanza.',
            style: TextStyle(fontSize: 12, color: Colors.black54),
          ),
          const SizedBox(height: 12),

          // Las cinco etapas del flujo real, sin textos normativos inventados.
          ...TaskStage.values.asMap().entries.map((entry) {
            final indice = entry.key;
            final etapa = entry.value;
            final completada = indice < etapaActual;
            final esActual = indice == etapaActual;
            return Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: esActual ? AppTheme.primary.withOpacity(0.08) : Colors.white,
                border: Border.all(
                  color: esActual ? AppTheme.primary.withOpacity(0.5) : Colors.grey.shade300,
                ),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  Icon(
                    completada ? Icons.check_circle : (esActual ? Icons.radio_button_checked : Icons.circle_outlined),
                    size: 18,
                    color: completada ? const Color(0xFF10B981) : (esActual ? AppTheme.primary : Colors.grey),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      etapa.label,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: esActual ? FontWeight.bold : FontWeight.normal,
                        color: esActual ? AppTheme.primary : Colors.black87,
                      ),
                    ),
                  ),
                  if (esActual)
                    Text('etapa actual', style: TextStyle(fontSize: 10, color: AppTheme.primary, fontWeight: FontWeight.bold)),
                ],
              ),
            );
          }),

          if (_error != null) ...[
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFFEF2F2),
                border: Border.all(color: const Color(0xFFFCA5A5)),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(_error!, style: const TextStyle(fontSize: 12, color: Color(0xFF991B1B))),
            ),
          ],

          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: (_avanzando || esUltimaEtapa || tarea.id.isEmpty) ? null : _avanzar,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primary,
                foregroundColor: AppTheme.warning,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              child: _avanzando
                  ? SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.warning))
                  : Text(esUltimaEtapa ? 'Última etapa del flujo' : 'Avanzar a la siguiente etapa'),
            ),
          ),
          const SizedBox(height: 12),
          // Evidencia: sube un archivo real. La ruta que se muestra es la que
          // devolvió el servidor al guardarlo; si la subida falla, se ve el error.
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: (_subiendoEvidencia || tarea.id.isEmpty) ? null : _adjuntarEvidencia,
              icon: _subiendoEvidencia
                  ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.upload_file_outlined, size: 18),
              label: Text(_subiendoEvidencia ? 'Subiendo…' : 'Adjuntar evidencia'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppTheme.primary,
                side: BorderSide(color: AppTheme.primary),
                padding: const EdgeInsets.symmetric(vertical: 12),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ),
          if (_evidenciaEnviada != null) ...[
            const SizedBox(height: 8),
            Text(
              'Evidencia guardada en el servidor: $_evidenciaEnviada',
              style: const TextStyle(fontSize: 11, color: Color(0xFF047857)),
            ),
          ],
          const SizedBox(height: 8),
          Text(
            'Tarea ${tarea.id}',
            style: const TextStyle(fontSize: 10, color: Colors.black38),
          ),
        ],
      ),
    );
  }
}
