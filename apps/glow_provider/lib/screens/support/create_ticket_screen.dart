// frontend/lib/screens/support/create_ticket_screen.dart
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:glow_core/services/support_service.dart';
import 'package:glow_core/shared/theme.dart';

class CreateTicketScreen extends StatefulWidget {
  final String? preselectedBookingId;
  const CreateTicketScreen({super.key, this.preselectedBookingId});

  @override
  State<CreateTicketScreen> createState() => _CreateTicketScreenState();
}

class _CreateTicketScreenState extends State<CreateTicketScreen> {
  final _formKey = GlobalKey<FormState>();
  final _asuntoCtrl = TextEditingController();
  final _descCtrl = TextEditingController();

  String _selectedTipo = 'PETICION';
  String _selectedCategoria = 'servicio';
  String? _bookingId;

  final List<String> _evidenciaBase64List = [];
  bool _isSaving = false;
  String? _error;

  final ImagePicker _picker = ImagePicker();

  @override
  void initState() {
    super.initState();
    _bookingId = widget.preselectedBookingId;
  }

  @override
  void dispose() {
    _asuntoCtrl.dispose();
    _descCtrl.dispose();
    super.dispose();
  }

  Future<void> _attachImage() async {
    try {
      final XFile? file = await _picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1000,
        maxHeight: 1000,
        imageQuality: 80,
      );
      if (file == null) return;

      final Uint8List bytes = await file.readAsBytes();
      final ext = file.name.toLowerCase().split('.').last;
      final mimeTypes = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
      };
      final mimeType = mimeTypes[ext] ?? 'image/jpeg';
      final base64String = base64Encode(bytes);
      final dataUri = 'data:$mimeType;base64,$base64String';

