import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'api_service.dart';
import 'secure_storage_service.dart';
import 'fcm_service.dart';

class AuthService {
  /// Estado de sesión cacheado en memoria.
  ///
  /// En web, leer el almacén cifrado (IndexedDB + WebCrypto) puede tardar más de
  /// un segundo en el primer acceso. Consultarlo en cada toque hacía que una
  /// lectura lenta se interpretara como «sin sesión» y mandara a login a un
  /// usuario autenticado. Se hidrata una vez y se mantiene al día en login/logout.
  static bool? _sesionActiva;

  /// true solo si ya se confirmó una sesión desde el arranque o el login.
  static bool get sesionActivaEnMemoria => _sesionActiva == true;

  /// Marca el estado en memoria (login, logout, o comprobación definitiva).
  static void marcarSesion(bool activa) => _sesionActiva = activa;

  /// Hidrata el cache leyendo el token UNA vez. Si el almacén no responde a
  /// tiempo, no se cachea nada: la próxima comprobación vuelve a intentar.
  static Future<bool> hidratarSesion({Duration timeout = const Duration(seconds: 4)}) async {
    if (_sesionActiva != null) return _sesionActiva!;
    try {
      final token = await getToken().timeout(timeout);
      _sesionActiva = token != null && token.isNotEmpty;
      return _sesionActiva!;
    } catch (_) {
      return false;
    }
  }

  /// Cabeceras JSON del backend.
  ///
  /// Incluye `X-App-Audience` porque el backend la exige globalmente en /api
  /// (app.use('/api', validateAppAudience({required:true})) en index.js:252,
  /// registrado ANTES de app.use('/api/auth', authRoutes)). Sin la cabecera,
  /// /api/auth/google responde 400 y el login muere antes de validar el token.
  static Map<String, String> get _jsonHeaders => {
        'Content-Type': 'application/json',
        'X-App-Audience': ApiService.appAudience,
      };

  static Future<String> getBaseUrl() async {
    await ApiService.ensureBaseUrl();
    return ApiService.baseUrl;
  }

  static Future<bool> register(String fullName, String email, String password,
      String? phone, String role, {String? ref}) async {
    final baseUrl = await getBaseUrl();
    final response = await http.post(
      Uri.parse('$baseUrl/api/auth/register'),
      headers: _jsonHeaders,
      body: json.encode({
        'full_name': fullName,
        'email': email,
        'password': password,
        'phone': phone,
        'role': role,
        // Código de invitación (`?ref=`). El backend lo ignora si es inválido.
        if (ref != null && ref.trim().isNotEmpty) 'ref': ref.trim(),
      }),
    );
    return response.statusCode == 201;
  }

