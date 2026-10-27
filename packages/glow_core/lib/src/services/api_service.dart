// lib/services/api_service.dart
import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
// ignore: depend_on_referenced_packages
import 'package:http_parser/http_parser.dart' as http_parser;
import '../models/provider_model.dart';
import '../models/service_model.dart';
import 'active_salon_service.dart';
import 'secure_storage_service.dart';
import 'connectivity_service.dart';

class ApiService {
  // --- CONFIGURACIÓN DE ENTORNO DE DESARROLLO / PRODUCCIÓN ---
  static const bool useStaging = false;
  static const String stagingUrl =
      'https://belleza-app-production.up.railway.app';

  static String? _cachedBaseUrl;
  static final List<String> _ports = ['8080', '8082', '3000', '3001'];

  static void resetCachedBaseUrl() {
    _cachedBaseUrl = null;
  }

  static String get _host => kIsWeb ? 'localhost' : '10.0.2.2';

  static String get baseUrl {
    const envUrl = String.fromEnvironment('API_URL');
    if (envUrl.isNotEmpty) return envUrl;
    if (useStaging) return stagingUrl;
    if (_cachedBaseUrl != null) return _cachedBaseUrl!;
    if (kIsWeb) {
      final origin = Uri.base.origin;
      if (origin.contains('glowapp-frontend') || origin.contains('frontend')) {
        return stagingUrl;
      }
      if (origin.isNotEmpty && !origin.contains('localhost') && !origin.contains('127.0.0.1')) {
        return origin;
      }
    }
    return 'http://$_host:8080';
  }

  static String get _baseUrl => baseUrl;
  static String get _apiPath => '/api';

  /// Audiencia de la app: 'client' (glow_client) o 'provider' (glow_provider).
  /// Se configura al inicio en main.dart de cada app.
  static String appAudience = 'client';

  static final List<String> _candidateHosts = [
    '10.88.245.166',
    '127.0.0.1',
    'localhost',
    '10.0.2.2',
  ];

  static Future<void> ensureBaseUrl() async {
    if (useStaging) {
      _cachedBaseUrl = stagingUrl;
      return;
    }
    if (kIsWeb) {
      final origin = Uri.base.origin;
      if (origin.contains('glowapp-frontend') || origin.contains('frontend')) {
        _cachedBaseUrl = stagingUrl;
        return;
      }
      if (origin.isNotEmpty && !origin.contains('localhost') && !origin.contains('127.0.0.1')) {
        _cachedBaseUrl = origin;
        return;
      }
    }
    if (_cachedBaseUrl != null) return;

    for (final host in _candidateHosts) {
      for (final port in _ports) {
        final url = 'http://$host:$port';
        try {
          final response = await http
              .get(Uri.parse('$url/api/health'))
              .timeout(const Duration(milliseconds: 1200));
          if (response.statusCode == 200) {
            final contentType = response.headers['content-type'] ?? '';
            if (contentType.toLowerCase().contains('application/json')) {
              final data = json.decode(response.body);
              if (data['status'] == 'OK' ||
                  data['message']?.toString().contains('funcionando') == true) {
                _cachedBaseUrl = url;
                if (kDebugMode) {
                  print('🔌 ApiService: BaseUrl detectado y fijado en $_cachedBaseUrl');
                }
                return;
              }
            }
          }
        } catch (_) {
          // Continuar al siguiente puerto/host
        }
      }
    }

    // Fallback a staging si los hosts locales no responden en dispositivo físico
    _cachedBaseUrl = stagingUrl;
    if (kDebugMode) {
      print('🔌 ApiService: Fallback automático a staging en $_cachedBaseUrl');
    }
  }

  static String normalizeUrl(String? rawUrl) {
    if (rawUrl == null || rawUrl.isEmpty) return '';

    final activeBase = Uri.parse(_baseUrl);

    if (rawUrl.startsWith('/')) {
      return '${activeBase.toString()}$rawUrl';
    }

    final parsed = Uri.tryParse(rawUrl);
    if (parsed == null || !parsed.hasScheme) return rawUrl;

    final isLocalHost =
        parsed.host == 'localhost' || parsed.host == '127.0.0.1';
    if (!isLocalHost) return rawUrl;

    return Uri(
      scheme: activeBase.scheme,
      host: activeBase.host,
      port: activeBase.port,
      path: parsed.path,
      query: parsed.query.isEmpty ? null : parsed.query,
    ).toString();
  }

  static dynamic _normalizeDynamicUrls(dynamic value) {
    if (value is Map<String, dynamic>) {
      return value.map((key, entryValue) {
        final shouldNormalize = entryValue is String &&
            const {
              'avatar_url',
              'image_url',
              'preview_url',
              'original_image_url',
              'url',
            }.contains(key);

        return MapEntry(
          key,
          shouldNormalize
              ? normalizeUrl(entryValue)
              : _normalizeDynamicUrls(entryValue),
        );
      });
    }

    if (value is List) {
      return value.map(_normalizeDynamicUrls).toList();
    }

    return value;
  }

  // 🔹 MÉTODO CENTRALIZADO PARA OBTENER HEADERS CON TOKEN
  static Future<Map<String, String>> _getAuthHeaders() async {
    await ensureBaseUrl();
    final headers = {'Content-Type': 'application/json'};
    
    // Header X-App-Audience para audience scoping en backend (Fase 4)
    // Valor: 'client' (glow_client) o 'provider' (glow_provider)
    headers['X-App-Audience'] = appAudience;
    
    final token = await _getToken();
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
      if (kDebugMode) {
        final preview = token.length > 30 ? token.substring(0, 30) : token;
        print('🔐 Token enviado: $preview...');
      }
    } else {
      if (kDebugMode) {
        print('⚠️  No hay token disponible para Authorization');
      }
    }

    try {
      final activeSalonId = ActiveSalonService.instance.activeSalonId;
      if (activeSalonId != null) {
        headers['x-active-salon-id'] = activeSalonId.toString();
      }
    } catch (e) {
      if (kDebugMode) {
        print('⚠️ Error al leer activeSalonId en _getAuthHeaders: $e');
      }
    }

