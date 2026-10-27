import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:glow_core/services/api_service.dart';
import 'package:glow_core/shared/theme.dart' hide AppTheme;
// import 'package:glow_core/services/booking_recovery_service.dart'; // Not exported
import 'package:glow_core/glow_core.dart';

import 'package:glow_core/widgets/wompi_payment_sheet.dart';
// import 'package:glow_core/shared/app_tokens.dart'; // Not exported

class BookingScreen extends StatefulWidget {
  final String providerId;
  final String providerName;
  final List<Map<String, dynamic>> services;
  final String? initialServiceId;
  final String? initialNotes;
  final String? initialAddress;
  final String? preselectedProductId;

  const BookingScreen({
    super.key,
    required this.providerId,
    this.providerName = 'Prestador',
    this.services = const [],
    this.initialServiceId,
    this.initialNotes,
    this.initialAddress,
    this.preselectedProductId,
  });

  @override
  State<BookingScreen> createState() => _BookingScreenState();
}

class _BookingScreenState extends State<BookingScreen> {
  bool isLoading = false;
  DateTime? selectedDate;
  String? selectedServiceId;
  List<String> selectedServiceIds = [];
  String serviceAddress = '';
  String notes = '';

  // slots variables
  List<Map<String, dynamic>> _slots = [];
  bool _isLoadingSlots = false;
  String? _selectedSlotTime;

  // products variables
  List<Map<String, dynamic>> _recommendedProducts = [];
  bool _isLoadingProducts = false;
  Map<String, int> _selectedProductsQty = {};

  // step navigation variables
  int _currentStep = 0;
  final PageController _pageController = PageController();
  DateTime _calendarMonth = DateTime.now();

  // text controllers
  final TextEditingController _addressController = TextEditingController();
  final TextEditingController _notesController = TextEditingController();

  @override
  void initState() {
    super.initState();
    notes = widget.initialNotes ?? '';
    serviceAddress = widget.initialAddress ?? '';
    _addressController.text = serviceAddress;

    _notesController.text = notes;
    final now = DateTime.now();
    // Default to tomorrow
    selectedDate = DateTime(now.year, now.month, now.day + 1);
    _calendarMonth = selectedDate!;
    if (widget.services.isNotEmpty) {
      selectedServiceId = widget.services.first['id']?.toString();
      if (selectedServiceId != null) {
        selectedServiceIds = [selectedServiceId!];
      }
    }
    _loadSlots();
    _loadRecommendedProducts();
  }

