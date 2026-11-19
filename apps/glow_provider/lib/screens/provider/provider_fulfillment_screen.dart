// frontend/lib/screens/provider/provider_fulfillment_screen.dart
// Pantalla de Fulfillment para Proveedores/Salones (F1-Logística)
// Lista pedidos PAGADO asignados, permite preparar, etiquetar, solicitar recolección y despachar

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:glow_core/glow_core.dart';
import 'package:glow_core/services/api_service.dart';
import 'package:url_launcher/url_launcher.dart';

class ProviderFulfillmentScreen extends ConsumerStatefulWidget {
  const ProviderFulfillmentScreen({super.key});

  @override
  ConsumerState<ProviderFulfillmentScreen> createState() => _ProviderFulfillmentScreenState();
}

class _ProviderFulfillmentScreenState extends ConsumerState<ProviderFulfillmentScreen> {
  static const Color _gold = Color(0xFFD4A843);
  static const Color _darkBg = Color(0xFF1A1A2E);
  static const Color _cardBg = Color(0xFF252542);
  static const Color _textPrimary = Color(0xFFFFFFFF);
  static const Color _textMuted = Color(0xFFB0B0C8);

  List<FulfillmentOrder> _orders = [];
  bool _isLoading = true;
  String? _error;
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    _loadOrders();
    _refreshTimer = Timer.periodic(const Duration(seconds: 30), (_) => _loadOrders());
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadOrders() async {
    if (!mounted) return;
    setState(() { _isLoading = true; _error = null; });

    try {
      final response = await ApiService.get('/provider/fulfillment/orders');

      if (response != null && response['success'] == true && response['data'] != null) {
        final List<dynamic> data = response['data'];
        setState(() {
          _orders = data.map((json) => FulfillmentOrder.fromJson(json)).toList();
          _isLoading = false;
        });
      } else {
        setState(() {
          _error = response?['error'] ?? 'Error al cargar pedidos';
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Error de conexión: ${mensajeHumano(e)}';
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _prepareItems(FulfillmentOrder order) async {
    // TODO: Mostrar modal para marcar items como preparados
    _showSnack('Preparar items - pendiente implementar modal');
  }

  Future<void> _generateLabel(FulfillmentOrder order) async {
    final confirmed = await _showConfirmDialog(
      'Generar etiqueta',
      '¿Generar etiqueta de envío para el pedido #${order.shortId}?\n'
      'Transportadora sugerida: ${order.transportadora ?? "Por definir"}',
    );
    if (!confirmed || !mounted) return;

    _showLoadingDialog('Generando etiqueta...');

    try {
      final response = await ApiService.post(
        '/provider/fulfillment/orders/${order.id}/label',
        {
          'peso_kg': order.estimatedWeightKg,
          'dimensiones_cm': {'l': 20, 'w': 15, 'h': 10},
          'valor_declarado_cop': order.total.toInt(),
        },
      );

      if (mounted) Navigator.pop(context); // Cerrar loading

      if (response != null && response['success'] == true && response['data'] != null) {
        final data = response['data'];
        _showLabelDialog(
          trackingNumber: data['tracking_number'],
          labelPdfUrl: data['label_pdf_url'],
          labelZpl: data['label_zpl'],
          carrier: data['carrier'],
          estimatedDays: data['estimated_days'],
          simulated: data['simulated'] == true,
        );
        _loadOrders(); // Refrescar lista
      } else {
        _showSnack('Error: ${response?['error'] ?? 'No se pudo generar etiqueta'}');
      }
    } catch (e) {
      if (mounted) Navigator.pop(context);
      _showSnack('Error: ${mensajeHumano(e)}');
    }
  }

  Future<void> _schedulePickup(FulfillmentOrder order) async {
    if (order.envioId == null || order.trackingNumber == null) {
      _showSnack('Primero genere la etiqueta');
      return;
    }

    final now = DateTime.now();
    final start = await _showDateTimePicker('Inicio ventana recolección', now.add(const Duration(hours: 1)));
    if (start == null || !mounted) return;

    final end = await _showDateTimePicker('Fin ventana recolección', start.add(const Duration(hours: 2)));
    if (end == null || !mounted) return;

    _showLoadingDialog('Programando recolección...');

    try {
      final response = await ApiService.post(
        '/provider/fulfillment/orders/${order.id}/pickup',
        {
          'ventana_inicio': start.toIso8601String(),
          'ventana_fin': end.toIso8601String(),
          'contacto_nombre': 'Proveedor GlowApp',
          'contacto_telefono': '',
        },
      );

      if (mounted) Navigator.pop(context);

      if (response != null && response['success'] == true) {
        final simulated = response['data']?['simulated'] == true;
        _showSnack(simulated
            ? 'Simulación: recogida registrada; no se notificó a una transportadora.'
            : 'Recolección programada para ${_formatDateTime(start)} - ${_formatDateTime(end)}');
        _loadOrders();
      } else {
        _showSnack('Error: ${response?['error'] ?? 'No se pudo programar'}');
      }
    } catch (e) {
      if (mounted) Navigator.pop(context);
      _showSnack('Error: ${mensajeHumano(e)}');
    }
  }

  Future<void> _dispatchOrder(FulfillmentOrder order) async {
    final confirmed = await _showConfirmDialog(
      'Marcar como despachado',
      '¿Confirmar que el carrier ya recogió el paquete del pedido #${order.shortId}?\n'
      'Esto cambiará el estado a DESPACHADO y notificará al cliente.',
    );
    if (!confirmed || !mounted) return;

    _showLoadingDialog('Despachando...');

    try {
      final response = await ApiService.post('/provider/fulfillment/orders/${order.id}/dispatch', {});

      if (mounted) Navigator.pop(context);

      if (response != null && response['success'] == true) {
        _showSnack('Pedido #${order.shortId} marcado como DESPACHADO');
        _loadOrders();
      } else {
        _showSnack('Error: ${response?['error'] ?? 'No se pudo despachar'}');
      }
    } catch (e) {
      if (mounted) Navigator.pop(context);
      _showSnack('Error: ${mensajeHumano(e)}');
    }
  }

  Future<void> _viewEnvioDetail(FulfillmentOrder order) async {
    if (order.envioId == null) {
      _showSnack('No hay envío asociado a este pedido');
      return;
    }

    _showLoadingDialog('Cargando detalle...');

    try {
      final response = await ApiService.get('/provider/fulfillment/envios/${order.envioId}');

      if (mounted) Navigator.pop(context);

      if (response != null && response['success'] == true && response['data'] != null) {
        _showEnvioDetailDialog(response['data']);
      } else {
        _showSnack('Error: ${response?['error'] ?? 'No se pudo cargar detalle'}');
      }
    } catch (e) {
      if (mounted) Navigator.pop(context);
      _showSnack('Error: ${mensajeHumano(e)}');
    }
  }

  Future<void> _openLabelPdf(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else {
      _showSnack('No se pudo abrir el PDF');
    }
  }

  void _showLabelDialog({
    required String trackingNumber,
    required String labelPdfUrl,
    required String labelZpl,
    required String carrier,
    required String estimatedDays,
    required bool simulated,
  }) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: _cardBg,
        title: Row(
          children: [
            const Icon(Icons.local_shipping, color: _gold),
            const SizedBox(width: 8),
            Text(simulated ? 'Etiqueta simulada' : 'Etiqueta generada', style: TextStyle(color: _textPrimary)),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _InfoRow(label: 'Guía:', value: trackingNumber),
              _InfoRow(label: 'Transportadora:', value: carrier),
              _InfoRow(label: 'Entrega estimada:', value: estimatedDays),
              if (simulated) ...[
                const SizedBox(height: 12),
                const Text(
                  'Entorno simulado: esta guía y su recogida no son válidas ante una transportadora.',
                  style: TextStyle(color: Colors.orangeAccent),
                ),
              ] else ...[
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: ElevatedButton.icon(
                        icon: const Icon(Icons.picture_as_pdf),
                        label: const Text('Ver PDF'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: _gold,
                          foregroundColor: _darkBg,
                        ),
                        onPressed: () => _openLabelPdf(labelPdfUrl),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: OutlinedButton.icon(
                        icon: const Icon(Icons.print),
                        label: const Text('ZPL (Térmica)'),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: _gold,
                          side: BorderSide(color: _gold),
                        ),
                        onPressed: () => _showZplDialog(labelZpl),
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text('Cerrar', style: TextStyle(color: _gold)),
          ),
        ],
      ),
    );
  }

  void _showZplDialog(String zpl) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: _cardBg,
        title: Text('Código ZPL (Impresora Térmica)', style: TextStyle(color: _textPrimary)),
        content: SingleChildScrollView(
          child: SelectableText(
            zpl,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 12, color: _textPrimary),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text('Copiar', style: TextStyle(color: _gold)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text('Cerrar', style: TextStyle(color: _textMuted)),
          ),
        ],
      ),
    );
  }

  bool _isSimulatedShipment(Map<String, dynamic> envio) {
    final tracking = envio['guia']?.toString() ?? '';
    final labelUrl = envio['label_pdf_url']?.toString() ?? '';
    return tracking.startsWith('MOCK-') || labelUrl.startsWith('https://mock.envia.com/');
  }

  void _showEnvioDetailDialog(Map<String, dynamic> envio) {
    final simulated = _isSimulatedShipment(envio);
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: _cardBg,
        title: Row(
          children: [
            const Icon(Icons.info_outline, color: _gold),
            const SizedBox(width: 8),
            Text('Detalle Envío', style: TextStyle(color: _textPrimary)),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _InfoRow(label: 'ID Envío:', value: envio['id']?.toString().substring(0, 8) ?? '—'),
              _InfoRow(label: 'Guía:', value: envio['guia'] ?? '—'),
              _InfoRow(label: 'Transportadora:', value: envio['transportadora'] ?? '—'),
              _InfoRow(label: 'Estado:', value: _estadoLabel(envio['estado'])),
              _InfoRow(label: 'Servicio:', value: envio['carrier_service_code'] ?? '—'),
              if (simulated)
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Text(
                    'SIMULADO: esta guía no es válida ante una transportadora.',
                    style: TextStyle(color: Colors.orangeAccent),
                  ),
                ),
              if (!simulated && envio['label_pdf_url'] != null) ...[
                const SizedBox(height: 8),
                ElevatedButton.icon(
                  icon: const Icon(Icons.picture_as_pdf),
                  label: const Text('Ver Etiqueta PDF'),
                  style: ElevatedButton.styleFrom(backgroundColor: _gold, foregroundColor: _darkBg),
                  onPressed: () => _openLabelPdf(envio['label_pdf_url']),
                ),
              ],
              if (envio['pickup_scheduled_at'] != null) ...[
                const SizedBox(height: 8),
                _InfoRow(label: 'Recolección programada:', value: _formatDateTime(DateTime.parse(envio['pickup_scheduled_at']))),
              ],
              if (envio['pickup_confirmed_at'] != null) ...[
                _InfoRow(label: 'Recolección confirmada:', value: _formatDateTime(DateTime.parse(envio['pickup_confirmed_at']))),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text('Cerrar', style: TextStyle(color: _gold)),
          ),
        ],
      ),
    );
  }

  Future<DateTime?> _showDateTimePicker(String title, DateTime initial) async {
    final date = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 30)),
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: ColorScheme.dark(
            primary: _gold,
            onPrimary: _darkBg,
            surface: _cardBg,
            onSurface: _textPrimary,
          ),
        ),
        child: child!,
      ),
    );
    if (date == null) return null;

    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial),
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: ColorScheme.dark(
            primary: _gold,
            onPrimary: _darkBg,
            surface: _cardBg,
            onSurface: _textPrimary,
          ),
        ),
        child: child!,
      ),
    );
    if (time == null) return null;

    return DateTime(date.year, date.month, date.day, time.hour, time.minute);
  }

  Future<bool> _showConfirmDialog(String title, String message) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: _cardBg,
        title: Text(title, style: TextStyle(color: _textPrimary)),
        content: Text(message, style: TextStyle(color: _textMuted)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text('Cancelar', style: TextStyle(color: _textMuted)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(backgroundColor: _gold, foregroundColor: _darkBg),
            child: const Text('Confirmar'),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  void _showLoadingDialog(String message) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => AlertDialog(
        backgroundColor: _cardBg,
        content: Row(
          children: [
            CircularProgressIndicator(color: _gold),
            const SizedBox(width: 16),
            Expanded(child: Text(message, style: TextStyle(color: _textPrimary))),
          ],
        ),
      ),
    );
  }

  void _showSnack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message, style: TextStyle(color: _textPrimary)),
        backgroundColor: _cardBg,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }

  String _estadoLabel(String? estado) {
    switch (estado) {
      case 'CREADO': return '📝 Creado';
      case 'RECOGIDO': return '📦 Recogido';
      case 'EN_TRANSITO': return '🚚 En tránsito';
      case 'EN_CENTRO_DESTINO': return '🏢 Centro destino';
      case 'SALIDA_ENTREGA': return '🚛 Salida entrega';
      case 'ENTREGADO': return '✅ Entregado';
      case 'FALLIDO': return '❌ Fallido';
      case 'DEVUELTO': return '↩️ Devuelto';
      default: return estado ?? '—';
    }
  }

  String _formatDateTime(DateTime dt) {
    return '${dt.day.toString().padLeft(2, '0')}/${dt.month.toString().padLeft(2, '0')}/${dt.year} '
           '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _darkBg,
      appBar: AppBar(
        title: const Text('Fulfillment', style: TextStyle(color: _textPrimary, fontWeight: FontWeight.w600)),
        backgroundColor: _darkBg,
        elevation: 0,
        iconTheme: IconThemeData(color: _textPrimary),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: _gold),
            onPressed: _loadOrders,
            tooltip: 'Actualizar',
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: _gold))
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.error_outline, size: 64, color: Colors.red[300]),
                      const SizedBox(height: 16),
                      Text(_error!, style: TextStyle(color: _textMuted), textAlign: TextAlign.center),
                      const SizedBox(height: 16),
                      ElevatedButton.icon(
                        icon: const Icon(Icons.refresh),
                        label: const Text('Reintentar'),
                        style: ElevatedButton.styleFrom(backgroundColor: _gold, foregroundColor: _darkBg),
                        onPressed: _loadOrders,
                      ),
                    ],
                  ),
                )
              : _orders.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.inventory_2_outlined, size: 64, color: _textMuted.withOpacity(0.5)),
                          const SizedBox(height: 16),
                          Text('No hay pedidos por despachar', style: TextStyle(color: _textMuted, fontSize: 18)),
                          const SizedBox(height: 8),
                          Text('Los pedidos PAGADO aparecerán aquí automáticamente', style: TextStyle(color: _textMuted.withOpacity(0.7))),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _loadOrders,
                      color: _gold,
                      backgroundColor: _cardBg,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _orders.length,
                        itemBuilder: (context, index) => _OrderCard(
                          order: _orders[index],
                          onPrepare: _prepareItems,
                          onGenerateLabel: _generateLabel,
                          onSchedulePickup: _schedulePickup,
                          onDispatch: _dispatchOrder,
                          onViewDetail: _viewEnvioDetail,
                        ),
                      ),
                    ),
    );
  }
}

