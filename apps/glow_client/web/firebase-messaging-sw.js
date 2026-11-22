// Service worker de mensajería (web push).
//
// La configuración de Firebase llega por query string al registrarlo, así que no
// hay credenciales escritas aquí ni hace falta inyectarlas en el build: el
// cliente conoce su propia configuración (son claves públicas de la app web).
//
// Se registra desde `push_service.dart` como
// /firebase-messaging-sw.js?apiKey=…&projectId=…&messagingSenderId=…&appId=…

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// El navegador suele resumir errores de evaluación del worker como un mensaje
// genérico. Registra la excepción original para poder distinguir fallos de red,
// compatibilidad o inicialización sin mostrar credenciales.
self.addEventListener('error', (event) => {
  console.error('[GlowApp FCM SW] Error al evaluar el worker:', {
    message: event.message,
    source: event.filename,
    line: event.lineno,
    column: event.colno,
    stack: event.error && event.error.stack,
  });
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[GlowApp FCM SW] Promesa rechazada al iniciar el worker:',
    event.reason && (event.reason.stack || event.reason.message || event.reason));
});

const params = new URL(self.location).searchParams;
const config = {
  apiKey: params.get('apiKey') || '',
  projectId: params.get('projectId') || '',
  messagingSenderId: params.get('messagingSenderId') || '',
  appId: params.get('appId') || '',
};

// La configuración preferida viene de Hosting, que sirve las claves públicas
// del proyecto en /__/firebase/init.js. Antes solo se usaban los parámetros de
// la URL: si faltaba uno, el worker se registraba, recibía los push y se
// quedaba mudo sin avisar.
try {
  importScripts('/__/firebase/init.js');
} catch (e) {
  console.warn('[sw] sin /__/firebase/init.js:', e && e.message);
}

if (!firebase.apps.length &&
    config.apiKey && config.projectId && config.messagingSenderId && config.appId) {
  firebase.initializeApp(config);
}

// Con la app inicializada por cualquiera de las dos vías, el manejador se
// registra siempre. Antes vivía dentro del `if` de los parámetros, así que si
// la configuración llegaba por Hosting el worker no escuchaba nada.
if (firebase.apps.length) {
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const n = payload.notification || {};
    self.registration.showNotification(n.title || 'GlowApp', {
      body: n.body || '',
      icon: '/icons/Icon-192.png',
      data: payload.data || {},
    });
  });

  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const bookingId = (event.notification.data || {}).bookingId;
    const destino = bookingId ? `/#/my-bookings?id=${bookingId}` : '/#/my-bookings';
    event.waitUntil(clients.openWindow(destino));
  });
}
