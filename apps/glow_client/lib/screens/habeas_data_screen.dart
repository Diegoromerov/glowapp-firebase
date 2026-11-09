import 'package:glow_core/glow_core.dart';
import 'package:flutter/material.dart';

class HabeasDataScreen extends StatefulWidget {
  const HabeasDataScreen({super.key});

  @override
  State<HabeasDataScreen> createState() => _HabeasDataScreenState();
}

class _HabeasDataScreenState extends State<HabeasDataScreen> {
  bool _biometricConsent = false;
  bool _isLoading = true;
  bool _isBusy = false;
  bool _consentStateKnown = true;
  bool _needsReconsent = false;
  bool _deletionPending = false;

  @override
  void initState() {
    super.initState();
    _loadConsent();
  }

  Future<void> _loadConsent() async {
    try {
      final state = await BiometricService.getConsentState();
      if (!mounted) return;
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

  Future<Map<String, dynamic>?> _confirmCurrentTerms() async {
    final terms = await BiometricService.getConsentTerms();
    if (!mounted) return null;
    final controller = Map<String, dynamic>.from(terms['controller'] as Map);
    final processors = (terms['processors'] as List? ?? const [])
        .whereType<Map>()
        .map((p) =>
            '${p['name']} — ${p['country']}: ${p['purpose']} (datos: ${p['data_shared']})')
        .join('\n');
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
                      'Versión ${terms['version']} · Datos sensibles\n${terms['sensitive_data']}'),
                  const SizedBox(height: 12),
                  Text('Finalidad\n${terms['purpose']}'),
                  const SizedBox(height: 12),
                  Text('Carácter facultativo\n${terms['optional']}'),
                  const SizedBox(height: 12),
                  Text('Encargados y transferencias\n$processors'),
                  const SizedBox(height: 12),
                  Text(terms['international_transfer_notice'] as String),
                  const SizedBox(height: 12),
                  Text('Conservación\n${terms['retention']}'),
                  const SizedBox(height: 12),
                  Text('Huella técnica\n${terms['photo_fingerprint']}'),
                  const SizedBox(height: 12),
                  Text(
                      'Tus derechos\n• ${(terms['rights'] as List? ?? const []).join('\n• ')}'),
                  const SizedBox(height: 12),
                  Text(terms['channel'] as String),
                  const SizedBox(height: 12),
                  Text(terms['authorization'] as String),
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    value: explicitlyAccepted,
                    onChanged: (value) => setDialogState(
                        () => explicitlyAccepted = value == true),
                    title: const Text(
                        'Autorizo expresamente y de forma voluntaria el tratamiento de mis datos sensibles y, si aplica, su transferencia internacional a los proveedores y países indicados.'),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('No autorizo')),
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
    return accepted == true ? terms : null;
  }

