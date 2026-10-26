import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

class BookingRecoveryService {
  static const String _key = 'pending_booking_recovery';

  static Future<void> savePendingBooking({
    required String bookingId,
    required String serviceName,
    required double price,
    required String providerName,
  }) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final data = {
        'bookingId': bookingId,
        'serviceName': serviceName,
        'price': price,
        'providerName': providerName,
        'timestamp': DateTime.now().millisecondsSinceEpoch,
      };
      await prefs.setString(_key, jsonEncode(data));
    } catch (_) {}
  }

  static Future<Map<String, dynamic>?> getPendingBooking() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_key);
      if (raw == null) return null;

      final data = jsonDecode(raw) as Map<String, dynamic>;
      final timestamp = data['timestamp'] as int? ?? 0;
      final diff = DateTime.now().millisecondsSinceEpoch - timestamp;

      // Expirar después de 30 minutos (1800000 ms)
      if (diff > 1800000) {
        await clearPendingBooking();
        return null;
      }
      return data;
    } catch (_) {
      return null;
    }
  }

  static Future<void> clearPendingBooking() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_key);
    } catch (_) {}
  }
}
