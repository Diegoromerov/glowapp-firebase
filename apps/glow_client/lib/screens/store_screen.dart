// frontend/lib/screens/store_screen.dart
import 'package:glow_core/glow_core.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shimmer/shimmer.dart';
import 'package:shared_preferences/shared_preferences.dart';

class StoreScreen extends StatefulWidget {
  final String? bookingId;
  const StoreScreen({super.key, this.bookingId});

  @override
  State<StoreScreen> createState() => _StoreScreenState();
}

class _StoreScreenState extends State<StoreScreen> {
  List<Map<String, dynamic>> _allProducts = [];
  List<Map<String, dynamic>> _filteredProducts = [];
  bool _isLoading = true;
  String _errorMessage = '';
  
  // Filtros
  String _selectedCategory = 'Todos';
  final TextEditingController _searchController = TextEditingController();

  // Carrito de compras: { productId: { 'product': product, 'quantity': q } }
  final Map<int, Map<String, dynamic>> _cart = {};
  bool _isCartOpen = false;

  List<String> get _categories {
    if (AudienceService.isMenMode) {
      return ['Todos', 'Barba & Bigote', 'Corte & Capilar', 'Grooming', 'Skincare Masculino', 'Tratamientos'];
    }
    return ['Todos', 'Cabello', 'Uñas', 'Maquillaje', 'Estética'];
  }

  double _getProductPrice(Map<String, dynamic> product) {
    if (widget.bookingId != null && product.containsKey('precio_con_reserva')) {
      return double.tryParse(product['precio_con_reserva']?.toString() ?? '0') ?? 0.0;
    }
    return double.tryParse(product['precio']?.toString() ?? '0') ?? 0.0;
  }

  @override
  void initState() {
    super.initState();
    _fetchProducts();
    _searchController.addListener(_filterProducts);
    AudienceService.currentAudience.addListener(_filterProducts);
  }

  @override
  void dispose() {
    _searchController.removeListener(_filterProducts);
    AudienceService.currentAudience.removeListener(_filterProducts);
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _fetchProducts() async {
    try {
      setState(() {
        _isLoading = true;
        _errorMessage = '';
      });
      
      final response = await ApiService.get('/api/products');
      if (response != null && response['success'] == true) {
        final List<dynamic> productsData = response['data'] ?? [];
        setState(() {
          _allProducts = List<Map<String, dynamic>>.from(productsData);
          _filterProducts();
          _isLoading = false;
        });
      } else {
        throw Exception('Respuesta no válida del servidor');
      }
    } catch (e) {
      setState(() {
        _errorMessage = 'No se pudieron cargar los productos: $e';
        _isLoading = false;
      });
    }
  }

  void _filterProducts() {
    final query = _searchController.text.toLowerCase().trim();
    final audience = AudienceService.currentAudience.value;

    setState(() {
      _filteredProducts = _allProducts.where((p) {
        // Filtro por Categoría
        final tagEsp = (p['tag_especialidad'] ?? p['categoria'] ?? '').toString().toLowerCase();
        final matchesCat = _selectedCategory == 'Todos' || 
            tagEsp.contains(_selectedCategory.toLowerCase()) ||
            (_selectedCategory == 'Barba & Bigote' && (tagEsp.contains('barba') || tagEsp.contains('bigote'))) ||
            (_selectedCategory == 'Corte & Capilar' && (tagEsp.contains('corte') || tagEsp.contains('cabello') || tagEsp.contains('capilar'))) ||
            (_selectedCategory == 'Grooming' && (tagEsp.contains('grooming') || tagEsp.contains('cuidado'))) ||
            (_selectedCategory == 'Skincare Masculino' && (tagEsp.contains('skincare') || tagEsp.contains('facial') || tagEsp.contains('piel')));
        
        // Filtro por Búsqueda de texto
        final matchesQuery = query.isEmpty ||
            (p['nombre']?.toString().toLowerCase().contains(query) ?? false) ||
            (p['descripcion']?.toString().toLowerCase().contains(query) ?? false);

        // Filtro por Audiencia (Hombres / Mujeres / Todos)
        bool matchesAudience = true;
        final genderTarget = (p['gender_target'] ?? p['genero_objetivo'] ?? p['tag_genero'] ?? 'unisex').toString().toLowerCase();
        final nombreProd = (p['nombre'] ?? '').toString().toLowerCase();
        final descProd = (p['descripcion'] ?? '').toString().toLowerCase();

        if (audience == AudienceMode.men) {
          final isExclusivelyFemale = nombreProd.contains('maquillaje') || nombreProd.contains('uñas') || nombreProd.contains('cutículas') || nombreProd.contains('balayage') || descProd.contains('femenino');
          final isMaleOrUnisex = genderTarget == 'male' || genderTarget == 'men' || genderTarget == 'hombres' || genderTarget == 'unisex' || nombreProd.contains('barba') || nombreProd.contains('grooming') || nombreProd.contains('masculino') || nombreProd.contains('cera');

          matchesAudience = isMaleOrUnisex && !isExclusivelyFemale;
        } else if (audience == AudienceMode.women) {
          matchesAudience = genderTarget == 'female' || genderTarget == 'women' || genderTarget == 'mujeres' || genderTarget == 'unisex';
        }

        return matchesCat && matchesQuery && matchesAudience;
      }).toList();
    });
  }

  void _selectCategory(String cat) {
    setState(() {
      _selectedCategory = cat;
    });
    _filterProducts();
  }

  void _addToCart(Map<String, dynamic> product, {int quantity = 1}) {
    final id = product['id'] as int;
    final stock = product['stock'] as int? ?? 0;
    
    setState(() {
      if (_cart.containsKey(id)) {
        final currentQty = _cart[id]!['quantity'] as int;
        if (currentQty + quantity <= stock) {
          _cart[id]!['quantity'] = currentQty + quantity;
        } else {
          _cart[id]!['quantity'] = stock;
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Alcanzaste el límite de stock disponible.')),
          );
        }
      } else {
        _cart[id] = {
          'product': product,
          'quantity': quantity > stock ? stock : quantity,
        };
      }
      _isCartOpen = true; // Abrir automáticamente el Cart Drawer
    });

    AnalyticsService().logAddToCart(
      productId: id.toString(),
      productName: product['nombre'] ?? 'Producto',
      price: _getProductPrice(product),
      metadata: {'quantity': quantity},
    );
  }

