import 'package:flutter/material.dart';

class TermsConditionsScreen extends StatelessWidget {
  const TermsConditionsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
        title: const Text(
          'Términos & Condiciones',
          style: TextStyle(
            fontFamily: 'CormorantGaramond',
            fontWeight: FontWeight.bold,
            fontSize: 22,
            color: Color(0xFF1F1A15),
          ),
        ),
        backgroundColor: const Color(0xFFFAF8F5),
        foregroundColor: const Color(0xFF1F1A15),
        elevation: 0,
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 680),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Términos y Condiciones de Uso de GlowApp',
                  style: TextStyle(
                    fontFamily: 'CormorantGaramond',
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF1F1A15),
                  ),
                ),
            const SizedBox(height: 8),
            Text(
              'Última actualización: Julio 2026',
              style: TextStyle(color: Colors.grey[600], fontSize: 12),
            ),
            const SizedBox(height: 16),
            const Divider(),
            const SizedBox(height: 16),
            _buildSectionTitle('1. Aceptación de los Términos'),
            _buildParagraph(
              'Al descargar, registrarte o utilizar la plataforma GlowApp, aceptas estar sujeto a los presentes Términos y Condiciones, así como a nuestra Política de Privacidad de Tratamiento de Datos Personales (Ley 1581 de 2012 de Colombia / GDPR).',
            ),
            const SizedBox(height: 16),
            _buildSectionTitle('2. Descripción del Servicio'),
            _buildParagraph(
              'GlowApp es una plataforma tecnológica que conecta a usuarios clientes con profesionales y prestadores de servicios de belleza a domicilio y en estudio, ofreciendo además herramientas de recomendación biométrica asistidas por Inteligencia Artificial.',
            ),
            const SizedBox(height: 16),
            _buildSectionTitle('3. Pagos, Reservas y Cancelaciones'),
            _buildParagraph(
              'Los pagos procesados dentro de la aplicación son administrados de forma segura a través de pasarelas de pago certificadas PCI-DSS (Wompi). Las reservas pueden cancelarse sin penalización con al menos 2 horas de anticipación a la cita programada.',
            ),
            const SizedBox(height: 16),
            _buildSectionTitle('4. Privacidad y Tratamiento de Datos Biométricos'),
            _buildParagraph(
              'Las fotografías tomadas en el Hub Biométrico son procesadas exclusivamente para generar recomendaciones de cuidado de la piel y tonalidad. Los datos no son vendidos ni compartidos con terceros con fines comerciales no autorizados.',
            ),
            const SizedBox(height: 16),
            _buildSectionTitle('5. Modificaciones y Contacto'),
            _buildParagraph(
              'GlowApp se reserva el derecho de actualizar estos términos en cualquier momento. Para dudas o consultas, contáctanos en soporte@glowapp.com.',
            ),
            const SizedBox(height: 32),
            Center(
              child: Container(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(30),
                  gradient: const LinearGradient(
                    colors: [Color(0xFFF3D59B), Color(0xFFC5A052)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFFC5A052).withOpacity(0.35),
                      blurRadius: 10,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: ElevatedButton(
                  onPressed: () => Navigator.pop(context),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.transparent,
                    shadowColor: Colors.transparent,
                    foregroundColor: const Color(0xFF1F1A15),
                    padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(30),
                    ),
                    elevation: 0,
                  ),
                  child: const Text(
                    'Entendido y Aceptar',
                    style: TextStyle(
                      fontFamily: 'Inter',
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF1F1A15),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    ),
  ),
);
  }

  Widget _buildSectionTitle(String title) {
    return Text(
      title,
      style: const TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.bold,
        color: Colors.black87,
      ),
    );
  }

  Widget _buildParagraph(String text) {
    return Padding(
      padding: const EdgeInsets.only(top: 6.0),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 14,
          height: 1.5,
          color: Colors.black54,
        ),
      ),
    );
  }
}
