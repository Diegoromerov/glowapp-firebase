// frontend/lib/screens/auth/onboarding_screen.dart
import 'package:glow_core/models/saas/saas_models.dart';
import 'package:glow_core/services/saas_api_service.dart';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;
import 'package:glow_core/services/auth_service.dart';
import 'package:glow_core/services/permission_rationale_service.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:glow_core/shared/theme.dart' hide AppTheme;
import 'package:glow_core/shared/background_video_player.dart';
import 'package:glow_core/data/colombia_municipalities.dart';
import 'package:glow_core/glow_core.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  String? _selectedRole; // 'CLIENTE', 'PRESTADOR', or 'SALON'
  bool _habeasDataAccepted = false;
  bool _terminosAccepted = false;
  bool _isLoading = false;
  String? _error;

  // Controllers para registro de Salón (SaaS)
  final _salonNameCtrl = TextEditingController();
  final _salonNitCtrl = TextEditingController();
  final _salonAddressCtrl = TextEditingController();
  final _salonPhoneCtrl = TextEditingController();
  final _salonCityCtrl = TextEditingController();

  // Ubicación física y publicación del Salón
  final MapController _salonMapController = MapController();
  LatLng _salonLocation = const LatLng(4.6735, -74.1422); // Bogotá por defecto
  bool _salonLocationConfirmed = false;
  bool _salonLocationPublic = true;
  bool _isLocatingSalon = false;

  // Módulo Constructor de Dirección Estructurada (Colombia)
  bool _useManualAddress = false;
  String _viaType = 'Calle';
  final _viaNumCtrl = TextEditingController();
  final _generatorNumCtrl = TextEditingController();
  final _plateNumCtrl = TextEditingController();
  final _complementCtrl = TextEditingController();

  // ═══════════════════════════════════════════════════════════════
  // SAAS ONBOARDING STATE
  // ═══════════════════════════════════════════════════════════════
  SaasPlanTier _selectedPlan = SaasPlanTier.freeTrial;
  final List<InviteMemberRequest> _teamInvites = [];
  bool _isCreatingSaasProfile = false;
  String? _saasError;

  static const List<String> _viaTypes = [
    'Calle',
    'Carrera',
    'Diagonal',
    'Transversal',
    'Avenida',
    'Autopista',
    'Circular',
  ];

  bool _isGeocodingAddress = false;

  void _syncComposedAddress() {
    if (_useManualAddress) return;
    final via = _viaType;
    final numVia = _viaNumCtrl.text.trim();
    final numGen = _generatorNumCtrl.text.trim();
    final plate = _plateNumCtrl.text.trim();
    final comp = _complementCtrl.text.trim();

    if (numVia.isEmpty) {
      _salonAddressCtrl.text = '';
      return;
    }

    String address = '$via $numVia';
    if (numGen.isNotEmpty) address += ' # $numGen';
    if (plate.isNotEmpty) address += ' - $plate';
    if (comp.isNotEmpty) address += ', $comp';

    _salonAddressCtrl.text = address;
  }

  /// Geocodifica la dirección y centra/fija el marcador en el mapa automáticamente
  Future<void> _geocodeAddressAndFixOnMap() async {
    final address = _salonAddressCtrl.text.trim();
    final cityRaw = _salonCityCtrl.text.trim();

    if (address.isEmpty && cityRaw.isEmpty) return;

    setState(() => _isGeocodingAddress = true);

    try {
      // Extraer nombre limpio de ciudad sin departamento entre paréntesis
      String cleanCity = cityRaw;
      if (cleanCity.contains('(')) {
        cleanCity = cleanCity.split('(').first.trim();
      }

      final queryParts = <String>[];
      if (address.isNotEmpty) queryParts.add(address);
      if (cleanCity.isNotEmpty) queryParts.add(cleanCity);
      queryParts.add('Colombia');
      final fullQuery = queryParts.join(', ');

      final url = Uri.parse(
        'https://nominatim.openstreetmap.org/search?format=json&q=${Uri.encodeComponent(fullQuery)}&limit=1&countrycodes=co',
      );

      final response = await http.get(url, headers: {
        'User-Agent': 'GlowAppBeauty/1.0 (contacto@glowapp.com)',
      }).timeout(const Duration(seconds: 4));

      if (response.statusCode == 200) {
        final List results = json.decode(response.body);
        if (results.isNotEmpty) {
          final lat = double.tryParse(results[0]['lat'].toString());
          final lon = double.tryParse(results[0]['lon'].toString());
          if (lat != null && lon != null) {
            final targetLoc = LatLng(lat, lon);
            if (mounted) {
              setState(() {
                _salonLocation = targetLoc;
                _salonLocationConfirmed = true;
              });
              _salonMapController.move(targetLoc, 16.0);
            }
            return;
          }
        }
      }
    } catch (_) {
      // Fallback silencioso sin bloquear al usuario
    } finally {
      if (mounted) setState(() => _isGeocodingAddress = false);
    }
  }

  @override
  void initState() {
    super.initState();
    _loadUserRoleIntent();
  }

  Future<void> _loadUserRoleIntent() async {
    final prefs = await SharedPreferences.getInstance();
    final role = prefs.getString('userRole')?.toUpperCase();
    if (mounted && role != null) {
      setState(() {
        if (role == 'SALON' || role == 'SALÓN') {
          _selectedRole = 'SALON';
        } else if (role == 'PROVIDER' || role == 'PRESTADOR') {
          _selectedRole = 'PRESTADOR';
        } else if (role == 'CLIENT' || role == 'CLIENTE') {
          _selectedRole = 'CLIENTE';
        }
      });
    }
  }

  @override
  void dispose() {
    _salonNameCtrl.dispose();
    _salonNitCtrl.dispose();
    _salonAddressCtrl.dispose();
    _salonPhoneCtrl.dispose();
    _salonCityCtrl.dispose();
    _viaNumCtrl.dispose();
    _generatorNumCtrl.dispose();
    _plateNumCtrl.dispose();
    _complementCtrl.dispose();
    super.dispose();
  }

  Future<void> _submitSalonOnboarding() async {
    if (!_habeasDataAccepted || !_terminosAccepted) {
      setState(() {
        _error = 'Debes aceptar la Política de Tratamiento de Datos (Habeas Data) y los Términos y Condiciones para continuar.';
      });
      return;
    }
    if (_salonNameCtrl.text.trim().isEmpty) {
      setState(() {
        _error = 'Por favor ingresa el nombre de tu salón de belleza.';
      });
      return;
    }

    setState(() {
      _isLoading = true;
      _isCreatingSaasProfile = true;
      _error = null;
      _saasError = null;
    });

    try {
      // Paso 1: Crear salón en Business Engine (existente)
      final res = await AuthService.createSalon(
        nombreSalon: _salonNameCtrl.text.trim(),
        nit: _salonNitCtrl.text.trim(),
        direccion: _salonAddressCtrl.text.trim(),
        telefono: _salonPhoneCtrl.text.trim(),
        ciudad: _salonCityCtrl.text.trim(),
        latitude: _salonLocationConfirmed ? _salonLocation.latitude : null,
        longitude: _salonLocationConfirmed ? _salonLocation.longitude : null,
        locationPublic: _salonLocationPublic,
      );

      if (res == null || res['success'] != true) {
        // Fallback: completar onboarding sin SaaS
        await AuthService.completeOnboarding(
          role: 'SALON',
          aceptarHabeasData: _habeasDataAccepted,
          aceptarTerminos: _terminosAccepted,
        );
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('userRole', 'salon');
        if (mounted) {
          Navigator.pushReplacementNamed(context, '/salon-hub');
        }
        return;
      }

      // Paso 2: provisionar el tenant SaaS desde el salón recién creado.
      // Crea business_profile + membership OWNER (idempotente). Sin esto,
      // /api/saas/* responde 401 "Contexto SaaS requerido".
      try {
        final profile = await SaasApiService.provisionTenant(plan: _selectedPlan.code);

        // Paso 3: enviar invitaciones de equipo con el id real del tenant
        // (antes se pasaba el slug, que no identifica al tenant).
        var inviteFailures = 0;
        for (final invite in _teamInvites) {
          try {
            await SaasApiService.inviteMember(profile.id, invite);
          } catch (_) {
            inviteFailures++;
          }
        }
        if (inviteFailures > 0 && mounted) {
          setState(() {
            _saasError = 'El salón quedó creado, pero $inviteFailures invitación(es) '
                'no se enviaron. Puedes reenviarlas desde Mi Equipo.';
          });
        }
      } catch (e) {
        if (mounted) {
          setState(() {
            _saasError = 'El salón quedó creado, pero el perfil SaaS no se pudo '
                'provisionar. Podrás completarlo desde Facturación.';
          });
        }
        if (kDebugMode) debugPrint('Onboarding: provisionamiento SaaS falló: $e');
      }

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('userRole', 'salon');
      if (mounted) {
        final warning = _saasError;
        if (warning != null) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(warning), duration: const Duration(seconds: 6)),
          );
        }
        Navigator.pushReplacementNamed(context, '/salon-hub');
      }
    } catch (e) {
      setState(() => _error = 'Error de conexión: $e');
    } finally {
      if (mounted) setState(() {
        _isLoading = false;
        _isCreatingSaasProfile = false;
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SAAS HELPER METHODS (class level)
  // ═══════════════════════════════════════════════════════════════

  String _planDescription(SaasPlanTier plan) {
      switch (plan) {
        case SaasPlanTier.freeTrial:
          return '14 días gratis · 3 asientos · 1.000 API/mes';
        case SaasPlanTier.freemium:
          return 'Gratis permanente · 1 asiento · 500 API/mes';
        case SaasPlanTier.basic:
          return '5 asientos · 200 reservas/mes · 10.000 API/mes';
        case SaasPlanTier.pro:
          return '20 asientos · reservas ilimitadas · Analítica avanzada · API Keys';
        case SaasPlanTier.enterprise:
          return 'Asientos y API ilimitados · WhatsApp · POS · Soporte prioritario';
      }
    }

  Widget _buildPlanSelector() {
    return Column(
      children: SaasPlanTier.values.map((plan) {
        final isSelected = _selectedPlan == plan;
        return GestureDetector(
          onTap: () => setState(() => _selectedPlan = plan),
          child: Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: isSelected ? plan.color.withValues(alpha: 0.1) : Colors.transparent,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: isSelected ? plan.color : const Color(0xFFEFE8DE),
                width: isSelected ? 2 : 1,
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 22,
                  height: 22,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: isSelected ? plan.color : const Color(0xFFC5A052),
                      width: 2,
                    ),
                    color: isSelected ? plan.color : Colors.transparent,
                  ),
                  child: isSelected
                      ? const Icon(Icons.check, size: 14, color: Colors.white)
                      : null,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        plan.label,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: isSelected ? plan.color : const Color(0xFF1F1A15),
                        ),
                      ),
                      Text(
                        plan.formattedPrice,
                        style: TextStyle(
                          fontSize: 12,
                          color: isSelected ? plan.color : const Color(0xFF8C7E74),
                        ),
                      ),
                    ],
                  ),
                ),
                Text(
                  _planDescription(plan),
                  style: const TextStyle(fontSize: 11, color: Color(0xFF8C7E74)),
                ),
              ],
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildInviteChip(InviteMemberRequest invite) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: invite.role.color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: invite.role.color.withValues(alpha: 0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.person_rounded, size: 14, color: invite.role.color),
          const SizedBox(width: 6),
          Text(
            invite.email,
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: invite.role.color),
          ),
          const SizedBox(width: 6),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: invite.role.color,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              invite.role.label,
              style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: Colors.white),
            ),
          ),
          const SizedBox(width: 6),
          GestureDetector(
            onTap: () => setState(() => _teamInvites.remove(invite)),
            child: Icon(Icons.close_rounded, size: 14, color: invite.role.color),
          ),
        ],
      ),
    );
  }

  Future<void> _showInviteMemberDialog() async {
    final emailCtrl = TextEditingController();
    MembershipRole selectedRole = MembershipRole.staff;

    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Invitar miembro al equipo'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: emailCtrl,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(
                labelText: 'Email del miembro',
                hintText: 'ejemplo@email.com',
                prefixIcon: Icon(Icons.email_outlined),
              ),
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<MembershipRole>(
              initialValue: selectedRole,
              decoration: const InputDecoration(
                labelText: 'Rol',
                prefixIcon: Icon(Icons.badge_outlined),
              ),
              items: [MembershipRole.admin, MembershipRole.manager, MembershipRole.staff]
                  .map((r) => DropdownMenuItem(value: r, child: Text(r.label)))
                  .toList(),
              onChanged: (v) => selectedRole = v ?? MembershipRole.staff,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () {
              final email = emailCtrl.text.trim();
              if (email.isNotEmpty && email.contains('@')) {
                setState(() {
                  _teamInvites.add(InviteMemberRequest(email: email, role: selectedRole));
                });
                Navigator.pop(ctx);
              }
            },
            child: const Text('Invitar'),
          ),
        ],
      ),
    );
  }

  // URLs de documentos subidos
  String? _documentoUrl;
  String? _rutUrl;
  String? _certificacionUrl;

  // Estados de carga por documento
  bool _uploadingDoc = false;
  bool _uploadingRut = false;
  bool _uploadingCert = false;

  final ImagePicker _picker = ImagePicker();

  Future<void> _pickAndUploadDocument(String type) async {
    try {
      final XFile? file = await _picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1000,
        maxHeight: 1000,
        imageQuality: 80,
      );
      if (file == null) return;

      setState(() {
        if (type == 'doc') _uploadingDoc = true;
        if (type == 'rut') _uploadingRut = true;
        if (type == 'cert') _uploadingCert = true;
        _error = null;
      });

      final Uint8List bytes = await file.readAsBytes();
      
      // Convertir a Base64 Data URI para almacenar directamente en la BD
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
        if (type == 'doc') _documentoUrl = dataUri;
        if (type == 'rut') _rutUrl = dataUri;
        if (type == 'cert') _certificacionUrl = dataUri;
      });
    } catch (e) {
      setState(() => _error = 'Error al subir el archivo: $e');
    } finally {
      setState(() {
        if (type == 'doc') _uploadingDoc = false;
        if (type == 'rut') _uploadingRut = false;
        if (type == 'cert') _uploadingCert = false;
      });
    }
  }

  Future<void> _submitOnboarding() async {
    if (_selectedRole == null) return;

    if (!_habeasDataAccepted || !_terminosAccepted) {
      setState(() {
        _error = 'Debes aceptar la Política de Privacidad (Habeas Data) y los Términos y Condiciones para continuar.';
      });
      return;
    }

    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      if (_selectedRole == 'PRESTADOR') {
        final result = await AuthService.completeOnboarding(
          role: 'PRESTADOR',
          documentoIdUrl: _documentoUrl,
          rutUrl: _rutUrl,
          certificacionUrl: _certificacionUrl,
          aceptarHabeasData: _habeasDataAccepted,
          aceptarTerminos: _terminosAccepted,
        );

        if (result != null && mounted) {
          Navigator.pushReplacementNamed(context, '/verification-pending');
        } else {
          setState(() => _error = 'Error al guardar el perfil en el servidor');
        }
      } else if (_selectedRole == 'SALON') {
        await _submitSalonOnboarding();
        return;
      } else {
        // CLIENTE
        final result = await AuthService.completeOnboarding(
          role: 'CLIENTE',
          aceptarHabeasData: _habeasDataAccepted,
          aceptarTerminos: _terminosAccepted,
        );
        if (result != null && mounted) {
          Navigator.pushReplacementNamed(context, '/home');
        } else {
          setState(() => _error = 'Error al guardar el perfil');
        }
      }
    } catch (e) {
      setState(() => _error = 'Error de conexión: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _saveDraft() async {
    if (!_habeasDataAccepted || !_terminosAccepted) {
      setState(() {
        _error = 'Debes aceptar la Política de Privacidad (Habeas Data) y los Términos y Condiciones para guardar tu borrador.';
      });
      return;
    }
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final result = await AuthService.completeOnboarding(
        role: 'PRESTADOR',
        documentoIdUrl: _documentoUrl,
        rutUrl: _rutUrl,
        certificacionUrl: _certificacionUrl,
        aceptarHabeasData: _habeasDataAccepted,
        aceptarTerminos: _terminosAccepted,
      );
      if (result != null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('✓ Borrador guardado. Puedes completar tu perfil más tarde.'),
            backgroundColor: AppTheme.primary,
          ),
        );
        Navigator.pushReplacementNamed(context, '/verification-pending');
      } else {
        setState(() => _error = 'Error al guardar el borrador');
      }
    } catch (e) {
      setState(() => _error = 'Error de conexión: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  // Clave global para coordinar el desmuteo en el primer tap del usuario
  final GlobalKey<BackgroundVideoPlayerState> _videoPlayerKey = GlobalKey<BackgroundVideoPlayerState>();

  @override
  Widget build(BuildContext context) {
    return Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: (_) => _videoPlayerKey.currentState?.unmuteOnUserGesture(),
      child: Scaffold(
        backgroundColor: const Color(0xFF15100C),
        body: Stack(
          children: [
            // Video de Fondo HD sin loop con fallback automático
            Positioned.fill(
              child: BackgroundVideoPlayer(
                key: _videoPlayerKey,
                assetPath: 'assets/videos/onboarding_intro.mp4',
                fallbackImagePath: 'images/auth/onboarding_bg.webp',
                overlayOpacity: 0.18,
                loop: false,
                initialMuted: true,
                unmuteOnFirstInteraction: true,
              ),
            ),
          SafeArea(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 680),
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Espaciador superior ampliado para bajar los botones hacia el área inferior
                      const SizedBox(height: 380),

                      _buildRoleSelectionCards(),
                      if (_selectedRole == 'CLIENTE') _buildClientView(),
                      if (_selectedRole == 'PRESTADOR') _buildProviderForm(),
                      if (_selectedRole == 'SALON') _buildSalonView(),
                      if (_error != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 16),
                          child: Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: Colors.redAccent.withValues(alpha: 0.5)),
                            ),
                            child: Text(
                              _error!,
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                  color: Colors.redAccent, fontWeight: FontWeight.w600),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

  Widget _buildRoleSelectionCards() {
    return Column(
      children: [
        _RoleCard(
          title: 'Cliente',
          subtitle: 'Agendar citas de belleza',
          icon: Icons.person_outline,
          isSelected: _selectedRole == 'CLIENTE',
          onTap: () => setState(() {
            _selectedRole = 'CLIENTE';
            _error = null;
          }),
        ),
        const SizedBox(height: 8),
        _RoleCard(
          title: 'Prestador',
          subtitle: 'Ofrecer servicios independientes',
          icon: Icons.storefront_outlined,
          isSelected: _selectedRole == 'PRESTADOR',
          onTap: () => setState(() {
            _selectedRole = 'PRESTADOR';
            _error = null;
          }),
        ),
        const SizedBox(height: 8),
        _RoleCard(
          title: 'Salón (SaaS)',
          subtitle: 'Registrar mi negocio y equipo',
          icon: Icons.domain_outlined,
          isSelected: _selectedRole == 'SALON',
          onTap: () => setState(() {
            _selectedRole = 'SALON';
            _error = null;
          }),
        ),
      ],
    );
  }

  Widget _buildClientView() {
    return Container(
      margin: const EdgeInsets.only(top: 16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Color(0xFFFAF8F5).withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFC5A052), width: 1.2),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.25),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: const Color(0xFFF5EBE6),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0xFFEFE8DE)),
            ),
            child: Column(
              children: [
                Container(
                  width: 80,
                  height: 80,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: const Color(0xFFC5A052), width: 2.5),
                    image: const DecorationImage(
                      image: AssetImage('images/avatar_aura.webp'),
                      fit: BoxFit.cover,
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                const Text(
                  '¡Hola! Soy Aura, tu guía personal',
                  style: TextStyle(
                    fontFamily: 'CormorantGaramond',
                    fontSize: 19,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF1F1A15),
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Te guiaré para encontrar a tu estilista ideal a domicilio, agendar de manera segura y proteger tus pagos con depósito en garantía en segundos.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: 'Inter',
                    fontSize: 13,
                    color: Color(0xFF4A3E39),
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          CheckboxListTile(
            value: _habeasDataAccepted,
            onChanged: (val) => setState(() => _habeasDataAccepted = val ?? false),
            title: const Text(
              'Acepto la Política de Tratamiento de Datos Personales (Habeas Data - Ley 1581 de 2012).',
              style: TextStyle(fontSize: 12, color: Color(0xFF1F1A15), fontWeight: FontWeight.w500),
            ),
            activeColor: const Color(0xFFC5A052),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
          ),
          CheckboxListTile(
            value: _terminosAccepted,
            onChanged: (val) => setState(() => _terminosAccepted = val ?? false),
            title: const Text(
              'Acepto los Términos y Condiciones de Uso de la plataforma GlowApp.',
              style: TextStyle(fontSize: 12, color: Color(0xFF1F1A15), fontWeight: FontWeight.w500),
            ),
            activeColor: const Color(0xFFC5A052),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
          ),
          const SizedBox(height: 16),
          Container(
            width: double.infinity,
            height: 50,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              gradient: const LinearGradient(
                colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              boxShadow: [
                BoxShadow(
                  color: Color(0xFFC5A052).withValues(alpha: 0.35),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: ElevatedButton(
              onPressed: (_isLoading || !_habeasDataAccepted || !_terminosAccepted) ? null : _submitOnboarding,
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.transparent,
                shadowColor: Colors.transparent,
                foregroundColor: const Color(0xFF1F1A15),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                elevation: 0,
              ),
              child: _isLoading
                  ? const SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(color: Color(0xFF1F1A15), strokeWidth: 2.5),
                    )
                  : const Text(
                      'COMENZAR EXPLORACIÓN',
                      style: TextStyle(
                        fontFamily: 'Inter',
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF1F1A15),
                        letterSpacing: 0.8,
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSalonView() {
    return Container(
      margin: const EdgeInsets.only(top: 16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Color(0xFFFAF8F5).withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFC5A052), width: 1.2),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.25),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: const Color(0xFFFAF6EE),
                  shape: BoxShape.circle,
                  border: Border.all(color: const Color(0xFFEFE8DE)),
                ),
                child: const Icon(Icons.domain_rounded, color: Color(0xFFC5A052), size: 28),
              ),
              const SizedBox(width: 14),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Registro de Salón de Belleza (SaaS)',
                      style: TextStyle(
                        fontFamily: 'CormorantGaramond',
                        fontSize: 19,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF1F1A15),
                      ),
                    ),
                    Text(
                      'Configura tu establecimiento, licencias SaaS y equipo de trabajo.',
                      style: TextStyle(
                        fontFamily: 'Inter',
                        fontSize: 12,
                        color: Color(0xFF8C7E74),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          TextField(
            controller: _salonNameCtrl,
            decoration: InputDecoration(
              filled: true,
              fillColor: Colors.white,
              labelText: 'Nombre del Salón *',
              labelStyle: const TextStyle(color: Color(0xFF4A3E39)),
              hintText: 'Ej. Salón Luxe Suite',
              prefixIcon: const Icon(Icons.store_outlined, color: Color(0xFFC5A052)),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: Color(0xFFEFE8DE)),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: Color(0xFFEFE8DE)),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: Color(0xFFC5A052), width: 1.5),
              ),
            ),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _salonNitCtrl,
            decoration: InputDecoration(
              filled: true,
              fillColor: Colors.white,
              labelText: 'NIT o Doc. Tributario',
              labelStyle: const TextStyle(color: Color(0xFF4A3E39)),
              hintText: 'Ej. 901.234.567-8',
              prefixIcon: const Icon(Icons.badge_outlined, color: Color(0xFFC5A052)),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: Color(0xFFEFE8DE)),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: Color(0xFFEFE8DE)),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: Color(0xFFC5A052), width: 1.5),
              ),
            ),
          ),
          const SizedBox(height: 14),
          // CAMPO INTELIGENTE: CIUDADES Y MUNICIPIOS DE COLOMBIA
          Autocomplete<String>(
            initialValue: TextEditingValue(text: _salonCityCtrl.text),
            optionsBuilder: (TextEditingValue textEditingValue) {
              if (textEditingValue.text.isEmpty) {
                return colombiaMunicipalities.take(15);
              }
              final query = textEditingValue.text.toLowerCase();
              return colombiaMunicipalities.where((municipality) =>
                  municipality.toLowerCase().contains(query)).take(25);
            },
            onSelected: (String selection) {
              _salonCityCtrl.text = selection;
            },
            fieldViewBuilder: (context, controller, focusNode, onFieldSubmitted) {
              controller.addListener(() {
                _salonCityCtrl.text = controller.text;
              });
              return TextField(
                controller: controller,
                focusNode: focusNode,
                decoration: InputDecoration(
                  filled: true,
                  fillColor: Colors.white,
                  labelText: 'Ciudad o Municipio de Colombia',
                  labelStyle: const TextStyle(color: Color(0xFF4A3E39)),
                  hintText: 'Ej. Chía (Cundinamarca) o Medellín (Antioquia)',
                  prefixIcon: const Icon(Icons.location_city_outlined, color: Color(0xFFC5A052)),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: Color(0xFFEFE8DE)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: Color(0xFFEFE8DE)),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: Color(0xFFC5A052), width: 1.5),
                  ),
                ),
              );
            },
          ),
          const SizedBox(height: 14),

          // ═══════════════════════════════════════════════════════════════
          // SAAS: SELECCIÓN DE PLAN
          // ═══════════════════════════════════════════════════════════════
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFEFE8DE)),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.03),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.workspace_premium_rounded, color: Color(0xFFC5A052), size: 20),
                    SizedBox(width: 8),
                    Text(
                      'Plan SaaS para tu Salón',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF1F1A15),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                const Text(
                  'Elige el plan que mejor se adapte a tu negocio. Podrás cambiarlo después.',
                  style: TextStyle(fontSize: 12, color: Color(0xFF8C7E74)),
                ),
                const SizedBox(height: 12),
                _buildPlanSelector(),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // ═══════════════════════════════════════════════════════════════
          // SAAS: INVITAR EQUIPO (OPCIONAL)
          // ═══════════════════════════════════════════════════════════════
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFEFE8DE)),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.03),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
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
                        Icon(Icons.group_add_rounded, color: Color(0xFFC5A052), size: 20),
                        SizedBox(width: 8),
                        Text(
                          'Invitar a mi Equipo (Opcional)',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF1F1A15),
                          ),
                        ),
                      ],
                    ),
                    TextButton.icon(
                      onPressed: _showInviteMemberDialog,
                      icon: const Icon(Icons.person_add_rounded, size: 16, color: Color(0xFFC5A052)),
                      label: const Text('Agregar', style: TextStyle(fontSize: 12, color: Color(0xFFC5A052), fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                const Text(
                  'Envía invitaciones a tu equipo. Recibirán un email para unirse a tu salón.',
                  style: TextStyle(fontSize: 11, color: Color(0xFF8C7E74)),
                ),
                const SizedBox(height: 12),
                if (_teamInvites.isEmpty)
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFAF6EE),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Color(0xFFEFE8DE).withValues(alpha: 0.5)),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.info_outline, size: 16, color: Color(0xFFC5A052)),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Sin invitaciones pendientes. Agrega miembros de tu equipo si lo deseas.',
                            style: TextStyle(fontSize: 12, color: Color(0xFF8C7E74)),
                          ),
                        ),
                      ],
                    ),
                  )
                else
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: _teamInvites.map((invite) => _buildInviteChip(invite)).toList(),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // MÓDULO CONSTRUCTOR DE DIRECCIÓN COLOMBIANA
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFEFE8DE)),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.03),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
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
                        Icon(Icons.signpost_outlined, color: Color(0xFFC5A052), size: 18),
                        SizedBox(width: 8),
                        Text(
                          'Dirección de la Sede',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF1F1A15),
                          ),
                        ),
                      ],
                    ),
                    TextButton(
                      onPressed: () {
                        setState(() {
                          _useManualAddress = !_useManualAddress;
                          if (!_useManualAddress) {
                            _syncComposedAddress();
                          }
                        });
                      },
                      child: Text(
                        _useManualAddress ? 'Usar Asistente Guiado' : 'Escribir Manual',
                        style: const TextStyle(fontSize: 11, color: Color(0xFFC5A052), fontWeight: FontWeight.bold),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                if (!_useManualAddress) ...[
                  // FILA 1: Tipo de Vía + Número de Vía
                  Row(
                    children: [
                      Expanded(
                        flex: 4,
                        child: DropdownButtonFormField<String>(
                          initialValue: _viaType,
                          decoration: InputDecoration(
                            filled: true,
                            fillColor: const Color(0xFFFAF6EE),
                            labelText: 'Tipo de Vía',
                            labelStyle: const TextStyle(fontSize: 12, color: Color(0xFF4A3E39)),
                            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(10),
                              borderSide: const BorderSide(color: Color(0xFFEFE8DE)),
                            ),
                          ),
                          items: _viaTypes.map((t) => DropdownMenuItem(
                            value: t,
                            child: Text(t, style: const TextStyle(fontSize: 13, color: Color(0xFF1F1A15))),
                          )).toList(),
                          onChanged: (val) {
                            if (val != null) {
                              setState(() {
                                _viaType = val;
                                _syncComposedAddress();
                              });
                            }
                          },
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        flex: 5,
                        child: TextField(
                          controller: _viaNumCtrl,
                          onChanged: (_) => _syncComposedAddress(),
                          decoration: InputDecoration(
                            filled: true,
                            fillColor: const Color(0xFFFAF6EE),
                            labelText: 'Número / Letra',
                            hintText: 'Ej. 93, 15A',
                            labelStyle: const TextStyle(fontSize: 12, color: Color(0xFF4A3E39)),
                            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(10),
                              borderSide: const BorderSide(color: Color(0xFFEFE8DE)),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  // FILA 2: Generador (#) + Placa (-)
                  Row(
                    children: [
                      const Text('#', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFFC5A052))),
                      const SizedBox(width: 8),
                      Expanded(
                        child: TextField(
                          controller: _generatorNumCtrl,
                          onChanged: (_) => _syncComposedAddress(),
                          decoration: InputDecoration(
                            filled: true,
                            fillColor: const Color(0xFFFAF6EE),
                            labelText: 'Cruce (#)',
                            hintText: 'Ej. 11',
                            labelStyle: const TextStyle(fontSize: 12, color: Color(0xFF4A3E39)),
                            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(10),
                              borderSide: const BorderSide(color: Color(0xFFEFE8DE)),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      const Text('-', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFFC5A052))),
                      const SizedBox(width: 8),
                      Expanded(
                        child: TextField(
                          controller: _plateNumCtrl,
                          onChanged: (_) => _syncComposedAddress(),
                          decoration: InputDecoration(
                            filled: true,
                            fillColor: const Color(0xFFFAF6EE),
                            labelText: 'Placa (-)',
                            hintText: 'Ej. 45',
                            labelStyle: const TextStyle(fontSize: 12, color: Color(0xFF4A3E39)),
                            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(10),
                              borderSide: const BorderSide(color: Color(0xFFEFE8DE)),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  // FILA 3: Complemento
                  TextField(
                    controller: _complementCtrl,
                    onChanged: (_) => _syncComposedAddress(),
                    decoration: InputDecoration(
                      filled: true,
                      fillColor: const Color(0xFFFAF6EE),
                      labelText: 'Complemento (Opcional)',
                      hintText: 'Ej. Local 102, Piso 2, Centro Comercial Unicentro',
                      labelStyle: const TextStyle(fontSize: 12, color: Color(0xFF4A3E39)),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: const BorderSide(color: Color(0xFFEFE8DE)),
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  // PREVIEW DE DIRECCIÓN ARMADA
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFAF6EE),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: Color(0xFFC5A052).withValues(alpha: 0.4)),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.pin_drop_rounded, size: 16, color: Color(0xFFC5A052)),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _salonAddressCtrl.text.isNotEmpty
                                ? _salonAddressCtrl.text
                                : 'Completa los campos para componer la dirección',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: _salonAddressCtrl.text.isNotEmpty
                                  ? const Color(0xFF1F1A15)
                                  : const Color(0xFF8C7E74),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: _isGeocodingAddress || _salonAddressCtrl.text.trim().isEmpty
                          ? null
                          : _geocodeAddressAndFixOnMap,
                      icon: _isGeocodingAddress
                          ? const SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF1F1A15)),
                            )
                          : const Icon(Icons.location_searching_rounded, size: 16),
                      label: Text(
                        _isGeocodingAddress ? 'Fijando en mapa...' : 'Fijar Dirección en el Mapa',
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFFAF6EE),
                        foregroundColor: const Color(0xFF1F1A15),
                        elevation: 0,
                        side: const BorderSide(color: Color(0xFFC5A052), width: 1.2),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        padding: const EdgeInsets.symmetric(vertical: 10),
                      ),
                    ),
                  ),
                ] else ...[
                  TextField(
                    controller: _salonAddressCtrl,
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(
                      filled: true,
                      fillColor: const Color(0xFFFAF6EE),
                      labelText: 'Dirección Completa (Texto Libre)',
                      hintText: 'Ej. Km 5 Vía Cajicá - Chía Vereda Fonquetá',
                      labelStyle: const TextStyle(fontSize: 12, color: Color(0xFF4A3E39)),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: const BorderSide(color: Color(0xFFEFE8DE)),
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: _isGeocodingAddress || _salonAddressCtrl.text.trim().isEmpty
                          ? null
                          : _geocodeAddressAndFixOnMap,
                      icon: _isGeocodingAddress
                          ? const SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF1F1A15)),
                            )
                          : const Icon(Icons.location_searching_rounded, size: 16),
                      label: Text(
                        _isGeocodingAddress ? 'Fijando en mapa...' : 'Fijar Dirección en el Mapa',
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFFAF6EE),
                        foregroundColor: const Color(0xFF1F1A15),
                        elevation: 0,
                        side: const BorderSide(color: Color(0xFFC5A052), width: 1.2),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        padding: const EdgeInsets.symmetric(vertical: 10),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 14),

          // SECCIÓN DE MAPA INTERACTIVO Y CONFIRMACIÓN DE UBICACIÓN FÍSICA
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: _salonLocationConfirmed ? const Color(0xFFC5A052) : const Color(0xFFEFE8DE),
                width: _salonLocationConfirmed ? 1.5 : 1,
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.04),
                  blurRadius: 10,
                  offset: const Offset(0, 3),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        Icon(
                          Icons.map_rounded,
                          color: _salonLocationConfirmed ? const Color(0xFFC5A052) : const Color(0xFF4A3E39),
                          size: 20,
                        ),
                        const SizedBox(width: 8),
                        const Text(
                          'Ubicación Física en Mapa',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF1F1A15),
                          ),
                        ),
                      ],
                    ),
                    TextButton.icon(
                      onPressed: _isLocatingSalon
                          ? null
                          : () async {
                              setState(() => _isLocatingSalon = true);
                              try {
                                LocationPermission permission = await Geolocator.checkPermission();
                                if (permission == LocationPermission.denied) {
                                  // FIX-FLUTTER-02: rationale en UI antes del prompt del SO.
                                  if (!mounted) return;
                                  final accepted = await PermissionRationaleService
                                      .showRationaleDialog(context, Permission.location);
                                  if (accepted) {
                                    permission = await Geolocator.requestPermission();
                                  }
                                }
                                if (permission == LocationPermission.whileInUse ||
                                    permission == LocationPermission.always) {
                                  final pos = await Geolocator.getCurrentPosition();
                                  final newLoc = LatLng(pos.latitude, pos.longitude);
                                  setState(() {
                                    _salonLocation = newLoc;
                                    _salonLocationConfirmed = true;
                                  });
                                  _salonMapController.move(newLoc, 15.5);
                                }
                              } catch (_) {}
                              if (mounted) setState(() => _isLocatingSalon = false);
                            },
                      icon: _isLocatingSalon
                          ? const SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFFC5A052)),
                            )
                          : const Icon(Icons.my_location, size: 16, color: Color(0xFFC5A052)),
                      label: const Text(
                        'Usar mi GPS',
                        style: TextStyle(fontSize: 12, color: Color(0xFFC5A052), fontWeight: FontWeight.bold),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                const Text(
                  'Toca o arrastra en el mapa para ubicar la sede de tu salón. Los clientes te encontrarán en Home con este punto.',
                  style: TextStyle(fontSize: 12, color: Color(0xFF8C7E74)),
                ),
                const SizedBox(height: 10),
                ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: SizedBox(
                    height: 180,
                    child: Stack(
                      children: [
                        FlutterMap(
                          mapController: _salonMapController,
                          options: MapOptions(
                            initialCenter: _salonLocation,
                            initialZoom: 14.5,
                            onTap: (tapPosition, point) {
                              setState(() {
                                _salonLocation = point;
                                _salonLocationConfirmed = true;
                              });
                            },
                          ),
                          children: [
                            TileLayer(
                              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                              userAgentPackageName: 'com.glowapp.beauty_app',
                            ),
                            MarkerLayer(
                              markers: [
                                Marker(
                                  point: _salonLocation,
                                  width: 46,
                                  height: 46,
                                  child: Container(
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFC5A052),
                                      shape: BoxShape.circle,
                                      border: Border.all(color: Colors.white, width: 2.5),
                                      boxShadow: [
                                        BoxShadow(
                                          color: Colors.black.withValues(alpha: 0.35),
                                          blurRadius: 8,
                                          offset: const Offset(0, 3),
                                        ),
                                      ],
                                    ),
                                    child: const Icon(
                                      Icons.storefront_rounded,
                                      color: Colors.white,
                                      size: 24,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                        Positioned(
                          bottom: 8,
                          left: 8,
                          right: 8,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                            decoration: BoxDecoration(
                              color: Colors.black.withValues(alpha: 0.75),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Row(
                              children: [
                                Icon(
                                  _salonLocationConfirmed ? Icons.check_circle : Icons.touch_app,
                                  color: _salonLocationConfirmed ? const Color(0xFFC5A052) : Colors.white,
                                  size: 15,
                                ),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: Text(
                                    _salonLocationConfirmed
                                        ? 'Ubicación confirmada: ${_salonLocation.latitude.toStringAsFixed(4)}, ${_salonLocation.longitude.toStringAsFixed(4)}'
                                        : 'Toca el mapa para fijar el marcador exacto',
                                    style: const TextStyle(color: Colors.white, fontSize: 11),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                SwitchListTile.adaptive(
                  value: _salonLocationPublic,
                  onChanged: (val) {
                    setState(() => _salonLocationPublic = val);
                  },
                  activeTrackColor: const Color(0xFFC5A052),
                  contentPadding: EdgeInsets.zero,
                  title: const Text(
                    'Publicar ubicación en el Mapa de GlowApp',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF1F1A15)),
                  ),
                  subtitle: const Text(
                    'Permite que nuevos clientes vean tu salón y reserven citas directas desde Home.',
                    style: TextStyle(fontSize: 11, color: Color(0xFF8C7E74)),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _salonPhoneCtrl,
            keyboardType: TextInputType.phone,
            decoration: InputDecoration(
              filled: true,
              fillColor: Colors.white,
              labelText: 'Teléfono de Contacto',
              labelStyle: const TextStyle(color: Color(0xFF4A3E39)),
              hintText: 'Ej. +573009998877',
              prefixIcon: const Icon(Icons.phone_outlined, color: Color(0xFFC5A052)),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: Color(0xFFEFE8DE)),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: Color(0xFFEFE8DE)),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: Color(0xFFC5A052), width: 1.5),
              ),
            ),
          ),
          const SizedBox(height: 18),
          CheckboxListTile(
            value: _habeasDataAccepted,
            onChanged: (val) => setState(() => _habeasDataAccepted = val ?? false),
            title: const Text(
              'Acepto la Política de Tratamiento de Datos Personales (Habeas Data - Ley 1581 de 2012).',
              style: TextStyle(fontSize: 12, color: Color(0xFF1F1A15), fontWeight: FontWeight.w500),
            ),
            activeColor: const Color(0xFFC5A052),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
          ),
          CheckboxListTile(
            value: _terminosAccepted,
            onChanged: (val) => setState(() => _terminosAccepted = val ?? false),
            title: const Text(
              'Acepto los Términos y Condiciones de Licencia SaaS de la plataforma GlowApp.',
              style: TextStyle(fontSize: 12, color: Color(0xFF1F1A15), fontWeight: FontWeight.w500),
            ),
            activeColor: const Color(0xFFC5A052),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
          ),
          const SizedBox(height: 20),
          Container(
            width: double.infinity,
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
                  color: Color(0xFFC5A052).withValues(alpha: 0.35),
                  blurRadius: 14,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: ElevatedButton(
              onPressed: _isLoading ? null : _submitSalonOnboarding,
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.transparent,
                shadowColor: Colors.transparent,
                foregroundColor: const Color(0xFF1F1A15),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                elevation: 0,
              ),
              child: _isLoading
                  ? Row(
                      mainAxisSize: MainAxisSize.min,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(color: Color(0xFF1F1A15), strokeWidth: 2.5),
                        ),
                        const SizedBox(width: 10),
                        Text(
                          _isCreatingSaasProfile ? 'PROVISIONANDO CUENTA…' : 'CREANDO SALÓN…',
                          style: const TextStyle(
                            fontFamily: 'Inter',
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: Color(0xFF1F1A15),
                          ),
                        ),
                      ],
                    )
                  : const Text(
                      'CREAR MI SALÓN DE BELLEZA (SaaS)',
                      style: TextStyle(
                        fontFamily: 'Inter',
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF1F1A15),
                        letterSpacing: 0.8,
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildProviderForm() {
    final bool atLeastOneDocUploaded =
        _documentoUrl != null || _rutUrl != null || _certificacionUrl != null;
    final bool isSubmitEnabled = _habeasDataAccepted && _terminosAccepted && atLeastOneDocUploaded;

    return Container(
      margin: const EdgeInsets.only(top: 16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Color(0xFFFAF8F5).withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFC5A052), width: 1.2),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.25),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _buildProgressStepper(),
          const SizedBox(height: 18),
          _buildTestimonialCard(),
          const SizedBox(height: 18),
          const Text(
            'Completa tu perfil profesional',
            style: TextStyle(
              fontFamily: 'CormorantGaramond',
              fontSize: 20,
              fontWeight: FontWeight.bold,
              color: Color(0xFF1F1A15),
            ),
          ),
          const SizedBox(height: 10),
          const Row(
            children: [
              Icon(Icons.access_time, color: Color(0xFFC5A052), size: 20),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Tú decides tu horario: trabaja cuando quieras y donde quieras.',
                  style: TextStyle(fontSize: 13, color: Color(0xFF1F1A15)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          const Row(
            children: [
              Icon(Icons.account_balance_wallet, color: Color(0xFFC5A052), size: 20),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Pago 100% seguro: depósito en garantía antes de iniciar cada servicio.',
                  style: TextStyle(fontSize: 13, color: Color(0xFF1F1A15)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          const Row(
            children: [
              Icon(Icons.trending_up, color: Color(0xFFC5A052), size: 20),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Clientes sin esfuerzo: nosotros nos encargamos de la publicidad y tracción.',
                  style: TextStyle(fontSize: 13, color: Color(0xFF1F1A15)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          const Text(
            'La ley colombiana nos pide verificar tu formación profesional — ¡es por tu seguridad y la de tus clientes!',
            style: TextStyle(fontSize: 11, color: Color(0xFF5C4E48), height: 1.3),
          ),
          const SizedBox(height: 18),

          // Carga de Cédula
          _buildDocumentUploadTile(
            title: 'Cédula de Ciudadanía / ID',
            subtitle: 'Documento de identidad nacional',
            isUploaded: _documentoUrl != null,
            isUploading: _uploadingDoc,
            onTap: () => _pickAndUploadDocument('doc'),
          ),
          const SizedBox(height: 12),

          // Carga de RUT
          _buildDocumentUploadTile(
            title: 'Registro Único Tributario (RUT)',
            subtitle: 'Opcional · Requerido para liquidaciones financieras',
            isUploaded: _rutUrl != null,
            isUploading: _uploadingRut,
            onTap: () => _pickAndUploadDocument('rut'),
          ),
          const SizedBox(height: 12),

          // Carga de Certificado de Bioseguridad
          _buildDocumentUploadTile(
            title: 'Certificado Profesional / Bioseguridad',
            subtitle: 'Opcional · Cumplimiento Ley 711 de 2001',
            isUploaded: _certificacionUrl != null,
            isUploading: _uploadingCert,
            onTap: () => _pickAndUploadDocument('cert'),
          ),
          const SizedBox(height: 20),

          // Carta informativa de comisiones (Transparencia Financiera)
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFFFFFDFB),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFEFE8DE)),
            ),
            child: const Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.info_outline, color: Color(0xFFC5A052), size: 24),
                SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Transparencia Financiera',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF1F1A15),
                        ),
                      ),
                      SizedBox(height: 4),
                      Text(
                        'GlowApp invierte en publicidad para traerte clientes, cubre el procesamiento seguro de pagos con Wompi, provee soporte 24/7 y gestiona el reporte de impuestos estatales. A cambio, retenemos una comisión fija del 20% sobre servicios exitosos. ¡Si tú no ganas, nosotros tampoco!',
                        style: TextStyle(
                          fontSize: 12, color: Color(0xFF4A3E39), height: 1.3),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),

          // Checkbox Habeas Data
          CheckboxListTile(
            value: _habeasDataAccepted,
            onChanged: (val) => setState(() => _habeasDataAccepted = val ?? false),
            title: const Text(
              'Acepto la política de protección de datos (Habeas Data - Ley 1581 de 2012) de la aplicación Belleza App.',
              style: TextStyle(fontSize: 12, color: Color(0xFF1F1A15), fontWeight: FontWeight.w500),
            ),
            activeColor: const Color(0xFFC5A052),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
          ),
          CheckboxListTile(
            value: _terminosAccepted,
            onChanged: (val) => setState(() => _terminosAccepted = val ?? false),
            title: const Text(
              'Acepto los Términos y Condiciones y el Contrato de Prestación de Servicios de GlowApp.',
              style: TextStyle(fontSize: 12, color: Color(0xFF1F1A15), fontWeight: FontWeight.w500),
            ),
            activeColor: const Color(0xFFC5A052),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
          ),
          const Padding(
            padding: EdgeInsets.only(left: 16, top: 4),
            child: Text(
              'Sin contratos de permanencia. Puedes pausar o eliminar tu cuenta en cualquier momento.',
              style: TextStyle(fontSize: 11, color: Color(0xFF5C4E48), height: 1.3),
            ),
          ),
          const SizedBox(height: 24),

          Container(
            width: double.infinity,
            height: 50,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              gradient: isSubmitEnabled
                  ? const LinearGradient(
                      colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    )
                  : null,
              color: isSubmitEnabled ? null : Colors.grey.shade300,
              boxShadow: isSubmitEnabled
                  ? [
                      BoxShadow(
                        color: Color(0xFFC5A052).withValues(alpha: 0.35),
                        blurRadius: 12,
                        offset: const Offset(0, 4),
                      ),
                    ]
                  : null,
            ),
            child: ElevatedButton(
              onPressed: (_isLoading || !isSubmitEnabled) ? null : _submitOnboarding,
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.transparent,
                shadowColor: Colors.transparent,
                foregroundColor: const Color(0xFF1F1A15),
                disabledBackgroundColor: Colors.transparent,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                elevation: 0,
              ),
              child: _isLoading
                  ? const SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(color: Color(0xFF1F1A15), strokeWidth: 2.5),
                    )
                  : const Text(
                      'ENVIAR PARA VERIFICACIÓN',
                      style: TextStyle(
                        fontFamily: 'Inter',
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF1F1A15),
                        letterSpacing: 0.8,
                      ),
                    ),
            ),
          ),
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text(
              'Serás redirigido a tu panel de seguimiento',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 10, color: Color(0xFF5C4E48)),
            ),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 8, horizontal: 16),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.schedule, size: 14, color: Color(0xFF8C7E74)),
                SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Nuestro equipo validará tus documentos en menos de 24 horas hábiles. Te notificaremos por la app apenas tu cuenta esté activa.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 11, color: Color(0xFF5C4E48), height: 1.3),
                  ),
                ),
              ],
            ),
          ),
          const Padding(
            padding: EdgeInsets.only(top: 4, left: 16, right: 16),
            child: Text(
              'Si necesitamos ajustes en tus documentos, te informaremos con instrucciones claras para resubir.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 10, color: Color(0xFF5C4E48)),
            ),
          ),
          const SizedBox(height: 14),
          OutlinedButton(
            onPressed: _isLoading ? null : _saveDraft,
            style: OutlinedButton.styleFrom(
              foregroundColor: const Color(0xFF8C5D00),
              side: const BorderSide(color: Color(0xFFC5A052), width: 1.2),
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              elevation: 0,
              minimumSize: const Size(double.infinity, 48),
            ),
            child: const Text(
              'Guardar borrador y completar más tarde',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildProgressStepper() {
    final int currentStep = _isLoading
        ? 3
        : (_documentoUrl != null || _rutUrl != null || _certificacionUrl != null) ? 2 : 1;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Row(
        children: [
          _buildStepCircle('✓', 'Elige rol', true),
          Expanded(
            child: Container(
              height: 2,
              color: const Color(0xFFC5A052),
            ),
          ),
          _buildStepCircle('2', 'Documentos', currentStep >= 2),
          Expanded(
            child: Container(
              height: 2,
              color: currentStep >= 3
                  ? const Color(0xFFC5A052)
                  : const Color(0xFFEFE8DE),
            ),
          ),
          _buildStepCircle('3', '¡Listo!', currentStep >= 3),
        ],
      ),
    );
  }

  Widget _buildStepCircle(String label, String text, bool isCompleted) {
    return Column(
      children: [
        Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: isCompleted ? const Color(0xFFC5A052) : Colors.white,
            border: Border.all(
              color: isCompleted
                  ? const Color(0xFFC5A052)
                  : const Color(0xFFEFE8DE),
              width: 2,
            ),
          ),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.bold,
                color: isCompleted ? Colors.white : const Color(0xFF8C7E74),
              ),
            ),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          text,
          style: TextStyle(
            fontSize: 10,
            color: isCompleted ? const Color(0xFF1F1A15) : const Color(0xFF8C7E74),
            fontWeight: isCompleted ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ],
    );
  }

  Widget _buildTestimonialCard() {
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFFFFFDFB),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0xFFEFE8DE)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.04),
                blurRadius: 8,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const CircleAvatar(
                    backgroundColor: Color(0xFFC5A052),
                    radius: 20,
                    child: Text(
                      'VP',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Valentina P.',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF1F1A15),
                          ),
                        ),
                        Text(
                          'Estilista en Bogotá',
                          style: TextStyle(
                            fontSize: 12,
                            color: Color(0xFF8C7E74),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Row(
                    children: List.generate(
                      5,
                      (index) => const Icon(
                        Icons.star,
                        color: Color(0xFFC5A052),
                        size: 16,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              const Text(
                '"Desde que me registré en GlowApp, organicé mis horarios y mis ingresos crecieron un 40% en el primer mes. Los pagos son puntuales cada semana y el soporte siempre responde rápido. ¡Es como tener mi propio salón sin pagar arriendo!"',
                style: TextStyle(
                  fontSize: 13,
                  fontStyle: FontStyle.italic,
                  color: Color(0xFF1F1A15),
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'Resultado basado en prestadoras activas durante la fase de prueba.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 10, color: Color(0xFF5C4E48)),
        ),
        const SizedBox(height: 14),
        const Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            Row(
              children: [
                Icon(Icons.lock_outline, size: 14, color: Colors.green),
                SizedBox(width: 4),
                Text(
                  'Datos protegidos (Ley 1581)',
                  style: TextStyle(fontSize: 11, color: Color(0xFF4A3E39)),
                ),
              ],
            ),
            Row(
              children: [
                Icon(Icons.credit_card_outlined, size: 14, color: Colors.blue),
                SizedBox(width: 4),
                Text(
                  'Pagos seguros vía Wompi',
                  style: TextStyle(fontSize: 11, color: Color(0xFF4A3E39)),
                ),
              ],
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildDocumentUploadTile({
    required String title,
    required String subtitle,
    required bool isUploaded,
    required bool isUploading,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: isUploading ? null : onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isUploaded ? const Color(0xFFC5A052) : const Color(0xFFEFE8DE),
            width: 1.5,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.03),
              blurRadius: 6,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          children: [
            Icon(
              isUploaded
                  ? Icons.check_circle_outline
                  : Icons.cloud_upload_outlined,
              color: isUploaded ? Colors.green : const Color(0xFFC5A052),
              size: 28,
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF1F1A15)),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: const TextStyle(fontSize: 11, color: Color(0xFF5C4E48)),
                  ),
                ],
              ),
            ),
            if (isUploading)
              const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                    color: Color(0xFFC5A052), strokeWidth: 2),
              )
            else if (isUploaded)
              const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.check_circle, color: Colors.green, size: 16),
                  SizedBox(width: 4),
                  Text('Cargado',
                      style: TextStyle(
                          color: Colors.green,
                          fontSize: 12,
                          fontWeight: FontWeight.bold)),
                ],
              )
            else
              const Icon(Icons.arrow_forward_ios, size: 14, color: Color(0xFF8C7E74)),
          ],
        ),
      ),
    );
  }
}