  void _updateCartQuantity(int id, int newQty) {
    if (newQty <= 0) {
      setState(() {
        _cart.remove(id);
      });
      return;
    }
    final product = _cart[id]!['product'] as Map<String, dynamic>;
    final stock = product['stock'] as int? ?? 0;

    setState(() {
      _cart[id]!['quantity'] = newQty > stock ? stock : newQty;
    });
  }

  double _getCartSubtotal() {
    double subtotal = 0.0;
    _cart.forEach((_, item) {
      final product = item['product'] as Map<String, dynamic>;
      final qty = item['quantity'] as int;
      final price = _getProductPrice(product);
      subtotal += price * qty;
    });
    return subtotal;
  }

  int _getCartItemCount() {
    int count = 0;
    _cart.forEach((_, item) {
      count += item['quantity'] as int;
    });
    return count;
  }

  String _formatCOP(double amount) {
    return '\$${amount.toStringAsFixed(0).replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (Match m) => '${m[1]}.')} COP';
  }

  void _showQuickView(Map<String, dynamic> product) {
    showDialog(
      context: context,
      builder: (ctx) {
        return ProductQuickViewDialog(
          product: product,
          bookingId: widget.bookingId,
          onAddToCart: (prod, qty) {
            _addToCart(prod, quantity: qty);
          },
        );
      },
    );
  }

