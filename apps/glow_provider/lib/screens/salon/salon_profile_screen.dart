import 'package:flutter/material.dart';
import 'package:glow_core/services/auth_service.dart';
import 'package:glow_core/services/saas_api_service.dart';

import 'salon_business_hours_editor.dart';

class SalonProfileScreen extends StatefulWidget {
  const SalonProfileScreen({super.key});

  @override
  State<SalonProfileScreen> createState() => _SalonProfileScreenState();
}

class _SalonProfileScreenState extends State<SalonProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _nit = TextEditingController();
  final _address = TextEditingController();
  final _city = TextEditingController();
  final _phone = TextEditingController();

  int? _salonId;
  Map<String, dynamic>? _hours;
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _name.dispose();
    _nit.dispose();
    _address.dispose();
    _city.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final salonResult = await AuthService.getMySalon();
      final rawSalon = salonResult?['salon'];
      final id = rawSalon is Map ? (rawSalon['id'] as num?)?.toInt() : null;
      if (id == null) throw StateError('No encontramos una sede vinculada.');

      final salon = await SaasApiService.getSalonProfile(id);
      _salonId = id;
      _name.text = (salon['nombre_salon'] ?? '').toString();
      _nit.text = (salon['nit'] ?? '').toString();
      _address.text = (salon['direccion'] ?? '').toString();
      _city.text = (salon['ciudad'] ?? '').toString();
      _phone.text = (salon['telefono'] ?? '').toString();
      final rawHours = salon['horario_atencion'];
      _hours = rawHours is Map ? Map<String, dynamic>.from(rawHours) : null;
    } catch (error) {
      _error = error.toString().replaceFirst('Exception: ', '');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final salonId = _salonId;
    if (salonId == null) return;

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await SaasApiService.updateSalonProfile(salonId, {
        'nombre_salon': _name.text.trim(),
        'nit': _nit.text.trim(),
        'direccion': _address.text.trim(),
        'ciudad': _city.text.trim(),
        'telefono': _phone.text.trim(),
        'horario_atencion': _hours,
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Perfil del salón actualizado.')),
      );
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error.toString().replaceFirst('Exception: ', ''),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Perfil del salón')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  Text(
                    'Información del establecimiento',
                    style: theme.textTheme.titleLarge,
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Mantén actualizados los datos de tu sede. Estos cambios no crean otro salón.',
                    style: theme.textTheme.bodyMedium,
                  ),
                  const SizedBox(height: 20),
                  Form(
                    key: _formKey,
                    child: Column(
                      children: [
                        _field(_name, 'Nombre del salón', required: true),
                        _field(_nit, 'NIT o documento tributario'),
                        _field(_city, 'Ciudad o municipio'),
                        _field(_address, 'Dirección'),
                        _field(
                          _phone,
                          'Teléfono',
                          keyboardType: TextInputType.phone,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  SalonBusinessHoursEditor(
                    key: ValueKey('salon-hours-$_salonId'),
                    initialValue: _hours,
                    onChanged: (value) => _hours = value,
                    title: 'Horario comercial',
                    description: 'Este horario corresponde a la sede. La disponibilidad de cada profesional se administra en Agenda.',
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 16),
                    Text(
                      _error!,
                      style: TextStyle(color: theme.colorScheme.error),
                    ),
                  ],
                  const SizedBox(height: 24),
                  FilledButton.icon(
                    onPressed: _saving ? null : _save,
                    icon: _saving
                        ? const SizedBox.square(
                            dimension: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.save_outlined),
                    label: Text(_saving ? 'Guardando…' : 'Guardar cambios'),
                  ),
                  const SizedBox(height: 16),
                ],
              ),
            ),
    );
  }

  Widget _field(
    TextEditingController controller,
    String label, {
    bool required = false,
    TextInputType? keyboardType,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      textCapitalization: TextCapitalization.sentences,
      decoration: InputDecoration(
        labelText: label,
        border: const OutlineInputBorder(),
      ),
      validator: required
          ? (value) => value == null || value.trim().isEmpty
                ? 'Ingresa el nombre del salón.'
                : null
          : null,
    ),
  );
}
