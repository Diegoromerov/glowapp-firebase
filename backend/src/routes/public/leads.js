'use strict';
const express = require('express');
const { rateLimitByIP } = require('../../middleware/rateLimiter');
const { runAsSystem } = require('../../config/tenantRouting');
const publicPool = require('../../config/publicPool');

const router = express.Router();
const oneMinute = rateLimitByIP({ windowMs: 60 * 1000, limit: 5 });
const oneHour = rateLimitByIP({ windowMs: 60 * 60 * 1000, limit: 20 });
const validRoles = new Set(['client', 'professional', 'salon']);
const str = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const optionalStr = (value, max) => value === undefined || value === null || value === '' || (typeof value === 'string' && value.trim().length <= max);
const normalizeContact = (type, contact) => type === 'email' ? contact.trim().toLowerCase() : contact.replace(/[^+\d]/g, '');

/**
 * @swagger
 * /api/public/leads:
 *   post:
 *     summary: Registra una solicitud de interés de la landing
 *     tags: [public]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role, name, contactType, contact, city, consent, consentTextVersion, turnstileToken]
 *             properties:
 *               role: { type: string, enum: [client, professional, salon] }
 *               name: { type: string, maxLength: 120 }
 *               businessName: { type: string, maxLength: 160 }
 *               contactType: { type: string, enum: [email, whatsapp] }
 *               contact: { type: string, maxLength: 200 }
 *               city: { type: string, maxLength: 100 }
 *               neighborhood: { type: string, maxLength: 100 }
 *               referralCode: { type: string, maxLength: 40 }
 *               consent: { type: boolean, enum: [true] }
 *               consentTextVersion: { type: string, maxLength: 40 }
 *               turnstileToken: { type: string }
 *               website: { type: string, description: Honeypot; dejar vacío }
 *               utm: { type: object }
 *     responses:
 *       202: { description: Solicitud aceptada, incluso si ya existía }
 *       400: { description: Cuerpo inválido o verificación fallida }
 *       429: { description: Límite de solicitudes excedido }
 *       503: { description: Servicio temporalmente no disponible }
 */

async function verifyTurnstile(token, ip) {
  if (!process.env.TURNSTILE_SECRET || !token) return false;
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET, response: token });
  if (ip) body.set('remoteip', ip);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(4000) });
    const result = await response.json();
    return result.success === true;
  } catch { return false; }
}

router.post('/leads', oneMinute, oneHour, async (req, res) => {
  const body = req.body || {};
  if (typeof body.website === 'string' && body.website.trim()) return res.status(202).json({ ok: true });
  const emailOk = body.contactType !== 'email' || (typeof body.contact === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contact.trim()));
  const phoneDigits = typeof body.contact === 'string' ? body.contact.replace(/\D/g, '').length : 0;
  const phoneOk = body.contactType !== 'whatsapp' || (typeof body.contact === 'string' && /^[+\d\s().-]+$/.test(body.contact.trim()) && phoneDigits >= 7 && phoneDigits <= 15);
  const roleFieldsOk = body.role === 'salon' ? str(body.businessName, 160) : str(body.neighborhood, 100);
  if (!validRoles.has(body.role) || !str(body.name, 120) || !['email', 'whatsapp'].includes(body.contactType) || !str(body.contact, 200) || !emailOk || !phoneOk || !str(body.city, 100) || !optionalStr(body.businessName, 160) || !optionalStr(body.neighborhood, 100) || !roleFieldsOk || !optionalStr(body.referralCode, 40) || body.consent !== true || !str(body.consentTextVersion, 40) || !str(body.turnstileToken, 2048) || !optionalStr(body.website, 200) || (body.utm !== undefined && (!body.utm || typeof body.utm !== 'object' || Array.isArray(body.utm) || !['source', 'medium', 'campaign'].every(k => optionalStr(body.utm[k], 200))))) {
    return res.status(400).json({ ok: false, error: 'invalid_request' });
  }
  if (!process.env.TURNSTILE_SECRET) {
    console.error('[public-leads] configuration_missing', 'TURNSTILE_SECRET');
    return res.status(503).json({ ok: false, error: 'temporarily_unavailable' });
  }
  if (!(await verifyTurnstile(body.turnstileToken, req.ip))) return res.status(400).json({ ok: false, error: 'verification_failed' });
  if (!publicPool) return res.status(503).json({ ok: false, error: 'temporarily_unavailable' });
  try {
    const ipSalt = process.env.LANDING_IP_HASH_SALT;
    if (!ipSalt) {
      console.error('[public-leads] configuration_missing', 'LANDING_IP_HASH_SALT');
      return res.status(503).json({ ok: false, error: 'temporarily_unavailable' });
    }
    const crypto = require('node:crypto');
    const ipHash = crypto.createHmac('sha256', ipSalt).update(String(req.ip || '')).digest('hex');
    await runAsSystem({ pool: publicPool }, client => client.query(
      `INSERT INTO landing_leads (role, name, business_name, contact_type, contact_normalized, city, neighborhood, referral_code, consent, consent_text_version, consent_at, utm, ip_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,NOW(),$10::jsonb,$11)
       ON CONFLICT (role, contact_normalized) DO NOTHING`,
      [body.role, body.name.trim(), body.businessName?.trim() || null, body.contactType, normalizeContact(body.contactType, body.contact), body.city.trim(), body.neighborhood?.trim() || null, body.referralCode?.trim() || null, body.consentTextVersion.trim(), JSON.stringify(body.utm || {}), ipHash]
    ));
    return res.status(202).json({ ok: true });
  } catch (error) {
    // Sin datos personales en logs.
    console.error('[public-leads] insert_failed', error.code || 'unknown');
    return res.status(503).json({ ok: false, error: 'temporarily_unavailable' });
  }
});

module.exports = router;
