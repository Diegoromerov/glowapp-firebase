// backend/src/services/emailService.js
const nodemailer = require('nodemailer');
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');

// Register handlebars helpers
handlebars.registerHelper('eq', function(a, b) {
  return a === b;
});

let transporter = null;
let templates = {};

/**
 * Inicializa transporter y compila templates
 */
function initEmailService() {
  // Brevo API no depende de SMTP; no marcar el servicio como "sin transporte"
  // cuando solo está configurada la llave HTTP.
  if (transporter) return transporter;
  if (process.env.BREVO_API_KEY) {
    loadTemplates();
    return null;
  }

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || 'GlowApp <no-reply@glowapp.com>';

  if (!host || !user || !pass) {
      console.warn('[emailService] SMTP no configurado - emails se logueanのみ (dev mode)');
      loadTemplates(); // Load templates even in dev mode
      return null;
    }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    pool: true,
    maxConnections: 5,
    rateDelta: 1000,
    rateLimit: 10
  });

  transporter.verify()
    .then(() => console.log('[emailService] SMTP conectado'))
    .catch(err => console.error('[emailService] SMTP error:', err.message));

  loadTemplates();
  return transporter;
}

/**
 * Carga templates .hbs desde src/templates/email/
 */
function loadTemplates() {
  const templatesDir = path.join(__dirname, '../../src/templates/email');
  if (!fs.existsSync(templatesDir)) {
    console.warn('[emailService] Directorio templates no existe:', templatesDir);
    return;
  }

  const files = fs.readdirSync(templatesDir).filter(f => f.endsWith('.hbs'));
  for (const file of files) {
    const name = file.replace('.hbs', '');
    const content = fs.readFileSync(path.join(templatesDir, file), 'utf8');
    templates[name] = handlebars.compile(content);
    console.log(`[emailService] Template cargado: ${name}`);
  }
}

/**
 * Renderiza template con datos
 */
function renderTemplate(name, data) {
  const template = templates[name];
  if (!template) {
    throw new Error(`Template no encontrado: ${name}`);
  }
  return template(data);
}

/**
 * Envía email
 */

/**
 * Envío por la API HTTP de Brevo.
 *
 * Railway bloquea el SMTP saliente (25/465/587): el relay de Brevo daba
 * "Connection timeout" aunque las credenciales fueran correctas. La API va por
 * 443, así que es la vía que funciona en producción.
 */
function _partesRemitente() {
  const crudo = process.env.SMTP_FROM || 'GlowApp <no-reply@glowapp.com>';
  const m = crudo.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] || 'GlowApp', email: m[2] };
  return { name: 'GlowApp', email: crudo.trim() };
}

async function enviarPorApiBrevo({ to, subject, html, text }) {
  const apiKey = process.env.BREVO_API_KEY;
  const remitente = _partesRemitente();
  const cuerpo = {
    sender: remitente,
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text,
  };

  const respuesta = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(cuerpo),
  });

  const detalle = await respuesta.text();
  if (!respuesta.ok) {
    throw new Error(`Brevo API ${respuesta.status}: ${detalle.slice(0, 200)}`);
  }
  let id = null;
  try {
    id = JSON.parse(detalle).messageId || null;
  } catch (_) {
    id = null;
  }
  console.log(`[emailService] Email enviado por API Brevo (${id || 'sin id'})`);
  return { messageId: id, via: 'brevo-api' };
}

async function sendEmail({ to, subject, template, data = {}, attachments = [] }) {
  const tx = initEmailService();
  const from = process.env.SMTP_FROM || 'GlowApp <no-reply@glowapp.com>';

  const html = template ? renderTemplate(template, data) : data.html || '';
  const text = data.text || html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

  // API HTTP primero: en Railway el SMTP saliente no sale del contenedor.
  if (process.env.BREVO_API_KEY) {
    return await enviarPorApiBrevo({ to, subject, html, text });
  }

  const mailOptions = {
    from,
    to,
    subject,
    html,
    text,
    attachments
  };

  if (!tx) {
    console.log('[emailService:DEV] ==============================');
    console.log('[emailService:DEV] TO:', to);
    console.log('[emailService:DEV] SUBJECT:', subject);
    console.log('[emailService:DEV] TEMPLATE:', template);
    console.log('[emailService:DEV] DATA:', JSON.stringify(data, null, 2));
    console.log('[emailService:DEV] HTML PREVIEW:', html.substring(0, 500) + '...');
    console.log('[emailService:DEV] ==============================');
    return { devMode: true, messageId: 'dev-' + Date.now() };
  }

  try {
    const result = await tx.sendMail(mailOptions);
    console.log(`[emailService] Email enviado a ${to}: ${result.messageId}`);
    return result;
  } catch (err) {
    console.error('[emailService] Error enviando email:', err.message);
    throw err;
  }
}