  void _showCheckoutDialog() {
    if (_cart.isEmpty) return;

    final double subtotal = _getCartSubtotal();
    final double iva = subtotal * 0.19;
    final double total = subtotal + iva;

    final TextEditingController nameCtrl = TextEditingController();
    final TextEditingController addressCtrl = TextEditingController();
    final formKey = GlobalKey<FormState>();
    bool processing = false;
    bool loadingAddress = true;
    Map<String, dynamic>? defaultAddress;

    // Precarga de los datos del comprador al abrir el dialog
    Future<void> prefillCheckoutData() async {
      // 1. Nombre: misma fuente que "Mi Perfil Concierge" (se guarda al iniciar sesión)
      try {
        final prefs = await SharedPreferences.getInstance();
        final savedName = prefs.getString('userName');
        if (savedName != null && savedName.trim().isNotEmpty) {
          nameCtrl.text = savedName.trim();
        }
      } catch (_) {}

      // 2. Dirección de entrega por defecto
      try {
        final headers = await ApiService.getAuthHeaders();
        final uri = Uri.parse('${ApiService.baseUrl}/api/users/delivery-addresses/default');
        final response = await http.get(uri, headers: headers).timeout(const Duration(seconds: 8));
        if (response.statusCode == 200) {
          final data = json.decode(response.body);
          if (data['data'] != null) {
            defaultAddress = data['data'];
            addressCtrl.text = defaultAddress!['direccion_formateada'] ?? '';
          }
        }
      } catch (_) {}
      finally {
        if (mounted) setState(() => loadingAddress = false);
      }
    }

    // Llamar al cargar
    prefillCheckoutData();

    // Selector de direcciones guardadas
    Future<Map<String, dynamic>?> showAddressSelector(BuildContext dialogContext) async {
      try {
        final headers = await ApiService.getAuthHeaders();
        final uri = Uri.parse('${ApiService.baseUrl}/api/users/delivery-addresses');
        final response = await http.get(uri, headers: headers).timeout(const Duration(seconds: 8));
        
        if (response.statusCode != 200) {
          throw Exception('Error al cargar direcciones');
        }
        
        final data = json.decode(response.body);
        final addresses = (data['data'] ?? []) as List<dynamic>;
        
        if (addresses.isEmpty) {
          // No hay direcciones, ofrecer crear una
          final createNew = await showDialog<bool>(
            context: dialogContext,
            builder: (ctx) => AlertDialog(
              title: const Text('Sin direcciones guardadas'),
              content: const Text('¿Quieres crear una dirección de entrega ahora?'),
              actions: [
                TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('No')),
                TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Sí, crear')),
              ],
            ),
          );
          
          if (createNew == true) {
            // Abrir el builder de direcciones
            Map<String, dynamic>? newAddress;
            await showColombianAddressBuilder(
              context: dialogContext,
              onSave: (addr) => newAddress = addr,
            );
            return newAddress;
          }
          return null;
        }
        
        // Mostrar selector de direcciones
        Map<String, dynamic>? selectedAddress;
        
        await showDialog<Map<String, dynamic>>(
          context: dialogContext,
          builder: (ctx) => Dialog(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            child: Container(
              constraints: const BoxConstraints(maxWidth: 500, maxHeight: 500),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Padding(
                                      padding: const EdgeInsets.all(20),
                                      child: Row(
                                        children: [
                                          Icon(Icons.location_on_outlined, color: AppTheme.primary, size: 24),
                                          const SizedBox(width: 12),
                                          Text(
                                            'Seleccionar dirección de entrega',
                                            style: TextStyle(
                                              fontSize: 18,
                                              fontWeight: FontWeight.bold,
                                              color: AppTheme.text,
                                            ),
                                          ),
                                          const Spacer(),
                                          IconButton(
                                            onPressed: () => Navigator.pop(ctx),
                                            icon: const Icon(Icons.close),
                                          ),
                                        ],
                    ),
                  ),
                  const Divider(height: 1),
                  Flexible(
                    child: ListView.separated(
                      shrinkWrap: true,
                      padding: const EdgeInsets.all(16),
                      itemCount: addresses.length + 1, // +1 para "Nueva dirección"
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (_, index) {
                        if (index == addresses.length) {
                          // Botón "Nueva dirección"
                          return ListTile(
                            leading: Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                color: AppTheme.primary.withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Icon(Icons.add_location_alt_outlined, color: AppTheme.primary),
                            ),
                            title: const Text('Agregar nueva dirección', style: TextStyle(fontWeight: FontWeight.w600)),
                            subtitle: const Text('Crear una dirección diferente para este envío'),
                            onTap: () async {
                              Map<String, dynamic>? newAddress;
                              await showColombianAddressBuilder(
                                context: dialogContext,
                                onSave: (addr) => newAddress = addr,
                              );
                              if (newAddress != null && dialogContext.mounted) {
                                Navigator.pop(ctx, newAddress);
                              }
                            },
                          );
                        }
                        
                        final addr = addresses[index];
                        final isDefault = addr['es_default'] == true;
                        final formatted = addr['direccion_formateada'] ?? '';
                        final alias = addr['alias'];
                        
                        return Container(
                          decoration: BoxDecoration(
                            border: Border.all(
                              color: isDefault ? AppTheme.primary : Colors.grey.shade200,
                              width: isDefault ? 2 : 1,
                            ),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: RadioListTile<Map<String, dynamic>>(
                            value: addr,
                            groupValue: selectedAddress,
                            onChanged: (val) {
                              selectedAddress = val;
                              (ctx as Element).markNeedsBuild();
                            },
                            title: Row(
                              children: [
                                if (alias != null && alias.isNotEmpty)
                                  Text(alias, style: const TextStyle(fontWeight: FontWeight.bold))
                                else
                                  const Text('Dirección de entrega', style: TextStyle(fontWeight: FontWeight.bold)),
                                if (isDefault) ...[
                                  const SizedBox(width: 8),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                                    decoration: BoxDecoration(
                                      color: AppTheme.primary,
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                    child: const Text(
                                      'DEFAULT',
                                      style: TextStyle(fontSize: 9, color: Colors.white, fontWeight: FontWeight.bold),
                                    ),
                                  ),
                                ],
                              ],
                            ),
                            subtitle: Text(formatted, maxLines: 2, overflow: TextOverflow.ellipsis),
                            secondary: isDefault
                                ? Icon(Icons.check_circle, color: AppTheme.primary)
                                : null,
                            activeColor: AppTheme.primary,
                          ),
                        );
                      },
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed: () => Navigator.pop(ctx),
                            child: const Text('Cancelar'),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: ElevatedButton(
                            onPressed: selectedAddress != null
                                ? () => Navigator.pop(ctx, selectedAddress)
                                : null,
                            child: const Text('Usar esta dirección'),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
        
        return selectedAddress;
      } catch (e) {
        if (dialogContext.mounted) {
          ScaffoldMessenger.of(dialogContext).showSnackBar(
            SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
          );
        }
        return null;
      }
    }

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setCheckoutState) {
            if (processing) {
              return Dialog(
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                child: Padding(
                  padding: const EdgeInsets.all(32.0),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                                          CircularProgressIndicator(color: AppTheme.primary),
                                          const SizedBox(height: 24),
                      Text(
                        'Procesando tu pago seguro...',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.text,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Conectando con la pasarela de GlowApp...',
                        style: TextStyle(
                          fontSize: 12,
                          color: AppTheme.text.withValues(alpha: 0.6),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }

            final double screenWidth = MediaQuery.of(context).size.width;
            final bool isMobile = screenWidth < 680;

            final Widget formColumn = Padding(
              padding: const EdgeInsets.all(24.0),
              child: Form(
                key: formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.security, color: AppTheme.primary, size: 20),
                        const SizedBox(width: 8),
                        Text(
                          'GlowPay - Pago Seguro',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.primary.withValues(alpha: 0.8),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Información de Envío',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: AppTheme.text,
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: nameCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Nombre Completo',
                        border: OutlineInputBorder(),
                        prefixIcon: Icon(Icons.person_outline),
                      ),
                      validator: (v) => (v == null || v.isEmpty) ? 'Campo obligatorio' : null,
                    ),
                    const SizedBox(height: 12),
                    // Dirección de Entrega con botón editar
                    Stack(
                      children: [
                        TextFormField(
                          controller: addressCtrl,
                          decoration: InputDecoration(
                            labelText: 'Dirección de Entrega',
                            border: const OutlineInputBorder(),
                            prefixIcon: const Icon(Icons.location_on_outlined),
                            suffixIcon: loadingAddress
                                ? const Padding(
                                    padding: EdgeInsets.all(12),
                                    child: SizedBox(
                                      width: 20,
                                      height: 20,
                                      child: CircularProgressIndicator(strokeWidth: 2),
                                    ),
                                  )
                                : IconButton(
                                    icon: const Icon(Icons.edit_outlined, size: 20, color: Colors.grey),
                                    onPressed: () async {
                                      // Abrir selector/editor de direcciones
                                      final result = await showAddressSelector(context);
                                      if (result != null && mounted) {
                                        setState(() {
                                          defaultAddress = result;
                                          addressCtrl.text = result['direccion_formateada'] ?? '';
                                        });
                                      }
                                    },
                                    tooltip: 'Cambiar dirección',
                                  ),
                          ),
                          validator: (v) => (v == null || v.isEmpty) ? 'Campo obligatorio' : null,
                        ),
                      ],
                    ),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppTheme.primary.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: AppTheme.primary.withValues(alpha: 0.2)),
                      ),
                      child: Row(
                        children: [
                          Icon(Icons.verified_user_rounded, color: AppTheme.primary, size: 20),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Pago procesado y protegido de forma segura mediante Wompi Colombia (Nequi, PSE, Tarjetas y Bancolombia).',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w500,
                                color: AppTheme.text.withValues(alpha: 0.8),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 24),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed: () => Navigator.pop(ctx),
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                            child: const Text('Cancelar'),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: ElevatedButton(
                            onPressed: () async {
                              if (formKey.currentState!.validate()) {
                                final itemsList = _cart.values.map((item) {
                                  final prod = item['product'] as Map<String, dynamic>;
                                  final qty = item['quantity'] as int;
                                  return {
                                    'producto_id': prod['id'],
                                    'cantidad': qty
                                  };
                                }).toList();

                                // Preparar datos del checkout (incluir dirección estructurada si hay dirección seleccionada)
                                Map<String, dynamic> checkoutData;
                                if (defaultAddress != null) {
                                  checkoutData = {
                                    'nombre_entrega': nameCtrl.text,
                                    'direccion_entrega': addressCtrl.text,
                                    'tipo_via': defaultAddress!['tipo_via'],
                                    'numero_principal': defaultAddress!['numero_principal'],
                                    'letra_principal': defaultAddress!['letra_principal'],
                                    'numero_secundario': defaultAddress!['numero_secundario'],
                                    'letra_secundaria': defaultAddress!['letra_secundaria'],
                                    'complemento': defaultAddress!['complemento'],
                                    'barrio': defaultAddress!['barrio'],
                                    'ciudad': defaultAddress!['ciudad'],
                                    'departamento': defaultAddress!['departamento'],
                                    'codigo_postal': defaultAddress!['codigo_postal'],
                                    'referencia': defaultAddress!['referencia'],
                                    'direccion_entrega_id': defaultAddress!['id'],
                                    'items': itemsList,
                                    if (widget.bookingId != null) 'booking_id': widget.bookingId,
                                  };
                                } else {
                                  checkoutData = {
                                    'nombre_entrega': nameCtrl.text,
                                    'direccion_entrega': addressCtrl.text,
                                    'items': itemsList,
                                    if (widget.bookingId != null) 'booking_id': widget.bookingId,
                                  };
                                }

                                // 1. Crear el pedido primero (POST /api/store/checkout)
                                // El messenger se captura ANTES del primer await: usarlo
                                // despues es "BuildContext across async gaps", y si la
                                // pasarela fallaba el dialogo se quedaba colgado sin aviso.
                                final messenger = ScaffoldMessenger.of(context);
                                setCheckoutState(() {
                                  processing = true;
                                });
                                Map<String, dynamic>? orderResponse;
                                try {
                                  orderResponse = await ApiService.post('/api/store/checkout', checkoutData);
                                  if (orderResponse == null || orderResponse['success'] != true) {
                                    throw Exception(orderResponse?['error'] ?? 'Error creando pedido');
                                  }
                                } catch (e) {
                                  setCheckoutState(() {
                                    processing = false;
                                  });
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(content: Text('Error creando pedido: $e')),
                                  );
                                  return;
                                }

                                final orderId = orderResponse['data']?['order']?['id'] ?? orderResponse['order']?['id'];
                                if (orderId == null) {
                                  setCheckoutState(() { processing = false; });
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(content: Text('Error: no se recibió ID del pedido')),
                                  );
                                  return;
                                }

                                // El importe que se cobra es el que calculo el SERVIDOR
                                // (incluye envio e IVA). Usar el total del carrito hacia que
                                // el modal mostrara 40.317 y el cobro fuera 55.717,20.
                                // Los `numeric` de Postgres llegan como String
                                // ("27350.00"): un `as num?` lanzaba TypeError, el await
                                // no continuaba y "Procesando tu pago..." se quedaba
                                // colgado sin abrir la pasarela.
                                final totalServidor =
                                    toDoubleOrNull(orderResponse['data']?['order']?['total']) ??
                                        toDoubleOrNull(orderResponse['order']?['total']) ??
                                        total;

                                // 2. Cobrar el pedido usando el orderId real
                                // Si abrir la pasarela falla, se cierra el dialogo y se
                                // avisa: antes cualquier excepcion dejaba el spinner y el
                                // pedido creado sin forma de continuar.
                                bool? paymentResult;
                                try {
                                  paymentResult = await showWompiCheckoutSheet(
                                    context: context,
                                    bookingId: orderId, // Ahora pasamos el orderId real
                                    serviceName: 'Compra GlowShop (${_cart.length} productos)',
                                    price: totalServidor,
                                    providerName: 'GlowShop Oficial',
                                    itemType: 'product',
                                  );
                                } catch (e) {
                                  if (mounted) {
                                    setCheckoutState(() {
                                      processing = false;
                                    });
                                    messenger.showSnackBar(
                                      SnackBar(
                                        content: Text(
                                          'No se pudo abrir la pasarela de pago: $e. '
                                          'El pedido quedó pendiente, no se te cobró nada.',
                                        ),
                                      ),
                                    );
                                  }
                                  return;
                                }

                                if (paymentResult == true) {
                                  // El webhook confirmará el pago y marcará el pedido como PAGADO
                                  Navigator.pop(ctx);
                                  setState(() {
                                    _cart.clear();
                                    _isCartOpen = false;
                                  });
                                  _showOrderSuccessDialog();
                                } else {
                                  // Pago cancelado o fallido: el pedido queda en PENDIENTE_PAGO
                                  // El usuario puede reintentar desde la pantalla de pedidos
                                  setCheckoutState(() { processing = false; });
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(content: Text('Pago cancelado. El pedido queda pendiente de pago.')),
                                  );
                                }
                              }
                            },
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppTheme.primary,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                            child: const Text(
                              'Pagar',
                              style: TextStyle(fontWeight: FontWeight.bold),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );

            final Widget summaryColumn = Container(
              color: Colors.grey.shade50,
              padding: const EdgeInsets.all(24.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Resumen del Pedido',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: AppTheme.text,
                    ),
                  ),
                  const SizedBox(height: 16),
                  ConstrainedBox(
                    constraints: BoxConstraints(maxHeight: isMobile ? 160 : 220),
                    child: ListView.separated(
                      shrinkWrap: true,
                      physics: const BouncingScrollPhysics(),
                      itemCount: _cart.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 10),
                      itemBuilder: (c, index) {
                      final item = _cart.values.elementAt(index);
                      final prod = item['product'] as Map<String, dynamic>;
                      final qty = item['quantity'] as int;
                      final pPrice = _getProductPrice(prod);
                      
                      return Row(
                        children: [
                          Stack(
                            clipBehavior: Clip.none,
                            children: [
                              Container(
                                width: 45,
                                height: 45,
                                decoration: BoxDecoration(
                                  border: Border.all(color: Colors.grey.shade300),
                                  borderRadius: BorderRadius.circular(8),
                                  image: DecorationImage(
                                    image: NetworkImage(prod['imagen_url']?.toString() ?? ''),
                                    fit: BoxFit.cover,
                                  ),
                                ),
                              ),
                              Positioned(
                                top: -6,
                                right: -6,
                                child: CircleAvatar(
                                  radius: 9,
                                  backgroundColor: AppTheme.primary,
                                  child: Text(
                                    '$qty',
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 10,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              prod['nombre']?.toString() ?? 'Producto',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            _formatCOP(pPrice * qty),
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      );
                    },
                  ),
                ),
                const SizedBox(height: 20),
                  const Divider(),
                  const SizedBox(height: 10),
                  _buildSummaryRow('Subtotal', _formatCOP(subtotal)),
                  const SizedBox(height: 6),
                  _buildSummaryRow('IVA (19%)', _formatCOP(iva)),
                  const SizedBox(height: 10),
                  const Divider(),
                  const SizedBox(height: 10),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Total',
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.text,
                        ),
                      ),
                      Text(
                        _formatCOP(total),
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                          color: AppTheme.primary,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            );

            return Dialog(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
              clipBehavior: Clip.antiAlias,
              backgroundColor: Colors.white,
              child: Container(
                constraints: BoxConstraints(
                  maxWidth: isMobile ? 420 : 800,
                  maxHeight: MediaQuery.of(context).size.height * 0.88,
                ),
                child: SingleChildScrollView(
                  physics: const BouncingScrollPhysics(),
                  child: isMobile
                      ? Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            summaryColumn,
                            const Divider(height: 1),
                            formColumn,
                          ],
                        )
                      : Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(flex: 5, child: formColumn),
                            Expanded(flex: 4, child: summaryColumn),
                          ],
                        ),
                ),
              ),
            );
          },
        );
      },
    );
  }

  void _showOrderSuccessDialog() {
    showDialog(
      context: context,
      builder: (ctx) {
        return Dialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.check_circle_outline,
                  color: Colors.green,
                  size: 80,
                ),
                const SizedBox(height: 16),
                Text(
                  '¡Pedido Realizado con Éxito!',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: AppTheme.text,
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  'Tu orden ha sido registrada. Pronto recibirás tus productos y la respectiva factura digital en tu correo electrónico.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 14,
                    color: AppTheme.text.withValues(alpha: 0.8),
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 24),
                ElevatedButton(
                  onPressed: () => Navigator.pop(ctx),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: const Text(
                    'Entendido',
                    style: TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildSummaryRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 13,
            color: AppTheme.text.withValues(alpha: 0.6),
          ),
        ),
        Text(
          value,
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: AppTheme.text,
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AudienceMode>(
      valueListenable: AudienceService.currentAudience,
      builder: (context, audienceMode, child) {
        final isMen = audienceMode == AudienceMode.men;

        final bgColor = isMen
            ? MensTheme.obsidianBg
            : const Color(0xFFFAF8F5);
        final cardBgColor = isMen
            ? MensTheme.obsidianCard
            : Colors.white;
        final textColor = isMen ? MensTheme.textPrimary : const Color(0xFF1F1A15);
        final accentColor = isMen ? MensTheme.champagneGold : const Color(0xFFC5A052);

        return Scaffold(
          backgroundColor: bgColor,
          appBar: AppBar(
            backgroundColor: cardBgColor,
            elevation: 0.5,
            iconTheme: IconThemeData(color: textColor),
            title: Text(
              'GlowStore Concierge',
              style: TextStyle(
                fontFamily: 'CormorantGaramond',
                fontSize: 22,
                color: textColor,
                fontWeight: FontWeight.bold,
              ),
            ),
            centerTitle: false,
            actions: [
              // Icono Carrito con Badge
              Stack(
                alignment: Alignment.center,
                children: [
                  IconButton(
                icon: Icon(Icons.shopping_bag_outlined, color: textColor),
                onPressed: () {
                  setState(() {
                    _isCartOpen = !_isCartOpen;
                  });
                },
              ),
              if (_cart.isNotEmpty)
                Positioned(
                  top: 6,
                  right: 6,
                  child: CircleAvatar(
                    radius: 9,
                    backgroundColor: AppTheme.primary,
                    child: Text(
                      '${_getCartItemCount()}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 9,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(width: 16),
        ],
      ),
      body: Stack(
        children: [
          // Catálogo Principal
          Positioned.fill(
            child: Row(
              children: [
                Expanded(
                  child: _isLoading
                      ? Shimmer.fromColors(
                          baseColor: Colors.grey.shade300,
                          highlightColor: Colors.grey.shade100,
                          child: GridView.builder(
                            padding: const EdgeInsets.all(24),
                            gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                              maxCrossAxisExtent: 260,
                              mainAxisExtent: 350,
                              crossAxisSpacing: 18,
                              mainAxisSpacing: 18,
                            ),
                            itemCount: 6,
                            itemBuilder: (ctx, index) {
                              return Container(
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  borderRadius: BorderRadius.circular(16),
                                  border: Border.all(color: Colors.grey.shade200),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Expanded(
                                      child: Container(
                                        decoration: const BoxDecoration(
                                          color: Colors.white,
                                          borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
                                        ),
                                      ),
                                    ),
                                    Padding(
                                      padding: const EdgeInsets.all(12.0),
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Container(width: 60, height: 10, color: Colors.white),
                                          const SizedBox(height: 8),
                                          Container(width: 120, height: 14, color: Colors.white),
                                          const SizedBox(height: 12),
                                          Container(width: 80, height: 14, color: Colors.white),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              );
                            },
                          ),
                        )
                      : _errorMessage.isNotEmpty
                          ? Center(
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Text(_errorMessage, style: const TextStyle(color: Colors.red)),
                                  const SizedBox(height: 16),
                                  ElevatedButton(
                                    onPressed: _fetchProducts,
                                    child: const Text('Reintentar'),
                                  )
                                ],
                              ),
                            )
                          : Column(
                              children: [
                                // Filtros + Buscador Responsive (Shopify Header)
                                Container(
                                  color: cardBgColor,
                                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.stretch,
                                    children: [
                                      // 1. Barra de Búsqueda (Ocupa el ancho completo)
                                      Container(
                                        height: 42,
                                        decoration: BoxDecoration(
                                          color: isMen ? MensTheme.obsidianCard : Colors.grey.shade100,
                                          borderRadius: BorderRadius.circular(21),
                                          border: Border.all(
                                            color: isMen ? MensTheme.bronzeAccent.withValues(alpha: 0.3) : Colors.grey.shade300,
                                          ),
                                        ),
                                        padding: const EdgeInsets.symmetric(horizontal: 14),
                                        child: Row(
                                          children: [
                                            Icon(Icons.search, size: 20, color: isMen ? MensTheme.champagneGold : Colors.grey),
                                            const SizedBox(width: 8),
                                            Expanded(
                                              child: TextField(
                                                controller: _searchController,
                                                style: TextStyle(color: textColor),
                                                decoration: InputDecoration(
                                                  hintText: 'Buscar productos...',
                                                  hintStyle: TextStyle(fontSize: 14, color: isMen ? Colors.grey.shade400 : Colors.grey),
                                                  border: InputBorder.none,
                                                  isDense: true,
                                                  contentPadding: const EdgeInsets.symmetric(vertical: 10),
                                                ),
                                              ),
                                            ),
                                            if (_searchController.text.isNotEmpty)
                                              GestureDetector(
                                                onTap: () {
                                                  _searchController.clear();
                                                  _filterProducts();
                                                },
                                                child: Icon(Icons.close, size: 18, color: isMen ? MensTheme.champagneGold : Colors.grey),
                                              ),
                                          ],
                                        ),
                                      ),
                                      const SizedBox(height: 12),
                                      // 2. Filtros de Categoría Deslizables (Visualmente claros y accesibles en móvil)
                                      SingleChildScrollView(
                                        scrollDirection: Axis.horizontal,
                                        physics: const BouncingScrollPhysics(),
                                        child: Row(
                                          children: _categories.map((cat) {
                                            final isSelected = _selectedCategory == cat;
                                            return Padding(
                                              padding: const EdgeInsets.only(right: 8.0),
                                              child: ChoiceChip(
                                                label: Text(cat),
                                                selected: isSelected,
                                                onSelected: (_) => _selectCategory(cat),
                                                selectedColor: accentColor.withValues(alpha: 0.2),
                                                disabledColor: Colors.transparent,
                                                backgroundColor: isMen ? MensTheme.obsidianCard : Colors.transparent,
                                                labelStyle: TextStyle(
                                                  color: isSelected ? accentColor : (isMen ? Colors.grey.shade300 : AppTheme.text),
                                                  fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                                                  fontSize: 13,
                                                ),
                                                shape: RoundedRectangleBorder(
                                                  borderRadius: BorderRadius.circular(18),
                                                  side: BorderSide(
                                                    color: isSelected ? accentColor : (isMen ? MensTheme.bronzeAccent.withValues(alpha: 0.4) : Colors.grey.shade300),
                                                  ),
                                                ),
                                              ),
                                            );
                                          }).toList(),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                // Cuadrícula de Productos
                                Expanded(
                                  child: _filteredProducts.isEmpty
                                      ? const Center(
                                          child: Text(
                                            'No se encontraron productos disponibles.',
                                            style: TextStyle(color: Colors.grey),
                                          ),
                                        )
                                      : GridView.builder(
                                          padding: const EdgeInsets.all(24),
                                          gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                                            maxCrossAxisExtent: 260,
                                            mainAxisExtent: 350,
                                            crossAxisSpacing: 18,
                                            mainAxisSpacing: 18,
                                          ),
                                          itemCount: _filteredProducts.length,
                                          itemBuilder: (ctx, index) {
                                            final product = _filteredProducts[index];
                                            return StoreProductCard(
                                              product: product,
                                              bookingId: widget.bookingId,
                                              onQuickViewPressed: () => _showQuickView(product),
                                              onAddToCart: _addToCart,
                                            );
                                          },
                                        ),
                                ),
                              ],
                            ),
                ),
                // Espacio invisible para cuando el Cart Drawer está abierto en pantallas grandes
                if (_isCartOpen && MediaQuery.of(context).size.width > 750) const SizedBox(width: 380),
              ],
            ),
          ),
          
          // Cart Drawer (Panel Lateral Flotante derecho)
          if (_isCartOpen)
            Positioned(
              top: 0,
              bottom: 0,
              right: 0,
              child: _buildCartDrawer(),
            ),
        ],
      ),
    );
      },
    );
  }

  Widget _buildCartDrawer() {
    final subtotal = _getCartSubtotal();
    final double screenWidth = MediaQuery.of(context).size.width;
    final double drawerWidth = screenWidth > 380 ? 380.0 : screenWidth;
    
    return Container(
      width: drawerWidth,
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(left: BorderSide(color: Colors.grey.shade200, width: 1.5)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 20,
            offset: const Offset(-4, 0),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header del Carrito
          Padding(
            padding: const EdgeInsets.all(20.0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                              Row(
                                children: [
                                  Icon(Icons.shopping_bag_outlined, color: AppTheme.text),
                    SizedBox(width: 8),
                    Text(
                      'Tu Carrito',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: AppTheme.text,
                      ),
                    ),
                  ],
                ),
                IconButton(
                  icon: Icon(Icons.close, color: AppTheme.text),
                  onPressed: () {
                    setState(() {
                      _isCartOpen = false;
                    });
                  },
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          // Items del Carrito
          Expanded(
            child: _cart.isEmpty
                ? const Center(
                    child: Text(
                      'Tu carrito está vacío.',
                      style: TextStyle(color: Colors.grey),
                    ),
                  )
                : ListView.separated(
                    padding: const EdgeInsets.all(20),
                    itemCount: _cart.length,
                    separatorBuilder: (_, __) => const Divider(height: 24),
                    itemBuilder: (c, idx) {
                      final item = _cart.values.elementAt(idx);
                      final prod = item['product'] as Map<String, dynamic>;
                      final qty = item['quantity'] as int;
                      final id = prod['id'] as int;
                      final stock = prod['stock'] as int? ?? 0;
                      final pPrice = _getProductPrice(prod);

                      return Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            width: 60,
                            height: 60,
                            decoration: BoxDecoration(
                              border: Border.all(color: Colors.grey.shade200),
                              borderRadius: BorderRadius.circular(8),
                              image: DecorationImage(
                                image: NetworkImage(prod['imagen_url']?.toString() ?? ''),
                                fit: BoxFit.cover,
                              ),
                            ),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  prod['nombre']?.toString() ?? 'Producto',
                                  style: TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.bold,
                                    color: AppTheme.text,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  _formatCOP(pPrice),
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: AppTheme.text.withValues(alpha: 0.6),
                                  ),
                                ),
                                const SizedBox(height: 8),
                                // Modificador de cantidad ergonómico
                                Row(
                                  children: [
                                    InkWell(
                                      onTap: () {
                                        HapticFeedback.lightImpact();
                                        _updateCartQuantity(id, qty - 1);
                                      },
                                      borderRadius: BorderRadius.circular(8),
                                      child: Container(
                                        width: 32,
                                        height: 32,
                                        alignment: Alignment.center,
                                        decoration: BoxDecoration(
                                          color: Colors.grey.shade100,
                                          border: Border.all(color: Colors.grey.shade300),
                                          borderRadius: BorderRadius.circular(8),
                                        ),
                                        child: Icon(Icons.remove, size: 16, color: AppTheme.text),
                                      ),
                                    ),
                                    Padding(
                                      padding: const EdgeInsets.symmetric(horizontal: 12),
                                      child: Text(
                                        '$qty',
                                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                                      ),
                                    ),
                                    InkWell(
                                      onTap: qty < stock 
                                          ? () {
                                              HapticFeedback.lightImpact();
                                              _updateCartQuantity(id, qty + 1);
                                            }
                                          : null,
                                      borderRadius: BorderRadius.circular(8),
                                      child: Container(
                                        width: 32,
                                        height: 32,
                                        alignment: Alignment.center,
                                        decoration: BoxDecoration(
                                          color: qty < stock ? Colors.grey.shade100 : Colors.grey.shade50,
                                          border: Border.all(color: qty < stock ? Colors.grey.shade300 : Colors.grey.shade200),
                                          borderRadius: BorderRadius.circular(8),
                                        ),
                                        child: Icon(
                                          Icons.add,
                                          size: 16,
                                          color: qty < stock ? AppTheme.text : Colors.grey.shade400,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(
                                _formatCOP(pPrice * qty),
                                style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.bold,
                                  color: AppTheme.primary,
                                ),
                              ),
                              IconButton(
                                icon: const Icon(Icons.delete_outline, size: 18, color: Colors.grey),
                                onPressed: () => _updateCartQuantity(id, 0),
                              ),
                            ],
                          ),
                        ],
                      );
                    },
                  ),
          ),
          const Divider(height: 1),
          // Subtotal + Checkout
          if (_cart.isNotEmpty)
            Padding(
              padding: EdgeInsets.only(
                left: 20.0,
                right: 20.0,
                top: 16.0,
                bottom: 110.0 + MediaQuery.of(context).padding.bottom,
              ),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Subtotal',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.text,
                        ),
                      ),
                      Text(
                        _formatCOP(subtotal),
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                          color: AppTheme.primary,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Container(
                    width: double.infinity,
                    height: 50,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(14),
                      gradient: const LinearGradient(
                        colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFFC5A052).withValues(alpha: 0.35),
                          blurRadius: 12,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: ElevatedButton(
                      onPressed: _showCheckoutDialog,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.transparent,
                        shadowColor: Colors.transparent,
                        foregroundColor: const Color(0xFF1F1A15),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                        elevation: 0,
                      ),
                      child: const Text(
                        'Proceder al Pago',
                        style: TextStyle(
                          fontFamily: 'Inter',
                          fontWeight: FontWeight.bold,
                          fontSize: 15,
                          color: Color(0xFF1F1A15),
                        ),
                      ),
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
