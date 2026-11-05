import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Política de tratamiento de datos personales (Ley 1581 de 2012, Colombia).
///
/// El mismo texto se publica como página estática en `/privacy.html` para que
/// la ficha de la tienda tenga una URL válida.
class PrivacyPolicyScreen extends StatelessWidget {
  const PrivacyPolicyScreen({super.key});

  static const String urlPublica = 'https://glowapp-client.web.app/privacy.html';

  static const List<Map<String, String>> secciones = [
    {
      'titulo': '1. Quién responde por tus datos',
      'cuerpo': 'GlowApp S.A.S. (en adelante «GlowApp») es el responsable del '
          'tratamiento de los datos personales que entregas al usar la '
          'aplicación. Contacto del responsable: privacidad@glowapp.co.',
    },
    {
      'titulo': '2. Qué datos recogemos',
      'cuerpo': 'Datos de identificación y contacto (nombre, correo, teléfono, '
          'ciudad, foto de perfil). Datos de la cuenta (historial de citas, '
          'servicios contratados, valoraciones, propinas). Datos de pago: no '
          'almacenamos números de tarjeta; los procesa Wompi y solo recibimos '
          'el identificador de la transacción y su estado. Datos de ubicación, '
          'solo mientras usas el mapa o compartes tu posición durante un '
          'servicio. Datos biométricos (escaneos faciales y análisis de piel), '
          'únicamente si otorgas autorización expresa y separada.',
    },
    {
      'titulo': '3. Para qué los usamos',
      'cuerpo': 'Prestar el servicio contratado y conectar con el prestador '
          'elegido; procesar pagos, propinas y reembolsos; enviar avisos '
          'operativos de la cita (confirmación, recordatorio, código de '
          'cierre); atender soporte, PQRSF y disputas; cumplir obligaciones '
          'legales y contables; y, con tu consentimiento aparte, enviarte '
          'comunicaciones comerciales y medir el uso de la app.',
    },
    {
      'titulo': '4. Datos sensibles y biometría',
      'cuerpo': 'Los datos biométricos son sensibles según la Ley 1581. Solo '
          'se tratan con tu autorización previa, expresa e informada, que '
          'puedes revocar en cualquier momento desde «Consentimiento '
          'biométrico y Habeas Data». Al revocarla se eliminan los escaneos y '
          'se detiene el análisis, sin afectar el uso normal de la app.',
    },
    {
      'titulo': '5. Con quién los compartimos',
      'cuerpo': 'Con el prestador que elegiste, los datos necesarios para '
          'prestar el servicio (nombre, dirección del servicio y teléfono). '
          'Con proveedores que actúan por cuenta de GlowApp: Wompi (pagos), '
          'Brevo (correo transaccional), Firebase de Google (notificaciones y '
          'hosting) y Railway (infraestructura). No vendemos datos personales.',
    },
    {
      'titulo': '6. Cuánto tiempo los conservamos',
      'cuerpo': 'Los datos de la cuenta se conservan mientras esté activa. Al '
          'eliminarla, se borran o anonimizan en un plazo máximo de 30 días. '
          'Se conservan únicamente los registros contables y fiscales de '
          'servicios ya prestados (5 años) y los de disputas abiertas hasta su '
          'cierre.',
    },
    {
      'titulo': '7. Tus derechos',
      'cuerpo': 'Puedes conocer, actualizar, rectificar y suprimir tus datos, '
          'revocar la autorización y presentar quejas ante la Superintendencia '
          'de Industria y Comercio. Escríbenos a privacidad@glowapp.co: '
          'respondemos consultas en 10 días hábiles y reclamos en 15 días '
          'hábiles, según la ley.',
    },
    {
      'titulo': '8. Seguridad',
      'cuerpo': 'El tráfico viaja cifrado (TLS). Las credenciales se guardan '
          'en el almacenamiento seguro del dispositivo. El acceso a datos está '
          'restringido por rol y por inquilino en la base de datos, con '
          'registro de auditoría de las operaciones sensibles.',
    },
    {
      'titulo': '9. Menores de edad',
      'cuerpo': 'La app no está dirigida a menores de 18 años. Si detectamos '
          'una cuenta de un menor, la suspendemos y eliminamos sus datos.',
    },
    {
      'titulo': '10. Vigencia',
      'cuerpo': 'Esta política rige desde el 5 de noviembre de 2026. Los '
          'cambios sustanciales se avisan dentro de la app antes de aplicarse.',
    },
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFDFBF7),
      appBar: AppBar(
        backgroundColor: const Color(0xFFFDFBF7),
        elevation: 0,
        iconTheme: const IconThemeData(color: Color(0xFF1F1A15)),
        title: const Text(
          'Política de privacidad',
          style: TextStyle(
            fontFamily: 'CormorantGaramond',
            fontSize: 20,
            fontWeight: FontWeight.bold,
            color: Color(0xFF1F1A15),
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 36),
        children: [
          const Text(
            'Tratamiento de datos personales · Ley 1581 de 2012',
            style: TextStyle(
              fontFamily: 'Inter',
              fontSize: 12,
              letterSpacing: 0.6,
              color: Color(0xFF8C7E74),
            ),
          ),
          const SizedBox(height: 18),
          for (final s in secciones) ...[
            Text(
              s['titulo']!,
              style: const TextStyle(
                fontFamily: 'CormorantGaramond',
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: Color(0xFF1F1A15),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              s['cuerpo']!,
              style: const TextStyle(
                fontFamily: 'Inter',
                fontSize: 14,
                height: 1.55,
                color: Color(0xFF3A322C),
              ),
            ),
            const SizedBox(height: 18),
          ],
          const Divider(color: Color(0xFFEFE8DE)),
          const SizedBox(height: 12),
          Center(
            child: TextButton.icon(
              onPressed: () {
                Clipboard.setData(const ClipboardData(text: urlPublica));
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Enlace copiado')),
                );
              },
              icon: const Icon(Icons.link, size: 16, color: Color(0xFF8A6A2F)),
              label: const Text(
                'Copiar enlace público',
                style: TextStyle(
                  fontFamily: 'Inter',
                  fontSize: 13,
                  color: Color(0xFF8A6A2F),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
