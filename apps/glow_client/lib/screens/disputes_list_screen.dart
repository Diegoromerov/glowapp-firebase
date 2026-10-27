// frontend/lib/screens/disputes/disputes_list_screen.dart
import 'package:flutter/material.dart';
import '../../services/dispute_service.dart';
import 'package:glow_core/shared/theme.dart';
import 'open_dispute_screen.dart';
import '../../utils/json_num.dart';

class DisputesListScreen extends StatefulWidget {
  const DisputesListScreen({super.key});

  @override
  State<DisputesListScreen> createState() => _DisputesListScreenState();
}

class _DisputesListScreenState extends State<DisputesListScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _disputes = [];
  String? _error;

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
        _error = 'Error de conexión: $e';
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
        return AppTheme.warning;
      case 'RESUELTA':
        return AppTheme.success;
      default:
        return Colors.black87;
    }
  }

  Color _getStatusBgColor(String status) {
    switch (status.toUpperCase()) {
      case 'ABIERTA':
        return AppTheme.warningBg;
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
          'Disputas & Mediación de Servicio',
          style: TextStyle(
            fontFamily: 'CormorantGaramond',
            fontWeight: FontWeight.bold,
            fontSize: 22,
            color: Color(0xFF1F1A15),
          ),
        ),
        backgroundColor: const Color(0xFFFAF8F5),
        foregroundColor: const Color(0xFF1F1A15),
        elevation: 0,
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 680),
          child: RefreshIndicator(
            onRefresh: _loadDisputes,
            color: const Color(0xFFC5A052),
            child: _isLoading
            ? const Center(child: CircularProgressIndicator(color: AppTheme.primary))
            : _error != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24.0),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(_error!, style: const TextStyle(color: Colors.redAccent, fontSize: 14)),
                          const SizedBox(height: 16),
                          ElevatedButton(
                            onPressed: _loadDisputes,
                            style: ElevatedButton.styleFrom(backgroundColor: AppTheme.primary),
                            child: const Text('Reintentar', style: TextStyle(color: Colors.white)),
                          )
                        ],
                      ),
                    ),
                  )
                : _disputes.isEmpty
                    ? _buildEmptyState()
                    : ListView.builder(
                        padding: const EdgeInsets.symmetric(horizontal: 20.0, vertical: 16.0),
                        itemCount: _disputes.length,
                        itemBuilder: (context, index) {
                          final dispute = _disputes[index];
                          final id = dispute['id'].toString();
                          final tipo = dispute['tipo']?.toString() ?? 'Falla de Servicio';
                          final estado = dispute['estado']?.toString() ?? 'ABIERTA';
                          final desc = dispute['descripcion']?.toString() ?? '';
                          final monto = toDoubleOr(dispute['monto_disputado'], 0.0);
                          final resolucion = dispute['resolucion']?.toString();
                          final notaRes = dispute['nota_resolucion']?.toString() ?? '';
                          final servicio = dispute['servicio_nombre']?.toString() ?? 'Servicio';
                          final fechaStr = dispute['creado_at']?.toString() ?? '';
                          final fecha = DateTime.tryParse(fechaStr)?.toLocal();
                          final formattedDate = fecha != null
                              ? '${fecha.day}/${fecha.month}/${fecha.year} ${fecha.hour.toString().padLeft(2, '0')}:${fecha.minute.toString().padLeft(2, '0')}'
                              : '';

                          return Container(
                            margin: const EdgeInsets.only(bottom: 16),
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(color: const Color(0xFFF3EAE8)),
                              boxShadow: AppTheme.softShadow,
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                      decoration: BoxDecoration(
                                        color: _getStatusBgColor(estado),
                                        borderRadius: BorderRadius.circular(12),
                                      ),
                                      child: Text(
                                        estado.toUpperCase(),
                                        style: TextStyle(
                                          color: _getStatusColor(estado),
                                          fontSize: 11,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                    ),
                                    Text(
                                      formattedDate,
                                      style: const TextStyle(color: Colors.grey, fontSize: 11),
                                    ),
                                  ],
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
                                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12, color: Colors.black54),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  desc,
                                  style: TextStyle(color: Colors.grey[700], fontSize: 12.5),
                                ),
                                const SizedBox(height: 12),
                                const Divider(height: 1, color: Color(0xFFF3EAE8)),
                                const SizedBox(height: 10),
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    const Text(
                                      'Monto en Disputa:',
                                      style: TextStyle(fontSize: 12, color: Colors.grey),
                                    ),
                                    Text(
                                      '\$${monto.toStringAsFixed(0)} COP',
                                      style: const TextStyle(
                                        fontSize: 13,
                                        fontWeight: FontWeight.bold,
                                        color: AppTheme.primary,
                                      ),
                                    ),
                                  ],
                                ),
                                if (estado == 'RESUELTA') ...[
                                  const SizedBox(height: 10),
                                  Container(
                                    padding: const EdgeInsets.all(12),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFFDFBFB),
                                      borderRadius: BorderRadius.circular(12),
                                      border: Border.all(color: const Color(0xFFEADCD6)),
                                    ),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.stretch,
                                      children: [
                                        const Text(
                                          'Resolución Administrativa:',
                                          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11, color: Colors.black87),
                                        ),
                                        const SizedBox(height: 4),
                                        Text(
                                          _formatResolucionText(resolucion),
                                          style: const TextStyle(fontSize: 12, color: AppTheme.success, fontWeight: FontWeight.w600),
                                        ),
                                        if (notaRes.isNotEmpty) ...[
                                          const SizedBox(height: 6),
                                          Text(
                                            'Nota: $notaRes',
                                            style: const TextStyle(fontSize: 11.5, color: Colors.black54, fontStyle: FontStyle.italic),
                                          ),
                                        ],
                                      ],
                                    ),
                                  ),
                                ],
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
            colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          boxShadow: [
            BoxShadow(
              color: const Color(0xFFC5A052).withValues(alpha: 0.35),
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
              MaterialPageRoute(builder: (context) => const OpenDisputeScreen()),
            ).then((_) => _loadDisputes());
          },
          icon: const Icon(Icons.add, color: Color(0xFF1F1A15)),
          label: const Text(
            'Iniciar Disputa',
            style: TextStyle(
              color: Color(0xFF1F1A15),
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
            Icon(Icons.gavel_outlined, size: 64, color: AppTheme.primary.withValues(alpha: 0.5)),
            const SizedBox(height: 16),
            const Text(
              'Sin disputas de servicio activas',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.black87),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            const Text(
              'Si tuviste un problema grave con una cita (inasistencia, cobro incorrecto, mala calidad), puedes disputarla aquí para retener los fondos.',
              style: TextStyle(fontSize: 12, color: Colors.grey),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (context) => const OpenDisputeScreen()),
                ).then((_) => _loadDisputes());
              },
              icon: const Icon(Icons.add, color: Colors.white),
              label: const Text('Iniciar Disputa', style: TextStyle(color: Colors.white)),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primary,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
                elevation: 0,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
