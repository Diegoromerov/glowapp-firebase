import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';
import 'package:image_picker/image_picker.dart';

class ProviderDisputesScreen extends StatefulWidget {
  const ProviderDisputesScreen({super.key});

  @override
  State<ProviderDisputesScreen> createState() => _ProviderDisputesScreenState();
}

class _ProviderDisputesScreenState extends State<ProviderDisputesScreen> {
  static const _plum = Color(0xFF54264F);
  static const _plumSoft = Color(0xFFF2E8F1);
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _cases = [];

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
      final rows = await DisputeService.getMyDisputes();
      if (!mounted) return;
      setState(() {
        _cases = rows ?? [];
        if (rows == null) _error = 'No se pudieron cargar tus casos.';
      });
    } catch (e) {
      if (mounted) setState(() => _error = mensajeHumano(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
        title: const Text('Disputas de citas'),
        backgroundColor: _plum,
        foregroundColor: Colors.white,
        titleTextStyle: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w600),
        actions: [
          IconButton(
            onPressed: _load,
            icon: const Icon(Icons.refresh),
            tooltip: 'Actualizar',
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(_error!, textAlign: TextAlign.center),
                    const SizedBox(height: 12),
                    FilledButton(
                      onPressed: _load,
                      child: const Text('Reintentar'),
                    ),
                  ],
                ),
              ),
            )
          : _cases.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.gavel_outlined, size: 40),
                    const SizedBox(height: 12),
                    const Text(
                      'No tienes disputas vinculadas a citas.',
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Las solicitudes generales se crean desde el centro PQRSF.',
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 12),
                    TextButton.icon(
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.support_agent_outlined),
                      label: const Text('Volver al centro PQRSF'),
                    ),
                  ],
                ),
              ),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: _cases.length + 1,
                itemBuilder: (context, index) {
                  if (index == 0) {
                    return Container(
                      padding: const EdgeInsets.all(16),
                      margin: const EdgeInsets.only(bottom: 16),
                      decoration: BoxDecoration(
                        color: _plumSoft,
                        borderRadius: BorderRadius.circular(18),
                        border: Border.all(color: const Color(0xFFDCC8D9)),
                      ),
                      child: const Row(
                        children: [
                          Icon(Icons.gavel_outlined, color: _plum),
                          SizedBox(width: 12),
                          Expanded(child: Text('Expedientes vinculados a citas. Aquí puedes revisar el caso y responder.')),
                        ],
                      ),
                    );
                  }
                  final item = _cases[index - 1];
                  final id = item['id']?.toString() ?? '';
                  final state = item['estado']?.toString() ?? 'ABIERTA';
                  final bookingNumber = item['booking_number']?.toString();
                  final bookingDate = DateTime.tryParse(item['booking_fecha']?.toString() ?? '')?.toLocal();
                  final amount = item['monto_disputado']?.toString();
                  final dateLabel = bookingDate == null
                      ? 'Fecha de cita pendiente'
                      : '${bookingDate.day}/${bookingDate.month}/${bookingDate.year}';
                  return Card(
                    margin: const EdgeInsets.only(bottom: 14),
                    color: Colors.white,
                    elevation: 1,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(20),
                      side: const BorderSide(color: Color(0xFFE9DDE8)),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Icon(Icons.gavel_outlined, color: _plum),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  bookingNumber == null || bookingNumber.isEmpty
                                      ? 'Disputa de cita'
                                      : 'Cita #$bookingNumber',
                                  style: const TextStyle(color: _plum, fontWeight: FontWeight.bold),
                                ),
                              ),
                              _DisputeStatusChip(label: state.replaceAll('_', ' ').toLowerCase()),
                            ],
                          ),
                          const SizedBox(height: 14),
                          Text(
                            item['servicio_nombre']?.toString() ?? 'Servicio',
                            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: Color(0xFF241D25)),
                          ),
                          const SizedBox(height: 6),
                          Text('${item['tipo'] ?? 'Caso'} · $dateLabel'),
                          if (amount != null && amount.isNotEmpty) ...[
                            const SizedBox(height: 12),
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                              decoration: BoxDecoration(color: const Color(0xFFFFF3DE), borderRadius: BorderRadius.circular(12)),
                              child: Text('Monto en disputa: \$$amount COP', style: const TextStyle(fontWeight: FontWeight.w600)),
                            ),
                          ],
                          const SizedBox(height: 16),
                          _DisputeProgress(state: state),
                          const SizedBox(height: 12),
                          OutlinedButton.icon(
                            onPressed: id.isEmpty
                                ? null
                                : () async {
                                    await Navigator.push(
                                      context,
                                      MaterialPageRoute(builder: (_) => _ProviderDisputeDetail(id: id)),
                                    );
                                    if (mounted) _load();
                                  },
                            icon: const Icon(Icons.folder_open_outlined),
                            label: const Text('Ver expediente'),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: _plum,
                              side: const BorderSide(color: _plum),
                              minimumSize: const Size.fromHeight(44),
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
    );
  }
}

