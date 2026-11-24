import 'dart:math';
import 'package:flutter/material.dart';
import 'package:glow_core/services/api_service.dart';

class SalonLoyaltyCustomerScreen extends StatefulWidget {
  final int salonId;
  final String salonName;
  const SalonLoyaltyCustomerScreen({super.key, required this.salonId, required this.salonName});

  @override
  State<SalonLoyaltyCustomerScreen> createState() => _SalonLoyaltyCustomerScreenState();
}

class _SalonLoyaltyCustomerScreenState extends State<SalonLoyaltyCustomerScreen> {
  static const _ink = Color(0xFF241D18);
  static const _gold = Color(0xFFC5A052);
  static const _muted = Color(0xFF85766D);
  Map<String, dynamic> _summary = {};
  List<Map<String, dynamic>> _rewards = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final data = await Future.wait([
        ApiService.get('/api/salon-loyalty/salons/${widget.salonId}/me'),
        ApiService.get('/api/salon-loyalty/salons/${widget.salonId}/rewards'),
      ]);
      if (!mounted) return;
      setState(() {
        _summary = Map<String, dynamic>.from(data[0] as Map);
        _rewards = ((data[1] as Map)['rewards'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
      });
    } catch (_) {
      if (mounted) setState(() => _error = 'No se pudo cargar tu saldo del salón. Inicia sesión y vuelve a intentarlo.');
    } finally { if (mounted) setState(() => _loading = false); }
  }

  Future<void> _redeem(Map<String, dynamic> reward) async {
    final accepted = await showDialog<bool>(context: context, builder: (context) => AlertDialog(
      title: const Text('Solicitar recompensa'),
      content: Text('¿Quieres solicitar «${reward['name']}» por ${reward['points_cost']} puntos?'),
      actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Volver')),
        FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Canjear'))],
    ));
    if (accepted != true) return;
    final key = 'salon:${widget.salonId}:${DateTime.now().microsecondsSinceEpoch}:${Random.secure().nextInt(1 << 30)}';
    try {
      await ApiService.post('/api/salon-loyalty/salons/${widget.salonId}/rewards/${reward['id']}/redeem', {'idempotencyKey': key});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Solicitud enviada al salón.')));
      await _load();
    } catch (e) {
      final message = e.toString().contains('409') ? 'No tienes puntos suficientes o el canje ya llegó a su límite.' : 'No se pudo solicitar el canje. Intenta de nuevo.';
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFFAF8F5),
    appBar: AppBar(title: const Text('Puntos del salón'), backgroundColor: const Color(0xFFFAF8F5), foregroundColor: _ink,
      actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh))]),
    body: _loading ? const Center(child: CircularProgressIndicator(color: _gold))
      : _error != null ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: _muted)),
          const SizedBox(height: 12), OutlinedButton(onPressed: _load, child: const Text('Intentar de nuevo')),
        ])))
      : RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(16), children: [
          Container(padding: const EdgeInsets.all(20), decoration: BoxDecoration(color: _ink, borderRadius: BorderRadius.circular(20)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(widget.salonName, style: const TextStyle(color: Colors.white70)),
            const SizedBox(height: 8),
            Text('${_summary['balance'] ?? 0}', style: const TextStyle(color: Colors.white, fontSize: 36, fontWeight: FontWeight.w700)),
            const Text('puntos propios de este salón', style: TextStyle(color: Colors.white70)),
          ])),
          const Padding(padding: EdgeInsets.fromLTRB(4, 22, 4, 10), child: Text('Recompensas disponibles', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: _ink))),
          if (_rewards.isEmpty) _empty('Este salón aún no ofrece recompensas.'),
          ..._rewards.map((r) => Card(color: Colors.white, elevation: 0, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: Color(0xFFEDE5DB))), child: ListTile(
            title: Text((r['name'] ?? 'Recompensa').toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text('${r['points_cost']} puntos · ${(r['description'] ?? 'Pregunta en el salón por las condiciones').toString()}', style: const TextStyle(color: _muted)),
            trailing: IconButton(tooltip: 'Solicitar recompensa', icon: const Icon(Icons.redeem, color: _gold), onPressed: () => _redeem(r)),
          ))),
          const Padding(padding: EdgeInsets.fromLTRB(4, 22, 4, 10), child: Text('Movimientos', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: _ink))),
          if ((_summary['movements'] as List? ?? const []).isEmpty) _empty('Aún no tienes movimientos de puntos en este salón.'),
          ...((_summary['movements'] as List? ?? const []).map((e) => Map<String, dynamic>.from(e as Map))).map((m) => ListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 8),
            leading: Icon((m['points_delta'] as num? ?? 0) >= 0 ? Icons.add_circle_outline : Icons.remove_circle_outline, color: _gold),
            title: Text((m['note'] ?? m['type'] ?? 'Movimiento').toString()),
            subtitle: Text((m['created_at'] ?? '').toString().split('T').first, style: const TextStyle(color: _muted)),
            trailing: Text('${(m['points_delta'] as num? ?? 0) > 0 ? '+' : ''}${m['points_delta']}', style: const TextStyle(fontWeight: FontWeight.w700, color: _ink)),
          )),
          const SizedBox(height: 24),
        ])),
  );

  Widget _empty(String message) => Padding(padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8), child: Text(message, style: const TextStyle(color: _muted)));
}
