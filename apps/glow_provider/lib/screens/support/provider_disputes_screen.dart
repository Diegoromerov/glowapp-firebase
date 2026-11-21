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
        backgroundColor: const Color(0xFFFAF8F5),
        foregroundColor: const Color(0xFF1F1A15),
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
                itemCount: _cases.length,
                itemBuilder: (context, index) {
                  final item = _cases[index];
                  final id = item['id']?.toString() ?? '';
                  final state = item['estado']?.toString() ?? 'ABIERTA';
                  return Card(
                    child: ListTile(
                      title: Text(
                        item['servicio_nombre']?.toString() ??
                            'Disputa de servicio',
                      ),
                      subtitle: Text(
                        '${item['tipo'] ?? 'Caso'} · $state\nCita #${item['booking_number'] ?? '—'}',
                        maxLines: 2,
                      ),
                      isThreeLine: true,
                      trailing: const Icon(Icons.chevron_right),
                      onTap: id.isEmpty
                          ? null
                          : () async {
                              await Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (_) =>
                                      _ProviderDisputeDetail(id: id),
                                ),
                              );
                              if (mounted) _load();
                            },
                    ),
                  );
                },
              ),
            ),
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