class _DisputeStatusChip extends StatelessWidget {
  final String label;
  const _DisputeStatusChip({required this.label});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(color: const Color(0xFFF2E8F1), borderRadius: BorderRadius.circular(20)),
    child: Text(label, style: const TextStyle(color: Color(0xFF54264F), fontSize: 11, fontWeight: FontWeight.w700)),
  );
}

class _DisputeProgress extends StatelessWidget {
  final String state;
  const _DisputeProgress({required this.state});

  @override
  Widget build(BuildContext context) {
    final normalized = state.toUpperCase();
    final activeStep = normalized.contains('RESUEL') || normalized.contains('CERR')
        ? 2
        : normalized.contains('REVISION') || normalized.contains('PROCESO')
        ? 1
        : 0;
    const labels = ['Recibida', 'En revisión', 'Decisión'];
    return Row(
      children: [
        for (var step = 0; step < labels.length; step++) ...[
          if (step > 0)
            Expanded(
              child: Container(
                height: 2,
                color: step <= activeStep ? const Color(0xFF9A6A1E) : const Color(0xFFE5DDE5),
              ),
            ),
          Column(
            children: [
              Icon(
                step < activeStep
                    ? Icons.check_circle
                    : step == activeStep
                    ? Icons.radio_button_checked
                    : Icons.circle_outlined,
                size: 20,
                color: step <= activeStep ? const Color(0xFF54264F) : Colors.black38,
              ),
              const SizedBox(height: 4),
              Text(labels[step], style: const TextStyle(fontSize: 10)),
            ],
          ),
        ],
      ],
    );
  }
}

class _ProviderDisputeDetail extends StatefulWidget {
  final String id;
  const _ProviderDisputeDetail({required this.id});

  @override
  State<_ProviderDisputeDetail> createState() => _ProviderDisputeDetailState();
}

