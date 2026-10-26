import 'package:flutter/material.dart';
import 'api_service.dart';

class SocialShareService {
  SocialShareService._();

  /// Registra el evento de compartir en redes sociales y entrega puntos XP de recompensa
  static Future<Map<String, dynamic>> logShare({
    required String platform,
    required String contentType,
    String? shareReferenceId,
  }) async {
    try {
      final res = await ApiService.post('/api/social/log-share', {
        'platform': platform,
        'content_type': contentType,
        'share_reference_id': shareReferenceId,
      });
      return res;
    } catch (e) {
      debugPrint('⚠️ Error registrando post compartido social: $e');
      return {'success': false, 'error': e.toString()};
    }
  }

  /// Muestra el modal de consentimiento informado (Ley 1581) antes de exportar datos estéticos
  static Future<bool> showConsentModal(
    BuildContext context, {
    required String platformName,
    required String contentTypeLabel,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) {
        return AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
          title: const Row(
            children: [
              Icon(Icons.security, color: Color(0xFFC5A052)),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Consentimiento Ley 1581',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Estás a punto de exportar tu resultado de $contentTypeLabel hacia $platformName.',
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFAF8F5),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFE8E0D5)),
                ),
                child: const Text(
                  '🔒 Confirmo que autorizo la transmisión de mi tarjeta de resultado estético a la plataforma de destino. Entiendo que esta exportación es independiente de la custodia de datos seguros en GlowApp.',
                  style: TextStyle(fontSize: 12, color: Color(0xFF6B5A48), height: 1.3),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancelar', style: TextStyle(color: Colors.grey)),
            ),
            ElevatedButton.icon(
              onPressed: () => Navigator.pop(context, true),
              icon: const Icon(Icons.share, size: 18),
              label: const Text('Autorizar y Compartir'),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFC5A052),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
              ),
            ),
          ],
        );
      },
    );

    return result ?? false;
  }
}
