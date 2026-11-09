// apps/glow_client/test/mutaciones_con_auth_test.dart
//
// Regla de producto: se puede explorar sin cuenta, pero toda interacción que
// escribe en la base exige sesión. Este test es un tripwire estático: si alguien
// quita una de las puertas, falla. No reemplaza a los widget tests; cubre el
// hueco de que un gate eliminado no rompe ningún otro test.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// (archivo, etiqueta de la acción en AuthGate, llamada que muta)
const _puertas = <List<String>>[
  ['lib/screens/client_bookings_screen.dart', 'cancelar una cita', 'ApiService.cancelBooking('],
  ['lib/screens/client_bookings_screen.dart', 'reprogramar una cita', 'showRescheduleSheet('],
  ['lib/screens/client_bookings_screen.dart', 'dejar una resena', 'showServiceReviewSheet('],
  ['lib/screens/client_bookings_screen.dart', 'pagar una cita', 'createBookingPaymentLink('],
  ['lib/screens/client_bookings_screen.dart', 'dar propina', 'ApiService.submitTip('],
  ['lib/screens/chat_screen.dart', 'enviar mensajes', 'ApiService.sendChatMessage('],
  ['lib/screens/store_screen.dart', 'comprar en GlowShop', "ApiService.post('/api/store/checkout'"],
];

void main() {
  test('cada mutación tiene su puerta de sesión antes de tocar la base', () {
    for (final puerta in _puertas) {
      final archivo = puerta[0];
      final etiqueta = puerta[1];
      final llamada = puerta[2];

      final src = File(archivo).readAsStringSync();
      expect(src.contains('AuthGate.requerir'), isTrue,
          reason: '$archivo no usa AuthGate');

      final indiceEtiqueta = src.indexOf("accion: '$etiqueta'");
      expect(indiceEtiqueta, greaterThan(-1),
          reason: '$archivo perdió la puerta «$etiqueta»');

      final indiceLlamada = src.indexOf(llamada);
      expect(indiceLlamada, greaterThan(-1),
          reason: '$archivo ya no llama a $llamada');

      expect(indiceEtiqueta, lessThan(indiceLlamada),
          reason: 'en $archivo la puerta «$etiqueta» quedó después de $llamada');
    }
  });

  test('la tienda se navega sin cuenta, pero el checkout pide sesión', () {
    final nav = File('lib/screens/providers_screen.dart').readAsStringSync();
    expect(nav.contains("_checkAuthAndNavigate('/store', requiereSesion: false)"), isTrue,
        reason: 'la tienda debe poder explorarse sin cuenta');

    final tienda = File('lib/screens/store_screen.dart').readAsStringSync();
    expect(tienda.contains("accion: 'comprar en GlowShop'"), isTrue,
        reason: 'el checkout tiene que pedir sesión');
  });

  test('Glow IA+ navega libre y pide cuenta después de la autorización', () {
    final nav = File('lib/screens/providers_screen.dart').readAsStringSync();
    expect(
        nav.contains("_checkAuthAndNavigate('/ideas/welcome', requiereSesion: false)"),
        isTrue,
        reason: 'Glow IA+ debe abrirse sin cuenta');

    final welcome = File('lib/screens/welcome_screen.dart').readAsStringSync();
    expect(welcome.contains("accion: 'usar Glow IA+'"), isTrue,
        reason: 'falta la puerta de Glow IA+');
    // Hay dos puertas: una cuando el consentimiento ya estaba vigente y otra
    // al aceptarlo. La segunda tiene que vivir DENTRO de _handleStartScan.
    final indiceMetodo = welcome.indexOf('_handleStartScan(BuildContext context) async {');
    final indiceGateEnMetodo = welcome.indexOf("accion: 'usar Glow IA+'", indiceMetodo);
    expect(indiceGateEnMetodo, greaterThan(-1),
        reason: 'la cuenta debe pedirse dentro del flujo, no antes');
  });
}
