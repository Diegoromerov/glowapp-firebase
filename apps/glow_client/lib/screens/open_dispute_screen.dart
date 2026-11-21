// frontend/lib/screens/disputes/open_dispute_screen.dart
import 'package:glow_core/glow_core.dart';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

class OpenDisputeScreen extends StatefulWidget {
  final String? preselectedBookingId;
  const OpenDisputeScreen({super.key, this.preselectedBookingId});

  @override
  State<OpenDisputeScreen> createState() => _OpenDisputeScreenState();
}

class _OpenDisputeScreenState extends State<OpenDisputeScreen> {
  static const int _maxEvidenceFiles = 5;
  static const int _maxEvidenceBytes = 1500000;
  static const int _maxEvidenceTotalBytes = 7500000;
  final _formKey = GlobalKey<FormState>();
  final _descCtrl = TextEditingController();
  String? _selectedBookingId;
  List<Map<String, dynamic>> _clientBookings = [];
  bool _loadingBookings = true;
  String? _bookingError;

  String _selectedTipo = 'CALIDAD_SERVICIO';
  final List<String> _evidenciaBase64List = [];
  bool _isSaving = false;
  String? _error;

  final ImagePicker _picker = ImagePicker();

  @override
  void initState() {
    super.initState();
    _selectedBookingId = widget.preselectedBookingId;
    _loadBookings();
  }

  Future<void> _loadBookings() async {
    try {
      final rows = await ApiService.fetchClientBookings();
      if (!mounted) return;
      final unique = <String, Map<String, dynamic>>{};
      for (final row in rows) {
        // El flujo financiero actual solo puede retener fondos de citas ya
        // completadas; disputas por inasistencia requieren un flujo de cobro
        // distinto y no deben abrirse por esta pantalla todavía.
        if (row['status']?.toString().toUpperCase() != 'COMPLETADA') continue;
        final id = row['id']?.toString();
        if (id != null && id.isNotEmpty) unique.putIfAbsent(id, () => row);
      }
      setState(() {
        _clientBookings = unique.values.toList();
        _loadingBookings = false;
        if (_selectedBookingId != null &&
            !_clientBookings
                .any((item) => item['id']?.toString() == _selectedBookingId)) {
          _selectedBookingId = null;
        }
      });
    } catch (e) {
      if (mounted)
        setState(() {
          _loadingBookings = false;
          _bookingError = mensajeHumano(e);
        });
    }
  }

  String _bookingLabel(Map<String, dynamic> booking) {
    final when =
        DateTime.tryParse(booking['scheduled_at']?.toString() ?? '')?.toLocal();
    final date = when == null
        ? 'fecha no disponible'
        : '${when.day.toString().padLeft(2, '0')}/${when.month.toString().padLeft(2, '0')}/${when.year}';
    final service = booking['service_name']?.toString().trim();
    final provider =
        booking['provider_business_name']?.toString().trim().isNotEmpty == true
            ? booking['provider_business_name'].toString().trim()
            : booking['provider_name']?.toString().trim();
    return 'Cita #${booking['booking_number'] ?? '—'} · ${service ?? 'Servicio'} · ${provider ?? 'Prestador'} · $date';
  }

  @override
  void dispose() {
    _descCtrl.dispose();
    super.dispose();
  }

