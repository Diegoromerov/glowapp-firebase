import 'dart:convert';

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

/// Convierte un error de red o de excepción en algo que el usuario pueda leer.
///
/// La app mostraba `$e` completo ("Exception: SocketException: Failed host
/// lookup"), que no le dice nada a una clienta. Aquí se traduce a una frase con
/// una acción implícita.
String mensajeHumano(Object error) {
  final texto = error.toString();

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
  if (texto.contains('401') ||
      texto.contains('UNAUTHORIZED') ||
      texto.contains('Unauthorized') ||
      texto.contains('sesión')) {
    return 'Tu sesión venció. Vuelve a iniciar sesión.';
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
