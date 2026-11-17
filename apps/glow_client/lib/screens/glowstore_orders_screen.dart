// lib/screens/profile/glowstore_orders_screen.dart
import 'package:glow_core/glow_core.dart';
import 'package:flutter/material.dart';
class GlowStoreOrdersScreen extends StatefulWidget {
  const GlowStoreOrdersScreen({super.key});

  @override
  State<GlowStoreOrdersScreen> createState() => _GlowStoreOrdersScreenState();
}

class _GlowStoreOrdersScreenState extends State<GlowStoreOrdersScreen> {
  bool _isLoading = true;
  String? _error;
  List<Map<String, dynamic>> _orders = [];
  Map<String, List<Map<String, dynamic>>> _returnsByOrder = {};

  @override
  void initState() {
    super.initState();
    _loadOrders();
  }

  Future<void> _loadOrders() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final orders = await ApiService.fetchStoreOrders();
      var returnsByOrder = <String, List<Map<String, dynamic>>>{};
      try {
        final response = await ApiService.get('/client/returns');
        if (response != null && response['success'] == true) {
          for (final raw in (response['data'] as List? ?? const [])) {
            final row = Map<String, dynamic>.from(raw as Map);
            final id = row['pedido_id']?.toString();
            if (id != null) (returnsByOrder[id] ??= []).add(row);
          }
        }
      } catch (_) {}
      if (mounted) {
        setState(() {
          _orders = orders;
          _returnsByOrder = returnsByOrder;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString().replaceFirst('Exception: ', '');
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _viewShipmentTracking(String guide) async {
    try {
      final response = await ApiService.get('/tracking/$guide');
      if (!mounted) return;
      if (response == null || response['success'] != true) throw Exception(response?['error'] ?? 'No se pudo consultar el seguimiento');
      final data = Map<String, dynamic>.from(response['data'] as Map);
      final timeline = (data['timeline'] as List?) ?? const [];
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text('Seguimiento ${data['guia'] ?? guide}'),
          content: SizedBox(width: 420, child: ListView(shrinkWrap: true, children: [
            Text('${data['transportadora'] ?? 'Transportadora'} · ${data['estado_actual'] ?? 'Estado desconocido'}'),
            if (timeline.isEmpty) const Text('Aún no hay eventos de seguimiento.'),
            ...timeline.map((raw) {
              final event = Map<String, dynamic>.from(raw as Map);
              return ListTile(dense: true, leading: const Icon(Icons.local_shipping_outlined),
                title: Text((event['estado'] ?? event['evento'] ?? 'Actualización').toString()),
                subtitle: Text((event['timestamp'] ?? event['fecha'] ?? '').toString()));
            }),
          ])),
          actions: [TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cerrar'))],
        ),
      );
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(mensajeHumano(e))));
    }
  }

