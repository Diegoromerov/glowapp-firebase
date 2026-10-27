import 'package:flutter/material.dart';
import 'package:glow_core/glow_core.dart';
import 'package:glow_core/shared/theme.dart' hide AppTheme;

class FaqScreen extends StatelessWidget {
  const FaqScreen({super.key});

  final List<Map<String, String>> faqs = const [
    {
      'question': '1. ¿Quién es la profesional que vendrá a mi casa y cómo sé que es segura?',
      'answer': 'Todas las proveedoras en GlowApp pasan por un proceso de verificación que incluye validación de Cédula de Ciudadanía, revisión de antecedentes y prueba de habilidades. En su perfil puedes ver su sello de verificación dorado, fotos de sus trabajos anteriores y opiniones de otras usuarias en Bogotá.'
    },
    {
      'question': '2. ¿Por qué me piden un código PIN de 6 dígitos al finalizar el servicio?',
      'answer': 'El código PIN OTP es tu llave de seguridad y garantía. Al entregárselo a la estilista al finalizar, nos autorizas a liberar el pago. Tu dinero se mantiene protegido en depósito de garantía hasta que estés 100% satisfecha con la atención recibida.'
    },
    {
      'question': '3. ¿El dinero se descuenta de mi tarjeta al reservar o al finalizar?',
      'answer': 'Al reservar, el monto del servicio se autoriza y retiene de forma segura a través de Wompi Bancolombia. Sin embargo, los fondos solo se transfieren a la prestadora cuando tú ingresas o entregas tu código PIN al terminar el servicio.'
    },
    {
      'question': '4. ¿Qué pasa si la estilista no llega a la hora acordada a mi dirección?',
      'answer': 'Si la prestadora no se presenta pasados 15 minutos, puedes cancelar la cita sin ningún costo directamente desde la app. Recibirás un reembolso automático del 100% de tu dinero y un bono de compensación para tu siguiente reserva.'
    },
    {
      'question': '5. ¿Puedo cambiar o reprogramar la cita si me surge una reunión?',
      'answer': '¡Sí! Entra a la sección "Citas" en el menú inferior y presiona el botón "Reprogramar" en la tarjeta de tu cita. Podrás elegir una nueva fecha u hora disponible sin tener que cancelar ni pagar recargos.'
    },
    {
      'question': '6. ¿Qué ocurre si el resultado no fue el que pedí o hay un inconveniente?',
      'answer': 'Puedes abrir una disputa inmediatamente desde la app antes o después del servicio. Tu pago quedará congelado y nuestro equipo Concierge intervendrá en máximo 48 horas para conciliar el caso o realizar la devolución de tu dinero.'
    },
    {
      'question': '7. ¿El precio que muestra la app incluye impuestos y productos de belleza?',
      'answer': 'Sí, los precios exhibidos son transparentes y finales. Incluyen los insumos necesarios para tu tratamiento y los impuestos de ley. Si deseas agregar un servicio adicional durante la cita, la estilista lo sumará con tu autorización.'
    },
    {
      'question': '8. ¿Puedo hablar directamente por chat con la estilista antes de que llegue?',
      'answer': '¡Por supuesto! En la sección "Citas" dispones de un botón de "Chat" directo e instantáneo para indicarle referencias de tu dirección, parqueadero o detalles específicos de tu look antes de su llegada.'
    },
    {
      'question': '9. ¿Qué garantía tengo si pago y la aplicación pierde conexión a internet?',
      'answer': 'Tu dinero y tu cita están completamente respaldados en nuestros servidores. Si pierdes señal, nuestro sistema de reconciliación automática procesa la confirmación y te envía el resumen de tu reserva por correo electrónico y SMS.'
    },
    {
      'question': '10. ¿GlowApp es una empresa registrada en Colombia que me respalda?',
      'answer': 'GlowApp es una plataforma colombiana formalmente constituida que opera bajo la Ley 1581 de Protección de Datos (Habeas Data) y las normas de la Superintendencia de Industria y Comercio (SIC), brindándote respaldo y soporte continuo vía WhatsApp Concierge (+573009128899).'
    },
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.nude50,
      appBar: AppBar(
        backgroundColor: AppTheme.nude50,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back, color: AppTheme.nude900),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          'PREGUNTAS FRECUENTES',
          style: TextStyle(
            fontFamily: 'Didot',
            fontSize: 16,
            fontWeight: FontWeight.bold,
            color: AppTheme.nude900,
            letterSpacing: 1.2,
          ),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 680),
            child: ListView.builder(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          itemCount: faqs.length,
          itemBuilder: (context, index) {
            final faq = faqs[index];
            return Container(
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFE8E0D5)),
                boxShadow: AppTheme.softShadow,
              ),
              child: ExpansionTile(
                iconColor: AppTheme.warning,
                collapsedIconColor: AppTheme.nude500,
                tilePadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                title: Text(
                  faq['question']!,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.nude900,
                    height: 1.3,
                  ),
                ),
                children: [
                  Text(
                    faq['answer']!,
                    style: TextStyle(
                      fontSize: 13,
                      color: AppTheme.nude700,
                      height: 1.4,
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    ),
  ),
);
  }
}
