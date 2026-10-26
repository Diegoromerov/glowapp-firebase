// frontend/lib/services/app_update_service.dart
//
// FIX-FLUTTER-06 (P1 · API drift): la app no declaraba versión mínima soportada
// ni ejecutaba ningún chequeo de actualización forzada. Este servicio fija la
// política del lado cliente:
//
//   * El backend publica la política en `GET /api/health`
//     (`minimum_app_version`, `latest_app_version`).
//   * La app compara su versión instalada (`pubspec.yaml` → `version:`)
//     contra esa política y decide: al día / opcional / FORZADA.
//   * Es **fail-open**: si la política falta, viene ilegible, el endpoint no
//     responde o el cuerpo no es JSON, NUNCA se bloquea la app. Un bloqueo
//     por un fallo de red dejaría al usuario sin app usable.
//
// Sin dependencias nuevas: la comparación es semántica propia (no se agregó
// `package_info_plus` ni `url_launcher`), y la versión instalada se declara en
// `currentVersion`, con un test que la mantiene sincronizada con `pubspec.yaml`.

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Resultado de comparar la versión instalada con la política del backend.
enum AppUpdateStatus {
  /// La versión instalada es >= mínimo y >= última publicada.
  upToDate,

  /// Hay una versión más nueva, pero la instalada sigue soportada.
  optionalUpdate,

  /// La versión instalada < mínimo soportado: la app debe bloquearse.
  forcedUpdate,
}

/// Versión semántica mínima necesaria para comparar la política del backend.
///
/// Ignora el build number (`+N`) para la comparación, igual que Android/iOS:
/// `1.0.0+9` y `1.0.0` son la misma versión de producto.
class AppVersion implements Comparable<AppVersion> {
  final int major;
  final int minor;
  final int patch;

  /// Build number (`1.0.0+42` → 42). No participa en el orden.
  final int build;

  /// `1.2.0-beta.1` → true. Una prerelease ordena antes que su release.
  final bool isPrerelease;

  const AppVersion(
    this.major,
    this.minor,
    this.patch, {
    this.build = 0,
    this.isPrerelease = false,
  });

  @override
  int compareTo(AppVersion other) {
    if (major != other.major) return major < other.major ? -1 : 1;
    if (minor != other.minor) return minor < other.minor ? -1 : 1;
    if (patch != other.patch) return patch < other.patch ? -1 : 1;
    if (isPrerelease != other.isPrerelease) return isPrerelease ? -1 : 1;
    return 0;
  }

  bool operator <(AppVersion other) => compareTo(other) < 0;
  bool operator >(AppVersion other) => compareTo(other) > 0;
  bool operator <=(AppVersion other) => compareTo(other) <= 0;
  bool operator >=(AppVersion other) => compareTo(other) >= 0;

  @override
  String toString() => '$major.$minor.$patch${isPrerelease ? '-pre' : ''}';
}

/// Decisión de actualización ya evaluada, lista para la UI.
class AppUpdateDecision {
  final AppUpdateStatus status;

  /// Versión instalada evaluada (tal cual se recibió, o null si ilegible).
  final String? currentVersion;

  /// Versión mínima soportada publicada por el backend, si existe.
  final String? minimumVersion;

  /// Última versión publicada, si el backend la informa.
  final String? latestVersion;

  const AppUpdateDecision({
    required this.status,
    this.currentVersion,
    this.minimumVersion,
    this.latestVersion,
  });

  /// Estado neutro: la app no debe bloquearse ni molestar al usuario.
  const AppUpdateDecision.alDia({
    this.currentVersion,
    this.minimumVersion,
    this.latestVersion,
  }) : status = AppUpdateStatus.upToDate;

  bool get isForced => status == AppUpdateStatus.forcedUpdate;
  bool get isOptional => status == AppUpdateStatus.optionalUpdate;
}

/// Servicio de política de versión / actualización forzada.
class AppUpdateService {
  /// Versión instalada de la app. Debe seguir a `frontend/pubspec.yaml:version`.
  /// `app_update_service_test.dart` falla si ambas divergen.
  static const String currentVersion = '1.0.0';

  /// Destino del CTA de actualización forzada.
  static const String storeUrl =
      'https://play.google.com/store/apps/details?id=com.example.beauty_app';

  /// Timeout corto: el chequeo es de arranque y no debe retrasar el splash.
  static const Duration defaultTimeout = Duration(seconds: 5);

