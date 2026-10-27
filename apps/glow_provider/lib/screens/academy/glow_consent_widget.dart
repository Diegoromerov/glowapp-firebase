// frontend/lib/screens/academy/glow_consent_widget.dart
import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';
import 'package:glow_core/services/api_service.dart';

class GlowConsentWidget extends StatefulWidget {
  final VoidCallback onConsentGranted;
  const GlowConsentWidget({super.key, required this.onConsentGranted});

  @override
  State<GlowConsentWidget> createState() => _GlowConsentWidgetState();
}

class _GlowConsentWidgetState extends State<GlowConsentWidget> {
  bool _isChecking = true;
  bool _hasConsent = false;
  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    _checkConsentStatus();
  }

  Future<void> _checkConsentStatus() async {
    try {
      final res = await ApiService.get('/api/academy/consent/status');
      if (!mounted) return;
      setState(() {
        _hasConsent = res['aceptado'] == true;
        _isChecking = false;
      });
      if (_hasConsent) {
        widget.onConsentGranted();
      }
    } catch (e) {
      setState(() {
        _isChecking = false;
      });
    }
  }

  Future<void> _submitConsent(bool status) async {
    setState(() {
      _isSubmitting = true;
    });
    try {
      final res = await ApiService.post('/api/academy/consent', {'aceptado': status});
      if (!mounted) return;
      setState(() {
        _hasConsent = res['aceptado'] == true;
        _isSubmitting = false;
      });
      if (_hasConsent) {
        widget.onConsentGranted();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('✅ Consentimiento de Habeas Data firmado con éxito.'), backgroundColor: Colors.green),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('⚠️ Consentimiento revocado.'), backgroundColor: Colors.orange),
        );
      }
    } catch (e) {
      setState(() {
        _isSubmitting = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('❌ Error al actualizar consentimiento: $e'), backgroundColor: Colors.redAccent),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isChecking) {
      return Center(child: CircularProgressIndicator(valueColor: AlwaysStoppedAnimation(AppTheme.primary)));
    }

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.primary.withValues(alpha: 0.04),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.primary.withValues(alpha: 0.2), width: 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.gavel_outlined, color: AppTheme.primary, size: 24),
              const SizedBox(width: 8),
              Text(
                'Consentimiento de Datos (Ley 1581)',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: AppTheme.text),
              ),
            ],
          ),
          const SizedBox(height: 8),
          const Text(
            'Para realizar las prácticas del curso de colorimetría es obligatorio autorizar el tratamiento '
            'de datos biométricos (fotos de clientas y cabello). Sus fotos se encriptan y se eliminan '
            'automáticamente en 12 meses. Puede revocar este permiso en cualquier momento.',
            style: TextStyle(fontSize: 12, color: Color(0xFF6B5855), height: 1.4),
          ),
          const SizedBox(height: 14),
          if (_hasConsent)
            Row(
              children: [
                const Icon(Icons.verified, color: Colors.green, size: 18),
                const SizedBox(width: 6),
                const Text('Autorización Activa', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold, fontSize: 13)),
                const Spacer(),
                OutlinedButton(
                  onPressed: _isSubmitting ? null : () => _submitConsent(false),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.redAccent,
                    side: const BorderSide(color: Colors.redAccent),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                  ),
                  child: const Text('Revocar', style: TextStyle(fontSize: 11)),
                ),
              ],
            )
          else
            ElevatedButton(
              onPressed: _isSubmitting ? null : () => _submitConsent(true),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primary,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                minimumSize: const Size(double.infinity, 40),
              ),
              child: _isSubmitting
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('He leído y Acepto los Términos', style: TextStyle(color: Colors.white)),
            ),
        ],
      ),
    );
  }
}