class _RoleCard extends StatelessWidget {
  final String title, subtitle;
  final IconData icon;
  final bool isSelected;
  final VoidCallback onTap;

  const _RoleCard({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(30),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
        decoration: BoxDecoration(
          color: isSelected
              ? const Color(0xFFFAF6EE)
              : Colors.white.withValues(alpha: 0.94),
          borderRadius: BorderRadius.circular(30),
          border: Border.all(
            color: isSelected ? const Color(0xFFC5A052) : const Color(0xFFEFE8DE),
            width: isSelected ? 1.5 : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: isSelected
                  ? Color(0xFFC5A052).withValues(alpha: 0.22)
                  : Colors.black.withValues(alpha: 0.05),
              blurRadius: isSelected ? 12 : 6,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: isSelected ? Colors.white : const Color(0xFFFAF6EE),
                shape: BoxShape.circle,
                border: Border.all(
                  color: isSelected
                      ? const Color(0xFFC5A052)
                      : const Color(0xFFEFE8DE),
                  width: 1,
                ),
              ),
              alignment: Alignment.center,
              child: Icon(
                icon,
                size: 18,
                color: isSelected ? const Color(0xFFC5A052) : const Color(0xFF8C7E74),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: RichText(
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                text: TextSpan(
                  children: [
                    TextSpan(
                      text: '$title ',
                      style: TextStyle(
                        fontFamily: 'CormorantGaramond',
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                        color: isSelected ? const Color(0xFF1F1A15) : const Color(0xFF4A3E39),
                      ),
                    ),
                    TextSpan(
                      text: '•  $subtitle',
                      style: TextStyle(
                        fontFamily: 'Inter',
                        fontSize: 12,
                        color: isSelected ? const Color(0xFF1F1A15) : const Color(0xFF8C7E74),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(width: 6),
            Icon(
              isSelected ? Icons.check_circle_rounded : Icons.arrow_forward_ios_rounded,
              size: isSelected ? 20 : 14,
              color: isSelected ? const Color(0xFFC5A052) : const Color(0xFF8C7E74),
            ),
          ],
        ),
      ),
    );
  }
}