class _ProviderDisputeDetailState extends State<_ProviderDisputeDetail> {
  final _message = TextEditingController();
  final List<String> _evidenceDraft = [];
  final ImagePicker _picker = ImagePicker();
  Map<String, dynamic>? _case;
  bool _loading = true;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void dispose() {
    _message.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await DisputeService.getDisputeById(widget.id);
      if (mounted)
        setState(() {
          _case = result;
          if (result == null) _error = 'No se pudo abrir el expediente.';
        });
    } catch (e) {
      if (mounted) setState(() => _error = mensajeHumano(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _send() async {
    final text = _message.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final result = await DisputeService.sendMessage(
        disputeId: widget.id,
        message: text,
        evidenceUrls: _evidenceDraft,
      );
      if (result == null) throw Exception('No se pudo enviar la respuesta.');
      _message.clear();
      _evidenceDraft.clear();
      await _refresh();
    } catch (e) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(mensajeHumano(e))));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _attachEvidence() async {
    if (_evidenceDraft.length >= 5) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Puedes adjuntar máximo 5 imágenes.')),
      );
      return;
    }
    try {
      final XFile? file = await _picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1000,
        maxHeight: 1000,
        imageQuality: 80,
      );
      if (file == null) return;
      final bytes = await file.readAsBytes();
      final total = _evidenceDraft.fold<int>(
        0,
        (sum, item) => sum + base64Decode(item.split(',').last).length,
      );
      if (bytes.length > 1500000 || total + bytes.length > 7500000) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Máximo 1,5 MB por imagen y 7,5 MB en total.'),
          ),
        );
        return;
      }
      final ext = file.name.toLowerCase().split('.').last;
      final mime = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'webp': 'image/webp',
      }[ext];
      if (mime == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Formato no admitido. Usa JPG, PNG o WebP.'),
          ),
        );
        return;
      }
      setState(
        () => _evidenceDraft.add('data:$mime;base64,${base64Encode(bytes)}'),
      );
    } catch (e) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(mensajeHumano(e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages =
        (_case?['mensajes'] as List?)
            ?.whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList() ??
        [];
    final closed = [
      'RESUELTA',
      'CERRADA',
    ].contains(_case?['estado']?.toString());
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
        title: const Text('Expediente de disputa'),
        backgroundColor: const Color(0xFFFAF8F5),
        foregroundColor: const Color(0xFF1F1A15),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(child: Text(_error!))
          : Column(
              children: [
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${_case?['estado'] ?? 'ABIERTA'} · ${_case?['tipo'] ?? ''}',
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                'Cita #${_case?['booking_number'] ?? '—'} · ${_case?['servicio_nombre'] ?? 'Servicio'}',
                              ),
                              const SizedBox(height: 12),
                              Text(_case?['descripcion']?.toString() ?? ''),
                              const SizedBox(height: 12),
                              Text(
                                'Monto en disputa: \$${_case?['monto_disputado'] ?? '—'} COP',
                              ),
                              const SizedBox(height: 12),
                              Text(
                                'Evidencias (${(_case?['evidencia_urls'] as List?)?.length ?? 0})',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  for (final evidence
                                      in (_case?['evidencia_urls'] as List?)
                                              ?.whereType<String>() ??
                                          const <String>[])
                                    if (evidence.startsWith('data:image/'))
                                      ClipRRect(
                                        borderRadius: BorderRadius.circular(8),
                                        child: Image.memory(
                                          base64Decode(
                                            evidence.split(',').last,
                                          ),
                                          width: 120,
                                          height: 100,
                                          fit: BoxFit.cover,
                                          errorBuilder: (_, __, ___) =>
                                              const SizedBox(
                                                width: 120,
                                                height: 100,
                                                child: Icon(
                                                  Icons.broken_image_outlined,
                                                ),
                                              ),
                                        ),
                                      )
                                    else if (evidence.startsWith('https://') ||
                                        evidence.startsWith('http://'))
                                      ClipRRect(
                                        borderRadius: BorderRadius.circular(8),
                                        child: Image.network(
                                          evidence,
                                          width: 120,
                                          height: 100,
                                          fit: BoxFit.cover,
                                          errorBuilder: (_, __, ___) =>
                                              const SizedBox(
                                                width: 120,
                                                height: 100,
                                                child: Icon(
                                                  Icons.broken_image_outlined,
                                                ),
                                              ),
                                        ),
                                      ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Conversación',
                        style: TextStyle(fontWeight: FontWeight.bold),
                      ),
                      for (final message in messages)
                        Card(
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${message['remitente_nombre'] ?? 'Participante'} · ${message['creado_at']?.toString().substring(0, 10) ?? ''}',
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w600,
                                    fontSize: 12,
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(message['mensaje']?.toString() ?? ''),
                                Wrap(
                                  spacing: 8,
                                  children: [
                                    for (final image
                                        in (message['evidencia_urls'] as List?)
                                                ?.whereType<String>() ??
                                            const <String>[])
                                      if (image.startsWith('data:image/'))
                                        Padding(
                                          padding: const EdgeInsets.only(
                                            top: 8,
                                          ),
                                          child: Image.memory(
                                            base64Decode(image.split(',').last),
                                            width: 90,
                                            height: 72,
                                            fit: BoxFit.cover,
                                            errorBuilder: (_, __, ___) =>
                                                const Icon(
                                                  Icons.broken_image_outlined,
                                                ),
                                          ),
                                        ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                if (!closed && _evidenceDraft.isNotEmpty)
                  SizedBox(
                    height: 72,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      children: [
                        for (var i = 0; i < _evidenceDraft.length; i++)
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 4),
                            child: Stack(
                              children: [
                                Image.memory(
                                  base64Decode(
                                    _evidenceDraft[i].split(',').last,
                                  ),
                                  width: 64,
                                  height: 64,
                                  fit: BoxFit.cover,
                                ),
                                Positioned(
                                  right: 0,
                                  child: IconButton(
                                    onPressed: () => setState(
                                      () => _evidenceDraft.removeAt(i),
                                    ),
                                    icon: const Icon(Icons.cancel, size: 18),
                                  ),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                if (!closed)
                  SafeArea(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Row(
                        children: [
                          IconButton(
                            onPressed: _sending ? null : _attachEvidence,
                            icon: const Icon(Icons.attach_file),
                            tooltip: 'Adjuntar evidencia',
                          ),
                          Expanded(
                            child: TextField(
                              controller: _message,
                              maxLength: 4000,
                              maxLines: null,
                              decoration: const InputDecoration(
                                hintText: 'Escribe tu respuesta',
                                counterText: '',
                              ),
                            ),
                          ),
                          IconButton(
                            onPressed: _sending ? null : _send,
                            icon: _sending
                                ? const SizedBox(
                                    width: 20,
                                    height: 20,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.send),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (closed)
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text('El caso está cerrado.'),
                  ),
              ],
            ),
    );
  }
}
