// src/routes/sharePagesRoutes.js
//
// Páginas de compartir: HTML estático con las etiquetas Open Graph que leen
// WhatsApp, Instagram, TikTok y Twitter al pegar un enlace, y redirección a la
// app. Sin esto, todo enlace compartido se veía igual —«GlowApp · Belleza a
// domicilio» y sin imagen— porque el hosting es estático y el index.html no
// puede variar por entidad.
//
// Se sirven desde el backend (que ya sirve HTML) y NO desde /api: una página
// abierta por un tercero no puede exigir sesión ni la cabecera X-App-Audience.
const express = require('express');
const { pool } = require('../config/db');

const router = express.Router();

const APP_HOST = process.env.CLIENT_WEB_URL || 'https://glowapp-client.web.app';

const escapar = (texto) =>
  String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function pagina({ titulo, descripcion, imagen, url, destino }) {
  const img = imagen
    ? `<meta property="og:image" content="${escapar(imagen)}">
    <meta name="twitter:image" content="${escapar(imagen)}">`
    : '';
  return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapar(titulo)}</title>
    <meta name="description" content="${escapar(descripcion)}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="GlowApp">
    <meta property="og:title" content="${escapar(titulo)}">
    <meta property="og:description" content="${escapar(descripcion)}">
    <meta property="og:url" content="${escapar(url)}">
    ${img}
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapar(titulo)}">
    <meta name="twitter:description" content="${escapar(descripcion)}">
    <meta http-equiv="refresh" content="0;url=${escapar(destino)}">
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#FAF8F5;
           color:#1F1A15;display:flex;min-height:100vh;align-items:center;
           justify-content:center;margin:0;padding:24px;text-align:center}
      a{color:#8A6A2F}
    </style>
</head>
<body>
  <main>
    <h1>${escapar(titulo)}</h1>
    <p>${escapar(descripcion)}</p>
    <p><a href="${escapar(destino)}">Abrir en GlowApp</a></p>
  </main>
</body>
</html>`;
}

// GET /s/provider/:id — ficha de un prestador
router.get('/provider/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const url = `${APP_HOST.replace(/\/$/, '')}/provider-detail/${req.params.id}`;

  if (Number.isNaN(id)) {
    return res.status(400).type('html').send(
      pagina({
        titulo: 'Enlace inválido · GlowApp',
        descripcion: 'Este enlace no corresponde a ningún prestador.',
        url,
        destino: APP_HOST,
      })
    );
  }

  try {
    const { rows } = await pool.query(
      `SELECT p.id, COALESCE(p.business_name, u.nombre) AS nombre,
              p.description, p.rating_avg, p.rating_count, u.foto_url
         FROM perfiles_prestador p
         JOIN usuarios u ON p.id = u.id
        WHERE p.id = $1`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).type('html').send(
        pagina({
          titulo: 'Prestador no encontrado · GlowApp',
          descripcion: 'Este perfil ya no está disponible en GlowApp.',
          url,
          destino: APP_HOST,
        })
      );
    }

    const p = rows[0];
    const estrellas = p.rating_avg ? ` · ${Number(p.rating_avg).toFixed(1)}★` : '';
    const opiniones = p.rating_count ? ` (${p.rating_count} opiniones)` : '';
    const titulo = `${p.nombre}${estrellas}${opiniones} · GlowApp`;
    const descripcion = p.description
      ? String(p.description).slice(0, 180)
      : 'Reserva este servicio de belleza a domicilio en GlowApp.';

    res.set('Cache-Control', 'public, max-age=300');
    return res.type('html').send(
      pagina({ titulo, descripcion, imagen: p.foto_url, url, destino: url })
    );
  } catch (error) {
    console.error('❌ [SHARE] Error en /s/provider:', error.message);
    return res.status(500).type('html').send(
      pagina({
        titulo: 'No pudimos abrir el enlace · GlowApp',
        descripcion: 'Intenta de nuevo en unos segundos.',
        url,
        destino: APP_HOST,
      })
    );
  }
});

module.exports = router;
