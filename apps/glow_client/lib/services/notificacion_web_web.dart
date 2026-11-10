// Implementación web: usa la API de notificaciones del navegador.
import 'package:web/web.dart' as web;

/// Pinta una notificación del sistema si el usuario ya dio permiso.
///
/// Si no hay permiso no se pide aquí: pedirlo fuera de un gesto lo bloquea el
/// navegador. El permiso se gestiona en Ajustes → Notificaciones.
void mostrarNotificacionWeb(String titulo, String cuerpo) {
  if (web.Notification.permission != 'granted') return;
  web.Notification(
    titulo,
    web.NotificationOptions(body: cuerpo, icon: '/icons/Icon-192.png'),
  );
}
