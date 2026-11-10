// frontend/lib/screens/client_bookings_screen.dart
import 'package:glow_core/glow_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:url_launcher/url_launcher.dart';
import '../widgets/reschedule_sheet.dart';
import '../widgets/service_review_sheet.dart';
import '../widgets/auth_gate.dart';
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
  bool _sinSesion = false;
  bool _showSuccessOverlay = false;
  // Citas cuyo enlace de pago se está pidiendo: evita dobles envíos.
  final Set<String> _pagando = <String>{};

  /// Abre el Web Checkout de Wompi con el valor de la cita. El backend firma
  /// la URL: la firma de integridad no se puede calcular en el cliente porque
  /// necesita WOMPI_INTEGRITY_SECRET.
  Future<void> _irAPagar(Map<String, dynamic> booking) async {
    // Regla: toda interaccion que modifica datos en la base exige cuenta.
    if (!await AuthGate.requerir(context, accion: 'pagar una cita')) return;
    if (!mounted) return;
    final id = booking['id'].toString();
    if (_pagando.contains(id)) return;

    final messenger = ScaffoldMessenger.of(context);
    setState(() => _pagando.add(id));
    try {
      // En web, Wompi devuelve al usuario a la propia app con `?id=<transacción>`;
      // la pantalla de citas recarga al abrir y tiene pull-to-refresh. En móvil no
      // hay enlace profundo configurado, así que se queda en la página de Wompi.
      AnalyticsService().logEvent(
        eventType: 'PAYMENT_OPENED',
        screenName: '/my-bookings',
        elementId: 'ir_a_pagar',
        metadata: {'booking_id': id},
      );
      final link = await ApiService.createBookingPaymentLink(
        id,
        redirectUrl: kIsWeb ? '${Uri.base.origin}/#/my-bookings' : null,
      );
      final url = link['url']?.toString();
      if (url == null || url.isEmpty) {
        throw Exception('La pasarela no devolvió un enlace de pago');
      }
      final abierto = await launchUrl(
        Uri.parse(url),
        mode: LaunchMode.externalApplication,
      );
      if (!abierto) {
        throw Exception('No se pudo abrir la pasarela de pagos');
      }
      if (!mounted) return;
      messenger.showSnackBar(const SnackBar(
        content: Text('Completa el pago en Wompi. La cita se confirma sola '
            'cuando el banco aprueba.'),
      ));
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')),
        backgroundColor: AppTheme.error,
      ));
    } finally {
      if (mounted) setState(() => _pagando.remove(id));
    }
  }

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
    // `#/my-bookings` es alcanzable sin sesión (deep link, guía, URL directa).
    // Sin token no se pide la lista: antes la pantalla mostraba
    // «Exception: UNAUTHORIZED» a un visitante que solo estaba mirando.
    if (!AuthService.sesionActivaEnMemoria) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _error = null;
          _sinSesion = true;
        });
      }
      return;
    }
    setState(() {
      _isLoading = true;
      _error = null;
      _sinSesion = false;
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
          _error = mensajeHumano(e);
          _isLoading = false;
        });
      }
    }
  }

  /// Ítem 31 — recibo descargable. El backend firma un enlace de 10 minutos
  /// para esta cita: el token de sesión no viaja en la URL.
  Future<void> _abrirRecibo(Map<String, dynamic> booking) async {
    final id = booking['id']?.toString() ?? '';
    if (id.isEmpty) return;
    try {
      final res = await ApiService.post('/api/bookings/$id/receipt/link', const {});
      final url = (res['url'] ?? '').toString();
      if (url.isEmpty) throw Exception('No se pudo preparar el recibo');
      final abierto =
          await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      if (!abierto && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No pudimos abrir el recibo')),
        );
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(mensajeHumano(e)), backgroundColor: AppTheme.error),
      );
    }
  }

  Future<void> _confirmCancelBooking(
      String bookingId, String providerName) async {
    // Regla: toda interaccion que modifica datos en la base exige cuenta.
    if (!await AuthGate.requerir(context, accion: 'cancelar una cita')) return;
    if (!mounted) return;
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
                    TextStyle(color: Color(0xFF6F5F4E), fontWeight: FontWeight.bold)),
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
              content: Text('No se pudo cancelar. ${mensajeHumano(e)}'),
              backgroundColor: AppTheme.error,
            ),
          );
        }
      }
    }
  }

  /// Muestra el código de confirmación del servicio. Lo ve solo el cliente y
  /// solo él puede usarlo: es el PIN que libera el pago.
  Future<void> _verCodigo(Map<String, dynamic> booking) async {
    final messenger = ScaffoldMessenger.of(context);
    final nombre = (booking['provider_business_name'] != null &&
            booking['provider_business_name'].toString().isNotEmpty)
        ? booking['provider_business_name'].toString()
        : (booking['provider_name']?.toString() ?? 'tu prestador');

    try {
      AnalyticsService().logEvent(
        eventType: 'OTP_OPENED',
        screenName: '/my-bookings',
        elementId: 'ver_mi_codigo',
        metadata: {'booking_id': booking['id'].toString()},
      );
      final datos = await ApiService.fetchBookingOtp(booking['id'].toString());
      final codigo = datos['codigo']?.toString() ?? '';
      if (!mounted) return;

      final confirmar = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          title: const Text('Tu código de confirmación'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Úsalo cuando el servicio haya terminado. El prestador no lo conoce.',
                style: TextStyle(fontSize: 12, color: Color(0xFF8A7F72)),
              ),
              const SizedBox(height: 18),
              Text(
                codigo,
                style: const TextStyle(
                    fontSize: 32,
                    letterSpacing: 8,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF8A6A2F)),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cerrar'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(context, true),
              style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFC5A052),
                  foregroundColor: Colors.white),
              child: const Text('Confirmar ahora'),
            ),
          ],
        ),
      );

      if (confirmar != true || !mounted) return;

      final hecho = await Navigator.push<bool>(
        context,
        MaterialPageRoute(
          builder: (_) => OtpConfirmScreen(
            bookingId: booking['id'],
            prestadorNombre: nombre,
            servicioNombre: booking['service_name']?.toString() ?? 'Servicio',
            valorBruto: toDoubleOr(booking['total_amount'], 0.0),
            codigoInicial: codigo,
          ),
        ),
      );
      if (hecho == true && mounted) _loadBookings();
    } catch (e) {
      messenger.showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')),
        backgroundColor: AppTheme.error,
      ));
    }
  }

  /// Abre la hoja de resena (estrellas + aspectos + comentario). Si se publica,
  /// la lista se recarga para que la tarjeta deje de ofrecer calificar.
  Future<void> _abrirResena(Map<String, dynamic> booking, {int nota = 0}) async {
    // Regla: toda interaccion que modifica datos en la base exige cuenta.
    if (!await AuthGate.requerir(context, accion: 'dejar una resena')) return;
    if (!mounted) return;
    final nombre = (booking['provider_business_name'] != null &&
            booking['provider_business_name'].toString().isNotEmpty)
        ? booking['provider_business_name'].toString()
        : (booking['provider_name']?.toString() ?? 'tu prestador');

    final publicada = await showServiceReviewSheet(
      context,
      bookingId: booking['id'].toString(),
      providerName: nombre,
      initialRating: nota,
    );
    if (publicada == true && mounted) {
      AnalyticsService().logEvent(
        eventType: 'REVIEW_PUBLISHED',
        screenName: '/my-bookings',
        elementId: 'resena',
        metadata: {'booking_id': booking['id'].toString(), 'nota': nota},
      );
      _loadBookings();
    }
  }

  /// La propina vive fuera de la resena a proposito: pedir dinero en la misma
  /// pantalla que pide una opinion sesga la nota (D-GL-023: es 100% del prestador).
  /// Ítem 31 — recibo: el comprobante lo genera el servidor (con el IVA y la
  /// propina congelados en la reserva) y lo manda al correo de la cuenta. Se
  /// pide por correo y no se abre una URL con el token: un enlace con la sesión
  /// dentro acaba en el historial del navegador y en los logs.
  Future<void> _enviarRecibo(Map<String, dynamic> booking) async {
    // Regla: toda interaccion que modifica datos en la base exige cuenta.
    if (!await AuthGate.requerir(context, accion: 'enviar el recibo a tu correo')) return;
    if (!mounted) return;
    final id = booking['id']?.toString() ?? '';
    if (id.isEmpty) return;
    try {
      await ApiService.post('/api/bookings/$id/receipt/email', const {});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Te enviamos el recibo al correo de tu cuenta.'),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('No pudimos enviar el recibo. ${mensajeHumano(e)}')),
      );
    }
  }

  Future<void> _showTipSheet(Map<String, dynamic> booking) async {
    // Regla: toda interaccion que modifica datos en la base exige cuenta.
    if (!await AuthGate.requerir(context, accion: 'dar propina')) return;
    if (!mounted) return;
    final total = toDoubleOr(booking['total_amount'], 0.0);
    double monto = 0.0;
    final customCtrl = TextEditingController();

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => StatefulBuilder(
        builder: (context, setModalState) {
          return Padding(
            padding: EdgeInsets.only(
                bottom: MediaQuery.of(context).viewInsets.bottom + 24,
                left: 24,
                right: 24,
                top: 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('Dar propina',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                const Text('La propina va integra al prestador.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 12, color: Color(0xFF8A7F72))),
                const SizedBox(height: 18),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [0.05, 0.10, 0.15].map((pct) {
                    final valor = total * pct;
                    final activo = (monto - valor).abs() < 1;
                    return ChoiceChip(
                      label: Text('${(pct * 100).round()}%'),
                      selected: activo,
                      onSelected: (_) => setModalState(() {
                        monto = valor;
                        customCtrl.clear();
                      }),
                      selectedColor: const Color(0xFFC5A052),
                      labelStyle: TextStyle(
                          color: activo ? Colors.white : const Color(0xFF1F1A15)),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: customCtrl,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                      labelText: 'Otro monto', prefixText: r'$ '),
                  onChanged: (v) => setModalState(
                      () => monto = double.tryParse(v) ?? 0.0),
                ),
                const SizedBox(height: 18),
                ElevatedButton(
                  onPressed: () async {
                    if (monto <= 0) return;
                    final id = booking['id'].toString();
                    Navigator.pop(context);
                    await _submitTip(id, monto);
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFC5A052),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(30)),
                    elevation: 0,
                  ),
                  child: Text(
                      monto > 0
                          ? 'Enviar ${monto.toStringAsFixed(0)}'
                          : 'Elige un monto',
                      style: const TextStyle(fontWeight: FontWeight.bold)),
                ),
              ],
            ),
          );
        },
      ),
    );
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
          content: Text('No se pudo registrar la propina. ${mensajeHumano(e)}'),
          backgroundColor: AppTheme.error,
        ),
      );
    }
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
    // Elegibilidad: el servicio tiene que haber ocurrido. Antes solo se podia
    // calificar en COMPLETADA, asi que una cita que nadie cerro dejaba al cliente
    // sin voz y al catalogo sin prueba social.
    final estadoMin = status.toUpperCase();
    // Ítem 30: sin esto, una cita cancelada con reembolso se veía igual que una
    // cancelada sin devolución.
    final refundEstado = booking['refund_status']?.toString().toUpperCase() ?? '';
    final refundMonto = booking['refund_monto'];
    final refundTexto = switch (refundEstado) {
      'PROCESADO' => 'Reembolsado',
      'FALLIDO' => 'Reembolso fallido',
      'PENDIENTE' => 'Reembolso en proceso',
      _ => '',
    };
    final refundDetalle = refundTexto.isEmpty
        ? ''
        : (refundMonto != null
            ? '$refundTexto · \$${(refundMonto as num).toStringAsFixed(0)}'
            : refundTexto);
    // Ítem 31: el recibo solo existe para lo que se pagó.
    final pagado =
        booking['payment_status']?.toString().toLowerCase() == 'paid';
    final refundColor = refundEstado == 'PROCESADO'
        ? const Color(0xFF1E7B4F)
        : refundEstado == 'FALLIDO'
            ? const Color(0xFFB3261E)
            : const Color(0xFF8A5B00);
    final fechaCita = DateTime.tryParse(scheduledAt);
    final yaOcurrio = estadoMin == 'COMPLETADA' ||
        estadoMin == 'COMPLETED' ||
        (fechaCita != null && fechaCita.isBefore(DateTime.now()));
    final esCancelada = estadoMin == 'CANCELADA' || estadoMin == 'CANCELLED';
    final canReview = !isReviewed && yaOcurrio && !esCancelada;
    final miNota = int.tryParse(
            (booking['review_rating'] ?? reviewData?['rating'] ?? '').toString()) ??
        0;

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
                                color: Color(0xFF6F5F4E), fontSize: 13),
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
                if (refundDetalle.isNotEmpty)
                  Container(
                    margin: const EdgeInsets.only(left: 8),
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: refundColor.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      refundDetalle,
                      style: TextStyle(
                        color: refundColor,
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
                        style: TextStyle(color: Color(0xFF6F5F4E), fontSize: 13),
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
                  style: TextStyle(fontSize: 13, color: Color(0xFF6F5F4E)),
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
                    const SizedBox(height: 10),
                    OutlinedButton.icon(
                      onPressed: () => _verCodigo(booking),
                      icon: const Icon(Icons.visibility_outlined,
                          size: 16, color: Colors.white),
                      label: const Text('Ver mi código',
                          style: TextStyle(color: Colors.white, fontSize: 12)),
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: Colors.white54),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(20)),
                      ),
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
                            fontSize: 13, color: Color(0xFF6F5F4E), height: 1.3),
                      ),
                    ],
                  ],
                ),
              ),
            ],
            // Pendiente de pago: sin este botón la cita quedaba sin salida y la
            // única forma de pagarla era volver a reservar.
            if ((status.toUpperCase() == 'PENDIENTE_PAGO' ||
                    status.toUpperCase() == 'PENDING') &&
                toDoubleOr(booking['total_amount'], 0.0) > 0) ...[
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: _pagando.contains(booking['id'].toString())
                      ? null
                      : () => _irAPagar(booking),
                  icon: _pagando.contains(booking['id'].toString())
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.credit_card, size: 18),
                  label: const Text('Ir a pagar'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFC5A052),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(30)),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    elevation: 0,
                  ),
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
                      // Antes solo mostraba un aviso y abría el perfil: no
                      // reprogramaba nada. Ahora pide los huecos reales del
                      // prestador y aplica el cambio.
                      onPressed: () async {
                        // Regla: reprogramar cambia la reserva en la base.
                        if (!await AuthGate.requerir(context,
                            accion: 'reprogramar una cita')) {
                          return;
                        }
                        if (!mounted) return;
                        final cambiada = await showRescheduleSheet(
                          context,
                          bookingId: booking['id'].toString(),
                          providerId: booking['provider_id'].toString(),
                          serviceId: (booking['service_id'] ?? '').toString(),
                        );
                        if (cambiada == true && mounted) _loadBookings();
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
            // Calificacion en un toque: la estrella pulsada abre la hoja con esa
            // nota ya puesta. Sin boton intermedio ni formulario previo.
            if (canReview) ...[
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: const Color(0xFFFAF8F5),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Row(
                  children: [
                    const Expanded(
                      child: Text('Califica tu cita',
                          style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: Color(0xFF1F1A15))),
                    ),
                    ...List.generate(
                      5,
                      (i) => Semantics(
                        button: true,
                        label: 'Calificar con ${i + 1} de 5 estrellas',
                        child: InkWell(
                          onTap: () => _abrirResena(booking, nota: i + 1),
                          customBorder: const CircleBorder(),
                          child: const SizedBox(
                            // 48 px: el minimo recomendado para un dedo. Con 26
                            // se fallaba el toque y parecía que no respondía.
                            width: 40,
                            height: 44,
                            child: Icon(Icons.star_outline_rounded,
                                size: 26, color: Color(0xFFC5A052)),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            if (isReviewed && miNota > 0) ...[
              const SizedBox(height: 14),
              Row(
                children: [
                  const Text('Tu calificacion',
                      style: TextStyle(fontSize: 13, color: Color(0xFF8A7F72))),
                  const Spacer(),
                  Semantics(
                    label: 'Tu calificación: $miNota de 5',
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: List.generate(
                        5,
                        (i) => Icon(
                          i < miNota
                              ? Icons.star_rounded
                              : Icons.star_outline_rounded,
                          size: 20,
                          color: const Color(0xFFC5A052),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ],
            if (pagado) ...[
              const SizedBox(height: 10),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: () => _enviarRecibo(booking),
                  icon: const Icon(Icons.receipt_long_outlined,
                      size: 16, color: Color(0xFF8A6A2F)),
                  label: const Text('Recibo por correo',
                      style: TextStyle(fontSize: 12, color: Color(0xFF8A6A2F))),
                ),
              ),
            ],
            // Ítem 31 — recibo descargable de la cita.
            if (yaOcurrio) ...[
              const SizedBox(height: 6),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: () => _abrirRecibo(booking),
                  icon: const Icon(Icons.receipt_long_outlined, size: 16),
                  label: const Text('Ver recibo'),
                ),
              ),
            ],
            // Ítem 80: si la bandera está apagada, la propina no se ofrece.
            if (yaOcurrio &&
                !esCancelada &&
                FeatureFlags.instance.activo('propinas')) ...[
              const SizedBox(height: 10),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: () => _showTipSheet(booking),
                  icon: const Icon(Icons.volunteer_activism_outlined,
                      size: 16, color: Color(0xFFC5A052)),
                  label: const Text('Dar propina',
                      style:
                          TextStyle(fontSize: 12, color: Color(0xFF8A6A2F))),
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

    if (_sinSesion && _bookings.isEmpty) {
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
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.lock_outline_rounded,
                    color: Color(0xFF8A6A2F), size: 44),
                const SizedBox(height: 16),
                const Text('Inicia sesión para ver tus citas',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                const Text(
                    'Tus reservas, su estado y el pago quedan ligados a tu cuenta.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Color(0xFF6F5F4E), fontSize: 13)),
                const SizedBox(height: 20),
                ElevatedButton(
                  onPressed: () async {
                    await Navigator.pushNamed(context, '/auth/login');
                    if (mounted) _loadBookings();
                  },
                  style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.primary,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 22, vertical: 12)),
                  child: const Text('Iniciar sesión'),
                ),
              ],
            ),
          ),
        ),
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
              Text(_error ?? 'Algo falló. Inténtalo de nuevo.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Color(0xFF6F5F4E))),
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
      // Mantener visibles los estados activos y cualquier estado nuevo del
      // backend. Solo los estados terminales pasan al historial.
      return status != 'COMPLETED' &&
          status != 'COMPLETADA' &&
          status != 'CANCELLED' &&
          status != 'CANCELADA';
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
        tooltip: 'Calificar',
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
