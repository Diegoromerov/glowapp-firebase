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

  /// Espejo del mismo sitio en el dominio de Firebase.
  static const _hostEspejo = 'glowapp-client.firebaseapp.com';

  /// Esquema propio: `glowapp://booking-tracking/<id>`.
  static const esquema = 'glowapp';

  /// URL de la pestaña tal como llegó, guardada antes de que el router la
  /// reescriba. Se llena con [capturarUrlDeArranque] al inicio de `main()`.
  static Uri? _urlDeArranque;

  /// Verdadero cuando la app se abrió con un enlace que sí era nuestro.
  ///
  /// Lo consulta el tour de bienvenida: si alguien llega desde un enlace
  /// compartido (la ficha de un prestador), el motor del tour pide volver a
  /// `/home` antes de su primera acción y se lleva por delante la pantalla que
  /// el enlace acababa de abrir. Con esta marca, el tour no arranca en esa
  /// entrada y el enlace manda.
  static bool _huboEnlaceProfundo = false;

  static bool get huboEnlaceProfundo => _huboEnlaceProfundo;

  /// URL con la que arrancó la pestaña (sin la reescritura del router).
  static Uri? get urlDeArranque => _urlDeArranque;

  /// La llama el host cuando un enlace se traduce a un destino real.
  static void marcarEnlaceConsumido() => _huboEnlaceProfundo = true;

  /// Debe llamarse en `main()` antes de `runApp`.
  static void capturarUrlDeArranque() {
    if (!kIsWeb) return;
    _urlDeArranque = Uri.base;
    // Se resuelve aquí, antes de `runApp`: el tour de bienvenida decide en el
    // primer frame y necesita saber ya si la entrada fue un enlace.
    _huboEnlaceProfundo = mapear(inicialWeb() ?? Uri()) != null;
  }

  /// Sólo para pruebas: fija la URL de arranque sin depender del navegador.
  static void fijarUrlDeArranqueParaPruebas(Uri? url) => _urlDeArranque = url;

  /// Rutas internas del router. La URL de la propia app (`/#/home`, `/#/chat`,
  /// `/#/auth/login`...) NO es un enlace entrante. Antes se procesaba como uno:
  /// al abrir la app, el host veía `#/home` recién puesto por Flutter, no había
  /// sesión y hacía `pushNamedAndRemoveUntil('/auth/login')` — por eso la home
  /// nunca se veía: la app se auto-expulsaba al login en cada carga.
  static const Set<String> _rutasInternas = {
    'home', 'chat', 'store', 'my-bookings', 'profile', 'support', 'settings',
    'disputes', 'terms', 'privacy', 'rewards', 'my-glow', 'glowstore-orders',
    'biometric-history', 'habeas-data', 'faq', 'delete-account', 'ideas',
  };

  /// Devuelve el destino, o `null` si el enlace no es de esta app (se ignora).
  static DestinoEnlace? mapear(Uri uri) {
    // El mismo bundle se sirve en el hosting de producción, en su espejo de
    // firebaseapp.com y en local (para validar un build antes de publicarlo).
    // Antes solo se aceptaba el host exacto de producción, así que el enlace
    // compartido no abría nada al probarlo en local. Un dominio de terceros
    // sigue ignorándose.
    final hostPropio = uri.host == host ||
        uri.host == _hostEspejo ||
        uri.host == 'localhost' ||
        uri.host == '127.0.0.1';
    final propio = uri.scheme == esquema ||
        hostPropio ||
        // Enlaces relativos (`/#/booking-tracking/...`) no traen host.
        (!uri.hasScheme && uri.path.isNotEmpty);
    if (!propio) return null;

    // El router web usa el fragmento (`/#/booking-tracking/...`); los enlaces de
    // correo y las páginas de compartir usan la ruta limpia. Se aceptan las dos
    // formas, pero el fragmento NO siempre manda: al arrancar, Flutter ya
    // reescribió la URL como `/provider-detail/3#/home`, y ese `#/home` es la
    // ruta interna de la app, no el enlace. Antes ganaba el fragmento, el enlace
    // se descartaba por «ruta interna» y el receptor aterrizaba en el mapa.
    final fragmento = uri.fragment;
    final fragmentoPrimero = _primero(fragmento);
    final fragmentoEsRutaInterna =
        fragmentoPrimero.isNotEmpty && _rutasInternas.contains(fragmentoPrimero);
    final crudo = (fragmento.isNotEmpty && !fragmentoEsRutaInterna)
        ? fragmento
        : uri.path;
    var partes =
        crudo.split('?').first.split('/').where((p) => p.isNotEmpty).toList();

    // En un esquema propio el primer segmento cae en el host:
    // `glowapp://provider-detail/42` → host=provider-detail, path=/42.
    if (uri.scheme != 'http' && uri.scheme != 'https' && uri.host.isNotEmpty) {
      partes = [uri.host, ...partes];
    }
    if (partes.isEmpty) return null;

    // La ruta propia de la app no es un enlace entrante.
    if (_rutasInternas.contains(partes.first)) return null;

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
        // Un enlace que no reconocemos se ignora. Antes devolvía `/home` con
        // aviso, y sin sesión eso terminaba en `pushNamedAndRemoveUntil` al
        // login: un enlace roto sacaba al usuario de la app.
        return null;
    }
  }

  /// Enlace inicial en web: el fragmento del router o la ruta limpia.
  ///
  /// El fragmento no siempre es el enlace: al arrancar, Flutter reescribe la URL
  /// como `/provider-detail/3#/home`. Si el fragmento es una ruta interna de la
  /// app y el path trae algo, el enlace real es el path.
  static Uri? inicialWeb() {
    // Sin guarda de plataforma a propósito: `Uri.base` existe en todas, y el
    // host sólo llama aquí en web (en móvil el enlace llega por app_links).
    // Se prefiere la URL capturada en `main()`: para cuando este método corre,
    // el router ya reescribió el historial como `/#/home` y el path del enlace
    // (`/provider-detail/3`) desapareció. Ese era el motivo de que el enlace
    // compartido aterrizara en el mapa.
    final base = _urlDeArranque ?? Uri.base;
    final frag = base.fragment.isEmpty
        ? ''
        : (base.fragment.startsWith('/') ? base.fragment : '/${base.fragment}');
    final fragInterno = frag.isNotEmpty && _rutasInternas.contains(_primero(frag));

    if (base.path.isNotEmpty &&
        base.path != '/' &&
        (frag.isEmpty || fragInterno)) {
      return base;
    }
    if (frag.isNotEmpty) return Uri.parse(frag);
    return null;
  }

  /// Primer segmento no vacío de una ruta (`/a/b` → `a`).
  static String _primero(String ruta) => ruta
      .split('?')
      .first
      .split('/')
      .firstWhere((p) => p.isNotEmpty, orElse: () => '');

  /// Rutas que un enlace puede abrir sin sesión.
  ///
  /// El catálogo es público a propósito (la app abre en modo exploración), así
  /// que exigir login para ver la ficha de un prestador rompía justo el enlace
  /// que se comparte: el receptor caía en el login. Las rutas personales siguen
  /// pidiendo sesión.
  static const Set<String> rutasPublicas = {'/provider-detail'};

  static bool requiereSesion(String ruta) => !rutasPublicas.contains(ruta);
}
