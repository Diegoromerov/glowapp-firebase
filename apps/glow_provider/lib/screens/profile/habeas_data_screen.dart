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
  bool _needsReconsent = false;
  bool _deletionPending = false;
  bool _consentStateKnown = true;

  @override
  void initState() {
    super.initState();
    _loadConsent();
  }

  Future<void> _loadConsent() async {
    try {
      final state = await BiometricService.getConsentState();
      if (!mounted) return;
      if (mounted)
        setState(() {
          _biometricConsent = state.granted;
          _needsReconsent = state.needsReconsent;
          _consentStateKnown = state.known;
          _isLoading = false;
        });
    } catch (_) {
      if (mounted)
        setState(() {
          _consentStateKnown = false;
          _isLoading = false;
        });
    }
  }

  Future<void> _setConsent(bool value) async {
    setState(() => _isBusy = true);
    try {
      if (value) {
        final terms = await BiometricService.getConsentTerms();
        final controller = Map<String, dynamic>.from(
          terms['controller'] as Map,
        );
        var explicitlyAccepted = false;
        final accepted = await showDialog<bool>(
          context: context,
          builder: (dialogContext) => StatefulBuilder(
            builder: (dialogContext, setDialogState) => AlertDialog(
              title: Text(terms['title'] as String),
              content: SizedBox(
                width: 560,
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${controller['name']} · ${controller['contact']}'),
                      const SizedBox(height: 12),
                      Text(
                        'Versión ${terms['version']} · Datos sensibles\n${terms['sensitive_data']}',
                      ),
                      const SizedBox(height: 12),
                      Text('Finalidad\n${terms['purpose']}'),
                      const SizedBox(height: 12),
                      Text('Carácter facultativo\n${terms['optional']}'),
                      const SizedBox(height: 12),
                      Text('Conservación\n${terms['retention']}'),
                      const SizedBox(height: 12),
                      Text('Huella técnica\n${terms['photo_fingerprint']}'),
                      const SizedBox(height: 12),
                      Text(
                        'Transferencias y encargados\n${(terms['processors'] as List? ?? const []).map((p) => '${p['name']} — ${p['country']}: ${p['purpose']} (datos: ${p['data_shared']})').join('\n')}\n${terms['international_transfer_notice']}',
                      ),
                      const SizedBox(height: 12),
                      Text(
                        'Derechos\n• ${(terms['rights'] as List? ?? const []).join('\n• ')}',
                      ),
                      const SizedBox(height: 12),
                      Text(terms['channel'] as String),
                      const SizedBox(height: 12),
                      Text(terms['authorization'] as String),
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        value: explicitlyAccepted,
                        onChanged: (v) => setDialogState(
                          () => explicitlyAccepted = v == true,
                        ),
                        title: const Text(
                          'Autorizo expresamente y de forma voluntaria el tratamiento de mis datos sensibles y, si aplica, su transferencia internacional a los proveedores y países indicados.',
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(dialogContext, false),
                  child: const Text('No autorizo'),
                ),
                FilledButton(
                  onPressed: explicitlyAccepted
                      ? () => Navigator.pop(dialogContext, true)
                      : null,
                  child: const Text('Aceptar y continuar'),
                ),
              ],
            ),
          ),
        );
        if (accepted != true) {
          if (mounted) setState(() => _isBusy = false);
          return;
        }
        await BiometricService.saveConsent(terms: terms);
      } else {
        final confirmed = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Revocar y eliminar datos'),
            content: const Text(
              'Se revocará el consentimiento y se solicitará borrar los datos biométricos guardados. Esta acción no se puede deshacer.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Cancelar'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Revocar y eliminar'),
              ),
            ],
          ),
        );
        if (confirmed != true) {
          if (mounted) setState(() => _isBusy = false);
          return;
        }
        await BiometricService.revokeConsent();
      }
      if (!mounted) return;
      setState(() {
        _biometricConsent = value;
        _needsReconsent = false;
        _deletionPending = false;
        _isBusy = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            value
                ? 'Consentimiento biométrico otorgado'
                : 'Consentimiento revocado y datos eliminados',
          ),
          backgroundColor: value ? AppTheme.success : AppTheme.warning,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        if (e is BiometricDeletionPendingException) {
          _biometricConsent = false;
          _deletionPending = true;
          _needsReconsent = false;
        }
        _isBusy = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Error: ${mensajeHumano(e)}'),
          backgroundColor: AppTheme.error,
        ),
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
                      color: AppTheme.primary.withOpacity(0.05),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: AppTheme.primary.withOpacity(0.2),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                color: AppTheme.primary.withOpacity(0.1),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Icon(
                                Icons.gavel,
                                color: AppTheme.primary,
                                size: 24,
                              ),
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
                          'La autorización es facultativa. Antes de aceptar puedes revisar qué datos se tratan, para qué, qué proveedores los reciben y en qué países. El aviso vigente informa el plazo de conservación y cómo ejercer tus derechos.',
                          style: TextStyle(
                            fontSize: 13,
                            color: AppTheme.textSecondary,
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  ),

                  if (_needsReconsent) ...[
                    const SizedBox(height: 8),
                    Text(
                      'El aviso cambió. La autorización anterior no permite nuevos análisis hasta revisar y aceptar la versión vigente.',
                      style: TextStyle(color: AppTheme.warning, fontSize: 13),
                    ),
                    TextButton.icon(
                      onPressed: _isBusy ? null : () => _setConsent(true),
                      icon: const Icon(Icons.refresh),
                      label: const Text('Revisar y actualizar autorización'),
                    ),
                  ],
                  if (!_consentStateKnown) ...[
                    const SizedBox(height: 8),
                    Text(
                      'No pudimos consultar tu estado de autorización. Vuelve a cargar antes de cambiarlo.',
                      style: TextStyle(color: AppTheme.error, fontSize: 13),
                    ),
                    TextButton(
                      onPressed: _isBusy ? null : _loadConsent,
                      child: const Text('Volver a consultar'),
                    ),
                  ],
                  if (_deletionPending) ...[
                    const SizedBox(height: 8),
                    Text(
                      'La autorización quedó revocada. La supresión requiere confirmación; puedes reintentarla aquí.',
                      style: TextStyle(color: AppTheme.error, fontSize: 13),
                    ),
                    TextButton.icon(
                      onPressed: _isBusy
                          ? null
                          : () async {
                              setState(() => _isBusy = true);
                              try {
                                await BiometricService.deleteBiometricData();
                                if (mounted)
                                  setState(() => _deletionPending = false);
                              } catch (error) {
                                if (mounted)
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                      content: Text(mensajeHumano(error)),
                                    ),
                                  );
                              } finally {
                                if (mounted) setState(() => _isBusy = false);
                              }
                            },
                      icon: const Icon(Icons.delete_outline),
                      label: const Text('Reintentar eliminación'),
                    ),
                  ],

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
                          onChanged: _isBusy || !_consentStateKnown
                              ? null
                              : _setConsent,
                          activeColor: AppTheme.primary,
                          activeTrackColor: AppTheme.primary.withOpacity(0.3),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 16),

                  // RIGHTS INFO
                  Container(
                    padding: const EdgeInsets.all(AppTheme.spacingL),
                    decoration: BoxDecoration(
                      color: AppTheme.warning.withOpacity(0.05),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: AppTheme.warning.withOpacity(0.2),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(
                              Icons.info_outline,
                              color: AppTheme.warning,
                              size: 20,
                            ),
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
                        _buildRight(
                          'Conocer, actualizar y rectificar sus datos',
                        ),
                        _buildRight(
                          'Solicitar prueba de la autorización otorgada',
                        ),
                        _buildRight('Ser informado sobre el uso de sus datos'),
                        _buildRight(
                          'Presentar quejas ante la SIC por infracciones',
                        ),
                        _buildRight(
                          'Revocar la autorización en cualquier momento',
                        ),
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
              style: TextStyle(
                fontSize: 12,
                color: AppTheme.textSecondary,
                height: 1.3,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
