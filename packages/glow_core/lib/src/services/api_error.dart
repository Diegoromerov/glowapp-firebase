import 'dart:convert';

/// Respuesta estructurada cuando el backend impide una operación por cuota SaaS.
class SaasQuotaExceededException implements Exception {
  const SaasQuotaExceededException({
    required this.message,
    this.feature,
    this.current,
    this.limit,
    this.plan,
    this.upgradeUrl,
  });

  final String message;
  final String? feature;
  final int? current;
  final int? limit;
  final String? plan;
  final String? upgradeUrl;

  @override
  String toString() => message;
}

/// Conserva los datos de uso/límite que algunas pantallas necesitan para dar
/// contexto y ofrecer una ruta clara a Facturación.
SaasQuotaExceededException? parseSaasQuotaExceeded(String body) {
  try {
    final data = jsonDecode(body);
    if (data is! Map || data['code'] != 'SAAS_QUOTA_EXCEEDED') return null;

    int? asInt(dynamic value) {
      if (value is num) return value.toInt();
      return int.tryParse(value?.toString() ?? '');
    }

    return SaasQuotaExceededException(
      message:
          (data['error'] ?? data['message'] ?? 'Se alcanzó el límite del plan.')
              .toString(),
      feature: data['feature']?.toString(),
      current: asInt(data['current']),
      limit: asInt(data['limit'] ?? data['max']),
      plan: (data['currentPlan'] ?? data['plan'])?.toString(),
      upgradeUrl: data['upgradeUrl']?.toString(),
    );
  } catch (_) {
    return null;
  }
}

/// Extrae un mensaje legible del cuerpo de una respuesta HTTP fallida.
///
/// El cuerpo de un error no siempre es JSON: un 502/503/504 de un proxy, un
/// nginx o una plataforma devuelven HTML o vacío. Decodificar a ciegas lanzaba
/// `FormatException` y el error real desaparecía detrás de un mensaje de
/// parseo. Aquí nunca se propaga una excepción ni se devuelve HTML crudo.
String extractApiError(int statusCode, String body, {String? fallback}) {
  final porDefecto = fallback ?? _mensajePorEstado(statusCode);

  if (body.trim().isNotEmpty) {
    try {
      final data = jsonDecode(body);
      if (data is Map) {
        final detalle = data['error'] ?? data['message'];
        if (detalle != null && detalle.toString().trim().isNotEmpty) {
          return detalle.toString();
        }
      }
    } catch (_) {
      // Cuerpo no JSON (HTML, texto plano, vacío): se usa el mensaje por estado.
    }
  }

  return '$statusCode $porDefecto';
}

String _mensajePorEstado(int status) {
  switch (status) {
    case 400:
      return 'Solicitud inválida';
    case 401:
      return 'Tu sesión expiró, vuelve a iniciar sesión';
    case 403:
      return 'No tienes permisos para esta acción';
    case 404:
      return 'No se encontró el recurso';
    case 409:
      return 'La operación choca con el estado actual';
    case 422:
      return 'Los datos enviados no son válidos';
    case 429:
      return 'Demasiados intentos, espera un momento';
    case 500:
      return 'Error interno del servidor';
    case 502:
    case 503:
    case 504:
      return 'El servidor no está disponible, intenta en un momento';
  }
  return status >= 500 ? 'Error del servidor' : 'Error';
}

/// ¿El error es de sesión (token vencido, sin token, 401)?
///
/// Se usa para no ofrecer «Reintentar» cuando reintentar no puede funcionar: con
/// la sesión caída el reintento falla igual y la pantalla se queda en un bucle
/// que parece un fallo de la app. En ese caso lo correcto es mandar a iniciar
/// sesión.
bool esErrorDeSesion(Object error) {
  final texto = error.toString();
  return texto.contains('401') ||
      texto.contains('UNAUTHORIZED') ||
      texto.contains('Unauthorized') ||
      texto.contains('sesión');
}

/// Convierte un error de red o de excepción en algo que el usuario pueda leer.
///
/// La app mostraba `$e` completo ("Exception: SocketException: Failed host
/// lookup"), que no le dice nada a una clienta. Aquí se traduce a una frase con
/// una acción implícita.
String mensajeHumano(Object error) {
  final texto = error.toString();

  if (esErrorDeSesion(error)) {
    return 'Tu sesión venció. Vuelve a iniciar sesión.';
  }

  if (texto.contains('SocketException') ||
      texto.contains('ClientException') ||
      texto.contains('Failed host lookup') ||
      texto.contains('Network is unreachable') ||
      texto.contains('Connection refused')) {
    return 'No pudimos conectar. Revisa tu internet e inténtalo de nuevo.';
  }
  if (texto.contains('TimeoutException') || texto.contains('timed out')) {
    return 'La conexión está muy lenta. Inténtalo otra vez.';
  }
  if (texto.contains('500') || texto.contains('502') || texto.contains('503')) {
    return 'Algo falló de nuestro lado. Estamos en ello: prueba en un momento.';
  }

  // Los mensajes del backend ya están escritos para el usuario: se limpian del
  // prefijo técnico y se muestran.
  return texto
      .replaceFirst('Exception: ', '')
      .replaceFirst('Error: ', '')
      .trim();
}
