import 'package:flutter/material.dart';
import 'package:glow_core/services/api_service.dart';

class SalonLoyaltyScreen extends StatefulWidget {
  final int salonId;
  const SalonLoyaltyScreen({super.key, required this.salonId});

  @override
  State<SalonLoyaltyScreen> createState() => _SalonLoyaltyScreenState();
}

class _SalonLoyaltyScreenState extends State<SalonLoyaltyScreen> {
  static const _gold = Color(0xFFC5A052);
  static const _ink = Color(0xFF241D18);
  static const _muted = Color(0xFF85766D);
  static const _line = Color(0xFFEDE5DB);
  final _bookingPoints = TextEditingController();
  final _thousandPoints = TextEditingController();
  bool _enabled = false;
  bool _loading = true;
  bool _saving = false;
  String? _error;
  List<Map<String, dynamic>> _rewards = [];
  List<Map<String, dynamic>> _redemptions = [];
  List<Map<String, dynamic>> _audit = [];
  List<Map<String, dynamic>> _rewardAudit = [];
  List<Map<String, dynamic>> _eligibleBookings = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _bookingPoints.dispose();
    _thousandPoints.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final responses = await Future.wait([
        ApiService.get('/api/saas/loyalty/program'),
        ApiService.get('/api/saas/loyalty/rewards?includeInactive=true'),
        ApiService.get('/api/saas/loyalty/redemptions?status=PENDING'),
        ApiService.get('/api/saas/loyalty/bookings/eligible'),
        ApiService.get('/api/saas/loyalty/rewards/audit'),
      ]);
      final program = Map<String, dynamic>.from(responses[0] as Map);
      if (!mounted) return;
      setState(() {
        _bookingPoints.text = '${program['points_per_completed_booking'] ?? 0}';
        _thousandPoints.text = '${program['points_per_1000_cop'] ?? 0}';
        _enabled = program['is_enabled'] == true;
        _audit = (program['audit'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _rewards = ((responses[1] as Map)['rewards'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _redemptions = ((responses[2] as Map)['redemptions'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _eligibleBookings = ((responses[3] as Map)['bookings'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _rewardAudit = ((responses[4] as Map)['changes'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
      });
    } catch (e) {
      if (mounted) setState(() => _error = _humanError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _humanError(Object error) {
    final value = error.toString();
    if (value.contains('403')) return 'Tu perfil no tiene permiso para administrar la fidelización.';
    if (value.contains('401')) return 'Inicia sesión con el negocio del salón activo.';
    if (value.contains('sede') || value.contains('salón')) return 'Selecciona una sede activa y vuelve a cargar.';
    return 'No se pudo cargar la fidelización. Intenta de nuevo.';
  }

  Future<void> _saveProgram() async {
    final booking = int.tryParse(_bookingPoints.text.trim());
    final thousand = int.tryParse(_thousandPoints.text.trim());
    if (booking == null || thousand == null || booking < 0 || thousand < 0) {
      _snack('Los puntos deben ser números enteros iguales o mayores que cero.');
      return;
    }
    setState(() => _saving = true);
    try {
      await ApiService.put('/api/saas/loyalty/program', {
        'pointsPerCompletedBooking': booking,
        'pointsPer1000Cop': thousand,
        'isEnabled': _enabled,
      });
      _snack('Reglas del salón guardadas.');
      await _load();
    } catch (e) {
      _snack(_humanError(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _createReward() async {
    final name = TextEditingController();
    final description = TextEditingController();
    final points = TextEditingController();
    final accepted = await showDialog<bool>(context: context, builder: (context) => AlertDialog(
      title: const Text('Nueva recompensa'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: name, maxLength: 100, decoration: const InputDecoration(labelText: 'Nombre')),
        TextField(controller: description, maxLength: 500, decoration: const InputDecoration(labelText: 'Descripción')),
        TextField(controller: points, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Puntos necesarios')),
      ]),
      actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
        FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Crear'))],
    ));
    if (accepted != true) return;
    final cost = int.tryParse(points.text.trim());
    if (name.text.trim().isEmpty || cost == null || cost < 1) { _snack('Revisa el nombre y los puntos de la recompensa.'); return; }
    try {
      await ApiService.post('/api/saas/loyalty/rewards', {
        'name': name.text.trim(), 'description': description.text.trim(), 'pointsCost': cost,
      });
      await _load();
    } catch (e) { _snack(_humanError(e)); }
  }

  Future<void> _setRewardActive(Map<String, dynamic> reward, bool active) async {
    try {
      await ApiService.patch('/api/saas/loyalty/rewards/${reward['id']}', {'isActive': active});
      await _load();
    } catch (e) { _snack(_humanError(e)); }
  }

  Future<void> _updateRedemption(Map<String, dynamic> item, String status) async {
    try {
      await ApiService.patch('/api/saas/loyalty/redemptions/${item['id']}', {'status': status});
      await _load();
    } catch (e) { _snack(_humanError(e)); }
  }

  Future<void> _awardBooking(Map<String, dynamic> item) async {
    try {
      await ApiService.post('/api/saas/loyalty/bookings/${item['id']}/award', {});
      _snack('Puntos acreditados.');
      await _load();
    } catch (e) { _snack(_humanError(e)); }
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  String _money(dynamic value) {
    final amount = value is num ? value.toDouble() : double.tryParse(value?.toString() ?? '') ?? 0;
    return '\$${amount.toStringAsFixed(0)} COP';
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFFAF8F5),
    appBar: AppBar(title: const Text('Fidelización del salón'), backgroundColor: const Color(0xFFFAF8F5), foregroundColor: _ink,
      actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh))]),
    body: _loading
      ? const Center(child: CircularProgressIndicator(color: _gold))
      : _error != null
        ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: _muted)),
            const SizedBox(height: 12), OutlinedButton(onPressed: _load, child: const Text('Intentar de nuevo')),
          ])))
        : RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(16), children: [
            _card(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Tu programa de puntos', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: _ink)),
              const SizedBox(height: 6),
              const Text('Este programa y sus puntos son propios de tu salón. No se mezclan con los puntos globales de GlowApp.', style: TextStyle(color: _muted, height: 1.4)),
              SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Programa activo'), value: _enabled, activeThumbColor: _gold,
                onChanged: (value) => setState(() => _enabled = value)),
              _numberField(_bookingPoints, 'Puntos por servicio completado'),
              const SizedBox(height: 10),
              _numberField(_thousandPoints, 'Puntos por cada \$1.000 COP pagados'),
              const SizedBox(height: 8),
              SizedBox(width: double.infinity, child: FilledButton(onPressed: _saving ? null : _saveProgram,
                style: FilledButton.styleFrom(backgroundColor: _ink, foregroundColor: Colors.white),
                child: Text(_saving ? 'Guardando…' : 'Guardar reglas'))),
              if (_audit.isNotEmpty) ...[
                const Divider(height: 26), const Text('Historial de reglas', style: TextStyle(fontWeight: FontWeight.w700)),
                ..._audit.take(3).map((a) => Padding(padding: const EdgeInsets.only(top: 6), child: Text(
                  '${a['changed_at']?.toString().substring(0, 10) ?? ''}: ${a['points_per_completed_booking']} por servicio · ${a['points_per_1000_cop']} por cada \$1.000 · ${a['is_enabled'] == true ? 'activo' : 'inactivo'}',
                  style: const TextStyle(color: _muted, fontSize: 12),
                ))),
              ],
            ])),
            const SizedBox(height: 16),
            _sectionHeading('Servicios completados y pagados'),
            if (_eligibleBookings.isEmpty) _card(child: const Text('No hay servicios elegibles recientes.')),
            ..._eligibleBookings.map((b) => _card(child: Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text((b['customer_name'] ?? 'Cliente').toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
                Text('${b['scheduled_at']?.toString().substring(0, 10) ?? ''} · ${_money(b['valor_bruto'])}', style: const TextStyle(color: _muted)),
              ])),
              b['points_awarded'] == true
                ? const Chip(label: Text('Puntos acreditados'))
                : OutlinedButton(onPressed: () => _awardBooking(b), child: const Text('Acreditar')),
            ]))),
            const SizedBox(height: 8),
            _sectionHeading('Recompensas', action: IconButton(onPressed: _createReward, icon: const Icon(Icons.add_circle_outline, color: _gold))),
            if (_rewards.isEmpty) _card(child: const Text('Aún no has creado recompensas.')),
            ..._rewards.map((r) => _card(child: SwitchListTile(
              contentPadding: EdgeInsets.zero, value: r['is_active'] == true,
              onChanged: (v) => _setRewardActive(r, v), activeThumbColor: _gold,
              title: Text('${r['name']} · ${r['points_cost']} puntos', style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text((r['description'] ?? 'Sin descripción').toString(), style: const TextStyle(color: _muted)),
            ))),
            if (_rewardAudit.isNotEmpty) ...[
              _sectionHeading('Historial de recompensas'),
              ..._rewardAudit.take(5).map((a) => Padding(
                padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                child: Text('${a['changed_at']?.toString().substring(0, 10) ?? ''} · ${a['action'] == 'CREATED' ? 'Creada' : 'Actualizada'}: ${a['name']} · ${a['points_cost']} puntos · ${a['is_active'] == true ? 'activa' : 'inactiva'}',
                  style: const TextStyle(color: _muted, fontSize: 12)),
              )),
            ],
            const SizedBox(height: 8),
            _sectionHeading('Canjes pendientes'),
            if (_redemptions.isEmpty) _card(child: const Text('No hay canjes pendientes.')),
            ..._redemptions.map((r) => _card(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text((r['reward_name'] ?? 'Recompensa').toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
              Text('${r['customer_name'] ?? 'Cliente'} · ${r['points_cost']} puntos', style: const TextStyle(color: _muted)),
              Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                TextButton(onPressed: () => _updateRedemption(r, 'CANCELLED'), child: const Text('Cancelar y devolver puntos')),
                const SizedBox(width: 8), FilledButton(onPressed: () => _updateRedemption(r, 'FULFILLED'),
                  style: FilledButton.styleFrom(backgroundColor: _gold, foregroundColor: _ink), child: const Text('Entregado')),
              ]),
            ]))),
            const SizedBox(height: 32),
          ])),
  );

  Widget _numberField(TextEditingController controller, String label) => TextField(
    controller: controller, keyboardType: TextInputType.number,
    decoration: InputDecoration(labelText: label, filled: true, fillColor: const Color(0xFFF7F2EC), border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none)),
  );

  Widget _card({required Widget child}) => Container(
    margin: const EdgeInsets.only(bottom: 10), padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(color: Colors.white, border: Border.all(color: _line), borderRadius: BorderRadius.circular(18)), child: child);

  Widget _sectionHeading(String title, {Widget? action}) => Padding(
    padding: const EdgeInsets.only(bottom: 8), child: Row(children: [Expanded(child: Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: _ink))), if (action != null) action]));
}
