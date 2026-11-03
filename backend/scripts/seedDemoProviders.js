#!/usr/bin/env node
/**
 * Prestadores de demostración con el perfil COMPLETO.
 *
 * El modelo sale del seed histórico `belleza-app/backend/seed/prestadores-demo-11.sql`
 * (el de «Valeria Tobon Makeup»), que es lo que el catálogo espera para que el
 * detalle se vea lleno y no como una ficha vacía:
 *
 *   usuarios           → nombre, foto_url
 *   perfiles_prestador → business_name, description, estatus APROBADO, is_active,
 *                        rating_avg/count, ubicacion (geography), weekly_schedule,
 *                        active_start_hour / active_end_hour
 *   services           → nombre, descripción, precio COP, duración, categoría
 *   portfolio_items    → image_url, título, categoría
 *
 * Lo que NO se siembra: `reviews`. La tabla exige `booking_id` NOT NULL con FK a
 * `bookings` y UNIQUE: inventar reseñas obliga a inventar reservas, y eso sí
 * contamina la operación (aparecerían en agendas, wallets y conciliación).
 *
 * Guardas:
 *  1. `ALLOW_DEMO_SEED=1` — sin la bandera no hace nada.
 *  2. Idempotente y **actualizable**: si el prestador existe, se completan sus
 *     datos en vez de saltarlo (antes solo insertaba, así que los perfiles ya
 *     creados se quedaban pobres para siempre).
 *  3. Todo en una transacción.
 *
 * Uso:
 *   ALLOW_DEMO_SEED=1 DATABASE_URL=... node scripts/seedDemoProviders.js
 *   ALLOW_DEMO_SEED=1 DATABASE_URL=... node scripts/seedDemoProviders.js --limpiar
 */

const { Pool } = require('pg');

const DOMINIO = '@glowapp.test';
const PASSWORD_DEMO = 'DemoGlow2026!';
const CENTRO_POR_DEFECTO = { lat: 4.6735, lon: -74.1422 };

const HORARIO = {
  lunes: { activo: true, inicio: 9, fin: 19 },
  martes: { activo: true, inicio: 9, fin: 19 },
  miercoles: { activo: true, inicio: 9, fin: 19 },
  jueves: { activo: true, inicio: 9, fin: 19 },
  viernes: { activo: true, inicio: 9, fin: 20 },
  sabado: { activo: true, inicio: 9, fin: 17 },
  domingo: { activo: false },
};

const FOTO = 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=300&h=300&fit=crop&crop=faces&auto=format';

