// lib/screens/profile/settings_screen.dart
import 'package:glow_core/glow_core.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter/material.dart';
class SettingsScreen extends StatefulWidget {
  final String userEmail;
  final VoidCallback? onLogout;

  const SettingsScreen({
    super.key,
    required this.userEmail,
    this.onLogout,
  });

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _biometricAuthEnabled = true;
  bool _pushNotifications = true;
  bool _marketingEmails = false;
  bool _anonymizedAnalytics = true;
  bool _isLoadingPreferences = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadPreferences();
  }

  Future<void> _loadPreferences() async {
    setState(() {
      _isLoadingPreferences = true;
      _errorMessage = null;
    });
    try {
      final headers = await ApiService.getAuthHeaders();
      final uri = Uri.parse('${ApiService.baseUrl}/api/users/preferences');
      final response = await http.get(uri, headers: headers).timeout(const Duration(seconds: 10));
      
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final prefs = data['data'];
        if (prefs != null && mounted) {
          setState(() {
            _pushNotifications = prefs['push_enabled'] ?? true;
            _marketingEmails = prefs['marketing_enabled'] ?? false;
            _anonymizedAnalytics = prefs['telemetry_enabled'] ?? true;
            _isLoadingPreferences = false;
          });
          // Actualizar cache de AnalyticsService
          AnalyticsService().invalidateTelemetryCache();
        }
      } else {
        if (mounted) {
          setState(() {
            _errorMessage = 'Error al cargar preferencias: ${response.statusCode}';
            _isLoadingPreferences = false;
          });
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = 'Error de conexión: $e';
          _isLoadingPreferences = false;
        });
      }
    }
  }

  Future<void> _updatePreference(String key, bool value) async {
    // Optimistic update
    setState(() {
      switch (key) {
        case 'push_enabled':
          _pushNotifications = value;
          break;
        case 'marketing_enabled':
          _marketingEmails = value;
          break;
        case 'telemetry_enabled':
          _anonymizedAnalytics = value;
          break;
      }
    });

    try {
      final headers = await ApiService.getAuthHeaders();
      final uri = Uri.parse('${ApiService.baseUrl}/api/users/preferences');
      final response = await http.patch(
        uri,
        headers: headers,
        body: json.encode({key: value}),
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode != 200) {
        // Revert on error
        if (mounted) {
          setState(() {
            switch (key) {
              case 'push_enabled':
                _pushNotifications = !value;
                break;
              case 'marketing_enabled':
                _marketingEmails = !value;
                break;
              case 'telemetry_enabled':
                _anonymizedAnalytics = !value;
                break;
            }
          });
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Error al guardar preferencia: ${response.statusCode}'),
              backgroundColor: const Color(0xFFB00020),
            ),
          );
        }
      } else {
        if (key == 'telemetry_enabled') {
          AnalyticsService().invalidateTelemetryCache();
        }
      }
    } catch (e) {
      // Revert on error
      if (mounted) {
        setState(() {
          switch (key) {
            case 'push_enabled':
              _pushNotifications = !value;
              break;
            case 'marketing_enabled':
              _marketingEmails = !value;
              break;
            case 'telemetry_enabled':
              _anonymizedAnalytics = !value;
              break;
          }
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error de conexión: $e'),
            backgroundColor: const Color(0xFFB00020),
          ),
        );
      }
    }
  }

  // DIÁLOGO DE CAMBIO DE CONTRASEÑA
  void _showChangePasswordDialog(BuildContext context) {
    final currentPasswordController = TextEditingController();
    final newPasswordController = TextEditingController();
    final confirmPasswordController = TextEditingController();
    bool obscureCurrent = true;
    bool obscureNew = true;
    bool obscureConfirm = true;
    bool isLoading = false;

    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          backgroundColor: LuxeColors.nude100,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(LuxeSpacing.md),
            side: const BorderSide(color: LuxeColors.nude200),
          ),
          title: const Text(
            'CAMBIAR CONTRASEÑA',
            style: TextStyle(
              fontFamily: 'Didot',
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: LuxeColors.nude900,
              letterSpacing: 1.0,
            ),
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: currentPasswordController,
                  obscureText: obscureCurrent,
                  decoration: InputDecoration(
                    labelText: 'Contraseña Actual',
                    labelStyle: const TextStyle(fontSize: 13, color: LuxeColors.nude600),
                    suffixIcon: IconButton(
                      icon: Icon(obscureCurrent ? Icons.visibility_off : Icons.visibility, size: 18),
                      onPressed: () => setDialogState(() => obscureCurrent = !obscureCurrent),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: newPasswordController,
                  obscureText: obscureNew,
                  decoration: InputDecoration(
                    labelText: 'Nueva Contraseña',
                    labelStyle: const TextStyle(fontSize: 13, color: LuxeColors.nude600),
                    suffixIcon: IconButton(
                      icon: Icon(obscureNew ? Icons.visibility_off : Icons.visibility, size: 18),
                      onPressed: () => setDialogState(() => obscureNew = !obscureNew),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: confirmPasswordController,
                  obscureText: obscureConfirm,
                  decoration: InputDecoration(
                    labelText: 'Confirmar Nueva Contraseña',
                    labelStyle: const TextStyle(fontSize: 13, color: LuxeColors.nude600),
                    suffixIcon: IconButton(
                      icon: Icon(obscureConfirm ? Icons.visibility_off : Icons.visibility, size: 18),
                      onPressed: () => setDialogState(() => obscureConfirm = !obscureConfirm),
                    ),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: isLoading ? null : () => Navigator.pop(context),
              child: const Text('Cancelar', style: TextStyle(color: LuxeColors.nude700)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: LuxeColors.nude900,
                foregroundColor: Colors.white,
              ),
              onPressed: isLoading ? null : () async {
                if (newPasswordController.text.isEmpty ||
                    newPasswordController.text != confirmPasswordController.text) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Las contraseñas no coinciden o están vacías.'),
                      backgroundColor: Color(0xFFB00020),
                    ),
                  );
                  return;
                }
                if (currentPasswordController.text.isEmpty) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Debes ingresar tu contraseña actual.'),
                      backgroundColor: Color(0xFFB00020),
                    ),
                  );
                  return;
                }
                setDialogState(() => isLoading = true);
                
                try {
                  final headers = await ApiService.getAuthHeaders();
                  final uri = Uri.parse('${ApiService.baseUrl}/api/auth/change-password');
                  final response = await http.patch(
                    uri,
                    headers: headers,
                    body: json.encode({
                      'current_password': currentPasswordController.text,
                      'new_password': newPasswordController.text,
                    }),
                  ).timeout(const Duration(seconds: 15));

                  if (mounted) {
                    setDialogState(() => isLoading = false);
                    
                    if (response.statusCode == 200) {
                      Navigator.pop(context);
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Contraseña actualizada con éxito.'),
                          backgroundColor: LuxeColors.nude900,
                        ),
                      );
                    } else {
                      final data = json.decode(response.body);
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(data['error'] ?? 'Error al cambiar contraseña'),
                          backgroundColor: const Color(0xFFB00020),
                        ),
                      );
                    }
                  }
                } catch (e) {
                  if (mounted) {
                    setDialogState(() => isLoading = false);
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text('Error de conexión: $e'),
                        backgroundColor: const Color(0xFFB00020),
                      ),
                    );
                  }
                }
              },
              child: isLoading
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Actualizar'),
            ),
          ],
        ),
      ),
    );
  }

  // SOLICITAR SUPRESIÓN DE DATOS (ARCO)
  void _requestDataDeletion(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: LuxeColors.nude100,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(LuxeSpacing.md),
          side: const BorderSide(color: LuxeColors.nude200),
        ),
        title: const Text(
          'Eliminar Cuenta Concierge',
          style: TextStyle(
            fontFamily: 'Didot',
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: LuxeColors.nude900,
          ),
        ),
        content: const Text(
          'Esta acción creará una solicitud formal de supresión de datos (ARCO) según Ley 1581/2012. '
          'Tu solicitud será revisada por nuestro equipo y recibirás una confirmación con el número de ticket. '
          'La eliminación se ejecutará tras verificación de identidad.',
          style: LuxeTypography.bodyMd,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar', style: TextStyle(color: LuxeColors.nude900)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text(
              'Confirmar Solicitud ARCO',
              style: TextStyle(
                fontFamily: 'CormorantGaramond',
                color: Color(0xFFB00020),
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Enviando solicitud ARCO...'),
          backgroundColor: LuxeColors.nude900,
          duration: Duration(seconds: 2),
        ),
      );
    }

    try {
      final headers = await ApiService.getAuthHeaders();
      final uri = Uri.parse('${ApiService.baseUrl}/api/tickets');
      final response = await http.post(
        uri,
        headers: headers,
        body: json.encode({
          'tipo': 'ARCO_SUPRESION',
          'categoria': 'seguridad',
          'asunto': 'Solicitud de Supresión de Datos (ARCO) - Ley 1581/2012',
          'descripcion': 'El usuario solicita la supresión total de sus datos personales y biométricos '
              'conforme al Artículo 15 de la Ley Estatutaria 1581 de 2012. '
              'Se requiere revisión y ejecución manual por parte del equipo de privacidad.',
        }),
      ).timeout(const Duration(seconds: 15));

      if (mounted) {
        if (response.statusCode == 201 || response.statusCode == 200) {
          final data = json.decode(response.body);
          final ticketId = data['data']?['id'] ?? 'N/A';
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Solicitud ARCO registrada. Ticket: $ticketId. Recibirás confirmación por email.'),
              backgroundColor: LuxeColors.nude900,
              duration: const Duration(seconds: 8),
            ),
          );
        } else {
          final data = json.decode(response.body);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Error al crear solicitud: ${data['error'] ?? response.statusCode}'),
              backgroundColor: const Color(0xFFB00020),
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error de conexión: $e'),
            backgroundColor: const Color(0xFFB00020),
          ),
        );
      }
    }
  }

  // MODAL TÉRMINOS DE SERVICIO
  void _showTermsOfServiceModal(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: LuxeColors.nude50,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.75,
        maxChildSize: 0.9,
        minChildSize: 0.5,
        expand: false,
        builder: (context, scrollController) => Container(
          padding: const EdgeInsets.all(LuxeSpacing.xl),
          child: ListView(
            controller: scrollController,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: LuxeColors.nude300,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'TÉRMINOS DE SERVICIO CONCIERGE',
                style: TextStyle(
                  fontFamily: 'Didot',
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: LuxeColors.nude900,
                  letterSpacing: 1.2,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              const Text(
                '1. ACEPTACIÓN DE CONDICIONES\n'
                'Al acceder a la plataforma GlowApp Belleza Luxe y hacer uso de los servicios Concierge, el usuario acepta de forma incondicional los presentes términos de servicio.\n\n'
                '2. SERVICIOS BIOMÉTRICOS & IA\n'
                'El algoritmo de análisis facial Aura AI ofrece sugerencias de cuidado estético. Dichos análisis no constituyen un diagnóstico médico dermatológico oficial.\n\n'
                '3. POLÍTICA DE RESERVAS Y CANCELACIONES\n'
                'Las citas agendadas a través del Concierge pueden ser reprogramadas con hasta 4 horas de anticipación sin penalización.\n\n'
                '4. PROPIEDAD INTELECTUAL\n'
                'Todos los diseños, nombres, marcas y modelos de diagnóstico 3D son propiedad exclusiva del Club Glow Luxe.',
                style: TextStyle(
                  fontFamily: 'CormorantGaramond',
                  fontSize: 15,
                  color: LuxeColors.nude800,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: LuxeColors.nude900,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Entendido & Aceptar'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // MODAL POLÍTICA DE PRIVACIDAD LEY 1581
  void _showPrivacyPolicyModal(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: LuxeColors.nude50,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.75,
        maxChildSize: 0.9,
        minChildSize: 0.5,
        expand: false,
        builder: (context, scrollController) => Container(
          padding: const EdgeInsets.all(LuxeSpacing.xl),
          child: ListView(
            controller: scrollController,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: LuxeColors.nude300,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'POLÍTICA DE PRIVACIDAD LEY 1581 DE 2012',
                style: TextStyle(
                  fontFamily: 'Didot',
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: LuxeColors.nude900,
                  letterSpacing: 1.2,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              const Text(
                'TRATAMIENTO DE DATOS PERSONALES Y SENSIBLES\n'
                'GlowApp da estricto cumplimiento a la Ley Estatutaria 1581 de 2012 y al Decreto 1377 de 2013 sobre la protección de datos personales en Colombia.\n\n'
                '1. DATOS RECOPILADOS\n'
                'Recopilamos información de contacto y datos biométricos faciales necesarios para personalizar la experiencia de diagnóstico de belleza.\n\n'
                '2. FINALIDAD DE LA INFORMACIÓN\n'
                'Sus datos serán usados única y exclusivamente para la prestación de servicios estéticos, recomendaciones de productos en GlowStore y agendamiento de citas.\n\n'
                '3. DERECHOS ARCO\n'
                'Como titular, usted tiene derecho a Conocer, Actualizar, Rectificar y Solicitar la Supresión de sus datos personales en cualquier momento a través del panel de configuración de la app.',
                style: TextStyle(
                  fontFamily: 'CormorantGaramond',
                  fontSize: 15,
                  color: LuxeColors.nude800,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: LuxeColors.nude900,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Entendido'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: LuxeColors.nude50,
      appBar: AppBar(
        backgroundColor: LuxeColors.nude50,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, color: LuxeColors.nude900, size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text(
          'CONFIGURACIÓN & PRIVACIDAD',
          style: TextStyle(
            fontFamily: 'Didot',
            fontSize: 15,
            fontWeight: FontWeight.bold,
            color: LuxeColors.nude900,
            letterSpacing: 1.0,
          ),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: _isLoadingPreferences
            ? const Center(child: CircularProgressIndicator())
            : Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 680),
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(LuxeSpacing.xl),
                    child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (_errorMessage != null) ...[
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFB00020).withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: const Color(0xFFB00020)),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.warning_amber_rounded, color: Color(0xFFB00020)),
                            const SizedBox(width: 8),
                            Expanded(child: Text(_errorMessage!, style: const TextStyle(color: Color(0xFFB00020)))),
                            IconButton(
                              icon: const Icon(Icons.refresh, color: Color(0xFFB00020), size: 20),
                              onPressed: _loadPreferences,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: LuxeSpacing.xl),
                    ],
                    // SECCIÓN 1: SEGURIDAD DE SESIÓN
                    const Text(
                      'SEGURIDAD & AUTENTICACIÓN',
                      style: TextStyle(
                        fontFamily: 'JetBrainsMono',
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: LuxeColors.nude500,
                        letterSpacing: 1.2,
                      ),
                    ),
                    const SizedBox(height: 12),

                    LuxeProfileTile(
                      icon: Icons.fingerprint,
                      title: 'Autenticación Biométrica',
                      subtitle: 'Ingreso rápido con FaceID / Huella',
                      trailing: LuxeToggle(
                        value: _biometricAuthEnabled,
                        onChanged: (val) => setState(() => _biometricAuthEnabled = val),
                      ),
                    ),
                    LuxeProfileTile(
                      icon: Icons.lock_outline,
                      title: 'Cambiar Contraseña',
                      showDivider: false,
                      onTap: () => _showChangePasswordDialog(context),
                    ),

                    const SizedBox(height: LuxeSpacing.xxl),

                    // SECCIÓN 2: NOTIFICACIONES
                    const Text(
                      'COMUNICACIÓN CONCIERGE',
                      style: TextStyle(
                        fontFamily: 'JetBrainsMono',
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: LuxeColors.nude500,
                        letterSpacing: 1.2,
                      ),
                    ),
                    const SizedBox(height: 12),

                    LuxeProfileTile(
                      icon: Icons.notifications_none,
                      title: 'Notificaciones Push',
                      subtitle: 'Recordatorios de rutina de piel',
                      trailing: LuxeToggle(
                        value: _pushNotifications,
                        onChanged: (val) => _updatePreference('push_enabled', val),
                      ),
                    ),
                    LuxeProfileTile(
                      icon: Icons.mail_outline,
                      title: 'Novedades y Novedades Luxe',
                      subtitle: 'Boletín de lanzamientos de productos',
                      trailing: LuxeToggle(
                        value: _marketingEmails,
                        onChanged: (val) => _updatePreference('marketing_enabled', val),
                      ),
                      showDivider: false,
                    ),

                    const SizedBox(height: LuxeSpacing.xxl),

                    // SECCIÓN 3: PRIVACIDAD Y DATOS SENSIBLES
                    const Text(
                      'DATOS Y TELEMETRÍA',
                      style: TextStyle(
                        fontFamily: 'JetBrainsMono',
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: LuxeColors.nude500,
                        letterSpacing: 1.2,
                      ),
                    ),
                    const SizedBox(height: 12),

                    LuxeProfileTile(
                      icon: Icons.analytics_outlined,
                      title: 'Telemetría Anónima de Uso',
                      subtitle: 'Ayuda a mejorar los modelos de escaneo de Aura',
                      trailing: LuxeToggle(
                        value: _anonymizedAnalytics,
                        onChanged: (val) => _updatePreference('telemetry_enabled', val),
                      ),
                      showDivider: false,
                    ),

                    const SizedBox(height: LuxeSpacing.xxl),

                    // SECCIÓN 4: DIRECCIONES DE ENTREGA
                    const Text(
                      'DIRECCIONES DE ENTREGA',
                      style: TextStyle(
                        fontFamily: 'JetBrainsMono',
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: LuxeColors.nude500,
                        letterSpacing: 1.2,
                      ),
                    ),
                    const SizedBox(height: 12),

                    const DeliveryAddressesSection(),

                    const SizedBox(height: LuxeSpacing.xxl),

                    // ACCIÓN DESTRUCTIVA: ELIMINAR CUENTA (CON TIPOGRAFÍA SERIF ROJA SUTIL)
                    ListTile(
                      onTap: () => _requestDataDeletion(context),
                      leading: const Icon(Icons.delete_outline, color: Color(0xFFB00020)),
                      title: const Text(
                        'Solicitar Supresión de Datos (ARCO)',
                        style: TextStyle(
                          fontFamily: 'CormorantGaramond',
                          fontSize: 16,
                          color: Color(0xFFB00020),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),

                    const SizedBox(height: 32),

                    // INFORMACIÓN LEGAL Y VERSIÓN CON TEXTO NUDE400 Y ENLACES SUBRAYADOS
                    Center(
                      child: Column(
                        children: [
                          const Text(
                            'GlowApp Belleza Luxe • v2.4.0 (Build 2026)',
                            style: TextStyle(fontFamily: 'JetBrainsMono', fontSize: 11, color: LuxeColors.nude500),
                          ),
                          const SizedBox(height: 6),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              GestureDetector(
                                onTap: () => _showTermsOfServiceModal(context),
                                child: const Text(
                                  'Términos de Servicio',
                                  style: TextStyle(fontSize: 11, color: LuxeColors.nude500, decoration: TextDecoration.underline),
                                ),
                              ),
                              const Text(' • ', style: TextStyle(color: LuxeColors.nude500)),
                              GestureDetector(
                                onTap: () => _showPrivacyPolicyModal(context),
                                child: const Text(
                                  'Política de Privacidad Ley 1581',
                                  style: TextStyle(fontSize: 11, color: LuxeColors.nude500, decoration: TextDecoration.underline),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 32),
                  ],
                ),
              ),
            ),
          ),
      ),
    );
  }
}