  Future<void> _requestReturn(Map<String, dynamic> order, Map<String, dynamic> shipment) async {
    final description = TextEditingController();
    var reason = 'defectuoso';
    final providerId = shipment['prestador_id']?.toString();
    final items = ((order['items'] as List?) ?? const []).map((raw) => Map<String, dynamic>.from(raw as Map))
        .where((item) => providerId == null || item['proveedor_id']?.toString() == providerId)
        .map((item) => {'producto_id': item['producto_id'], 'cantidad': item['cantidad']}).toList();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(builder: (context, setDialogState) => AlertDialog(
        title: const Text('Solicitar devolución'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          DropdownButtonFormField<String>(value: reason, decoration: const InputDecoration(labelText: 'Motivo'),
            items: const [
              DropdownMenuItem(value: 'defectuoso', child: Text('Producto defectuoso')),
              DropdownMenuItem(value: 'no_gusta', child: Text('No me gustó')),
              DropdownMenuItem(value: 'talla_incorrecta', child: Text('Talla incorrecta')),
              DropdownMenuItem(value: 'producto_incorrecto', child: Text('Producto incorrecto')),
              DropdownMenuItem(value: 'dañado_envio', child: Text('Dañado durante el envío')),
              DropdownMenuItem(value: 'llegó_tarde', child: Text('Llegó tarde')),
              DropdownMenuItem(value: 'cambio_opinion', child: Text('Cambio de opinión')),
              DropdownMenuItem(value: 'otro', child: Text('Otro')),
            ], onChanged: (value) => setDialogState(() => reason = value ?? 'otro')),
          TextField(controller: description, maxLines: 3,
            decoration: const InputDecoration(labelText: 'Describe el motivo (mínimo 10 caracteres)')),
          Text('${items.length} producto(s) incluidos en la solicitud.'),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Enviar')),
        ],
      )),
    );
    if (confirmed != true) { description.dispose(); return; }
    try {
      final response = await ApiService.post('/client/orders/${order['id']}/return', {
        'motivo': reason, 'descripcion': description.text.trim(), 'envio_id': shipment['id'],
        'items': items, 'fotos': <String>[],
      });
      if (mounted && response?['success'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Solicitud de devolución enviada')));
        await _loadOrders();
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(response?['error'] ?? 'No se pudo enviar la solicitud')));
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(mensajeHumano(e))));
    } finally { description.dispose(); }
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        backgroundColor: LuxeColors.nude50,
        appBar: AppBar(
          backgroundColor: LuxeColors.nude50,
          elevation: 0,
          leading: IconButton(
            tooltip: 'Regresar',
            icon: const Icon(Icons.arrow_back_ios_new, color: LuxeColors.nude900, size: 20),
            onPressed: () => Navigator.pop(context),
          ),
          title: const Text(
            'PEDIDOS GLOWSTORE',
            style: TextStyle(
              fontFamily: 'Didot',
              fontSize: 15,
              fontWeight: FontWeight.bold,
              color: LuxeColors.nude900,
              letterSpacing: 1.2,
            ),
          ),
          centerTitle: true,
          bottom: const TabBar(
            indicatorColor: LuxeColors.nude900,
            labelColor: LuxeColors.nude900,
            unselectedLabelColor: LuxeColors.nude500,
            labelStyle: TextStyle(
              fontFamily: 'JetBrainsMono',
              fontSize: 11,
              fontWeight: FontWeight.bold,
              letterSpacing: 1.0,
            ),
            tabs: [
              Tab(text: 'EN CAMINO'),
              Tab(text: 'COMPLETADOS'),
            ],
          ),
          actions: [
            IconButton(
              icon: const Icon(Icons.refresh, color: LuxeColors.nude900),
              onPressed: _loadOrders,
              tooltip: 'Actualizar',
            ),
          ],
        ),
        body: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(
        child: CircularProgressIndicator(color: LuxeColors.nude900),
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, color: Color(0xFFB00020), size: 48),
            const SizedBox(height: 16),
            Text(
              'Error al cargar pedidos',
              style: TextStyle(
                fontFamily: 'Didot',
                fontSize: 16,
                fontWeight: FontWeight.bold,
                color: LuxeColors.nude900,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _error!,
              style: TextStyle(
                fontFamily: 'JetBrainsMono',
                fontSize: 11,
                color: LuxeColors.nude500,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: _loadOrders,
              icon: const Icon(Icons.refresh),
              label: const Text('Reintentar'),
              style: ElevatedButton.styleFrom(
                backgroundColor: LuxeColors.nude900,
                foregroundColor: Colors.white,
              ),
            ),
          ],
        ),
      );
    }

    // Filtrar por estado para las pestañas
    final enCamino = _orders.where((o) {
      final estado = (o['estado'] ?? '').toString().toUpperCase();
      return estado == 'PAGADO' || estado == 'DESPACHADO';
    }).toList();

    final completados = _orders.where((o) {
      final estado = (o['estado'] ?? '').toString().toUpperCase();
      return estado == 'ENTREGADO';
    }).toList();

    return Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 680),
            child: TabBarView(
              children: [
                // PESTAÑA EN CAMINO
                _buildOrdersList(enCamino, 'No hay pedidos en camino'),
                // PESTAÑA COMPLETADOS
                _buildOrdersList(completados, 'No hay pedidos completados'),
              ],
            ),
          ),
        );
      }

  Widget _buildOrdersList(List<Map<String, dynamic>> orders, String emptyMessage) {
    if (orders.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.inventory_2_outlined, color: LuxeColors.nude300, size: 64),
            const SizedBox(height: 16),
            Text(
              emptyMessage,
              style: TextStyle(
                fontFamily: 'Didot',
                fontSize: 16,
                fontWeight: FontWeight.w500,
                color: LuxeColors.nude500,
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadOrders,
      color: LuxeColors.nude900,
      child: ListView(
        padding: const EdgeInsets.all(LuxeSpacing.xl),
        children: orders.map((order) => _buildOrderCard(order)).toList(),
      ),
    );
  }

  Widget _buildOrderCard(Map<String, dynamic> order) {
    final orderId = order['id']?.toString() ?? 'N/A';
    final createdAt = order['creado_en'] ?? order['created_at'];
    final estado = order['estado']?.toString() ?? 'PENDIENTE_PAGO';
    final total = order['total'] ?? 0;
    final nombreEntrega = order['nombre_entrega'] ?? '';
    final direccionEntrega = order['direccion_entrega'] ?? '';
    final cufe = order['cufe']?.toString();
    final qrFactura = order['qr_factura']?.toString();

    // Formatear fecha
    String dateStr = 'Fecha desconocida';
    if (createdAt != null) {
      try {
        final dt = DateTime.parse(createdAt.toString());
        const meses = [
          'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
          'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
        ];
        dateStr = '${dt.day} de ${meses[dt.month - 1]}, ${dt.year}';
      } catch (_) {}
    }

    // Mapear estado a label y color
    String statusLabel;
    Color statusColor;
    switch (estado.toUpperCase()) {
      case 'PENDIENTE_PAGO':
        statusLabel = 'Pendiente de pago';
        statusColor = const Color(0xFFF57F17);
        break;
      case 'PAGADO':
        statusLabel = 'Pagado';
        statusColor = const Color(0xFF1976D2);
        break;
      case 'DESPACHADO':
        statusLabel = 'En camino';
        statusColor = const Color(0xFFC5A052);
        break;
      case 'ENTREGADO':
        statusLabel = 'Entregado';
        statusColor = const Color(0xFF4A5D4E);
        break;
      case 'CANCELADO':
        statusLabel = 'Cancelado';
        statusColor = const Color(0xFFB00020);
        break;
      default:
        statusLabel = estado;
        statusColor = LuxeColors.nude500;
    }

    // Obtener items del pedido (si vienen en el response)
    String itemsStr = '${order['count'] ?? 0} productos';
    if (order['items'] is List && (order['items'] as List).isNotEmpty) {
      itemsStr = (order['items'] as List)
          .map((i) => '${i['nombre'] ?? i['producto_id'] ?? 'Producto'} x${i['cantidad'] ?? 1}')
          .join(', ');
    } else if (order['detalles'] is List && (order['detalles'] as List).isNotEmpty) {
      itemsStr = (order['detalles'] as List)
          .map((i) => '${i['nombre'] ?? i['producto_id'] ?? 'Producto'} x${i['cantidad'] ?? 1}')
          .join(', ');
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: LuxeColors.nude200),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                '#${orderId.substring(0, 8).toUpperCase()}',
                style: const TextStyle(
                  fontFamily: 'JetBrainsMono',
                  fontSize: 13,
                  fontWeight: FontWeight.bold,
                  color: LuxeColors.nude900,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  statusLabel.toUpperCase(),
                  style: TextStyle(
                    fontFamily: 'JetBrainsMono',
                    fontSize: 9,
                    fontWeight: FontWeight.bold,
                    color: statusColor,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            dateStr,
            style: const TextStyle(
              fontFamily: 'CormorantGaramond',
              fontSize: 13,
              color: LuxeColors.nude500,
            ),
          ),
          const Divider(height: 24, color: LuxeColors.nude100),
          Text(
            itemsStr,
            style: const TextStyle(
              fontFamily: 'Didot',
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: LuxeColors.nude900,
            ),
          ),
          const SizedBox(height: 8),
          if (nombreEntrega.isNotEmpty)
            Text(
              'Entregar a: $nombreEntrega',
              style: const TextStyle(
                fontFamily: 'JetBrainsMono',
                fontSize: 11,
                color: LuxeColors.nude600,
              ),
            ),
          if (direccionEntrega.isNotEmpty)
            Text(
              direccionEntrega,
              style: const TextStyle(
                fontFamily: 'JetBrainsMono',
                fontSize: 10,
                color: LuxeColors.nude500,
              ),
            ),
          if (order['envios'] is List && (order['envios'] as List).isNotEmpty) ...[
            const SizedBox(height: 12),
            const Text('ENVÍO Y SEGUIMIENTO', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11)),
            ...(order['envios'] as List).map((raw) {
              final shipment = Map<String, dynamic>.from(raw as Map);
              final guide = shipment['guia']?.toString();
              return Card(child: ListTile(
                leading: const Icon(Icons.local_shipping_outlined),
                title: Text('${shipment['transportadora'] ?? 'Transportadora'} · ${shipment['estado'] ?? 'CREADO'}'),
                subtitle: Text(guide == null || guide.isEmpty ? 'Guía pendiente' : 'Guía: $guide'),
                trailing: guide == null || guide.isEmpty ? null : IconButton(
                  tooltip: 'Ver seguimiento', icon: const Icon(Icons.timeline), onPressed: () => _viewShipmentTracking(guide)),
              ));
            }),
          ],
          if ((_returnsByOrder[orderId] ?? const []).isNotEmpty) ...[
            const SizedBox(height: 8),
            const Text('DEVOLUCIONES', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11)),
            ...(_returnsByOrder[orderId] ?? const []).map((row) => ListTile(
              dense: true, leading: const Icon(Icons.assignment_return_outlined),
              title: Text('Solicitud: ${row['estado'] ?? 'pendiente'}'),
              subtitle: Text([
                (row['descripcion'] ?? row['motivo'] ?? '').toString(),
                if (row['reembolso_estado'] != null) 'Reembolso: ${row['reembolso_estado']}',
              ].join(' · ')),
            )),
          ],
          if (order['envios'] is List && estado.toUpperCase() != 'PENDIENTE_PAGO') ...[
              ...(order['envios'] as List).map((raw) {
                final shipment = Map<String, dynamic>.from(raw as Map);
                if (shipment['prestador_id'] == null || shipment['estado'] != 'ENTREGADO') return const SizedBox.shrink();
                return Align(alignment: Alignment.centerRight, child: TextButton.icon(
                  icon: const Icon(Icons.assignment_return_outlined), label: const Text('Solicitar devolución'),
                  onPressed: () => _requestReturn(order, shipment)));
              }),
          ],
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              if (cufe != null)
                Text(
                  'Factura: \u2713',
                  style: TextStyle(
                    fontFamily: 'JetBrainsMono',
                    fontSize: 10,
                    color: const Color(0xFF1976D2),
                  ),
                )
              else
                Text(
                  'Factura: \u2014',
                  style: TextStyle(
                    fontFamily: 'JetBrainsMono',
                    fontSize: 10,
                    color: LuxeColors.nude400,
                  ),
                ),
              Text(
                '\$${_formatPrice(total)} COP',
                style: const TextStyle(
                  fontFamily: 'Didot',
                  fontSize: 15,
                  fontWeight: FontWeight.bold,
                  color: LuxeColors.nude900,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _formatPrice(dynamic price) {
    if (price == null) return '0';
    if (price is int) return price.toString();
    if (price is double) return price.toStringAsFixed(0);
    return price.toString();
  }
}
