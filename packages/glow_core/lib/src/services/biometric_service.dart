// frontend/lib/services/biometric_service.dart
import 'dart:convert';
import 'biometric_export_stub.dart'
    if (dart.library.html) 'biometric_export_web.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:image/image.dart' as img;
import 'api_service.dart';
import 'auth_service.dart';
import 'location_service.dart';
import '../models/biometric_result.dart';

/// Y-F2: el backend rechazó la foto por calidad (HTTP 422). Los motivos vienen
/// medidos (oscuridad, desenfoque, resolución), no son texto genérico.
class CaptureRejectedException implements Exception {
  final List<String> reasons;
  CaptureRejectedException(this.reasons);

  @override
  String toString() => reasons.isEmpty
      ? 'La foto no cumple los requisitos para medir piel.'
      : reasons.join(' ');
}

/// Y-F1f (texto 2.1) — estado del consentimiento tal como lo ve el cliente.
///
/// Tres cosas distintas que antes se confundían en un solo booleano:
///   * `granted`  — el usuario autorizó alguna vez,
///   * `outdated` — autorizó con un texto anterior al vigente,
///   * `canScan`  — autorizó **y** con el texto vigente.
///
/// Un usuario con 2.0 tiene permiso (`granted`) pero no el vigente: hay que pedirle
/// que acepte el texto nuevo antes de volver a medir. La 2.1 añadió la sección de la
/// huella de la foto, así que aceptar por él sería mantener un consentimiento que no
/// corresponde a lo que se guarda.
class BiometricConsentState {
  final bool granted;
  final bool outdated;
  final String? version;
  final String currentVersion;

  /// `false` cuando no se pudo leer el estado (sin sesión, red, respuesta rara).
  /// Un estado desconocido no autoriza a inventar: se dice que no se sabe.
  final bool known;

  const BiometricConsentState({
    required this.granted,
    required this.outdated,
    required this.currentVersion,
    this.version,
    this.known = true,
  });

  /// Sin datos (sin sesión, error de red): no se asume permiso.
  static const BiometricConsentState unknown = BiometricConsentState(
    granted: false,
    outdated: false,
    currentVersion: BiometricService.consentVersion,
    known: false,
  );

  bool get needsReconsent => granted && outdated;

  /// Puede medir: autorizó con el texto que rige hoy.
  bool get canScan => granted && !outdated;

  /// `data` de `GET /api/consent/biometric/:tipo`.
  ///
  /// Tolera respuestas viejas del backend: si `current_version` no viaja, se usa la
  /// constante del cliente (que una prueba mantiene en paridad con el servidor).
  factory BiometricConsentState.fromJson(Map<String, dynamic> data) {
    final consent = data['consent'];
    final versionRaw = consent is Map ? consent['version_terms'] : null;
    final currentRaw = data['current_version'];

    return BiometricConsentState(
      granted: data['allowed'] == true,
      outdated: data['outdated'] == true,
      version: versionRaw is String ? versionRaw : null,
      currentVersion: currentRaw is String && currentRaw.isNotEmpty
          ? currentRaw
          : BiometricService.consentVersion,
      known: true,
    );
  }
}

class BiometricService {
  /// Versión del texto de consentimiento que la pantalla muestra al usuario.
  /// Debe coincidir con `BIOMETRIC_CONSENT_VERSION` del backend
  /// (`backend/src/config/consentConfig.js`); si no coincide, el análisis queda
  /// marcado como autorizado con una versión desactualizada.
  static const String consentVersion = '2.2';

