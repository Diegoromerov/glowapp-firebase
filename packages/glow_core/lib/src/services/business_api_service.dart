import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/business_profile_model.dart';
import 'api_service.dart';

/// GLOWAPP BUSINESS API SERVICE
/// Connects Flutter Business Engine UI with Express Backend (/api/v1/business).

class BusinessApiService {
  final String baseUrl;
  final String? authToken;

  BusinessApiService({
    this.baseUrl = 'http://localhost:5000/api/v1/business',
    this.authToken,
  });

  /// Construye el servicio con la URL y el token que ya usa la app.
  ///
  /// El valor por defecto del constructor (`localhost:5000`) apunta a un
  /// servidor que en esta app no existe: el backend vive en el puerto 8080 y la
  /// URL real la resuelve `ApiService.baseUrl` según la plataforma. Sin esto la
  /// pantalla nunca podría hablar con la API.
  static Future<BusinessApiService> fromSession() async {
    final headers = await ApiService.getAuthHeaders();
    final auth = headers['Authorization'] ?? '';
    return BusinessApiService(
      baseUrl: '${ApiService.baseUrl}/api/v1/business',
      authToken: auth.startsWith('Bearer ') ? auth.substring(7) : auth,
    );
  }

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (authToken != null && authToken!.isNotEmpty) 'Authorization': 'Bearer $authToken',
      };

  /// GET /api/v1/business/summary
  Future<Map<String, dynamic>> fetchBusinessSummary() async {
    final uri = Uri.parse('$baseUrl/summary');
    final response = await http.get(uri, headers: _headers);

    if (response.statusCode == 200) {
      final jsonBody = jsonDecode(response.body);
      return jsonBody['data'] as Map<String, dynamic>;
    } else {
      throw Exception('Failed to fetch business summary: ${response.statusCode}');
    }
  }

  /// POST /api/v1/business/diagnostic
  Future<BusinessProfileModel> runDiagnostic({
    required String mode,
    required String verticalCode,
    required String name,
    required String city,
  }) async {
    final uri = Uri.parse('$baseUrl/diagnostic');
    final response = await http.post(
      uri,
      headers: _headers,
      body: jsonEncode({
        'onboarding_mode': mode,
        'vertical_code': verticalCode,
        'name': name,
        'city': city,
      }),
    );

    if (response.statusCode == 200) {
      final jsonBody = jsonDecode(response.body);
      return BusinessProfileModel.fromJson(jsonBody['data']['profile'] as Map<String, dynamic>);
    } else {
      throw Exception('Failed to execute diagnostic: ${response.statusCode}');
    }
  }

  /// GET /api/v1/business/tasks
  Future<List<BusinessTaskModel>> fetchTasks() async {
    final uri = Uri.parse('$baseUrl/tasks');
    final response = await http.get(uri, headers: _headers);

    if (response.statusCode == 200) {
      final jsonBody = jsonDecode(response.body);
      final list = jsonBody['data'] as List? ?? [];
      return list.map((item) => BusinessTaskModel.fromJson(item as Map<String, dynamic>)).toList();
    } else {
      throw Exception('Failed to fetch tasks: ${response.statusCode}');
    }
  }

  /// POST /api/v1/business/tasks/:id/advance
  ///
  /// Mueve la tarea a la siguiente etapa del flujo guiado
  /// (ENTENDER -> EXPLICAR -> RECOMENDAR -> EJECUTAR -> VERIFICAR). La etapa y el
  /// estado los decide el backend (`businessWorkflowService.advanceTaskStage`),
  /// no la pantalla. Acciones válidas: NEXT, SUBMIT_EVIDENCE, VERIFY.
  Future<BusinessTaskModel> advanceTask({
    required String taskId,
    required String action,
    String? notes,
  }) async {
    final uri = Uri.parse('$baseUrl/tasks/$taskId/advance');
    final response = await http.post(
      uri,
      headers: _headers,
      body: jsonEncode({
        'action': action,
        if (notes != null) 'notes': notes,
      }),
    );

    if (response.statusCode == 200) {
      final jsonBody = jsonDecode(response.body);
      final data = jsonBody['data'];
      final taskJson = (data is Map && data['task'] is Map)
          ? Map<String, dynamic>.from(data['task'] as Map)
          : Map<String, dynamic>.from(data as Map);
      return BusinessTaskModel.fromJson(taskJson);
    } else {
      throw Exception('No se pudo avanzar la tarea (${response.statusCode})');
    }
  }

  /// POST /api/v1/business/tasks/:id/evidence (multipart)
  ///
  /// La evidencia se sube como ARCHIVO real en el campo `file`. Antes el
  /// endpoint aceptaba `file_path` declarado por el cliente: quedaba registrado
  /// como evidencia un archivo que no existía. Ahora el servidor guarda el
  /// archivo y devuelve la ruta que él mismo generó
  /// (ver backend/src/middleware/evidenceUpload.js).
  ///
  /// `evidenceType` debe ser uno de los que acepta la base de datos:
  /// DOCUMENT, PHOTO, CONTRACT, FORM o DECLARATION.
  Future<Map<String, dynamic>> uploadEvidence({
    required String taskId,
    required String filePath,
    String evidenceType = 'PHOTO',
    String? notes,
  }) async {
    final uri = Uri.parse('$baseUrl/tasks/$taskId/evidence');
    final request = http.MultipartRequest('POST', uri);
    if (authToken != null && authToken!.isNotEmpty) {
      request.headers['Authorization'] = 'Bearer $authToken';
    }
    request.files.add(await http.MultipartFile.fromPath('file', filePath));
    request.fields['evidence_type'] = evidenceType;
    if (notes != null && notes.isNotEmpty) request.fields['notes'] = notes;

    final streamed = await request.send();
    final response = await http.Response.fromStream(streamed);
    final jsonBody = jsonDecode(response.body) as Map<String, dynamic>;

    if (response.statusCode == 200) {
      return (jsonBody['data'] as Map<String, dynamic>?) ?? jsonBody;
    }
    throw Exception(
      jsonBody['error']?.toString() ?? 'No se pudo subir la evidencia (${response.statusCode})',
    );
  }

  /// POST /api/v1/business/documents/generate
  Future<Map<String, dynamic>> generateDocument({
    required String templateCode,
    required Map<String, String> variables,
    String? businessProfileId,
  }) async {
    final uri = Uri.parse('$baseUrl/documents/generate');
    final response = await http.post(
      uri,
      headers: _headers,
      body: jsonEncode({
        'template_code': templateCode,
        'variables': variables,
        if (businessProfileId != null) 'business_profile_id': businessProfileId,
      }),
    );

    if (response.statusCode == 200) {
      final jsonBody = jsonDecode(response.body);
      return jsonBody['data'] as Map<String, dynamic>;
    } else {
      throw Exception('Failed to generate document: ${response.statusCode}');
    }
  }

  /// POST /api/v1/business/documents/:id/request-signature
  Future<Map<String, dynamic>> requestSignature(String documentId) async {
    final uri = Uri.parse('$baseUrl/documents/$documentId/request-signature');
    final response = await http.post(uri, headers: _headers);

    if (response.statusCode == 200) {
      final jsonBody = jsonDecode(response.body);
      return jsonBody['data'] as Map<String, dynamic>;
    } else {
      throw Exception('Failed to request signature: ${response.statusCode}');
    }
  }

  /// POST /api/v1/business/documents/:id/sign
  Future<Map<String, dynamic>> signDocument(String documentId, {required String signerName}) async {
    final uri = Uri.parse('$baseUrl/documents/$documentId/sign');
    final response = await http.post(
      uri,
      headers: _headers,
      body: jsonEncode({'signer_name': signerName}),
    );

    if (response.statusCode == 200) {
      final jsonBody = jsonDecode(response.body);
      return jsonBody['data'] as Map<String, dynamic>;
    } else {
      throw Exception('Failed to sign document: ${response.statusCode}');
    }
  }
}
