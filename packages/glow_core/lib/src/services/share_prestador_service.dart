// Compartir la ficha de un prestador, en un solo sitio (cliente y proveedor).
//
// La pantalla de la ficha ya sabía compartir; las tarjetas del catálogo y el
// portafolio no. Duplicar el flujo en cada punto garantiza que uno de ellos se
// quede sin registrar el share (o mostrando un XP que nadie otorgó), así que la
// lógica vive aquí: arma el enlace con tarjeta, abre la hoja del sistema y
// registra el compartir para que el XP sea real.
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:share_plus/share_plus.dart';

import 'social_share_service.dart';

/// Resultado de intentar compartir.
class ResultadoCompartir {
  /// `false` si el usuario cerró la hoja sin compartir (no se registra nada).
  final bool compartido;

  /// XP que el backend confirmó. Nunca se inventa: si el registro falla, es 0.
  final int xpGanado;

  const ResultadoCompartir({required this.compartido, required this.xpGanado});

  static const noCompartido =
      ResultadoCompartir(compartido: false, xpGanado: 0);
}

/// Firma de la hoja de compartir, inyectable para poder probar sin plataforma.
typedef CompartirFn = Future<ShareResultStatus> Function(String texto);

/// Firma del registro en el backend, inyectable por la misma razón.
typedef RegistrarFn = Future<Map<String, dynamic>> Function(String providerId);

Future<ShareResultStatus> _compartirReal(String texto) async {
  final resultado = await SharePlus.instance.share(ShareParams(
    title: 'Compartir perfil',
    subject: 'Mira este perfil de belleza en GlowApp',
    text: texto,
  ));
  return resultado.status;
}

Future<Map<String, dynamic>> _registrarReal(String providerId) =>
    SocialShareService.logShare(
      platform: 'SISTEMA',
      contentType: 'PROVIDER_PROFILE',
      shareReferenceId: providerId,
    );

/// Comparte la ficha y, solo si la hoja se completó, registra el share.
///
/// El registro no bloquea el resultado: si el backend falla, el usuario igual
/// compartió y la app no debe mostrarle un error por eso. Pero tampoco se
/// anuncia XP que no se otorgó.
Future<ResultadoCompartir> compartirPrestador({
  required String providerId,
  required String baseUrl,
  String? nombre,
  CompartirFn? compartir,
  RegistrarFn? registrar,
}) async {
  if (providerId.trim().isEmpty) return ResultadoCompartir.noCompartido;

  final enlace = SocialShareService.enlacePrestador(
    baseUrl: baseUrl,
    providerId: providerId,
  );
  final texto = '¡Mira el perfil de ${nombre ?? 'esta profesional'} en GlowApp! $enlace';

  ShareResultStatus estado;
  try {
    estado = await (compartir ?? _compartirReal)(texto);
  } catch (error) {
    debugPrint('No se pudo abrir la hoja de compartir: $error');
    return ResultadoCompartir.noCompartido;
  }

  if (estado != ShareResultStatus.success) return ResultadoCompartir.noCompartido;

  try {
    final respuesta = await (registrar ?? _registrarReal)(providerId);
    final xp = (respuesta['xp_awarded'] as num?)?.toInt() ?? 0;
    return ResultadoCompartir(compartido: true, xpGanado: xp);
  } catch (error) {
    debugPrint('El share se hizo pero no se pudo registrar: $error');
    return const ResultadoCompartir(compartido: true, xpGanado: 0);
  }
}

/// Id público del prestador (el de `perfiles_prestador`, que es `usuarios.id`)
/// sacado del payload del JWT, para sesiones que no guardaron `userId`.
///
/// No confundir con el id de perfil de negocio del SaaS: `/s/provider/:id`
/// espera el id del usuario.
String? idPublicoDelToken(String? token) {
  if (token == null || token.isEmpty) return null;
  try {
    final partes = token.split('.');
    if (partes.length != 3) return null;
    final datos = json.decode(
      utf8.decode(base64Url.decode(base64Url.normalize(partes[1]))),
    );
    if (datos is! Map) return null;
    final id = datos['id'] ?? datos['userId'] ?? datos['sub'];
    final texto = id?.toString().trim();
    return (texto != null && texto.isNotEmpty) ? texto : null;
  } catch (_) {
    return null;
  }
}
