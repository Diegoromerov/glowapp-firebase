// frontend/lib/screens/disputes/disputes_list_screen.dart
import 'package:glow_core/glow_core.dart';
import 'package:flutter/material.dart';
import 'open_dispute_screen.dart';
import 'client_dispute_detail_screen.dart';

class DisputesListScreen extends StatefulWidget {
  const DisputesListScreen({super.key});

  @override
  State<DisputesListScreen> createState() => _DisputesListScreenState();
}

class _DisputesListScreenState extends State<DisputesListScreen> {
  static const _plum = Color(0xFF54264F);
  static const _plumSoft = Color(0xFFF2E8F1);
  bool _isLoading = true;
  List<Map<String, dynamic>> _disputes = [];
  String? _error;
  String _disputeFilter = 'Todas';

  List<Map<String, dynamic>> get _visibleDisputes {
    if (_disputeFilter == 'Todas') return _disputes;
    return _disputes.where((dispute) {
      final state = (dispute['estado']?.toString() ?? '').toUpperCase();
      final resolved = state == 'RESUELTA' || state == 'CERRADA';
      return _disputeFilter == 'Resueltas' ? resolved : !resolved;
    }).toList();
  }

  @override
  void initState() {
    super.initState();
    _loadDisputes();
  }

  Future<void> _loadDisputes() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final res = await DisputeService.getMyDisputes();
      if (res != null) {
        setState(() {
          _disputes = res;
        });
      } else {
        setState(() {
          _error = 'No se pudieron cargar las disputas.';
        });
      }
    } catch (e) {
      setState(() {
        _error = mensajeHumano(e);
      });
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  Color _getStatusColor(String status) {
    switch (status.toUpperCase()) {
      case 'ABIERTA':
        return _plum;
      case 'EN_REVISION':
        return _plum;
      case 'RESUELTA':
        return AppTheme.success;
      default:
        return Colors.black87;
    }
  }

  Color _getStatusBgColor(String status) {
    switch (status.toUpperCase()) {
      case 'ABIERTA':
        return _plumSoft;
      case 'EN_REVISION':
        return _plumSoft;
      case 'RESUELTA':
        return AppTheme.successBg;
      default:
        return Colors.grey.shade50;
    }
  }

  String _formatResolucionText(String? res) {
    if (res == null) return 'Pendiente de revisión administrativa';
    switch (res.toUpperCase()) {
      case 'REEMBOLSO_CLIENTE':
        return 'Reembolso total al cliente';
      case 'LIBERAR_PRESTADOR':
        return 'Fondos liberados al prestador';
      case 'PARCIAL':
        return 'Resolución parcial / división de fondos';
      default:
        return res;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
        title: const Text(
          'Disputas de citas',
          style: TextStyle(
            fontFamily: 'CormorantGaramond',
            fontWeight: FontWeight.bold,
            fontSize: 22,
            color: Colors.white,
          ),
        ),
        backgroundColor: _plum,
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 680),
          child: RefreshIndicator(
            onRefresh: _loadDisputes,
            color: const Color(0xFFC5A052),
            child: _isLoading
                ? Center(
                    child: CircularProgressIndicator(color: AppTheme.primary))
                : _error != null
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(24.0),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text(_error!,
                                  style: const TextStyle(
                                      color: Colors.redAccent, fontSize: 14)),
                              const SizedBox(height: 16),
                              ElevatedButton(
                                onPressed: _loadDisputes,
                                style: ElevatedButton.styleFrom(
                                    backgroundColor: AppTheme.primary),
                                child: const Text('Reintentar',
                                    style: TextStyle(color: Colors.white)),
                              )
                            ],
                          ),
                        ),
                      )
                    : _disputes.isEmpty
                        ? _buildEmptyState()
                        : ListView.builder(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 20.0, vertical: 16.0),
                            itemCount: _visibleDisputes.isEmpty ? 3 : _visibleDisputes.length + 2,
                            itemBuilder: (context, index) {
                              if (index == 0) {
                                return Container(
                                  padding: const EdgeInsets.all(16),
                                  margin: const EdgeInsets.only(bottom: 16),
                                  decoration: BoxDecoration(
                                    color: _plumSoft,
                                    borderRadius: BorderRadius.circular(18),
                                    border: Border.all(color: const Color(0xFFDCC8D9)),
                                  ),
                                  child: const Row(
                                    children: [
                                      Icon(Icons.gavel_outlined, color: _plum),
                                      SizedBox(width: 12),
                                      Expanded(child: Text('Expedientes asociados a tus citas. Revisa el caso, su estado y responde desde el expediente.')),
                                    ],
                                  ),
                                );
                              }
                              if (index == 1) {
                                return Padding(
                                  padding: const EdgeInsets.only(bottom: 16),
                                  child: Wrap(
                                    spacing: 8,
                                    children: [
                                      for (final filter in ['Todas', 'En revisión', 'Resueltas'])
                                        ChoiceChip(
                                          label: Text(filter),
                                          selected: _disputeFilter == filter,
                                          selectedColor: _plum,
                                          labelStyle: TextStyle(color: _disputeFilter == filter ? Colors.white : _plum),
                                          onSelected: (_) => setState(() => _disputeFilter = filter),
                                        ),
                                    ],
                                  ),
                                );
                              }
                              if (_visibleDisputes.isEmpty) {
                                return const Padding(
                                  padding: EdgeInsets.symmetric(vertical: 36),
                                  child: Center(child: Text('No hay disputas en este filtro.')),
                                );
                              }
                              final dispute = _visibleDisputes[index - 2];
                              final id = dispute['id'].toString();
                              final tipo = dispute['tipo']?.toString() ??
                                  'Falla de Servicio';
                              final estado =
                                  dispute['estado']?.toString() ?? 'ABIERTA';
                              final desc =
                                  dispute['descripcion']?.toString() ?? '';
                              final monto =
                                  toDoubleOr(dispute['monto_disputado'], 0.0);
                              final resolucion =
                                  dispute['resolucion']?.toString();
                              final notaRes =
                                  dispute['nota_resolucion']?.toString() ?? '';
                              final servicio =
                                  dispute['servicio_nombre']?.toString() ??
                                      'Servicio';
                              final fechaStr =
                                  dispute['creado_at']?.toString() ?? '';
                              final fecha =
                                  DateTime.tryParse(fechaStr)?.toLocal();
                              final formattedDate = fecha != null
                                  ? '${fecha.day}/${fecha.month}/${fecha.year} ${fecha.hour.toString().padLeft(2, '0')}:${fecha.minute.toString().padLeft(2, '0')}'
                                  : '';
                              final bookingNumber = dispute['booking_number']?.toString();
                              final bookingDate = DateTime.tryParse(dispute['booking_fecha']?.toString() ?? '')?.toLocal();
                              final bookingDateLabel = bookingDate == null
                                  ? 'Fecha de cita pendiente'
                                  : '${bookingDate.day}/${bookingDate.month}/${bookingDate.year}';

                              return Container(
                                margin: const EdgeInsets.only(bottom: 16),
                                padding: const EdgeInsets.all(16),
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  borderRadius: BorderRadius.circular(20),
                                  border: Border.all(color: const Color(0xFFE9DDE8)),
                                  boxShadow: AppTheme.softShadow,
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      mainAxisAlignment:
                                          MainAxisAlignment.spaceBetween,
                                      children: [
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                          decoration: BoxDecoration(color: _getStatusBgColor(estado), borderRadius: BorderRadius.circular(20)),
                                          child: Text(
                                            estado.replaceAll('_', ' ').toLowerCase(),
                                            style: TextStyle(color: _getStatusColor(estado), fontSize: 11, fontWeight: FontWeight.bold),
                                          ),
                                        ),
                                        Text(
                                          formattedDate,
                                          style: const TextStyle(
                                              color: Color(0xFF6F5F4E),
                                              fontSize: 11),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 12),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                                      decoration: BoxDecoration(color: _plumSoft, borderRadius: BorderRadius.circular(12)),
                                      child: Row(
                                        children: [
                                          const Icon(Icons.calendar_month_outlined, size: 18, color: _plum),
                                          const SizedBox(width: 8),
                                          Expanded(child: Text(bookingNumber == null || bookingNumber.isEmpty ? 'Cita · $bookingDateLabel' : 'Cita #$bookingNumber · $bookingDateLabel', style: const TextStyle(color: _plum, fontWeight: FontWeight.w600))),
                                        ],
                                      ),
                                    ),
                                    const SizedBox(height: 12),
                                    Text(
                                      servicio,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.bold,
                                        fontSize: 15,
                                        color: Colors.black87,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      'Motivo: $tipo',
                                      style: const TextStyle(
                                          fontWeight: FontWeight.w600,
                                          fontSize: 12,
                                          color: Colors.black54),
                                    ),
                                    const SizedBox(height: 8),
                                    Text(
                                      desc,
                                      style: TextStyle(
                                          color: Color(0xFF6F5F4E),
                                          fontSize: 12.5),
                                    ),
                                    const SizedBox(height: 12),
                                    const Divider(
                                        height: 1, color: Color(0xFFF3EAE8)),
                                    const SizedBox(height: 10),
                                    Row(
                                      mainAxisAlignment:
                                          MainAxisAlignment.spaceBetween,
                                      children: [
                                        const Text(
                                          'Monto en Disputa:',
                                          style: TextStyle(
                                              fontSize: 12,
                                              color: Color(0xFF6F5F4E)),
                                        ),
                                        Text(
                                          '\$${monto.toStringAsFixed(0)} COP',
                                          style: TextStyle(
                                            fontSize: 13,
                                            fontWeight: FontWeight.bold,
                                          color: _plum,
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 16),
                                    _ClientDisputeProgress(state: estado),
                                    if (estado == 'RESUELTA') ...[
                                      const SizedBox(height: 10),
                                      Container(
                                        padding: const EdgeInsets.all(12),
                                        decoration: BoxDecoration(
                                          color: const Color(0xFFFDFBFB),
                                          borderRadius:
                                              BorderRadius.circular(12),
                                          border: Border.all(
                                              color: const Color(0xFFEADCD6)),
                                        ),
                                        child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.stretch,
                                          children: [
                                            const Text(
                                              'Resolución Administrativa:',
                                              style: TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  fontSize: 11,
                                                  color: Colors.black87),
                                            ),
                                            const SizedBox(height: 4),
                                            Text(
                                              _formatResolucionText(resolucion),
                                              style: TextStyle(
                                                  fontSize: 12,
                                                  color: _plum,
                                                  fontWeight: FontWeight.w600),
                                            ),
                                            if (notaRes.isNotEmpty) ...[
                                              const SizedBox(height: 6),
                                              Text(
                                                'Nota: $notaRes',
                                                style: const TextStyle(
                                                    fontSize: 11.5,
                                                    color: Colors.black54,
                                                    fontStyle:
                                                        FontStyle.italic),
                                              ),
                                            ],
                                          ],
                                        ),
                                      ),
                                    ],
                                    Align(
                                      alignment: Alignment.centerRight,
                                      child: TextButton.icon(
                                        onPressed: () => Navigator.push(
                                            context,
                                            MaterialPageRoute(
                                              builder: (_) =>
                                                  ClientDisputeDetailScreen(
                                                      disputeId: id),
                                            )).then((_) => _loadDisputes()),
                                        icon: const Icon(Icons.forum_outlined,
                                            size: 18),
                                        label: const Text(
                                            'Ver expediente y responder'),
                                        style: TextButton.styleFrom(foregroundColor: _plum),
                                      ),
                                    ),
                                  ],
                                ),
                              );
                            },
                          ),
          ),
        ),
      ),
      floatingActionButton: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(30),
          gradient: const LinearGradient(
            colors: [Color(0xFF74436F), Color(0xFF54264F)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          boxShadow: [
            BoxShadow(
              color: _plum.withValues(alpha: 0.25),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: FloatingActionButton.extended(
          backgroundColor: Colors.transparent,
          elevation: 0,
          onPressed: () {
            Navigator.push(
              context,
              MaterialPageRoute(
                  builder: (context) => const OpenDisputeScreen()),
            ).then((_) => _loadDisputes());
          },
          icon: const Icon(Icons.add, color: Colors.white),
          label: const Text(
            'Iniciar Disputa',
            style: TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.bold,
              fontFamily: 'Inter',
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.gavel_outlined, size: 64, color: _plum.withValues(alpha: 0.5)),
            const SizedBox(height: 16),
            const Text(
              'Sin disputas de servicio activas',
              style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: Colors.black87),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            const Text(
              'Si tuviste un problema grave con una cita (inasistencia, cobro incorrecto, mala calidad), puedes disputarla aquí para retener los fondos.',
              style: TextStyle(fontSize: 12, color: Color(0xFF6F5F4E)),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                      builder: (context) => const OpenDisputeScreen()),
                ).then((_) => _loadDisputes());
              },
              icon: const Icon(Icons.add, color: Colors.white),
              label: const Text('Iniciar Disputa',
                  style: TextStyle(color: Colors.white)),
              style: ElevatedButton.styleFrom(
                backgroundColor: _plum,
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
}

class _ClientDisputeProgress extends StatelessWidget {
  final String state;
  const _ClientDisputeProgress({required this.state});

  @override
  Widget build(BuildContext context) {
    final normalized = state.toUpperCase();
    final activeStep = normalized.contains('RESUEL') || normalized.contains('CERR')
        ? 2
        : normalized.contains('REVISION') || normalized.contains('PROCESO')
        ? 1
        : 0;
    const labels = ['Recibida', 'En revisión', 'Decisión'];
    return Row(
      children: [
        for (var step = 0; step < labels.length; step++) ...[
          if (step > 0)
            Expanded(child: Container(height: 2, color: step <= activeStep ? const Color(0xFF9A6A1E) : const Color(0xFFE5DDE5))),
          Column(
            children: [
              Icon(step < activeStep ? Icons.check_circle : step == activeStep ? Icons.radio_button_checked : Icons.circle_outlined, size: 20, color: step <= activeStep ? const Color(0xFF54264F) : Colors.black38),
              const SizedBox(height: 4),
              Text(labels[step], style: const TextStyle(fontSize: 10)),
            ],
          ),
        ],
      ],
    );
  }
}
