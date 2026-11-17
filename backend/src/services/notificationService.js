// backend/src/services/notificationService.js
// Servicio centralizado de notificaciones (push, email, SMS)
// Usa plantillas handlebars y respeta preferencias de usuario (usuario_notificaciones_prefs)

const { pool, systemPool } = require('../config/db');
const { runAsSystem } = require('../config/tenantRouting');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

// Configuración de proveedores (se inicializan lazy)
let sendgridClient = null;
let twilioClient = null;
let fcmClient = null;

// Cache de plantillas compiladas
const templateCache = new Map();

/**
 * Inicializa clientes de proveedores (lazy, para tests sin credenciales)
 */
function initProviders() {
  if (!sendgridClient && process.env.SENDGRID_API_KEY) {
    sendgridClient = require('@sendgrid/mail');
    sendgridClient.setApiKey(process.env.SENDGRID_API_KEY);
  }
  if (!twilioClient && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const twilio = require('twilio');
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  if (!fcmClient && process.env.FCM_SERVER_KEY) {
    // FCM se envía vía HTTP directo o firebase-admin si está disponible
    try {
      const admin = require('firebase-admin');
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FCM_PROJECT_ID,
            clientEmail: process.env.FCM_CLIENT_EMAIL,
            privateKey: process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, '\n'),
          }),
        });
      }
      fcmClient = admin.messaging();
    } catch (e) {
      console.warn('[notificationService] firebase-admin no disponible, push usará HTTP directo si hay FCM_SERVER_KEY');
    }
  }
}

/**
 * Carga y compila una plantilla handlebars
 * @param {string} canal - 'push' | 'email' | 'sms'
 * @param {string} evento - nombre del evento (ej: 'ENTREGADO')
 * @returns {HandlebarsTemplateDelegate}
 */
function getTemplate(canal, evento) {
  const key = `${canal}:${evento}`;
  if (templateCache.has(key)) return templateCache.get(key);

  const templatePath = path.join(__dirname, '..', 'templates', 'notificaciones', canal, `${evento.toLowerCase()}.hbs`);
  let source;
  try {
    source = fs.readFileSync(templatePath, 'utf8');
  } catch (e) {
    // Fallback a plantilla genérica
    const genericPath = path.join(__dirname, '..', 'templates', 'notificaciones', canal, 'generic.hbs');
    try {
      source = fs.readFileSync(genericPath, 'utf8');
    } catch (e2) {
      // Último recurso: plantilla inline mínima
      source = getInlineFallback(canal, evento);
    }
  }

  const template = Handlebars.compile(source);
  templateCache.set(key, template);
  return template;
}

function getInlineFallback(canal, evento) {
  const fallbacks = {
    push: {
      subject: 'GlowApp: {{evento}}',
      body: 'Tu pedido {{guia}} ha cambiado a {{evento}}. {{#if detalle}}{{detalle}}{{/if}}',
    },
    email: {
      subject: 'GlowApp: {{evento}} - Pedido {{guia}}',
      body: `
        <h2>Actualización de tu envío</h2>
        <p>Tu pedido <strong>{{guia}}</strong> ahora está en estado: <strong>{{evento}}</strong>.</p>
        {{#if detalle}}<p>{{detalle}}</p>{{/if}}
        {{#if tracking_url}}<p><a href="{{tracking_url}}">Rastrear envío</a></p>{{/if}}
        <hr><small>GlowApp - Logística</small>
      `,
    },
    sms: {
      body: 'GlowApp: Tu pedido {{guia}} está {{evento}}. {{#if tracking_url}}Rastrear: {{tracking_url}}{{/if}}',
    },
  };
  return fallbacks[canal]?.[evento] || fallbacks[canal]?.body || 'Notificación GlowApp: {{evento}}';
}

/**
 * Verifica si el usuario quiere recibir esta notificación por este canal
 * @param {number} usuarioId
 * @param {string} eventoTipo
 * @param {string} canal
 * @returns {Promise<boolean>}
 */