/**
 * Envía múltiples emails en lote
 */
async function sendBulk(emails) {
  const results = [];
  for (const email of emails) {
    try {
      const result = await sendEmail(email);
      results.push({ success: true, to: email.to, result });
    } catch (err) {
      results.push({ success: false, to: email.to, error: err.message });
    }
  }
  return results;
}

/**
 * Helper existente: Email de carrito abandonado
 */
async function sendAbandonedBookingEmail(toEmail, userName, bookingId, serviceName) {
  const frontendBase = (process.env.FRONTEND_URL || 'https://glowapp-frontend-production.up.railway.app').replace(/\/$/, '');
  const checkoutUrl = `${frontendBase}/#/checkout?booking_id=${bookingId}`;
  
  console.log(`📧 [EMAIL TRANSACCIONAL] Preparando correo de recuperación para ${toEmail} (${userName}):`);
  console.log(`   Asunto: ¡Tu cita de ${serviceName} te espera en GlowApp!`);
  console.log(`   Link de Pago Directo: ${checkoutUrl}`);

  return sendEmail({
    to: toEmail,
    subject: `¡Tu cita de ${serviceName} te espera en GlowApp!`,
    template: 'abandonedBooking',
    data: {
      userName,
      serviceName,
      checkoutUrl,
      frontendUrl: frontendBase
    }
  });
}

/**
 * Helper: Email de confirmación de reserva pagada
 * Se usa tras webhook de Wompi (APPROVED) y tras confirmación OTP en paymentRoutes.js
 */
async function sendBookingConfirmationEmail({
  toEmail,
  clientName,
  bookingId,
  serviceName,
  providerName,
  appointmentDate,
  paymentMethod,
  amount,
  reference,
}) {
  const frontendBase = (process.env.FRONTEND_URL || 'https://glowapp-client.web.app').replace(/\/$/, '');
  const receiptUrl = `${frontendBase}/#/my-bookings`;
  const subject = `✅ Tu cita de ${serviceName} está confirmada y pagada · GlowApp`;

  console.log(`📧 [EMAIL CONFIRMACIÓN] Preparando correo (booking_id=${bookingId}, ref=${reference}):`);
  console.log(`   Asunto: ${subject}`);
  console.log(`   Referencia: ${reference}`);

  return sendEmail({
    to: toEmail,
    subject,
    template: 'bookingConfirmation',
    data: {
      subject,
      clientName,
      serviceName,
      providerName,
      appointmentDate,
      paymentMethod,
      amount,
      reference,
      receiptUrl,
      frontendUrl: frontendBase,
    },
  });
}

/**
 * Email de confirmación de un pedido de GlowShop ya pagado.
 *
 * Se llama desde el webhook de la tienda DESPUÉS del COMMIT: el cobro ya existe
 * y la confirmación no puede revertirlo, así que es best-effort. Si Brevo falla,
 * el pedido sigue PAGADO y el fallo queda en el log con el id del pedido —nunca
 * con la dirección del comprador (ítem 44 de la auditoría).
 *
 * El cuerpo se construye aquí, en línea, y no con una plantilla de disco: así el
 * correo no depende de un archivo que nadie versiona y el contenido va completo
 * en el diff.
 */
