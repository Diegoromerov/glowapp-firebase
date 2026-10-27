// frontend/lib/screens/provider_profile_screen.dart
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:glow_core/services/api_service.dart';
import 'package:glow_core/services/auth_service.dart';
import 'package:glow_core/shared/theme.dart' hide AppTheme;
import 'package:glow_core/widgets/provider/fiscal_iva_section.dart';
import 'package:glow_core/widgets/provider/provider_schedule_dialog.dart';
import 'package:glow_core/glow_core.dart';

class ProviderProfileScreen extends StatefulWidget {
  final bool isEmbedded;
  const ProviderProfileScreen({super.key, this.isEmbedded = false});

  @override
  State<ProviderProfileScreen> createState() => _ProviderProfileScreenState();
}

class _ProviderProfileScreenState extends State<ProviderProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _bioCtrl = TextEditingController();
  final _coverageCtrl = TextEditingController();
  final _experienceCtrl = TextEditingController();

  String? _email;
  String? _avatarUrl;
  String? _verificationStatus;
  int _startHour = 6;
  int _endHour = 20;
  Map<String, dynamic> _weeklySchedule = {
    'lunes': {'activo': true, 'inicio': 6, 'fin': 20},
    'martes': {'activo': true, 'inicio': 6, 'fin': 20},
    'miercoles': {'activo': true, 'inicio': 6, 'fin': 20},
    'jueves': {'activo': true, 'inicio': 6, 'fin': 20},
    'viernes': {'activo': true, 'inicio': 6, 'fin': 20},
    'sabado': {'activo': true, 'inicio': 8, 'fin': 18},
    'domingo': {'activo': false, 'inicio': 8, 'fin': 18},
  };
  bool _isLoading = true;
  bool _isSaving = false;
  bool _isUploading = false;
  String? _error;
  String? _message;

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    _bioCtrl.dispose();
    _coverageCtrl.dispose();
    _experienceCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadProfile() async {
    try {
      final profile = await ApiService.fetchUserProfile();
      final prefs = await SharedPreferences.getInstance();

      final localBio =
          prefs.getString('provider_bio') ?? profile['description'] ?? '';
      final localCoverage = prefs.getDouble('provider_coverage_radius') ?? 10.0;
      final localExperience = prefs.getInt('provider_experience_years') ?? 3;

      final start = profile['active_start_hour'] != null
          ? int.tryParse(profile['active_start_hour'].toString()) ?? 6
          : 6;
      final end = profile['active_end_hour'] != null
          ? int.tryParse(profile['active_end_hour'].toString()) ?? 20
          : 20;
      final schedule = profile['weekly_schedule'] != null
          ? Map<String, dynamic>.from(profile['weekly_schedule'])
          : null;

      setState(() {
        _nameCtrl.text = profile['full_name'] ?? '';
        _phoneCtrl.text = profile['phone'] ?? '';
        _bioCtrl.text = localBio;
        _coverageCtrl.text = localCoverage.toString();
        _experienceCtrl.text = localExperience.toString();
        _startHour = start;
        _endHour = end;
        if (schedule != null) {
          _weeklySchedule = schedule;
        }
        _email = profile['email'] ?? '';
        _avatarUrl = profile['avatar_url'] ?? '';
        _verificationStatus = profile['estatus_verificacion'] ?? 'PENDIENTE';
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = 'Error al cargar perfil: $e';
        _isLoading = false;
      });
    }
  }

  Future<void> _showPhotoSourceSheet() async {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return SafeArea(
          child: Wrap(
            children: [
              const Padding(
                padding: EdgeInsets.all(16.0),
                child: Text(
                  'Seleccionar Foto de Perfil',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
              ),
              ListTile(
                leading:
                    Icon(Icons.photo_library, color: AppTheme.primary),
                title: const Text('Galería de fotos'),
                onTap: () {
                  Navigator.pop(context);
                  _pickAndUploadAvatar(ImageSource.gallery);
                },
              ),
              ListTile(
                leading: Icon(Icons.camera_alt, color: AppTheme.primary),
                title: const Text('Cámara de fotos'),
                onTap: () {
                  Navigator.pop(context);
                  _pickAndUploadAvatar(ImageSource.camera);
                },
              ),
              const SizedBox(height: 12),
            ],
          ),
        );
      },
    );
  }

  Future<void> _pickAndUploadAvatar(ImageSource source) async {
    final ImagePicker picker = ImagePicker();
    try {
      final XFile? file = await picker.pickImage(
        source: source,
        maxWidth: 400,
        maxHeight: 400,
        imageQuality: 70,
      );
      if (file == null) return;

      setState(() {
        _isUploading = true;
        _error = null;
        _message = null;
      });

      final Uint8List bytes = await file.readAsBytes();
      
      // Convertir a Base64 Data URI para almacenar directamente en la BD
      // Esto evita depender del filesystem del servidor (efímero en Railway)
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
      
      await ApiService.updateAvatar(dataUri);

      setState(() {
        _avatarUrl = dataUri;
        _isUploading = false;
        _message = 'Foto de perfil actualizada con éxito';
      });
    } catch (e) {
      setState(() {
        _isUploading = false;
        _error = 'Error al subir foto: $e';
      });
    }
  }

  Future<void> _saveProfileChanges() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isSaving = true;
      _error = null;
      _message = null;
    });

    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('provider_bio', _bioCtrl.text.trim());
      await prefs.setDouble('provider_coverage_radius',
          double.tryParse(_coverageCtrl.text) ?? 10.0);
      await prefs.setInt(
          'provider_experience_years', int.tryParse(_experienceCtrl.text) ?? 3);

      await ApiService.updateUserProfile(
        fullName: _nameCtrl.text.trim(),
        phone: _phoneCtrl.text.trim(),
        description: _bioCtrl.text.trim(),
        activeStartHour: _startHour,
        activeEndHour: _endHour,
        weeklySchedule: _weeklySchedule,
      );

      setState(() {
        _isSaving = false;
        _message = 'Perfil guardado correctamente';
      });
    } catch (e) {
      setState(() {
        _isSaving = false;
        _error = 'Error al guardar cambios: $e';
      });
    }
  }

  double _calculateCompleteness() {
    int totalFields = 6;
    int filledFields = 0;

    if (_nameCtrl.text.trim().isNotEmpty) filledFields++;
    if (_phoneCtrl.text.trim().isNotEmpty) filledFields++;
    if (_avatarUrl != null && _avatarUrl!.isNotEmpty) filledFields++;
    if (_bioCtrl.text.trim().isNotEmpty) filledFields++;
    if (_coverageCtrl.text.trim().isNotEmpty) filledFields++;
    if (_experienceCtrl.text.trim().isNotEmpty) filledFields++;

    return filledFields / totalFields;
  }

  Widget _buildCompletenessBar() {
    final percent = _calculateCompleteness();
    final displayPercent = (percent * 100).toInt();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      margin: const EdgeInsets.only(bottom: 20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFEFE8DE), width: 1.2),
        boxShadow: [
          BoxShadow(
            color: Color(0xFFC5A052).withOpacity(0.08),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.auto_awesome_rounded, size: 16, color: Color(0xFFC5A052)),
                  SizedBox(width: 8),
                  Text(
                    'Progreso del Perfil',
                    style: TextStyle(
                      fontFamily: 'Inter',
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF1F1A15),
                      fontSize: 13.5,
                      letterSpacing: 0.2,
                    ),
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                decoration: BoxDecoration(
                  color: const Color(0xFFFAF6EE),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Color(0xFFC5A052).withOpacity(0.3), width: 0.8),
                ),
                child: Text(
                  '$displayPercent%',
                  style: const TextStyle(
                    fontFamily: 'Inter',
                    fontWeight: FontWeight.w800,
                    color: Color(0xFFC5A052),
                    fontSize: 12.5,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: LinearProgressIndicator(
              value: percent,
              backgroundColor: const Color(0xFFF3EFE9),
              valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFFC5A052)),
              minHeight: 8,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildVerificationBadge() {
    final status = _verificationStatus?.toUpperCase() ?? 'PENDIENTE';
    Color badgeColor;
    Color borderColor;
    Color textColor;
    IconData icon;
    String text;

    if (status == 'APROBADO') {
      badgeColor = const Color(0xFFF0FDF4);
      borderColor = const Color(0xFFBBF7D0);
      textColor = const Color(0xFF15803D);
      icon = Icons.verified_rounded;
      text = 'GlowPro Verificado / Aprobado';
    } else if (status == 'RECHAZADO') {
      badgeColor = const Color(0xFFFEF2F2);
      borderColor = const Color(0xFFFECACA);
      textColor = const Color(0xFFB91C1C);
      icon = Icons.gpp_bad_rounded;
      text = 'Verificación Rechazada';
    } else {
      badgeColor = const Color(0xFFFEFCE8);
      borderColor = const Color(0xFFFEF08A);
      textColor = const Color(0xFFA16207);
      icon = Icons.pending_actions_rounded;
      text = 'Verificación Pendiente';
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
      margin: const EdgeInsets.only(bottom: 20),
      decoration: BoxDecoration(
        color: badgeColor,
        borderRadius: BorderRadius.circular(30),
        border: Border.all(color: borderColor, width: 1.2),
        boxShadow: [
          BoxShadow(
            color: textColor.withOpacity(0.08),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: textColor, size: 18),
          const SizedBox(width: 8),
          Text(
            text,
            style: TextStyle(
              fontFamily: 'Inter',
              fontWeight: FontWeight.bold,
              color: textColor,
              fontSize: 13,
              letterSpacing: 0.2,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWeeklyScheduleEditor() {
    final days = [
      'lunes',
      'martes',
      'miercoles',
      'jueves',
      'viernes',
      'sabado',
      'domingo'
    ];
    final dayNames = {
      'lunes': 'Lunes',
      'martes': 'Martes',
      'miercoles': 'Miércoles',
      'jueves': 'Jueves',
      'viernes': 'Viernes',
      'sabado': 'Sábado',
      'domingo': 'Domingo',
    };

    return Container(
      margin: const EdgeInsets.only(top: 16, bottom: 16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFEFE8DE), width: 1.2),
        boxShadow: [
          BoxShadow(
            color: Color(0xFFC5A052).withOpacity(0.06),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.calendar_today_rounded, color: Color(0xFFC5A052), size: 19),
                  SizedBox(width: 8),
                  Text(
                    'Horario de Disponibilidad Semanal',
                    style: TextStyle(
                      fontFamily: 'Inter',
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                      color: Color(0xFF1F1A15),
                      letterSpacing: 0.2,
                    ),
                  ),
                ],
              ),
              IconButton(
                icon: const Icon(Icons.tune_rounded, color: Color(0xFFC5A052), size: 20),
                tooltip: 'Editor rápido de horarios',
                onPressed: () {
                  showDialog(
                    context: context,
                    builder: (_) => ProviderScheduleDialog(
                      currentSchedule: _weeklySchedule,
                      onSuccess: _loadProfile,
                    ),
                  );
                },
              ),
            ],
          ),
          const SizedBox(height: 8),
          const Text(
            'Configura las horas de inicio y fin para cada día, o apaga los días que no laboras.',
            style: TextStyle(fontFamily: 'Inter', fontSize: 12, color: Color(0xFF8C7E74)),
          ),
          const Divider(height: 24, color: Color(0xFFEFE8DE)),
          ...days.map((key) {
            final conf = _weeklySchedule[key] ??
                {'activo': true, 'inicio': 6, 'fin': 20};
            final bool isActive = conf['activo'] ?? false;
            final int start = conf['inicio'] ?? 6;
            final int end = conf['fin'] ?? 20;

            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 4.0),
              child: Row(
                children: [
                  SizedBox(
                    width: 105,
                    child: Row(
                      children: [
                        Checkbox(
                          value: isActive,
                          activeColor: const Color(0xFFC5A052),
                          onChanged: (val) {
                            if (val != null) {
                              setState(() {
                                _weeklySchedule[key]['activo'] = val;
                              });
                            }
                          },
                        ),
                        Expanded(
                          child: Text(
                            dayNames[key]!,
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              color: isActive
                                  ? const Color(0xFF4A3E3D)
                                  : Colors.grey,
                              fontSize: 13,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: isActive
                        ? Row(
                            children: [
                              Expanded(
                                child: DropdownButtonFormField<int>(
                                  initialValue: start,
                                  decoration: const InputDecoration(
                                    contentPadding: EdgeInsets.symmetric(
                                        horizontal: 8, vertical: 4),
                                    border: OutlineInputBorder(
                                        borderRadius: BorderRadius.all(
                                            Radius.circular(10))),
                                    labelText: 'De',
                                    labelStyle: TextStyle(fontSize: 10),
                                  ),
                                  items: List.generate(
                                      24,
                                      (h) => DropdownMenuItem(
                                            value: h,
                                            child: Text(
                                                '${h.toString().padLeft(2, '0')}:00',
                                                style: const TextStyle(
                                                    fontSize: 12)),
                                          )),
                                  onChanged: (val) {
                                    if (val != null) {
                                      setState(() {
                                        _weeklySchedule[key]['inicio'] = val;
                                      });
                                    }
                                  },
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: DropdownButtonFormField<int>(
                                  initialValue: end,
                                  decoration: const InputDecoration(
                                    contentPadding: EdgeInsets.symmetric(
                                        horizontal: 8, vertical: 4),
                                    border: OutlineInputBorder(
                                        borderRadius: BorderRadius.all(
                                            Radius.circular(10))),
                                    labelText: 'Hasta',
                                    labelStyle: TextStyle(fontSize: 10),
                                  ),
                                  items: List.generate(
                                      24,
                                      (h) => DropdownMenuItem(
                                            value: h,
                                            child: Text(
                                                '${h.toString().padLeft(2, '0')}:00',
                                                style: const TextStyle(
                                                    fontSize: 12)),
                                          )),
                                  onChanged: (val) {
                                    if (val != null) {
                                      setState(() {
                                        _weeklySchedule[key]['fin'] = val;
                                      });
                                    }
                                  },
                                  validator: (val) {
                                    if (val != null && val <= start) {
                                      return 'Inválido';
                                    }
                                    return null;
                                  },
                                ),
                              ),
                            ],
                          )
                        : const Text(
                            'Cerrado / No disponible',
                            style: TextStyle(
                                fontStyle: FontStyle.italic,
                                color: Colors.grey,
                                fontSize: 13),
                          ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  Future<void> _confirmLogout() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        title: const Row(
          children: [
            Icon(Icons.exit_to_app_rounded, color: Colors.redAccent, size: 28),
            SizedBox(width: 8),
            Text('¿Cerrar sesión?',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
          ],
        ),
        content:
            const Text('¿Estás seguro de que deseas cerrar tu sesión actual?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar',
                style:
                    TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFFEE2E2),
              foregroundColor: const Color(0xFFDC2626),
              elevation: 0,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(30)),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            ),
            child: const Text('Cerrar Sesión',
                style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );

    if (confirm == true && mounted) {
      final navigator = Navigator.of(context);
      await AuthService.logout();
      navigator.pushNamedAndRemoveUntil('/login', (route) => false);
    }
  }

  ImageProvider? _getAvatarProvider() {
    if (_avatarUrl == null || _avatarUrl!.isEmpty) return null;
    try {
      if (_avatarUrl!.startsWith('data:')) {
        final parts = _avatarUrl!.split(',');
        if (parts.length > 1) {
          return MemoryImage(base64Decode(parts.last));
        }
      } else {
        return NetworkImage(ApiService.normalizeUrl(_avatarUrl!));
      }
    } catch (e) {
      debugPrint('Error parsing avatar image: $e');
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return Scaffold(
        backgroundColor: Colors.white,
        body:
            Center(child: CircularProgressIndicator(color: AppTheme.primary)),
      );
    }

    final avatarProvider = _getAvatarProvider();

    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: widget.isEmbedded
          ? null
          : AppBar(
              leading: Padding(
                padding: const EdgeInsets.only(left: 14),
                child: Center(
                  child: InkWell(
                    onTap: () => Navigator.maybePop(context),
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
                  Icon(Icons.person_pin_rounded, size: 18, color: Color(0xFFC5A052)),
                  SizedBox(width: 8),
                  Text(
                    'Perfil Profesional Pro',
                    style: TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF1F1A15),
                      letterSpacing: 0.5,
                    ),
                  ),
                ],
              ),
              backgroundColor: const Color(0xFFFAF8F5),
              foregroundColor: const Color(0xFF1F1A15),
              elevation: 0,
              scrolledUnderElevation: 0,
            ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 680),
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 12.0),
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // completeness bar
                  _buildCompletenessBar(),

                  // verification status badge
                  Center(child: _buildVerificationBadge()),

                  const SizedBox(height: 8),

                  // 1. Cabecera con Avatar Editable en Medallón de Alta Joyería
                  Center(
                    child: Column(
                      children: [
                        Stack(
                          children: [
                            Container(
                              width: 120,
                              height: 120,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                gradient: const LinearGradient(
                                  colors: [Color(0xFFF3D59B), Color(0xFFC5A052), Color(0xFF96732B)],
                                  begin: Alignment.topLeft,
                                  end: Alignment.bottomRight,
                                ),
                                boxShadow: [
                                  BoxShadow(
                                    color: Color(0xFFC5A052).withOpacity(0.35),
                                    blurRadius: 20,
                                    offset: const Offset(0, 6),
                                  ),
                                ],
                              ),
                              padding: const EdgeInsets.all(3.5),
                              child: Container(
                                decoration: const BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: Color(0xFFFDFBF7),
                                ),
                                padding: const EdgeInsets.all(2),
                                child: CircleAvatar(
                                  radius: 54,
                                  backgroundColor: const Color(0xFFFAF6EE),
                                  backgroundImage: avatarProvider,
                                  child: avatarProvider == null
                                      ? const Icon(Icons.person_rounded, size: 54, color: Color(0xFFC5A052))
                                      : null,
                                ),
                              ),
                            ),
                            Positioned(
                              bottom: 2,
                              right: 2,
                              child: GestureDetector(
                                onTap: _isUploading ? null : _showPhotoSourceSheet,
                                child: Container(
                                  padding: const EdgeInsets.all(8),
                                  decoration: BoxDecoration(
                                    gradient: const LinearGradient(
                                      colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                                    ),
                                    shape: BoxShape.circle,
                                    border: Border.all(color: Colors.white, width: 2.5),
                                    boxShadow: [
                                      BoxShadow(
                                        color: Color(0xFFC5A052).withOpacity(0.4),
                                        blurRadius: 8,
                                        offset: const Offset(0, 3),
                                      ),
                                    ],
                                  ),
                                  child: const Icon(Icons.camera_alt_rounded,
                                      color: Color(0xFF1F1A15), size: 16),
                                ),
                              ),
                            ),
                            if (_isUploading)
                              const Positioned.fill(
                                child: CircleAvatar(
                                  backgroundColor: Colors.black26,
                                  child: CircularProgressIndicator(color: Colors.white),
                                ),
                              ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFAF6EE),
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(color: Color(0xFFC5A052).withOpacity(0.3), width: 0.8),
                          ),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.workspace_premium_rounded, size: 14, color: Color(0xFFC5A052)),
                              SizedBox(width: 6),
                              Text(
                                'PRESTADOR PROFESIONAL GLOW',
                                style: TextStyle(
                                  fontFamily: 'Inter',
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700,
                                  color: Color(0xFFC5A052),
                                  letterSpacing: 0.6,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 28),

              // 2. Formularios de edición
              TextFormField(
                controller: _nameCtrl,
                decoration:
                    _inputDecoration('Nombre completo', Icons.person_outline),
                validator: (v) =>
                    v!.isEmpty ? 'Ingresa tu nombre completo' : null,
                onChanged: (v) => setState(() {}),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _phoneCtrl,
                keyboardType: TextInputType.phone,
                decoration: _inputDecoration(
                    'Teléfono / Celular', Icons.phone_outlined),
                validator: (v) =>
                    v!.isEmpty ? 'Ingresa tu número telefónico' : null,
                onChanged: (v) => setState(() {}),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _bioCtrl,
                maxLines: 3,
                decoration: _inputDecoration(
                    'Bio Profesional', Icons.text_snippet_outlined),
                validator: (v) =>
                    v!.isEmpty ? 'Ingresa una breve biografía' : null,
                onChanged: (v) => setState(() {}),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: TextFormField(
                      controller: _coverageCtrl,
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      decoration: _inputDecoration(
                          'Radio Cobertura (km)', Icons.map_outlined),
                      validator: (v) {
                        if (v!.isEmpty) return 'Requerido';
                        if (double.tryParse(v) == null) return 'Inválido';
                        return null;
                      },
                      onChanged: (v) => setState(() {}),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: TextFormField(
                      controller: _experienceCtrl,
                      keyboardType: TextInputType.number,
                      decoration: _inputDecoration(
                          'Experiencia (Años)', Icons.work_outline),
                      validator: (v) {
                        if (v!.isEmpty) return 'Requerido';
                        if (int.tryParse(v) == null) return 'Inválido';
                        return null;
                      },
                      onChanged: (v) => setState(() {}),
                    ),
                  ),
                ],
              ),
              _buildWeeklyScheduleEditor(),
              // Datos fiscales: consulta y cambio de la responsabilidad de IVA
              // declarada a partir del RUT (estado, RUT y origen vienen del servidor).
              const FiscalIvaSection(),
              TextFormField(
                initialValue: _email,
                enabled: false,
                decoration: _inputDecoration(
                        'Correo electrónico (Lectura)', Icons.email_outlined)
                    .copyWith(
                  filled: true,
                  fillColor: Colors.grey[50],
                ),
              ),
              const SizedBox(height: 24),

              if (_error != null)
                Text(
                  _error!,
                  style: const TextStyle(
                      color: Colors.redAccent, fontWeight: FontWeight.w500),
                  textAlign: TextAlign.center,
                ),
              if (_message != null)
                Text(
                  _message!,
                  style: const TextStyle(
                      color: Colors.green, fontWeight: FontWeight.w500),
                  textAlign: TextAlign.center,
                ),
              const SizedBox(height: 28),

              // Botón guardar cambios
              Container(
                width: double.infinity,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(16),
                  gradient: const LinearGradient(
                    colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: Color(0xFFC5A052).withOpacity(0.35),
                      blurRadius: 14,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: ElevatedButton(
                  onPressed: _isSaving ? null : _saveProfileChanges,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.transparent,
                    shadowColor: Colors.transparent,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                  child: _isSaving
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(color: Color(0xFF1F1A15), strokeWidth: 2),
                        )
                      : const Text(
                          'Guardar Perfil Profesional',
                          style: TextStyle(
                            fontFamily: 'Inter',
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF1F1A15),
                          ),
                        ),
                ),
              ),
              const SizedBox(height: 28),

              // 3. Accesos rápidos de Prestador en Tarjeta Flotante
              Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: const Color(0xFFEFE8DE), width: 1.2),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x06000000),
                      blurRadius: 12,
                      offset: Offset(0, 4),
                    ),
                  ],
                ),
                child: Column(
                  children: [
                    _buildSettingsTile(
                      icon: Icons.inventory_2_outlined,
                      title: 'Gestionar Mis Servicios',
                      onTap: () => Navigator.pushNamed(context, '/provider/services'),
                    ),
                    const Divider(color: Color(0xFFF3EFE9), height: 1, indent: 56, endIndent: 16),
                    _buildSettingsTile(
                      icon: Icons.photo_library_outlined,
                      title: 'Mi Portafolio de Trabajo',
                      onTap: () =>
                          Navigator.pushNamed(context, '/provider/portfolio'),
                    ),
                    const Divider(color: Color(0xFFF3EFE9), height: 1, indent: 56, endIndent: 16),
                    _buildSettingsTile(
                      icon: Icons.gavel_outlined,
                      title: 'Habeas Data & Términos Legales',
                      onTap: _showHabeasDataDialog,
                    ),
                    const Divider(color: Color(0xFFF3EFE9), height: 1, indent: 56, endIndent: 16),
                    _buildSettingsTile(
                      icon: Icons.headset_mic_outlined,
                      title: 'Centro de Soporte y PQRSF',
                      onTap: () => Navigator.pushNamed(context, '/support'),
                    ),
                    const Divider(color: Color(0xFFF3EFE9), height: 1, indent: 56, endIndent: 16),
                    _buildSettingsTile(
                      icon: Icons.gavel_outlined,
                      title: 'Mis Disputas de Servicio',
                      onTap: () => Navigator.pushNamed(context, '/disputes'),
                    ),
                    const Divider(color: Color(0xFFF3EFE9), height: 1, indent: 56, endIndent: 16),
                    _buildSettingsTile(
                      icon: Icons.school_outlined,
                      title: 'Academia Glow (Capacitación)',
                      onTap: () => Navigator.pushNamed(context, '/provider/academy'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 28),

              // Botón cerrar sesión en cápsula terracota
              OutlinedButton.icon(
                onPressed: _confirmLogout,
                icon: const Icon(Icons.logout_rounded, color: Color(0xFF9E4B3D), size: 18),
                label: const Text(
                  'Cerrar Sesión Profesional',
                  style: TextStyle(
                    fontFamily: 'Inter',
                    color: Color(0xFF9E4B3D),
                    fontWeight: FontWeight.bold,
                    fontSize: 14.5,
                  ),
                ),
                style: OutlinedButton.styleFrom(
                  backgroundColor: const Color(0xFFFFF8F6),
                  side: const BorderSide(color: Color(0xFFF5D6D0), width: 1.2),
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                ),
              ),
              SizedBox(height: 120.0 + MediaQuery.of(context).padding.bottom),
            ],
          ),
        ),
      ),
    ),
  ),
);
  }

  Widget _buildSettingsTile({
    required IconData icon,
    required String title,
    required VoidCallback onTap,
  }) {
    return ListTile(
      leading: Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(
          color: const Color(0xFFFAF6EE),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: Color(0xFFC5A052).withOpacity(0.25),
            width: 0.8,
          ),
        ),
        alignment: Alignment.center,
        child: Icon(icon, color: const Color(0xFFC5A052), size: 18),
      ),
      title: Text(
        title,
        style: const TextStyle(
          fontFamily: 'Inter',
          fontWeight: FontWeight.w600,
          fontSize: 14,
          color: Color(0xFF1F1A15),
        ),
      ),
      trailing: Container(
        width: 24,
        height: 24,
        decoration: BoxDecoration(
          color: const Color(0xFFFAF6EE),
          shape: BoxShape.circle,
          border: Border.all(
            color: Color(0xFFC5A052).withOpacity(0.2),
            width: 0.8,
          ),
        ),
        alignment: Alignment.center,
        child: const Icon(Icons.arrow_forward_ios_rounded, size: 10, color: Color(0xFFC5A052)),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 4.0),
      onTap: onTap,
    );
  }

  void _showHabeasDataDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        title: const Text('Tratamiento de Datos Personales',
            style: TextStyle(fontFamily: 'CormorantGaramond', fontWeight: FontWeight.bold, fontSize: 20)),
        content: const SingleChildScrollView(
          child: Text(
            'En cumplimiento de la Ley 1581 de 2012 y el Decreto 1377 de 2013 de la República de Colombia, te informamos que los datos personales y biométricos suministrados serán tratados de manera confidencial y con la finalidad exclusiva de prestar los servicios contratados a través de la plataforma GlowApp.\n\nPuedes ejercer tus derechos de conocer, actualizar, rectificar y suprimir tus datos enviando una solicitud a través de nuestro canal de PQRSF.',
            style: TextStyle(fontSize: 13, height: 1.4, color: Color(0xFF4A3E39)),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Entendido',
                style: TextStyle(
                    color: Color(0xFFC5A052), fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  InputDecoration _inputDecoration(String label, IconData icon) {
    return InputDecoration(
      labelText: label,
      labelStyle: const TextStyle(fontFamily: 'Inter', color: Color(0xFF8C7E74), fontSize: 13.5),
      prefixIcon: Icon(icon, color: const Color(0xFFC5A052), size: 20),
      floatingLabelBehavior: FloatingLabelBehavior.auto,
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Color(0xFFEFE8DE), width: 1.2),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Color(0xFFEFE8DE), width: 1.2),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Color(0xFFC5A052), width: 1.5),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
    );
  }
}
