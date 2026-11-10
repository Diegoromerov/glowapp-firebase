// Muestra una notificación del navegador cuando llega un push con la app en
// primer plano.
//
// Sin esto, `FirebaseMessaging.onMessage` en web no pinta nada: el mensaje se
// descarta y el usuario no ve nada aunque FCM lo haya entregado. En segundo
// plano lo pinta el service worker; en primer plano hay que pintarlo aquí.
//
// Este archivo es el stub; la versión real es `notificacion_web_web.dart` y se
// elige con import condicional para no meter `package:web` en móvil.

/// No hace nada fuera de web.
void mostrarNotificacionWeb(String titulo, String cuerpo) {}
