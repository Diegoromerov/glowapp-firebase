import 'package:flutter/material.dart';
import 'package:glow_core/core/theme/tokens.dart';
import 'package:glow_core/services/api_service.dart';

class RecursosScreen extends StatefulWidget {
  final int salonId;
  const RecursosScreen({super.key, required this.salonId});

  @override
  State<RecursosScreen> createState() => _RecursosScreenState();
}

class _RecursosScreenState extends State<RecursosScreen> {
  List<Map<String, dynamic>> _items = const [];
  bool _loading = true;
  String? _error;
  String get _base => '/api/salon/${widget.salonId}';

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
      final response = await ApiService.get('$_base/recursos');
      if (!mounted) return;
      if (response is Map && response['success'] == true) {
        setState(() {
          _items = (response['items'] as List? ?? const [])
              .whereType<Map>()
              .map((x) => Map<String, dynamic>.from(x))
              .toList();
          _loading = false;
        });
      } else {
        setState(() {
          _error = response is Map
              ? response['error']?.toString()
              : 'No se pudieron cargar los recursos.';
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted)
        setState(() {
          _error = 'No se pudieron cargar los recursos.';
          _loading = false;
        });
    }
  }

  Future<void> _crear() async {
    final name = TextEditingController();
    final rent = TextEditingController(text: '0');
    var type = 'PUESTO';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, update) => AlertDialog(
          title: const Text('Agregar recurso'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: name,
                decoration: const InputDecoration(labelText: 'Nombre'),
              ),
              DropdownButtonFormField<String>(
                value: type,
                items: const [
                  DropdownMenuItem(value: 'SILLA', child: Text('Silla')),
                  DropdownMenuItem(value: 'MESA', child: Text('Mesa')),
                  DropdownMenuItem(value: 'PUESTO', child: Text('Puesto')),
                  DropdownMenuItem(value: 'CABINA', child: Text('Cabina')),
                  DropdownMenuItem(value: 'OTRO', child: Text('Otro')),
                ],
                onChanged: (v) => update(() => type = v ?? 'PUESTO'),
              ),
              TextField(
                controller: rent,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Canon mensual (COP)',
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Guardar'),
            ),
          ],
        ),
      ),
    );
    if (ok != true) return;
    final response = await ApiService.post('$_base/recursos', {
      'nombre': name.text.trim(),
      'tipo': type,
      'canon_mensual': num.tryParse(rent.text) ?? 0,
    });
    if (!mounted) return;
    if (response is Map && response['success'] == true) {
      await _load();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            response is Map
                ? (response['error']?.toString() ?? 'No se pudo guardar.')
                : 'No se pudo guardar.',
          ),
        ),
      );
    }
  }

  Future<void> _rent(Map<String, dynamic> item) async {
    final person = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Asignar ${item['nombre']}'),
        content: TextField(
          controller: person,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(
            labelText: 'ID de la persona responsable',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Asignar'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    final response = await ApiService.post('$_base/alquileres', {
      'recurso_id': item['id'],
      'persona_id': int.tryParse(person.text),
    });
    if (!mounted) return;
    if (response is Map && response['success'] == true) {
      await _load();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            response is Map
                ? (response['error']?.toString() ?? 'No se pudo asignar.')
                : 'No se pudo asignar.',
          ),
        ),
      );
    }
  }

  Future<void> _release(Map<String, dynamic> item) async {
    final id = item['alquiler_id'];
    if (id == null) {
      // El listado de recursos incluye la persona pero no el ID del alquiler;
      // la lista de alquileres permite resolver el registro activo.
      final response = await ApiService.get('$_base/alquileres');
      final active = response is Map
          ? (response['items'] as List? ?? const [])
              .whereType<Map>()
              .where(
                (a) => a['recurso_id'] == item['id'] && a['estado'] == 'ACTIVO',
              )
              .toList()
          : const [];
      if (active.isEmpty || !mounted) return;
      await _finish(active.first['id']);
      return;
    }
    await _finish(id);
  }

  Future<void> _finish(dynamic id) async {
    await ApiService.patch('$_base/alquileres/$id/finalizar', {});
    if (mounted) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final t = Token.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Recursos alquilables'),
        actions: [
          IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _crear,
        icon: const Icon(Icons.add),
        label: const Text('Agregar'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!))
              : _items.isEmpty
                  ? const Center(
                      child: Text('Aún no tienes recursos registrados.'))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(Spacing.lg),
                        itemCount: _items.length,
                        separatorBuilder: (_, __) =>
                            const SizedBox(height: Spacing.sm),
                        itemBuilder: (context, index) {
                          final item = _items[index];
                          final ocupado = item['estado'] == 'OCUPADO';
                          return Card(
                            child: ListTile(
                              title:
                                  Text(item['nombre']?.toString() ?? 'Recurso'),
                              subtitle: Text(
                                '${item['tipo']} · ${ocupado ? 'Asignado a ${item['persona_id']}' : 'Disponible'} · \$${item['canon_mensual']} COP/mes',
                              ),
                              subtitleTextStyle: TextStyle(
                                color: ocupado ? t.textSecondary : t.success,
                              ),
                              trailing: TextButton(
                                onPressed: () =>
                                    ocupado ? _release(item) : _rent(item),
                                child: Text(ocupado ? 'Liberar' : 'Asignar'),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
