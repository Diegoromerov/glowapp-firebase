// frontend/lib/services/crash_reporting_service.dart
//
// FIX-FLUTTER-07 (P1) — Crash reporting con correlación backend.
//
// Antes: un crash de producción sólo se encolaba en AnalyticsService (flush
// cada 10s o al superar 10 eventos), se descartaba si el usuario desactivaba
// la telemetría y no llevaba identificador alguno, por lo que era imposible
// cruzar un crash de cliente con los logs del backend (ceguera en producción).
//
// Ahora: cada crash se persiste localmente y se envía de inmediato al backend
// con un correlation_id que viaja en el header `X-Trace-Id` (el mismo que el
// middleware `backend/src/middleware/traceId.js` expone como `req.traceId` y
// registra en los logs). Si el envío falla, el reporte sobrevive al reinicio
// de la app y se reintenta, conservando su correlation_id original.
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'api_service.dart';

/// Genera un identificador UUID v4 (correlation id / session id).
String generateCorrelationId() {
  final random = Random.secure();
  final values = List<int>.generate(16, (i) => random.nextInt(256));
  values[6] = (values[6] & 0x0f) | 0x40; // version 4
  values[8] = (values[8] & 0x3f) | 0x80; // variant RFC 4122
  final buffer = StringBuffer();
  for (var i = 0; i < 16; i++) {
    if (i == 4 || i == 6 || i == 8 || i == 10) {
      buffer.write('-');
    }
    buffer.write(values[i].toRadixString(16).padLeft(2, '0'));
  }
  return buffer.toString();
}

/// Un crash correlacionable con los logs del backend.
class CrashReport {
  CrashReport({
    required this.correlationId,
    required this.sessionId,
    required this.type,
    required this.message,
    required this.stack,
    required this.occurredAt,
    this.screenName = 'global',
  });

  /// Identificador que se envía como `X-Trace-Id` y como `correlation_id`.
  final String correlationId;
  final String sessionId;
  final String type; // FLUTTER | ASYNC
  final String message;
  final String stack;
  final DateTime occurredAt;
  final String screenName;

  String get eventType => 'APP_CRASH_$type';

  Map<String, dynamic> toEventPayload() => <String, dynamic>{
        'session_id': sessionId,
        'event_type': eventType,
        'screen_name': screenName,
        'element_id': null,
        'metadata': <String, dynamic>{
          'correlation_id': correlationId,
          // Mismo id que el backend guarda como trace_id (columna metadata).
          'trace_id': correlationId,
          'session_id': sessionId,
          'error': message,
          'stack': stack,
          'platform': defaultTargetPlatform.name,
          'build_mode': kReleaseMode
              ? 'release'
              : (kProfileMode ? 'profile' : 'debug'),
          'occurred_at': occurredAt.toUtc().toIso8601String(),
        },
        'creado_en': occurredAt.toUtc().toIso8601String(),
      };

  Map<String, dynamic> toJson() => <String, dynamic>{
        'correlation_id': correlationId,
        'session_id': sessionId,
        'type': type,
        'message': message,
        'stack': stack,
        'screen_name': screenName,
        'occurred_at': occurredAt.toUtc().toIso8601String(),
      };

  factory CrashReport.fromJson(Map<String, dynamic> json) => CrashReport(
        correlationId: json['correlation_id'] as String,
        sessionId: (json['session_id'] as String?) ?? 'unknown',
        type: (json['type'] as String?) ?? 'ASYNC',
        message: (json['message'] as String?) ?? '',
        stack: (json['stack'] as String?) ?? '',
        screenName: (json['screen_name'] as String?) ?? 'global',
        occurredAt:
            DateTime.tryParse((json['occurred_at'] as String?) ?? '')?.toUtc() ??
                DateTime.now().toUtc(),
      );
}

/// Persistencia local de crashes pendientes de entrega.
abstract class CrashReportStore {
  Future<List<CrashReport>> load();
  Future<void> save(List<CrashReport> reports);
}

/// Store por defecto: SharedPreferences, con cola acotada.
class SharedPreferencesCrashReportStore implements CrashReportStore {
  static const String _key = 'pending_crash_reports_v1';
  static const int _maxReports = 50;

  @override
  Future<List<CrashReport>> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_key);
      if (raw == null || raw.isEmpty) return <CrashReport>[];
      final decoded = json.decode(raw) as List<dynamic>;
      return decoded
          .whereType<Map<dynamic, dynamic>>()
          .map((item) => CrashReport.fromJson(Map<String, dynamic>.from(item)))
          .toList();
    } catch (_) {
      // Un store corrupto nunca debe tirar la app.
      return <CrashReport>[];
    }
  }

  @override
  Future<void> save(List<CrashReport> reports) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final capped = reports.length > _maxReports
          ? reports.sublist(reports.length - _maxReports)
          : reports;
      await prefs.setString(
        _key,
        json.encode(capped.map((report) => report.toJson()).toList()),
      );
    } catch (_) {
      // Idem: la persistencia no puede romper el reporte en curso.
    }
  }
}

