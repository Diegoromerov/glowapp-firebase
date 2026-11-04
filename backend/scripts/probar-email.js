// Prueba del canal de correo. Se ejecuta dentro del contenedor:
//
//   railway ssh -s glowapp-api -- "cd /app && node scripts/probar-email.js tu@correo.com"
//
// Sirve para separar «no hay credenciales» de «las credenciales no valen»: si
// imprime SIN SMTP, faltan variables; si imprime un error de autenticación, la
// clave es incorrecta; si imprime enviado, el canal está operativo.
const emailService = require('../src/services/emailService');

(async () => {
  const destino = process.argv[2];
  if (!destino) {
    console.log('uso: node scripts/probar-email.js correo@dominio.com');
    process.exit(1);
  }

  const transporte = emailService.initEmailService();
  if (!transporte) {
    console.log('SIN SMTP: faltan SMTP_HOST / SMTP_USER / SMTP_PASS en el entorno.');
    process.exit(2);
  }

  try {
    const r = await emailService.sendEmail({
      to: destino,
      subject: 'Prueba de correo · GlowApp',
      data: {
        html: `<div style="font-family:Arial,sans-serif;color:#1F1A15">
                 <h2 style="color:#C5A052">El correo de GlowApp funciona</h2>
                 <p>Si estás leyendo esto, el canal de correo está operativo y el
                 código de confirmación de los servicios podrá llegar por aquí.</p>
               </div>`,
      },
    });
    console.log('enviado a', destino, '· id', r.messageId || '(sin id)');
  } catch (e) {
    console.log('FALLO AL ENVIAR:', e.message);
    process.exit(3);
  }
})();
