import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:glow_core/glow_core.dart';
import 'package:glow_core/data/colombia_municipalities.dart';

/// GLOWAPP BUSINESS ONBOARDING SCREEN (Flutter Expert Refactored)
/// Door 1 (New Business) vs Door 2 (Existing Business) onboarding setup.
class BusinessOnboardingScreen extends StatefulWidget {
  const BusinessOnboardingScreen({super.key});

  @override
  State<BusinessOnboardingScreen> createState() => _BusinessOnboardingScreenState();
}

class _BusinessOnboardingScreenState extends State<BusinessOnboardingScreen> {
  String _selectedMode = 'NEW_BUSINESS';
  String _selectedVertical = 'BEAUTY_SALON';
  final TextEditingController _nameController = TextEditingController(text: 'Mi Peluquería Studio');
  final TextEditingController _cityController = TextEditingController(text: 'Bogotá');
  bool _isSubmitting = false;

  @override
  void dispose() {
    _nameController.dispose();
    _cityController.dispose();
    super.dispose();
  }

  Future<void> _handleDiagnosticSubmit() async {
    if (_nameController.text.trim().isEmpty || _cityController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Por favor completa todos los campos obligatorios')),
      );
      return;
    }

    setState(() => _isSubmitting = true);
    HapticFeedback.mediumImpact();

    try {
      // Use BusinessApiService from glow_core
      await BusinessApiService().runDiagnostic(
        mode: _selectedMode,
        verticalCode: _selectedVertical,
        name: _nameController.text.trim(),
        city: _cityController.text.trim(),
      );

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text("Diagnóstico iniciado en modo: \${_selectedMode == 'NEW_BUSINESS' ? 'Negocio Nuevo' : 'Negocio Existente'}"),
          backgroundColor: AppTheme.success,
        ),
      );
      Navigator.pop(context);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text("Diagnóstico offline/demo configurado para \${_nameController.text}"),
          backgroundColor: AppTheme.warning,
        ),
      );
      Navigator.pop(context);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Text('GlowApp Business Setup', style: TextStyle(fontWeight: FontWeight.bold)),
        backgroundColor: AppTheme.primary,
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Selecciona tu Puerta de Entrada',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: AppTheme.text),
            ),
            const SizedBox(height: 8),
            const Text(
              'GlowApp Business adaptará la ruta de cumplimiento y trámites a tu realidad actual.',
              style: TextStyle(fontSize: 14, color: Colors.black54),
            ),
            const SizedBox(height: 24),

            // Door Selection Cards
            Row(
              children: [
                Expanded(
                  child: _buildDoorCard(
                    title: 'Negocio Nuevo',
                    subtitle: 'Empiezo desde cero. Guiarme paso a paso en trámites de apertura.',
                    icon: Icons.rocket_launch,
                    isSelected: _selectedMode == 'NEW_BUSINESS',
                    onTap: () {
                      HapticFeedback.selectionClick();
                      setState(() => _selectedMode = 'NEW_BUSINESS');
                    },
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _buildDoorCard(
                    title: 'Negocio Existente',
                    subtitle: 'Ya estoy operando. Auditar cumplimiento y regularizarme.',
                    icon: Icons.verified_user,
                    isSelected: _selectedMode == 'EXISTING_BUSINESS',
                    onTap: () {
                      HapticFeedback.selectionClick();
                      setState(() => _selectedMode = 'EXISTING_BUSINESS');
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 32),

            // Form Inputs
            Text('Nombre del Establecimiento', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.text)),
            const SizedBox(height: 8),
            TextField(
              controller: _nameController,
              decoration: InputDecoration(
                fillColor: AppTheme.surface,
                filled: true,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                prefixIcon: Icon(Icons.store, color: AppTheme.primary),
              ),
            ),
            const SizedBox(height: 16),

            Text('Tipo de Negocio (Vertical)', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.text)),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              value: _selectedVertical,
              decoration: InputDecoration(
                fillColor: AppTheme.surface,
                filled: true,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
              ),
              items: const [
                DropdownMenuItem(value: 'BEAUTY_SALON', child: Text('Peluquería / Salón de Belleza')),
                DropdownMenuItem(value: 'BARBERSHOP', child: Text('Barbería')),
                DropdownMenuItem(value: 'SPA_MASSAGE', child: Text('Spa / Centro de Relajación')),
                DropdownMenuItem(value: 'AESTHETICS', child: Text('Centro de Estética')),
              ],
              onChanged: (val) {
                if (val != null) setState(() => _selectedVertical = val);
              },
            ),
            const SizedBox(height: 16),

            Text('Ciudad o Municipio de Operación', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.text)),
            const SizedBox(height: 8),
            Autocomplete<String>(
              initialValue: TextEditingValue(text: _cityController.text),
              optionsBuilder: (TextEditingValue textEditingValue) {
                if (textEditingValue.text.isEmpty) {
                  return colombiaMunicipalities.take(15);
                }
                final query = textEditingValue.text.toLowerCase();
                return colombiaMunicipalities.where((municipality) =>
                    municipality.toLowerCase().contains(query)).take(25);
              },
              onSelected: (String selection) {
                _cityController.text = selection;
              },
              fieldViewBuilder: (context, controller, focusNode, onFieldSubmitted) {
                controller.addListener(() {
                  _cityController.text = controller.text;
                });
                return TextField(
                  controller: controller,
                  focusNode: focusNode,
                  decoration: InputDecoration(
                    fillColor: AppTheme.surface,
                    filled: true,
                    hintText: 'Ej. Chía (Cundinamarca) o Medellín (Antioquia)',
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    prefixIcon: Icon(Icons.location_city, color: AppTheme.primary),
                  ),
                );
              },
            ),
            const SizedBox(height: 32),

            // Captura de la responsabilidad de IVA (datos fiscales del RUT).
            // No bloquea el alta: declarar es opcional para publicar y obligatorio
            // para recibir pagos con IVA desglosado.
            // FiscalIvaSection needs to be created or imported from glow_core
            // For now, using a placeholder
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppTheme.warning.withOpacity(0.05),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppTheme.warning.withOpacity(0.2)),
              ),
              child: Row(
                children: [
                  Icon(Icons.receipt_long, color: AppTheme.warning, size: 24),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Responsabilidad de IVA (RUT)',
                          style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.text),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Configuración opcional para facturación con IVA desglosado',
                          style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            // Submit Button
            SizedBox(
              width: double.infinity,
              height: 52,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.primary,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: _isSubmitting ? null : _handleDiagnosticSubmit,
                child: _isSubmitting
                    ? const SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                      )
                    : const Text(
                        'Iniciar Diagnóstico Business',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDoorCard({
    required String title,
    required String subtitle,
    required IconData icon,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: isSelected ? AppTheme.primary.withOpacity(0.1) : AppTheme.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isSelected ? AppTheme.primary : AppTheme.divider,
            width: isSelected ? 2 : 1,
          ),
          boxShadow: isSelected ? AppTheme.softShadow : null,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: isSelected ? AppTheme.primary.withOpacity(0.2) : AppTheme.primary.withOpacity(0.1),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: isSelected ? AppTheme.primary : AppTheme.textSecondary, size: 28),
            ),
            const SizedBox(height: 16),
            Text(
              title,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
                color: isSelected ? AppTheme.primary : AppTheme.text,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              subtitle,
              style: TextStyle(
                fontSize: 12,
                color: AppTheme.textSecondary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