    return headers;
  }

  // Exponer headers públicos para analíticas u otros servicios externos
  static Future<Map<String, String>> getAuthHeaders() => _getAuthHeaders();

  static Future<String?> _getToken() async {
    // 🛡️ FIX-FLUTTER-03: única fuente de verdad para el token. Se elimina el
    // fallback a SharedPreferences (localStorage en web, texto plano) que un XSS
    // podía exfiltrar. Antes existía una segunda instancia de FlutterSecureStorage
    // aquí; ahora se centraliza en SecureStorageService (con config web).
    try {
      final token = await SecureStorageService().read('token');
      return (token != null && token.isNotEmpty) ? token : null;
    } catch (_) {
      return null;
    }
  }

  // ─── Resiliencia de red (FIX-FLUTTER-08) ────────────────────────
  // Antes: 50 timeouts fijos de 30s duplicados, 0 reintentos y ninguna
  // detección de conectividad. Ahora: un timeout único configurable, un motor
  // de reintentos con backoff exponencial y cortocircuito si no hay red.

  /// Timeout único para todas las peticiones HTTP.
  static Duration requestTimeout = const Duration(seconds: 30);

  /// Reintentos tras el intento inicial (backoff 1x, 2x, 4x…).
  static const int maxRetries = 3;

  /// Retardo base del backoff exponencial.
  static const Duration baseRetryDelay = Duration(milliseconds: 400);

  /// `true` si [error] es transitorio y la petición admite reintento.
  ///
  /// Se clasifica por tipo y por mensaje para no importar `dart:io` aquí
  /// (rompería la compilación web del paquete).
  static bool isRetryableError(Object error) {
    if (error is OfflineException) return true;
    if (error is TimeoutException) return true;
    if (error is http.ClientException) return true;

    final type = error.runtimeType.toString();
    if (type == 'SocketException' ||
        type == 'HttpException' ||
        type == 'HandshakeException' ||
        type == 'WebSocketException') {
      return true;
    }

    final message = error.toString().toLowerCase();
    if (message.contains('timeout') ||
        message.contains('timed out') ||
        message.contains('connection') ||
        message.contains('socket') ||
        message.contains('network') ||
        message.contains('handshake') ||
        message.contains('temporarily unavailable')) {
      return true;
    }

    // 5xx, 408 y 429 son reintentables; el resto de 4xx no.
    return RegExp(r'\b(5\d\d|408|429)\b').hasMatch(message);
  }

  /// Ejecuta [request] con backoff exponencial (base, 2x, 4x…).
  ///
  /// - Sin conectividad no se envía la petición: se agota el presupuesto de
  ///   reintentos y se lanza [OfflineException].
  /// - Los errores no reintentables (4xx, validación) se propagan de inmediato.
  ///
  /// [isConnected] y [delay] son inyectables para pruebas deterministas.
  @visibleForTesting
  static Future<T> runWithRetry<T>(
    Future<T> Function() request, {
    int retries = ApiService.maxRetries,
    Duration baseDelay = ApiService.baseRetryDelay,
    Future<bool> Function()? isConnected,
    Future<void> Function(Duration duration)? delay,
  }) async {
    final connectivityCheck = isConnected ?? ConnectivityService.check;
    final sleep = delay ?? Future<void>.delayed;

    Object lastError = const OfflineException();
    var attempt = 0;

    while (true) {
      var online = true;
      try {
        online = await connectivityCheck();
      } catch (_) {
        online = true; // sondeo caído: preferimos intentar la petición
      }

      if (online) {
        try {
          return await request();
        } catch (error) {
          if (!isRetryableError(error)) rethrow;
          lastError = error;
        }
      } else {
        lastError = const OfflineException();
      }

      if (attempt >= retries) break;
      final wait = baseDelay * (1 << attempt); // 1x, 2x, 4x…
      if (kDebugMode) {
        print('🔁 ApiService: reintento ${attempt + 1}/$retries en ${wait.inMilliseconds}ms');
      }
      await sleep(wait);
      attempt++;
    }

    throw lastError;
  }

  /// Decodifica [response] y normaliza el error incluyendo el status code,
  /// de forma que [isRetryableError] pueda clasificarlo.
  static dynamic _decodeResponse(http.Response response) {
    final status = response.statusCode;
    if (status >= 200 && status < 300) {
      if (response.body.trim().isEmpty) return null;
      return safeJsonDecode(response.body);
    }
    var detail = 'Error $status';
    try {
      final data = jsonDecode(response.body);
      if (data is Map && data['error'] != null) {
        detail = '${data['error']}';
      }
    } catch (_) {}
    throw Exception('$status $detail');
  }

  // ─── Métodos genéricos HTTP (para nuevas funcionalidades) ───────
  /// GET con reintentos (petición idempotente).
  static Future<dynamic> get(String path) {
    return runWithRetry(() async {
      await ensureBaseUrl();
      final headers = await _getAuthHeaders();
      final uri = Uri.parse('$_baseUrl$path');
      if (kDebugMode) {
        print('🌐 ApiService.get: Requesting URI: $uri');
      }
      final response =
          await http.get(uri, headers: headers).timeout(requestTimeout);
      if (kDebugMode) {
        print('🌐 ApiService.get: Response Code: ${response.statusCode}');
        print('🌐 ApiService.get: Response Body Preview: ${response.body.length > 200 ? response.body.substring(0, 200) : response.body}');
      }
      return _decodeResponse(response);
    });
  }

  /// POST sin reintentos automáticos: no es idempotente y reintentarlo podría
  /// duplicar efectos (reservas, pagos). Aun así corta en seco sin red.
  static Future<dynamic> post(String path, Map<String, dynamic> body) {
    return runWithRetry(retries: 0, () async {
      await ensureBaseUrl();
      final headers = await _getAuthHeaders();
      final uri = Uri.parse('$_baseUrl$path');
      final response = await http
          .post(uri, headers: headers, body: jsonEncode(body))
          .timeout(requestTimeout);
      return _decodeResponse(response);
    });
  }

  /// PUT con reintentos (petición idempotente).
  static Future<dynamic> put(String path, Map<String, dynamic> body) {
    return runWithRetry(() async {
      await ensureBaseUrl();
      final headers = await _getAuthHeaders();
      final uri = Uri.parse('$_baseUrl$path');
      final response = await http
          .put(uri, headers: headers, body: jsonEncode(body))
          .timeout(requestTimeout);
      return _decodeResponse(response);
    });
  }

  /// PATCH con reintentos (actualización parcial idempotente).
  static Future<dynamic> patch(String path, Map<String, dynamic> body) {
    return runWithRetry(() async {
      await ensureBaseUrl();
      final headers = await _getAuthHeaders();
      final uri = Uri.parse('$_baseUrl$path');
      final response = await http
          .patch(uri, headers: headers, body: jsonEncode(body))
          .timeout(requestTimeout);
      return _decodeResponse(response);
    });
  }

  /// DELETE con reintentos (petición idempotente).
  static Future<dynamic> delete(String path) {
    return runWithRetry(() async {
      await ensureBaseUrl();
      final headers = await _getAuthHeaders();
      final uri = Uri.parse('$_baseUrl$path');
      if (kDebugMode) {
        print('🌐 ApiService.delete: Requesting URI: $uri');
      }
      final response = await http
          .delete(uri, headers: headers)
          .timeout(requestTimeout);
      return _decodeResponse(response);
    });
  }


  // ─────────────────────────────────────────────────────────────
  // PROVEEDORES (Públicos - sin token requerido)
  // ─────────────────────────────────────────────────────────────

  static dynamic safeJsonDecode(String rawBody) {
    final trimmed = rawBody.trim();
    if (trimmed.startsWith('<')) {
      throw Exception('Respuesta no válida del servidor (HTML en lugar de JSON).');
    }
    return json.decode(rawBody);
  }

  static Future<List<ProviderModel>> fetchProvidersSecured(
      {double? latitude, double? longitude}) async {
    await ensureBaseUrl();
    String url = '$_baseUrl$_apiPath/providers';
    if (latitude != null && longitude != null) {
      url += '?lat=$latitude&lon=$longitude';
    }
    final response =
        await http.get(Uri.parse(url)).timeout(requestTimeout);
    if (response.statusCode == 200) {
      final decoded = safeJsonDecode(response.body);
      final data = _normalizeDynamicUrls(decoded);
      return (data['data'] as List<dynamic>)
          .whereType<Map<String, dynamic>>()
          .map((j) => ProviderModel.fromJson(j))
          .toList();
    }
    throw Exception('Error ${response.statusCode}');
  }

  static Future<List<Map<String, dynamic>>> fetchProductsByTag(String tag) async {
    await ensureBaseUrl();
    final headers = await _getAuthHeaders();
    final response = await http
        .get(
          Uri.parse('$_baseUrl$_apiPath/products?tag=$tag'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return List<Map<String, dynamic>>.from(data['data']);
    }
    throw Exception('Error al obtener productos');
  }

  static Future<Map<String, dynamic>> fetchProviderDetails(
      String providerId) async {
    await ensureBaseUrl();
    final response = await http
        .get(Uri.parse('$_baseUrl$_apiPath/providers/$providerId'))
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      final data = _normalizeDynamicUrls(json.decode(response.body));
      return Map<String, dynamic>.from(data['data']);
    }
    throw Exception('Error ${response.statusCode}');
  }

  // ─────────────────────────────────────────────────────────────
  // RESERVAS (Cliente) - REQUIEREN TOKEN
  // ─────────────────────────────────────────────────────────────
  static Future<Map<String, dynamic>> createBooking({
    required String providerId,
    required String serviceId,
    List<String>? serviceIds,
    required String scheduledAt,
    required String serviceAddress,
    String? notes,
    List<Map<String, dynamic>>? productosAdicionales,
  }) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .post(
          Uri.parse('$_baseUrl$_apiPath/bookings'),
          headers: headers,
          body: json.encode({
            'provider_id': providerId,
            'service_id': serviceId,
            'service_ids': serviceIds ?? [serviceId],
            'scheduled_at': scheduledAt,
            'service_address': serviceAddress,
            'notes': notes,
            'productos_adicionales': productosAdicionales,
          }),
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200 || response.statusCode == 201) {
      return json.decode(response.body);
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<List<Map<String, dynamic>>> fetchClientBookings() async {
    final headers = await _getAuthHeaders();
    final response = await http
        .get(
          Uri.parse('$_baseUrl$_apiPath/bookings/client'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return List<Map<String, dynamic>>.from(data['data']);
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> cancelBooking(String bookingId) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .patch(
          Uri.parse('$_baseUrl$_apiPath/bookings/$bookingId/cancel'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) return json.decode(response.body);
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> submitReview(
      String bookingId, int rating, String comment) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .post(
          Uri.parse('$_baseUrl$_apiPath/bookings/$bookingId/review'),
          headers: headers,
          body: json.encode({
            'rating': rating,
            'comment': comment.isNotEmpty ? comment : null
          }),
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200 || response.statusCode == 201) {
      return json.decode(response.body);
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  /// Token de aceptación de Wompi (Habeas Data), obligatorio al crear una
  /// transacción. La app NO conoce la llave pública del comercio: se lo pide al
  /// backend, que la guarda, junto con el permalink de los términos.
  static Future<Map<String, dynamic>> fetchWompiAcceptanceToken() async {
    final headers = await _getAuthHeaders();
    final response = await http
        .get(
          Uri.parse('$_baseUrl$_apiPath/payments/wompi/acceptance-token'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) return json.decode(response.body);
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  /// Llave pública de Wompi (pub_test_* / pub_prod_*) para tokenizar tarjeta
  /// en el cliente (POST /tokens/cards). La app no la guarda: la pide al
  /// backend cada vez que abre el checkout.
  static Future<String> fetchWompiPublicKey() async {
    final headers = await _getAuthHeaders();
    final response = await http
        .get(
          Uri.parse('$_baseUrl$_apiPath/payments/wompi/public-key'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return data['public_key'] as String;
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  /// Inicia el cobro de un pedido de tienda (GlowStore).
  ///
  /// Mismo contrato que `payBooking` pero para pedidos de productos:
  /// - `NEQUI` exige `phoneNumber`
  /// - `CARD` exige `paymentMethodToken` o `paymentSourceId`
  /// El backend responde 202 (transacción creada, estado PENDING); el webhook confirma.
  static Future<Map<String, dynamic>> payOrder(
      String orderId,
      String paymentMethod, {
      String? phoneNumber,
      String? paymentMethodToken,
      int? installments,
      String? paymentSourceId,
      String? acceptanceToken,
      String? redirectUrl,
      Map<String, dynamic>? customerData,
    }) async {
      final headers = await _getAuthHeaders();
      final body = <String, dynamic>{
        'payment_method': paymentMethod,
        if (phoneNumber != null) 'phone_number': phoneNumber,
        if (paymentMethodToken != null) 'payment_method_token': paymentMethodToken,
        if (installments != null) 'installments': installments,
        if (paymentSourceId != null) 'payment_source_id': paymentSourceId,
        if (acceptanceToken != null) 'acceptance_token': acceptanceToken,
        // PSE / Daviplata / Bancolombia: sin estos dos el backend responde 400.
        if (redirectUrl != null) 'redirect_url': redirectUrl,
        if (customerData != null) 'customer_data': customerData,
      };

      final response = await http
          .post(
            Uri.parse('$_baseUrl$_apiPath/store/orders/$orderId/pay'),
            headers: headers,
            body: json.encode(body),
          )
          .timeout(requestTimeout);
      if (response.statusCode == 200 || response.statusCode == 202) {
        return json.decode(response.body);
      }
      throw Exception(
          json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
    }

    /// Obtiene la lista de pedidos del usuario (GlowStore).
    static Future<List<Map<String, dynamic>>> fetchStoreOrders() async {
      final headers = await _getAuthHeaders();
      final response = await http
          .get(
            Uri.parse('$_baseUrl$_apiPath/store/orders'),
            headers: headers,
          )
          .timeout(requestTimeout);
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        return (data['data'] as List<dynamic>).cast<Map<String, dynamic>>();
      }
      throw Exception(
          json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
    }

    /// Obtiene el detalle de un pedido específico (GlowStore).
    static Future<Map<String, dynamic>> fetchStoreOrderById(String orderId) async {
      final headers = await _getAuthHeaders();
      final response = await http
          .get(
            Uri.parse('$_baseUrl$_apiPath/store/orders/$orderId'),
            headers: headers,
          )
          .timeout(requestTimeout);
      if (response.statusCode == 200) {
        return json.decode(response.body);
      }
      throw Exception(
          json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
    }

    /// El instrumento NO es simétrico entre métodos (contrato Wompi):
  /// - `NEQUI` exige `phoneNumber`; Wompi rechaza `token` en este método.
  /// - `CARD` exige `paymentMethodToken` (tokenizado en Wompi) o
  ///   `paymentSourceId` (fuente de pago guardada).
  ///
  /// El backend responde **202** cuando la transacción quedó creada pero aún en
  /// estado PENDING: quien confirma el pago es el webhook de Wompi, no esta
  /// llamada. Tratar el 202 como error dejaría al usuario con un fallo visible
  /// en un cobro que sí se inició.
  /// D-GL-023 — propina: 100% al prestador, 0% de comisión.
  /// Se envía después del servicio, nunca en el checkout.
  static Future<Map<String, dynamic>> submitTip(
      String bookingId, double amount) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .post(
          Uri.parse('$_baseUrl$_apiPath/bookings/$bookingId/tip'),
          headers: headers,
          body: json.encode({'monto': amount.round()}),
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200 || response.statusCode == 201) {
      return json.decode(response.body);
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> payBooking(
    String bookingId,
    String paymentMethod, {
    String? phoneNumber,
    String? paymentMethodToken,
    int? installments,
    String? paymentSourceId,
    String? acceptanceToken,
    String? redirectUrl,
    Map<String, dynamic>? customerData,
  }) async {
    final headers = await _getAuthHeaders();
    final body = <String, dynamic>{
      'payment_method': paymentMethod,
      if (phoneNumber != null) 'phone_number': phoneNumber,
      if (paymentMethodToken != null) 'payment_method_token': paymentMethodToken,
      if (installments != null) 'installments': installments,
      if (paymentSourceId != null) 'payment_source_id': paymentSourceId,
      if (acceptanceToken != null) 'acceptance_token': acceptanceToken,
      // PSE / Bancolombia / Daviplata: Wompi exige a dónde volver y quién paga.
      // El backend los rechaza con 400 si faltan, así que no se envían vacíos.
      if (redirectUrl != null && redirectUrl.isNotEmpty) 'redirect_url': redirectUrl,
      if (customerData != null) 'customer_data': customerData,
    };

    final response = await http
        .post(
          Uri.parse('$_baseUrl$_apiPath/bookings/$bookingId/pay'),
          headers: headers,
          body: json.encode(body),
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200 || response.statusCode == 202) {
      return json.decode(response.body);
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  // ─────────────────────────────────────────────────────────────
  // 🔹 NUEVOS: Gestión de Servicios del Proveedor - REQUIEREN TOKEN
  // ─────────────────────────────────────────────────────────────

  static Future<List<ServiceModel>> fetchProviderServices() async {
    final headers = await _getAuthHeaders();
    final response = await http
        .get(
          Uri.parse('$_baseUrl$_apiPath/services/provider'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return (data['data'] as List<dynamic>)
          .whereType<Map<String, dynamic>>()
          .map((j) => ServiceModel.fromJson(j))
          .toList();
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<ServiceModel> createService({
    required String name,
    required double price,
    required int durationMinutes,
    String? description,
    String? category,
    bool isActive = true,
  }) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .post(
          Uri.parse('$_baseUrl$_apiPath/services'),
          headers: headers,
          body: json.encode({
            'name': name,
            'price': price,
            'duration_minutes': durationMinutes,
            'description': description,
            'category': category,
            'is_active': isActive,
          }),
        )
        .timeout(requestTimeout);
    if (response.statusCode == 201 || response.statusCode == 200) {
      final data = json.decode(response.body);
      final rawService = (data['data'] ?? data['service']) as Map<String, dynamic>?;
      if (rawService != null) {
        return ServiceModel.fromJson(rawService);
      }
      if (data is Map<String, dynamic>) {
        return ServiceModel.fromJson(data);
      }
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<ServiceModel> updateService({
    required String id,
    required String name,
    required double price,
    required int durationMinutes,
    String? description,
    String? category,
    bool? isActive,
  }) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .put(
          Uri.parse('$_baseUrl$_apiPath/services/$id'),
          headers: headers,
          body: json.encode({
            'name': name,
            'price': price,
            'duration_minutes': durationMinutes,
            'description': description,
            'category': category,
            'is_active': isActive,
          }),
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200 || response.statusCode == 201) {
      final data = json.decode(response.body);
      final rawService = (data['data'] ?? data['service']) as Map<String, dynamic>?;
      if (rawService != null) {
        return ServiceModel.fromJson(rawService);
      }
      if (data is Map<String, dynamic>) {
        return ServiceModel.fromJson(data);
      }
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> deleteService(String id) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .delete(
          Uri.parse('$_baseUrl$_apiPath/services/$id'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) return json.decode(response.body);
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  // ─────────────────────────────────────────────────────────────
  // 🔹 NUEVOS: Subida de Imágenes y Portafolio
  // ─────────────────────────────────────────────────────────────

  static Future<String> uploadImage(
      Uint8List imageBytes, String filename) async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/upload');
    final request = http.MultipartRequest('POST', uri);
    if (token != null && token.isNotEmpty) {
      request.headers['Authorization'] = 'Bearer $token';
    }
    request.headers['X-App-Audience'] = appAudience;

    // Detectar el MIME type basado en la extensión del archivo
    // Sin esto, Flutter Web envía 'application/octet-stream' y el backend lo rechaza
    final ext = filename.toLowerCase().split('.').last;
    final mimeTypes = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
    };
    final contentType = mimeTypes[ext] ?? 'image/jpeg';
    final mimeParts = contentType.split('/');

    request.files.add(
      http.MultipartFile.fromBytes(
        'image',
        imageBytes,
        filename: filename,
        contentType: http_parser.MediaType(mimeParts[0], mimeParts[1]),
      ),
    );
    final streamedResponse =
        await request.send().timeout(const Duration(seconds: 45));
    final response = await http.Response.fromStream(streamedResponse);
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return data['url'] as String;
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> updateAvatar(String imageUrl) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .patch(
          Uri.parse('$_baseUrl$_apiPath/users/avatar'),
          headers: headers,
          body: json.encode({'avatar_url': imageUrl}),
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) return json.decode(response.body);
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<List<Map<String, dynamic>>> fetchProviderPortfolio() async {
    final headers = await _getAuthHeaders();
    final response = await http
        .get(
          Uri.parse('$_baseUrl$_apiPath/portfolio/provider'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      final data = _normalizeDynamicUrls(json.decode(response.body));
      return List<Map<String, dynamic>>.from(data['data']);
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> addPortfolioItem({
    required String imageUrl,
    String? title,
    String? category,
  }) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .post(
          Uri.parse('$_baseUrl$_apiPath/portfolio'),
          headers: headers,
          body: json.encode({
            'image_url': imageUrl,
            'title': title,
            'category': category,
          }),
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200 || response.statusCode == 201) {
      return json.decode(response.body);
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> deletePortfolioItem(String id) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .delete(
          Uri.parse('$_baseUrl$_apiPath/portfolio/$id'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) return json.decode(response.body);
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> updatePortfolioItem({
    required String id,
    String? title,
    String? category,
  }) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .put(
          Uri.parse('$_baseUrl$_apiPath/portfolio/$id'),
          headers: headers,
          body: json.encode({
            'title': title,
            'category': category,
          }),
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) return json.decode(response.body);
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> fetchUserProfile() async {
    final headers = await _getAuthHeaders();
    final response = await http
        .get(
          Uri.parse('$_baseUrl$_apiPath/users/profile'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      final data = _normalizeDynamicUrls(json.decode(response.body));
      return data['user'] as Map<String, dynamic>;
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> updateUserProfile({
    required String fullName,
    required String phone,
    String? description,
    int? activeStartHour,
    int? activeEndHour,
    Map<String, dynamic>? weeklySchedule,
  }) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .patch(
          Uri.parse('$_baseUrl$_apiPath/users/profile'),
          headers: headers,
          body: json.encode({
            'full_name': fullName,
            'phone': phone,
            if (description != null) 'description': description,
            if (activeStartHour != null) 'active_start_hour': activeStartHour,
            if (activeEndHour != null) 'active_end_hour': activeEndHour,
            if (weeklySchedule != null) 'weekly_schedule': weeklySchedule,
          }),
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) return json.decode(response.body);
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> fetchProviderSchedule() async {
    final res = await get('/api/provider/schedule');
    return res as Map<String, dynamic>;
  }

  static Future<void> updateProviderSchedule({
    required Map<String, dynamic> weeklySchedule,
    required int activeStartHour,
    required int activeEndHour,
  }) async {
    await put('/api/provider/schedule', {
      'weekly_schedule': weeklySchedule,
      'active_start_hour': activeStartHour,
      'active_end_hour': activeEndHour,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // 🔹 DATOS FISCALES DEL PRESTADOR (RESPONSABILIDAD DE IVA) — REQUIEREN TOKEN
  // ─────────────────────────────────────────────────────────────

  /// GET /api/provider/fiscal — estado de la responsabilidad de IVA del
  /// prestador.
  ///
  /// Devuelve `estado` ('DECLARADA' / 'SIN_DECLARAR'), `rut_numero`,
  /// `rut_responsabilidad_codigo`, `responsable_iva`, `fuente` ('RUT' /
  /// 'MANUAL') y `actualizada_at`. El estado NO lo deduce el cliente: lo
  /// devuelve el servidor de forma explícita.
  static Future<Map<String, dynamic>> fetchProviderFiscal() async {
    final headers = await _getAuthHeaders();
    final response = await http
        .get(
          Uri.parse('$_baseUrl$_apiPath/provider/fiscal'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      return Map<String, dynamic>.from(json.decode(response.body));
    }
    throw _fiscalError(response);
  }

  /// PATCH /api/provider/fiscal — declara la responsabilidad de IVA a partir de
  /// la casilla de responsabilidades del RUT (48 = responsable de IVA,
  /// 49 = no responsable de IVA). El número de RUT es obligatorio para declarar.
  ///
  /// El valor se DERIVA del código en el servidor; el cliente no lo calcula.
  /// Ante un 400 lanza [FiscalApiException] conservando `error` y `detalle` tal
  /// como los devuelve la API, para que la pantalla pueda mostrarlos literales.
  static Future<Map<String, dynamic>> updateProviderFiscal({
    required String rutNumero,
    required int rutResponsabilidadCodigo,
  }) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .patch(
          Uri.parse('$_baseUrl$_apiPath/provider/fiscal'),
          headers: headers,
          body: json.encode({
            'rut_numero': rutNumero,
            'rut_responsabilidad_codigo': rutResponsabilidadCodigo,
          }),
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      return Map<String, dynamic>.from(json.decode(response.body));
    }
    throw _fiscalError(response);
  }

  /// Normaliza la respuesta de error fiscal en una [FiscalApiException] que
  /// conserva `error` y `detalle` del cuerpo (p. ej. `RUT_INVALIDO`).
  static FiscalApiException _fiscalError(http.Response response) {
    String? error;
    String? detalle;
    try {
      final data = json.decode(response.body);
      if (data is Map) {
        error = data['error']?.toString();
        detalle = data['detalle']?.toString();
      }
    } catch (_) {
      // Cuerpo no-JSON: se usa el mensaje genérico de abajo.
    }
    return FiscalApiException(
      statusCode: response.statusCode,
      error: error ?? 'Error ${response.statusCode}',
      detalle: detalle,
    );
  }

  static Future<List<Map<String, dynamic>>> fetchAvailableSlots({
    required String providerId,
    required String date,
    required String serviceId,
  }) async {
    await ensureBaseUrl();
    final response = await http
        .get(
          Uri.parse(
              '$_baseUrl$_apiPath/providers/$providerId/slots?date=$date&service_id=$serviceId'),
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return List<Map<String, dynamic>>.from(data['slots']);
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  // ─────────────────────────────────────────────────────────────
  // 🔹 NUEVOS: Sistema de Chat y Mensajería - REQUIEREN TOKEN
  // ─────────────────────────────────────────────────────────────

  static Future<List<Map<String, dynamic>>> fetchChatConversations() async {
    final headers = await _getAuthHeaders();
    final response = await http
        .get(
          Uri.parse('$_baseUrl$_apiPath/chat/conversations'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return List<Map<String, dynamic>>.from(data['data']);
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<List<Map<String, dynamic>>> fetchChatMessages(
      String partnerId) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .get(
          Uri.parse('$_baseUrl$_apiPath/chat/messages/$partnerId'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return List<Map<String, dynamic>>.from(data['data']);
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> sendChatMessage(
      String receiverId, String message,
      {String? imagePath}) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .post(
          Uri.parse('$_baseUrl$_apiPath/chat/messages'),
          headers: headers,
          body: json.encode({
            'receiver_id': receiverId,
            'message': message,
            if (imagePath != null) 'image_path': imagePath,
          }),
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200 || response.statusCode == 201) {
      return json.decode(response.body);
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> markMessagesAsRead(
      String partnerId) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .patch(
          Uri.parse('$_baseUrl$_apiPath/chat/messages/$partnerId/read'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      return json.decode(response.body);
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<bool> updateProviderStatus(bool isActive,
      {double? latitude, double? longitude}) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .patch(
          Uri.parse('$_baseUrl$_apiPath/providers/status'),
          headers: headers,
          body: json.encode({
            'is_active': isActive,
            if (latitude != null) 'latitude': latitude,
            if (longitude != null) 'longitude': longitude,
          }),
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return data['is_active'] as bool;
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> startBooking(String bookingId) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .patch(
          Uri.parse('$_baseUrl$_apiPath/bookings/$bookingId/start'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      return json.decode(response.body);
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> completeBooking(
    String bookingId,
    String pin, {
    double? providerLat,
    double? providerLon,
    double? clientLat,
    double? clientLon,
  }) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .post(
          Uri.parse('$_baseUrl$_apiPath/bookings/$bookingId/complete'),
          headers: headers,
          body: json.encode({
            'pin_verificacion': pin,
            if (providerLat != null) 'provider_lat': providerLat,
            if (providerLon != null) 'provider_lon': providerLon,
            if (clientLat != null) 'client_lat': clientLat,
            if (clientLon != null) 'client_lon': clientLon,
          }),
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      return json.decode(response.body);
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<List<Map<String, dynamic>>> fetchProviderBookings() async {
    final headers = await _getAuthHeaders();
    final response = await http
        .get(
          Uri.parse('$_baseUrl$_apiPath/bookings/provider'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return List<Map<String, dynamic>>.from(data['data']);
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> updateBookingStatus(
      String bookingId, String newStatus) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .patch(
          Uri.parse('$_baseUrl$_apiPath/bookings/$bookingId/status'),
          headers: headers,
          body: json.encode({'status': newStatus}),
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) return json.decode(response.body);
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  // 🔹 NUEVO: Enviar señal de pánico SOS
  static Future<Map<String, dynamic>> triggerSOS({
    String? bookingId,
    double? latitude,
    double? longitude,
  }) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .post(
          Uri.parse('$_baseUrl$_apiPath/sos'),
          headers: headers,
          body: json.encode({
            if (bookingId != null) 'booking_id': bookingId,
            if (latitude != null) 'latitude': latitude,
            if (longitude != null) 'longitude': longitude,
          }),
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200 || response.statusCode == 201) {
      return json.decode(response.body);
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  // 🔹 NUEVO: Buscar ideas de diseños de manicura (Pinterest / Google CSE)
  static Future<List<Map<String, dynamic>>> fetchDesignIdeas(String query, {String? category, bool? personalize}) async {
    final headers = await _getAuthHeaders();
    String urlSuffix = '';
    if (category != null) {
      urlSuffix += '&category=${Uri.encodeComponent(category)}';
    }
    if (personalize != null) {
      urlSuffix += '&personalize=$personalize';
    }
    final response = await http
        .get(
          Uri.parse('$_baseUrl$_apiPath/designs/search?q=${Uri.encodeComponent(query)}$urlSuffix'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return List<Map<String, dynamic>>.from(data['data']);
    }
    throw Exception(
        json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<List<Map<String, dynamic>>> fetchCuratedCollections(String category) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .get(
          Uri.parse('$_baseUrl$_apiPath/designs/collections?category=${Uri.encodeComponent(category)}'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return List<Map<String, dynamic>>.from(data['data']);
    }
    throw Exception(json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<List<Map<String, dynamic>>> fetchExclusiveCollections() async {
    final headers = await _getAuthHeaders();
    final response = await http
        .get(
          Uri.parse('$_baseUrl$_apiPath/designs/collections/exclusive'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return List<Map<String, dynamic>>.from(data['data']);
    }
    throw Exception(json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> generateGlowUpCard(String favoriteUrl, String track) async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/designs/glowup-card/generate');
    
    final headers = <String, String>{'Content-Type': 'application/json', 'X-App-Audience': appAudience};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    final body = json.encode({
      'favorite_design_url': favoriteUrl,
      'track': track,
    });

    final response = await http.post(uri, headers: headers, body: body).timeout(requestTimeout);
    final data = json.decode(response.body);
    if (response.statusCode == 200) {
      return Map<String, dynamic>.from(data['data']);
    }
    throw Exception(data['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<List<Map<String, dynamic>>> fetchColorimetriaHistorial() async {
    final headers = await _getAuthHeaders();
    final response = await http
        .get(
          Uri.parse('$_baseUrl$_apiPath/designs/colorimetria/historial'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return List<Map<String, dynamic>>.from(data['data']);
    }
    throw Exception(json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  // 🔹 NUEVO: Clóset e Imagen Digital (GlowStyle)
  static Future<Map<String, dynamic>> classifyGarment(Uint8List imageBytes, String filename) async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/designs/wardrobe/garment');
    final request = http.MultipartRequest('POST', uri);
    
    if (token != null && token.isNotEmpty) {
      request.headers['Authorization'] = 'Bearer $token';
    }
    request.headers['X-App-Audience'] = appAudience;
    
    request.files.add(
      http.MultipartFile.fromBytes(
        'image',
        imageBytes,
        filename: filename,
      ),
    );

    final streamedResponse = await request.send().timeout(const Duration(seconds: 40));
    final response = await http.Response.fromStream(streamedResponse);
    final data = json.decode(response.body);
    if (response.statusCode == 200) {
      return Map<String, dynamic>.from(data['data']);
    }
    throw Exception(data['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<List<Map<String, dynamic>>> fetchWardrobe() async {
    final headers = await _getAuthHeaders();
    final response = await http
        .get(
          Uri.parse('$_baseUrl$_apiPath/designs/wardrobe'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return List<Map<String, dynamic>>.from(data['data']);
    }
    throw Exception(json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<void> deleteGarment(String id) async {
    final headers = await _getAuthHeaders();
    final response = await http
        .delete(
          Uri.parse('$_baseUrl$_apiPath/designs/wardrobe/garment/$id'),
          headers: headers,
        )
        .timeout(const Duration(seconds: 20));
    if (response.statusCode != 200) {
      throw Exception(json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
    }
  }

  static Future<Map<String, dynamic>> generateOutfit(String ocasion) async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/designs/wardrobe/outfit/generate');
    
    final headers = <String, String>{'Content-Type': 'application/json', 'X-App-Audience': appAudience};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    final body = json.encode({'ocasion': ocasion});
    final response = await http.post(uri, headers: headers, body: body).timeout(const Duration(seconds: 40));
    final data = json.decode(response.body);
    if (response.statusCode == 200) {
      return Map<String, dynamic>.from(data['data']);
    }
    throw Exception(data['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<List<Map<String, dynamic>>> fetchOutfitHistory() async {
    final headers = await _getAuthHeaders();
    final response = await http
        .get(
          Uri.parse('$_baseUrl$_apiPath/designs/wardrobe/outfits/history'),
          headers: headers,
        )
        .timeout(requestTimeout);
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return List<Map<String, dynamic>>.from(data['data']);
    }
    throw Exception(json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  // 🔹 NUEVO: Analizar forma del rostro por IA
  static Future<Map<String, dynamic>> analyzeFaceShape(Uint8List imageBytes, String filename) async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/designs/face-analysis');
    final request = http.MultipartRequest('POST', uri);
    
    if (token != null && token.isNotEmpty) {
      request.headers['Authorization'] = 'Bearer $token';
    }
    request.headers['X-App-Audience'] = appAudience;
    
    request.files.add(
      http.MultipartFile.fromBytes(
        'image',
        imageBytes,
        filename: filename,
      ),
    );
    
    final streamedResponse = await request.send().timeout(const Duration(seconds: 45));
    final response = await http.Response.fromStream(streamedResponse);
    
    final data = json.decode(response.body);
    if (response.statusCode == 200 || response.statusCode == 201) {
      return Map<String, dynamic>.from(data);
    }
    final errorMsg = data['details'] != null ? "${data['error']}: ${data['details']}" : (data['error'] ?? 'Error ${response.statusCode}');
    throw Exception(errorMsg);
  }

  // 🔹 NUEVO: Analizar diseño por IA (Colorimetría, Capilar, Textura, Cejas, Uñas)
  static Future<Map<String, dynamic>> analyzeDesignWithAI(Uint8List imageBytes, String filename, String type, {String? concern, String? track}) async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/designs/analyze');
    final request = http.MultipartRequest('POST', uri);
    
    if (token != null && token.isNotEmpty) {
      request.headers['Authorization'] = 'Bearer $token';
    }
    request.headers['X-App-Audience'] = appAudience;
    
    request.fields['type'] = type;
    if (concern != null) {
      request.fields['concern'] = concern;
    }
    if (track != null) {
      request.fields['track'] = track;
    }
    request.files.add(
      http.MultipartFile.fromBytes(
        'image',
        imageBytes,
        filename: filename,
      ),
    );
    
    final streamedResponse = await request.send().timeout(const Duration(seconds: 45));
    final response = await http.Response.fromStream(streamedResponse);
    
    final data = json.decode(response.body);
    if (response.statusCode == 200 || response.statusCode == 201) {
      return Map<String, dynamic>.from(data);
    }
    final errorMsg = data['details'] != null ? "${data['error']}: ${data['details']}" : (data['error'] ?? 'Error ${response.statusCode}');
    throw Exception(errorMsg);
  }

  static Future<List<Map<String, dynamic>>> fetchAIHistory({String? toolType}) async {
    await ensureBaseUrl();
    final token = await _getToken();
    String url = '$_baseUrl$_apiPath/designs/history';
    if (toolType != null) {
      url += '?tool_type=$toolType';
    }
    
    final headers = <String, String>{'X-App-Audience': appAudience};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    final response = await http
        .get(
          Uri.parse(url),
          headers: headers,
        )
        .timeout(requestTimeout);
        
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return List<Map<String, dynamic>>.from(data['data']);
    }
    throw Exception(json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> compareDiagnostics({
    required Uint8List imageBefore,
    required String filenameBefore,
    required Uint8List imageAfter,
    required String filenameAfter,
    String? diagnosticId,
  }) async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/designs/compare');
    final request = http.MultipartRequest('POST', uri);
    
    if (token != null && token.isNotEmpty) {
      request.headers['Authorization'] = 'Bearer $token';
    }
    request.headers['X-App-Audience'] = appAudience;
    
    if (diagnosticId != null) {
      request.fields['diagnostic_id'] = diagnosticId;
    }

    request.files.add(
      http.MultipartFile.fromBytes(
        'imageBefore',
        imageBefore,
        filename: filenameBefore,
      ),
    );

    request.files.add(
      http.MultipartFile.fromBytes(
        'imageAfter',
        imageAfter,
        filename: filenameAfter,
      ),
    );

    final streamedResponse = await request.send().timeout(const Duration(seconds: 45));
    final response = await http.Response.fromStream(streamedResponse);
    
    final data = json.decode(response.body);
    if (response.statusCode == 200 || response.statusCode == 201) {
      return Map<String, dynamic>.from(data);
    }
    throw Exception(data['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>?> fetchSkinProfile() async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/designs/profile');
    
    final headers = <String, String>{'X-App-Audience': appAudience};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    final response = await http
        .get(
          uri,
          headers: headers,
        )
        .timeout(requestTimeout);
        
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return data['data'] != null ? Map<String, dynamic>.from(data['data']) : null;
    }
    throw Exception(json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> subscribePremium() async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/designs/payments/glowai-premium');
    
    final headers = <String, String>{'X-App-Audience': appAudience};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    final response = await http
        .post(
          uri,
          headers: headers,
        )
        .timeout(requestTimeout);
        
    if (response.statusCode == 200 || response.statusCode == 201) {
      return Map<String, dynamic>.from(json.decode(response.body));
    }
    throw Exception(json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> checkInStreak() async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/designs/streak/check-in');
    
    final headers = <String, String>{'X-App-Audience': appAudience};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    final response = await http
        .post(
          uri,
          headers: headers,
        )
        .timeout(requestTimeout);
        
    if (response.statusCode == 200 || response.statusCode == 201) {
      return Map<String, dynamic>.from(json.decode(response.body));
    }
    throw Exception(json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> fetchShareCode() async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/designs/share/code');
    
    final headers = <String, String>{'X-App-Audience': appAudience};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    final response = await http
        .get(
          uri,
          headers: headers,
        )
        .timeout(requestTimeout);
        
    if (response.statusCode == 200 || response.statusCode == 201) {
      return Map<String, dynamic>.from(json.decode(response.body));
    }
    throw Exception(json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<List<Map<String, dynamic>>> fetchRecommendedDoctors() async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/designs/profesionales/recommend');
    
    final headers = <String, String>{'X-App-Audience': appAudience};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    final response = await http
        .get(
          uri,
          headers: headers,
        )
        .timeout(requestTimeout);
        
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return List<Map<String, dynamic>>.from(data['data']);
    }
    throw Exception(json.decode(response.body)['error'] ?? 'Error ${response.statusCode}');
  }

  // 🔹 NUEVO: Evolución Premium
  static Future<List<Map<String, dynamic>>> fetchEvolutionData(String track) async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/designs/evolution/$track');
    
    final headers = <String, String>{'X-App-Audience': appAudience};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    final response = await http.get(uri, headers: headers).timeout(requestTimeout);
    final data = json.decode(response.body);
    if (response.statusCode == 200) {
      return List<Map<String, dynamic>>.from(data['data']);
    }
    throw Exception(data['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<String> fetchEvolutionInsight(String track) async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/designs/evolution/$track/insight');
    
    final headers = <String, String>{'X-App-Audience': appAudience};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    final response = await http.get(uri, headers: headers).timeout(requestTimeout);
    final data = json.decode(response.body);
    if (response.statusCode == 200) {
      return data['insight'] ?? '';
    }
    throw Exception(data['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<String?> fetchEvolutionAttribution(String track) async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/designs/evolution/$track/attribution');
    
    final headers = <String, String>{'X-App-Audience': appAudience};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    final response = await http.get(uri, headers: headers).timeout(requestTimeout);
    final data = json.decode(response.body);
    if (response.statusCode == 200) {
      return data['attribution'];
    }
    throw Exception(data['error'] ?? 'Error ${response.statusCode}');
  }

  // 🔹 NUEVO: Validación Médica
  static Future<Map<String, dynamic>> requestMedicalValidation(int? diagnosticId, String profesionalId) async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/designs/validation/request');
    
    final headers = <String, String>{'Content-Type': 'application/json', 'X-App-Audience': appAudience};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    final body = json.encode({
      'ai_diagnostic_id': diagnosticId,
      'profesional_id': profesionalId,
    });

    final response = await http.post(uri, headers: headers, body: body).timeout(requestTimeout);
    final data = json.decode(response.body);
    if (response.statusCode == 200 || response.statusCode == 201) {
      return Map<String, dynamic>.from(data['data']);
    }
    throw Exception(data['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> payMedicalValidation(int? diagnosticId, String profesionalId) async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/designs/validation/pay');
    
    final headers = <String, String>{'Content-Type': 'application/json', 'X-App-Audience': appAudience};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    final body = json.encode({
      'ai_diagnostic_id': diagnosticId,
      'profesional_id': profesionalId,
    });

    final response = await http.post(uri, headers: headers, body: body).timeout(requestTimeout);
    final data = json.decode(response.body);
    if (response.statusCode == 200 || response.statusCode == 201) {
      return Map<String, dynamic>.from(data['data']);
    }
    throw Exception(data['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<List<Map<String, dynamic>>> fetchValidationHistory() async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/designs/validation/user/history');
    
    final headers = <String, String>{'X-App-Audience': appAudience};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    final response = await http.get(uri, headers: headers).timeout(requestTimeout);
    final data = json.decode(response.body);
    if (response.statusCode == 200) {
      return List<Map<String, dynamic>>.from(data['data']);
    }
    throw Exception(data['error'] ?? 'Error ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> fetchValidationById(String id) async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/designs/validation/$id');
    
    final headers = <String, String>{'X-App-Audience': appAudience};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    final response = await http.get(uri, headers: headers).timeout(requestTimeout);
    final data = json.decode(response.body);
    if (response.statusCode == 200) {
      return Map<String, dynamic>.from(data['data']);
    }
    throw Exception(data['error'] ?? 'Error ${response.statusCode}');
  }

  // --- GLOW CYCLE ENGINE (GIA-01 / GIA-02 / GIA-03) ---
  static Future<Map<String, dynamic>> getActiveGlowCycle() async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/glow-cycle/active');

    final headers = <String, String>{'Content-Type': 'application/json', 'X-App-Audience': appAudience};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    try {
      final response = await http.get(uri, headers: headers).timeout(const Duration(seconds: 15));
      if (response.statusCode == 200) {
        return json.decode(response.body);
      }
      return {'hasActiveCycle': false, 'cycle': null};
    } catch (e) {
      return {'hasActiveCycle': false, 'cycle': null, 'error': e.toString()};
    }
  }

  static Future<Map<String, dynamic>> logCycleCheckin(String cycleId, {bool amCompleted = true, bool pmCompleted = true, String notes = ''}) async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/glow-cycle/$cycleId/checkin');

    final headers = <String, String>{'Content-Type': 'application/json', 'X-App-Audience': appAudience};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    final response = await http.post(
      uri,
      headers: headers,
      body: json.encode({
        'amCompleted': amCompleted,
        'pmCompleted': pmCompleted,
        'notes': notes,
      }),
    ).timeout(const Duration(seconds: 15));

    if (response.statusCode == 200) {
      return json.decode(response.body);
    }
    throw Exception('Error al registrar check-in: ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> submitCycleRescan(String cycleId, {required int dayNumber, required Map<String, dynamic> faceScores, Map<String, dynamic>? handsDiagnosis}) async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/glow-cycle/$cycleId/re-scan');

    final headers = <String, String>{'Content-Type': 'application/json', 'X-App-Audience': appAudience};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    final response = await http.post(
      uri,
      headers: headers,
      body: json.encode({
        'dayNumber': dayNumber,
        'faceScores': faceScores,
        'handsDiagnosis': handsDiagnosis ?? {},
      }),
    ).timeout(const Duration(seconds: 20));

    if (response.statusCode == 200) {
      return json.decode(response.body);
    }
    throw Exception('Error en re-escaneo: ${response.statusCode}');
  }

  static Future<Map<String, dynamic>> graduateCycle(String cycleId, {String? nextGoal, String nextMetricKey = 'pores'}) async {
    await ensureBaseUrl();
    final token = await _getToken();
    final uri = Uri.parse('$_baseUrl$_apiPath/glow-cycle/$cycleId/graduate');

    final headers = <String, String>{'Content-Type': 'application/json', 'X-App-Audience': appAudience};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    final response = await http.post(
      uri,
      headers: headers,
      body: json.encode({
        'nextGoal': nextGoal,
        'nextMetricKey': nextMetricKey,
      }),
    ).timeout(const Duration(seconds: 15));

    if (response.statusCode == 200) {
      return json.decode(response.body);
    }
    throw Exception('Error al graduar ciclo: ${response.statusCode}');
  }

  // 🔹 MÉTODOS DE INVENTARIO EN CONSIGNACIÓN
  static Future<List<Map<String, dynamic>>> fetchConsignmentInventory() async {
    try {
      final response = await get('/provider/inventory/consignment');
      if (response != null && response['success'] == true && response['items'] is List) {
        return List<Map<String, dynamic>>.from(response['items']);
      }
      return [];
    } catch (_) {
      rethrow;
    }
  }

  static Future<Map<String, dynamic>> consumeInventoryItem({
    required int productoId,
    required int cantidad,
  }) async {
    return await post('/provider/inventory/consume', {
      'producto_id': productoId,
      'cantidad': cantidad,
    });
  }

  // 🔹 MÉTODOS DE PROPIETARIO MULTI-SEDE (OWNER)
  static Future<Map<String, dynamic>> switchSalon(int salonId) async {
    final response = await post('/owner/switch-salon', {'salon_id': salonId});
    await ActiveSalonService.applySwitchSalonResponse(response);
    return response ?? {'success': false};
  }

  static Future<Map<String, dynamic>> fetchOwnerDashboardMetrics({
    int? salonId,
    String? startDate,
    String? endDate,
  }) async {
    final queryParams = <String, String>{};
    if (salonId != null && salonId > 0) {
      queryParams['salon_id'] = salonId.toString();
    }
    if (startDate != null && startDate.isNotEmpty) {
      queryParams['startDate'] = startDate;
    }
    if (endDate != null && endDate.isNotEmpty) {
      queryParams['endDate'] = endDate;
    }

    final queryString = queryParams.isNotEmpty
        ? '?${Uri(queryParameters: queryParams).query}'
        : '';
    final response = await get('/owner/dashboard-metrics$queryString');
    return response ?? {'success': false};
  }

  static Future<Map<String, dynamic>> fetchOwnerSalones() async {
    final response = await get('/owner/salones');
    return response ?? {'success': false};
  }
}

class MapSettings {
  static bool isDark = false;
}

/// Error de la declaración fiscal del prestador (`/api/provider/fiscal`).
///
/// Conserva `error` (código, p. ej. `RUT_INVALIDO`) y `detalle` (mensaje legible)
/// tal como los devuelve la API, para mostrarlos en la pantalla sin reconstruir
/// el texto.
class FiscalApiException implements Exception {
  final int statusCode;
  final String error;
  final String? detalle;

  const FiscalApiException({
    required this.statusCode,
    required this.error,
    this.detalle,
  });

  @override
  String toString() =>
      (detalle != null && detalle!.isNotEmpty) ? '$error: $detalle' : error;
}