/// Servicio de crash reporting con correlación backend.
///
/// Se envía de inmediato (sin batching ni timer) y no depende de la
/// preferencia de telemetría del usuario: es telemetría operativa.
class CrashReportingService {
  CrashReportingService({
    http.Client? client,
    String? baseUrl,
    Future<Map<String, String>> Function()? headerProvider,
    CrashReportStore? store,
    String Function()? correlationIdFactory,
    String Function()? sessionIdFactory,
  })  : _client = client ?? http.Client(),
        _baseUrlOverride = baseUrl,
        _headerProvider = headerProvider ?? ApiService.getAuthHeaders,
        _store = store ?? SharedPreferencesCrashReportStore(),
        _correlationIdFactory = correlationIdFactory ?? generateCorrelationId,
        _sessionIdFactory = sessionIdFactory ?? generateCorrelationId;

  static CrashReportingService? _instance;
  static CrashReportingService get instance =>
      _instance ??= CrashReportingService();
  static set instance(CrashReportingService value) => _instance = value;

  final http.Client _client;
  final String? _baseUrlOverride;
  final Future<Map<String, String>> Function() _headerProvider;
  final CrashReportStore _store;
  final String Function() _correlationIdFactory;
  final String Function() _sessionIdFactory;

  final List<CrashReport> _pending = <CrashReport>[];
  bool _initialized = false;
  bool _flushing = false;

  /// Id de sesión del proceso actual.
  late final String sessionId = _sessionIdFactory();

  /// Reintenta los crashes pendientes de ejecuciones anteriores.
  Future<void> init() async {
    if (_initialized) return;
    _initialized = true;
    final stored = await _store.load();
    _pending
      ..clear()
      ..addAll(stored);
    await flushPending();
  }

  /// Handler para `FlutterError.onError`.
  Future<void> reportFlutterError(FlutterErrorDetails details,
      {String? screenName}) {
    return _report(
      type: 'FLUTTER',
      message: details.exceptionAsString(),
      stack: details.stack?.toString() ?? '',
      screenName: screenName ?? 'global',
    );
  }

  /// Handler para errores no capturados del zone (`runZonedGuarded`).
  Future<void> reportAsyncError(Object error, StackTrace stack,
      {String? screenName}) {
    return _report(
      type: 'ASYNC',
      message: error.toString(),
      stack: stack.toString(),
      screenName: screenName ?? 'global',
    );
  }

  Future<void> _report({
    required String type,
    required String message,
    required String stack,
    required String screenName,
  }) async {
    final report = CrashReport(
      correlationId: _correlationIdFactory(),
      sessionId: sessionId,
      type: type,
      message: message,
      stack: stack,
      screenName: screenName,
      occurredAt: DateTime.now().toUtc(),
    );

    _pending.add(report);
    // Persistir ANTES de enviar: un crash puede matar el proceso en vuelo.
    await _persist();
    await _send(report);
  }

  /// Reintenta todo lo que siga pendiente.
  Future<void> flushPending() async {
    if (_flushing || _pending.isEmpty) return;
    _flushing = true;
    try {
      for (final report in List<CrashReport>.from(_pending)) {
        await _send(report);
      }
    } finally {
      _flushing = false;
    }
  }

  Future<void> _send(CrashReport report) async {
    try {
      final baseUrl = await _resolveBaseUrl();
      final headers = Map<String, String>.from(await _headerProvider());
      headers['Content-Type'] = 'application/json';
      // Contrato de correlación: el backend lee este header en el middleware
      // traceId y lo registra junto al evento persistido.
      headers['X-Trace-Id'] = report.correlationId;

      final response = await _client
          .post(
            Uri.parse('$baseUrl/api/analytics/events'),
            headers: headers,
            body: json.encode(<String, dynamic>{
              'events': <Map<String, dynamic>>[report.toEventPayload()],
            }),
          )
          .timeout(const Duration(seconds: 10));

      if (response.statusCode >= 200 && response.statusCode < 300) {
        _pending.remove(report);
        await _persist();
      } else if (kDebugMode) {
        debugPrint(
            '🛑 CrashReportingService: envío falló (${response.statusCode}); se reintentará');
      }
    } catch (e) {
      // El crash reporting nunca debe propagar su propio fallo.
      if (kDebugMode) {
        debugPrint('🛑 CrashReportingService: error enviando crash: $e');
      }
    }
  }

  Future<String> _resolveBaseUrl() async {
    final override = _baseUrlOverride;
    if (override != null) return override;
    await ApiService.ensureBaseUrl();
    return ApiService.baseUrl;
  }

  Future<void> _persist() => _store.save(List<CrashReport>.from(_pending));

  /// Crashes aún no entregados (diagnóstico/tests).
  int get pendingCount => _pending.length;
}
