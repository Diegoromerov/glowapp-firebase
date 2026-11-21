import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';
import 'package:image_picker/image_picker.dart';

class ClientDisputeDetailScreen extends StatefulWidget {
  final String disputeId;
  const ClientDisputeDetailScreen({super.key, required this.disputeId});

  @override
  State<ClientDisputeDetailScreen> createState() =>
      _ClientDisputeDetailScreenState();
}

class _ClientDisputeDetailScreenState extends State<ClientDisputeDetailScreen> {
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
      final data = await DisputeService.getDisputeById(widget.disputeId);
      if (mounted)
        setState(() {
          _case = data;
          if (data == null) _error = 'No se pudo cargar el expediente.';
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
          disputeId: widget.disputeId,
          message: text,
          evidenceUrls: _evidenceDraft);
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
          const SnackBar(content: Text('Puedes adjuntar máximo 5 imágenes.')));
      return;
    }
    try {
      final XFile? file = await _picker.pickImage(
          source: ImageSource.gallery,
          maxWidth: 1000,
          maxHeight: 1000,
          imageQuality: 80);
      if (file == null) return;
      final Uint8List bytes = await file.readAsBytes();
      if (bytes.length > 1500000 ||
          _evidenceDraft.fold<int>(
                      0,
                      (sum, item) =>
                          sum + base64Decode(item.split(',').last).length) +
                  bytes.length >
              7500000) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Máximo 1,5 MB por imagen y 7,5 MB en total.')));
        return;
      }
      final ext = file.name.toLowerCase().split('.').last;
      final mime = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'webp': 'image/webp'
      }[ext];
      if (mime == null) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Formato no admitido. Usa JPG, PNG o WebP.')));
        return;
      }
      setState(
          () => _evidenceDraft.add('data:$mime;base64,${base64Encode(bytes)}'));
    } catch (e) {
      if (mounted)
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(mensajeHumano(e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = (_case?['mensajes'] as List?)
            ?.whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList() ??
        [];
    final evidence =
        (_case?['evidencia_urls'] as List?)?.whereType<String>().toList() ?? [];
    final closed =
        ['RESUELTA', 'CERRADA'].contains(_case?['estado']?.toString());
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
          title: const Text('Detalle de la disputa'),
          backgroundColor: const Color(0xFFFAF8F5),
          foregroundColor: const Color(0xFF1F1A15)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!))
              : Column(children: [
                  Expanded(
                      child: ListView(
                          padding: const EdgeInsets.all(16),
                          children: [
                        Card(
                            child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                          '${_case?['estado'] ?? 'ABIERTA'} · ${_case?['tipo'] ?? ''}',
                                          style: const TextStyle(
                                              fontWeight: FontWeight.bold)),
                                      const SizedBox(height: 8),
                                      Text(
                                          'Cita #${_case?['booking_number'] ?? '—'} · ${_case?['servicio_nombre'] ?? 'Servicio'}'),
                                      const SizedBox(height: 12),
                                      Text(_case?['descripcion']?.toString() ??
                                          ''),
                                      const SizedBox(height: 14),
                                      const Text('Evidencias',
                                          style: TextStyle(
                                              fontWeight: FontWeight.w600)),
                                      const SizedBox(height: 8),
                                      if (evidence.isEmpty)
                                        const Text(
                                            'No se adjuntaron evidencias.'),
                                      Wrap(
                                          spacing: 8,
                                          runSpacing: 8,
                                          children: [
                                            for (final item in evidence)
                                              if (item
                                                  .startsWith('data:image/'))
                                                ClipRRect(
                                                  borderRadius:
                                                      BorderRadius.circular(8),
                                                  child: Image.memory(
                                                      base64Decode(
                                                          item.split(',').last),
                                                      width: 120,
                                                      height: 100,
                                                      fit: BoxFit.cover,
                                                      errorBuilder: (_, __,
                                                              ___) =>
                                                          const SizedBox(
                                                              width: 120,
                                                              height: 100,
                                                              child: Icon(Icons
                                                                  .broken_image_outlined))),
                                                )
                                              else if (item
                                                      .startsWith('https://') ||
                                                  item.startsWith('http://'))
                                                ClipRRect(
                                                  borderRadius:
                                                      BorderRadius.circular(8),
                                                  child: Image.network(item,
                                                      width: 120,
                                                      height: 100,
                                                      fit: BoxFit.cover,
                                                      errorBuilder: (_, __,
                                                              ___) =>
                                                          const SizedBox(
                                                              width: 120,
                                                              height: 100,
                                                              child: Icon(Icons
                                                                  .broken_image_outlined))),
                                                ),
                                          ]),
                                      if (_case?['nota_resolucion']
                                              ?.toString()
                                              .isNotEmpty ==
                                          true) ...[
                                        const SizedBox(height: 12),
                                        const Text('Decisión del equipo',
                                            style: TextStyle(
                                                fontWeight: FontWeight.w600)),
                                        Text(_case!['nota_resolucion']
                                            .toString()),
                                      ],
                                      if ((_case?['reembolso_estado']
                                                  ?.toString() ??
                                              '')
                                          .isNotEmpty) ...[
                                        const SizedBox(height: 8),
                                        Text(
                                            'Estado del reembolso: ${_case?['reembolso_estado']}'),
                                      ],
                                    ]))),
                        const SizedBox(height: 8),
                        const Text('Conversación',
                            style: TextStyle(fontWeight: FontWeight.bold)),
                        for (final item in messages)
                          Card(
                              child: Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                            '${item['remitente_nombre'] ?? 'Participante'} · ${item['creado_at']?.toString().substring(0, 10) ?? ''}',
                                            style: const TextStyle(
                                                fontWeight: FontWeight.w600,
                                                fontSize: 12)),
                                        const SizedBox(height: 6),
                                        Text(item['mensaje']?.toString() ?? ''),
                                        Wrap(spacing: 8, children: [
                                          for (final image
                                              in (item['evidencia_urls'] as List?)
                                                      ?.whereType<String>() ??
                                                  const <String>[])
                                            if (image.startsWith('data:image/'))
                                              Padding(
                                                  padding:
                                                      const EdgeInsets.only(
                                                          top: 8),
                                                  child: Image.memory(
                                                      base64Decode(image
                                                          .split(',')
                                                          .last),
                                                      width: 90,
                                                      height: 72,
                                                      fit: BoxFit.cover,
                                                      errorBuilder: (_, __, ___) =>
                                                          const Icon(Icons
                                                              .broken_image_outlined))),
                                        ]),
                                      ]))),
                      ])),
                  if (!closed && _evidenceDraft.isNotEmpty)
                    SizedBox(
                        height: 72,
                        child: ListView(
                            scrollDirection: Axis.horizontal,
                            children: [
                              for (var i = 0; i < _evidenceDraft.length; i++)
                                Padding(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 4),
                                    child: Stack(children: [
                                      Image.memory(
                                          base64Decode(_evidenceDraft[i]
                                              .split(',')
                                              .last),
                                          width: 64,
                                          height: 64,
                                          fit: BoxFit.cover),
                                      Positioned(
                                          right: 0,
                                          child: IconButton(
                                              onPressed: () => setState(() =>
                                                  _evidenceDraft.removeAt(i)),
                                              icon: const Icon(Icons.cancel,
                                                  size: 18))),
                                    ])),
                            ])),
                  if (!closed)
                    SafeArea(
                        child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Row(children: [
                              IconButton(
                                  onPressed: _sending ? null : _attachEvidence,
                                  icon: const Icon(Icons.attach_file),
                                  tooltip: 'Adjuntar evidencia'),
                              Expanded(
                                  child: TextField(
                                      controller: _message,
                                      maxLength: 4000,
                                      maxLines: null,
                                      decoration: const InputDecoration(
                                          hintText: 'Escribe tu respuesta',
                                          counterText: ''))),
                              IconButton(
                                  onPressed: _sending ? null : _send,
                                  icon: _sending
                                      ? const SizedBox(
                                          width: 20,
                                          height: 20,
                                          child: CircularProgressIndicator(
                                              strokeWidth: 2))
                                      : const Icon(Icons.send)),
                            ]))),
                  if (closed)
                    const Padding(
                        padding: EdgeInsets.all(16),
                        child: Text('El caso está cerrado.')),
                ]),
    );
  }
}
