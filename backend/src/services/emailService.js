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
  if (transporter) return transporter;

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
async function sendEmail({ to, subject, template, data = {}, attachments = [] }) {
  const tx = initEmailService();
  const from = process.env.SMTP_FROM || 'GlowApp <no-reply@glowapp.com>';

  const html = template ? renderTemplate(template, data) : data.html || '';
  const text = data.text || html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

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
