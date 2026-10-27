// frontend/lib/screens/client_bookings_screen.dart
import 'package:glow_core/glow_core.dart';
import 'package:flutter/material.dart';
import 'otp_confirm_screen.dart';
class ClientBookingsScreen extends StatefulWidget {
  const ClientBookingsScreen({super.key});

  @override
  State<ClientBookingsScreen> createState() => _ClientBookingsScreenState();
}

class _ClientBookingsScreenState extends State<ClientBookingsScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<Map<String, dynamic>> _bookings = [];
  bool _isLoading = true;
  String? _error;
  bool _showSuccessOverlay = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadBookings();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadBookings() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final data = await ApiService.fetchClientBookings();
      if (mounted) {
        setState(() {
          _bookings = data;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _confirmCancelBooking(
      String bookingId, String providerName) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
              title: Row(
                children: [
                  Icon(Icons.warning_amber_rounded, color: AppTheme.error, size: 28),
                  SizedBox(width: 8),
                  Text('¿Cancelar cita?',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                ],
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('¿Estás seguro de que deseas cancelar tu cita? Esta acción no se puede deshacer.'),
                  SizedBox(height: 12),
                  Card(
              color: Color(0xFFFEF2F2),
              elevation: 0,
              shape: RoundedRectangleBorder(
                side: BorderSide(color: Color(0xFFFEE2E2)),
                borderRadius: BorderRadius.all(Radius.circular(12)),
              ),
              child: Padding(
                padding: EdgeInsets.all(12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.info_outline, color: AppTheme.error, size: 20),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Aviso de Reembolso: Se descontarán los valores administrativos y tributarios incurridos del monto total pagado. No se realiza devolución del dinero en su totalidad.',
                        style: TextStyle(
                          fontSize: 12,
                          color: Color(0xFF991B1B),
                          fontWeight: FontWeight.w500,
                          height: 1.3,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Volver',
                style:
                    TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.errorBg,
              foregroundColor: AppTheme.error,
              elevation: 0,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(30)),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            ),
            child: const Text('Cancelar Cita',
                style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );

    if (confirm == true) {
      setState(() => _isLoading = true);
      try {
        await ApiService.cancelBooking(bookingId);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: const Row(
                children: [
                  Icon(Icons.check_circle, color: Colors.white),
                  SizedBox(width: 8),
                  Text('Tu cita ha sido cancelada con éxito.'),
                ],
              ),
              backgroundColor: AppTheme.primary,
              behavior: SnackBarBehavior.floating,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20)),
            ),
          );
        }
        _loadBookings();
      } catch (e) {
        if (mounted) {
          setState(() => _isLoading = false);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('❌ Error al cancelar: $e'),
              backgroundColor: AppTheme.error,
            ),
          );
        }
      }
    }
  }

  Future<void> _submitReviewHelper(
      String bookingId, int ratingSelected, String reviewComment) async {
    setState(() => _isLoading = true);
    try {
      await ApiService.submitReview(bookingId, ratingSelected, reviewComment);
      if (mounted) {
        setState(() {
          _isLoading = false;
          _showSuccessOverlay = true;
        });
      }
      _loadBookings();
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('❌ Error al enviar reseña: $e'),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    }
  }

  // D-GL-023 — la propina es 100% del prestador y no paga comisión.
  // El endpoint ya existe: POST /api/bookings/:id/tip. Si el entorno no tiene
  // pasarela, el backend deja la propina PENDIENTE y lo informa; nunca simula
  // un cobro que no ocurrió.
  Future<void> _submitTip(String bookingId, double amount) async {
    if (!mounted) return;
    try {
      final res = await ApiService.submitTip(bookingId, amount);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(res['mensaje']?.toString() ?? 'Propina enviada'),
          backgroundColor: AppTheme.primary,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('No se pudo registrar la propina: $e'),
          backgroundColor: AppTheme.error,
        ),
      );
    }
  }

  void _showRatingSheet(Map<String, dynamic> booking) {
    int ratingSelected = 5;
    String reviewComment = '';
    final commentController = TextEditingController();

    // Módulo de Propinas
    String selectedTipOption = 'Sin propina';
    double tipAmount = 0.0;
    bool showCustomTipField = false;
    final customTipController = TextEditingController();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        final totalAmount =
            toDoubleOr(booking['total_amount'], 0.0);
        final providerName = (booking['provider_business_name'] != null &&
                booking['provider_business_name'].toString().isNotEmpty)
            ? booking['provider_business_name'].toString()
            : (booking['provider_name']?.toString() ?? 'Prestador');

        return StatefulBuilder(
          builder: (BuildContext context, StateSetter setModalState) {
            Widget buildTipCard(String label, String value, String emoji) {
              final isSelected = selectedTipOption == value;
              return GestureDetector(
                onTap: () {
                  setModalState(() {
                    selectedTipOption = value;
                    if (value == 'Sin propina') {
                      tipAmount = 0.0;
                      showCustomTipField = false;
                    } else if (value == '5%') {
                      tipAmount = totalAmount * 0.05;
                      showCustomTipField = false;
                    } else if (value == '10%') {
                      tipAmount = totalAmount * 0.10;
                      showCustomTipField = false;
                    } else if (value == '15%') {
                      tipAmount = totalAmount * 0.15;
                      showCustomTipField = false;
                    } else if (value == 'Personalizada') {
                      showCustomTipField = true;
                      final customVal =
                          double.tryParse(customTipController.text) ?? 0.0;
                      tipAmount = customVal;
                    }
                  });
                },
                child: Container(
                  width: 72,
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  decoration: BoxDecoration(
                    color: isSelected
                        ? AppTheme.primary
                        : AppTheme.accent.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: isSelected ? AppTheme.primary : Colors.transparent,
                      width: 1.5,
                    ),
                    boxShadow: isSelected ? AppTheme.softShadow : null,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(emoji, style: const TextStyle(fontSize: 18)),
                      const SizedBox(height: 4),
                      Text(
                        label,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          color: isSelected ? Colors.white : Colors.black87,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }

            return Padding(
              padding: EdgeInsets.only(
                bottom: MediaQuery.of(context).viewInsets.bottom,
                left: 20,
                right: 20,
                top: 24,
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Center(
                      child: Container(
                        width: 40,
                        height: 5,
                        decoration: BoxDecoration(
                          color: Colors.grey[300],
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    const Text(
                      'Calificar tu servicio',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                        color: Colors.black87,
                        letterSpacing: -0.5,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Cuéntanos tu experiencia con $providerName',
                      style: TextStyle(color: Colors.grey[600], fontSize: 14),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 20),

                    // Selector de estrellas con micro-animaciones
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: List.generate(5, (index) {
                        final starValue = index + 1;
                        return AnimatedStarButton(
                          iconSize: 40,
                          isSelected: starValue <= ratingSelected,
                          onPressed: () {
                            setModalState(() {
                              ratingSelected = starValue;
                            });
                          },
                        );
                      }),
                    ),
                    const SizedBox(height: 16),

                    // Comentario escrito
                    TextField(
                      controller: commentController,
                      maxLines: 3,
                      style: const TextStyle(fontSize: 14),
                      decoration: InputDecoration(
                        hintText: 'Escribe tu comentario aquí (opcional)...',
                        hintStyle:
                            const TextStyle(color: Colors.grey, fontSize: 14),
                        border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(24),
                            borderSide: BorderSide.none),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(24),
                          borderSide: BorderSide.none,
                        ),
                        focusedBorder: OutlineInputBorder(
                                                  borderRadius: BorderRadius.circular(24),
                                                  borderSide: BorderSide(
                                                      color: AppTheme.primary, width: 1.5),
                                                ),
                        filled: true,
                        fillColor: AppTheme.accent.withValues(alpha: 0.15),
                        contentPadding: const EdgeInsets.all(16),
                      ),
                      onChanged: (v) => reviewComment = v,
                    ),
                    const SizedBox(height: 20),

                    // Módulo de Propinas como tarjetas con emojis
                    const Text(
                      '¿Deseas agregar una propina?',
                      style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: Colors.black87),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        buildTipCard('0%', 'Sin propina', '😊'),
                        buildTipCard('5%', '5%', '👍'),
                        buildTipCard('10%', '10%', '⭐'),
                        buildTipCard('15%', '15%', '🔥'),
                        buildTipCard('Custom', 'Personalizada', '✏️'),
                      ],
                    ),
                    // A360-2026-09-22/C-02: aviso explícito — no hay pasarela de
                    // propinas integrada, así que no se puede cobrar ninguna.
                    const SizedBox(height: 8),
                    const Text(
                      'El cobro de propina todavía no está disponible en la app.',
                      style: TextStyle(
                          fontSize: 11,
                          fontStyle: FontStyle.italic,
                          color: Colors.grey),
                    ),
                    if (showCustomTipField) ...[
                      const SizedBox(height: 12),
                      TextField(
                        controller: customTipController,
                        keyboardType: TextInputType.number,
                        style: const TextStyle(fontSize: 14),
                        decoration: InputDecoration(
                          labelText: 'Valor de propina personalizado (\$)',
                          labelStyle: const TextStyle(fontSize: 12),
                          prefixText: '\$ ',
                          border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(16)),
                          focusedBorder: OutlineInputBorder(
                                                      borderRadius: BorderRadius.circular(16),
                                                      borderSide: BorderSide(
                                                          color: AppTheme.primary, width: 1.5),
                                                    ),
                        ),
                        onChanged: (val) {
                          final parsed = double.tryParse(val) ?? 0.0;
                          setModalState(() {
                            tipAmount = parsed;
                          });
                        },
                      ),
                    ],

                    const SizedBox(height: 16),
                    // Desglose de Pago
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: AppTheme.background,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: const Color(0xFFF3EAE8)),
                      ),
                      child: Column(
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Text('Servicio:',
                                  style: TextStyle(
                                      fontSize: 12, color: Colors.black54)),
                              Text('\$${totalAmount.toStringAsFixed(0)}',
                                  style: const TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.bold)),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Text('Propina:',
                                  style: TextStyle(
                                      fontSize: 12, color: Colors.black54)),
                              Text('\$${tipAmount.toStringAsFixed(0)}',
                                                                style: TextStyle(
                                                                    fontSize: 12,
                                                                    fontWeight: FontWeight.bold,
                                                                    color: AppTheme.success)),
                                                          ],
                                                        ),
                                                        const Divider(height: 16),
                                                        Row(
                                                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                                          children: [
                                                            const Text('Total a pagar:',
                                                                style: TextStyle(
                                                                    fontSize: 13,
                                                                    fontWeight: FontWeight.bold)),
                                                            Text(
                                                                '\$${(totalAmount + tipAmount).toStringAsFixed(0)}',
                                                                style: TextStyle(
                                                                    fontSize: 15,
                                                                    fontWeight: FontWeight.bold,
                                                                    color: AppTheme.primary)),
                                                          ],
                                                        ),
                        ],
                      ),
                    ),
                    SizedBox(height: 24),

                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppTheme.primary,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(30)),
                        elevation: 0,
                      ),
                      onPressed: () async {
                        Navigator.pop(context); // Cerrar rating sheet
                        if (tipAmount > 0.0) {
                          await _submitTip(
                              booking['id'].toString(), tipAmount);
                        }
                        _submitReviewHelper(
                            booking['id'], ratingSelected, reviewComment);
                      },
                      child: const Text('Enviar Calificación',
                          style: TextStyle(
                              fontSize: 16, fontWeight: FontWeight.bold)),
                    ),
                    const SizedBox(height: 24),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  String _formatDateTime(String? scheduledAtStr) {
    if (scheduledAtStr == null) {
      return '';
    }
    try {
      final date = DateTime.parse(scheduledAtStr).toLocal();
      final day = date.day.toString().padLeft(2, '0');
      final month = date.month.toString().padLeft(2, '0');
      final year = date.year;
      final hour = date.hour.toString().padLeft(2, '0');
      final minute = date.minute.toString().padLeft(2, '0');
      return '$day/$month/$year - $hour:$minute';
    } catch (_) {
      return scheduledAtStr;
    }
  }

  Color _getStatusColor(String status) {
    final s = status.toUpperCase();
    switch (s) {
      case 'PENDING':
      case 'PENDIENTE_PAGO':
        return AppTheme.warning;
      case 'CONFIRMED':
      case 'CONFIRMADA':
      case 'CHECKIN_REALIZADO':
        return const Color(0xFF2563EB);
      case 'EN_PROGRESO':
        return const Color(0xFF8B5CF6);
      case 'FINALIZADA_PRESTADOR':
      case 'ESPERANDO_OTP':
        return const Color(0xFF06B6D4);
      case 'COMPLETED':
      case 'COMPLETADA':
        return AppTheme.success;
      case 'EN_DISPUTA':
        return const Color(0xFFEA580C);
      case 'CANCELLED':
      case 'CANCELADA':
        return AppTheme.error;
      default:
        return Colors.grey;
    }
  }

  Color _getStatusBgColor(String status) {
    final s = status.toUpperCase();
    switch (s) {
      case 'PENDING':
      case 'PENDIENTE_PAGO':
        return AppTheme.warningBg;
      case 'CONFIRMED':
      case 'CONFIRMADA':
      case 'CHECKIN_REALIZADO':
        return const Color(0xFFDBEAFE);
      case 'EN_PROGRESO':
        return const Color(0xFFEDE9FE);
      case 'FINALIZADA_PRESTADOR':
      case 'ESPERANDO_OTP':
        return const Color(0xFFECFEFF);
      case 'COMPLETED':
      case 'COMPLETADA':
        return AppTheme.successBg;
      case 'EN_DISPUTA':
        return const Color(0xFFFFF7ED);
      case 'CANCELLED':
      case 'CANCELADA':
        return AppTheme.errorBg;
      default:
        return const Color(0xFFF3F4F6);
    }
  }

  String _getStatusText(String status) {
    final s = status.toUpperCase();
    switch (s) {
      case 'PENDING':
      case 'PENDIENTE_PAGO':
        return 'Pendiente Pago';
      case 'CONFIRMED':
      case 'CONFIRMADA':
        return 'Confirmada';
      case 'CHECKIN_REALIZADO':
        return 'Prestador llegó';
      case 'EN_PROGRESO':
        return 'En Progreso';
      case 'FINALIZADA_PRESTADOR':
      case 'ESPERANDO_OTP':
        return '¡Ingresa tu código!';
      case 'COMPLETED':
      case 'COMPLETADA':
        return 'Completada';
      case 'EN_DISPUTA':
        return 'En Disputa';
      case 'CANCELLED':
      case 'CANCELADA':
        return 'Cancelada';
      default:
        return status;
    }
  }

  Widget _buildEmptyState(String message) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.calendar_today_outlined,
                size: 64, color: AppTheme.primary),
            const SizedBox(height: 16),
            Text(
              message,
              style: const TextStyle(
                  fontSize: 15,
                  color: Colors.grey,
                  fontWeight: FontWeight.w500),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: () => Navigator.pop(context),
              icon: const Icon(Icons.search),
              label: const Text('Explorar Prestadores'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primary,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(30)),
                padding:
                    const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
                elevation: 0,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBookingCard(Map<String, dynamic> booking, bool isUpcoming) {
    final status = booking['status']?.toString() ?? 'pending';
    final providerName = (booking['provider_business_name'] != null &&
            booking['provider_business_name'].toString().isNotEmpty)
        ? booking['provider_business_name'].toString()
        : (booking['provider_name']?.toString() ?? 'Establecimiento');

    final avatarUrl = booking['provider_avatar_url']?.toString() ?? '';
    final serviceName = booking['service_name']?.toString() ?? 'Servicio';
    final scheduledAt = booking['scheduled_at']?.toString() ?? '';
    final totalAmount = toDoubleOr(booking['total_amount'], 0.0);
    final isReviewed = booking['is_reviewed'] == true;
    final reviewData = booking['review'] as Map<String, dynamic>?;

    final isMen = AudienceService.isMenMode;
    final cardBg = isMen ? MensTheme.obsidianCard : Colors.white;
    final primaryColor = isMen ? MensTheme.champagneGold : AppTheme.primary;
    final textColor = isMen ? MensTheme.textPrimary : Colors.black87;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(24),
        border: isMen ? Border.all(color: MensTheme.champagneGold.withValues(alpha: 0.2)) : null,
        boxShadow: AppTheme.softShadow,
      ),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 24,
                  backgroundColor: AppTheme.accent.withValues(alpha: 0.2),
                  backgroundImage:
                      avatarUrl.isNotEmpty ? NetworkImage(avatarUrl) : null,
                  child: avatarUrl.isEmpty
                      ? Text(
                          providerName.isNotEmpty
                                                        ? providerName[0].toUpperCase()
                                                        : 'P',
                                                    style: TextStyle(
                                                        color: AppTheme.primary,
                                                        fontWeight: FontWeight.bold,
                                                        fontSize: 18),
                                                  )
                      : null,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        providerName,
                        style: const TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 16,
                            letterSpacing: -0.3),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          Icon(Icons.access_time_filled_rounded,
                              size: 14, color: Colors.grey[500]),
                          const SizedBox(width: 4),
                          Text(
                            _formatDateTime(scheduledAt),
                            style: TextStyle(
                                color: Colors.grey[600], fontSize: 13),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: _getStatusBgColor(status),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    _getStatusText(status),
                    style: TextStyle(
                      color: _getStatusColor(status),
                      fontWeight: FontWeight.bold,
                      fontSize: 11,
                    ),
                  ),
                ),
              ],
            ),
            Divider(height: 24, color: Color(0xFFF3F4F6)),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        serviceName,
                        style: const TextStyle(
                            fontWeight: FontWeight.w600, fontSize: 15),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Duración: ${booking['service_duration']} min',
                        style: TextStyle(color: Colors.grey[500], fontSize: 13),
                      ),
                    ],
                  ),
                ),
                Text(
                  '\$${totalAmount.toStringAsFixed(0)}',
                                    style: TextStyle(
                                      fontSize: 18,
                                      fontWeight: FontWeight.bold,
                                      color: AppTheme.primary,
                                    ),
                ),
              ],
            ),
            if (booking['service_address'] != null &&
                booking['service_address'].toString().isNotEmpty) ...[
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFF8F4F1),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Text(
                  'Dirección del servicio: ${booking['service_address']}',
                  style: TextStyle(fontSize: 13, color: Colors.grey[700]),
                ),
              ),
            ],
            if (booking['notes'] != null &&
                booking['notes'].toString().isNotEmpty) ...[
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppTheme.accent.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Text(
                  'Nota: "${booking['notes']}"',
                  style: TextStyle(
                      fontSize: 13,
                      color: Colors.grey[700],
                      fontStyle: FontStyle.italic),
                ),
              ),
            ],
            // ─── OTP: Cuando el prestador marcó el servicio completado ───
            if (status.toUpperCase() == 'ESPERANDO_OTP' ||
                status.toUpperCase() == 'FINALIZADA_PRESTADOR') ...[
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF6B21A8), Color(0xFF9333EA)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFF6B21A8).withValues(alpha: 0.3),
                      blurRadius: 16,
                      offset: const Offset(0, 6),
                    ),
                  ],
                ),
                child: Column(
                  children: [
                    const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.verified_rounded,
                            color: Colors.white, size: 24),
                        SizedBox(width: 8),
                        Text(
                          '¡El servicio ha finalizado!',
                          style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 15),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'El prestador completó el servicio. Ingresa tu código de 6 dígitos para confirmar y liberar el pago.',
                      style: TextStyle(color: Colors.white70, fontSize: 13),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 14),
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton.icon(
                        onPressed: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => OtpConfirmScreen(
                              bookingId: booking['id'],
                              prestadorNombre: providerName,
                              servicioNombre: serviceName,
                              valorBruto: totalAmount,
                            ),
                          ),
                        ).then((_) => _loadBookings()),
                        icon: const Icon(Icons.lock_open_rounded,
                            color: Color(0xFF6B21A8)),
                        label: const Text(
                          'Ingresar código de confirmación',
                          style: TextStyle(
                              color: Color(0xFF6B21A8),
                              fontWeight: FontWeight.bold),
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 13),
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(30)),
                          elevation: 0,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            // ─── Estado en disputa ───
            if (status.toUpperCase() == 'EN_DISPUTA') ...[
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF7ED),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFFFED7AA)),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.gavel, color: Color(0xFFEA580C), size: 20),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Esta reserva tiene una disputa activa. El equipo la resolverá en máx. 48 horas.',
                        style:
                            TextStyle(color: Color(0xFF9A3412), fontSize: 13),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            if (reviewData != null) ...[
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppTheme.warningBg,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppTheme.warning.withValues(alpha: 0.2)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Row(
                          children: List.generate(5, (starIndex) {
                            return Icon(
                              starIndex < reviewData['rating']
                                  ? Icons.star_rounded
                                  : Icons.star_border_rounded,
                              color: AppTheme.warning,
                              size: 16,
                            );
                          }),
                        ),
                        const SizedBox(width: 8),
                        const Text(
                          'Tu calificación',
                          style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              color: Colors.black54),
                        ),
                      ],
                    ),
                    if (reviewData['comment'] != null &&
                        reviewData['comment'].toString().isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Text(
                        '"${reviewData['comment']}"',
                        style: TextStyle(
                            fontSize: 13, color: Colors.grey[800], height: 1.3),
                      ),
                    ],
                  ],
                ),
              ),
            ],
            if (status.toUpperCase() == 'CONFIRMADA' ||
                status.toUpperCase() == 'CONFIRMED' ||
                status.toUpperCase() == 'EN_PROGRESO') ...[
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: () {
                    Navigator.pushNamed(
                      context,
                      '/booking-tracking',
                      arguments: booking,
                    );
                  },
                  icon: const Icon(Icons.location_on, size: 18),
                  label: const Text('📍 Ver Seguimiento en Vivo'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primary,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(30)),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    elevation: 0,
                  ),
                ),
              ),
            ],
            if (isUpcoming &&
                (status.toLowerCase() == 'pending' ||
                    status.toLowerCase() == 'pendiente_pago' ||
                    status.toLowerCase() == 'confirmed' ||
                    status.toLowerCase() == 'confirmada')) ...[
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () =>
                          _confirmCancelBooking(booking['id'], providerName),
                      icon: const Icon(Icons.cancel_outlined, size: 16),
                      label: const Text('Cancelar', style: TextStyle(fontSize: 12)),
                      style: OutlinedButton.styleFrom(
                                              foregroundColor: AppTheme.error,
                                              side: BorderSide(color: AppTheme.errorBg),
                                              shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(20)),
                        padding: const EdgeInsets.symmetric(vertical: 10),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: () {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Selecciona nueva fecha en el perfil de la proveedora')),
                        );
                        Navigator.pushNamed(
                          context,
                          '/provider-detail',
                          arguments: booking['provider_id'],
                        );
                      },
                      icon: const Icon(Icons.calendar_month_outlined, size: 16),
                      label: const Text('Reprogramar', style: TextStyle(fontSize: 12)),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFC5A052),
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(20)),
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        elevation: 0,
                      ),
                    ),
                  ),
                ],
              ),
            ],
            if (!isUpcoming && status == 'completed' && !isReviewed) ...[
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: () => _showRatingSheet(booking),
                  icon: const Icon(Icons.star_outline_rounded, size: 18),
                  label: const Text('Calificar Servicio'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primary,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(30)),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    elevation: 0,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading && _bookings.isEmpty) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('Mis Citas',
              style:
                  TextStyle(fontWeight: FontWeight.bold, letterSpacing: -0.5)),
          backgroundColor: Colors.white,
          foregroundColor: Colors.black,
                    elevation: 0,
                  ),
                  body: Center(
                      child: CircularProgressIndicator(color: AppTheme.primary)),
                );
              }

    if (_error != null && _bookings.isEmpty) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('Mis Citas',
              style:
                  TextStyle(fontWeight: FontWeight.bold, letterSpacing: -0.5)),
          backgroundColor: Colors.white,
          foregroundColor: Colors.black,
          elevation: 0,
        ),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.wifi_off_rounded,
                  color: AppTheme.error, size: 48),
              const SizedBox(height: 16),
              Text('Error de conexión:\n$_error',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.grey)),
              const SizedBox(height: 16),
              ElevatedButton.icon(
                onPressed: _loadBookings,
                icon: const Icon(Icons.refresh),
                label: const Text('Reintentar'),
                style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primary,
                    foregroundColor: Colors.white),
              ),
            ],
          ),
        ),
      );
    }

    final upcoming = _bookings.where((b) {
      final status = (b['status']?.toString() ?? 'pending').toUpperCase();
      return status == 'PENDING' ||
          status == 'PENDIENTE_PAGO' ||
          status == 'CONFIRMED' ||
          status == 'CONFIRMADA' ||
          status == 'EN_PROGRESO' ||
          status == 'FINALIZADA_PRESTADOR';
    }).toList();

    final history = _bookings.where((b) {
      final status = (b['status']?.toString() ?? 'pending').toUpperCase();
      return status == 'COMPLETED' ||
          status == 'COMPLETADA' ||
          status == 'CANCELLED' ||
          status == 'CANCELADA';
    }).toList();

    return ValueListenableBuilder<AudienceMode>(
      valueListenable: AudienceService.currentAudience,
      builder: (context, audienceMode, child) {
        final isMen = audienceMode == AudienceMode.men;
        final bgColor = isMen ? MensTheme.obsidianBg : const Color(0xFFFAF8F5);
        final surfaceColor = isMen ? MensTheme.obsidianCard : Colors.white;
        final textColor = isMen ? MensTheme.textPrimary : const Color(0xFF1F1A15);
        final primaryColor = isMen ? MensTheme.champagneGold : const Color(0xFFC5A052);

        return Scaffold(
          backgroundColor: bgColor,
          appBar: AppBar(
            title: Text('Mis Rituales y Citas',
                style: TextStyle(
                    fontFamily: 'CormorantGaramond',
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 0.5,
                    color: textColor)),
            backgroundColor: surfaceColor,
            foregroundColor: textColor,
            elevation: 0,
            actions: [
              IconButton(
                icon: Icon(Icons.refresh, color: textColor),
                tooltip: 'Actualizar',
                onPressed: _loadBookings,
              ),
            ],
            bottom: TabBar(
              controller: _tabController,
              labelColor: primaryColor,
              unselectedLabelColor: isMen ? MensTheme.textMuted : const Color(0xFF8C7E74),
              indicatorColor: primaryColor,
              indicatorSize: TabBarIndicatorSize.tab,
              tabs: const [
                Tab(text: 'Próximas'),
                Tab(text: 'Historial'),
              ],
            ),
          ),
      body: Stack(
        children: [
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 680),
              child: TabBarView(
                controller: _tabController,
                children: [
                  // Pestaña: Próximas
                  RefreshIndicator(
                    color: const Color(0xFFC5A052),
                    onRefresh: _loadBookings,
                    child: upcoming.isEmpty
                        ? _buildEmptyState(
                            'No tienes citas programadas próximamente.')
                        : ListView.builder(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 16, vertical: 12),
                            itemCount: upcoming.length,
                            itemBuilder: (context, index) =>
                                _buildBookingCard(upcoming[index], true),
                          ),
                  ),
                  // Pestaña: Historial
                  RefreshIndicator(
                    color: const Color(0xFFC5A052),
                    onRefresh: _loadBookings,
                    child: history.isEmpty
                        ? _buildEmptyState('Tu historial de citas está vacío.')
                        : ListView.builder(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 16, vertical: 12),
                            itemCount: history.length,
                            itemBuilder: (context, index) =>
                                _buildBookingCard(history[index], false),
                          ),
                  ),
                ],
              ),
            ),
          ),
          if (_isLoading)
                      Container(
                        color: const Color(0x1E000000),
                        child: Center(
                          child: CircularProgressIndicator(color: AppTheme.primary),
                        ),
            ),
          // Pantalla de Éxito Overlay interactiva con colores de AppTheme
          if (_showSuccessOverlay)
            Positioned.fill(
              child: Container(
                color: Colors.white,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    TweenAnimationBuilder<double>(
                      duration: const Duration(milliseconds: 800),
                      tween: Tween(begin: 0.0, end: 1.0),
                      curve: Curves.elasticOut,
                      builder: (context, val, child) {
                        return Transform.scale(
                          scale: val,
                          child: child,
                        );
                                              },
                                              child: CircleAvatar(
                                                radius: 54,
                                                backgroundColor: AppTheme.successBg,
                                                child: Icon(Icons.check_circle,
                                                    size: 84, color: AppTheme.success),
                                              ),
                    ),
                    const SizedBox(height: 24),
                    const Text(
                      '¡Calificación Exitosa!',
                      style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.bold,
                          color: Colors.black87),
                    ),
                    const SizedBox(height: 12),
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 40),
                      child: Text(
                        'Tu reseña ha sido registrada correctamente. ¡Muchas gracias por tu opinión!',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                            fontSize: 14, color: Colors.black54, height: 1.4),
                      ),
                    ),
                    const SizedBox(height: 32),
                    ElevatedButton(
                      onPressed: () {
                        setState(() {
                          _showSuccessOverlay = false;
                        });
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppTheme.primary,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(30)),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 44, vertical: 16),
                        elevation: 0,
                      ),
                      child: const Text('Entendido',
                          style: TextStyle(
                              fontWeight: FontWeight.bold, fontSize: 16)),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
      },
    );
  }
}

