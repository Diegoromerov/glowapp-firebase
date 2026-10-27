// frontend/lib/screens/auth/context_selection_screen.dart
import 'package:glow_core/glow_core.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
class ContextSelectionScreen extends StatefulWidget {
  final List<dynamic> availableContexts;

  const ContextSelectionScreen({super.key, required this.availableContexts});

  @override
  State<ContextSelectionScreen> createState() => _ContextSelectionScreenState();
}

class _ContextSelectionScreenState extends State<ContextSelectionScreen> {
  bool _isLoading = false;

  Color _getRoleColor(String role) {
    final normalizedRole = role.toUpperCase();
    if (normalizedRole == 'OWNER') {
      return const Color(0xFFD4AF37); // Champagne Gold / Amber
    } else if (normalizedRole == 'ADMIN') {
      return const Color(0xFF1976D2); // Luxe Blue
    } else if (normalizedRole == 'MANAGER') {
      return const Color(0xFF388E3C); // Emerald Green
    }
    return const Color(0xFF757575);
  }

  String _getRouteForRole(String role) {
    final normalizedRole = role.toLowerCase();
    if (normalizedRole == 'salon' || normalizedRole == 'owner' || normalizedRole == 'admin') {
      return '/salon';
    } else if (normalizedRole == 'provider' || normalizedRole == 'manager') {
      return '/provider';
    }
    return '/home';
  }

  Future<void> _selectContext(dynamic item) async {
    setState(() {
      _isLoading = true;
    });

    final businessProfileId = (item['business_profile_id'] ?? item['id'] ?? '').toString();
    final res = await AuthService.switchContext(businessProfileId);

    setState(() {
      _isLoading = false;
    });

    if (res != null && mounted) {
      final role = (item['role'] ?? 'MEMBER').toString();
      final route = _getRouteForRole(role);
      Navigator.pushReplacementNamed(context, route);
    } else if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No se pudo activar el establecimiento seleccionado.'),
          backgroundColor: Colors.red,
        ),
      );
    }
  }

  Future<void> _logout() async {
    await SecureStorageService().delete('token');
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();

    if (mounted) {
      Navigator.pushReplacementNamed(context, '/login');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 32),
              // Header
              const Text(
                'Selecciona tu Establecimiento',
                style: TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.bold,
                  color: Color(0xFF2C221E),
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Tienes acceso a múltiples sedes. Elige con cuál deseas trabajar hoy.',
                style: TextStyle(
                  fontSize: 15,
                  color: Color(0xFF7A6E67),
                ),
              ),
              const SizedBox(height: 32),
              // Lista de tarjetas
              Expanded(
                child: _isLoading
                    ? const Center(
                        child: CircularProgressIndicator(
                          valueColor: AlwaysStoppedAnimation<Color>(Color(0xFFD4AF37)),
                        ),
                      )
                    : ListView.builder(
                        itemCount: widget.availableContexts.length,
                        itemBuilder: (context, index) {
                          final item = widget.availableContexts[index];
                          final name = (item['name'] ?? item['business_name'] ?? 'Establecimiento').toString();
                          final role = (item['role'] ?? 'MEMBER').toString();
                          final roleColor = _getRoleColor(role);

                          return Card(
                            margin: const EdgeInsets.only(bottom: 16),
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16),
                              side: const BorderSide(color: Color(0xFFE8E0D5), width: 1),
                            ),
                            child: InkWell(
                              onTap: () => _selectContext(item),
                              borderRadius: BorderRadius.circular(16),
                              child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Row(
                                  children: [
                                    // Icono
                                    Container(
                                      width: 52,
                                      height: 52,
                                      decoration: BoxDecoration(
                                        color: roleColor.withValues(alpha: 0.12),
                                        borderRadius: BorderRadius.circular(14),
                                      ),
                                      child: Icon(
                                        Icons.storefront_outlined,
                                        color: roleColor,
                                        size: 26,
                                      ),
                                    ),
                                    const SizedBox(width: 16),
                                    // Información
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            name,
                                            style: const TextStyle(
                                              fontSize: 17,
                                              fontWeight: FontWeight.w600,
                                              color: Color(0xFF2C221E),
                                            ),
                                          ),
                                          const SizedBox(height: 6),
                                          // Badge del rol
                                          Container(
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 10,
                                              vertical: 4,
                                            ),
                                            decoration: BoxDecoration(
                                              color: roleColor,
                                              borderRadius: BorderRadius.circular(12),
                                            ),
                                            child: Text(
                                              role.toUpperCase(),
                                              style: const TextStyle(
                                                fontSize: 11,
                                                fontWeight: FontWeight.bold,
                                                color: Colors.white,
                                                letterSpacing: 0.5,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    // Flecha indicativa
                                    Icon(
                                      Icons.arrow_forward_ios_rounded,
                                      color: Colors.grey.shade400,
                                      size: 16,
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          );
                        },
                      ),
              ),
              const SizedBox(height: 16),
              // Botón de salida
              Center(
                child: TextButton.icon(
                  onPressed: _isLoading ? null : _logout,
                  icon: const Icon(Icons.logout, size: 18, color: Colors.redAccent),
                  label: const Text(
                    'Cerrar Sesión',
                    style: TextStyle(
                      fontSize: 15,
                      color: Colors.redAccent,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
    );
  }
}