  static Future<Map<String, dynamic>?> login(
      String email, String password) async {
    final baseUrl = await getBaseUrl();
    final response = await http.post(
      Uri.parse('$baseUrl/api/auth/login'),
      headers: _jsonHeaders,
      body: json.encode({'email': email, 'password': password}),
    );
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      final prefs = await SharedPreferences.getInstance();

      // 🛡️ FIX-FLUTTER-03: el JWT vive ÚNICAMENTE en almacenamiento cifrado.
      // Antes se duplicaba en SharedPreferences (localStorage en web, texto
      // plano) y cualquier XSS podía exfiltrarlo. Se eliminó esa copia.
      await SecureStorageService().write('token', data['token']);
      marcarSesion(true);

      await prefs.setString('userId', data['user']['id'].toString());
      await prefs.setString('userName', data['user']['full_name']);
      // El perfil lo lee de aquí: antes no se guardaba y la pantalla
      // mostraba un correo de ejemplo escrito en el código.
      final correo = data['user']['email']?.toString();
      if (correo != null && correo.trim().isNotEmpty) {
        await prefs.setString('userEmail', correo.trim());
      }
      if (data['user']['role'] != null) {
        await prefs.setString('userRole', data['user']['role']);
      }

      // 🔔 Registrar token FCM tras login exitoso
      await FcmService.instance.registerToken();

      return data;
    }
    return null;
  }

  /// Restores the current server session after the local biometric prompt.
  /// It never stores a password; the encrypted JWT remains subject to server
  /// expiry/revocation checks through /api/auth/session.
  static Future<Map<String, dynamic>?> restoreBiometricSession() async {
    final token = await getToken();
    if (token == null || token.isEmpty) return null;
    final baseUrl = await getBaseUrl();
    final response = await http.get(
      Uri.parse('$baseUrl/api/auth/session'),
      headers: {
        ..._jsonHeaders,
        'Authorization': 'Bearer $token',
      },
    ).timeout(const Duration(seconds: 10));
    if (response.statusCode != 200) return null;

    final decoded = json.decode(response.body) as Map<String, dynamic>;
    final serverUser = Map<String, dynamic>.from(decoded['user'] as Map);
    final prefs = await SharedPreferences.getInstance();
    return {
      'token': token,
      'user': {
        ...serverUser,
        'full_name': prefs.getString('userName') ?? '',
        'email': serverUser['email'] ?? prefs.getString('userEmail') ?? '',
      },
    };
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
      headers: _jsonHeaders,
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
      marcarSesion(true);

      await prefs.setString('userId', data['user']['id'].toString());
      await prefs.setString('userName', data['user']['full_name']);
      // El perfil lo lee de aquí: antes no se guardaba y la pantalla
      // mostraba un correo de ejemplo escrito en el código.
      final correo = data['user']['email']?.toString();
      if (correo != null && correo.trim().isNotEmpty) {
        await prefs.setString('userEmail', correo.trim());
      }
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
        ..._jsonHeaders,
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
    // La sesión deja de existir en la app aunque el aviso al backend falle.
    marcarSesion(false);
    try {
      final baseUrl = await getBaseUrl();
      final token = await getToken();
      if (token != null) {
        await http.post(
          Uri.parse('$baseUrl/api/auth/logout'),
          headers: {
            ..._jsonHeaders,
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
      headers: _jsonHeaders,
      body: json.encode({'email': email}),
    );
    final decoded = json.decode(response.body);
    if (decoded is Map<String, dynamic>) {
      if (response.statusCode >= 400) {
        return {
          'error': decoded['message'] ??
              decoded['error'] ??
              'No se pudo solicitar el código.'
        };
      }
      return decoded;
    }
    return {'error': 'Respuesta inesperada del servidor.'};
  }

  static Future<Map<String, dynamic>> resetPassword({
    required String email,
    required String otp,
    required String newPassword,
  }) async {
    final baseUrl = await getBaseUrl();
    final response = await http.post(
      Uri.parse('$baseUrl/api/auth/reset-password'),
      headers: _jsonHeaders,
      body: json.encode({
        'email': email,
        'otp': otp,
        'new_password': newPassword,
      }),
    );
    final decoded = json.decode(response.body);
    if (decoded is Map<String, dynamic>) {
      if (response.statusCode >= 400) {
        return {
          'error': decoded['message'] ??
              decoded['error'] ??
              'No se pudo restablecer la contraseña.'
        };
      }
      return decoded;
    }
    return {'error': 'Respuesta inesperada del servidor.'};
  }

  static Future<Map<String, dynamic>?> loginWithGoogle(String idToken,
      {String? roleIntent}) async {
    final baseUrl = await getBaseUrl();
    // Se lee aquí y no se pasa por parámetro: todos los botones de Google de la
    // app entran por este método y ninguno tendría que acordarse de enviarlo.
    final prefs = await SharedPreferences.getInstance();
    final _codigoInvitacionGuardado =
        (prefs.getString('codigoInvitacionPendiente') ?? '').trim();
    final response = await http.post(
      Uri.parse('$baseUrl/api/auth/google'),
      headers: _jsonHeaders,
      body: json.encode({
        'idToken': idToken,
        if (roleIntent != null) 'role_intent': roleIntent,
        // Invitación pendiente: quien entra con Google también puede venir de un
        // enlace. Sin esto, la cuenta nacía sin referente y el premio se perdía.
        if (_codigoInvitacionGuardado.isNotEmpty) 'ref': _codigoInvitacionGuardado,
      }),
    );
    try {
      final data = json.decode(response.body);
      if (response.statusCode == 200 && data is Map<String, dynamic>) {
        final prefs = await SharedPreferences.getInstance();
        if (data['token'] != null) {
          await SecureStorageService().write('token', data['token']);
      marcarSesion(true);
        }
        if (data['user'] != null) {
          await prefs.setString('userId', data['user']['id'].toString());
          await prefs.setString('userName', data['user']['full_name']);
          // El perfil lo lee de aquí: antes no se guardaba y la pantalla
          // mostraba un correo de ejemplo escrito en el código.
          final correo = data['user']['email']?.toString();
          if (correo != null && correo.trim().isNotEmpty) {
            await prefs.setString('userEmail', correo.trim());
          }
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

  /// Login con Facebook.
  ///
  /// El cliente entrega el `accessToken` que emite el SDK de Facebook; el backend
  /// lo verifica contra la Graph API y emite el JWT de GlowApp. Mismo contrato de
  /// respuesta que [loginWithGoogle], así que el llamador reutiliza el guardado de
  /// token y el registro de FCM.
  ///
  /// Requiere: app de Facebook creada (App ID) y el endpoint
  /// `POST /api/auth/facebook` en el backend.
  static Future<Map<String, dynamic>?> loginWithFacebook(String accessToken,
      {String? roleIntent}) async {
    final baseUrl = await getBaseUrl();
    final response = await http.post(
      Uri.parse('$baseUrl/api/auth/facebook'),
      headers: _jsonHeaders,
      body: json.encode({
        'accessToken': accessToken,
        if (roleIntent != null) 'role_intent': roleIntent,
      }),
    );
    try {
      final data = json.decode(response.body);
      if (response.statusCode == 200 && data is Map<String, dynamic>) {
        final prefs = await SharedPreferences.getInstance();
        if (data['token'] != null) {
          await SecureStorageService().write('token', data['token']);
      marcarSesion(true);
        }
        if (data['user'] != null) {
          await prefs.setString('userId', data['user']['id'].toString());
          await prefs.setString('userName', data['user']['full_name']);
          // El perfil lo lee de aquí: antes no se guardaba y la pantalla
          // mostraba un correo de ejemplo escrito en el código.
          final correo = data['user']['email']?.toString();
          if (correo != null && correo.trim().isNotEmpty) {
            await prefs.setString('userEmail', correo.trim());
          }
          if (data['user']['role'] != null) {
            await prefs.setString('userRole', data['user']['role']);
          }
        }
        await FcmService.instance.registerToken();
        return data;
      }
      if (data is Map<String, dynamic>) return data;
    } catch (_) {}
    return null;
  }

  /// Fallback para cuando google_sign_in_web devuelve accessToken pero no idToken
  /// (comportamiento de GIS en google_sign_in 6.x con popup flow)
  static Future<Map<String, dynamic>?> loginWithGoogleAccessToken(
      String accessToken) async {
    final baseUrl = await getBaseUrl();
    final response = await http.post(
      Uri.parse('$baseUrl/api/auth/google'),
      headers: _jsonHeaders,
      body: json.encode({'accessToken': accessToken}),
    );
    try {
      final data = json.decode(response.body);
      if (response.statusCode == 200 && data is Map<String, dynamic>) {
        final prefs = await SharedPreferences.getInstance();
        if (data['token'] != null) {
          await SecureStorageService().write('token', data['token']);
      marcarSesion(true);
        }
        if (data['user'] != null) {
          await prefs.setString('userId', data['user']['id'].toString());
          await prefs.setString('userName', data['user']['full_name']);
          // El perfil lo lee de aquí: antes no se guardaba y la pantalla
          // mostraba un correo de ejemplo escrito en el código.
          final correo = data['user']['email']?.toString();
          if (correo != null && correo.trim().isNotEmpty) {
            await prefs.setString('userEmail', correo.trim());
          }
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
        ..._jsonHeaders,
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
        ..._jsonHeaders,
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
        ..._jsonHeaders,
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

  static Future<Map<String, dynamic>?> acceptSalonInvitation(
      String tokenParam) async {
    final baseUrl = await getBaseUrl();
    final token = await getToken();
    if (token == null) return null;
    final response = await http.post(
      Uri.parse('$baseUrl/api/salon/accept-invitation'),
      headers: {
        ..._jsonHeaders,
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
        ..._jsonHeaders,
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

  static Future<Map<String, dynamic>?> switchContext(
      String businessProfileId) async {
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
        marcarSesion(true);
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

/// Código de invitación que trae la URL de arranque (`#/auth/register?ref=...`),
/// o `null`. En web se lee del fragmento; en móvil llega por el registro normal
/// y la app lo pasa explícito.
/// Normaliza un código de invitación escrito a mano.
///
/// La gente lo copia con espacios, en minúsculas o con el enlace completo
/// pegado por error. Se limpia todo eso aquí y no en el backend: el formato del
/// código es un asunto de la app.
String normalizarCodigoInvitacion(String? crudo) {
  if (crudo == null) return '';
  var limpio = crudo.trim();
  // Si pegó el enlace entero, delegar en quien ya sabe leerlo: el `ref` puede
  // venir en la query o —como en la web— dentro del fragmento (`#/register?ref=`),
  // y ahí `queryParameters` no lo ve.
  if (limpio.contains('://') || limpio.contains('ref=')) {
    final enlace = Uri.tryParse(limpio);
    final delEnlace = enlace == null ? null : codigoInvitacionDeLaUrl(enlace);
    if (delEnlace != null && delEnlace.trim().isNotEmpty) limpio = delEnlace;
  }
  limpio = limpio.toUpperCase();
  // Sólo letras y números: fuera comillas, guiones de más y saltos de línea.
  limpio = limpio.replaceAll(RegExp(r'[^A-Z0-9]'), '');
  return limpio;
}

String? codigoInvitacionDeLaUrl(Uri url) {
  final delFragmento = Uri.splitQueryString(
    url.fragment.contains('?') ? url.fragment.split('?').last : '',
  );
  final deLaQuery = url.queryParameters;
  final codigo = delFragmento['ref'] ?? deLaQuery['ref'];
  final limpio = codigo?.trim();
  return (limpio == null || limpio.isEmpty) ? null : limpio;
}