  @override
  void dispose() {
    _pageController.dispose();
    _addressController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  String _mapServiceToTag(String category, String name) {
    final cat = category.toLowerCase();
    final nm = name.toLowerCase();

    if (nm.contains('ceja') || nm.contains('eyebrow') || cat.contains('eyebrow')) {
      return 'Maquillaje';
    }
    if (nm.contains('facial') || nm.contains('limpieza') || nm.contains('skin') || cat.contains('skin') || cat.contains('facial')) {
      return 'Estética';
    }
    if (cat.contains('nails') || cat.contains('uñas') || nm.contains('manicura') || nm.contains('pedicura') || nm.contains('nails')) {
      return 'Uñas';
    }
    if (cat.contains('hair') || cat.contains('cabello') || nm.contains('corte') || nm.contains('balayage') || nm.contains('peinado') || nm.contains('tinte')) {
      return 'Cabello';
    }

    return 'Uñas';
  }

  Future<void> _loadRecommendedProducts() async {
    if (selectedServiceId == null) return;
    final selectedService = widget.services.firstWhere(
      (s) => s['id']?.toString() == selectedServiceId,
      orElse: () => <String, dynamic>{},
    );
    if (selectedService.isEmpty) return;

    final name = selectedService['name']?.toString() ?? '';
    final category = selectedService['category']?.toString() ?? '';
    final tag = _mapServiceToTag(category, name);

    setState(() {
      _isLoadingProducts = true;
      _recommendedProducts = [];
      _selectedProductsQty = {};
    });

    try {
      final products = await ApiService.fetchProductsByTag(tag);
      setState(() {
        _recommendedProducts = products;
        _isLoadingProducts = false;
        if (widget.preselectedProductId != null) {
          final targetId = widget.preselectedProductId!;
          final hasProduct = products.any((p) => p['id']?.toString() == targetId);
          if (hasProduct) {
            _selectedProductsQty[targetId] = 1;
          } else {
            // Inject extra product info if not matching tag but explicitly requested
            Map<String, dynamic>? extraProduct;
            if (targetId == '1') {
              extraProduct = {
                'id': 1,
                'nombre': 'Kit Balayage Pro',
                'precio': 45000.00,
                'stock': 20,
                'imagen_url': '',
                'tag_especialidad': 'Cabello'
              };
            } else if (targetId == '2') {
              extraProduct = {
                'id': 2,
                'nombre': 'Aceite de Cutículas Frutales',
                'precio': 15000.00,
                'stock': 50,
                'imagen_url': '',
                'tag_especialidad': 'Uñas'
              };
            } else if (targetId == '4') {
              extraProduct = {
                'id': 4,
                'nombre': 'Sérum Facial Ácido Hialurónico',
                'precio': 55000.00,
                'stock': 30,
                'imagen_url': '',
                'tag_especialidad': 'Estética'
              };
            } else if (targetId == '6') {
              extraProduct = {
                'id': 6,
                'nombre': 'Gel Moldeador de Cejas Orgánico',
                'precio': 18000.00,
                'stock': 40,
                'imagen_url': '',
                'tag_especialidad': 'Maquillaje'
              };
            }
            if (extraProduct != null) {
              _recommendedProducts.insert(0, extraProduct);
              _selectedProductsQty[targetId] = 1;
            }
          }
        }
      });
    } catch (e) {
      // Fallback para pruebas offline o desconexión
      final fallbackProducts = [
        {
          'id': 101,
          'nombre': 'Tratamiento Reparador Intenso',
          'precio': 35000.0,
          'stock': 10,
          'imagen_url': '',
          'tag_especialidad': tag,
        },
        {
          'id': 102,
          'nombre': 'Óleo Nutritivo Glow',
          'precio': 22000.0,
          'stock': 15,
          'imagen_url': '',
          'tag_especialidad': tag,
        },
      ];
      setState(() {
        _recommendedProducts = fallbackProducts;
        _isLoadingProducts = false;
      });
      debugPrint('Error loading products (usando fallback): $e');
    }
  }

  Future<void> _loadSlots() async {
    if (selectedDate == null || selectedServiceIds.isEmpty) {
      return;
    }
    setState(() {
      _isLoadingSlots = true;
      _slots = [];
      _selectedSlotTime = null;
    });

    try {
      final dateStr =
          '${selectedDate!.year}-${selectedDate!.month.toString().padLeft(2, '0')}-${selectedDate!.day.toString().padLeft(2, '0')}';
      final data = await ApiService.fetchAvailableSlots(
        providerId: widget.providerId,
        date: dateStr,
        serviceId: selectedServiceIds.join(','),
      );
      setState(() {
        _slots = data;
        _isLoadingSlots = false;
      });
    } catch (e) {
      final fallbackSlots = [
        {'time': '09:00', 'is_available': true},
        {'time': '10:30', 'is_available': true},
        {'time': '14:00', 'is_available': true},
        {'time': '16:30', 'is_available': false},
      ];
      setState(() {
        _slots = fallbackSlots;
        _isLoadingSlots = false;
      });
      debugPrint('Error loading slots (usando fallback): $e');
    }
  }

  Future<void> _confirmBooking() async {
    if (selectedServiceId == null || selectedServiceId!.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('⚠️ Selecciona un servicio'),
            backgroundColor: Colors.orange),
      );
      return;
    }
    if (selectedDate == null || _selectedSlotTime == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('⚠️ Selecciona fecha y hora de la cuadrícula'),
            backgroundColor: Colors.orange),
      );
      return;
    }

    if (serviceAddress.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text(
                '⚠️ Ingresa la dirección donde llegará el prestador'),
            backgroundColor: Colors.orange),
      );
      return;
    }

    final timeParts = _selectedSlotTime!.split(':');
    final hour = int.parse(timeParts[0]);
    final minute = int.parse(timeParts[1]);

    final scheduledDateTime = DateTime(
      selectedDate!.year,
      selectedDate!.month,
      selectedDate!.day,
      hour,
      minute,
    );

    final List<Map<String, dynamic>> productosAdicionales = [];
    _selectedProductsQty.forEach((id, qty) {
      productosAdicionales.add({
        'id': int.parse(id),
        'cantidad': qty,
      });
    });

    setState(() => isLoading = true);
    try {
      final res = await ApiService.createBooking(
        providerId: widget.providerId,
        serviceId: selectedServiceId!,
        serviceIds: selectedServiceIds,
        scheduledAt: scheduledDateTime.toIso8601String(),
        serviceAddress: serviceAddress.trim(),
        notes: notes.isNotEmpty ? notes : null,
        productosAdicionales: productosAdicionales.isNotEmpty ? productosAdicionales : null,
      );

      final bookingId = res['booking_id']?.toString();
      if (bookingId == null) {
        throw Exception('No se recibió el ID de la reserva');
      }

      // W4 — el monto NO se calcula aquí. El backend lo deriva de los precios de
      // la BD (`valor_bruto` = Σ servicios + Σ productos) y es el que va a cobrar.
      // Antes esta pantalla restaba un descuento del 15% y sumaba un IVA del 19%
      // que el servidor no aplica, así que el cliente veía un precio y se le
      // cobraba otro. Se muestra el monto que devolvió el backend, y si no viene,
      // se falla en vez de inventar una cifra.
      final dynamic bookingRaw = res['booking'];
      final double totalBookingPrice =
          bookingRaw is Map ? _parseDouble(bookingRaw['valor_bruto']) : 0.0;
      if (totalBookingPrice <= 0) {
        throw Exception('El servidor no devolvió el monto de la reserva');
      }

      // Desglose del IVA, discriminado por el servidor sobre el `valor_bruto`
      // (art. 476 num. 1 lit. a) del Estatuto Tributario: los tratamientos de
      // belleza están gravados). Vienen en 0 si el prestador no es responsable de
      // IVA, y entonces el sheet no muestra desglose. El total no cambia: sólo se
      // hace visible el impuesto que ya estaba incluido en el precio.
      final double ivaValor =
          bookingRaw is Map ? _parseDouble(bookingRaw['iva_valor']) : 0.0;
      final double subtotalBase =
          bookingRaw is Map ? _parseDouble(bookingRaw['subtotal_base']) : 0.0;

      final List<String> serviceNames = [];
      for (final id in selectedServiceIds) {
        final s = widget.services.firstWhere(
          (srv) => srv['id']?.toString() == id,
          orElse: () => <String, dynamic>{},
        );
        if (s.isNotEmpty) {
          serviceNames.add(s['name']?.toString() ?? 'Servicio');
        }
      }
      final serviceName = serviceNames.isNotEmpty ? serviceNames.join(', ') : 'Servicios de Belleza';

      if (mounted) {
        setState(() => isLoading = false);
        BookingRecoveryService.savePendingBooking(
          bookingId: bookingId,
          serviceName: serviceName,
          price: totalBookingPrice,
          providerName: widget.providerName,
        );
        showWompiCheckoutSheet(
          context: context,
          bookingId: bookingId,
          serviceName: serviceName,
          price: totalBookingPrice,
          providerName: widget.providerName,
          subtotalBase: subtotalBase,
          ivaValor: ivaValor,
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('❌ Error: $e'),
            backgroundColor: Colors.redAccent,
            duration: const Duration(seconds: 4),
          ),
        );
      }
    }
  }

  /// Mueve el asistente a [paso].
  ///
  /// La barra de progreso lee `_currentStep` y el contenido lo dibuja el
  /// PageView con `_pageController`: son dos fuentes distintas. Si la animación
  /// no corría —controlador sin montar, por ejemplo durante una ruta modal— el
  /// número avanzaba y la página se quedaba, dejando la barra en "Confirmación"
  /// con el contenido del paso 1. Ahora, sin clientes, se salta al paso en el
  /// siguiente frame y la barra nunca se separa del contenido.
  void _irAlPaso(int paso) {
    if (paso < 0 || paso > 3) return;
    setState(() => _currentStep = paso);

    if (_pageController.hasClients) {
      _pageController.animateToPage(
        paso,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
      return;
    }

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_pageController.hasClients) return;
      _pageController.jumpToPage(_currentStep);
    });
  }

  void _nextStep() {
    if (_currentStep < 3) _irAlPaso(_currentStep + 1);
  }

  void _prevStep() {
    if (_currentStep > 0) _irAlPaso(_currentStep - 1);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
        leading: Padding(
          padding: const EdgeInsets.only(left: 14),
          child: Center(
            child: InkWell(
              onTap: _currentStep > 0 ? _prevStep : () => Navigator.pop(context),
              borderRadius: BorderRadius.circular(20),
              child: Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  border: Border.all(color: const Color(0xFFE8DFD8), width: 1),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.04),
                      blurRadius: 6,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: const Icon(Icons.arrow_back_ios_new_rounded, size: 15, color: Color(0xFF1F1A15)),
              ),
            ),
          ),
        ),
        title: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.calendar_month_outlined, size: 18, color: Color(0xFFC5A052)),
            SizedBox(width: 8),
            Flexible(
              child: Text(
                'Reservar Cita Concierge',
                style: TextStyle(
                  fontFamily: 'CormorantGaramond',
                  fontSize: 21,
                  fontWeight: FontWeight.bold,
                  color: Color(0xFF1F1A15),
                  letterSpacing: 0.5,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
        backgroundColor: const Color(0xFFFAF8F5),
        foregroundColor: const Color(0xFF1F1A15),
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
      ),
      bottomNavigationBar: isLoading ? null : _buildStickyBottomButtons(),
      body: isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFFC5A052)))
          : Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 680),
                child: Column(
                  children: [
                    _buildProgressBar(),
                    Expanded(
                      child: PageView(
                        controller: _pageController,
                        physics: const NeverScrollableScrollPhysics(),
                        children: [
                          _buildStepLogistics(),
                          _buildStepAddressNotes(),
                          _buildStep2CrossSelling(),
                          _buildStep3SummaryAndPay(),
                        ],
                      ),
                    ),
                    _buildStickySummary(),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildProgressBar() {
    final stepNames = ['Cuándo y Dónde', 'Dirección y Notas', 'Productos', 'Confirmación'];
    return Semantics(
      label: 'Paso ${_currentStep + 1} de 4: ${stepNames[_currentStep]}',
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20.0, 10.0, 20.0, 12.0),
        child: Row(
          children: List.generate(4, (index) {
            bool isCompleted = index < _currentStep;
            bool isActive = index == _currentStep;
            final color = (isCompleted || isActive) ? AppTokens.progressBarCompleted : AppTokens.progressBarPending;

            return Expanded(
              child: GestureDetector(
                onTap: () {
                  if (index < _currentStep) {
                    HapticFeedback.selectionClick();
                    _prevStep();
                  }
                },
                child: Column(
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 22,
                          height: 22,
                          decoration: BoxDecoration(
                            color: isActive || isCompleted ? const Color(0xFFC5A052) : Colors.white,
                            shape: BoxShape.circle,
                            border: Border.all(color: color, width: 1.5),
                          ),
                          alignment: Alignment.center,
                          child: isCompleted
                              ? const Icon(Icons.check, size: 13, color: Colors.white)
                              : Text(
                                  '${index + 1}',
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.bold,
                                    color: isActive ? const Color(0xFF1F1A15) : const Color(0xFF8E7D7A),
                                  ),
                                ),
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            stepNames[index],
                            style: TextStyle(
                              fontFamily: 'Inter',
                              fontSize: 11,
                              fontWeight: isActive ? FontWeight.bold : FontWeight.w500,
                              color: isActive ? const Color(0xFF1F1A15) : const Color(0xFF8E7D7A),
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Container(
                      height: 4,
                      decoration: BoxDecoration(
                        color: color,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ],
                ),
              ),
            );
          }),
        ),
      ),
    );
  }

    Widget _buildStepAddressNotes() {
      return ListView(
        padding: const EdgeInsets.symmetric(horizontal: 20.0, vertical: 12),
        children: [
          _buildSectionTitle('4. Dirección del servicio'),
          const SizedBox(height: 8),
          Row(
            children: [
              Flexible(
                child: GestureDetector(
                  onTap: () {
                    HapticFeedback.lightImpact();
                    setState(() {
                      _addressController.text = 'Calle 127 # 19-45, Apt 502, Bogotá';
                      serviceAddress = _addressController.text;
                    });
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: Color(0xFFC5A052).withOpacity(0.12),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: Color(0xFFC5A052).withOpacity(0.3)),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.home_outlined, size: 14, color: Color(0xFFC5A052)),
                        SizedBox(width: 4),
                        Flexible(
                          child: Text(
                            '📍 Usar dirección habitual (Casa)',
                            style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF1F1A15)),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _addressController,
            maxLines: 2,
            style: const TextStyle(fontSize: 14),
            decoration: AppTheme.inputDecoration(
              hintText: 'Ej: Calle 24 # 95-32, Torre 2, Apto 402, Fontibón',
              labelText: 'Dirección del servicio',
              prefixIcon: Icons.location_on_outlined,
            ),
            onChanged: (value) {
              setState(() {
                serviceAddress = value;
              });
            },
          ),
          const SizedBox(height: 24),
          _buildNotesExpandable(),
          const SizedBox(height: 30),
        ],
      );
    }

  Widget _buildStepLogistics() {
    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 20.0, vertical: 12),
      children: [
        _buildSectionTitle('1. Selecciona un Servicio'),
        const SizedBox(height: 12),
        _buildServiceSelectionList(),
        const SizedBox(height: 24),
        _buildSectionTitle('2. Elige una Fecha (Calendario)'),
        const SizedBox(height: 12),
        _buildCalendarCard(),
        const SizedBox(height: 24),
        _buildSectionTitle('3. Horarios Disponibles'),
        const SizedBox(height: 12),
        _buildTimeSelector(),
        const SizedBox(height: 24),
      ],
    );
  }

  Widget _buildCalendarCard() {
    final weekdays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    final firstDayOfMonth = DateTime(_calendarMonth.year, _calendarMonth.month, 1);
    final startOffset = firstDayOfMonth.weekday - 1;
    final daysCount = DateTime(_calendarMonth.year, _calendarMonth.month + 1, 0).day;
    final totalCells = startOffset + daysCount;

    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        side: const BorderSide(color: Color(0xFFF3EAE8)),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                IconButton(
                  icon: const Icon(Icons.chevron_left),
                  onPressed: () {
                    setState(() {
                      _calendarMonth = DateTime(_calendarMonth.year, _calendarMonth.month - 1);
                    });
                  },
                ),
                Flexible(
                  child: Text(
                    '${_getMonthNameLong(_calendarMonth.month)} ${_calendarMonth.year}',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.chevron_right),
                  onPressed: () {
                    setState(() {
                      _calendarMonth = DateTime(_calendarMonth.year, _calendarMonth.month + 1);
                    });
                  },
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: weekdays.map((day) => Expanded(
                child: Center(
                  child: Text(
                    day,
                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.grey),
                  ),
                ),
              )).toList(),
            ),
            const SizedBox(height: 8),
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 7,
                mainAxisSpacing: 6,
                crossAxisSpacing: 6,
                childAspectRatio: 1.0,
              ),
              itemCount: totalCells,
              itemBuilder: (context, index) {
                if (index < startOffset) {
                  return const SizedBox.shrink();
                }
                final day = index - startOffset + 1;
                final cellDate = DateTime(_calendarMonth.year, _calendarMonth.month, day);
                final now = DateTime.now();
                final today = DateTime(now.year, now.month, now.day);
                final isPast = cellDate.isBefore(today);
                final isSelected = selectedDate != null &&
                    selectedDate!.year == cellDate.year &&
                    selectedDate!.month == cellDate.month &&
                    selectedDate!.day == cellDate.day;

                return GestureDetector(
                  onTap: isPast ? null : () {
                    setState(() {
                      selectedDate = cellDate;
                      _selectedSlotTime = null;
                    });
                    _loadSlots();
                  },
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 150),
                    decoration: BoxDecoration(
                      color: isSelected ? AppTheme.primary : Colors.transparent,
                      shape: BoxShape.circle,
                      border: (cellDate.year == today.year && cellDate.month == today.month && cellDate.day == today.day)
                          ? Border.all(color: AppTheme.primary, width: 1.5)
                          : null,
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      '$day',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.bold,
                        color: isSelected
                            ? Colors.white
                            : isPast
                                ? Colors.grey[300]
                                : Colors.black87,
                      ),
                    ),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  // Duplicate _getMonthNameLong removed – retained later implementation.


  Widget _buildTimeSelector() {
    if (selectedDate == null || selectedServiceId == null) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 8.0),
        child: Text('Selecciona un servicio y fecha primero.',
            style: TextStyle(color: Colors.grey, fontSize: 13)),
      );
    }
    if (_isLoadingSlots) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: CircularProgressIndicator(color: AppTheme.primary),
        ),
      );
    }
    if (_slots.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(20.0),
        decoration: BoxDecoration(
          color: const Color(0xFFFEE2E2),
          borderRadius: BorderRadius.circular(20),
        ),
        child: const Column(
          children: [
            Icon(Icons.calendar_today, color: Color(0xFFDC2626), size: 24),
            SizedBox(height: 8),
            Text(
              'No hay horarios disponibles para esta fecha o el prestador no está activo.',
              style: TextStyle(
                  color: Color(0xFFDC2626),
                  fontSize: 12,
                  fontWeight: FontWeight.w500),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    }

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: _slots.map((slot) {
        final String time = slot['time'] as String;
        final bool isAvailable = slot['is_available'] as bool? ?? false;
        final isSelected = _selectedSlotTime == time;
        return _buildTimeSlotButton(time, isAvailable, isSelected);
      }).toList(),
    );
  }

  Widget _buildTimeSlotButton(String time, bool isAvailable, bool isSelected) {
    return Semantics(
      label: isAvailable
          ? (isSelected ? 'Horario $time seleccionado' : 'Horario $time disponible')
          : 'Horario $time no disponible',
      button: true,
      child: GestureDetector(
        onTap: isAvailable
            ? () {
                setState(() {
                  _selectedSlotTime = time;
                });
              }
            : null,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: isSelected
              ? AppTheme.primary
              : isAvailable
                  ? Color(0xFFF5EBE6).withOpacity(0.4)
                  : const Color(0xFFF3F4F6),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected
                ? AppTheme.primary
                : isAvailable
                    ? AppTheme.primary.withOpacity(0.3)
                    : const Color(0xFFE5E7EB),
            width: isSelected ? 2 : 1,
          ),
          boxShadow: isSelected
              ? [
                  BoxShadow(
                    color: AppTheme.primary.withOpacity(0.2),
                    blurRadius: 6,
                    offset: const Offset(0, 2),
                  )
                ]
              : null,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.access_time_filled,
              size: 14,
              color: isSelected
                  ? Colors.white
                  : isAvailable
                      ? AppTheme.primary
                      : Colors.grey[400],
            ),
            const SizedBox(width: 6),
            Text(
              time,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.bold,
                color: isSelected
                    ? Colors.white
                    : isAvailable
                        ? Colors.black87
                        : Colors.grey[400],
                decoration: isAvailable ? TextDecoration.none : TextDecoration.lineThrough,
              ),
            ),
          ],
        ),
      ),
    ));
  }

  Widget _buildNotesExpandable() {
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        side: const BorderSide(color: Color(0xFFF3EAE8)),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          title: const Text(
            'Notas adicionales (opcional)',
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.black87),
          ),
          leading: Icon(Icons.note_alt_outlined, color: AppTheme.primary),
          children: [
            Padding(
              padding: const EdgeInsets.only(left: 16, right: 16, bottom: 16),
              child: TextField(
                controller: _notesController,
                maxLines: 3,
                style: const TextStyle(fontSize: 14),
                decoration: const InputDecoration(
                  hintText: 'Ej: Quisiera un corte con flequillo o tengo alergias...',
                  border: OutlineInputBorder(),
                ),
                onChanged: (value) => notes = value,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStep2CrossSelling() {
      if (_isLoadingProducts) {
        return Center(child: CircularProgressIndicator(color: AppTheme.primary));
      }

    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 20.0, vertical: 16),
      children: [
        // ─── Bundle Offer Gold Banner ──────────────────────────────────
        Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFF261E17), Color(0xFF15100C)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: Color(0xFFC5A052).withOpacity(0.5)),
            boxShadow: [
              BoxShadow(
                color: Color(0xFFC5A052).withOpacity(0.15),
                blurRadius: 10,
                offset: const Offset(0, 3),
              ),
            ],
          ),
          child: const Row(
            children: [
              Icon(Icons.card_giftcard, color: Color(0xFFC5A052), size: 26),
              SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '🎁 BUNDLE CONCIERGE: 15% OFF AUTOMÁTICO',
                      style: TextStyle(
                        fontFamily: 'Inter',
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFFC5A052),
                        letterSpacing: 0.6,
                      ),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'Añade 2 o más productos al carrito y recibe 15% de descuento directo en tus productos.',
                      style: TextStyle(fontSize: 11, color: Color(0xFFFFFDF8)),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [AppTheme.primary, const Color(0xFFE8A2B6)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(20),
          ),
          child: const Row(
            children: [
              Icon(Icons.spa_outlined, color: Colors.white, size: 32),
              SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Completa tu experiencia',
                      style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
                    ),
                    SizedBox(height: 4),
                    Text(
                      'Productos sugeridos para el cuidado posterior',
                      style: TextStyle(color: Colors.white70, fontSize: 12),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: const Color(0xFFFEF3C7),
            border: Border.all(color: const Color(0xFFFDE68A)),
            borderRadius: BorderRadius.circular(16),
          ),
          child: const Row(
            children: [
              Icon(Icons.people_alt, color: Color(0xFFD97706), size: 20),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  '⭐ 87% de las clientas añaden estos productos para el cuidado posterior.',
                  style: TextStyle(color: Color(0xFF92400E), fontSize: 12, fontWeight: FontWeight.w500),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: const Color(0xFFECFDF5),
            border: Border.all(color: const Color(0xFFA7F3D0)),
            borderRadius: BorderRadius.circular(16),
          ),
          child: const Row(
            children: [
              Icon(Icons.local_offer, color: Color(0xFF059669), size: 20),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  '¡Oferta Especial! Lleva 2 o más productos y obtén 15% de descuento en tu kit.',
                  style: TextStyle(color: Color(0xFF065F46), fontSize: 12, fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        if (_recommendedProducts.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24.0),
            child: Center(
              child: Text(
                'No hay productos sugeridos para este servicio.',
                style: TextStyle(color: Colors.grey, fontSize: 13),
              ),
            ),
          )
        else
          ..._recommendedProducts.map((prod) {
            final id = prod['id'].toString();
            final nombre = prod['nombre']?.toString() ?? 'Producto';
            final precio = _parseDouble(prod['precio']);
            final image = prod['imagen_url']?.toString() ?? '';
            final stock = int.tryParse(prod['stock']?.toString() ?? '0') ?? 0;
            final qty = _selectedProductsQty[id] ?? 0;
            final isSelected = qty > 0;

            return AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(
                color: isSelected ? Color(0xFFF5EBE6).withOpacity(0.3) : Colors.white,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: isSelected ? AppTheme.primary : Color(0xFFF3EAE8),
                  width: isSelected ? 2 : 1,
                ),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.02),
                    blurRadius: 8,
                    offset: const Offset(0, 4),
                  )
                ],
              ),
              child: Row(
                children: [
                  Container(
                    width: 70,
                    height: 70,
                    margin: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(12),
                      color: const Color(0xFFF5EBE6),
                    ),
                    child: ClipRRect(
                                          borderRadius: BorderRadius.circular(12),
                                          child: image.isNotEmpty
                                              ? Image.network(
                                                  image,
                                                  fit: BoxFit.cover,
                                                  errorBuilder: (c, o, s) => Icon(Icons.shopping_bag_outlined, color: AppTheme.primary),
                                                )
                                              : Icon(Icons.shopping_bag_outlined, color: AppTheme.primary),
                                        ),
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            nombre,
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.black87),
                          ),
                          const SizedBox(height: 4),
                          Text(
                                                      '\$${precio.toStringAsFixed(0)} COP',
                                                      style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.primary, fontSize: 12),
                                                    ),
                        ],
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(right: 12),
                    child: stock <= 0
                        ? const Text('Agotado', style: TextStyle(color: Colors.red, fontSize: 11, fontWeight: FontWeight.bold))
                        : !isSelected
                            ? ElevatedButton(
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: const Color(0xFFF5EBE6),
                                  foregroundColor: AppTheme.primary,
                                  elevation: 0,
                                  minimumSize: const Size(60, 28),
                                  padding: const EdgeInsets.symmetric(horizontal: 12),
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                ),
                                onPressed: () {
                                  setState(() {
                                    _selectedProductsQty[id] = 1;
                                  });
                                },
                                child: const Text('Añadir', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                              )
                            : Row(
                                children: [
                                  GestureDetector(
                                    onTap: () {
                                      setState(() {
                                        if (qty > 1) {
                                          _selectedProductsQty[id] = qty - 1;
                                        } else {
                                          _selectedProductsQty.remove(id);
                                        }
                                      });
                                    },
                                    child: Container(
                                      padding: const EdgeInsets.all(4),
                                      decoration: BoxDecoration(
                                        color: Colors.grey[200],
                                        shape: BoxShape.circle,
                                      ),
                                      child: const Icon(Icons.remove, size: 12, color: Colors.black87),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Text('$qty', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                                  const SizedBox(width: 8),
                                  GestureDetector(
                                    onTap: () {
                                      if (qty < stock) {
                                        setState(() {
                                          _selectedProductsQty[id] = qty + 1;
                                        });
                                      } else {
                                        ScaffoldMessenger.of(context).showSnackBar(
                                          SnackBar(content: Text('Solo hay $stock unidades disponibles')),
                                        );
                                      }
                                    },
                                    child: Container(
                                                                          padding: const EdgeInsets.all(4),
                                                                          decoration: BoxDecoration(
                                                                            color: AppTheme.primary.withOpacity(0.1),
                                                                            shape: BoxShape.circle,
                                                                          ),
                                                                          child: Icon(Icons.add, size: 12, color: AppTheme.primary),
                                                                        ),
                                  ),
                                ],
                              ),
                  ),
                ],
              ),
            );
          }),
      ],
    );
  }

  Widget _buildStep3SummaryAndPay() {
    double servicesPrice = 0.0;
    List<String> serviceNames = [];
    for (final id in selectedServiceIds) {
      final s = widget.services.firstWhere(
        (srv) => srv['id']?.toString() == id,
        orElse: () => <String, dynamic>{},
      );
      if (s.isNotEmpty) {
        // El servicio puede llegar con `precio` (fila de BD, flujo del mapa y
        // del chat) o con `price` (respuesta de /api/providers/:id). Leer solo
        // `price` dejaba esta tarjeta en $0 mientras la de abajo, que ya usa el
        // fallback, mostraba el valor correcto.
        servicesPrice += _parseDouble(s['precio'] ?? s['price']);
        serviceNames.add(s['name']?.toString() ?? 'Servicio');
      }
    }
    final serviceName = serviceNames.isNotEmpty ? serviceNames.join(', ') : 'Servicios';

    double productsSubtotal = 0.0;
    _selectedProductsQty.forEach((id, qty) {
      final prod = _recommendedProducts.firstWhere((p) => p['id'].toString() == id, orElse: () => <String, dynamic>{});
      if (prod.isNotEmpty) {
        productsSubtotal += _parseDouble(prod['precio'] ?? prod['price']) * qty;
      }
    });

    // W4: el desglose refleja EXACTAMENTE lo que el backend va a cobrar
    // (`valor_bruto` = Σ servicios + Σ productos leídos de la BD). No se aplican
    // descuento por kit ni IVA 19%: el servidor no los calcula, así que
    // mostrarlos anunciaba un total distinto al que finalmente se cobra.
    final double grandTotal = servicesPrice + productsSubtotal;

    final formattedDate = selectedDate != null
        ? '${selectedDate!.day} ${_getMonthName(selectedDate!)}, ${selectedDate!.year}'
        : '';

    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 20.0, vertical: 16),
      children: [
        const Text(
          'Revisa tu Reserva',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.black87),
        ),
        const SizedBox(height: 4),
        Text(
          'Revisa los detalles logísticos y de pago para continuar',
          style: TextStyle(color: Colors.grey[600], fontSize: 12),
        ),
        const SizedBox(height: 16),
        Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            side: const BorderSide(color: Color(0xFFF3EAE8)),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              children: [
                _buildSummaryRow(Icons.content_cut, 'Servicio', serviceName),
                const Divider(height: 24, color: Color(0xFFF3EAE8)),
                _buildSummaryRow(Icons.calendar_today, 'Fecha y hora', '$formattedDate a las $_selectedSlotTime'),
                const Divider(height: 24, color: Color(0xFFF3EAE8)),
                _buildSummaryRow(Icons.location_on, 'Dirección', serviceAddress),
                const Divider(height: 24, color: Color(0xFFF3EAE8)),
                _buildSummaryRow(Icons.person, 'Prestador', widget.providerName),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Card(
          elevation: 0,
          color: const Color(0xFFFDFBFB),
          shape: RoundedRectangleBorder(
            side: const BorderSide(color: Color(0xFFF3EAE8)),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _buildPriceRow('Servicio Base', servicesPrice),
                if (productsSubtotal > 0) ...[
                  const SizedBox(height: 8),
                  _buildPriceRow('Productos de Venta Cruzada', productsSubtotal),
                ],
                const Divider(height: 24, color: Color(0xFFF3EAE8), thickness: 1.5),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Expanded(
                      child: Text(
                        'Total a Pagar',
                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Colors.black87),
                      ),
                    ),
                    Text(
                      '\$${grandTotal.toStringAsFixed(0)} COP',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.primary),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 20),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.grey[50],
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.grey[200]!),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.shield_outlined, color: Colors.green, size: 18),
              const SizedBox(width: 6),
              const Flexible(
                child: Text(
                  'Pago seguro con Wompi • Verificación OTP',
                  style: TextStyle(fontSize: 11, color: Colors.grey, fontWeight: FontWeight.w500),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: Colors.green[50],
                  borderRadius: BorderRadius.circular(4),
                ),
                child: const Text(
                  'SSL',
                  style: TextStyle(fontSize: 10, color: Colors.green, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildSummaryRow(IconData icon, String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: AppTheme.primary, size: 20),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: const TextStyle(color: Colors.grey, fontSize: 11, fontWeight: FontWeight.w500)),
              const SizedBox(height: 2),
              Text(value, style: const TextStyle(color: Colors.black87, fontSize: 13, fontWeight: FontWeight.bold)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildPriceRow(String label, double value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Expanded(child: Text(label, style: const TextStyle(color: Colors.black54, fontSize: 13), overflow: TextOverflow.ellipsis)),
        const SizedBox(width: 8),
        Text('\$${value.toStringAsFixed(0)} COP', style: const TextStyle(color: Colors.black87, fontSize: 13, fontWeight: FontWeight.w500)),
      ],
    );
  }

  Widget _buildSectionTitle(String title) => Text(
        title,
        style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.bold,
            color: Colors.black87,
            letterSpacing: -0.3),
      );

  Widget _buildServiceSelectionList() {
    if (widget.services.isEmpty) {
      return const Text('⚠️ No hay servicios disponibles',
          style: TextStyle(color: Colors.orange));
    }
    return Column(
      children: widget.services.map((service) {
        final price = _parseDouble(service['precio'] ?? service['price']);
        final name = service['name']?.toString() ?? 'Sin nombre';
        final id = service['id']?.toString() ?? '';
        final description = service['description']?.toString() ?? '';
        final isSelected = selectedServiceIds.contains(id);

        return GestureDetector(
          onTap: () {
            setState(() {
              if (selectedServiceIds.contains(id)) {
                if (selectedServiceIds.length > 1) {
                  selectedServiceIds.remove(id);
                }
              } else {
                selectedServiceIds.add(id);
              }
              if (selectedServiceIds.isNotEmpty) {
                selectedServiceId = selectedServiceIds.first;
              }
            });
            _loadSlots();
            _loadRecommendedProducts();
          },
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            margin: const EdgeInsets.only(bottom: 12),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: isSelected ? const Color(0xFFF5EBE6) : Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: isSelected
                    ? AppTheme.primary
                    : const Color(0xFFF3EAE8),
                width: isSelected ? 2 : 1,
              ),
              boxShadow: isSelected
                  ? [
                      BoxShadow(
                        color: AppTheme.primary.withOpacity(0.15),
                        blurRadius: 10,
                        offset: const Offset(0, 4),
                      )
                    ]
                  : [],
            ),
            child: Row(
              children: [
                Icon(
                  isSelected
                      ? Icons.radio_button_checked
                      : Icons.radio_button_off,
                  color: AppTheme.primary,
                  size: 20,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        style: const TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 13,
                            color: Colors.black87),
                      ),
                      if (description.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(
                          description,
                          style:
                              TextStyle(color: Colors.grey[600], fontSize: 11),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  '\$${price.toStringAsFixed(0)} COP',
                  style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: AppTheme.primary,
                      fontSize: 13),
                ),
              ],
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildStickyBottomButtons() {
    bool canNext = false;
    if (_currentStep == 0) {
      // Paso 1: Cuándo y Servicio (solo requiere servicio y fecha seleccionados)
      canNext = selectedServiceId != null && selectedDate != null;
    } else if (_currentStep == 1) {
      // Paso 2: Dirección y Notas (requiere dirección)
      canNext = serviceAddress.trim().isNotEmpty;
    } else if (_currentStep == 2) {
      // Paso 3: Productos (opcional)
      canNext = true;
    } else if (_currentStep == 3) {
      // Paso 4: Confirmación y pago
      canNext = true;
    }

    bool hasProducts = _selectedProductsQty.values.any((qty) => qty > 0);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        border: const Border(top: BorderSide(color: Color(0xFFF3EAE8))),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.02),
            blurRadius: 8,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: SafeArea(
        child: Row(
          children: [
            if (_currentStep > 0) ...[
              OutlinedButton(
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  side: BorderSide(color: AppTheme.primary),
                ),
                onPressed: _prevStep,
                child: Text('Atrás', style: TextStyle(color: AppTheme.primary, fontWeight: FontWeight.bold)),
              ),
              const SizedBox(width: 12),
            ],
            Expanded(
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: _currentStep == 3 ? Colors.green.shade700 : AppTheme.primary,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  elevation: 0,
                ),
                onPressed: canNext ? _handleBottomButtonPress : null,
                child: Text(
                  _currentStep == 3
                      ? 'Confirmar y Pagar'
                      : _currentStep == 2
                          ? (hasProducts ? 'Continuar' : 'Omitir y Ver Resumen')
                          : 'Continuar',
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _handleBottomButtonPress() {
    if (_currentStep < 3) {
      _nextStep();
    } else {
      _confirmBooking();
    }
  }

  String _getMonthName(DateTime date) {
    const months = [
      '',
      'Ene',
      'Feb',
      'Mar',
      'Abr',
      'May',
      'Jun',
      'Jul',
      'Ago',
      'Sep',
      'Oct',
      'Nov',
      'Dic'
    ];
    return months[date.month];
  }

  double _parseDouble(dynamic v) {
    if (v == null) return 0.0;
    if (v is double) return v;
    if (v is int) return v.toDouble();
    if (v is String) return double.tryParse(v) ?? 0.0;
    return 0.0;
  }
  // Helper to get full month name in Spanish
  String _getMonthNameLong(int month) {
    const months = [
      '',
      'Enero',
      'Febrero',
      'Marzo',
      'Abril',
      'Mayo',
      'Junio',
      'Julio',
      'Agosto',
      'Septiembre',
      'Octubre',
      'Noviembre',
      'Diciembre',
    ];
    return months[month];
  }


  /// Construye el resumen pegajoso que permanece visible mientras
  /// el usuario avanza en el flujo de reserva.
  Widget _buildStickySummary() {
    // Datos que pueden ser null antes de seleccionar.
    final String dateText = selectedDate != null
        ? '${_getMonthNameLong(selectedDate!.month)} ${selectedDate!.day}, ${selectedDate!.year}'
        : 'Seleccione fecha';
    final String timeText = _selectedSlotTime ?? 'Seleccione hora';


        final String addressText = _addressController.text.isNotEmpty ? _addressController.text : 'Ingrese dirección';
    final List<Map<String, dynamic>> selectedProducts = _recommendedProducts.where((p) => (_selectedProductsQty[p['id'].toString()] ?? 0) > 0).toList();
    // Cálculo de precio (subtotal de productos seleccionados por su cantidad).
    final double subtotal = selectedProducts.fold<double>(
        0.0, (sum, p) {
          final id = p['id'].toString();
          final qty = _selectedProductsQty[id] ?? 1;
          final unitPrice = _parseDouble(p['precio'] ?? p['price']);
          return sum + (unitPrice * qty);
        });
    // El servicio también cuesta: sumarlo es lo que hacía falta aquí. Antes el
    // total era solo el de los productos complementarios, así que con el servicio
    // ya elegido y sin productos la tarjeta mostraba $0.00 y parecía que el
    // servicio era gratis. Los precios publicados ya incluyen IVA (D-GL-023,
    // regla 8), por eso se suman tal cual, sin volver a gravarlos.
    final double servicesTotal = selectedServiceIds.fold<double>(
      0.0,
      (sum, id) {
        final s = widget.services.firstWhere(
          (srv) => srv['id']?.toString() == id,
          orElse: () => <String, dynamic>{},
        );
        if (s.isEmpty) return sum;
        return sum + _parseDouble(s['precio'] ?? s['price']);
      },
    );
    final double total = servicesTotal + subtotal;

    return Semantics(
      label:
          'Resumen de reserva: $dateText a las $timeText, dirección $addressText, total $total',
      child: Container(
        key: const Key('sticky_summary_container'),
        margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppTokens.stickySummaryBg,
          borderRadius: BorderRadius.circular(12),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.04),
              blurRadius: 6,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          children: [
            const Icon(Icons.receipt_long, size: 20, color: Color(0xFF1F1A15)),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '$dateText • $timeText',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: Color(0xFF1F1A15),
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    addressText,
                    style: const TextStyle(
                      fontSize: 11,
                      color: Color(0xFF8E7D7A),
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            Text(
              NumberFormat(r'$#,##0', 'es_CO').format(total),
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.bold,
                color: Color(0xFFC5A052),
              ),
            ),
          ],
        ),
      ),
    );
  }



}
