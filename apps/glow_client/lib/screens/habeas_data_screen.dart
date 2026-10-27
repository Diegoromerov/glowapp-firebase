// lib/screens/profile/habeas_data_screen.dart
import 'package:flutter/material.dart';
import 'package:glow_core/core/theme/belleza_luxe_gradients.dart';
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
            content: const Text('Se revocarÃ¡ el consentimiento y se solicitarÃ¡ borrar los datos biomÃ©tricos guardados. Esta acciÃ³n no se puede deshacer.'),
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
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value ? 'Consentimiento biomÃ©trico otorgado.' : 'Consentimiento biomÃ©trico revocado.')));
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
          'HABEAS DATA & PRIVACIDAD',
          style: TextStyle(
            fontFamily: 'Didot',
            fontSize: 15,
            fontWeight: FontWeight.bold,
            color: LuxeColors.nude900,
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
              padding: const EdgeInsets.all(LuxeSpacing.xl),
              child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ENCABEZADO LEGAL LEY 1581
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: LuxeColors.nude200),
                ),
                child: const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.gavel_outlined, color: LuxeColors.nude900, size: 22),
                        SizedBox(width: 10),
                        Text(
                          'PROTECCIÃ“N DE DATOS SENSIBLES',
                          style: TextStyle(
                            fontFamily: 'Didot',
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                            color: LuxeColors.nude900,
                            letterSpacing: 1.0,
                          ),
                        ),
                      ],
                    ),
                    SizedBox(height: 12),
                    Text(
                      'Tus anÃ¡lisis y perfiles biomÃ©tricos se guardan en GlowApp mientras mantengas el consentimiento. Puedes revocarlo y solicitar la eliminaciÃ³n de estos datos desde esta pantalla.',
                      style: TextStyle(
                        fontFamily: 'CormorantGaramond',
                        fontSize: 14,
                        color: LuxeColors.nude700,
                        height: 1.4,
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: LuxeSpacing.xxl),

              const Text(
                'GESTIÃ“N DE CONSENTIMIENTOS',
                style: TextStyle(
                  fontFamily: 'JetBrainsMono',
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  color: LuxeColors.nude500,
                  letterSpacing: 1.2,
                ),
              ),
              const SizedBox(height: 12),

              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: LuxeColors.nude200),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Procesamiento BiomÃ©trico Facial',
                            style: TextStyle(
                              fontFamily: 'Didot',
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                              color: LuxeColors.nude900,
                            ),
                          ),
                          SizedBox(height: 2),
                          Text(
                            'Permite el anÃ¡lisis facial y las recomendaciones de cuidado de piel',
                            style: TextStyle(
                              fontFamily: 'CormorantGaramond',
                              fontSize: 13,
                              color: LuxeColors.nude600,
                            ),
                          ),
                        ],
                      ),
                    ),
                    _isLoading
                        ? const SizedBox(width: 48, height: 32, child: Center(child: CircularProgressIndicator(strokeWidth: 2)))
                        : Switch.adaptive(
                      value: _biometricConsent,
                      activeColor: const Color(0xFFC5A052),
                      onChanged: _isBusy ? null : _setConsent,
                    ),
                  ],
                ),
              ),

              const SizedBox(height: LuxeSpacing.xxl),

              // DERECHOS ARCO & DESCARGA
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: _isBusy ? null : _exportData,
                  icon: const Icon(Icons.download_outlined, color: LuxeColors.nude900, size: 18),
                  label: const Text(
                    'Descargar Mi Expediente BiomÃ©trico (JSON)',
                    style: TextStyle(
                      fontFamily: 'CormorantGaramond',
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                      color: LuxeColors.nude900,
                    ),
                  ),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    side: const BorderSide(color: LuxeColors.nude300),
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
