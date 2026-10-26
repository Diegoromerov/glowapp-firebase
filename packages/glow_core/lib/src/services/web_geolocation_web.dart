// frontend/lib/services/web_geolocation_web.dart
import 'dart:async';
import 'dart:js' as js;

Future<Map<String, double>> getWebGeolocation() async {
  try {
    final completer = Completer<Map<String, double>>();
    final geolocation = js.context['navigator']['geolocation'];
    if (geolocation != null) {
      geolocation.callMethod('getCurrentPosition', [
        (position) {
          final coords = position['coords'];
          final double lat =
              double.tryParse(coords['latitude']?.toString() ?? '') ?? 4.6735;
          final double lon =
              double.tryParse(coords['longitude']?.toString() ?? '') ??
                  -74.1422;
          completer.complete({'lat': lat, 'lon': lon});
        },
        (error) {
          completer.complete({'lat': 4.6735, 'lon': -74.1422});
        }
      ]);
      return await completer.future.timeout(
        const Duration(seconds: 4),
        onTimeout: () => {'lat': 4.6735, 'lon': -74.1422},
      );
    }
  } catch (_) {}
  return {'lat': 4.6735, 'lon': -74.1422};
}
