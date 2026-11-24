import 'package:flutter/material.dart';
import 'package:glow_core/services/auth_service.dart';

class SalonBusinessProfileScreen extends StatefulWidget {
  final int salonId;
  final VoidCallback onOpenServices;

  const SalonBusinessProfileScreen({
    super.key,
    required this.salonId,
    required this.onOpenServices,
  });

  @override
  State<SalonBusinessProfileScreen> createState() =>
      _SalonBusinessProfileScreenState();
}

class _SalonBusinessProfileScreenState
    extends State<SalonBusinessProfileScreen> {
  static const _days = <String, String>{
    'lunes': 'Lunes',
    'martes': 'Martes',
    'miercoles': 'Miércoles',
    'jueves': 'Jueves',
    'viernes': 'Viernes',
    'sabado': 'Sábado',
    'domingo': 'Domingo',
  };

  final _name = TextEditingController();
  final _nit = TextEditingController();
  final _address = TextEditingController();
  final _phone = TextEditingController();
  final _city = TextEditingController();
  final Map<String, Map<String, dynamic>> _hours = {};
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    for (final day in _days.keys) {
      _hours[day] = {'open': false, 'start': '09:00', 'end': '18:00'};
    }
    _load();
  }

  @override
  void dispose() {
    _name.dispose();
    _nit.dispose();
    _address.dispose();
    _phone.dispose();
    _city.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final response = await AuthService.getSalonProfile(widget.salonId);
      final salon = response?['salon'];
      if (salon is! Map)
        throw StateError('No encontramos los datos del salón.');
      _name.text = (salon['nombre_salon'] ?? '').toString();
      _nit.text = (salon['nit'] ?? '').toString();
      _address.text = (salon['direccion'] ?? '').toString();
      _phone.text = (salon['telefono'] ?? '').toString();
      _city.text = (salon['ciudad'] ?? '').toString();
      final schedule = salon['horario_atencion'];
      if (schedule is Map) {
        for (final day in _days.keys) {
          final item = schedule[day];
          if (item is Map) {
            _hours[day] = {
              'open': item['open'] == true,
              'start': (item['start'] ?? '09:00').toString(),
              'end': (item['end'] ?? '18:00').toString(),
            };
          }
        }
      }
    } catch (error) {
      _error = error.toString().replaceFirst('Bad state: ', '');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickTime(String day, String field) async {
    final current = (_hours[day]![field] as String).split(':');
    final selected = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(
        hour: int.tryParse(current.first) ?? 9,
        minute: int.tryParse(current.last) ?? 0,
      ),
    );
    if (selected == null || !mounted) return;
    setState(() {
      _hours[day]![field] =
          '${selected.hour.toString().padLeft(2, '0')}:${selected.minute.toString().padLeft(2, '0')}';
    });
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'El nombre del salón es obligatorio.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final result = await AuthService.updateSalonProfile(
        salonId: widget.salonId,
        changes: {
          'nombre_salon': _name.text.trim(),
          'nit': _nit.text.trim(),
          'direccion': _address.text.trim(),
          'telefono': _phone.text.trim(),
          'ciudad': _city.text.trim(),
          'horario_atencion': _hours,
        },
      );
      if (result?['success'] != true) {
        throw StateError(
            (result?['error'] ?? 'No pudimos guardar los cambios.').toString());
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Datos del salón actualizados.')),
      );
    } catch (error) {
      if (mounted)
        setState(
            () => _error = error.toString().replaceFirst('Bad state: ', ''));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  InputDecoration _decoration(String label, IconData icon) => InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon),
        border: const OutlineInputBorder(),
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Datos y horario del salón')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                const Text(
                  'Puedes completar o corregir estos datos cuando quieras. El horario general describe la apertura de la sede; cada profesional conserva su propia disponibilidad en la agenda.',
                ),
                const SizedBox(height: 20),
                TextField(
                    controller: _name,
                    decoration:
                        _decoration('Nombre del salón', Icons.store_outlined)),
                const SizedBox(height: 12),
                TextField(
                    controller: _nit,
                    decoration: _decoration(
                        'NIT o documento tributario', Icons.badge_outlined)),
                const SizedBox(height: 12),
                TextField(
                    controller: _city,
                    decoration: _decoration(
                        'Ciudad o municipio', Icons.location_city_outlined)),
                const SizedBox(height: 12),
                TextField(
                    controller: _address,
                    decoration: _decoration('Dirección', Icons.place_outlined)),
                const SizedBox(height: 12),
                TextField(
                    controller: _phone,
                    keyboardType: TextInputType.phone,
                    decoration: _decoration('Teléfono', Icons.phone_outlined)),
                const SizedBox(height: 24),
                Text('Horario de apertura',
                    style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                ..._days.entries.map((entry) {
                  final day = entry.key;
                  final hours = _hours[day]!;
                  return Card(
                    child: Column(
                      children: [
                        SwitchListTile(
                          title: Text(entry.value),
                          value: hours['open'] == true,
                          onChanged: (value) =>
                              setState(() => hours['open'] = value),
                        ),
                        if (hours['open'] == true)
                          Padding(
                            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                            child: Row(
                              children: [
                                Expanded(
                                    child: OutlinedButton(
                                        onPressed: () =>
                                            _pickTime(day, 'start'),
                                        child: Text('Abre ${hours['start']}'))),
                                const SizedBox(width: 10),
                                Expanded(
                                    child: OutlinedButton(
                                        onPressed: () => _pickTime(day, 'end'),
                                        child: Text('Cierra ${hours['end']}'))),
                              ],
                            ),
                          ),
                      ],
                    ),
                  );
                }),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: widget.onOpenServices,
                  icon: const Icon(Icons.content_cut_outlined),
                  label: const Text('Configurar los servicios iniciales'),
                ),
                const SizedBox(height: 8),
                const Text(
                    'Los servicios se guardan en el catálogo del salón y puedes editarlos desde la pestaña Servicios.'),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!,
                      style: TextStyle(
                          color: Theme.of(context).colorScheme.error)),
                ],
                const SizedBox(height: 20),
                FilledButton.icon(
                  onPressed: _saving ? null : _save,
                  icon: _saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.save_outlined),
                  label:
                      Text(_saving ? 'Guardando…' : 'Guardar datos y horario'),
                ),
              ],
            ),
    );
  }
}