  Future<void> _attachImage() async {
    try {
      if (_evidenciaBase64List.length >= _maxEvidenceFiles) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Puedes adjuntar máximo 5 imágenes.')),
        );
        return;
      }
      final XFile? file = await _picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1000,
        maxHeight: 1000,
        imageQuality: 80,
      );
      if (file == null) return;

      final Uint8List bytes = await file.readAsBytes();
      if (bytes.length > _maxEvidenceBytes) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Cada imagen debe pesar máximo 1,5 MB.')),
        );
        return;
      }
      final totalAdjunto = _evidenciaBase64List.fold<int>(
        0,
        (total, dataUri) =>
            total + base64Decode(dataUri.split(',').last).length,
      );
      if (totalAdjunto + bytes.length > _maxEvidenceTotalBytes) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('El tamaño total no puede superar 7,5 MB.')),
        );
        return;
      }
      final ext = file.name.toLowerCase().split('.').last;
      final mimeTypes = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'webp': 'image/webp',
      };
      final mimeType = mimeTypes[ext];
      if (mimeType == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Formato no admitido. Usa JPG, PNG o WebP.')),
        );
        return;
      }
      final base64String = base64Encode(bytes);
      final dataUri = 'data:$mimeType;base64,$base64String';

      setState(() {
        _evidenciaBase64List.add(dataUri);
      });
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text('No se pudo adjuntar la imagen. ${mensajeHumano(e)}'),
            backgroundColor: Colors.redAccent),
      );
    }
  }

  Future<void> _submitDispute() async {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedBookingId == null) {
      setState(() => _error = _bookingError ??
          'Selecciona una cita disponible para abrir la disputa.');
      return;
    }

    setState(() {
      _isSaving = true;
      _error = null;
    });

    try {
      final res = await DisputeService.createDispute(
        bookingId: _selectedBookingId!,
        tipo: _selectedTipo,
        descripcion: _descCtrl.text.trim(),
        evidenciaUrls: _evidenciaBase64List,
      );

      if (res != null && res['success'] == true) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                  '✓ Disputa iniciada. El dinero ha sido temporalmente retenido para revisión.'),
              backgroundColor: AppTheme.success,
              duration: Duration(seconds: 4),
            ),
          );
          Navigator.pop(context, true);
        }
      } else {
        setState(() {
          _error =
              'Error del servidor: Ya hay una disputa activa o el ID de cita no es correcto.';
        });
      }
    } catch (e) {
      setState(() {
        _error = mensajeHumano(e);
      });
    } finally {
      if (mounted) {
        setState(() {
          _isSaving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
        title: const Text(
          'Iniciar Disputa de Servicio',
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
      body: _isSaving
          ? const Center(
              child: CircularProgressIndicator(color: Color(0xFFC5A052)))
          : Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 680),
                child: SingleChildScrollView(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text(
                          'Reportar Falla Grave de Servicio',
                          style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                              color: Colors.black87),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Al abrir una disputa, el desembolso financiero al prestador se congela temporalmente. Un administrador mediará el caso.',
                          style: TextStyle(
                              fontSize: 12,
                              color: Color(0xFF6F5F4E),
                              height: 1.3),
                        ),
                        const SizedBox(height: 24),

                        if (_loadingBookings)
                          const Padding(
                              padding: EdgeInsets.all(12),
                              child: Center(child: CircularProgressIndicator()))
                        else if (_bookingError != null)
                          Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(_bookingError!,
                                    style: const TextStyle(
                                        color: Colors.redAccent)),
                                TextButton.icon(
                                    onPressed: _loadBookings,
                                    icon: const Icon(Icons.refresh),
                                    label: const Text(
                                        'Reintentar carga de citas')),
                              ])
                        else if (_clientBookings.isEmpty)
                          const Text(
                              'No encontramos citas para asociar a la disputa.')
                        else
                          DropdownButtonFormField<String>(
                            value: _selectedBookingId,
                            isExpanded: true,
                            decoration: AppTheme.inputDecoration(
                              hintText: 'Selecciona una cita',
                              labelText: 'Cita relacionada',
                              prefixIcon: Icons.receipt_long_outlined,
                            ),
                            items: _clientBookings
                                .map((booking) => DropdownMenuItem(
                                      value: booking['id'].toString(),
                                      child: Text(_bookingLabel(booking),
                                          maxLines: 2,
                                          overflow: TextOverflow.ellipsis),
                                    ))
                                .toList(),
                            onChanged: (value) =>
                                setState(() => _selectedBookingId = value),
                            validator: (value) => value == null
                                ? 'Selecciona la cita que deseas disputar.'
                                : null,
                          ),
                        const SizedBox(height: 16),

                        // Motivo de Disputa
                        DropdownButtonFormField<String>(
                          value: _selectedTipo,
                          decoration: AppTheme.inputDecoration(
                            hintText: 'Motivo',
                            labelText: 'Motivo de la disputa',
                            prefixIcon: Icons.gavel_outlined,
                          ),
                          items: const [
                            DropdownMenuItem(
                                value: 'CALIDAD_SERVICIO',
                                child: Text('Calidad deficiente del servicio')),
                            DropdownMenuItem(
                                value: 'OTP_BLOQUEADO',
                                child: Text(
                                    'Problema con la confirmación del servicio')),
                            DropdownMenuItem(
                                value: 'CARGO_NO_RECONOCIDO',
                                child: Text('Cargo no reconocido o duplicado')),
                            DropdownMenuItem(
                                value: 'FRAUDE', child: Text('Posible fraude')),
                            DropdownMenuItem(
                                value: 'FALLA_TECNICA',
                                child: Text('Falla técnica')),
                          ],
                          onChanged: (val) {
                            if (val != null)
                              setState(() => _selectedTipo = val);
                          },
                        ),
                        const SizedBox(height: 16),

                        // Descripción de los hechos
                        TextFormField(
                          controller: _descCtrl,
                          maxLines: 5,
                          decoration: const InputDecoration(
                            hintText:
                                'Explica claramente lo sucedido (ej. hora de llegada, problemas de calidad, etc.)...',
                            labelText: 'Descripción detallada de los hechos',
                            alignLabelWithHint: true,
                            border: OutlineInputBorder(),
                          ),
                          validator: (val) {
                            if (val == null || val.trim().isEmpty) {
                              return 'Por favor ingresa los detalles del incidente.';
                            }
                            if (val.trim().length < 15) {
                              return 'Describe los hechos con más detalle (mínimo 15 caracteres).';
                            }
                            return null;
                          },
                        ),
                        const SizedBox(height: 24),

                        // Carga de evidencias
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text(
                              'Adjuntar fotos / evidencias de soporte',
                              style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 13,
                                  color: Colors.black87),
                            ),
                            TextButton.icon(
                              onPressed: _attachImage,
                              icon: const Icon(Icons.add_a_photo_outlined,
                                  size: 18),
                              label: const Text('Agregar'),
                              style: TextButton.styleFrom(
                                  foregroundColor: AppTheme.primary),
                            )
                          ],
                        ),
                        const SizedBox(height: 8),

                        // Previsualización de imágenes
                        if (_evidenciaBase64List.isNotEmpty)
                          GridView.builder(
                            shrinkWrap: true,
                            physics: const NeverScrollableScrollPhysics(),
                            gridDelegate:
                                const SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: 4,
                              crossAxisSpacing: 8,
                              mainAxisSpacing: 8,
                            ),
                            itemCount: _evidenciaBase64List.length,
                            itemBuilder: (context, index) {
                              final dataUri = _evidenciaBase64List[index];
                              final base64Data = dataUri.split(',').last;
                              final bytes = base64Decode(base64Data);

                              return Stack(
                                children: [
                                  Positioned.fill(
                                    child: ClipRRect(
                                      borderRadius: BorderRadius.circular(12),
                                      child: Image.memory(bytes,
                                          fit: BoxFit.cover),
                                    ),
                                  ),
                                  Positioned(
                                    top: 2,
                                    right: 2,
                                    child: GestureDetector(
                                      onTap: () {
                                        setState(() {
                                          _evidenciaBase64List.removeAt(index);
                                        });
                                      },
                                      child: Container(
                                        padding: const EdgeInsets.all(2),
                                        decoration: const BoxDecoration(
                                          color: Colors.black54,
                                          shape: BoxShape.circle,
                                        ),
                                        child: const Icon(Icons.close,
                                            size: 14, color: Colors.white),
                                      ),
                                    ),
                                  ),
                                ],
                              );
                            },
                          ),
                        if (_evidenciaBase64List.isEmpty)
                          Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: Colors.grey[50],
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(color: Colors.grey[200]!),
                            ),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(Icons.image_outlined,
                                    color: Colors.grey[400], size: 18),
                                const SizedBox(width: 8),
                                Text('Sin imágenes adjuntas',
                                    style: TextStyle(
                                        color: Color(0xFF6F5F4E),
                                        fontSize: 11)),
                              ],
                            ),
                          ),

                        if (_error != null) ...[
                          const SizedBox(height: 16),
                          Text(
                            _error!,
                            style: const TextStyle(
                                color: Colors.redAccent,
                                fontWeight: FontWeight.w500,
                                fontSize: 12),
                            textAlign: TextAlign.center,
                          ),
                        ],

                        const SizedBox(height: 32),
                        Container(
                          height: 52,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(16),
                            gradient: const LinearGradient(
                              colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                            ),
                            boxShadow: [
                              BoxShadow(
                                color: const Color(0xFFC5A052)
                                    .withValues(alpha: 0.35),
                                blurRadius: 12,
                                offset: const Offset(0, 4),
                              ),
                            ],
                          ),
                          child: ElevatedButton(
                            onPressed: _submitDispute,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.transparent,
                              shadowColor: Colors.transparent,
                              foregroundColor: const Color(0xFF1F1A15),
                              shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(16)),
                              elevation: 0,
                            ),
                            child: const Text(
                              'Iniciar Proceso de Disputa',
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
                ),
              ),
            ),
    );
  }
}
