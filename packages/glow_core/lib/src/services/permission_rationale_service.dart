// frontend/lib/services/permission_rationale_service.dart
//
// FIX-FLUTTER-02 — P1: Android Permisos Sin Description.
//
// Provee el "rationale" EN UI exigido antes de solicitar permisos peligrosos
// (ubicación, micrófono): el usuario ve una explicación de por qué la app
// necesita el permiso antes de que Android muestre el diálogo del sistema.
//
// Complementa los `android:description` declarados en AndroidManifest.xml.
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

class PermissionRationaleService {
  PermissionRationaleService._();

  static const String _locationReason =
      'GlowApp usa tu ubicación para mostrarte salones y profesionales de '
      'belleza cercanos. La ubicación solo se consulta mientras usas la '
      'aplicación.';

  static const String _microphoneReason =
      'GlowApp usa el micrófono para que puedas dictar mensajes y buscar por '
      'voz. El audio se procesa únicamente mientras mantienes activo el botón '
      'de voz.';

  static const String _defaultReason =
      'GlowApp necesita este permiso para brindarte la funcionalidad '
      'solicitada.';

  /// Mensaje de justificación mostrado al usuario para [permission].
  static String reasonFor(Permission permission) {
    if (permission == Permission.location ||
        permission == Permission.locationWhenInUse) {
      return _locationReason;
    }
    if (permission == Permission.microphone) {
      return _microphoneReason;
    }
    return _defaultReason;
  }

  /// Título human-readable del permiso.
  static String _titleFor(Permission permission) {
    switch (permission) {
      case Permission.location:
      case Permission.locationWhenInUse:
        return 'Permiso de ubicación';
      case Permission.microphone:
        return 'Permiso de micrófono';
      default:
        return 'Permiso necesario';
    }
  }

  /// Muestra el diálogo de rationale. Devuelve `true` si el usuario acepta
  /// continuar con la solicitud de permiso, `false` si cancela.
  ///
  /// No realiza llamadas de plataforma: el llamador decide cuándo mostrarlo
  /// (por ejemplo, solo cuando el permiso está en estado `denied`).
  static Future<bool> showRationaleDialog(
    BuildContext context,
    Permission permission,
  ) async {
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(_titleFor(permission)),
        content: Text('${reasonFor(permission)}\n\n¿Deseas continuar?'),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Continuar'),
          ),
        ],
      ),
    );
    return accepted ?? false;
  }
}
