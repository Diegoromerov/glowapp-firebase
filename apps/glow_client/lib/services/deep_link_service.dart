// apps/glow_client/lib/services/deep_link_service.dart
//
// Item 14 de la auditoría: los enlaces que mandamos por correo (seguimiento de
// la cita, detalle del prestador, invitación) solo abrían en el navegador.
// Aquí se traduce un enlace entrante —`https://glowapp-client.web.app/...` o
// `glowapp://...`— a una ruta que la app ya sabe mostrar.
//
// Regla: un enlace desconocido NUNCA deja una pantalla en blanco. Siempre hay
// destino, y cuando no es el que el usuario esperaba se le dice por qué.

import 'package:flutter/foundation.dart' show kIsWeb;

/// A dónde llevar al usuario y qué contarle al llegar.
class DestinoEnlace {
  final String ruta;
  final Map<String, dynamic> argumentos;

  /// Aviso que se muestra al aterrizar (null = sin aviso).
  final String? aviso;

  const DestinoEnlace(this.ruta, {this.argumentos = const {}, this.aviso});

  @override
  String toString() => 'DestinoEnlace($ruta, aviso: $aviso)';
}

class DeepLinkService {
  /// Host público de la web del cliente.
  static const host = 'glowapp-client.web.app';

  /// Esquema propio: `glowapp://booking-tracking/<id>`.
  static const esquema = 'glowapp';

  /// Devuelve el destino, o `null` si el enlace no es de esta app (se ignora).
  static DestinoEnlace? mapear(Uri uri) {
    final propio = uri.scheme == esquema ||
        uri.host == host ||
        // Enlaces relativos (`/#/booking-tracking/...`) no traen host.
        (!uri.hasScheme && uri.path.isNotEmpty);
    if (!propio) return null;

    // El router web usa el fragmento (`/#/booking-tracking/...`); los enlaces de
    // correo usan la ruta limpia. Se aceptan las dos formas.
    final crudo = uri.fragment.isNotEmpty ? uri.fragment : uri.path;
    var partes =
        crudo.split('?').first.split('/').where((p) => p.isNotEmpty).toList();

    // En un esquema propio el primer segmento cae en el host:
    // `glowapp://provider-detail/42` → host=provider-detail, path=/42.
    if (uri.scheme != 'http' && uri.scheme != 'https' && uri.host.isNotEmpty) {
      partes = [uri.host, ...partes];
    }
    if (partes.isEmpty) return null;

    final query = uri.queryParameters;
    final idEnQuery =
        query['id'] ?? query['booking_id'] ?? query['provider_id'];

    switch (partes.first) {
      case 'booking-tracking':
        final id = partes.length > 1 ? partes[1] : idEnQuery;
        if (id == null || id.isEmpty) {
          return const DestinoEnlace(
            '/my-bookings',
            aviso: 'El enlace no indicaba qué reserva abrir. Revisa tus citas.',
          );
        }
        return DestinoEnlace(
          '/booking-tracking',
          argumentos: {
            'booking': {'id': id}
          },
        );

      case 'provider-detail':
        final id = partes.length > 1 ? partes[1] : idEnQuery;
        if (id == null || id.isEmpty) {
          return const DestinoEnlace(
            '/home',
            aviso: 'El enlace no indicaba qué prestador abrir.',
          );
        }
        return DestinoEnlace('/provider-detail',
            argumentos: {'providerId': id});

      case 'auth':
        // `/auth/accept-invitation` se retiró del cliente: las invitaciones de
        // salón se aceptan desde la app de prestadores. Se explica en vez de
        // aterrizar en una ruta que ya no existe.
        if (partes.length > 1 && partes[1] == 'accept-invitation') {
          return const DestinoEnlace(
            '/auth/login',
            aviso:
                'Las invitaciones de salón se aceptan desde la app de prestadores.',
          );
        }
        return null;

      default:
        return const DestinoEnlace(
          '/home',
          aviso: 'No reconocimos ese enlace. Te llevamos al inicio.',
        );
    }
  }

  /// Enlace inicial en web: el fragmento del router o la ruta limpia.
  static Uri? inicialWeb() {
    if (!kIsWeb) return null;
    final base = Uri.base;
    if (base.fragment.isNotEmpty) {
      final frag =
          base.fragment.startsWith('/') ? base.fragment : '/${base.fragment}';
      return Uri.parse(frag);
    }
    if (base.path.isNotEmpty && base.path != '/') return base;
    return null;
  }
}
