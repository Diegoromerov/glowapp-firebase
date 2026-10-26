import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'api_service.dart';
import 'secure_storage_service.dart';
import 'fcm_service.dart';

class AuthService {
  static Future<String> getBaseUrl() async {
    await ApiService.ensureBaseUrl();
    return ApiService.baseUrl;
  }

  static Future<bool> register(String fullName, String email, String password,
      String? phone, String role) async {
    final baseUrl = await getBaseUrl();
    final response = await http.post(
      Uri.parse('$baseUrl/api/auth/register'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({
        'full_name': fullName,
        'email': email,
        'password': password,
        'phone': phone,
        'role': role,
      }),
    );
    return response.statusCode == 201;
  }

  static Future<Map<String, dynamic>?> login(
      String email, String password) async {
    final baseUrl = await getBaseUrl();
    final response = await http.post(
      Uri.parse('$baseUrl/api/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({'email': email, 'password': password}),
    );
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      final prefs = await SharedPreferences.getInstance();

      // 🛡️ FIX-FLUTTER-03: el JWT vive ÚNICAMENTE en almacenamiento cifrado.
      // Antes se duplicaba en SharedPreferences (localStorage en web, texto
      // plano) y cualquier XSS podía exfiltrarlo. Se eliminó esa copia.
      await SecureStorageService().write('token', data['token']);

      await prefs.setString('userId', data['user']['id'].toString());
      await prefs.setString('userName', data['user']['full_name']);
      if (data['user']['role'] != null) {
        await prefs.setString('userRole', data['user']['role']);
      }

      // 🔔 Registrar token FCM tras login exitoso
      await FcmService.instance.registerToken();

      return data;
    }
    return null;
  }

  static Future<Map<String, dynamic>?> loginOAuth({
    required String email,
    required String nombre,
    required String fotoUrl,
    required String authProvider,
    required String providerId,
  }) async {
    final baseUrl = await getBaseUrl();
    final response = await http.post(
      Uri.parse('$baseUrl/api/auth/oauth'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({
        'email': email,
        'nombre': nombre,
        'foto_url': fotoUrl,
        'auth_provider': authProvider,
        'provider_id': providerId,
      }),
    );
    if (response.statusCode == 200) {
          final data = json.decode(response.body);
          final prefs = await SharedPreferences.getInstance();

          // 🛡️ PARCHE DE SEGURIDAD (GLOW-SEC-02): Guardar el token en almacenamiento cifrado
          await SecureStorageService().write('token', data['token']);

          await prefs.setString('userId', data['user']['id'].toString());
          await prefs.setString('userName', data['user']['full_name']);
          if (data['user']['role'] != null) {
            await prefs.setString('userRole', data['user']['role']);
          }

          // 🔔 Registrar token FCM tras login OAuth exitoso
          await FcmService.instance.registerToken();

          return data;
        }
    return null;
  }

  static Future<Map<String, dynamic>?> completeOnboarding({
    required String role,
    String? documentoIdUrl,
    String? rutUrl,
    String? certificacionUrl,
    required bool aceptarHabeasData,
    required bool aceptarTerminos,
  }) async {
    final baseUrl = await getBaseUrl();
    final token = await getToken();
    if (token == null) return null;
    final response = await http.patch(
      Uri.parse('$baseUrl/api/auth/onboarding'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: json.encode({
        'rol': role,
        'documento_id_url': documentoIdUrl,
        'rut_url': rutUrl,
        'certificacion_url': certificacionUrl,
        'aceptar_habeas_data': aceptarHabeasData,
        'aceptar_terminos': aceptarTerminos,
      }),
    );
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      final prefs = await SharedPreferences.getInstance();
      if (data['user'] != null && data['user']['role'] != null) {
        await prefs.setString('userRole', data['user']['role']);
      }
      return data;
    }
    return null;
  }

  static Future<String?> getToken() async {
    // 🛡️ FIX-FLUTTER-03: el token se lee SOLO de almacenamiento cifrado.
    // Antes había un fallback a SharedPreferences (localStorage en web, texto
    // plano) que se activaba justo cuando el almacén cifrado lanzaba — es decir,
    // degradaba a lo inseguro ante el error. Si el almacén cifrado no responde,
    // se devuelve null en vez de exponer el token a un XSS.
    try {
      final token = await SecureStorageService().read('token');
      return (token != null && token.isNotEmpty) ? token : null;
    } catch (_) {
      return null;
    }
  }

  static Future<void> logout() async {
    try {
      final baseUrl = await getBaseUrl();
      final token = await getToken();
      if (token != null) {
        await http.post(
          Uri.parse('$baseUrl/api/auth/logout'),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $token',
          },
        ).timeout(const Duration(seconds: 5));
      }
    } catch (_) {}

    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
    // 🛡️ PARCHE DE SEGURIDAD (GLOW-SEC-02): Limpiar almacenamiento cifrado
    await SecureStorageService().clearAll();
    ApiService.resetCachedBaseUrl();

    // 🔔 Limpiar token FCM en logout
    await FcmService.instance.clearTokenOnLogout();
  }

  static Future<Map<String, dynamic>> forgotPassword(String email) async {
    final baseUrl = await getBaseUrl();
    final response = await http.post(
      Uri.parse('$baseUrl/api/auth/forgot-password'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({'email': email}),
    );
    return json.decode(response.body);
  }

  static Future<Map<String, dynamic>> resetPassword({
    required String email,
    required String otp,
    required String newPassword,
  }) async {
    final baseUrl = await getBaseUrl();
    final response = await http.post(
      Uri.parse('$baseUrl/api/auth/reset-password'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({
        'email': email,
        'otp': otp,
        'new_password': newPassword,
      }),
    );
    return json.decode(response.body);
  }

  static Future<Map<String, dynamic>?> loginWithGoogle(String idToken, {String? roleIntent}) async {
    final baseUrl = await getBaseUrl();
    final response = await http.post(
      Uri.parse('$baseUrl/api/auth/google'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({
        'idToken': idToken,
        if (roleIntent != null) 'role_intent': roleIntent,
      }),
    );
    try {
      final data = json.decode(response.body);
      if (response.statusCode == 200 && data is Map<String, dynamic>) {
        final prefs = await SharedPreferences.getInstance();
        if (data['token'] != null) {
          await SecureStorageService().write('token', data['token']);
        }
        if (data['user'] != null) {
          await prefs.setString('userId', data['user']['id'].toString());
          await prefs.setString('userName', data['user']['full_name']);
          if (data['user']['role'] != null) {
            await prefs.setString('userRole', data['user']['role']);
          }
        }

        // 🔔 Registrar token FCM tras login con Google exitoso
        await FcmService.instance.registerToken();

        return data;
      }
      if (data is Map<String, dynamic>) return data;
    } catch (_) {}
    return null;
  }

  /// Fallback para cuando google_sign_in_web devuelve accessToken pero no idToken
  /// (comportamiento de GIS en google_sign_in 6.x con popup flow)
  static Future<Map<String, dynamic>?> loginWithGoogleAccessToken(String accessToken) async {
    final baseUrl = await getBaseUrl();
    final response = await http.post(
      Uri.parse('$baseUrl/api/auth/google'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({'accessToken': accessToken}),
    );
    try {
      final data = json.decode(response.body);
      if (response.statusCode == 200 && data is Map<String, dynamic>) {
        final prefs = await SharedPreferences.getInstance();
        if (data['token'] != null) {
          await SecureStorageService().write('token', data['token']);
        }
        if (data['user'] != null) {
          await prefs.setString('userId', data['user']['id'].toString());
          await prefs.setString('userName', data['user']['full_name']);
          if (data['user']['role'] != null) {
            await prefs.setString('userRole', data['user']['role']);
          }
        }

        // 🔔 Registrar token FCM tras login con Google (access token) exitoso
        await FcmService.instance.registerToken();

        return data;
      }
      if (data is Map<String, dynamic>) return data;
    } catch (_) {}
    return null;
  }

  static Future<bool> selectRole(String role) async {
    final baseUrl = await getBaseUrl();
    final token = await getToken();
    if (token == null) return false;
    final response = await http.post(
      Uri.parse('$baseUrl/api/auth/select-role'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: json.encode({'role': role}),
    );
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      if (data['user'] != null && data['user']['role'] != null) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('userRole', data['user']['role']);
      }
      return true;
    }
    return false;
  }

  static Future<Map<String, dynamic>?> createSalon({
    required String nombreSalon,
    String? nit,
    String? direccion,
    String? telefono,
    String? ciudad,
    double? latitude,
    double? longitude,
    bool locationPublic = true,
  }) async {
    final baseUrl = await getBaseUrl();
    final token = await getToken();
    if (token == null) return null;
    final response = await http.post(
      Uri.parse('$baseUrl/api/salon/create'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: json.encode({
        'nombre_salon': nombreSalon,
        'nit': nit,
        'direccion': direccion,
        'telefono': telefono,
        'ciudad': ciudad,
        if (latitude != null) 'latitude': latitude,
        if (longitude != null) 'longitude': longitude,
        'location_public': locationPublic,
      }),
    );
    if (response.statusCode == 201) {
      return json.decode(response.body);
    }
    return null;
  }

  static Future<Map<String, dynamic>?> inviteTeamMember({
    required int salonId,
    required String email,
    required String subRol,
  }) async {
    final baseUrl = await getBaseUrl();
    final token = await getToken();
    if (token == null) return null;
    final response = await http.post(
      Uri.parse('$baseUrl/api/salon/invite'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: json.encode({
        'salon_id': salonId,
        'email': email,
        'sub_rol': subRol,
      }),
    );
    if (response.statusCode == 200) {
      return json.decode(response.body);
    }
    return null;
  }

  static Future<Map<String, dynamic>?> acceptSalonInvitation(String tokenParam) async {
    final baseUrl = await getBaseUrl();
    final token = await getToken();
    if (token == null) return null;
    final response = await http.post(
      Uri.parse('$baseUrl/api/salon/accept-invitation'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: json.encode({'token': tokenParam}),
    );
    if (response.statusCode == 200) {
      return json.decode(response.body);
    }
    // El backend explica en el cuerpo POR QUÉ no se pudo aceptar (invitación de
    // otro correo, vencida, ya usada). Devolver null aquí tiraba ese mensaje y
    // dejaba al usuario con un "no se pudo procesar" genérico.
    try {
      final body = json.decode(response.body);
      if (body is Map<String, dynamic>) return body;
    } catch (_) {
      // respuesta sin cuerpo JSON: el llamador usa su mensaje por defecto
    }
    return null;
  }

  static Future<Map<String, dynamic>?> getMySalon() async {
    final baseUrl = await getBaseUrl();
    final token = await getToken();
    if (token == null) return null;
    final response = await http.get(
      Uri.parse('$baseUrl/api/salon/my-salon'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
    );
    if (response.statusCode == 200) {
      return json.decode(response.body);
    }
    // El backend explica en el cuerpo por qué no cargó (401, 404 sin salón, 500).
    // Devolver null aquí hacía que la pantalla no distinguiera "no tengo salón"
    // de "el servidor falló" y acabara inventando un salón.
    try {
      final body = json.decode(response.body);
      if (body is Map<String, dynamic>) return body;
    } catch (_) {
      // respuesta sin cuerpo JSON: el llamador usa su mensaje por defecto
    }
    return null;
  }

  static Future<Map<String, dynamic>?> switchContext(String businessProfileId) async {
    try {
      final baseUrl = await getBaseUrl();
      // 🛡️ FIX-FLUTTER-03: token solo desde almacenamiento cifrado.
      final authToken = await SecureStorageService().read('token');

      if (authToken == null) return null;

      final response = await http.post(
        Uri.parse('$baseUrl/api/auth/context/switch'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $authToken',
        },
        body: json.encode({'business_profile_id': businessProfileId}),
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final newToken = data['token'] as String?;
        if (newToken != null) {
          // 🛡️ FIX-FLUTTER-03: rotación de token solo en almacenamiento cifrado.
          await SecureStorageService().write('token', newToken);
        }

        if (data['active_context'] != null) {
          final prefs = await SharedPreferences.getInstance();
          await prefs.setString('activeBusinessProfileId', businessProfileId);
          final activeContext = data['active_context'] as Map<String, dynamic>;
          if (activeContext['role'] != null) {
            await prefs.setString('userRole', activeContext['role']);
          }
        }
        return data;
      }
      return null;
    } catch (e) {
      return null;
    }
  }
}
