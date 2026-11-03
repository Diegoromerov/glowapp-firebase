// backend/src/services/email.service.js
const axios = require('axios');
const logger = require('../config/logger');

class EmailService {
  constructor() {
    this.resendApiKey = process.env.RESEND_API_KEY;
    this.sendgridApiKey = process.env.SENDGRID_API_KEY;
    this.fromEmail = process.env.EMAIL_FROM || 'soporte@glowapp.com';
    this.fromName = process.env.EMAIL_FROM_NAME || 'GlowApp Support';
  }

  /**
   * Envía un correo electrónico a través de Resend, SendGrid o Simulación Local
   */
  async sendEmail({ to, subject, htmlText, plainText }) {
    if (!to) throw new Error('Destinatario de correo requerido');

    // 1. Intentar enviar con Resend API
    if (this.resendApiKey && !this.resendApiKey.includes('tu_key')) {
      try {
        const response = await axios.post(
          'https://api.resend.com/emails',
          {
            from: `${this.fromName} <${this.fromEmail}>`,
            to: [to],
            subject: subject,
            html: htmlText,
            text: plainText || subject,
          },
          {
            headers: {
              'Authorization': `Bearer ${this.resendApiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          }
        );
        logger.info('📧 Correo enviado exitosamente vía Resend API', { to, messageId: response.data?.id });
        return { success: true, provider: 'resend', id: response.data?.id };
      } catch (err) {
        logger.error('❌ Error enviando correo con Resend API:', err.response?.data || err.message);
      }
    }

    // 2. Intentar enviar con SendGrid API
    if (this.sendgridApiKey && !this.sendgridApiKey.includes('tu_key')) {
      try {
        const response = await axios.post(
          'https://api.sendgrid.com/v3/mail/send',
          {
            personalizations: [{ to: [{ email: to }] }],
            from: { email: this.fromEmail, name: this.fromName },
            subject: subject,
            content: [
              { type: 'text/plain', value: plainText || subject },
              { type: 'text/html', value: htmlText },
            ],
          },
          {
            headers: {
              'Authorization': `Bearer ${this.sendgridApiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          }
        );
        logger.info('📧 Correo enviado exitosamente vía SendGrid API', { to });
        return { success: true, provider: 'sendgrid' };
      } catch (err) {
        logger.error('❌ Error enviando correo con SendGrid API:', err.response?.data || err.message);
      }
    }

    // 3. Fallback / Modo Desarrollo: Simulación por consola y log
    console.log(`\n==================================================`);
    console.log(`📧 [EMAIL SERVICE SIMULATION]`);
    console.log(`De: ${this.fromName} <${this.fromEmail}>`);
    console.log(`Para: ${to}`);
    console.log(`Asunto: ${subject}`);
    console.log(`Contenido:\n${plainText || subject}`);
    console.log(`==================================================\n`);

    return { success: true, provider: 'simulation' };
  }

  /**
   * Envía un código OTP de recuperación de contraseña
   */
  async sendOtpEmail({ to, otp, userName }) {
    const name = userName || 'Usuario de GlowApp';
    const subject = '🔐 Código de Recuperación de Contraseña - GlowApp';
    const plainText = `Hola ${name},\n\nTu código OTP para restablecer tu contraseña en GlowApp es: ${otp}\n\nEste código vencerá en 10 minutos.\nSi no solicitaste este cambio, ignora este correo.`;
    
    const htmlText = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #C89D93; text-align: center;">🌸 GlowApp</h2>
        <h3 style="text-align: center;">Restablecimiento de Contraseña</h3>
        <p>Hola <strong>${name}</strong>,</p>
        <p>Has solicitado restablecer tu contraseña en GlowApp. Utiliza el siguiente código OTP de 6 dígitos:</p>
        <div style="background-color: #F8F4F0; padding: 16px; text-align: center; border-radius: 6px; margin: 20px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #C89D93;">${otp}</span>
        </div>
        <p style="font-size: 13px; color: #777;">Este código expirará en <strong>10 minutos</strong>. Si no solicitaste este cambio, puedes ignorar este mensaje de forma segura.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 11px; color: #aaa; text-align: center;">© 2026 GlowApp. Todos los derechos reservados.</p>
      </div>
    `;

    return this.sendEmail({ to, subject, htmlText, plainText });
  }

  /**
   * Envía confirmación de reserva de cita
   */
  async sendBookingConfirmationEmail({ to, userName, providerName, serviceName, scheduledAt, totalAmount }) {
    const name = userName || 'Cliente';
    const subject = '✨ Confirmación de Reserva de Cita - GlowApp';
    const plainText = `Hola ${name},\n\nTu cita para "${serviceName}" con ${providerName} ha sido agendada para el ${scheduledAt}.\nTotal: $${totalAmount} COP.`;

    const htmlText = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #C89D93; text-align: center;">🌸 GlowApp</h2>
        <h3 style="text-align: center; color: #2E7D32;">¡Tu reserva ha sido confirmada!</h3>
        <p>Hola <strong>${name}</strong>,</p>
        <p>Tu cita de belleza ha sido programada con éxito:</p>
        <ul>
          <li><strong>Servicio:</strong> ${serviceName}</li>
          <li><strong>Profesional:</strong> ${providerName}</li>
          <li><strong>Fecha y Hora:</strong> ${scheduledAt}</li>
          <li><strong>Monto Total:</strong> $${totalAmount} COP</li>
        </ul>
        <p>Puedes seguir el estado de tu reserva en tiempo real desde la aplicación.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 11px; color: #aaa; text-align: center;">© 2026 GlowApp. Todos los derechos reservados.</p>
      </div>
    `;

    return this.sendEmail({ to, subject, htmlText, plainText });
  }
}

module.exports = new EmailService();