class _OrderCard extends StatelessWidget {
  final FulfillmentOrder order;
  final Future<void> Function(FulfillmentOrder) onPrepare;
  final Future<void> Function(FulfillmentOrder) onGenerateLabel;
  final Future<void> Function(FulfillmentOrder) onSchedulePickup;
  final Future<void> Function(FulfillmentOrder) onDispatch;
  final Future<void> Function(FulfillmentOrder) onViewDetail;

  const _OrderCard({
    required this.order,
    required this.onPrepare,
    required this.onGenerateLabel,
    required this.onSchedulePickup,
    required this.onDispatch,
    required this.onViewDetail,
  });

  static const Color _gold = Color(0xFFD4A843);
  static const Color _darkBg = Color(0xFF1A1A2E);
  static const Color _cardBg = Color(0xFF252542);
  static const Color _textPrimary = Color(0xFFFFFFFF);
  static const Color _textMuted = Color(0xFFB0B0C8);

  @override
  Widget build(BuildContext context) {
    final canGenerateLabel = order.envioId == null || order.trackingNumber == null;
    final canSchedulePickup = order.trackingNumber != null && order.envioEstado == 'CREADO';
    final canDispatch = order.envioEstado == 'CREADO' || order.envioEstado == 'RECOGIDO';
    final hasEnvio = order.envioId != null;

    return Card(
      color: _cardBg,
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: _gold.withOpacity(0.3)),
      ),
      elevation: 2,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: _gold.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: _gold.withOpacity(0.5)),
                  ),
                  child: Text(
                    order.shortId,
                    style: TextStyle(
                      color: _gold,
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                      fontFamily: 'Manrope',
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    order.nombreEntrega,
                    style: TextStyle(color: _textPrimary, fontWeight: FontWeight.w600, fontSize: 15),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                _StatusBadge(estado: order.envioEstado ?? 'SIN_ENVIO'),
              ],
            ),
            const SizedBox(height: 12),

            // Info
            Row(
              children: [
                Expanded(
                  child: _InfoChip(
                    icon: Icons.location_on_outlined,
                    label: '${order.ciudad}, ${order.departamento}',
                    value: order.direccionEntrega,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _InfoChip(
                    icon: Icons.payments_outlined,
                    label: 'Total',
                    value: '\$${order.total.toStringAsFixed(0).replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]}.')} COP',
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Items
            Text('Productos (${order.items.length}):', style: TextStyle(color: _textMuted, fontSize: 12, fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            ...order.items.take(3).map((item) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${item['nombre']} ×${item['cantidad']}',
                          style: TextStyle(color: _textPrimary, fontSize: 13),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Text(
                        '\$${(item['precio_unitario'] as num).toStringAsFixed(0).replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]}.')}',
                        style: TextStyle(color: _textMuted, fontSize: 12),
                      ),
                    ],
                  ),
                )),
            if (order.items.length > 3)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text('... y ${order.items.length - 3} más', style: TextStyle(color: _textMuted, fontSize: 12)),
              ),
            const SizedBox(height: 16),

            // Acciones
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (canGenerateLabel)
                  ElevatedButton.icon(
                    icon: const Icon(Icons.local_shipping_outlined, size: 18),
                    label: const Text('Etiquetar'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _gold,
                      foregroundColor: _darkBg,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    onPressed: () => onGenerateLabel(order),
                  )
                else if (canSchedulePickup)
                  ElevatedButton.icon(
                    icon: const Icon(Icons.schedule_send, size: 18),
                    label: const Text('Programar recolección'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.blue[700]!,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    onPressed: () => onSchedulePickup(order),
                  )
                else if (canDispatch)
                  ElevatedButton.icon(
                    icon: const Icon(Icons.local_shipping, size: 18),
                    label: const Text('Despachar'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.green[700]!,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    onPressed: () => onDispatch(order),
                  ),
                if (hasEnvio)
                  OutlinedButton.icon(
                    icon: const Icon(Icons.visibility_outlined, size: 18),
                    label: const Text('Ver envío'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: _gold,
                      side: BorderSide(color: _gold),
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    onPressed: () => onViewDetail(order),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  final String estado;
  const _StatusBadge({required this.estado});

  static const Color _gold = Color(0xFFD4A843);
  static const Color _darkBg = Color(0xFF1A1A2E);
  static const Color _textPrimary = Color(0xFFFFFFFF);

  @override
  Widget build(BuildContext context) {
    Color bgColor;
    String label;
    switch (estado) {
      case 'CREADO':
        bgColor = Colors.blue[900]!; label = '📝 Etiqueta';
        break;
      case 'RECOGIDO':
        bgColor = Colors.orange[900]!; label = '📦 Recogido';
        break;
      case 'EN_TRANSITO':
        bgColor = Colors.purple[900]!; label = '🚚 Tránsito';
        break;
      case 'EN_CENTRO_DESTINO':
        bgColor = Colors.indigo[900]!; label = '🏢 Centro';
        break;
      case 'SALIDA_ENTREGA':
        bgColor = Colors.teal[900]!; label = '🚛 Entrega';
        break;
      case 'ENTREGADO':
        bgColor = Colors.green[900]!; label = '✅ Entregado';
        break;
      case 'FALLIDO':
        bgColor = Colors.red[900]!; label = '❌ Fallido';
        break;
      case 'DEVUELTO':
        bgColor = Colors.grey[800]!; label = '↩️ Devuelto';
        break;
      default:
        bgColor = Colors.grey[800]!; label = '❓ Sin envío';
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bgColor, borderRadius: BorderRadius.circular(8)),
      child: Text(label, style: const TextStyle(color: _textPrimary, fontSize: 11, fontWeight: FontWeight.w600)),
    );
  }
}

class _InfoChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  const _InfoChip({required this.icon, required this.label, required this.value});

  static const Color _gold = Color(0xFFD4A843);
  static const Color _cardBg = Color(0xFF252542);
  static const Color _textPrimary = Color(0xFFFFFFFF);
  static const Color _textMuted = Color(0xFFB0B0C8);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: _cardBg, borderRadius: BorderRadius.circular(10)),
      child: Row(
        children: [
          Icon(icon, color: _gold, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: TextStyle(color: _textMuted, fontSize: 10, fontWeight: FontWeight.w600)),
                Text(value, style: TextStyle(color: _textPrimary, fontSize: 12), overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  const _InfoRow({required this.label, required this.value});

  static const Color _gold = Color(0xFFD4A843);
  static const Color _textPrimary = Color(0xFFFFFFFF);
  static const Color _textMuted = Color(0xFFB0B0C8);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(label, style: TextStyle(color: _textMuted, fontSize: 13, fontWeight: FontWeight.w600)),
          ),
          Expanded(child: Text(value, style: TextStyle(color: _textPrimary, fontSize: 13))),
        ],
      ),
    );
  }
}

