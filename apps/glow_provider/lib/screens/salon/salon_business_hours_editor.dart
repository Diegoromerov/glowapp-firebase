import 'package:flutter/material.dart';

/// Editor compacto del horario comercial de una sede.
///
/// El JSON emitido coincide con `salones.horario_atencion`; los días sin
/// apertura se representan con `{open: false}` y las horas usan formato 24 h.
class SalonBusinessHoursEditor extends StatefulWidget {
  const SalonBusinessHoursEditor({
    super.key,
    this.initialValue,
    required this.onChanged,
    this.title = 'Horario de atención',
    this.description = 'Configura el horario general del salón. Es opcional.',
  });

  final Map<String, dynamic>? initialValue;
  final ValueChanged<Map<String, dynamic>?> onChanged;
  final String title;
  final String description;

  @override
  State<SalonBusinessHoursEditor> createState() =>
      _SalonBusinessHoursEditorState();
}

class _SalonBusinessHoursEditorState extends State<SalonBusinessHoursEditor> {
  static const _days = <(String, String)>[
    ('lunes', 'Lunes'),
    ('martes', 'Martes'),
    ('miercoles', 'Miércoles'),
    ('jueves', 'Jueves'),
    ('viernes', 'Viernes'),
    ('sabado', 'Sábado'),
    ('domingo', 'Domingo'),
  ];

  late final Map<String, Map<String, dynamic>> _hours = _readInitial();

  Map<String, Map<String, dynamic>> _readInitial() {
    final result = <String, Map<String, dynamic>>{};
    for (final (key, _) in _days) {
      final raw = widget.initialValue?[key];
      if (raw is Map) {
        result[key] = Map<String, dynamic>.from(raw);
      } else {
        result[key] = {'open': false};
      }
    }
    return result;
  }

  void _emit() {
    final enabled = <String, dynamic>{
      for (final (key, _) in _days)
        if (_hours[key]?['open'] == true) key: _hours[key]!,
    };
    widget.onChanged(enabled.isEmpty ? null : enabled);
  }

  Future<void> _pickTime(String day, String field) async {
    final current =
        (_hours[day]?[field] as String?) ??
        (field == 'start' ? '09:00' : '18:00');
    final parts = current.split(':');
    final initial = TimeOfDay(
      hour: int.tryParse(parts.first) ?? 9,
      minute: int.tryParse(parts.last) ?? 0,
    );
    final picked = await showTimePicker(
      context: context,
      initialTime: initial,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(alwaysUse24HourFormat: true),
        child: child ?? const SizedBox.shrink(),
      ),
    );
    if (picked == null || !mounted) return;
    final value =
        '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}';
    setState(() {
      _hours[day] = {..._hours[day]!, 'open': true, field: value};
    });
    _emit();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(widget.title, style: theme.textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(widget.description, style: theme.textTheme.bodySmall),
        const SizedBox(height: 8),
        for (final (key, label) in _days) _buildDay(context, key, label),
      ],
    );
  }

  Widget _buildDay(BuildContext context, String key, String label) {
    final theme = Theme.of(context);
    final open = _hours[key]?['open'] == true;
    final start = (_hours[key]?['start'] as String?) ?? '09:00';
    final end = (_hours[key]?['end'] as String?) ?? '18:00';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(child: Text(label, style: theme.textTheme.bodyMedium)),
              Text(
                open ? 'Abierto' : 'Cerrado',
                style: theme.textTheme.bodySmall,
              ),
              Switch.adaptive(
                value: open,
                onChanged: (value) {
                  setState(() {
                    _hours[key] = value
                        ? {'open': true, 'start': start, 'end': end}
                        : {'open': false};
                  });
                  _emit();
                },
              ),
            ],
          ),
          if (open)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _pickTime(key, 'start'),
                      icon: const Icon(Icons.login, size: 16),
                      label: Text('Abre $start'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _pickTime(key, 'end'),
                      icon: const Icon(Icons.logout, size: 16),
                      label: Text('Cierra $end'),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