      setState(() {
        _evidenciaBase64List.add(dataUri);
      });
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error al adjuntar imagen: $e'), backgroundColor: Colors.redAccent),
      );
    }
  }

  Future<void> _submitTicket() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isSaving = true;
      _error = null;
    });

    try {
      final res = await SupportService.createTicket(
        bookingId: _bookingId,
        tipo: _selectedTipo,
        categoria: _selectedCategoria,
        asunto: _asuntoCtrl.text.trim(),
        descripcion: _descCtrl.text.trim(),
        evidenciaUrls: _evidenciaBase64List,
      );

      if (res != null && res['success'] == true) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('✓ Tu ticket / PQRSF ha sido radicado exitosamente.'),
              backgroundColor: AppTheme.success,
            ),
          );
          Navigator.pop(context, true);
        }
      } else {
        setState(() {
          _error = 'Ocurrió un problema en el servidor al crear la solicitud.';
        });
      }
    } catch (e) {
      setState(() {
        _error = 'Error de red/conexión: $e';
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
          'Radicar Solicitud & PQRSF',
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
          ? const Center(child: CircularProgressIndicator(color: Color(0xFFC5A052)))
          : Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 680),
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                  child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text(
                      'Radicación de PQRSF',
                      style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.black87),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Describe detalladamente tu caso. Nuestro equipo responderá en la brevedad posible.',
                      style: TextStyle(fontSize: 12, color: Colors.grey[600]),
                    ),
                    const SizedBox(height: 24),

                    // Tipo de PQRSF
                    DropdownButtonFormField<String>(
                      initialValue: _selectedTipo,
                      decoration: AppTheme.inputDecoration(
                        hintText: 'Tipo',
                        labelText: 'Tipo de PQRSF',
                        prefixIcon: Icons.help_outline,
                      ),
                      items: const [
                        DropdownMenuItem(value: 'PETICION', child: Text('Petición')),
                        DropdownMenuItem(value: 'QUEJA', child: Text('Queja')),
                        DropdownMenuItem(value: 'RECLAMO', child: Text('Reclamo')),
                        DropdownMenuItem(value: 'SUGERENCIA', child: Text('Sugerencia')),
                        DropdownMenuItem(value: 'FELICITACION', child: Text('Felicitación')),
                      ],
                      onChanged: (val) {
                        if (val != null) setState(() => _selectedTipo = val);
                      },
                    ),
                    const SizedBox(height: 16),

                    // Categoría
                    DropdownButtonFormField<String>(
                      initialValue: _selectedCategoria,
                      decoration: AppTheme.inputDecoration(
                        hintText: 'Categoría',
                        labelText: 'Categoría',
                        prefixIcon: Icons.category_outlined,
                      ),
                      items: const [
                        DropdownMenuItem(value: 'servicio', child: Text('Calidad de Servicio')),
                        DropdownMenuItem(value: 'pago', child: Text('Pagos / Facturación')),
                        DropdownMenuItem(value: 'app', child: Text('Problemas de la App')),
                        DropdownMenuItem(value: 'seguridad', child: Text('Seguridad y Privacidad')),
                        DropdownMenuItem(value: 'otros', child: Text('Otros')),
                      ],
                      onChanged: (val) {
                        if (val != null) setState(() => _selectedCategoria = val);
                      },
                    ),
                    const SizedBox(height: 16),

                    // ID de Reserva (Opcional)
                    TextFormField(
                      initialValue: _bookingId,
                      decoration: AppTheme.inputDecoration(
                        hintText: 'Ej: UUID de la reserva (opcional)',
                        labelText: 'ID de Cita Relacionada',
                        prefixIcon: Icons.calendar_today_outlined,
                      ),
                      onChanged: (val) => _bookingId = val.trim().isEmpty ? null : val.trim(),
                    ),
                    const SizedBox(height: 16),

                    // Asunto
                    TextFormField(
                      controller: _asuntoCtrl,
                      decoration: AppTheme.inputDecoration(
                        hintText: 'Resume tu solicitud en una frase',
                        labelText: 'Asunto de la solicitud',
                        prefixIcon: Icons.title_outlined,
                      ),
                      validator: (val) {
                        if (val == null || val.trim().isEmpty) {
                          return 'Por favor ingresa un asunto.';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 16),

                    // Descripción
                    TextFormField(
                      controller: _descCtrl,
                      maxLines: 5,
                      decoration: const InputDecoration(
                        hintText: 'Describe claramente lo sucedido o tu sugerencia...',
                        labelText: 'Descripción detallada',
                        alignLabelWithHint: true,
                        border: OutlineInputBorder(),
                      ),
                      validator: (val) {
                        if (val == null || val.trim().isEmpty) {
                          return 'Por favor detalla la descripción del caso.';
                        }
                        if (val.trim().length < 10) {
                          return 'La descripción debe tener al menos 10 caracteres.';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 24),

                    // Adjuntar evidencias
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'Adjuntar fotos / evidencias',
                          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.black87),
                        ),
                        TextButton.icon(
                          onPressed: _attachImage,
                          icon: const Icon(Icons.add_a_photo_outlined, size: 18),
                          label: const Text('Agregar'),
                          style: TextButton.styleFrom(foregroundColor: AppTheme.primary),
                        )
                      ],
                    ),
                    const SizedBox(height: 8),

                    // Grid de fotos adjuntadas
                    if (_evidenciaBase64List.isNotEmpty)
                      GridView.builder(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
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
                                  child: Image.memory(bytes, fit: BoxFit.cover),
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
                                    child: const Icon(Icons.close, size: 14, color: Colors.white),
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
                          border: Border.all(color: Colors.grey[200]!, style: BorderStyle.solid),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.image_outlined, color: Colors.grey[400], size: 18),
                            const SizedBox(width: 8),
                            Text('Sin imágenes adjuntas', style: TextStyle(color: Colors.grey[400], fontSize: 11)),
                          ],
                        ),
                      ),

                    if (_error != null) ...[
                      const SizedBox(height: 16),
                      Text(
                        _error!,
                        style: const TextStyle(color: Colors.redAccent, fontWeight: FontWeight.w500, fontSize: 12),
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
                            color: const Color(0xFFC5A052).withValues(alpha: 0.35),
                            blurRadius: 12,
                            offset: const Offset(0, 4),
                          ),
                        ],
                      ),
                      child: ElevatedButton(
                        onPressed: _submitTicket,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.transparent,
                          shadowColor: Colors.transparent,
                          foregroundColor: const Color(0xFF1F1A15),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                          elevation: 0,
                        ),
                        child: const Text(
                          'Radicar Solicitud',
                          style: TextStyle(
                            fontFamily: 'Inter',
                            fontWeight: FontWeight.bold,
                            fontSize: 16,
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
