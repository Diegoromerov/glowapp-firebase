// frontend/lib/services/dispute_service.dart
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'api_service.dart';
import 'auth_service.dart';

class DisputeService {
  static Future<Map<String, dynamic>?> createDispute({
    required String bookingId,
    required String tipo,
    required String descripcion,
    List<String>? evidenciaUrls,
  }) async {
    final baseUrl = await AuthService.getBaseUrl();
    final token = await AuthService.getToken();
    if (token == null) return null;

    final response = await http.post(
      Uri.parse('$baseUrl/api/disputes'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
        'X-App-Audience': ApiService.appAudience,
      },
      body: json.encode({
        'booking_id': bookingId,
        'tipo': tipo,
        'descripcion': descripcion,
        'evidencia_urls': evidenciaUrls ?? [],
      }),
    );

    if (response.statusCode == 201) {
      return json.decode(response.body);
    }
    return null;
  }

  static Future<List<Map<String, dynamic>>?> getMyDisputes() async {
    final baseUrl = await AuthService.getBaseUrl();
    final token = await AuthService.getToken();
    if (token == null) return null;

    final response = await http.get(
      Uri.parse('$baseUrl/api/disputes/my-disputes'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
        'X-App-Audience': ApiService.appAudience,
      },
    );

    if (response.statusCode == 200) {
      final decoded = json.decode(response.body);
      if (decoded['data'] != null) {
        return List<Map<String, dynamic>>.from(decoded['data']);
      }
    }
    return null;
  }

  static Future<Map<String, dynamic>?> getDisputeById(String disputeId) async {
    final baseUrl = await AuthService.getBaseUrl();
    final token = await AuthService.getToken();
    if (token == null) return null;

    final response = await http.get(
      Uri.parse('$baseUrl/api/disputes/$disputeId'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
        'X-App-Audience': ApiService.appAudience,
      },
    );

    if (response.statusCode == 200) {
      final decoded = json.decode(response.body);
      if (decoded['data'] != null) {
        return Map<String, dynamic>.from(decoded['data']);
      }
    }
    return null;
  }

  static Future<Map<String, dynamic>?> sendMessage({
    required String disputeId,
    required String message,
    List<String>? evidenceUrls,
  }) async {
    final baseUrl = await AuthService.getBaseUrl();
    final token = await AuthService.getToken();
    if (token == null) return null;
    final response = await http.post(
      Uri.parse('$baseUrl/api/disputes/$disputeId/messages'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
        'X-App-Audience': ApiService.appAudience,
      },
      body: json.encode({
        'mensaje': message,
        'evidencia_urls': evidenceUrls ?? [],
      }),
    );
    if (response.statusCode == 201) return json.decode(response.body);
    return null;
  }
}
