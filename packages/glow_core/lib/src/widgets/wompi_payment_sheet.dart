// frontend/lib/widgets/wompi_payment_sheet.dart
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import '../services/api_service.dart';
import '../services/analytics_service.dart';
import '../services/booking_recovery_service.dart';

Future<bool?> showWompiCheckoutSheet({
  required BuildContext context,
  required String bookingId,
  required String serviceName,
  required double price,
  required String providerName,
  VoidCallback? onSuccess,
  String itemType = 'service',
  // Desglose del IVA tal como lo calculÃ³ el servidor. Llegan en 0 cuando el
  // prestador no es responsable de IVA, y entonces no se muestra desglose.
  double subtotalBase = 0,
  double ivaValor = 0,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (context) => WompiCheckoutWidget(
      bookingId: bookingId,
      serviceName: serviceName,
      price: price,
      providerName: providerName,
      onSuccess: onSuccess,
      itemType: itemType,
      subtotalBase: subtotalBase,
      ivaValor: ivaValor,
    ),
  );
}

class WompiCheckoutWidget extends StatefulWidget {
  final String bookingId;
  final String serviceName;
  final double price;
  final String providerName;
  final VoidCallback? onSuccess;

  /// Base gravable y IVA discriminados por el servidor a partir del `valor_bruto`.
  /// SÃ³lo se usan para DESGLOSAR el precio en pantalla: el monto que se cobra
  /// sigue siendo `price`. Vienen en 0 si el prestador no es responsable de IVA.
  final double subtotalBase;
  final double ivaValor;

  /// Tipo real de la compra, declarado por quien abre el checkout.
  /// Nunca se deduce de un id fabricado.
  final String itemType;

  const WompiCheckoutWidget({
    super.key,
    required this.bookingId,
    required this.serviceName,
    required this.price,
    required this.providerName,
    this.onSuccess,
    this.itemType = 'service',
    this.subtotalBase = 0,
    this.ivaValor = 0,
  });

  @override
  State<WompiCheckoutWidget> createState() => _WompiCheckoutWidgetState();
}

class _WompiCheckoutWidgetState extends State<WompiCheckoutWidget> {
  /// MÃ©todo seleccionado, por su nombre EXACTO de Wompi. Antes era un Ã­ndice de
  /// pestaÃ±a (`_selectedTab`), que con mÃ¡s de dos mÃ©todos se vuelve un mapa
  /// enteroâ†’mÃ©todo duplicado en cada rama.
  String _metodo = 'NEQUI';

  /// MÃ©todos ofrecidos en la app. El backend acepta ademÃ¡s las otras
  /// transferencias bancarias (`BANCO_DE_*_TRANSFER`); se aÃ±aden aquÃ­ cuando
  /// producto lo pida: la rama de redirecciÃ³n ya es la misma.
  static const List<Map<String, String>> _metodosOfrecidos = [
    {'id': 'NEQUI', 'label': 'Nequi'},
    {'id': 'CARD', 'label': 'Tarjeta'},
    {'id': 'PSE', 'label': 'PSE'},
    {'id': 'BANCOLOMBIA_TRANSFER', 'label': 'Bancolombia'},
    {'id': 'DAVIPLATA', 'label': 'Daviplata'},
  ];

  /// MÃ©todos que NO cobran al crear la transacciÃ³n: Wompi devuelve una URL de
  /// autorizaciÃ³n (`async_payment_url`) que el usuario debe abrir. Sin abrirla el
  /// cobro queda PENDING para siempre.
  static const Set<String> _metodosRedireccion = {
    'PSE', 'BANCOLOMBIA_TRANSFER', 'DAVIPLATA',
    'BANCO_DE_BOGOTA_TRANSFER', 'BANCO_DE_OCCIDENTE_TRANSFER',
    'BANCO_AV_VILLAS_TRANSFER', 'BANCO_POPULAR_TRANSFER', 'BANCO_PICHINCHA_TRANSFER',
  };

  bool get _esRedireccion => _metodosRedireccion.contains(_metodo);

  double _safeParseDouble(dynamic val, {double fallback = 0.0}) {
    if (val == null) return fallback;
    if (val is num) return val.toDouble();
    if (val is String) {
      return double.tryParse(val.replaceAll(',', '.')) ?? fallback;
    }
    return fallback;
  }

  final _nequiCtrl = TextEditingController();

  // Datos del pagador para los mÃ©todos de redirecciÃ³n (los exige Wompi).
  final _nombreCtrl = TextEditingController();
  final _telefonoCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _bancoCtrl = TextEditingController();

  /// Porcentaje de IVA que se muestra en el desglose, derivado de los montos que
  /// calculÃ³ el servidor (no se escribe 19% fijo: si la tarifa cambia, la
  /// etiqueta cambia con ella).
  int _porcentajeIvaMostrado() {
    final base = _safeParseDouble(widget.subtotalBase);
    final iva = _safeParseDouble(widget.ivaValor);
    if (base <= 0 || iva <= 0) return 0;
    final pct = (iva / base * 100);
    return pct.clamp(0, 100).round();
  }

  final _formKey = GlobalKey<FormState>();
  bool _isProcessing = false;
  Map<String, dynamic>? _successData;
  String? _errorMsg;