  Future<void> _setConsent(bool value) async {
    setState(() => _isBusy = true);
    try {
      if (value) {
        final terms = await _confirmCurrentTerms();
        if (terms == null) return;
        await BiometricService.saveConsent(terms: terms);
      } else {
        final confirmed = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Revocar y eliminar datos'),
            content: const Text(
                'Se revocará el consentimiento y se solicitará borrar los datos biométricos guardados. Esta acción no se puede deshacer.'),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(context, false),
                  child: const Text('Cancelar')),
              FilledButton(
                  onPressed: () => Navigator.pop(context, true),
                  child: const Text('Revocar y eliminar')),
            ],
          ),
        );
        if (confirmed != true) {
          if (mounted) setState(() => _isBusy = false);
          return;
        }
        await BiometricService.revokeConsent();
      }
      if (mounted) {
        setState(() {
          _biometricConsent = value;
          _needsReconsent = false;
          _deletionPending = false;
          _consentStateKnown = true;
        });
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(value
                ? 'Consentimiento biométrico otorgado.'
                : 'Consentimiento biométrico revocado.')));
      }
    } catch (error) {
      if (error is BiometricDeletionPendingException && mounted) {
        setState(() {
          _biometricConsent = false;
          _needsReconsent = false;
          _deletionPending = true;
        });
      }
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(error.toString().replaceFirst('Exception: ', ''))));
    } finally {
      if (mounted) setState(() => _isBusy = false);
    }
  }

  Future<void> _exportData() async {
    setState(() => _isBusy = true);
    try {
      await BiometricService.exportBiometricData();
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text(
                'Expediente generado. Consulta el archivo JSON en las descargas.')));
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(error.toString().replaceFirst('Exception: ', ''))));
    } finally {
      if (mounted) setState(() => _isBusy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final textColor = AppTheme.text;
    final surfaceColor = AppTheme.surface;
    final primaryColor = AppTheme.primary;
    final borderColor = AppTheme.primary.withValues(alpha: 0.3);
    final mutedText = AppTheme.text.withValues(alpha: 0.6);
    final subText = AppTheme.text.withValues(alpha: 0.7);

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: AppTheme.background,
        elevation: 0,
        leading: IconButton(
          tooltip: 'Regresar',
          icon: Icon(Icons.arrow_back_ios_new, color: textColor, size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          'HABEAS DATA & PRIVACIDAD',
          style: TextStyle(
            fontFamily: 'Didot',
            fontSize: 15,
            fontWeight: FontWeight.bold,
            color: textColor,
            letterSpacing: 1.2,
          ),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 680),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // ENCABEZADO LEGAL LEY 1581
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      color: surfaceColor,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: borderColor),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(Icons.gavel_outlined,
                                color: textColor, size: 22),
                            const SizedBox(width: 10),
                            Text(
                              'PROTECCION DE DATOS SENSIBLES',
                              style: TextStyle(
                                fontFamily: 'Didot',
                                fontSize: 13,
                                fontWeight: FontWeight.bold,
                                color: textColor,
                                letterSpacing: 1.0,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Text(
                          'La autorización para tratar datos biométricos sensibles es facultativa. Puedes revisar el aviso vigente, revocar la autorización y solicitar la supresión desde esta pantalla. Las métricas tienen un plazo de conservación informado antes de aceptar.',
                          style: TextStyle(
                            fontFamily: 'CormorantGaramond',
                            fontSize: 14,
                            color: subText,
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  ),

                  if (!_consentStateKnown) ...[
                    const SizedBox(height: 8),
                    Text(
                        'No pudimos consultar tu estado de autorización. Vuelve a cargar antes de cambiarlo.',
                        style: TextStyle(color: AppTheme.error, fontSize: 12)),
                    TextButton(
                        onPressed: _isBusy ? null : _loadConsent,
                        child: const Text('Volver a consultar')),
                  ],
                  if (_needsReconsent) ...[
                    const SizedBox(height: 8),
                    Text(
                        'El aviso cambió. La autorización anterior no permite nuevos análisis hasta que revises y aceptes la versión vigente.',
                        style: TextStyle(color: mutedText, fontSize: 13)),
                    TextButton.icon(
                      onPressed: _isBusy ? null : () => _setConsent(true),
                      icon: const Icon(Icons.refresh),
                      label: const Text('Revisar y actualizar autorización'),
                    ),
                  ],
                  if (_deletionPending) ...[
                    const SizedBox(height: 8),
                    Text(
                        'La autorización ya está revocada y no se ejecutan nuevos análisis. La supresión quedó pendiente de confirmación.',
                        style: TextStyle(color: AppTheme.error, fontSize: 13)),
                    TextButton.icon(
                      onPressed: _isBusy
                          ? null
                          : () async {
                              setState(() => _isBusy = true);
                              try {
                                await BiometricService.deleteBiometricData();
                                if (mounted)
                                  setState(() => _deletionPending = false);
                                if (mounted)
                                  ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(
                                          content:
                                              Text('Supresión confirmada.')));
                              } catch (error) {
                                if (mounted)
                                  ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(
                                          content: Text(error.toString())));
                              } finally {
                                if (mounted) setState(() => _isBusy = false);
                              }
                            },
                      icon: const Icon(Icons.delete_outline),
                      label: const Text('Reintentar eliminación'),
                    ),
                  ],

                  const SizedBox(height: 32),

                  Text(
                    'GESTION DE CONSENTIMIENTOS',
                    style: TextStyle(
                      fontFamily: 'JetBrainsMono',
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      color: textColor,
                      letterSpacing: 1.2,
                    ),
                  ),
                  const SizedBox(height: 12),

                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: surfaceColor,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: borderColor),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Procesamiento Biometrico Facial',
                                style: TextStyle(
                                  fontFamily: 'Didot',
                                  fontSize: 14,
                                  fontWeight: FontWeight.bold,
                                  color: textColor,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                'Permite el analisis facial y las recomendaciones de cuidado de piel',
                                style: TextStyle(
                                  fontFamily: 'CormorantGaramond',
                                  fontSize: 13,
                                  color: mutedText,
                                ),
                              ),
                            ],
                          ),
                        ),
                        _isLoading
                            ? const SizedBox(
                                width: 48,
                                height: 32,
                                child: Center(
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2)))
                            : Switch.adaptive(
                                value: _biometricConsent,
                                activeColor: primaryColor,
                                onChanged: _isBusy || !_consentStateKnown
                                    ? null
                                    : _setConsent,
                              ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 32),

                  // DERECHOS ARCO & DESCARGA
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: _isBusy ? null : _exportData,
                      icon: Icon(Icons.download_outlined,
                          color: textColor, size: 18),
                      label: Text(
                        'Descargar Mi Expediente Biometrico (JSON)',
                        style: TextStyle(
                          fontFamily: 'CormorantGaramond',
                          fontSize: 15,
                          fontWeight: FontWeight.bold,
                          color: textColor,
                        ),
                      ),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        side: BorderSide(color: borderColor),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10)),
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
