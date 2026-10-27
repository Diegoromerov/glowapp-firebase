// lib/screens/profile/user_profile.dart
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:glow_core/widgets/profile/profile_header.dart';
import 'package:glow_core/widgets/profile/luxe_list_tile.dart';
import 'package:glow_core/widgets/profile/delivery_addresses_section.dart';
import 'package:glow_core/services/auth_service.dart';
import 'settings_screen.dart';
import 'biometric_history_screen.dart';
import 'glowstore_orders_screen.dart';
import 'rewards_xp_screen.dart';
import 'habeas_data_screen.dart';
import 'faq_screen.dart';
import 'package:glow_core/widgets/invitation_code_entry.dart';

class UserProfileScreen extends StatefulWidget {
  final String userName;
  final String userEmail;
  final VoidCallback? onLogout;

  const UserProfileScreen({
    super.key,
    this.userName = 'Valeria Gómez',
    this.userEmail = 'valeria.gomez@glowapp.com',
    this.onLogout,
  });

  @override
  State<UserProfileScreen> createState() => _UserProfileScreenState();
}

class _UserProfileScreenState extends State<UserProfileScreen> {
  late String _userName;
  late String _userEmail;

  @override
  void initState() {
    super.initState();
    _userName = widget.userName;
    _userEmail = widget.userEmail;
    _loadPersistedUserData();
  }

