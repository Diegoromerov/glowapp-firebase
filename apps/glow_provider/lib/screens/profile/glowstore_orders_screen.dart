// lib/screens/profile/glowstore_orders_screen.dart
import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';
import 'package:glow_core/services/api_service.dart';

class GlowStoreOrdersScreen extends StatefulWidget {
  const GlowStoreOrdersScreen({super.key});

  @override
  State<GlowStoreOrdersScreen> createState() => _GlowStoreOrdersScreenState();
}

class _GlowStoreOrdersScreenState extends State<GlowStoreOrdersScreen> {
  bool _isLoading = true;
  String? _error;
  List<Map<String, dynamic>> _orders = [];

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
      if (mounted) {
        setState(() {
          _orders = orders;
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

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        backgroundColor: AppTheme.nude50,
        appBar: AppBar(
          backgroundColor: AppTheme.nude50,
          elevation: 0,
          leading: IconButton(
            icon: Icon(Icons.arrow_back_ios_new, color: AppTheme.nude900, size: 20),
            onPressed: () => Navigator.pop(context),
          ),
          title: Text(
            'PEDIDOS GLOWSTORE',
            style: TextStyle(
              fontFamily: 'Didot',
              fontSize: 15,
              fontWeight: FontWeight.bold,
              color: AppTheme.nude900,
              letterSpacing: 1.2,
            ),
          ),
          centerTitle: true,
          bottom: TabBar(
            indicatorColor: AppTheme.nude900,
            labelColor: AppTheme.nude900,
            unselectedLabelColor: AppTheme.nude500,
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
              icon: Icon(Icons.refresh, color: AppTheme.nude900),
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
      return Center(
        child: CircularProgressIndicator(color: AppTheme.nude900),
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, color: Color(0xFFB00020), size: 48),
            SizedBox(height: 16),
            Text(
              'Error al cargar pedidos',
              style: TextStyle(
                fontFamily: 'Didot',
                fontSize: 16,
                fontWeight: FontWeight.bold,
                color: AppTheme.nude900,
              ),
            ),
            SizedBox(height: 8),
            Text(
              _error!,
              style: TextStyle(
                fontFamily: 'JetBrainsMono',
                fontSize: 11,
                color: AppTheme.nude500,
              ),
              textAlign: TextAlign.center,
            ),
            SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: _loadOrders,
              icon: const Icon(Icons.refresh),
              label: const Text('Reintentar'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.nude900,
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
            Icon(Icons.inventory_2_outlined, color: AppTheme.nude300, size: 64),
            SizedBox(height: 16),
            Text(
              emptyMessage,
              style: TextStyle(
                fontFamily: 'Didot',
                fontSize: 16,
                fontWeight: FontWeight.w500,
                color: AppTheme.nude500,
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadOrders,
      color: AppTheme.nude900,
      child: ListView(
        padding: EdgeInsets.all(LuxeSpacing.xl),
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
        statusColor = AppTheme.nude500;
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
      margin: EdgeInsets.only(bottom: 16),
      padding: EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.nude200),
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
                style: TextStyle(
                  fontFamily: 'JetBrainsMono',
                  fontSize: 13,
                  fontWeight: FontWeight.bold,
                  color: AppTheme.nude900,
                ),
              ),
              Container(
                padding: EdgeInsets.symmetric(horizontal: 10, vertical: 4),
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
          SizedBox(height: 8),
          Text(
            dateStr,
            style: TextStyle(
              fontFamily: 'CormorantGaramond',
              fontSize: 13,
              color: AppTheme.nude500,
            ),
          ),
          Divider(height: 24, color: AppTheme.nude100),
          Text(
            itemsStr,
            style: TextStyle(
              fontFamily: 'Didot',
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: AppTheme.nude900,
            ),
          ),
          SizedBox(height: 8),
          if (nombreEntrega.isNotEmpty)
            Text(
              'Entregar a: $nombreEntrega',
              style: TextStyle(
                fontFamily: 'JetBrainsMono',
                fontSize: 11,
                color: AppTheme.nude600,
              ),
            ),
          if (direccionEntrega.isNotEmpty)
            Text(
              direccionEntrega,
              style: TextStyle(
                fontFamily: 'JetBrainsMono',
                fontSize: 10,
                color: AppTheme.nude500,
              ),
            ),
          SizedBox(height: 12),
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
                    color: AppTheme.nude400,
                  ),
                ),
              Text(
                '\$${_formatPrice(total)} COP',
                style: TextStyle(
                  fontFamily: 'Didot',
                  fontSize: 15,
                  fontWeight: FontWeight.bold,
                  color: AppTheme.nude900,
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
