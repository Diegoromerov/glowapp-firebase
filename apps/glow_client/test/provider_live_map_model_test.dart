import 'package:flutter_test/flutter_test.dart';
import 'package:glow_core/models/provider_model.dart';

void main() {
  Map<String, dynamic> providerJson({required DateTime capturedAt}) => {
        'id': '42',
        'latitude': 4.7000,
        'longitude': -74.1000,
        'registered_latitude': 4.6500,
        'registered_longitude': -74.0500,
        'is_live_location': true,
        'live_location_updated_at': capturedAt.toUtc().toIso8601String(),
      };

  test('usa en el mapa la ubicación GPS reciente consentida', () {
    final provider = ProviderModel.fromJson(
      providerJson(capturedAt: DateTime.now().toUtc()),
    );

    expect(provider.isLiveLocation, isTrue);
    expect(provider.mapLatitude, 4.7);
    expect(provider.mapLongitude, -74.1);
  });

  test('caduca la marca en vivo y vuelve a la ubicación registrada', () {
    final provider = ProviderModel.fromJson(
      providerJson(
        capturedAt: DateTime.now().toUtc().subtract(const Duration(minutes: 6)),
      ),
    );

    expect(provider.isLiveLocation, isFalse);
    expect(provider.mapLatitude, 4.65);
    expect(provider.mapLongitude, -74.05);
  });

  test('oculta una ubicación móvil caducada si no existe ubicación registrada',
      () {
    final json = providerJson(
      capturedAt: DateTime.now().toUtc().subtract(const Duration(minutes: 6)),
    )
      ..remove('registered_latitude')
      ..remove('registered_longitude');
    final provider = ProviderModel.fromJson(json);

    expect(provider.isLiveLocation, isFalse);
    expect(provider.hasMapCoordinate, isFalse);
  });
}