const DEMO = [
  {
    email: `demo.ana${DOMINIO}`,
    nombre: 'Ana Ríos',
    negocio: 'Studio Ana',
    descripcion:
      'Especialista en color y tratamientos capilares. Balayage, iluminaciones y ' +
      'reconstrucción con diagnóstico previo del cabello.',
    foto: FOTO,
    dLat: 0,
    dLon: 0,
    rating: 4.9,
    votos: 128,
    servicios: [
      { nombre: 'Corte y peinado', descripcion: 'Corte con lavado y secado', precio: 65000, minutos: 45, categoria: 'Cabello' },
      { nombre: 'Color completo', descripcion: 'Coloración con matizado incluido', precio: 180000, minutos: 120, categoria: 'Cabello' },
      { nombre: 'Balayage', descripcion: 'Aclarado progresivo y tratamiento', precio: 320000, minutos: 150, categoria: 'Cabello' },
    ],
    portafolio: [
      { titulo: 'Balayage cenizo', categoria: 'Cabello', imagen: 'https://images.unsplash.com/photo-1560869713-7d0a29430803?w=600&auto=format' },
      { titulo: 'Rubio miel', categoria: 'Color', imagen: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&auto=format' },
      { titulo: 'Cepillado de evento', categoria: 'Peinado', imagen: 'https://images.unsplash.com/photo-1492106087820-71f1a00d2b11?w=600&auto=format' },
    ],
  },
  {
    email: `demo.carla${DOMINIO}`,
    nombre: 'Carla Méndez',
    negocio: 'Carla Makeup Studio',
    descripcion:
      'Maquillaje social, novias y pestañas. Prueba de maquillaje previa y ' +
      'servicio a domicilio en la zona.',
    foto: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300&h=300&fit=crop&crop=faces&auto=format',
    dLat: 0.0012,
    dLon: 0.0009,
    rating: 5.0,
    votos: 17,
    servicios: [
      { nombre: 'Maquillaje social', descripcion: 'Look de día o de noche', precio: 120000, minutos: 75, categoria: 'Maquillaje' },
      { nombre: 'Maquillaje de novia', descripcion: 'Incluye prueba previa', precio: 350000, minutos: 120, categoria: 'Maquillaje' },
      { nombre: 'Extensión de pestañas', descripcion: 'Pelo a pelo, efecto natural', precio: 150000, minutos: 90, categoria: 'Pestañas' },
      { nombre: 'Manicure semipermanente', descripcion: 'Esmaltado de larga duración', precio: 55000, minutos: 50, categoria: 'Uñas' },
    ],
    portafolio: [
      { titulo: 'Novia — look natural', categoria: 'Maquillaje', imagen: 'https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?w=600&auto=format' },
      { titulo: 'Social noche', categoria: 'Maquillaje', imagen: 'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?w=600&auto=format' },
      { titulo: 'Pestañas pelo a pelo', categoria: 'Pestañas', imagen: 'https://images.unsplash.com/photo-1583001931096-959e9a1a6223?w=600&auto=format' },
    ],
  },
  {
    email: `demo.diana${DOMINIO}`,
    nombre: 'Diana Ospina',
    negocio: 'Glow House',
    descripcion:
      'Faciales, limpieza profunda y skincare profesional. Protocolo según tipo ' +
      'de piel, con extracción y mascarilla calmante.',
    foto: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=300&h=300&fit=crop&crop=faces&auto=format',
    dLat: -0.0015,
    dLon: 0.0018,
    rating: 5.0,
    votos: 41,
    servicios: [
      { nombre: 'Limpieza facial profunda', descripcion: 'Extracción y mascarilla', precio: 95000, minutos: 60, categoria: 'Facial' },
      { nombre: 'Hidratación con ácido hialurónico', descripcion: 'Ampolla y masaje facial', precio: 150000, minutos: 80, categoria: 'Facial' },
      { nombre: 'Depilación con cera', descripcion: 'Zona a elegir', precio: 45000, minutos: 30, categoria: 'Depilación' },
    ],
    portafolio: [
      { titulo: 'Antes y después — limpieza', categoria: 'Facial', imagen: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=600&auto=format' },
      { titulo: 'Protocolo hidratante', categoria: 'Facial', imagen: 'https://images.unsplash.com/photo-1616394584738-fc6e612e71b9?w=600&auto=format' },
    ],
  },
];

async function main() {
  if (process.env.ALLOW_DEMO_SEED !== '1') {
    console.error('ABORTADO: exporta ALLOW_DEMO_SEED=1 para sembrar datos de demostración.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('ABORTADO: falta DATABASE_URL.');
    process.exit(1);
  }

  const limpiar = process.argv.includes('--limpiar');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  let creados = 0;
  let actualizados = 0;
  let borrados = 0;

  try {
    await client.query('BEGIN');

    if (limpiar) {
      const emails = DEMO.map((d) => d.email);
      const u = await client.query('SELECT id FROM usuarios WHERE email = ANY($1::text[])', [emails]);
      const ids = u.rows.map((r) => r.id);
      if (ids.length) {
        await client.query('DELETE FROM portfolio_items WHERE provider_id = ANY($1::int[])', [ids]);
        await client.query('DELETE FROM services WHERE provider_id = ANY($1::int[])', [ids]);
        await client.query('DELETE FROM perfiles_prestador WHERE id = ANY($1::int[])', [ids]);
        await client.query('DELETE FROM usuarios WHERE id = ANY($1::int[])', [ids]);
      }
      borrados = ids.length;
      await client.query('COMMIT');
      console.log(`borrados=${borrados}`);
      return;
    }

    const cfg = await client.query(
      "SELECT key, value FROM platform_config WHERE key IN ('gps_centro_latitud', 'gps_centro_longitud')"
    );
    const mapa = Object.fromEntries(cfg.rows.map((r) => [r.key, parseFloat(r.value)]));
    const CENTRO = {
      lat: Number.isFinite(mapa.gps_centro_latitud) ? mapa.gps_centro_latitud : CENTRO_POR_DEFECTO.lat,
      lon: Number.isFinite(mapa.gps_centro_longitud) ? mapa.gps_centro_longitud : CENTRO_POR_DEFECTO.lon,
    };
    console.log(`centro=${CENTRO.lat},${CENTRO.lon}`);

    const t = await client.query('SELECT id FROM tenants ORDER BY es_plataforma DESC, id ASC LIMIT 1');
    const tenantId = t.rows.length ? t.rows[0].id : null;

    let hash = null;
    try {
      hash = require('bcryptjs').hashSync(PASSWORD_DEMO, 10);
    } catch (_) {
      console.warn('AVISO: sin bcryptjs; los usuarios demo no podrán iniciar sesión.');
    }

    for (const d of DEMO) {
      // ── usuario: insertar o completar ─────────────────────────────────────
      const ya = await client.query('SELECT id FROM usuarios WHERE email = $1', [d.email]);
      let id;
      if (ya.rows.length) {
        id = ya.rows[0].id;
        await client.query(
          `UPDATE usuarios SET nombre = $2, foto_url = $3, onboarding_completo = true,
                  is_active = true, tenant_id = COALESCE(tenant_id, $4),
                  password_hash = COALESCE(password_hash, $5)
            WHERE id = $1`,
          [id, d.nombre, d.foto, tenantId, hash]
        );
        actualizados++;
      } else {
        const u = await client.query(
          `INSERT INTO usuarios
             (email, nombre, foto_url, auth_provider, provider_id, rol,
              password_hash, onboarding_completo, tenant_id)
           VALUES ($1, $2, $3, 'LOCAL', $4, 'PRESTADOR', $5, true, $6)
           RETURNING id`,
          [d.email, d.nombre, d.foto, `demo_${d.email.split('@')[0]}`, hash, tenantId]
        );
        id = u.rows[0].id;
        creados++;
      }

      // ── perfil: ubicacion, horario y horas activas son lo que hace que la
      //    ficha se vea completa y que el prestador aparezca en el radio ─────
      await client.query(
        `INSERT INTO perfiles_prestador
           (id, business_name, description, estatus_verificacion, is_active,
            rating_avg, rating_count, tenant_id, ubicacion,
            weekly_schedule, active_start_hour, active_end_hour)
         VALUES ($1, $2, $3, 'APROBADO', true, $4, $5, $6,
                 ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography,
                 $9::jsonb, 9, 19)
         ON CONFLICT (id) DO UPDATE
           SET business_name = EXCLUDED.business_name,
               description = EXCLUDED.description,
               estatus_verificacion = 'APROBADO',
               is_active = true,
               rating_avg = EXCLUDED.rating_avg,
               rating_count = EXCLUDED.rating_count,
               ubicacion = EXCLUDED.ubicacion,
               weekly_schedule = EXCLUDED.weekly_schedule,
               active_start_hour = 9,
               active_end_hour = 19,
               tenant_id = COALESCE(perfiles_prestador.tenant_id, EXCLUDED.tenant_id)`,
        [id, d.negocio, d.descripcion, d.rating, d.votos, tenantId,
         CENTRO.lon + d.dLon, CENTRO.lat + d.dLat, JSON.stringify(HORARIO)]
      );

      // ── servicios: anti-join por (provider_id, name) ──────────────────────
      for (const s of d.servicios) {
        const existe = await client.query(
          'SELECT id FROM services WHERE provider_id = $1 AND name = $2',
          [id, s.nombre]
        );
        if (existe.rows.length) {
          await client.query(
            `UPDATE services SET description = $3, price = $4, duration_minutes = $5,
                    category = $6, is_active = true
              WHERE provider_id = $1 AND name = $2`,
            [id, s.nombre, s.descripcion, s.precio, s.minutos, s.categoria]
          );
        } else {
          await client.query(
            `INSERT INTO services (provider_id, name, description, price, duration_minutes, category, is_active, tenant_id)
             VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
            [id, s.nombre, s.descripcion, s.precio, s.minutos, s.categoria, tenantId]
          );
        }
      }

      // ── portafolio: se reemplaza el del demo (no hay clave natural) ───────
      await client.query('DELETE FROM portfolio_items WHERE provider_id = $1', [id]);
      for (const item of d.portafolio) {
        await client.query(
          `INSERT INTO portfolio_items (provider_id, image_url, title, category, tenant_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, item.imagen, item.titulo, item.categoria, tenantId]
        );
      }
    }

    await client.query('COMMIT');
    console.log(`creados=${creados} actualizados=${actualizados}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('FALLÓ, nada se escribió:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