  /// Parsea una versión semántica. Devuelve null si no es legible; nunca lanza.
  static AppVersion? parseVersion(String? raw) {
    if (raw == null) return null;
    var text = raw.trim();
    if (text.isEmpty) return null;
    if (text.startsWith('v') || text.startsWith('V')) {
      text = text.substring(1);
    }

    // Build metadata: se descarta de la comparación.
    var build = 0;
    final plus = text.indexOf('+');
    if (plus >= 0) {
      final rawBuild = text.substring(plus + 1).trim();
      build = int.tryParse(rawBuild) ?? 0;
      text = text.substring(0, plus);
    }

    // Prerelease: `1.2.0-beta.1`.
    var isPrerelease = false;
    final dash = text.indexOf('-');
    if (dash >= 0) {
      isPrerelease = text.substring(dash + 1).trim().isNotEmpty;
      text = text.substring(0, dash);
    }

    final parts = text.split('.');
    if (parts.isEmpty) return null;

    final numbers = <int>[];
    for (final part in parts) {
      final trimmed = part.trim();
      if (trimmed.isEmpty) return null;
      final value = int.tryParse(trimmed);
      if (value == null || value < 0) return null;
      numbers.add(value);
    }
    if (numbers.isEmpty) return null;

    return AppVersion(
      numbers.isNotEmpty ? numbers[0] : 0,
      numbers.length > 1 ? numbers[1] : 0,
      numbers.length > 2 ? numbers[2] : 0,
      build: build,
      isPrerelease: isPrerelease,
    );
  }

  /// -1 | 0 | 1. Si alguna versión es ilegible devuelve 0 (no comparable).
  static int compareVersions(String? a, String? b) {
    final left = parseVersion(a);
    final right = parseVersion(b);
    if (left == null || right == null) return 0;
    return left.compareTo(right);
  }

  /// Decide la política frente a la versión instalada. **Fail-open**: cualquier
  /// dato faltante o ilegible ⇒ [AppUpdateStatus.upToDate].
  static AppUpdateDecision evaluate({
    required String? currentVersion,
    required String? minimumVersion,
    String? latestVersion,
  }) {
    final current = parseVersion(currentVersion);
    final minimum = parseVersion(minimumVersion);

    // Sin política legible no hay base para bloquear a nadie.
    if (current == null || minimum == null) {
      return AppUpdateDecision.alDia(
        currentVersion: currentVersion,
        minimumVersion: minimumVersion,
        latestVersion: latestVersion,
      );
    }

    if (current < minimum) {
      return AppUpdateDecision(
        status: AppUpdateStatus.forcedUpdate,
        currentVersion: currentVersion,
        minimumVersion: minimumVersion,
        latestVersion: latestVersion,
      );
    }

    final latest = parseVersion(latestVersion);
    if (latest != null && current < latest) {
      return AppUpdateDecision(
        status: AppUpdateStatus.optionalUpdate,
        currentVersion: currentVersion,
        minimumVersion: minimumVersion,
        latestVersion: latestVersion,
      );
    }

    return AppUpdateDecision.alDia(
      currentVersion: currentVersion,
      minimumVersion: minimumVersion,
      latestVersion: latestVersion,
    );
  }

  /// Consulta `GET {baseUrl}/api/health` y evalúa la política publicada.
  ///
  /// Nunca lanza: cualquier fallo (red, HTTP != 200, cuerpo no-JSON) devuelve
  /// una decisión [AppUpdateStatus.upToDate].
  static Future<AppUpdateDecision> check({
    required String baseUrl,
    http.Client? client,
    String? currentVersion,
    Duration timeout = defaultTimeout,
  }) async {
    final instalada = currentVersion ?? AppUpdateService.currentVersion;
    final uri = Uri.parse('${baseUrl.replaceAll(RegExp(r'/+$'), '')}/api/health');
    final http.Client effective = client ?? http.Client();

    try {
      final response = await effective.get(uri).timeout(timeout);
      if (response.statusCode != 200) {
        return AppUpdateDecision.alDia(currentVersion: instalada);
      }

      final decoded = jsonDecode(response.body);
      if (decoded is! Map) {
        return AppUpdateDecision.alDia(currentVersion: instalada);
      }

      return evaluate(
        currentVersion: instalada,
        minimumVersion: decoded['minimum_app_version']?.toString(),
        latestVersion: decoded['latest_app_version']?.toString(),
      );
    } catch (_) {
      // Fail-open deliberado: un fallo al consultar la política no puede
      // impedir usar la app.
      return AppUpdateDecision.alDia(currentVersion: instalada);
    } finally {
      if (client == null) effective.close();
    }
  }
}