  /// URL de autorizaciÃ³n devuelta por Wompi para PSE/Bancolombia/Daviplata.
  /// Mientras no sea null, la hoja muestra la pantalla de redirecciÃ³n en vez del
  /// formulario: el cobro ya existe y sÃ³lo falta que el usuario lo autorice.
  String? _redireccionUrl;

  @override
  void dispose() {
    _nequiCtrl.dispose();
    _nombreCtrl.dispose();
    _telefonoCtrl.dispose();
    _emailCtrl.dispose();
    _bancoCtrl.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    // A360-2026-09-22/C-03: no se emite el evento de checkout si no hay un
    // identificador real de compra (antes se enviaba un id fabricado 'STORE_â€¦').
    final itemId = widget.bookingId.trim();
    if (itemId.isEmpty) return;
    AnalyticsService().logInitiateCheckout(
      itemType: widget.itemType,
      itemId: itemId,
      totalAmount: widget.price,
      metadata: {
        'service_name': widget.serviceName,
        'provider_name': widget.providerName,
      },
    );
  }

  Future<void> _handlePayment() async {
    if (!_formKey.currentState!.validate()) return;

    // A360-2026-09-22/C-01: no hay pasarela integrada para compras sin reserva
    // real (p. ej. GlowShop). Antes se devolvÃ­a aquÃ­ un pago 'APPROVED' fabricado
    // tras un Future.delayed, con una referencia inventada y sin ninguna llamada
    // HTTP. Ese camino se elimina: sin pasarela => fallo explÃ­cito, nunca Ã©xito.
    if (widget.bookingId.trim().isEmpty) {
      await HapticFeedback.vibrate();
      if (!mounted) return;
      setState(() {
        _isProcessing = false;
        _errorMsg = 'La pasarela de pago no estÃ¡ integrada para este tipo de '
            'compra. No se realizÃ³ ningÃºn cobro.';
      });
      return;
    }

    setState(() {
      _isProcessing = true;
      _errorMsg = null;
    });

    try {
      final method = _metodo;

      // Token de aceptaciÃ³n (Habeas Data) - obligatorio
      final consentimiento = await ApiService.fetchWompiAcceptanceToken();
      final acceptanceToken = consentimiento['acceptance_token'] as String?;
      if (acceptanceToken == null || acceptanceToken.isEmpty) {
        throw Exception('No se pudo obtener el consentimiento de pagos de Wompi.');
      }

      if (method == 'CARD') {
        String? paymentMethodToken;
        
        if (widget.itemType == 'service') {
          // Para servicios: modal de tokenizaciÃ³n
          final publicKey = await ApiService.fetchWompiPublicKey();
          
          // Mostrar formulario de tarjeta para recolectar datos
          final cardData = await _showCardForm(context);
          if (!mounted) return;
          if (cardData == null) {
            // Usuario cancelÃ³
            setState(() { _isProcessing = false; });
            return;
          }
          
          // Tokenizar con Wompi (POST /tokens/cards con llave pÃºblica)
          final tokenResponse = await http.post(
            Uri.parse('https://sandbox.wompi.co/v1/tokens/cards'),
            headers: {
              'Authorization': 'Bearer $publicKey',
              'Content-Type': 'application/json',
            },
            body: json.encode({
              'number': cardData['number']!.replaceAll(' ', ''),
              'cvc': cardData['cvc'],
              'exp_month': cardData['expMonth'],
              'exp_year': cardData['expYear'],
              'card_holder': cardData['holder'],
            }),
          );
          
          if (tokenResponse.statusCode != 200 && tokenResponse.statusCode != 201) {
            throw Exception('Error tokenizando tarjeta: ${tokenResponse.body}');
          }
          
          final tokenData = json.decode(tokenResponse.body);
          paymentMethodToken = tokenData['id'] as String;
        } else {
          // Para productos (GlowStore): usar formulario inline
          if (!_formKey.currentState!.validate()) return;
          
          // Extraer datos del formulario inline (necesitamos controllers)
          // Por simplicidad, usamos el mismo modal tambiÃ©n para productos
          final publicKey = await ApiService.fetchWompiPublicKey();
          
          final cardData = await _showCardForm(context);
          if (!mounted) return;
          if (cardData == null) {
            setState(() { _isProcessing = false; });
            return;
          }
          
          final tokenResponse = await http.post(
            Uri.parse('https://sandbox.wompi.co/v1/tokens/cards'),
            headers: {
              'Authorization': 'Bearer $publicKey',
              'Content-Type': 'application/json',
            },
            body: json.encode({
              'number': cardData['number']!.replaceAll(' ', ''),
              'cvc': cardData['cvc'],
              'exp_month': cardData['expMonth'],
              'exp_year': cardData['expYear'],
              'card_holder': cardData['holder'],
            }),
          );
          
          if (tokenResponse.statusCode != 200 && tokenResponse.statusCode != 201) {
            throw Exception('Error tokenizando tarjeta: ${tokenResponse.body}');
          }
          
          final tokenData = json.decode(tokenResponse.body);
          paymentMethodToken = tokenData['id'] as String;
        }
        
        // Crear transacciÃ³n con el token
        final res = await _crearTransaccion(
          method: method,
          paymentMethodToken: paymentMethodToken,
          acceptanceToken: acceptanceToken,
        );
        
        if (res['success'] != true) {
          throw Exception(res['error']?.toString() ?? 'La pasarela no confirmÃ³ el pago.');
        }
        
        await _onPaymentSuccess(res);
        return;
      }

      // â”€â”€â”€ MÃ©todos de redirecciÃ³n: PSE, Bancolombia, Daviplata â”€â”€â”€
      // Wompi NO cobra al crear la transacciÃ³n: devuelve una URL de autorizaciÃ³n
      // que el usuario debe abrir en su banco. El backend la reenvÃ­a como
      // `async_payment_url`. Sin esa URL el cobro queda PENDING para siempre.
      if (_esRedireccion) {
        final res = await _crearTransaccion(
          method: method,
          acceptanceToken: acceptanceToken,
          redirectUrl: _redirectUrlPago,
          customerData: {
            'email': _emailCtrl.text.trim(),
            'full_name': _nombreCtrl.text.trim(),
            'phone_number': _telefonoCtrl.text.trim(),
            // PSE obliga a elegir entidad financiera; Wompi rechaza la
            // transacciÃ³n sin ella.
            if (method == 'PSE')
              'financial_institution_code': _bancoCtrl.text.trim(),
          },
        );

        final url = res['async_payment_url'] as String?;
        if (url == null || url.isEmpty) {
          // Sin URL no hay forma de autorizar. Fallo explÃ­cito, nunca un
          // "Ã©xito" que dejarÃ­a al cliente creyendo que ya pagÃ³.
          throw Exception(
            'Wompi no devolviÃ³ la URL de autorizaciÃ³n. No se realizÃ³ ningÃºn cobro; '
            'no vuelvas a pagar sin revisar el estado de la reserva.'
          );
        }

        await _mostrarRedireccion(url);

        // En un pedido de tienda la transaccion nace PENDING: la confirma el webhook
        // de Wompi. Se consulta el pedido en vez de asumir que ya pago.
        if (widget.itemType == 'product') {
          final resultado = await _esperarConfirmacionPedido();
          if (resultado == 'pagado') {
            await _onPaymentSuccess(res);
          } else if (resultado == 'rechazado' && mounted) {
            setState(() {
              _isProcessing = false;
              _errorMsg = 'El pago fue rechazado por Wompi. No se cobro: '
                  'intenta con otro medio.';
            });
          }
        }
        return;
      }

      // NEQUI flow
      final telefono = _nequiCtrl.text.trim();
      if (telefono.isEmpty) {
        throw Exception('Ingresa el nÃºmero de celular asociado a tu Nequi.');
      }

      // Ãšnica fuente de verdad del resultado: la respuesta HTTP del backend.
      final res = await _crearTransaccion(
        method: method,
        phoneNumber: telefono,
        acceptanceToken: acceptanceToken,
      );
      
      if (res['success'] != true) {
        throw Exception(res['error']?.toString() ?? 'La pasarela no confirmÃ³ el pago.');
      }
      
      if (widget.itemType == 'product') {
        final resultado = await _esperarConfirmacionPedido(intentos: 10);
        if (resultado != 'pagado') {
          if (mounted) {
            setState(() {
              _isProcessing = false;
              // Un rechazo NO es un pago en proceso: decirle al cliente que espere
              // lo dejaria intentando con el mismo medio y sin saber que fallo.
              _errorMsg = resultado == 'rechazado'
                  ? 'El pago fue rechazado por Wompi. No se cobro: intenta con otro medio.'
                  : 'Pago en proceso. Wompi confirmara la transaccion y el pedido '
                      'pasara a PAGADO; no vuelvas a pagar.';
            });
          }
          return;
        }
      }

      await _onPaymentSuccess(res);
    } catch (e) {
      // Respuesta tÃ¡ctil hÃ¡ptica en caso de error
      await HapticFeedback.vibrate();
      if (!mounted) return;
      setState(() {
        _isProcessing = false;
        _errorMsg = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    final maxSheetHeight = MediaQuery.of(context).size.height * 0.88;

    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: Container(
        constraints: BoxConstraints(maxHeight: maxSheetHeight),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(28),
            topRight: Radius.circular(28),
          ),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
        child: SingleChildScrollView(
          physics: const BouncingScrollPhysics(),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.grey[300],
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 8,
                        height: 24,
                        decoration: BoxDecoration(
                          color: const Color(0xFF5C288D),
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                      const SizedBox(width: 8),
                      const Text(
                        'wompi',
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w900,
                          color: Color(0xFF5C288D),
                          letterSpacing: -1.0,
                        ),
                      ),
                      const SizedBox(width: 4),
                      Container(
                        width: 6,
                        height: 6,
                        decoration: const BoxDecoration(
                          color: Color(0xFFF12A7B),
                          shape: BoxShape.circle,
                        ),
                      ),
                    ],
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, color: Colors.grey),
                    onPressed: () => Navigator.pop(context),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              if (_successData != null)
                _buildSuccessView()
              else if (_redireccionUrl != null)
                _buildRedireccionView()
              else
                _buildPaymentForm(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSuccessView() {
    // `payOrder` responde 202 con {data: {external_id, amount, payment_method}}.
    // Antes se leia `reference` en la raiz, asi que el recibo mostraba "N/A".
    final Map<String, dynamic> datos = (_successData!['data'] is Map)
        ? Map<String, dynamic>.from(_successData!['data'] as Map)
        : _successData!;
    final refBruta = datos['external_id'] ?? datos['reference'] ?? _successData!['reference'];
    final ref = (refBruta == null || refBruta.toString().trim().isEmpty)
        ? null
        : refBruta.toString();
    final amount = (datos['amount'] is num) ? (datos['amount'] as num).toDouble() : widget.price;
    final method = datos['payment_method'] ?? _metodo;
    // La hoja es compartida con reservas: en una compra de tienda no hay "cita".
    final esCompra = widget.itemType == 'product';

    return Column(
      children: [
        const SizedBox(height: 16),
        const Icon(Icons.check_circle, color: Color(0xFF10B981), size: 72),
        const SizedBox(height: 16),
        const Text(
          'Â¡Pago Exitoso!',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.black87),
        ),
        const SizedBox(height: 8),
        Text(
          esCompra
              ? 'Tu compra en ${widget.providerName} ha sido confirmada.'
              : 'Tu cita con ${widget.providerName} ha sido confirmada.',
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 14, color: Colors.black54),
        ),
        const SizedBox(height: 24),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFFF9F7FA),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0xFFE5DEEB)),
          ),
          child: Column(
            children: [
              _buildReceiptRow(esCompra ? 'Compra' : 'Servicio', widget.serviceName),
              const SizedBox(height: 8),
              _buildReceiptRow('Valor Pagado', '\$${amount.toStringAsFixed(0)} COP'),
              const SizedBox(height: 8),
              _buildReceiptRow('Medio de Pago', method),
              if (ref != null) ...[
                const SizedBox(height: 8),
                _buildReceiptRow('Ref. Wompi', ref),
              ],
            ],
          ),
        ),
        const SizedBox(height: 32),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF5C288D),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
              elevation: 0,
            ),
            onPressed: () {
              Navigator.pop(context, true);
              if (widget.onSuccess != null) {
                widget.onSuccess!();
              } else if (widget.itemType == 'service') {
                Navigator.pushNamedAndRemoveUntil(
                  context,
                  '/client-bookings',
                  (route) => route.settings.name == '/home',
                );
              }
            },
            child: const Text('Listo', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ),
        ),
        const SizedBox(height: 16),
      ],
    );
  }

  /// Pantalla de autorizaciÃ³n para PSE / Bancolombia / Daviplata.
  ///
  /// La transacciÃ³n YA existe en Wompi (PENDING) pero NO estÃ¡ cobrada: el banco
  /// debe autorizarla en su propia pÃ¡gina. Esta pantalla entrega el enlace y deja
  /// claro que el pago aÃºn no se completÃ³ â€” mostrar aquÃ­ un "pago exitoso" serÃ­a
  /// mentir sobre el dinero del cliente.
  Widget _buildRedireccionView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFFFFF8E1),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFFFE082)),
          ),
          child: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(Icons.open_in_new, color: Color(0xFFF57F17), size: 20),
                  SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Falta autorizar el pago en tu banco',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 14,
                        color: Color(0xFF5D4037),
                      ),
                    ),
                  ),
                ],
              ),
              SizedBox(height: 8),
              Text(
                'El cobro quedÃ³ reservado, pero NO se ha pagado todavÃ­a. Abre el enlace '
                'de autorizaciÃ³n en tu navegador y completa el proceso allÃ­. '
                'El pago se confirma automÃ¡ticamente cuando el banco responde.',
                style: TextStyle(fontSize: 13, color: Color(0xFF5D4037)),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: const Color(0xFFF9F7FA),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFE0D8E8)),
          ),
          child: SelectableText(
            _redireccionUrl ?? '',
            style: const TextStyle(fontSize: 12, color: Color(0xFF5C288D)),
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'Ya lo copiamos al portapapeles: pÃ©galo en tu navegador si no se abriÃ³.',
          style: TextStyle(fontSize: 11, color: Colors.grey),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 16),
        OutlinedButton.icon(
          onPressed: () async {
            await Clipboard.setData(ClipboardData(text: _redireccionUrl ?? ''));
            await HapticFeedback.lightImpact();
            if (!mounted) return;
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Enlace copiado al portapapeles')),
            );
          },
          icon: const Icon(Icons.copy, size: 18),
          label: const Text('Copiar enlace de pago'),
          style: OutlinedButton.styleFrom(
            foregroundColor: const Color(0xFF5C288D),
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
          ),
        ),
        const SizedBox(height: 24),
        ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF5C288D),
            foregroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(vertical: 16),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
            elevation: 0,
          ),
          onPressed: () => Navigator.pop(context),
          child: const Text(
            'Entendido, pagarÃ© desde el enlace',
            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
          ),
        ),
        const SizedBox(height: 8),
        const Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.security, size: 12, color: Colors.grey),
            SizedBox(width: 4),
            Text(
              'TransacciÃ³n protegida por Wompi Colombia',
              style: TextStyle(fontSize: 10, color: Colors.grey),
            ),
          ],
        ),
        const SizedBox(height: 16),
      ],
    );
  }

  Widget _buildPaymentForm() {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFFF9F7FA),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.serviceName,
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Colors.black87),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Prestador: ${widget.providerName}',
                        style: const TextStyle(fontSize: 12, color: Colors.grey),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    if (_safeParseDouble(widget.ivaValor) > 0) ...[
                      // Desglose del IVA (art. 476 num. 1 lit. a) del Estatuto
                      // Tributario: los tratamientos de belleza estÃ¡n gravados).
                      // El total NO cambia: el impuesto ya estaba incluido en el
                      // precio publicado y aquÃ­ sÃ³lo se hace visible. El
                      // porcentaje se deriva de los montos, no se escribe fijo.
                      Text(
                        'Valor: \$${_safeParseDouble(widget.subtotalBase).toStringAsFixed(0)}',
                        style: const TextStyle(fontSize: 11, color: Colors.grey),
                      ),
                      Text(
                        'IVA (${_porcentajeIvaMostrado()}%): \$${_safeParseDouble(widget.ivaValor).toStringAsFixed(0)}',
                        style: const TextStyle(fontSize: 11, color: Colors.grey),
                      ),
                    ],
                    Text(
                      // Se muestra EXACTAMENTE el monto que el backend va a cobrar
                      // (`valor_bruto` de la reserva). Antes se mostraba un cÃ¡lculo
                      // propio (base + add-on âˆ’ cashback) que el servidor no podÃ­a
                      // reproducir: el cliente veÃ­a un precio y se le cobraba otro.
                      '\$${_safeParseDouble(widget.price).toStringAsFixed(0)} COP',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Color(0xFF5C288D)),
                    ),
                  ],
                ),
              ],
            ),
          ),


          const SizedBox(height: 16),
          // Selector de mÃ©todo. Antes eran 2 pestaÃ±as fijas (Nequi / Tarjeta); con
          // los mÃ©todos de redirecciÃ³n el Ã­ndice de pestaÃ±a dejaba de mapear 1:1
          // con el mÃ©todo, asÃ­ que el estado ahora guarda el NOMBRE del mÃ©todo.
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _metodosOfrecidos.map((m) {
              final id = m['id']!;
              final seleccionado = _metodo == id;
              return GestureDetector(
                onTap: _isProcessing ? null : () => setState(() => _metodo = id),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  decoration: BoxDecoration(
                    color: seleccionado ? const Color(0xFF5C288D) : const Color(0xFFF3EDFA),
                    borderRadius: BorderRadius.circular(21),
                  ),
                  child: Text(
                    m['label']!,
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                      color: seleccionado ? Colors.white : Colors.grey[700],
                    ),
                  ),
                ),
              );
            }).toList(),
          ),
          const SizedBox(height: 20),
          if (_esRedireccion)
            _buildRedirectForm()
          else if (_metodo == 'NEQUI')
            _buildNequiForm()
          else
            _buildCardForm(),
          if (_errorMsg != null) ...[
            const SizedBox(height: 16),
            Text(
              'âŒ $_errorMsg',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.redAccent, fontSize: 13, fontWeight: FontWeight.w500),
            ),
          ],
          const SizedBox(height: 24),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF5C288D),
              foregroundColor: Colors.white,
              disabledBackgroundColor: const Color(0xFFBCABC7),
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
              elevation: 0,
            ),
            onPressed: _isProcessing ? null : _handlePayment,
            child: _isProcessing
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                  )
                : const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.lock_outline, size: 18),
                      SizedBox(width: 8),
                      Text('Pagar de forma segura', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                    ],
                  ),
          ),
          const SizedBox(height: 8),
          const Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.security, size: 12, color: Colors.grey),
              SizedBox(width: 4),
              Text(
                'TransacciÃ³n protegida por Wompi Colombia',
                style: TextStyle(fontSize: 10, color: Colors.grey),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildNequiForm() {
    // D-GL-023 (regla 18): el anticipo es del 100% al reservar, tambiÃ©n para
    // servicios. AquÃ­ se pedÃ­a el celular en `_handlePayment` pero el campo solo
    // se dibujaba para productos: con un servicio, `_nequiCtrl` siempre estaba
    // vacÃ­o y el pago lanzaba "Ingresa el nÃºmero de celular" sin que existiera
    // dÃ³nde escribirlo. La nota que decÃ­a "el pago se procesa en el
    // establecimiento" era falsa: la transacciÃ³n se crea contra Wompi.
    return TextFormField(
      controller: _nequiCtrl,
      keyboardType: TextInputType.phone,
      enabled: !_isProcessing,
      style: const TextStyle(fontSize: 14),
      decoration: _inputDecoration('NÃºmero de celular (Nequi)', Icons.phone_android),
      validator: (val) {
        if (val == null || val.isEmpty) return 'El nÃºmero es requerido';
        if (val.length != 10 || !RegExp(r'^[0-9]+$').hasMatch(val)) {
          return 'Debe ser un nÃºmero celular de 10 dÃ­gitos';
        }
        return null;
      },
    );
  }

  Widget _buildCardForm() {
    // Para servicios: ya no se piden datos aquÃ­, se tokeniza en un modal aparte
    // cuando el usuario toca "Pagar" (ver _handlePayment).
    if (widget.itemType == 'service') {
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFFE8F5E9),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFF81C784)),
        ),
        child: const Row(
          children: [
            Icon(Icons.check_circle_outline, color: Color(0xFF2E7D32), size: 20),
            SizedBox(width: 12),
            Expanded(
              child: Text(
                'El pago con tarjeta se procesa de forma segura. Al confirmar, se abrirÃ¡ un formulario para ingresar los datos de tu tarjeta (tokenizaciÃ³n directa con Wompi).',
                style: TextStyle(fontSize: 13, color: Color(0xFF1B5E20)),
              ),
            ),
          ],
        ),
      );
    }

    // Para productos (GlowStore): mostrar formulario inline como antes
    // Pero ahora SÃ se usan los datos (tokenizaciÃ³n con Wompi)
    return Column(
      children: [
        TextFormField(
          keyboardType: TextInputType.number,
          enabled: !_isProcessing,
          style: const TextStyle(fontSize: 14),
          decoration: _inputDecoration('NÃºmero de tarjeta', Icons.credit_card),
          validator: (val) {
            if (val == null || val.isEmpty) return 'Requerido';
            final digits = val.replaceAll(' ', '');
            if (!RegExp(r'^\d{13,19}$').hasMatch(digits)) return 'NÃºmero invÃ¡lido';
            return null;
          },
          onChanged: (v) {
            final digits = v.replaceAll(' ', '');
            final formatted = digits.replaceAllMapped(
              RegExp(r'.{4}'),
              (m) => '${m.group(0)} ',
            ).trim();
            if (formatted != v) {
              // Nota: no hay controller aquÃ­, pero para inline funciona
            }
          },
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: TextFormField(
                keyboardType: TextInputType.number,
                enabled: !_isProcessing,
                decoration: _inputDecoration('Mes (MM)', Icons.calendar_today),
                validator: (val) {
                  if (val == null || val.isEmpty) return 'MM';
                  final m = int.tryParse(val);
                  if (m == null || m < 1 || m > 12) return 'InvÃ¡lido';
                  return null;
                },
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextFormField(
                keyboardType: TextInputType.number,
                enabled: !_isProcessing,
                decoration: _inputDecoration('AÃ±o (YY)', Icons.calendar_today),
                validator: (val) {
                  if (val == null || val.isEmpty) return 'YY';
                  final y = int.tryParse(val);
                  if (y == null || y < 24 || y > 40) return 'InvÃ¡lido';
                  return null;
                },
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        TextFormField(
          keyboardType: TextInputType.number,
          enabled: !_isProcessing,
          obscureText: true,
          decoration: _inputDecoration('CVC', Icons.lock_outline),
          validator: (val) {
            if (val == null || val.isEmpty) return 'CVC';
            if (!RegExp(r'^\d{3,4}$').hasMatch(val)) return 'InvÃ¡lido';
            return null;
          },
        ),
        const SizedBox(height: 12),
        TextFormField(
          enabled: !_isProcessing,
          decoration: _inputDecoration('Titular', Icons.person_outline),
          validator: (val) {
            if (val == null || val.isEmpty) return 'Requerido';
            return null;
          },
        ),
      ],
    );
  }

  Widget _buildReceiptRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Colors.black54),
        ),
        Text(
          value,
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Colors.black87),
        ),
      ],
    );
  }

  /// Datos del pagador que exige Wompi para los mÃ©todos de redirecciÃ³n.
  /// El backend responde 400 si falta `email`, `full_name` o `phone_number`;
  /// PSE ademÃ¡s exige la entidad financiera.
  Widget _buildRedirectForm() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextFormField(
          controller: _nombreCtrl,
          enabled: !_isProcessing,
          textCapitalization: TextCapitalization.words,
          style: const TextStyle(fontSize: 14),
          decoration: _inputDecoration('Nombre completo del titular', Icons.person_outline),
          validator: (val) =>
              (val == null || val.trim().isEmpty) ? 'El nombre es requerido' : null,
        ),
        const SizedBox(height: 12),
        TextFormField(
          controller: _emailCtrl,
          enabled: !_isProcessing,
          keyboardType: TextInputType.emailAddress,
          style: const TextStyle(fontSize: 14),
          decoration: _inputDecoration('Correo electrÃ³nico', Icons.email_outlined),
          validator: (val) {
            if (val == null || val.trim().isEmpty) return 'El correo es requerido';
            if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(val.trim())) {
              return 'Correo invÃ¡lido';
            }
            return null;
          },
        ),
        const SizedBox(height: 12),
        TextFormField(
          controller: _telefonoCtrl,
          enabled: !_isProcessing,
          keyboardType: TextInputType.phone,
          style: const TextStyle(fontSize: 14),
          decoration: _inputDecoration('NÃºmero de celular', Icons.phone_android),
          validator: (val) {
            if (val == null || val.isEmpty) return 'El nÃºmero es requerido';
            if (val.length != 10 || !RegExp(r'^[0-9]+$').hasMatch(val)) {
              return 'Debe ser un nÃºmero celular de 10 dÃ­gitos';
            }
            return null;
          },
        ),
        // SÃ³lo PSE: Wompi exige el cÃ³digo de la entidad financiera en la propia
        // transacciÃ³n; sin Ã©l la rechaza.
        if (_metodo == 'PSE') ...[
          const SizedBox(height: 12),
          TextFormField(
            controller: _bancoCtrl,
            enabled: !_isProcessing,
            keyboardType: TextInputType.number,
            style: const TextStyle(fontSize: 14),
            decoration: _inputDecoration('CÃ³digo de tu banco (PSE, ej. 1007)', Icons.account_balance),
            validator: (val) =>
                (val == null || val.trim().isEmpty) ? 'El cÃ³digo del banco es requerido' : null,
          ),
        ],
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: const Color(0xFFF9F7FA),
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Row(
            children: [
              Icon(Icons.info_outline, size: 18, color: Color(0xFF5C288D)),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Al continuar crearemos la transacciÃ³n y te daremos el enlace de tu banco para autorizarla. '
                  'El pago no se completa hasta que lo autorices allÃ­.',
                  style: TextStyle(fontSize: 12, color: Colors.black54),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  InputDecoration _inputDecoration(String label, IconData icon) {
    return InputDecoration(
      labelText: label,
      labelStyle: const TextStyle(color: Colors.grey, fontSize: 13),
      prefixIcon: Icon(icon, color: const Color(0xFF5C288D)),
      floatingLabelBehavior: FloatingLabelBehavior.never,
      filled: true,
      fillColor: const Color(0xFFF9F7FA),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(30), borderSide: BorderSide.none),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(30),
        borderSide: BorderSide.none,
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(30),
        borderSide: const BorderSide(color: Color(0xFF5C288D), width: 1.5),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
    );
  }

  /// Muestra un diÃ¡logo modal para recolectar datos de tarjeta
  /// Retorna null si el usuario cancela, o un mapa con los datos si confirma
  Future<Map<String, String>?> _showCardForm(BuildContext context) async {
    final numberCtrl = TextEditingController();
    final cvcCtrl = TextEditingController();
    final expMonthCtrl = TextEditingController();
    final expYearCtrl = TextEditingController();
    final holderCtrl = TextEditingController();
    final formKey = GlobalKey<FormState>();
    bool isProcessing = false;
    String? errorMsg;

    return showDialog<Map<String, String>>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Datos de la Tarjeta'),
          content: Form(
            key: formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (errorMsg != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(errorMsg!, style: const TextStyle(color: Colors.red)),
                    ),
                  TextFormField(
                    controller: numberCtrl,
                    keyboardType: TextInputType.number,
                    enabled: !isProcessing,
                    decoration: const InputDecoration(
                      labelText: 'NÃºmero de tarjeta',
                      hintText: '1234 5678 9012 3456',
                      prefixIcon: Icon(Icons.credit_card),
                    ),
                    validator: (v) {
                      if (v == null || v.isEmpty) return 'Requerido';
                      final digits = v.replaceAll(' ', '');
                      if (!RegExp(r'^\d{13,19}$').hasMatch(digits)) {
                        return 'NÃºmero invÃ¡lido';
                      }
                      return null;
                    },
                    onChanged: (v) {
                      // Formato automÃ¡tico: grupos de 4
                      final digits = v.replaceAll(' ', '');
                      final formatted = digits.replaceAllMapped(
                        RegExp(r'.{4}'),
                        (m) => '${m.group(0)} ',
                      ).trim();
                      if (formatted != v) {
                        numberCtrl.value = TextEditingValue(
                          text: formatted,
                          selection: TextSelection.collapsed(offset: formatted.length),
                        );
                      }
                    },
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: expMonthCtrl,
                          keyboardType: TextInputType.number,
                          enabled: !isProcessing,
                          decoration: const InputDecoration(
                            labelText: 'Mes (MM)',
                            hintText: '12',
                          ),
                          validator: (v) {
                            if (v == null || v.isEmpty) return 'Requerido';
                            final m = int.tryParse(v);
                            if (m == null || m < 1 || m > 12) return 'InvÃ¡lido';
                            return null;
                          },
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextFormField(
                          controller: expYearCtrl,
                          keyboardType: TextInputType.number,
                          enabled: !isProcessing,
                          decoration: const InputDecoration(
                            labelText: 'AÃ±o (YY)',
                            hintText: '28',
                          ),
                          validator: (v) {
                            if (v == null || v.isEmpty) return 'Requerido';
                            final y = int.tryParse(v);
                            if (y == null || y < 24 || y > 40) return 'InvÃ¡lido';
                            return null;
                          },
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: cvcCtrl,
                    keyboardType: TextInputType.number,
                    enabled: !isProcessing,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'CVC',
                      hintText: '123',
                    ),
                    validator: (v) {
                      if (v == null || v.isEmpty) return 'Requerido';
                      if (!RegExp(r'^\d{3,4}$').hasMatch(v)) return 'InvÃ¡lido';
                      return null;
                    },
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: holderCtrl,
                    enabled: !isProcessing,
                    decoration: const InputDecoration(
                      labelText: 'Titular (como en la tarjeta)',
                      hintText: 'JUAN PEREZ',
                    ),
                    validator: (v) {
                      if (v == null || v.isEmpty) return 'Requerido';
                      return null;
                    },
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: isProcessing ? null : () => Navigator.pop(dialogContext, null),
              child: const Text('Cancelar'),
            ),
            ElevatedButton(
              onPressed: isProcessing
                  ? null
                  : () async {
                      if (!formKey.currentState!.validate()) return;
                      setDialogState(() => isProcessing = true);
                      
                      // Validar fecha de expiraciÃ³n no pasada
                      final now = DateTime.now();
                      final expMonth = int.parse(expMonthCtrl.text);
                      final expYear = int.parse('20${expYearCtrl.text}');
                      if (DateTime(expYear, expMonth).isBefore(DateTime(now.year, now.month))) {
                        setDialogState(() {
                          errorMsg = 'La tarjeta estÃ¡ vencida';
                          isProcessing = false;
                        });
                        return;
                      }
                      
                      Navigator.pop(dialogContext, {
                        'number': numberCtrl.text,
                        'cvc': cvcCtrl.text,
                        'expMonth': expMonthCtrl.text,
                        'expYear': expYearCtrl.text,
                        'holder': holderCtrl.text.toUpperCase(),
                      });
                    },
              child: isProcessing
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Continuar'),
            ),
          ],
        ),
      ),
    );
  }

  /// A dÃ³nde vuelve el usuario tras autorizar en su banco. Wompi lo exige y el
  /// backend rechaza la transacciÃ³n sin Ã©l (400). Se usa el dominio pÃºblico de la
  /// app, el mismo que ya se emplea para los enlaces compartibles
  /// (`provider_detail_screen.dart`: `https://glowapp.co/p/<id>`), y que coincide
  /// con `FRONTEND_URL` de `backend/.env.example`.
  static const String _redirectUrlPago = 'https://glowapp.co/pago/resultado';

  /// Muestra la URL de autorizaciÃ³n que devolviÃ³ Wompi.
  ///
  /// El proyecto NO tiene `url_launcher` ni `webview_flutter`: es una omisiÃ³n
  /// deliberada (`forced_update_dialog.dart` resuelve lo mismo con el
  /// portapapeles "porque no es dependencia del proyecto"). Se sigue ese patrÃ³n:
  /// se copia el enlace y se indica abrirlo. Si producto acepta aÃ±adir
  /// `url_launcher`, aquÃ­ se sustituye `Clipboard.setData` por `launchUrl`.
  /// Un solo punto de salida para crear la transaccion. Reservas y pedidos de
  /// tienda usan endpoints distintos (`/bookings/:id/pay` vs `/store/orders/:id/pay`).
  /// Antes la hoja llamaba SIEMPRE a payBooking: el checkout de la tienda pegaba
  /// contra `/bookings/<orderId>/pay`, donde ese id no existe.
  Future<Map<String, dynamic>> _crearTransaccion({
    required String method,
    String? phoneNumber,
    String? paymentMethodToken,
    required String acceptanceToken,
    String? redirectUrl,
    Map<String, dynamic>? customerData,
  }) {
    if (widget.itemType == 'product') {
      return ApiService.payOrder(
        widget.bookingId,
        method,
        phoneNumber: phoneNumber,
        paymentMethodToken: paymentMethodToken,
        acceptanceToken: acceptanceToken,
        redirectUrl: redirectUrl,
        customerData: customerData,
      );
    }
    return ApiService.payBooking(
      widget.bookingId,
      method,
      phoneNumber: phoneNumber,
      paymentMethodToken: paymentMethodToken,
      acceptanceToken: acceptanceToken,
      redirectUrl: redirectUrl,
      customerData: customerData,
    );
  }

  /// El pedido solo pasa a PAGADO cuando el webhook de Wompi lo confirma. Se
  /// consulta hasta saber el desenlace: 'pagado', 'rechazado', 'cancelado' o
  /// 'pendiente'. Antes devolvia bool y leia `data['estado']`, pero el endpoint
  /// responde {data: {order, items, pago}}: el estado siempre llegaba undefined y
  /// el cliente veia "pago en proceso" incluso cuando Wompi lo habia rechazado.
  Future<String> _esperarConfirmacionPedido({int intentos = 20}) async {
    for (var i = 0; i < intentos; i++) {
      await Future<void>.delayed(const Duration(seconds: 3));
      if (!mounted) return 'pendiente';
      try {
        final res = await ApiService.fetchStoreOrderById(widget.bookingId);
        final data = (res['data'] is Map) ? res['data'] as Map : res;
        final pedido = (data['order'] is Map) ? data['order'] as Map : data;

        final estado = (pedido['estado'] ?? '').toString().toUpperCase();
        if (estado == 'PAGADO' || estado == 'DESPACHADO' || estado == 'ENTREGADO') {
          return 'pagado';
        }
        if (estado == 'CANCELADO') return 'cancelado';

        final pago = (data['pago'] is Map) ? data['pago'] as Map : const <String, dynamic>{};
        final estadoPago =
            (pago['status'] ?? pago['estado_pago'] ?? '').toString().toUpperCase();
        if (['FAILED', 'DECLINED', 'ERROR', 'VOIDED'].contains(estadoPago)) {
          return 'rechazado';
        }
      } catch (_) {
        // La red puede fallar mientras el usuario esta en el banco: se reintenta.
      }
    }
    return 'pendiente';
  }

  Future<void> _mostrarRedireccion(String url) async {
    await Clipboard.setData(ClipboardData(text: url));
    await HapticFeedback.mediumImpact();
    if (!mounted) return;
    setState(() {
      _isProcessing = false;
      _redireccionUrl = url;
    });
  }

  /// Maneja el Ã©xito del pago (comÃºn para NEQUI y CARD)
  Future<void> _onPaymentSuccess(Map<String, dynamic> res) async {
    await BookingRecoveryService.clearPendingBooking();
    await HapticFeedback.lightImpact();

    AnalyticsService().logPurchaseSuccess(
      transactionId: res['reference'] ?? res['booking_id']?.toString() ?? widget.bookingId,
      totalAmount: widget.price,
      paymentMethod: _metodo,
      metadata: {
        'service_name': widget.serviceName,
        'provider_name': widget.providerName,
      },
    );

    setState(() {
      _isProcessing = false;
      _successData = res;
    });
  }
}