  /// Y-F6: serie de escaneos del usuario, tal como quedó guardada.
  ///
  /// El backend no recalcula nada: el GlowScore viene de `quality.glowScore` y el
  /// veredicto de la comparación persistida. Un escaneo viejo sin puntaje llega con
  /// `glowScore: null`, y la pantalla lo dice en vez de inventar un número.
  static Future<List<Map<String, dynamic>>> getHistory({int limit = 20}) async {
    final baseUrl = await getBaseUrl();
    final token = await AuthService.getToken();
    if (token == null) {
      throw Exception('Tu sesión no está iniciada.');
    }

    final response = await http.get(
      Uri.parse('$baseUrl/api/biometric/history?limit=$limit'),
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(const Duration(seconds: 20));

    if (response.statusCode == 401) {
      throw Exception('Tu sesión expiró. Vuelve a entrar.');
    }
    if (response.statusCode != 200) {
      throw Exception('No se pudo cargar tu evolución (${response.statusCode}).');
    }

    final data = jsonDecode(response.body) as Map<String, dynamic>;
    final scans = (data['scans'] as List<dynamic>? ?? const []);
    return scans.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  static Future<String> getBaseUrl() async {
    await ApiService.ensureBaseUrl();
    return ApiService.baseUrl;
  }

  static Future<void> saveConsent() async {
    final baseUrl = await getBaseUrl();
    final token = await AuthService.getToken();
    if (token == null || token.isEmpty) {
      throw Exception('Inicia sesión para registrar el consentimiento biométrico.');
    }

    final response = await http.post(
      Uri.parse('$baseUrl/api/consent/biometric'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({
        'consent_type': 'facial_analysis',
        'purpose': 'Análisis facial y recomendaciones personalizadas de cuidado de piel.',
        'version_terms': consentVersion,
      }),
    );

    if (response.statusCode != 201 && response.statusCode != 200) {
      throw Exception('Error al guardar consentimiento biométrico');
    }
  }

  /// Y-F1f: estado completo del consentimiento — permiso, versión aceptada y si el
  /// texto quedó atrás. Es lo que permite pedir re-consentimiento en vez de asumir
  /// que un permiso de hace tres versiones sigue cubriendo lo que se guarda hoy.
  static Future<BiometricConsentState> getConsentState() async {
    final baseUrl = await getBaseUrl();
    final token = await AuthService.getToken();
    if (token == null || token.isEmpty) return BiometricConsentState.unknown;

    try {
      final response = await http.get(
        Uri.parse('$baseUrl/api/consent/biometric/facial_analysis'),
        headers: {'Authorization': 'Bearer $token'},
      ).timeout(const Duration(seconds: 15));

      if (response.statusCode != 200) return BiometricConsentState.unknown;

      final body = jsonDecode(response.body);
      final data = body is Map ? body['data'] : null;
      if (data is! Map) return BiometricConsentState.unknown;

      return BiometricConsentState.fromJson(Map<String, dynamic>.from(data));
    } catch (e) {
      debugPrint('⚠️ No se pudo leer el estado del consentimiento: $e');
      return BiometricConsentState.unknown;
    }
  }

  static Future<bool> hasConsent() async {
    final state = await getConsentState();
    return state.granted;
  }

  static Future<void> revokeConsent() async {
    final baseUrl = await getBaseUrl();
    final token = await AuthService.getToken();
    if (token == null || token.isEmpty) {
      throw Exception('Inicia sesión para administrar el consentimiento biométrico.');
    }

    final response = await http.delete(
      Uri.parse('$baseUrl/api/consent/biometric/facial_analysis'),
      headers: {'Authorization': 'Bearer $token'},
    );
    if (response.statusCode != 200) {
      throw Exception('No se pudo revocar el consentimiento biométrico.');
    }

    final deletion = await http.delete(
      Uri.parse('$baseUrl/api/consent/biometric/facial_analysis/data'),
      headers: {'Authorization': 'Bearer $token'},
    );
    if (deletion.statusCode != 200) {
      throw Exception('Consentimiento revocado, pero no se pudo confirmar la eliminación de los datos biométricos.');
    }
  }

  static Future<Map<String, dynamic>> exportBiometricData() async {
    final baseUrl = await getBaseUrl();
    final token = await AuthService.getToken();
    if (token == null || token.isEmpty) {
      throw Exception('Inicia sesión para exportar tus datos biométricos.');
    }

    final response = await http.get(
      Uri.parse('$baseUrl/api/consent/export'),
      headers: {'Authorization': 'Bearer $token'},
    );
    if (response.statusCode != 200) {
      throw Exception('No se pudieron exportar tus datos biométricos.');
    }
    final payload = response.body;
    if (kIsWeb) {
      downloadBiometricExport(payload);
    }
    return jsonDecode(payload) as Map<String, dynamic>;
  }

  static Future<Map<String, dynamic>> analyze({
    required List<int> faceImageBytes,
    required List<int> handsImageBytes,
    double? lat,
    double? lng,
    Map<String, dynamic>? geometry,
  }) async {
    final baseUrl = await getBaseUrl();
    final token = await AuthService.getToken();
    final prefs = await SharedPreferences.getInstance();
    final userId = prefs.getString('userId') ?? 'user';
    final idempotencyKey = 'biometric_${userId}_${DateTime.now().microsecondsSinceEpoch}';
    final compressionResults = await Future.wait([
      compute(_compressImageIsolate, Uint8List.fromList(faceImageBytes)),
      compute(_compressImageIsolate, Uint8List.fromList(handsImageBytes)),
    ]);
    final compressedFace = compressionResults[0];
    final compressedHands = compressionResults[1];

    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/api/biometric/analyze'),
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': idempotencyKey,
              if (token != null) 'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'faceImage': base64Encode(compressedFace),
              'handsImage': base64Encode(compressedHands),
              'lat': lat,
              'lng': lng,
              // Y-F4: sólo se envía si el cuadro validado traía geometría.
              if (geometry != null) 'geometry': geometry,
            }),
          )
          .timeout(const Duration(seconds: 40));

      if (response.statusCode == 200 || response.statusCode == 201) {
        return jsonDecode(response.body);
      }
      // Y-F2: la captura fue rechazada por calidad. Se propaga el motivo medido
      // (oscuridad, desenfoque, resolución) en vez de un HTTP 422 opaco.
      if (response.statusCode == 422) {
        throw CaptureRejectedException(_captureReasons(response.body));
      }
      // A360-2026-09-22/C-04: antes se devolvían aquí datos biométricos
      // inventados (glowScore 84, bioAge 26…) ante cualquier respuesta no-2xx.
      // Nunca se fabrican resultados: el error se propaga.
      throw Exception(
        'El análisis biométrico falló (HTTP ${response.statusCode}). '
        'No se generó ningún diagnóstico.',
      );
    } catch (e) {
      debugPrint('❌ [BiometricService] Análisis biométrico fallido: $e');
      // El rechazo de captura conserva sus motivos: envolverlo en un Exception
      // genérico los borraría y el usuario volvería a ver un error opaco.
      if (e is CaptureRejectedException) rethrow;
      throw Exception('No se pudo completar el análisis biométrico: $e');
    }
  }

  /// Motivos que midió el backend al rechazar la foto (Y-F2).
  static List<String> _captureReasons(String body) {
    try {
      final decoded = jsonDecode(body);
      if (decoded is Map) {
        final capture = decoded['capture'];
        if (capture is Map) {
          final reasons = capture['reasons'];
          if (reasons is List) {
            return reasons
                .whereType<Map>()
                .map((r) => r['message']?.toString() ?? '')
                .where((m) => m.isNotEmpty)
                .toList();
          }
        }
      }
    } catch (_) {
      // Cuerpo no-JSON: se cae al mensaje genérico de la excepción.
    }
    return const [];
  }

  /// Resultado de demostración. SÓLO puede invocarse desde un punto de entrada
  /// de demo explícito y visible para el usuario (botón "Modo Demostración").
  /// Está prohibido usarlo como fallback ante errores de red o del servidor
  /// (A360-2026-09-22/C-04).
  static BiometricResult getDemoBiometricResult() {
    return BiometricResult.fromJson(getDemoBiometricJson());
  }

  /// Mock JSON completo integrando Evimetra (0-100), Bioderma (4 familias) y Media.io (VTO tones).
  /// Datos NO reales: ver [getDemoBiometricResult] para las condiciones de uso.
  static Map<String, dynamic> getDemoBiometricJson() {
    return {
      'profileId': 'glow_mock_profile_2026',
      'glowScore': 84,
      'face': {
        'hydration': 78,
        'wrinkles': 18,
        'spots': 16,
        'pores': 22,
        'subtono': 'Cálido',
        'bioAge': 26,
      },
      'hands': {
        'manchasSolares': 'mínima',
        'sequedad': 'óptima',
        'cuticulas': 'sanas',
        'unas': 'fuertes',
        'edadAparente': 25,
      },
      'dermoFamilies': {
        'sebumPores': {
          'score': 26,
          'level': 'Equilibrado',
          'suggestedTreatment': 'Limpieza facial profunda ultrasónica y exfoliación enzimática',
          'suggestedActive': 'Niacinamida 5% + Ácido Salicílico',
        },
        'pigmentationClarity': {
          'score': 20,
          'level': 'Tono Uniforme Radiante',
          'suggestedTreatment': 'Velo iluminador antioxidante con Vitamina C pura',
          'suggestedActive': 'Vitamina C pura 15% + Ácido Ferúlico',
        },
        'firmnessLines': {
          'score': 22,
          'level': 'Firmeza y Elasticidad Óptima',
          'suggestedTreatment': 'Radiofrecuencia facial reactivadora y masaje Kobido',
          'suggestedActive': 'Péptidos de Cobre + Ácido Hialurónico',
        },
        'barrierHydration': {
          'score': 84,
          'level': 'Barrera Cutánea Fortalecida',
          'suggestedTreatment': 'Velo de colágeno marino con hidratación profunda',
          'suggestedActive': 'Ácido Hialurónico Multimolecular + Ceramidas NP',
        },
      },
      'recommendation': 'Tu piel presenta una armonía luminosa con balance hídrico superior y subtono cálido dorado. Para potenciar tu GlowScore al 95+, combina activos antioxidantes por la mañana con masajes faciales semanales. En maquillaje, la paleta terracota, champagne y melocotón elevará exponencialmente tu visagismo.',
      'vtoTones': {
        'lipsticks': [
          {'name': 'Terracota Sunset', 'hex': '#B84A39', 'finish': 'Mate'},
          {'name': 'Warm Nude Satin', 'hex': '#C88A68', 'finish': 'Satinado'},
          {'name': 'Peach Glow Dew', 'hex': '#E05A47', 'finish': 'Brillante'},
          {'name': 'Berry Chic', 'hex': '#9E2A2B', 'finish': 'Mate'},
        ],
        'nails': [
          {'name': 'Terracota Chic', 'hex': '#B84A39', 'style': 'Almond'},
          {'name': 'Champagne Shimmer', 'hex': '#D4AF37', 'style': 'Square'},
          {'name': 'Velvet Nude', 'hex': '#C88A68', 'style': 'Oval'},
          {'name': 'Deep Burgundy', 'hex': '#4A0E17', 'style': 'Coffin'},
        ],
      },
      'products': [
        {
          'name': 'Serum Cera-Hyaluronic Booster',
          'brand': 'GlowLab Clinical',
          'image': '',
          'price': '\$78.000 COP',
          'compatible': true,
        },
        {
          'name': 'Protector Solar Fluid SPF 50+ Invisible',
          'brand': 'Bioderma Photoderm',
          'image': '',
          'price': '\$95.000 COP',
          'compatible': true,
        },
        {
          'name': 'Aceite Labial Con Péptidos Honey Peach',
          'brand': 'Aura Luxe Atelier',
          'image': '',
          'price': '\$45.000 COP',
          'compatible': true,
        },
      ],
    };
  }

  static Future<List<ColorPaletteItem>> getColorPalette(String hex,
      {int count = 5, String mode = 'analogic'}) async {
    final baseUrl = await getBaseUrl();
    final token = await AuthService.getToken();
    try {
      final response = await http.get(
        Uri.parse(
            '$baseUrl/api/color/palette?hex=$hex&count=$count&mode=$mode'),
        headers: {
          if (token != null) 'Authorization': 'Bearer $token',
        },
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['palette'] != null) {
          return (data['palette'] as List)
              .map((item) => ColorPaletteItem.fromJson(item))
              .toList();
        }
      }
      return [];
    } catch (e) {
      debugPrint('Error getting color palette: $e');
      return [];
    }
  }

  static Future<Map<String, dynamic>?> getUV() async {
    final baseUrl = await getBaseUrl();
    final token = await AuthService.getToken();
    final position = await LocationService.getCurrentPosition();
    if (position == null) return null;

    try {
      final response = await http.get(
        Uri.parse(
            '$baseUrl/api/biometric/check-uv?lat=${position.latitude}&lng=${position.longitude}'),
        headers: {
          if (token != null) 'Authorization': 'Bearer $token',
        },
      );
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
    } catch (e) {
      debugPrint('Error getting UV: $e');
    }
    return null;
  }

  static Future<List<ProductDetail>> getRecommendedProducts() async {
    try {
      final baseUrl = await getBaseUrl();
      final token = await AuthService.getToken();
      final prefs = await SharedPreferences.getInstance();
      final userId = prefs.getString('userId') ?? 'test-user';

      final response = await http.get(
        Uri.parse('$baseUrl/api/biometric/recommended/$userId'),
        headers: {
          if (token != null) 'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 8));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['products'] != null && (data['products'] as List).isNotEmpty) {
          return (data['products'] as List)
              .map((p) => ProductDetail.fromJson(p))
              .toList();
        }
      }
    } catch (e) {
      debugPrint('❌ [BiometricService] Error cargando productos recomendados: $e');
    }

    // A360-2026-09-22/C-04: antes se devolvía aquí una lista de productos
    // inventados (barcodes, precios y marcas ficticias). Sin respuesta real del
    // backend no hay recomendaciones: se devuelve vacío, nunca datos fabricados.
    return [];
  }

  static Future<ProductDetail?> checkProduct(String barcode) async {
    final baseUrl = await getBaseUrl();
    final token = await AuthService.getToken();
    final prefs = await SharedPreferences.getInstance();
    final userId = prefs.getString('userId') ?? 'test-user';

    final response = await http.post(
      Uri.parse('$baseUrl/api/biometric/check'),
      headers: {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      },
      body: jsonEncode({
        'userId': userId,
        'barcode': barcode,
      }),
    );

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      if (data['product'] != null) {
        return ProductDetail.fromJson(data['product']);
      }
    }
    return null;
  }

  /// Compresión de imagen ejecutada en un Isolate separado para no bloquear el main thread.
  /// Se usa como top-level function compatible con `compute()`.
  static Uint8List _compressImageIsolate(Uint8List bytes) {
    if (bytes.isEmpty) return bytes;
    try {
      final decodedImage = img.decodeImage(bytes);
      if (decodedImage == null) return bytes;

      img.Image resized;
      if (decodedImage.width > 1024 || decodedImage.height > 1024) {
        if (decodedImage.width > decodedImage.height) {
          resized = img.copyResize(decodedImage, width: 1024);
        } else {
          resized = img.copyResize(decodedImage, height: 1024);
        }
      } else {
        resized = decodedImage;
      }
      return Uint8List.fromList(img.encodeJpg(resized, quality: 75));
    } catch (e) {
      return bytes;
    }
  }
}

class ColorPaletteItem {
  final String hex;
  final String name;
  final String hsl;
  final String rgb;

  ColorPaletteItem(
      {required this.hex,
      required this.name,
      required this.hsl,
      required this.rgb});

  factory ColorPaletteItem.fromJson(Map<String, dynamic> json) {
    return ColorPaletteItem(
      hex: json['hex'] ?? '',
      name: json['name'] ?? '',
      hsl: json['hsl'] ?? '',
      rgb: json['rgb'] ?? '',
    );
  }
}
