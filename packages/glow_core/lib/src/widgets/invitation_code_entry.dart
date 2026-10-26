// frontend/lib/widgets/invitation_code_entry.dart
import 'package:flutter/material.dart';

/// Pide el código de invitación de equipo y navega a la pantalla de aceptación.
///
/// Vive fuera de las pantallas porque al flujo se entra desde dos sitios: el
/// login (el colaborador invitado todavía no tiene sesión) y el perfil (ya la
/// tiene). La ruta `/accept-invitation` existía en `main.dart` y la pantalla de
/// aceptación estaba construida, pero NINGUNA pantalla navegaba a ella: el dueño
/// copiaba un enlace y el colaborador no tenía forma de consumirlo, así que la
/// invitación moría sin que nadie se enterara.
Future<void> pedirCodigoInvitacion(BuildContext context) async {
  final messenger = ScaffoldMessenger.of(context);
  final navigator = Navigator.of(context);
  final controller = TextEditingController();

  final pegado = await showDialog<String>(
    context: context,
    builder: (dialogCtx) => AlertDialog(
      title: const Text('Código de invitación'),
      content: TextField(
        controller: controller,
        autofocus: true,
        maxLines: 2,
        decoration: const InputDecoration(
          hintText: 'Pega el código o el enlace completo',
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogCtx),
          child: const Text('Cancelar'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(dialogCtx, controller.text.trim()),
          child: const Text('Continuar'),
        ),
      ],
    ),
  );
  controller.dispose();

  if (pegado == null || pegado.isEmpty) return;

  // Sirve tanto el token suelto como la URL que copia el dueño, que lo lleva
  // en ?token=<32 hex>.
  final match = RegExp(r'[0-9a-fA-F]{32}').firstMatch(pegado);
  if (match == null) {
    messenger.showSnackBar(const SnackBar(
      content: Text('El código debe tener 32 caracteres hexadecimales.'),
    ));
    return;
  }

  navigator.pushNamed('/accept-invitation', arguments: match.group(0));
}
