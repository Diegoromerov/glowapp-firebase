// src/routes/referralLinkRoutes.js
//
// Enlace corto de invitación: el primer escalón del embudo.
//
// `GET /r/{CODIGO}` cuenta la apertura y redirige al registro con el código. Sin
// este contador sólo se ven conversiones, y con sólo conversiones no se distingue
// el canal que trae clientas del que no convierte.
//
// No exige sesión: lo abre alguien que todavía no tiene cuenta — ese es el punto
// del enlace. Y si el registro del clic falla, igual redirige: perder una
// invitación por un contador caído sería peor que perder la métrica.
const express = require('express');
const crypto = require('crypto');
const { pool } = require('../config/db');

const router = express.Router();

/// Hash de una señal del visitante. Se guarda el hash, nunca el dato en claro:
/// alcanza para detectar granjas de cuentas sin acumular datos personales.
function hashSenal(valor) {
  const limpio = String(valor || '').trim();
  if (!limpio) return null;
  return crypto.createHash('sha256').update(limpio).digest('hex').slice(0, 64);
}

router.get('/:codigo', async (req, res) => {
  const codigo = String(req.params.codigo || '')
    .trim()
    .toUpperCase()
    .slice(0, 20);

  const base = (process.env.FRONTEND_URL || 'https://glowapp-client.web.app').replace(/\/$/, '');
  const codigoValido = /^[A-Z0-9]{4,20}$/.test(codigo);
  const destino = codigoValido
    ? `${base}/#/register?ref=${encodeURIComponent(codigo)}`
    : base;

  if (codigoValido) {
    try {
      await pool.query(
        `INSERT INTO referral_clicks (codigo, ip_hash, user_agent_hash)
         VALUES ($1, $2, $3)`,
        [codigo, hashSenal(req.ip), hashSenal(req.header('user-agent'))]
      );
    } catch (err) {
      // Best-effort: la métrica no puede romper la invitación.
      console.error('⚠️ [REFERIDOS] No se pudo registrar el clic:', err.message);
    }
  }

  return res.redirect(302, destino);
});

module.exports = router;
