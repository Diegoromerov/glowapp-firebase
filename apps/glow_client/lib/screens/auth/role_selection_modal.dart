import 'package:glow_core/glow_core.dart';
import 'package:flutter/material.dart';
class RoleSelectionModal extends StatefulWidget {
  const RoleSelectionModal({super.key});

  static Future<String?> show(BuildContext context) {
    return showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (context) => const RoleSelectionModal(),
    );
  }

  @override
  State<RoleSelectionModal> createState() => _RoleSelectionModalState();
}

class _RoleSelectionModalState extends State<RoleSelectionModal> {
  String? _selectedRole;
  bool _isLoading = false;
  String? _error;

  Future<void> _handleConfirm() async {
    if (_selectedRole == null) return;
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final success = await AuthService.selectRole(_selectedRole!);
      if (success && mounted) {
        Navigator.pop(context, _selectedRole);
      } else {
        setState(() => _error = 'No se pudo guardar la selección de rol.');
      }
    } catch (e) {
      setState(() => _error = 'Error de conexión: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Icon(Icons.account_circle_outlined, size: 56, color: Color(0xFFE91E63)),
            const SizedBox(height: 16),
            const Text(
              '¡Bienvenido a GlowApp!',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            const Text(
              'Selecciona cómo deseas utilizar tu cuenta en la plataforma:',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 14, color: Colors.grey),
            ),
            const SizedBox(height: 20),
            _buildRoleCard(
              title: '🛍️ Cliente',
              subtitle: 'Quiero buscar y reservar servicios de belleza.',
              roleValue: 'CLIENTE',
            ),
            const SizedBox(height: 12),
            _buildRoleCard(
              title: '✂️ Profesional Independiente',
              subtitle: 'Ofrezco servicios y gestiono mi propia agenda.',
              roleValue: 'PRESTADOR',
            ),
            const SizedBox(height: 12),
            _buildRoleCard(
              title: '🏢 Salón de Belleza (SaaS)',
              subtitle: 'Administro un local, equipo de trabajo y licencias.',
              roleValue: 'SALON',
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: const TextStyle(color: Colors.red, fontSize: 13), textAlign: TextAlign.center),
            ],
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: _selectedRole != null && !_isLoading ? _handleConfirm : null,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFE91E63),
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: _isLoading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Continuar', style: TextStyle(fontSize: 16, color: Colors.white, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRoleCard({
    required String title,
    required String subtitle,
    required String roleValue,
  }) {
    final bool isSelected = _selectedRole == roleValue;
    return InkWell(
      onTap: () => setState(() => _selectedRole = roleValue),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: isSelected ? const Color(0xFFFCE4EC) : Colors.grey.shade50,
          border: Border.all(
            color: isSelected ? const Color(0xFFE91E63) : Colors.grey.shade300,
            width: isSelected ? 2 : 1,
          ),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 2),
                  Text(subtitle, style: TextStyle(fontSize: 12, color: Colors.grey.shade700)),
                ],
              ),
            ),
            if (isSelected)
              const Icon(Icons.check_circle, color: Color(0xFFE91E63))
            else
              const Icon(Icons.radio_button_off, color: Colors.grey),
          ],
        ),
      ),
    );
  }
}