async function sendOrderConfirmationEmail({
  toEmail,
  clientName,
  orderId,
  items = [],
  subtotal,
  iva,
  envio,
  descuento,
  total,
  paidAt,
  address,
  city,
  paymentMethod,
  reference,
}) {
  const frontendBase = (process.env.FRONTEND_URL || 'https://glowapp-client.web.app').replace(/\/$/, '');
  // `/#/store` es una ruta real de la app cliente (main.dart → '/store'); el
  // botón del correo no puede apuntar a una pantalla que no exista.
  const receiptUrl = `${frontendBase}/#/store`;
  const corto = String(orderId || '').slice(0, 8).toUpperCase();
  const subject = `✅ Tu pedido #${corto} está pagado · GlowApp`;

  const esc = (valor) =>
    String(valor ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  const money = (valor) => `$${Number(valor || 0).toLocaleString('es-CO')}`;
  const fecha = paidAt
    ? new Date(paidAt).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long', timeStyle: 'short' })
    : null;

  const filas = items
    .map(
      (i) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee">${esc(i.nombre || 'Producto')}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee" align="center">${Number(i.cantidad) || 1}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee" align="right">${money(i.precio_unitario_pagado)}</td>
      </tr>`
    )
    .join('');

  const lineaDescuento =
    Number(descuento) > 0
      ? `<tr><td colspan="2" style="padding:4px 0;color:#0a7">Descuento por puntos</td><td align="right" style="color:#0a7">- ${money(descuento)}</td></tr>`
      : '';

  const html = `<!doctype html>
<html lang="es"><body style="margin:0;background:#faf7f5;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#2b2b2b">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <h1 style="font-size:20px;margin:0 0 4px">¡Gracias por tu compra${clientName ? ', ' + esc(clientName) : ''}!</h1>
    <p style="margin:0 0 16px;color:#666">Recibimos tu pago. Tu pedido <strong>#${corto}</strong> ya está confirmado.</p>
    <div style="background:#fff;border-radius:12px;padding:16px 20px;border:1px solid #eee">
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead><tr style="color:#888;font-size:12px;text-transform:uppercase">
          <th align="left">Producto</th><th align="center">Cant.</th><th align="right">Precio</th>
        </tr></thead>
        <tbody>${filas}</tbody>
        <tfoot>
          <tr><td colspan="2" style="padding:8px 0 4px;color:#666">Subtotal</td><td align="right">${money(subtotal)}</td></tr>
          <tr><td colspan="2" style="padding:2px 0;color:#666">IVA</td><td align="right">${money(iva)}</td></tr>
          <tr><td colspan="2" style="padding:2px 0;color:#666">Envío</td><td align="right">${money(envio)}</td></tr>
          ${lineaDescuento}
          <tr><td colspan="2" style="padding:8px 0;font-weight:700;border-top:1px solid #eee">Total pagado</td><td align="right" style="font-weight:700;border-top:1px solid #eee">${money(total)}</td></tr>
        </tfoot>
      </table>
    </div>
    <div style="background:#fff;border-radius:12px;padding:16px 20px;border:1px solid #eee;margin-top:12px;font-size:14px">
      <p style="margin:0 0 6px"><strong>Entrega</strong></p>
      <p style="margin:0;color:#666">${esc(address || '')}${city ? ', ' + esc(city) : ''}</p>
      ${fecha ? `<p style="margin:8px 0 0;color:#666">Pagado el ${esc(fecha)}</p>` : ''}
      ${paymentMethod ? `<p style="margin:2px 0 0;color:#666">Método de pago: ${esc(paymentMethod)}</p>` : ''}
      ${reference ? `<p style="margin:2px 0 0;color:#666;font-size:12px">Referencia: ${esc(reference)}</p>` : ''}
    </div>
    <p style="text-align:center;margin:24px 0">
      <a href="${receiptUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">Ver mi pedido</a>
    </p>
    <p style="color:#999;font-size:12px;text-align:center">Te avisaremos por este medio cuando tu pedido salga a despacho.</p>
  </div>
</body></html>`;

  const text = [
    `¡Gracias por tu compra${clientName ? ', ' + clientName : ''}!`,
    `Pedido #${corto} confirmado y pagado${fecha ? ' el ' + fecha.replace(/\.$/, '') : ''}.`,
    ...items.map((i) => `- ${i.nombre || 'Producto'} x${Number(i.cantidad) || 1}: ${money(i.precio_unitario_pagado)}`),
    `Subtotal ${money(subtotal)} · IVA ${money(iva)} · Envío ${money(envio)}${Number(descuento) > 0 ? ' · Descuento ' + money(descuento) : ''}`,
    `Total pagado: ${money(total)}`,
    `Entrega: ${address || ''}${city ? ', ' + city : ''}`,
    paymentMethod ? `Método de pago: ${paymentMethod}` : '',
    `Ver mi pedido: ${receiptUrl}`,
  ].filter(Boolean).join('\n');

  console.log(`📧 [EMAIL PEDIDO] Preparando confirmación (pedido=${orderId}, items=${items.length})`);

  return sendEmail({ to: toEmail, subject, data: { html, text } });
}

/**
 * Templates específicos de SaaS
 */
const saasTemplates = {
  trialEnding: (data) => ({
    template: 'trialEnding',
    subject: `⏳ Tu trial de GlowApp Pro termina en 3 días - ${data.tenantName}`,
    data: {
      tenantName: data.tenantName,
      ownerName: data.ownerName,
      trialEndDate: data.trialEndDate,
      planName: data.planName,
      upgradeUrl: `${process.env.FRONTEND_URL}/billing/upgrade`,
      supportUrl: `${process.env.FRONTEND_URL}/support`
    }
  }),

  trialExpired: (data) => ({
    template: 'trialExpired',
    subject: `📉 Tu trial de GlowApp ha terminado - ${data.tenantName}`,
    data: {
      tenantName: data.tenantName,
      ownerName: data.ownerName,
      newPlan: 'FREEMIUM',
      lostFeatures: data.lostFeatures || [],
      upgradeUrl: `${process.env.FRONTEND_URL}/billing/upgrade`
    }
  }),

  invoiceEmitted: (data) => ({
    template: 'invoiceEmitted',
    subject: `📄 Factura ${data.invoiceNumber} emitida - ${data.tenantName}`,
    data: {
      tenantName: data.tenantName,
      ownerName: data.ownerName,
      invoiceNumber: data.invoiceNumber,
      amount: data.amount,
      currency: data.currency || 'COP',
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      dueDate: data.dueDate,
      downloadUrl: data.downloadUrl,
      billingUrl: `${process.env.FRONTEND_URL}/billing/invoices`
    },
    attachments: data.pdfPath ? [{
      filename: `${data.invoiceNumber}.pdf`,
      path: data.pdfPath
    }] : []
  }),

  invoicePaid: (data) => ({
    template: 'invoicePaid',
    subject: `✅ Factura ${data.invoiceNumber} pagada - ${data.tenantName}`,
    data: {
      tenantName: data.tenantName,
      ownerName: data.ownerName,
      invoiceNumber: data.invoiceNumber,
      amount: data.amount,
      currency: data.currency || 'COP',
      paidAt: data.paidAt,
      billingUrl: `${process.env.FRONTEND_URL}/billing/invoices`
    }
  }),

  dunningNotice: (data) => ({
    template: 'dunningNotice',
    subject: `⚠️ Facturas pendientes de pago - ${data.tenantName}`,
    data: {
      tenantName: data.tenantName,
      ownerName: data.ownerName,
      invoices: data.invoices,
      totalDue: data.totalDue,
      currency: data.currency || 'COP',
      oldestDueDate: data.oldestDueDate,
      payUrl: `${process.env.FRONTEND_URL}/billing/pay`,
      supportUrl: `${process.env.FRONTEND_URL}/support`
    }
  }),

  subscriptionCanceled: (data) => ({
    template: 'subscriptionCanceled',
    subject: `📋 Suscripción cancelada - ${data.tenantName}`,
    data: {
      tenantName: data.tenantName,
      ownerName: data.ownerName,
      plan: data.plan,
      canceledAt: data.canceledAt,
      effectiveDate: data.effectiveDate,
      reactivateUrl: `${process.env.FRONTEND_URL}/billing/reactivate`
    }
  }),

  teamInvite: (data) => ({
    template: 'teamInvite',
    subject: `👥 Invitación a ${data.tenantName} en GlowApp`,
    data: {
      tenantName: data.tenantName,
      inviterName: data.inviterName,
      role: data.role,
      acceptUrl: `${process.env.FRONTEND_URL}/team/accept?token=${data.inviteToken}`,
      expiresAt: data.expiresAt
    }
  }),

  usageAlert: (data) => ({
    template: 'usageAlert',
    subject: `📊 Alerta de uso: ${data.feature} al ${data.currentPercent}% - ${data.tenantName}`,
    data: {
      tenantName: data.tenantName,
      ownerName: data.ownerName,
      feature: data.feature,
      currentPercent: data.currentPercent,
      threshold: data.threshold,
      currentCount: data.count,
      limit: data.limit,
      periodEnd: data.periodEnd,
      upgradeUrl: `${process.env.FRONTEND_URL}/billing/upgrade`
    }
  }),

  welcomePlan: (data) => ({
    template: 'welcomePlan',
    subject: `🎉 Bienvenido a ${data.planName} - ${data.tenantName}`,
    data: {
      tenantName: data.tenantName,
      ownerName: data.ownerName,
      planName: data.planName,
      features: data.features,
      dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`
    }
  })
};

/**
 * Helpers de conveniencia para flujos SaaS
 */
async function sendTrialEndingNotice(tenant, subscription) {
  return sendEmail({
    to: tenant.ownerEmail,
    ...saasTemplates.trialEnding({
      tenantName: tenant.name,
      ownerName: tenant.ownerName,
      trialEndDate: subscription.trial_end,
      planName: subscription.plan
    })
  });
}

async function sendTrialExpiredNotice(tenant, lostFeatures) {
  return sendEmail({
    to: tenant.ownerEmail,
    ...saasTemplates.trialExpired({
      tenantName: tenant.name,
      ownerName: tenant.ownerName,
      lostFeatures
    })
  });
}

async function sendInvoiceEmitted(tenant, invoice, pdfPath = null) {
  return sendEmail({
    to: tenant.billingEmail || tenant.ownerEmail,
    ...saasTemplates.invoiceEmitted({
      tenantName: tenant.name,
      ownerName: tenant.ownerName,
      invoiceNumber: invoice.invoice_number,
      amount: invoice.total,
      currency: invoice.currency,
      periodStart: invoice.period_start,
      periodEnd: invoice.period_end,
      dueDate: invoice.due_date,
      downloadUrl: `${process.env.FRONTEND_URL}/billing/invoices/${invoice.id}/pdf`,
      pdfPath
    })
  });
}

async function sendInvoicePaid(tenant, invoice) {
  return sendEmail({
    to: tenant.billingEmail || tenant.ownerEmail,
    ...saasTemplates.invoicePaid({
      tenantName: tenant.name,
      ownerName: tenant.ownerName,
      invoiceNumber: invoice.invoice_number,
      amount: invoice.total,
      currency: invoice.currency,
      paidAt: invoice.paid_at
    })
  });
}

async function sendDunningNotice(tenant, invoices) {
  const totalDue = invoices.reduce((sum, inv) => sum + parseFloat(inv.total), 0);
  const oldestDue = invoices.reduce((min, inv) => 
    new Date(inv.due_date) < new Date(min.due_date) ? inv : min
  ).due_date;

  return sendEmail({
    to: tenant.billingEmail || tenant.ownerEmail,
    ...saasTemplates.dunningNotice({
      tenantName: tenant.name,
      ownerName: tenant.ownerName,
      invoices: invoices.map(inv => ({
        number: inv.invoice_number,
        amount: inv.total,
        dueDate: inv.due_date,
        daysOverdue: Math.floor((Date.now() - new Date(inv.due_date).getTime()) / (1000 * 60 * 60 * 24))
      })),
      totalDue,
      currency: invoices[0]?.currency || 'COP',
      oldestDueDate: oldestDue
    })
  });
}

async function sendSubscriptionCanceled(tenant, subscription) {
  return sendEmail({
    to: tenant.ownerEmail,
    ...saasTemplates.subscriptionCanceled({
      tenantName: tenant.name,
      ownerName: tenant.ownerName,
      plan: subscription.plan,
      canceledAt: subscription.canceled_at,
      effectiveDate: subscription.current_period_end
    })
  });
}

async function sendTeamInvite(invite, tenant, inviter) {
  return sendEmail({
    to: invite.email,
    ...saasTemplates.teamInvite({
      tenantName: tenant.name,
      inviterName: inviter.full_name || inviter.email,
      role: invite.role,
      inviteToken: invite.invite_token,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    })
  });
}

async function sendUsageAlert(tenant, alert, metric) {
  return sendEmail({
    to: tenant.ownerEmail,
    ...saasTemplates.usageAlert({
      tenantName: tenant.name,
      ownerName: tenant.ownerName,
      feature: alert.feature,
      currentPercent: metric.currentPercent,
      threshold: alert.thresholdPercent,
      count: metric.count,
      limit: metric.limit,
      periodEnd: metric.periodEnd
    })
  });
}

async function sendWelcomePlan(tenant, planName, features) {
  return sendEmail({
    to: tenant.ownerEmail,
    ...saasTemplates.welcomePlan({
      tenantName: tenant.name,
      ownerName: tenant.ownerName,
      planName,
      features
    })
  });
}

module.exports = {
  initEmailService,
  sendEmail,
  sendBulk,
  renderTemplate,
  loadTemplates,
  sendAbandonedBookingEmail,
  sendBookingConfirmationEmail,
  sendOrderConfirmationEmail,
  // Helpers SaaS
  sendTrialEndingNotice,
  sendTrialExpiredNotice,
  sendInvoiceEmitted,
  sendInvoicePaid,
  sendDunningNotice,
  sendSubscriptionCanceled,
  sendTeamInvite,
  sendUsageAlert,
  sendWelcomePlan
};