async function usuarioQuiereNotificacion(usuarioId, eventoTipo, canal) {
  const res = await pool.query(
    `SELECT habilitado FROM usuario_notificaciones_prefs
     WHERE usuario_id = $1 AND evento_tipo = $2 AND canal = $3`,
    [usuarioId, eventoTipo, canal]
  );
  return res.rows.length > 0 ? res.rows[0].habilitado : true; // default opt-in para eventos no configurados
}

/**
 * Registra intento de envío en notificaciones_log
 */
async function registrarLog({ usuarioId, tenantId, eventoTipo, canal, proveedorMsgId, estado, errorMensaje, payload, referenciaTipo, referenciaId, asunto, cuerpo }) {
  try {
    await pool.query(
      `INSERT INTO notificaciones_log
        (usuario_id, tenant_id, evento_tipo, canal, proveedor_respuesta, estado_envio, error_mensaje,
         referencia_tipo, referencia_id, asunto, cuerpo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [usuarioId, tenantId || 0, eventoTipo, canal, proveedorMsgId, estado, errorMensaje,
       referenciaTipo, referenciaId, asunto, cuerpo]
    );
  } catch (e) {
    console.error('[notificationService] Error registrando log:', e.message);
  }
}

/**
 * Envía push via FCM
 */
async function enviarPush({ token, titulo, cuerpo, data, usuarioId, eventoTipo, contexto }) {
  initProviders();
  if (!fcmClient && !process.env.FCM_SERVER_KEY) {
    return { success: false, error: 'FCM no configurado' };
  }

  const message = {
    token,
    notification: { title: titulo, body: cuerpo },
    data: { ...data, evento: eventoTipo, timestamp: Date.now().toString() },
    android: { priority: 'high' },
    apns: { payload: { aps: { contentAvailable: true } } },
  };

  try {
    const response = await fcmClient.send(message);
    await registrarLog({ usuarioId, tenantId: 0, eventoTipo, canal: 'push', proveedorMsgId: response, estado: 'enviado', payload: { titulo, cuerpo, data }, referenciaTipo: 'envio', referenciaId: data?.guia, asunto: titulo, cuerpo });
    return { success: true, messageId: response };
  } catch (e) {
    await registrarLog({ usuarioId, tenantId: 0, eventoTipo, canal: 'push', estado: 'fallido', errorMensaje: e.message, payload: { titulo, cuerpo, data }, referenciaTipo: 'envio', referenciaId: data?.guia, asunto: titulo, cuerpo });
    return { success: false, error: e.message };
  }
}

/**
 * Envía email via SendGrid
 */
async function enviarEmail({ to, subject, html, text, usuarioId, eventoTipo, contexto }) {
  initProviders();
  if (!sendgridClient) {
    return { success: false, error: 'SendGrid no configurado' };
  }

  const msg = {
    to,
    from: process.env.SENDGRID_FROM_EMAIL || 'no-reply@glowapp.co',
    subject,
    html,
    text,
  };

  try {
    const [response] = await sendgridClient.send(msg);
    const msgId = response.headers['x-message-id'];
    await registrarLog({ usuarioId, tenantId: 0, eventoTipo, canal: 'email', proveedorMsgId: msgId, estado: 'enviado', payload: { subject, text }, referenciaTipo: 'envio', referenciaId: contexto?.guia, asunto: subject, cuerpo: html });
    return { success: true, messageId: msgId };
  } catch (e) {
    await registrarLog({ usuarioId, tenantId: 0, eventoTipo, canal: 'email', estado: 'fallido', errorMensaje: e.message, payload: { subject, text }, referenciaTipo: 'envio', referenciaId: contexto?.guia, asunto: subject, cuerpo: html });
    return { success: false, error: e.message };
  }
}

/**
 * Envía SMS via Twilio
 */
async function enviarSms({ to, body, usuarioId, eventoTipo, contexto }) {
  initProviders();
  if (!twilioClient) {
    return { success: false, error: 'Twilio no configurado' };
  }

  try {
    const message = await twilioClient.messages.create({
      body,
      from: process.env.TWILIO_FROM_NUMBER,
      to,
    });
    await registrarLog({ usuarioId, tenantId: 0, eventoTipo, canal: 'sms', proveedorMsgId: message.sid, estado: 'enviado', payload: { body }, referenciaTipo: 'envio', referenciaId: contexto?.guia, asunto: 'SMS', cuerpo: body });
    return { success: true, messageId: message.sid };
  } catch (e) {
    await registrarLog({ usuarioId, tenantId: 0, eventoTipo, canal: 'sms', estado: 'fallido', errorMensaje: e.message, payload: { body }, referenciaTipo: 'envio', referenciaId: contexto?.guia, asunto: 'SMS', cuerpo: body });
    return { success: false, error: e.message };
  }
}

/**
 * Función principal: dispara notificación multicanal para un evento logístico
 * @param {Object} params
 * @param {number} params.usuarioId - ID del usuario destinatario
 * @param {string} params.eventoTipo - Tipo de evento (CREADO, RECOGIDO, ENTREGADO, FALLIDO, etc.)
 * @param {Object} params.contexto - Datos para la plantilla: {guia, pedido_id, tracking_url, carrier, estado_anterior, estado_nuevo, detalle, ...}
 * @param {string[]} [params.canales] - Canales a forzar (default: respeta preferencias)
 * @returns {Promise<Object>} Resultados por canal
 */
async function notificarEventoLogistico({ usuarioId, eventoTipo, contexto, canales }) {
  initProviders();

  // Obtener datos del usuario para canales
  const userRes = await pool.query(
    `SELECT fcm_token, email, telefono FROM usuarios WHERE id = $1`,
    [usuarioId]
  );
  if (userRes.rows.length === 0) {
    return { error: 'Usuario no encontrado' };
  }
  const user = userRes.rows[0];

  // Canales objetivo (si no se pasan, consultar preferencias)
  const targetCanales = canales || ['push', 'email', 'sms'];
  const results = {};

  // Compilar plantillas una vez
  const pushTpl = getTemplate('push', eventoTipo);
  const emailTpl = getTemplate('email', eventoTipo);
  const smsTpl = getTemplate('sms', eventoTipo);

  const templateData = {
    ...contexto,
    evento: eventoTipo,
    usuario_nombre: contexto.nombre_entrega || 'Cliente',
  };

  // Push
  if (targetCanales.includes('push') && user.fcm_token) {
    const quiere = await usuarioQuiereNotificacion(usuarioId, eventoTipo, 'push');
    if (quiere) {
      const rendered = pushTpl(templateData);
      // pushTpl puede devolver string simple o {title, body}
      let titulo = 'GlowApp', cuerpo = rendered;
      try {
        const parsed = JSON.parse(rendered);
        if (parsed.title) titulo = parsed.title;
        if (parsed.body) cuerpo = parsed.body;
      } catch (_) { /* string simple */ }
      results.push = await enviarPush({
        token: user.fcm_token,
        titulo,
        cuerpo,
        data: { guia: contexto.guia, pedido_id: contexto.pedido_id, evento: eventoTipo },
        usuarioId,
        eventoTipo,
        contexto,
      });
    } else {
      results.push = { success: false, skipped: 'preferencia deshabilitada' };
    }
  }

  // Email
  if (targetCanales.includes('email') && user.email) {
    const quiere = await usuarioQuiereNotificacion(usuarioId, eventoTipo, 'email');
    if (quiere) {
      const subject = emailTpl({ ...templateData, __subject: true }) || `GlowApp: ${eventoTipo}`;
      const html = emailTpl(templateData);
      const text = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      results.email = await enviarEmail({
        to: user.email,
        subject,
        html,
        text,
        usuarioId,
        eventoTipo,
        contexto,
      });
    } else {
      results.email = { success: false, skipped: 'preferencia deshabilitada' };
    }
  }

  // SMS
  if (targetCanales.includes('sms') && user.telefono) {
    const quiere = await usuarioQuiereNotificacion(usuarioId, eventoTipo, 'sms');
    if (quiere) {
      const body = smsTpl(templateData);
      results.sms = await enviarSms({
        to: user.telefono,
        body,
        usuarioId,
        eventoTipo,
        contexto,
      });
    } else {
      results.sms = { success: false, skipped: 'preferencia deshabilitada' };
    }
  }

  return results;
}

/**
 * Dispara notificación a TODOS los interesados de un envío (cliente + proveedor)
 * Se usa desde webhook Envíame / job de cumplimiento
 */
async function notificarPartesEnvio({ guia, eventoTipo, contextoExtra = {} }) {
  return runAsSystem({ pool, systemPool }, async (db) => {
    // Buscar envío y partes interesadas
    const envioRes = await db.query(
      `SELECT e.*, pt.comprador_id, pt.prestador_comisionado_id, pt.nombre_entrega, pt.telefono_entrega
       FROM envios e
       JOIN pedidos_tienda pt ON pt.id = e.pedido_id
       WHERE e.guia = $1`,
      [guia]
    );
    if (envioRes.rows.length === 0) {
      console.warn(`[notificationService] Envío no encontrado para guía ${guia}`);
      return;
    }
    const envio = envioRes.rows[0];

    const contextoBase = {
      guia: envio.guia,
      pedido_id: envio.pedido_id,
      tracking_url: envio.url_rastreo,
      carrier: envio.transportadora,
      estado_anterior: contextoExtra.estado_anterior,
      estado_nuevo: eventoTipo,
      ciudad: envio.origen_ciudad,
      departamento: envio.origen_departamento,
      ...contextoExtra,
    };

    const promesas = [];

    // Notificar CLIENTE (comprador)
    if (envio.comprador_id) {
      promesas.push(notificarEventoLogistico({
        usuarioId: envio.comprador_id,
        eventoTipo,
        contexto: { ...contextoBase, nombre_entrega: envio.nombre_entrega },
      }));
    }

    // Notificar PROVEEDOR (prestador comisionado) - solo eventos relevantes
    const eventosProveedor = ['CREADO', 'RECOGIDO', 'ENTREGADO', 'FALLIDO', 'DEVUELTO', 'SALIDA_ENTREGA'];
    if (envio.prestador_comisionado_id && eventosProveedor.includes(eventoTipo)) {
      promesas.push(notificarEventoLogistico({
        usuarioId: envio.prestador_comisionado_id,
        eventoTipo,
        contexto: { ...contextoBase, nombre_entrega: `Pedido ${envio.pedido_id}` },
      }));
    }

    // Notificar ADMIN/CS solo para eventos críticos
    const eventosCriticos = ['FALLIDO', 'DEVUELTO'];
    if (eventosCriticos.includes(eventoTipo)) {
      // Buscar admins (rol ADMIN) - notificar a uno solo o a grupo
      const adminsRes = await db.query(`SELECT id FROM usuarios WHERE rol = 'ADMIN' LIMIT 3`);
      for (const admin of adminsRes.rows) {
        promesas.push(notificarEventoLogistico({
          usuarioId: admin.id,
          eventoTipo,
          contexto: { ...contextoBase, es_alerta_cs: true },
          canales: ['push', 'email'], // SMS solo si configurado
        }));
      }
    }

    await Promise.allSettled(promesas);
  });
}

/**
 * Job: reintentar notificaciones fallidas (se ejecuta cada 15 min)
 */
async function reintentarNotificacionesFallidas() {
  return runAsSystem({ pool, systemPool }, async (db) => {
    const res = await db.query(
      `SELECT * FROM notificaciones_log
       WHERE estado = 'fallido' AND creado_en > NOW() - INTERVAL '24 hours'
       AND reintentos < 3
       ORDER BY creado_en ASC
       LIMIT 50`
    );

    for (const log of res.rows) {
      // Reintentar según canal
      // Nota: necesita el usuario y contexto original
      console.log(`[notificationService] Reintentando notificación ${log.id} (${log.canal})`);
      // Implementar reintento real aquí
    }
  });
}

module.exports = {
  notificarEventoLogistico,
  notificarPartesEnvio,
  reintentarNotificacionesFallidas,
  enviarPush,
  enviarEmail,
  enviarSms,
  registrarLog,
  getTemplate,
  initProviders,
};