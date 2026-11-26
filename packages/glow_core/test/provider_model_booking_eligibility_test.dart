import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/glow_core.dart';

void main() {
  test('el modelo falla cerrado si el backend no informa elegibilidad', () {
    final provider = ProviderModel.fromJson({'id': '42'});

    expect(provider.canReceiveBookings, isFalse);
  });

  test('el modelo propaga la elegibilidad enviada por la API', () {
    final provider = ProviderModel.fromJson({
      'id': '42',
      'can_receive_bookings': true,
    });

    expect(provider.canReceiveBookings, isTrue);
    expect(provider.toJson()['can_receive_bookings'], isTrue);
  });
}
