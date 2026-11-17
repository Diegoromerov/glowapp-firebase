import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';

class ProviderReturnsScreen extends StatefulWidget {
  const ProviderReturnsScreen({super.key});

  @override
  State<ProviderReturnsScreen> createState() => _ProviderReturnsScreenState();
}

class _ProviderReturnsScreenState extends State<ProviderReturnsScreen> {
  List<Map<String, dynamic>> _returns = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final response = await ApiService.get('/provider/returns');
      if (!mounted) return;
      if (response == null || response['success'] != true) throw Exception(response?['error'] ?? 'No se pudieron cargar las devoluciones');
      final rows = (response['data'] as List?) ?? const [];
      setState(() { _returns = rows.map((e) => Map<String, dynamic>.from(e as Map)).toList(); _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _error = mensajeHumano(e); _loading = false; });
    }
  }

  Future<void> _post(String path, Map<String, dynamic> body) async {
    try {
      final response = await ApiService.post(path, body);
      if (response == null || response['success'] != true) throw Exception(response?['error'] ?? 'La operación no se completó');
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Devolución actualizada')));
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(mensajeHumano(e))));
    }
  }

  Future<void> _reject(String id) async {
    final controller = TextEditingController();
    final confirmed = await showDialog<bool>(context: context, builder: (ctx) => AlertDialog(
      title: const Text('Rechazar devolución'),
      content: TextField(controller: controller, maxLines: 3, decoration: const InputDecoration(labelText: 'Motivo (mínimo 10 caracteres)')),
      actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')), FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Rechazar'))],
    ));
    if (confirmed == true && controller.text.trim().length >= 10) await _post('/provider/returns/$id/reject', {'motivo_rechazo': controller.text.trim()});
    controller.dispose();
  }

  Future<void> _receive(String id, Map<String, dynamic> row) async {
    final notes = TextEditingController();
    var result = 'aprobada';
    final confirmed = await showDialog<bool>(context: context, builder: (ctx) => StatefulBuilder(builder: (ctx, setDialogState) => AlertDialog(
      title: const Text('Inspeccionar producto'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        DropdownButtonFormField<String>(value: result, items: const [
          DropdownMenuItem(value: 'aprobada', child: Text('Cumple condiciones')),
          DropdownMenuItem(value: 'parcial', child: Text('Aprobación parcial')),
          DropdownMenuItem(value: 'rechazada', child: Text('No cumple condiciones')),
        ], onChanged: (v) => setDialogState(() => result = v ?? 'aprobada')),
        TextField(controller: notes, maxLines: 3, decoration: const InputDecoration(labelText: 'Notas de inspección')),
      ]),
      actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')), FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Guardar inspección'))],
    )));
    if (confirmed == true) await _post('/provider/returns/$id/receive', {'inspeccion_estado': result, 'notas': notes.text.trim(), 'fotos': <String>[]});
    notes.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Devoluciones'), actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh))]),
      body: _loading ? const Center(child: CircularProgressIndicator()) : _error != null
          ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [Text(_error!), ElevatedButton(onPressed: _load, child: const Text('Reintentar'))]))
          : _returns.isEmpty ? const Center(child: Text('No hay devoluciones pendientes'))
          : RefreshIndicator(onRefresh: _load, child: ListView.builder(
              padding: const EdgeInsets.all(16), itemCount: _returns.length,
              itemBuilder: (context, index) {
                final row = _returns[index];
                final id = row['id'].toString();
                final status = (row['estado'] ?? '').toString();
                final items = row['items'] is String ? <dynamic>[] : (row['items'] as List?) ?? const [];
                return Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Pedido #${(row['pedido_id'] ?? '').toString().split('-').first} · $status', style: Theme.of(context).textTheme.titleMedium),
                  Text('Cliente: ${row['cliente_nombre'] ?? 'Cliente'}'),
                  Text('Motivo: ${row['motivo'] ?? '—'}'),
                  if ((row['descripcion'] ?? '').toString().isNotEmpty) Text(row['descripcion'].toString()),
                  if (items.isNotEmpty) Text('Ítems: ${items.length}'),
                  if (row['guia_retorno'] != null) Text('Guía de retorno: ${row['guia_retorno']}'),
                  if (row['reembolso_estado'] != null) Text('Reembolso: ${row['reembolso_estado']} (pendiente de conciliación)'),
                  const SizedBox(height: 8),
                  Wrap(spacing: 8, children: [
                    if (status == 'SOLICITADA') ElevatedButton(onPressed: () => _post('/provider/returns/$id/approve', {}), child: const Text('Aprobar y generar guía')),
                    if (status == 'SOLICITADA') OutlinedButton(onPressed: () => _reject(id), child: const Text('Rechazar')),
                    if (status == 'ETIQUETA_GENERADA' || status == 'ENVIADA' || status == 'EN_TRANSITO_RETORNO')
                      ElevatedButton(onPressed: () => _receive(id, row), child: const Text('Registrar recepción')),
                  ]),
                ])));
              },
            )),
    );
  }
}