// Botón de Estrella interactivo y animado con rebote utilizando colores de AppTheme
class AnimatedStarButton extends StatefulWidget {
  final bool isSelected;
  final VoidCallback onPressed;
  final double iconSize;

  const AnimatedStarButton({
    key,
    required this.isSelected,
    required this.onPressed,
    required this.iconSize,
  }) : super(key: key);

  @override
  State<AnimatedStarButton> createState() => _AnimatedStarButtonState();
}

class _AnimatedStarButtonState extends State<AnimatedStarButton>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 150),
    );
    _scaleAnimation = TweenSequence<double>([
      TweenSequenceItem(tween: Tween<double>(begin: 1.0, end: 1.3), weight: 50),
      TweenSequenceItem(tween: Tween<double>(begin: 1.3, end: 1.0), weight: 50),
    ]).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));
  }

  @override
  void didUpdateWidget(covariant AnimatedStarButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isSelected && !oldWidget.isSelected) {
      _controller.forward(from: 0.0);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ScaleTransition(
      scale: _scaleAnimation,
      child: IconButton(
        iconSize: widget.iconSize,
        icon: Icon(
          widget.isSelected ? Icons.star_rounded : Icons.star_border_rounded,
          color: AppTheme.warning,
        ),
        onPressed: () {
          _controller.forward(from: 0.0);
          widget.onPressed();
        },
      ),
    );
  }
}
