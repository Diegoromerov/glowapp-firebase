import 'package:flutter/material.dart';
import 'package:glow_core/core/theme/tokens.dart';
import 'package:glow_core/services/api_service.dart';

class InventarioScreen extends StatefulWidget {
  final int salonId;
  const InventarioScreen({super.key, required this.salonId});

  @override
  State<InventarioScreen> createState() => _InventarioScreenState();
}

class _InventarioScreenState extends State<InventarioScreen> {
  List<Map<String, dynamic>> _items = const [];
  bool _loading = true;
  String? _error;

  String get _base => '/api/salon/${widget.salonId}/inventario';

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
      final response = await ApiService.get(_base);
      if (!mounted) return;
      if (response is Map && response['success'] == true) {
        setState(() {
          _items = (response['items'] as List? ?? const [])
              .whereType<Map>()
              .map((item) => Map<String, dynamic>.from(item))
              .toList();
          _loading = false;
        });
      } else {
        setState(() {
          _error = response is Map ? response['error']?.toString() : null;
          _loading = false;
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'No se pudo cargar el inventario.';
        _loading = false;
      });
    }
  }

  Future<void> _createItem() async {
    final name = TextEditingController();
    final unit = TextEditingController(text: 'UNIDAD');
    final stock = TextEditingController(text: '0');
    final min = TextEditingController(text: '0');
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Agregar al inventario'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: name,
                decoration: const InputDecoration(labelText: 'Nombre'),
              ),
              TextField(
                controller: unit,
                decoration: const InputDecoration(
                  labelText: 'Unidad (ej. ml, unidad)',
                ),
              ),
              TextField(
                controller: stock,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Cantidad inicial',
                ),
              ),
              TextField(
                controller: min,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Avisarme cuando queden',
                ),
              ),
            ],
          ),
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
    );
    if (ok != true) return;
    final response = await ApiService.post(_base, {
      'nombre': name.text.trim(),
      'unidad': unit.text.trim(),
      'stock_inicial': num.tryParse(stock.text) ?? 0,
      'stock_minimo': num.tryParse(min.text) ?? 0,
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

  Future<void> _move(Map<String, dynamic> item) async {
    final amount = TextEditingController();
    final reason = TextEditingController();
    var type = 'ENTRADA';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, update) => AlertDialog(
          title: Text('Movimiento: ${item['nombre']}'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                value: type,
                items: const [
                  DropdownMenuItem(value: 'ENTRADA', child: Text('Entrada')),
                  DropdownMenuItem(value: 'SALIDA', child: Text('Salida')),
                  DropdownMenuItem(
                    value: 'AJUSTE',
                    child: Text('Ajustar cantidad actual'),
                  ),
                ],
                onChanged: (v) => update(() => type = v ?? 'ENTRADA'),
              ),
              TextField(
                controller: amount,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: const InputDecoration(labelText: 'Cantidad'),
              ),
              TextField(
                controller: reason,
                decoration: const InputDecoration(
                  labelText: 'Motivo (opcional)',
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
              child: const Text('Registrar'),
            ),
          ],
        ),
      ),
    );
    if (ok != true) return;
    final key =
        'inv-${widget.salonId}-${DateTime.now().microsecondsSinceEpoch}';
    final response = await ApiService.post('$_base/${item['id']}/movimientos', {
      'tipo': type,
      'cantidad': num.tryParse(amount.text) ?? 0,
      'motivo': reason.text.trim(),
      'idempotency_key': key,
    });
    if (!mounted) return;
    if (response is Map && response['success'] == true) {
      await _load();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            response is Map
                ? (response['error']?.toString() ?? 'No se pudo registrar.')
                : 'No se pudo registrar.',
          ),
        ),
      );
    }
  }

  Future<void> _configureRecipe() async {
    final serviceResponse = await ApiService.get('/api/services/provider');
    final services = serviceResponse is Map
        ? (serviceResponse['data'] as List? ?? const [])
            .whereType<Map>()
            .map((s) => Map<String, dynamic>.from(s))
            .where((s) => s['salon_id'] == widget.salonId)
            .toList()
        : <Map<String, dynamic>>[];
    if (!mounted) return;
    if (services.isEmpty || _items.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Necesitas servicios activos e insumos para configurar el consumo.',
          ),
        ),
      );
      return;
    }

    String serviceId = services.first['id'].toString();
    final initialRecipe = await ApiService.get(
      '$_base/services/$serviceId/inventory',
    );
    if (!mounted) return;
    final List<Map> initialRows = initialRecipe is Map
        ? (initialRecipe['items'] as List? ?? const [])
            .whereType<Map>()
            .toList()
        : <Map>[];
    Map<String, double> selected = {
      for (final row in initialRows)
        row['item_id'].toString(): (row['cantidad'] as num).toDouble(),
    };
    var loadingRecipe = false;

    await showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, update) {
          return AlertDialog(
            title: const Text('Consumo por servicio'),
            content: SizedBox(
              width: 440,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButtonFormField<String>(
                    value: serviceId,
                    isExpanded: true,
                    items: services
                        .map(
                          (s) => DropdownMenuItem(
                            value: s['id'].toString(),
                            child: Text(
                              s['name']?.toString() ?? 'Servicio',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (value) async {
                      if (value == null) return;
                      update(() {
                        serviceId = value;
                        selected = {};
                        loadingRecipe = true;
                      });
                      final response = await ApiService.get(
                        '$_base/services/$value/inventory',
                      );
                      final List<Map> list = response is Map
                          ? (response['items'] as List? ?? const [])
                              .whereType<Map>()
                              .toList()
                          : <Map>[];
                      if (!ctx.mounted) return;
                      update(() {
                        selected = {
                          for (final row in list)
                            row['item_id'].toString():
                                (row['cantidad'] as num).toDouble(),
                        };
                        loadingRecipe = false;
                      });
                    },
                  ),
                  const SizedBox(height: Spacing.md),
                  if (loadingRecipe)
                    const Padding(
                      padding: EdgeInsets.all(Spacing.lg),
                      child: CircularProgressIndicator(),
                    )
                  else
                    Flexible(
                      child: ListView(
                        shrinkWrap: true,
                        children: [
                          for (final item in _items)
                            CheckboxListTile(
                              contentPadding: EdgeInsets.zero,
                              value: selected.containsKey(
                                item['id'].toString(),
                              ),
                              title: Text(item['nombre'].toString()),
                              subtitle: selected
                                      .containsKey(item['id'].toString())
                                  ? TextFormField(
                                      initialValue:
                                          selected[item['id'].toString()]!
                                              .toString(),
                                      keyboardType:
                                          const TextInputType.numberWithOptions(
                                        decimal: true,
                                      ),
                                      decoration: InputDecoration(
                                        labelText:
                                            'Cantidad por servicio (${item['unidad']})',
                                      ),
                                      onChanged: (v) {
                                        final n = double.tryParse(v);
                                        if (n != null) {
                                          selected[item['id'].toString()] = n;
                                        }
                                      },
                                    )
                                  : null,
                              onChanged: (checked) => update(() {
                                final id = item['id'].toString();
                                if (checked == true) {
                                  selected[id] = 1;
                                } else {
                                  selected.remove(id);
                                }
                              }),
                            ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Cancelar'),
              ),
              FilledButton(
                onPressed: loadingRecipe
                    ? null
                    : () async {
                        final response = await ApiService.put(
                          '$_base/services/$serviceId/inventory',
                          {
                            'items': selected.entries
                                .map(
                                  (e) => {
                                    'item_id': e.key,
                                    'cantidad': e.value,
                                  },
                                )
                                .toList(),
                          },
                        );
                        if (!mounted || !ctx.mounted) return;
                        if (response is Map && response['success'] == true) {
                          Navigator.pop(ctx);
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text(
                                'Consumo por servicio actualizado.',
                              ),
                            ),
                          );
                        } else {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text(
                                response is Map
                                    ? (response['error']?.toString() ??
                                        'No se pudo guardar.')
                                    : 'No se pudo guardar.',
                              ),
                            ),
                          );
                        }
                      },
                child: const Text('Guardar'),
              ),
            ],
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = Token.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Inventario'),
        actions: [
          IconButton(
            tooltip: 'Configurar consumo por servicio',
            onPressed: _configureRecipe,
            icon: const Icon(Icons.tune),
          ),
          IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _createItem,
        icon: const Icon(Icons.add),
        label: const Text('Agregar'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!))
              : _items.isEmpty
                  ? const Center(
                      child: Text('Aún no tienes artículos de inventario.'))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(Spacing.lg),
                        itemCount: _items.length,
                        separatorBuilder: (_, __) =>
                            const SizedBox(height: Spacing.sm),
                        itemBuilder: (context, index) {
                          final item = _items[index];
                          final low = item['stock_bajo'] == true;
                          final shortage =
                              (item['faltante_reservas_acumulado'] as num?)
                                      ?.toDouble() ??
                                  0;
                          return Card(
                            child: ListTile(
                              title: Text(
                                  item['nombre']?.toString() ?? 'Artículo'),
                              subtitle: Text(
                                '${item['stock_actual']} ${item['unidad']} disponibles · mínimo ${item['stock_minimo']}${low ? ' · Stock bajo' : ''}${shortage > 0 ? ' · Faltante acumulado por reservas: $shortage ${item['unidad']}' : ''}',
                              ),
                              subtitleTextStyle: TextStyle(
                                color: low ? t.warning : t.textSecondary,
                              ),
                              trailing: IconButton(
                                tooltip: 'Registrar movimiento',
                                onPressed: () => _move(item),
                                icon: const Icon(Icons.swap_vert),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
