import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// Política de tratamiento de datos personales del **prestador**
/// (Ley 1581 de 2012, Colombia).
///
/// El mismo texto se publica como página estática en `/privacy.html` del
/// hosting del prestador para que la ficha de la tienda tenga una URL válida.
/// Difiere de la del cliente en los datos que trata: documentos de identidad,
/// certificaciones y datos de pago para liquidaciones.
class PrivacyPolicyScreen extends StatelessWidget {
  const PrivacyPolicyScreen({super.key});

  static const String urlPublica =
      'https://glowapp-provider.web.app/privacy.html';

  static const _tinta = Color(0xFF1F1A15);
  static const _cuerpo = Color(0xFF3A322C);
  static const _tenue = Color(0xFF6B6058);
  static const _fondo = Color(0xFFFDFBF7);
  static const _acento = Color(0xFF8A6A2F);

  static const List<Map<String, String>> secciones = [
    {
      'titulo': '1. Quién responde por tus datos',
      'cuerpo': 'GlowApp S.A.S. (en adelante «GlowApp») es el responsable del '
          'tratamiento de los datos personales que entregas al usar la '
          'aplicación del prestador. Contacto del responsable: '
          'privacidad@glowapp.co.',
    },
    {
      'titulo': '2. Qué datos recogemos',
      'cuerpo': 'Datos de identificación y contacto (nombre, correo, teléfono, '
          'ciudad, foto de perfil). Datos profesionales: servicios y precios '
          'publicados, portafolio, agenda, calificaciones y reseñas. Datos de '
          'verificación: documento de identidad, RUT y certificaciones cuando '
          'decides cargarlos. Datos de pago para liquidarte: banco, tipo de '
          'cuenta y número, y el historial de liquidaciones. Datos de ubicación, '
          'solo mientras compartes tu posición durante un servicio o abres el '
          'mapa. Datos biométricos, únicamente con autorización expresa y '
          'separada.',
    },
    {
      'titulo': '3. Para qué los usamos',
      'cuerpo': 'Verificar tu identidad y tus credenciales profesionales; '
          'mostrar tu perfil a los clientes y recibir reservas; gestionar la '
          'agenda y las citas; procesar pagos, liquidaciones y retenciones; '
          'calcular comisiones y reportes tributarios; atender soporte, PQRSF y '
          'disputas; y, con tu consentimiento aparte, enviarte comunicaciones '
          'comerciales.',
    },
    {
      'titulo': '4. Datos sensibles y biometría',
      'cuerpo': 'Los datos biométricos son sensibles según la Ley 1581. Solo se '
          'tratan con tu autorización previa, expresa e informada, que puedes '
          'revocar en cualquier momento desde «Consentimiento biométrico y '
          'Habeas Data». Al revocarla se eliminan los escaneos y se detiene el '
          'análisis, sin afectar el uso normal de la app.',
    },
    {
      'titulo': '5. Con quién los compartimos',
      'cuerpo': 'Con el cliente de una cita, solo los datos necesarios para '
          'prestar el servicio (nombre, dirección del servicio y un canal de '
          'contacto). Con proveedores que actúan por cuenta de GlowApp: Wompi '
          '(pagos y dispersiones), Brevo (correo transaccional), Firebase de '
          'Google (notificaciones y hosting) y Railway (infraestructura). Con '
          'autoridades cuando exista obligación legal. No vendemos datos '
          'personales.',
    },
    {
      'titulo': '6. Cuánto tiempo los conservamos',
      'cuerpo': 'Los datos de la cuenta se conservan mientras esté activa. Al '
          'eliminarla se borran o anonimizan en un plazo máximo de 30 días. Se '
          'conservan los registros contables, las facturas y las liquidaciones '
          'de servicios ya prestados (5 años) y las disputas abiertas hasta su '
          'cierre.',
    },
    {
      'titulo': '7. Tus derechos',
      'cuerpo': 'Puedes conocer, actualizar, rectificar y suprimir tus datos, '
          'revocar la autorización y presentar quejas ante la Superintendencia '
          'de Industria y Comercio. Escríbenos a privacidad@glowapp.co: '
          'respondemos consultas en 10 días hábiles y reclamos en 15 días '
          'hábiles, según la ley. También puedes eliminar tu cuenta desde '
          '«Configuración → Eliminar mi cuenta».',
    },
    {
      'titulo': '8. Seguridad',
      'cuerpo': 'El tráfico viaja cifrado (TLS). Las credenciales se guardan en '
          'el almacenamiento seguro del dispositivo. El acceso a datos está '
          'restringido por rol y por inquilino en la base de datos, con registro '
          'de auditoría de las operaciones sensibles. Los documentos de '
          'verificación solo los consulta el equipo de cumplimiento.',
    },
    {
      'titulo': '9. Menores de edad',
      'cuerpo': 'La app no está dirigida a menores de 18 años. Si detectamos una '
          'cuenta de un menor, la suspendemos y eliminamos sus datos.',
    },
    {
      'titulo': '10. Vigencia',
      'cuerpo': 'Esta política rige desde el 5 de noviembre de 2026. Los cambios '
          'sustanciales se avisan dentro de la app antes de aplicarse.',
    },
  ];

  Future<void> _abrirWeb(BuildContext context) async {
    final ok = await launchUrl(
      Uri.parse(urlPublica),
      mode: LaunchMode.externalApplication,
    );
    if (!ok && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No se pudo abrir el navegador.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _fondo,
      appBar: AppBar(
        backgroundColor: _fondo,
        elevation: 0,
        iconTheme: const IconThemeData(color: _tinta),
        title: const Text(
          'Política de privacidad',
          style: TextStyle(
            fontFamily: 'CormorantGaramond',
            fontSize: 20,
            fontWeight: FontWeight.bold,
            color: _tinta,
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 36),
        children: [
          const Text(
            'TRATAMIENTO DE DATOS PERSONALES · LEY 1581 DE 2012',
            style: TextStyle(
              fontFamily: 'Manrope',
              fontSize: 12,
              letterSpacing: 0.6,
              fontWeight: FontWeight.w600,
              color: _tenue,
            ),
          ),
          const SizedBox(height: 14),
          for (final s in secciones) ...[
            Text(
              s['titulo']!,
              style: const TextStyle(
                fontFamily: 'CormorantGaramond',
                fontSize: 19,
                fontWeight: FontWeight.bold,
                color: _tinta,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              s['cuerpo']!,
              style: const TextStyle(
                fontFamily: 'Manrope',
                fontSize: 14,
                height: 1.55,
                color: _cuerpo,
              ),
            ),
            const SizedBox(height: 20),
          ],
          const Divider(color: Color(0xFFEFE8DE)),
          const SizedBox(height: 12),
          Semantics(
            button: true,
            label: 'Abrir la política de privacidad en el navegador',
            child: OutlinedButton.icon(
              onPressed: () => _abrirWeb(context),
              icon: const Icon(Icons.open_in_new, size: 18, color: _acento),
              label: const Text(
                'Ver versión publicada en la web',
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: _acento,
                ),
              ),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
                side: const BorderSide(color: Color(0xFFE8DFD8)),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
