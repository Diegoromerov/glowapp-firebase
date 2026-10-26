// frontend/lib/services/web_geolocation_stub.dart
import 'package:geolocator/geolocator.dart';

Future<Map<String, double>> getWebGeolocation() async {
  try {
    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      return {'lat': 4.6735, 'lon': -74.1422};
    }

    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        return {'lat': 4.6735, 'lon': -74.1422};
      }
    }

    if (permission == LocationPermission.deniedForever) {
      return {'lat': 4.6735, 'lon': -74.1422};
    }

    final Position position = await Geolocator.getCurrentPosition(
      desiredAccuracy: LocationAccuracy.high,
      timeLimit: const Duration(seconds: 5),
    );
    return {'lat': position.latitude, 'lon': position.longitude};
  } catch (_) {
    return {'lat': 4.6735, 'lon': -74.1422};
  }
}
