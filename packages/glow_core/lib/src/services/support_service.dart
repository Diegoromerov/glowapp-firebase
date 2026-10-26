// frontend/lib/services/support_service.dart
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'auth_service.dart';

class SupportService {
  static Future<Map<String, dynamic>?> createTicket({
    String? bookingId,
    required String tipo,
    required String categoria,
    required String asunto,
    required String descripcion,
    List<String>? evidenciaUrls,
  }) async {
    final baseUrl = await AuthService.getBaseUrl();
    final token = await AuthService.getToken();
    if (token == null) return null;

    final response = await http.post(
      Uri.parse('$baseUrl/api/tickets'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: json.encode({
        'booking_id': bookingId,
        'tipo': tipo,
        'categoria': categoria,
        'asunto': asunto,
        'descripcion': descripcion,
        'evidencia_urls': evidenciaUrls ?? [],
      }),
    );

    if (response.statusCode == 201) {
      return json.decode(response.body);
    }
    return null;
  }

  static Future<List<Map<String, dynamic>>?> getMyTickets() async {
    final baseUrl = await AuthService.getBaseUrl();
    final token = await AuthService.getToken();
    if (token == null) return null;

    final response = await http.get(
      Uri.parse('$baseUrl/api/tickets/my-tickets'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
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

  static Future<List<Map<String, dynamic>>?> getTicketMessages(String ticketId) async {
    final baseUrl = await AuthService.getBaseUrl();
    final token = await AuthService.getToken();
    if (token == null) return null;

    final response = await http.get(
      Uri.parse('$baseUrl/api/tickets/$ticketId/messages'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
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

  static Future<Map<String, dynamic>?> createTicketMessage(String ticketId, String message) async {
    final baseUrl = await AuthService.getBaseUrl();
    final token = await AuthService.getToken();
    if (token == null) return null;

    final response = await http.post(
      Uri.parse('$baseUrl/api/tickets/$ticketId/messages'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: json.encode({
        'mensaje': message,
      }),
    );

    if (response.statusCode == 201) {
      return json.decode(response.body);
    }
    return null;
  }
}
