'use strict';

/**
 * Vitrina pública del proveedor (D-GL-031, T-077).
 *
 * Ruta sin autenticación a propósito: el proveedor comparte el enlace con sus
 * clientas. Sólo devuelve datos que ya son públicos en su perfil y **ningún**
 * servicio: los de una cuenta sin habilitar están en borrador, y mostrar precios
 * de un catálogo no publicado confunde a la clienta y ensucia el catálogo.
 *
 * No hay escritura en este router, por eso puede quedar fuera de la cabecera
 * X-App-Audience (ver `middleware/appAudience.js`).
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { construirPerfilPublico } = require('../services/vitrinaProveedor');

router.get('/public/provider/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').trim().toLowerCase();
  if (slug === '' || slug.length > 60) {
    return res.status(400).json({ error: 'Enlace inválido.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT nombre, foto_url, ciudad, bio, slug, estado_operativo
         FROM usuarios
        WHERE LOWER(slug) = $1
          AND rol IN ('PRESTADOR', 'SALON')
        LIMIT 1`,
      [slug]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Perfil no encontrado.' });
    }

    const perfil = construirPerfilPublico(rows[0]);

    res.json({
      perfil,
      // La app cliente usa esto para saber si pinta el botón de reserva.
      puede_reservar: perfil.reservable,
      sello: perfil.sello,
    });
  } catch (err) {
    console.error('❌ ERROR EN GET /api/public/provider/:slug:', err);
    res.status(500).json({ error: 'No pudimos cargar el perfil.' });
  }
});

module.exports = router;