class FulfillmentOrder {
  final String id;
  final String estado;
  final double total;
  final DateTime pagadoEn;
  final String nombreEntrega;
  final String direccionEntrega;
  final String ciudad;
  final String departamento;
  final String? codigoPostal;
  final List<dynamic> items;
  final bool tieneEnvio;
  final String? envioId;
  final String? envioEstado;
  final String? transportadora;

  String get shortId => id.length > 8 ? id.substring(0, 8).toUpperCase() : id.toUpperCase();
  String get trackingNumber => envioId ?? '';
  double get estimatedWeightKg => items.fold(0.0, (sum, item) => sum + ((item['peso_estimado_kg'] as num?)?.toDouble() ?? 0.5) * ((item['cantidad'] as num?)?.toDouble() ?? 1));

  FulfillmentOrder({
    required this.id,
    required this.estado,
    required this.total,
    required this.pagadoEn,
    required this.nombreEntrega,
    required this.direccionEntrega,
    required this.ciudad,
    required this.departamento,
    this.codigoPostal,
    required this.items,
    required this.tieneEnvio,
    this.envioId,
    this.envioEstado,
    this.transportadora,
  });

  factory FulfillmentOrder.fromJson(Map<String, dynamic> json) {
    return FulfillmentOrder(
      id: json['id'] as String,
      estado: json['estado'] as String,
      total: (json['total'] as num).toDouble(),
      pagadoEn: DateTime.parse(json['pagado_en'] as String),
      nombreEntrega: json['nombre_entrega'] as String,
      direccionEntrega: json['direccion_entrega'] as String,
      ciudad: json['ciudad'] as String,
      departamento: json['departamento'] as String,
      codigoPostal: json['codigo_postal'] as String?,
      items: (json['items'] as List?) ?? [],
      tieneEnvio: json['tiene_envio'] as bool? ?? false,
      envioId: json['envio_id'] as String?,
      envioEstado: json['envio_estado'] as String?,
      transportadora: json['transportadora'] as String?,
    );
  }
}
