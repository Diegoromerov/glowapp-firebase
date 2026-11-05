// src/controllers/analyticsController.js
const { AnalyticsEvent } = require('../models');
const emailService = require('../services/emailService');

// Un fallo de la app se quedaba en la tabla: nadie se enteraba hasta que un
// usuario se quejaba. Aquí se avisa por correo, como mucho una vez por hora,
// para que la alerta no se convierta en ruido.
let ultimoAvisoCrash = 0;
const UNA_HORA = 60 * 60 * 1000;

async function avisarCrash(nuevos) {
  if (Date.now() - ultimoAvisoCrash < UNA_HORA) return;
  const crash = nuevos.find((r) => String(r.event_type).toUpperCase() === 'APP_CRASH');
  if (!crash) return;
  ultimoAvisoCrash = Date.now();
  const meta = crash.metadata || {};
  const destino = process.env.CRASH_ALERT_EMAIL || process.env.SMTP_FROM;
  if (!destino || !process.env.BREVO_API_KEY) {
    console.warn('[crash-alert] sin destinatario o sin BREVO_API_KEY; aviso omitido');
    return;
  }
  try {
    await emailService.sendEmail({
      to: destino,
      subject: `GlowApp · fallo en la app (${meta.origen || 'app'})`,
      data: {
        html: `<p><strong>${String(meta.mensaje || 'sin mensaje').slice(0, 300)}</strong></p>
<p>Origen: ${meta.origen || '-'}<br>Fatal: ${meta.fatal ? 'sí' : 'no'}<br>
Versión: ${meta.version || '-'}<br>Trace: ${crash.trace_id || '-'}</p>
<pre style="font-size:12px;white-space:pre-wrap">${String(meta.stack || '').slice(0, 800)}</pre>`,
      },
    });
    console.log('[crash-alert] aviso enviado');
  } catch (e) {
    console.warn('[crash-alert] no se pudo enviar:', e.message);
  }
}

// Log an analytics event (telemetry)
async function logEvent(req, res) {
  try {
    let items = [];
    if (req.body && Array.isArray(req.body.events)) {
      items = req.body.events;
    } else if (Array.isArray(req.body)) {
      items = req.body;
    } else if (req.body && typeof req.body === 'object') {
      items = [req.body];
    }

    if (items.length === 0) {
      return res.status(200).json({ message: 'No events to log' });
    }

    const records = items.map(item => ({
      user_id: req.user ? req.user.id : (item.user_id || null),
      event_type: item.event_type || 'UNKNOWN',
      metadata: {
        ...(item.metadata || {}),
        session_id: item.session_id,
        screen_name: item.screen_name,
        element_id: item.element_id,
        // FIX-FLUTTER-07: correlación con el cliente. El middleware global
        // (src/middleware/traceId.js) toma el header X-Trace-Id que envía
        // CrashReportingService y lo expone como req.traceId; lo persistimos
        // para poder cruzar la fila con la línea de log del backend.
        trace_id: req.traceId || null
      },
      occurred_at: item.creado_en || item.occurred_at || new Date()
    }));

    await AnalyticsEvent.bulkCreate(records, { ignoreDuplicates: true });
    // Fuera del camino de respuesta: si el correo falla, la telemetría ya quedó guardada.
    avisarCrash(records).catch(() => {});
    return res.status(201).json({ message: 'Analytics events logged successfully', count: records.length });
  } catch (err) {
    console.error('Error logging analytics event:', err);
    return res.status(200).json({ message: 'Telemetry processed with warning', error: err.message });
  }
}

module.exports = { logEvent };
