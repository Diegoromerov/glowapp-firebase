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
        if (confirmed != true) {
          if (mounted) setState(() => _isBusy = false);
          return;
        }
        await BiometricService.revokeConsent();
      }
      if (mounted) {
        setState(() => _biometricConsent = value);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value ? 'Consentimiento biométrico otorgado.' : 'Consentimiento biométrico revocado.')));
      }
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString().replaceFirst('Exception: ', ''))));
    } finally {
      if (mounted) setState(() => _isBusy = false);
    }
  }

  Future<void> _exportData() async {
    setState(() => _isBusy = true);
    try {
      await BiometricService.exportBiometricData();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Expediente generado. Consulta el archivo JSON en las descargas.')));
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString().replaceFirst('Exception: ', ''))));
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
                            Icon(Icons.gavel_outlined, color: textColor, size: 22),
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
                          'Tus analisis y perfiles biométricos se guardan en GlowApp mientras mantengas el consentimiento. Puedes revocarlo y solicitar la eliminacion de estos datos desde esta pantalla.',
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
                            ? const SizedBox(width: 48, height: 32, child: Center(child: CircularProgressIndicator(strokeWidth: 2)))
                            : Switch.adaptive(
                          value: _biometricConsent,
                          activeColor: primaryColor,
                          onChanged: _isBusy ? null : _setConsent,
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
                      icon: Icon(Icons.download_outlined, color: textColor, size: 18),
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
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
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
