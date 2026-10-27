// lib/screens/profile/habeas_data_screen.dart
import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';
import 'package:glow_core/services/biometric_service.dart';

class HabeasDataScreen extends StatefulWidget {
  const HabeasDataScreen({super.key});

  @override
  State<HabeasDataScreen> createState() => _HabeasDataScreenState();
}

class _HabeasDataScreenState extends State<HabeasDataScreen> {
  bool _biometricConsent = false;
  bool _isLoading = true;
  bool _isBusy = false;

  @override
  void initState() {
    super.initState();
    _loadConsent();
  }

  Future<void> _loadConsent() async {
    try {
      final allowed = await BiometricService.hasConsent();
      if (!mounted) return;
      if (mounted) setState(() { _biometricConsent = allowed; _isLoading = false; });
    } catch (_) {
      if (mounted) setState(() { _biometricConsent = false; _isLoading = false; });
    }
  }

  Future<void> _setConsent(bool value) async {
    setState(() => _isBusy = true);
    try {
      if (value) {
        await BiometricService.saveConsent();
      } else {
        final confirmed = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Revocar y eliminar datos'),
            content: const Text('Se revocará el consentimiento y se solicitará borrar los datos biométricos guardados. Esta acción no se puede deshacer.'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
              FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Revocar y eliminar')),
            ],
          ),
        );
        if (confirmed == true) {
          await BiometricService.revokeConsent();
        }
      }
      if (!mounted) return;
      setState(() {
        _biometricConsent = value;
        _isBusy = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(value ? 'Consentimiento biométrico otorgado' : 'Consentimiento revocado y datos eliminados'),
          backgroundColor: value ? AppTheme.success : AppTheme.warning,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _isBusy = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: \$e'), backgroundColor: AppTheme.error),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return Scaffold(
        backgroundColor: AppTheme.background,
        appBar: AppBar(
          title: const Text('Consentimiento Biométrico'),
          backgroundColor: AppTheme.background,
        ),
        body: Center(child: CircularProgressIndicator(color: AppTheme.primary)),
      );
    }

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Text('Consentimiento Biométrico (Ley 1581)'),
        backgroundColor: AppTheme.background,
        elevation: 0,
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 680),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppTheme.spacingXL),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // INFO CARD
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(AppTheme.spacingXL),
                    decoration: BoxDecoration(
                      color: AppTheme.primary.withValues(alpha: 0.05),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: AppTheme.primary.withValues(alpha: 0.2)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                color: AppTheme.primary.withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Icon(Icons.gavel, color: AppTheme.primary, size: 24),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Text(
                                'Protección de Datos Biométricos',
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                  color: AppTheme.text,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Text(
                          'En cumplimiento de la Ley 1581 de 2012 (Ley de Protección de Datos Personales) y el Decreto 1377 de 2013, GlowApp requiere su consentimiento explícito, informado y previo para el tratamiento de sus datos biométricos (escaneos faciales, de manos y uñas).',
                          style: TextStyle(
                            fontSize: 13,
                            color: AppTheme.textSecondary,
                            height: 1.4,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Sus datos se encriptan en tránsito y en reposo, se almacenan en servidores certificados en Colombia y se eliminan automáticamente tras 12 meses de inactividad o al revocar el consentimiento.',
                          style: TextStyle(
                            fontSize: 13,
                            color: AppTheme.textSecondary,
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 24),

                  // CONSENT TOGGLE
                  Container(
                    padding: const EdgeInsets.all(AppTheme.spacingL),
                    decoration: BoxDecoration(
                      color: AppTheme.surface,
                      borderRadius: BorderRadius.circular(16),
                      boxShadow: AppTheme.softShadow,
                      border: Border.all(color: AppTheme.divider),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Autorizo el tratamiento de mis datos biométricos',
                                style: TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w600,
                                  color: AppTheme.text,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'Incluye escaneos faciales, análisis de manos y diagnóstico de uñas para recomendaciones personalizadas.',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: AppTheme.textSecondary,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Switch(
                          value: _biometricConsent,
                          onChanged: _isBusy ? null : _setConsent,
                          activeColor: AppTheme.primary,
                          activeTrackColor: AppTheme.primary.withValues(alpha: 0.3),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 16),

                  // RIGHTS INFO
                  Container(
                    padding: const EdgeInsets.all(AppTheme.spacingL),
                    decoration: BoxDecoration(
                      color: AppTheme.warning.withValues(alpha: 0.05),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: AppTheme.warning.withValues(alpha: 0.2)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(Icons.info_outline, color: AppTheme.warning, size: 20),
                            const SizedBox(width: 8),
                            Text(
                              'Sus derechos (Ley 1581)',
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.bold,
                                color: AppTheme.text,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        _buildRight('Conocer, actualizar y rectificar sus datos'),
                        _buildRight('Solicitar prueba de la autorización otorgada'),
                        _buildRight('Ser informado sobre el uso de sus datos'),
                        _buildRight('Presentar quejas ante la SIC por infracciones'),
                        _buildRight('Revocar la autorización en cualquier momento'),
                        _buildRight('Acceder gratuitamente a sus datos'),
                      ],
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

  Widget _buildRight(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('• ', style: TextStyle(color: AppTheme.warning, fontSize: 13)),
          Expanded(
            child: Text(
              text,
              style: TextStyle(fontSize: 12, color: AppTheme.textSecondary, height: 1.3),
            ),
          ),
        ],
      ),
    );
  }
}