  Future<void> _loadPersistedUserData() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final name = prefs.getString('userName');
      final email = prefs.getString('userEmail');
      if (mounted) {
        setState(() {
          if (name != null && name.trim().isNotEmpty) _userName = name.trim();
          if (email != null && email.trim().isNotEmpty) _userEmail = email.trim();
        });
      }
    } catch (_) {}
  }
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
        backgroundColor: const Color(0xFFFAF8F5),
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: Padding(
          padding: const EdgeInsets.only(left: 14),
          child: Center(
            child: InkWell(
              onTap: () {
                HapticFeedback.lightImpact();
                Navigator.maybePop(context);
              },
              borderRadius: BorderRadius.circular(20),
              child: Container(
                width: 38,
                height: 38,
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
                child: const Icon(Icons.arrow_back_ios_new_rounded, size: 16, color: Color(0xFF1F1A15)),
              ),
            ),
          ),
        ),
        title: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.auto_awesome, size: 15, color: Color(0xFFC5A052)),
            SizedBox(width: 8),
            Text(
              'Mi Perfil Concierge',
              style: TextStyle(
                fontFamily: 'CormorantGaramond',
                fontSize: 21,
                fontWeight: FontWeight.bold,
                color: Color(0xFF1F1A15),
                letterSpacing: 0.8,
              ),
            ),
          ],
        ),
        centerTitle: true,
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Center(
              child: Container(
                width: 38,
                height: 38,
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
                child: const Icon(Icons.notifications_none_rounded, size: 18, color: Color(0xFF1F1A15)),
              ),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 680),
            child: SingleChildScrollView(
              physics: const BouncingScrollPhysics(),
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // HEADER DE PERFIL PREMIUM HAUTE JOAILLERIE
                  ProfileHeader(
                    userName: _userName,
                    userEmail: _userEmail,
                    membershipLevel: 'SOCIO CLUB GLOW LUXE',
                  ),

                  const SizedBox(height: 18),

                  // GRUPO 1: RITUAL BIOMÉTRICO Y COMPRAS
                  _buildSectionHeader('MI HISTORIAL Y COMPRAS'),
                  const SizedBox(height: 10),

                  Container(
                    margin: const EdgeInsets.symmetric(horizontal: 16),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: const Color(0xFFEFE8DE), width: 1),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withOpacity(0.025),
                          blurRadius: 14,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Column(
                      children: [
                        LuxeProfileTile(
                          icon: Icons.history_edu_outlined,
                          title: 'Historial de Diagnósticos Biométricos',
                          subtitle: 'Revisa tus escaneos faciales y análisis de piel',
                          onTap: () {
                            HapticFeedback.lightImpact();
                            Navigator.push(
                              context,
                              MaterialPageRoute(builder: (_) => const BiometricHistoryScreen()),
                            );
                          },
                        ),
                        LuxeProfileTile(
                          icon: Icons.shopping_bag_outlined,
                          title: 'Mis Pedidos GlowStore',
                          subtitle: 'Seguimiento de compras y envíos directos',
                          onTap: () {
                            HapticFeedback.lightImpact();
                            Navigator.push(
                              context,
                              MaterialPageRoute(builder: (_) => const GlowStoreOrdersScreen()),
                            );
                          },
                        ),
                        LuxeProfileTile(
                          icon: Icons.card_membership_outlined,
                          title: 'Beneficios y Puntos de Experiencia (XP)',
                          subtitle: '350 XP acumulados este mes',
                          showDivider: false,
                          onTap: () {
                            HapticFeedback.lightImpact();
                            Navigator.push(
                              context,
                              MaterialPageRoute(builder: (_) => const RewardsXpScreen()),
                            );
                          },
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 24),

                  // GRUPO 1.b: DIRECCIONES DE ENTREGA (estructura colombiana)
                  _buildSectionHeader('DIRECCIONES DE ENTREGA'),
                  const SizedBox(height: 10),

                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 16),
                    child: DeliveryAddressesSection(),
                  ),

                  const SizedBox(height: 24),

                  // GRUPO 2: PREFERENCIAS Y SEGURIDAD
                  _buildSectionHeader('PREFERENCIAS Y PRIVACIDAD'),
                  const SizedBox(height: 10),

                  Container(
                    margin: const EdgeInsets.symmetric(horizontal: 16),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: const Color(0xFFEFE8DE), width: 1),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withOpacity(0.025),
                          blurRadius: 14,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Column(
                      children: [
                        LuxeProfileTile(
                          icon: Icons.settings_outlined,
                          title: 'Configuración de la Cuenta',
                          subtitle: 'Notificaciones, datos personales y seguridad',
                          onTap: () {
                            HapticFeedback.lightImpact();
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => SettingsScreen(
                                  userEmail: _userEmail,
                                  onLogout: widget.onLogout,
                                ),
                              ),
                            );
                          },
                        ),
                        LuxeProfileTile(
                          icon: Icons.security_outlined,
                          title: 'Consentimiento Biométrico y Habeas Data',
                          subtitle: 'Gestión de datos sensibles (Ley 1581)',
                          onTap: () {
                            HapticFeedback.lightImpact();
                            Navigator.push(
                              context,
                              MaterialPageRoute(builder: (_) => const HabeasDataScreen()),
                            );
                          },
                        ),
                        LuxeProfileTile(
                          icon: Icons.headset_mic_outlined,
                          title: 'Centro de Soporte y PQRSF',
                          subtitle: 'Atención a peticiones, quejas y reclamos',
                          onTap: () {
                            HapticFeedback.lightImpact();
                            Navigator.pushNamed(context, '/support');
                          },
                        ),
                        LuxeProfileTile(
                          icon: Icons.group_add_outlined,
                          title: 'Unirme a un salón',
                          subtitle: 'Ingresar el código que te compartió el dueño',
                          onTap: () {
                            HapticFeedback.lightImpact();
                            pedirCodigoInvitacion(context);
                          },
                        ),
                        LuxeProfileTile(
                          icon: Icons.description_outlined,
                          title: 'Términos y condiciones',
                          subtitle: 'Contrato de uso, privacidad y tratamiento de datos',
                          onTap: () {
                            HapticFeedback.lightImpact();
                            Navigator.pushNamed(context, '/terms');
                          },
                        ),
                        LuxeProfileTile(
                          icon: Icons.help_outline_rounded,
                          title: 'Preguntas Frecuentes (FAQ)',
                          subtitle: 'Respuestas claras sobre pagos, seguridad y citas',
                          onTap: () {
                            HapticFeedback.lightImpact();
                            Navigator.push(
                              context,
                              MaterialPageRoute(builder: (_) => const FaqScreen()),
                            );
                          },
                        ),
                        LuxeProfileTile(
                          icon: Icons.auto_awesome_rounded,
                          title: 'Ver Guía Interactiva de Aura',
                          subtitle: 'Reiniciar el tour guiado de bienvenida de GlowApp',
                          onTap: () async {
                            HapticFeedback.lightImpact();
                            final prefs = await SharedPreferences.getInstance();
                            await prefs.remove('glowguide_completed_glow_welcome_v1');
                            await prefs.remove('seen_aura_tutorial');
                            if (context.mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text('✨ Guía de Aura reiniciada. Regresando al Home...'),
                                  backgroundColor: Color(0xFFC5A052),
                                ),
                              );
                              Navigator.of(context).pushNamedAndRemoveUntil('/home', (route) => false);
                            }
                          },
                        ),
                        LuxeProfileTile(
                          icon: Icons.gavel_outlined,
                          title: 'Mis Disputas de Servicio',
                          subtitle: 'Gestión y seguimiento de arbitrajes de pago',
                          showDivider: false,
                          onTap: () {
                            HapticFeedback.lightImpact();
                            Navigator.pushNamed(context, '/disputes');
                          },
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 28),

                  // BOTÓN CERRAR SESIÓN DE LUJO
                  Container(
                    margin: const EdgeInsets.symmetric(horizontal: 16),
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: () async {
                        HapticFeedback.mediumImpact();
                        if (widget.onLogout != null) {
                          widget.onLogout!();
                        } else {
                          await AuthService.logout();
                          if (context.mounted) {
                            Navigator.of(context).pushNamedAndRemoveUntil('/login', (route) => false);
                          }
                        }
                      },
                      icon: const Icon(Icons.logout_rounded, size: 18, color: Color(0xFF9E4B3D)),
                      label: const Text(
                        'Cerrar Sesión Concierge',
                        style: TextStyle(
                          fontFamily: 'Inter',
                          fontSize: 14.5,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFF9E4B3D),
                          letterSpacing: 0.3,
                        ),
                      ),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        backgroundColor: const Color(0xFFFFF8F6),
                        side: const BorderSide(color: Color(0xFFF5D6D0), width: 1.2),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                      ),
                    ),
                  ),

                  const SizedBox(height: 28),

                  // Sello de Marca y Versión
                  Center(
                    child: Column(
                      children: [
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(width: 24, height: 1, color: Color(0xFFD4AF37).withOpacity(0.5)),
                            const SizedBox(width: 8),
                            const Text(
                              'GLOWAPP HAUTE BEAUTÉ',
                              style: TextStyle(
                                fontFamily: 'Inter',
                                fontSize: 10,
                                fontWeight: FontWeight.w700,
                                letterSpacing: 2.2,
                                color: Color(0xFFC5A052),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Container(width: 24, height: 1, color: Color(0xFFD4AF37).withOpacity(0.5)),
                          ],
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'Experiencia Concierge de Belleza & Estética • v2.4.0',
                          style: TextStyle(
                            fontFamily: 'Inter',
                            fontSize: 11,
                            color: Color(0xFFA8998C),
                          ),
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

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Row(
        children: [
          Container(
            width: 3,
            height: 12,
            decoration: BoxDecoration(
              color: const Color(0xFFC5A052),
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            title,
            style: const TextStyle(
              fontFamily: 'Inter',
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.5,
              color: Color(0xFF8C7E74),
            ),
          ),
        ],
      ),
    );
  }
}
