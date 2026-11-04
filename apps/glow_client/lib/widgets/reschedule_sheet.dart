// Reprogramación de una cita: elegir día y franja del propio prestador.
//
// El botón anterior solo mostraba un aviso y abría el perfil: nunca reprogramaba
// nada. Aquí se piden los huecos reales del prestador y se aplica el cambio, que
// el backend limita a una sola vez por cita (D-GL-023).
import 'package:flutter/material.dart';
import 'package:glow_core/services.dart';

typedef CargarSlots = Future<List<Map<String, dynamic>>> Function(String fecha);
typedef AplicarCambio = Future<void> Function(String scheduledAtIso);

Future<bool?> showRescheduleSheet(
  BuildContext context, {
  required String bookingId,
  required String providerId,
  required String serviceId,
  CargarSlots? cargarSlots,
  AplicarCambio? aplicar,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _RescheduleSheet(
      bookingId: bookingId,
      providerId: providerId,
      serviceId: serviceId,
      cargarSlots: cargarSlots,
      aplicar: aplicar,
    ),
  );
}

class _RescheduleSheet extends StatefulWidget {
  final String bookingId;
  final String providerId;
  final String serviceId;
  final CargarSlots? cargarSlots;
  final AplicarCambio? aplicar;

  const _RescheduleSheet({
    required this.bookingId,
    required this.providerId,
    required this.serviceId,
    this.cargarSlots,
    this.aplicar,
  });

  @override
  State<_RescheduleSheet> createState() => _RescheduleSheetState();
}

class _RescheduleSheetState extends State<_RescheduleSheet> {
  late final List<DateTime> _dias;
  DateTime? _dia;
  String? _hora;
  List<Map<String, dynamic>> _slots = const [];
  bool _cargando = false;
  bool _aplicando = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final hoy = DateTime.now();
    // Dos semanas hacia delante: suficiente para encontrar hueco sin convertir
    // esto en un calendario completo.
    _dias = List.generate(14, (i) {
      final d = DateTime(hoy.year, hoy.month, hoy.day).add(Duration(days: i));
      return d;
    });
  }

  String _fechaApi(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<void> _elegirDia(DateTime dia) async {
    setState(() {
      _dia = dia;
      _hora = null;
      _slots = const [];
      _cargando = true;
      _error = null;
    });
    try {
      final cargar = widget.cargarSlots ??
          (String fecha) => ApiService.fetchAvailableSlots(
                providerId: widget.providerId,
                date: fecha,
                serviceId: widget.serviceId,
              );
      final slots = await cargar(_fechaApi(dia));
      if (!mounted) return;
      setState(() {
        _slots = slots;
        _cargando = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _cargando = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _confirmar() async {
    final dia = _dia;
    final hora = _hora;
    if (dia == null || hora == null || _aplicando) return;

    final partes = hora.split(':');
    final fecha = DateTime(dia.year, dia.month, dia.day,
        int.parse(partes[0]), int.parse(partes[1]));

    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() {
      _aplicando = true;
      _error = null;
    });
    try {
      final aplicar = widget.aplicar ??
          (String iso) => ApiService.rescheduleBooking(widget.bookingId, iso);
      await aplicar(fecha.toUtc().toIso8601String());
      if (!mounted) return;
      navigator.pop(true);
      messenger.showSnackBar(const SnackBar(
        content: Text('Cita reprogramada. Te avisaremos un día antes.'),
      ));
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _aplicando = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Widget _chipDia(DateTime d) {
    final activo = _dia?.day == d.day && _dia?.month == d.month;
    const dias = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
    return GestureDetector(
      onTap: () => _elegirDia(d),
      child: Container(
        width: 62,
        margin: const EdgeInsets.only(right: 8),
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: activo ? const Color(0xFFC5A052) : const Color(0xFFF4EFEA),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
              color: activo ? const Color(0xFFC5A052) : const Color(0xFFE0D8CE)),
        ),
        child: Column(
          children: [
            Text(dias[d.weekday - 1],
                style: TextStyle(
                    fontSize: 11,
                    color: activo ? Colors.white : const Color(0xFF8A7F72))),
            const SizedBox(height: 2),
            Text('${d.day}',
                style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.bold,
                    color: activo ? Colors.white : const Color(0xFF1F1A15))),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final disponibles = _slots.where((s) => s['is_available'] == true).toList();

    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                margin: const EdgeInsets.only(bottom: 18),
                decoration: BoxDecoration(
                    color: const Color(0xFFE0D8CE),
                    borderRadius: BorderRadius.circular(2)),
              ),
            ),
            const Text('Reprogramar cita',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            const Text('Solo puedes cambiarla una vez.',
                style: TextStyle(fontSize: 12, color: Color(0xFF8A7F72))),
            const SizedBox(height: 16),
            SizedBox(
              height: 70,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: _dias.map(_chipDia).toList(),
              ),
            ),
            const SizedBox(height: 18),
            if (_cargando)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
              )
            else if (_dia == null)
              const Text('Elige un día para ver los horarios.',
                  style: TextStyle(fontSize: 13, color: Color(0xFF8A7F72)))
            else if (disponibles.isEmpty)
              const Text('No hay horarios libres ese día. Prueba otro.',
                  style: TextStyle(fontSize: 13, color: Color(0xFF8A7F72)))
            else
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: disponibles.map((s) {
                  final hora = s['time'].toString();
                  final activo = _hora == hora;
                  return ChoiceChip(
                    label: Text(hora),
                    selected: activo,
                    onSelected: (_) => setState(() => _hora = hora),
                    selectedColor: const Color(0xFFC5A052),
                    backgroundColor: const Color(0xFFFAF8F5),
                    labelStyle: TextStyle(
                        fontSize: 13,
                        color: activo ? Colors.white : const Color(0xFF1F1A15)),
                    side: const BorderSide(color: Color(0xFFE0D8CE)),
                  );
                }).toList(),
              ),
            if (_error != null) ...[
              const SizedBox(height: 14),
              Text(_error!,
                  style: const TextStyle(fontSize: 12, color: Color(0xFF881337))),
            ],
            const SizedBox(height: 20),
            SizedBox(
              height: 50,
              width: double.infinity,
              child: ElevatedButton(
                onPressed: (_hora == null || _aplicando) ? null : _confirmar,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFC5A052),
                  foregroundColor: Colors.white,
                  disabledBackgroundColor: const Color(0xFFE0D8CE),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(30)),
                  elevation: 0,
                ),
                child: _aplicando
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Text('Confirmar nuevo horario',
                        style: TextStyle(
                            fontSize: 15, fontWeight: FontWeight.bold)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
