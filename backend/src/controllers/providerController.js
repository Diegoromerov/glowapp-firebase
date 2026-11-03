const db = require('../config/db');
const pool = db.pool;
const { getPlansWithEntitlement, SAAS_CAPABILITIES } = require('../config/saasEntitlements');

// GET /api/providers → LISTA DE PRESTADORES Y SALONES (Geolocalización con PostGIS y Entitlements)
exports.getProviders = async (req, res) => {
  try {
    const dbStatus = db.getDbStatus();
    if (dbStatus.servingFabricatedData === true) {
      return res.status(503).json({
        success: false,
        error: 'PROVIDER_SEARCH_DEGRADED',
        message: 'Búsqueda de prestadores no disponible en modo degradado'
      });
    }

    let lat = parseFloat(req.query.lat);
    let lon = parseFloat(req.query.lon);
    let radius = parseInt(req.query.radius);

    // Si faltan parámetros, intentar leer configuraciones dinámicas con fallback seguro
    if (isNaN(lat) || isNaN(lon) || isNaN(radius)) {
      try {
        const configRes = await pool.query(
          "SELECT key, value FROM platform_config WHERE key IN ('gps_centro_latitud', 'gps_centro_longitud', 'gps_default_radio_metros')"
        );
        const configs = {};
        if (configRes.rows) {
          configRes.rows.forEach(r => {
            configs[r.key] = r.value;
          });
        }
        if (isNaN(lat)) lat = parseFloat(configs['gps_centro_latitud'] || '4.6735');
        if (isNaN(lon)) lon = parseFloat(configs['gps_centro_longitud'] || '-74.1422');
        if (isNaN(radius)) radius = parseInt(configs['gps_default_radio_metros'] || '50000');
      } catch (_) {
        if (isNaN(lat)) lat = 4.6735;
        if (isNaN(lon)) lon = -74.1422;
        if (isNaN(radius)) radius = 50000;
      }
    }

    // Asegurar valores por defecto finales si aún son NaN
    if (isNaN(lat)) lat = 4.6735;
    if (isNaN(lon)) lon = -74.1422;
    if (isNaN(radius)) radius = 50000;

    // Validación defensiva de rangos
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ success: false, error: 'Coordenadas inválidas' });
    }

    // Obtener dinámicamente los planes SaaS que tienen la capacidad MAP_VISIBILITY
    const eligiblePlans = getPlansWithEntitlement(SAAS_CAPABILITIES.MAP_VISIBILITY);

    let result;
    try {
      const query = `
        WITH all_entities AS (
          -- 1. PRESTADORES INDIVIDUALES
          SELECT 
            p.id::text as id, 
            u.nombre as full_name, 
            u.foto_url as avatar_url,
            p.business_name, 
            p.description,
            p.rating_avg, 
            p.rating_count, 
            (p.estatus_verificacion = 'APROBADO') as is_verified,
            false as is_salon,
            ST_X(p.ubicacion::geometry) AS longitude,
            ST_Y(p.ubicacion::geometry) AS latitude,
            COALESCE(pl.tier, 'Creative Edge') as loyalty_tier,
            ST_Distance(p.ubicacion, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_meters
          FROM perfiles_prestador p
          INNER JOIN usuarios u ON p.id = u.id
          LEFT JOIN provider_loyalty pl ON p.id = pl.provider_id
          WHERE p.is_active = true AND p.estatus_verificacion = 'APROBADO'
            AND p.ubicacion IS NOT NULL
            AND ST_DWithin(
              p.ubicacion, 
              ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
              CASE 
                WHEN COALESCE(pl.tier, 'Creative Edge') = 'Visage Pro' THEN $3 * 1.15
                ELSE $3
              END
            )

          UNION ALL

          -- 2. SALONES SAAS CON MAP_VISIBILITY, LOCATION_ENABLED Y LOCATION_PUBLIC
          SELECT
            ('salon_' || s.id::text) as id,
            s.nombre_salon as full_name,
            '' as avatar_url,
            s.nombre_salon as business_name,
            COALESCE(s.direccion || CASE WHEN s.ciudad IS NOT NULL THEN ', ' || s.ciudad ELSE '' END, 'Salón de belleza profesional') as description,
            5.0 as rating_avg,
            5 as rating_count,
            true as is_verified,
            true as is_salon,
            COALESCE(s.longitude, ST_X(s.ubicacion::geometry)) AS longitude,
            COALESCE(s.latitude, ST_Y(s.ubicacion::geometry)) AS latitude,
            'Creative Edge' as loyalty_tier,
            ST_Distance(s.ubicacion, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_meters
          FROM salones s
          WHERE s.ubicacion IS NOT NULL
            AND s.location_enabled = true
            AND s.location_public = true
            AND UPPER(COALESCE(s.plan_saas, 'FREE_TRIAL')) = ANY($4)
            AND ST_DWithin(
              s.ubicacion,
              ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
              $3
            )
        )
        SELECT * FROM all_entities
        ORDER BY 
          CASE 
            WHEN loyalty_tier = 'Avant-Garde Elite' THEN 1
            WHEN loyalty_tier = 'Visage Pro' THEN 2
            ELSE 3
          END ASC,
          distance_meters ASC;
      `;
      result = await pool.query(query, [lon, lat, radius, eligiblePlans]);
    } catch (postgisErr) {
      // DEGRADED FALLBACK: Fallback geográfico con coordenadas fijas (4.6735, -74.1422) cuando falla la extensión PostGIS.
      console.warn('⚠️ Consulta de geolocalización PostGIS falló, ejecutando consulta de respaldo (degraded: true):', postgisErr.message);
      result = await pool.query(`
        SELECT 
          p.id::text, 
          u.nombre as full_name, 
          u.foto_url as avatar_url,
          p.business_name, 
          p.description,
          p.rating_avg, 
          p.rating_count, 
          (p.estatus_verificacion = 'APROBADO') as is_verified,
          false as is_salon,
          4.6735 as latitude,
          -74.1422 as longitude,
          'Creative Edge' as loyalty_tier,
          0 as distance_meters
        FROM perfiles_prestador p
        INNER JOIN usuarios u ON p.id = u.id
        WHERE p.is_active = true
        LIMIT 50
      `);
    }

    // Mapeo explícito para tipos nativos
    const formattedProviders = (result.rows || []).map(row => ({
      id: row.id.toString(),
      full_name: row.full_name || 'Prestador GlowApp',
      avatar_url: row.avatar_url || '',
      business_name: row.business_name || '',
      description: row.description || '',
      rating_avg: parseFloat(row.rating_avg) || 5.0,
      rating_count: parseInt(row.rating_count) || 1,
      is_verified: !!row.is_verified,
      is_salon: !!row.is_salon,
      loyalty_tier: row.loyalty_tier || 'Creative Edge',
      distance_meters: Math.round(row.distance_meters || 0),
      latitude: parseFloat(row.latitude) || 4.6097,
      longitude: parseFloat(row.longitude) || -74.0817
    }));

    const response = {
      success: true,
      count: formattedProviders.length,
      data: formattedProviders
    };
    
    if (process.env.NODE_ENV === 'development') {
      response.debug = { lat, lon, radius };
    }
    
    res.json(response);

  } catch (error) {
    console.error('❌ ERROR en GET /api/providers:', error.message);
    res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
  }
};

// GET /api/providers/:id → DETALLE DE UN PRESTADOR (Servicios + Portfolio + Reseñas)
exports.getProviderById = async (req, res) => {
  try {
    const { id } = req.params;
    const numericId = parseInt(id);
    if (isNaN(numericId)) return res.status(400).json({ error: 'ID inválido' });
    
    // 1. Datos del proveedor (JOIN con usuarios para foto_url)
    const providerQ = `
      SELECT p.id, u.nombre as full_name, u.foto_url as avatar_url, u.phone, 
             p.business_name, p.description, p.rating_avg, 
             p.rating_count, (p.estatus_verificacion = 'APROBADO') as is_verified 
      FROM perfiles_prestador p 
      JOIN usuarios u ON p.id = u.id 
      WHERE p.id = $1;
    `;
    const providerRes = await pool.query(providerQ, [numericId]);
    if (providerRes.rows.length === 0) return res.status(404).json({ error: 'No encontrado' });

    const servicesQ = `
      SELECT id, name, description, price, duration_minutes, category 
      FROM services 
      WHERE provider_id = $1 AND is_active = true 
      ORDER BY name;
    `;
    const servicesRes = await pool.query(servicesQ, [numericId]);

    const portfolioQ = `
      SELECT id, image_url, title, category 
      FROM portfolio_items 
      WHERE provider_id = $1 
      ORDER BY created_at DESC LIMIT 10;
    `;
    const portfolioRes = await pool.query(portfolioQ, [numericId]);

    const reviewsQ = `
      SELECT r.rating, r.comment, r.created_at, u.nombre as client_name 
      FROM reviews r 
      JOIN usuarios u ON r.client_id = u.id 
      WHERE r.provider_id = $1 
      ORDER BY r.created_at DESC LIMIT 5;
    `;
    const reviewsRes = await pool.query(reviewsQ, [numericId]);

    res.json({
      success: true,
      data: {
        provider: {
          ...providerRes.rows[0],
          id: providerRes.rows[0].id.toString()
        },
        services: servicesRes.rows,
        portfolio: portfolioRes.rows,
        reviews: reviewsRes.rows
      }
    });
  } catch (error) {
    console.error('❌ ERROR /api/providers/:id:', { message: error.message, code: error.code });
    res.status(500).json({ error: 'Error interno al cargar detalles' });
  }
};

// GET /api/providers/:id/slots → Obtener slots de tiempo disponibles para un proveedor y fecha específica
exports.getProviderSlots = async (req, res) => {
  try {
    const providerId = req.params.id;
    const { date, service_id } = req.query;

    if (!date || !service_id) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos (date, service_id)' });
    }

    const serviceIds = service_id.split(',').map(s => s.trim()).filter(s => s.length > 0);
    if (serviceIds.length === 0) {
      return res.status(400).json({ error: 'Formato de service_id inválido' });
    }

    // 1. Obtener la duración total acumulada de los servicios solicitados
    const serviceRes = await pool.query(
      'SELECT SUM(duration_minutes) as total_duration, COUNT(*) as match_count FROM services WHERE id = ANY($1) AND provider_id = $2 AND is_active = true;',
      [serviceIds, providerId]
    );
    if (serviceRes.rows.length === 0 || parseInt(serviceRes.rows[0].match_count) !== serviceIds.length) {
      return res.status(404).json({ error: 'Uno o más servicios no fueron encontrados o están inactivos' });
    }
    const selectedDuration = parseInt(serviceRes.rows[0].total_duration);

    // 2. Obtener todas las citas activas para ese día
    const bookingsQuery = `
      SELECT b.scheduled_at, s.duration_minutes 
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      WHERE b.provider_id = $1 
        AND b.scheduled_at::date = $2::date
        AND b.estado NOT IN ('CANCELADA');
    `;
    const bookingsRes = await pool.query(bookingsQuery, [providerId, date]);
    const activeBookings = bookingsRes.rows.map(row => {
      const start = new Date(row.scheduled_at);
      const duration = parseInt(row.duration_minutes);
      const end = new Date(start.getTime() + duration * 60 * 1000);
      return { start, end };
    });

    // 3. Obtener el horario configurado del prestador
    const hoursRes = await pool.query('SELECT active_start_hour, active_end_hour, weekly_schedule FROM perfiles_prestador WHERE id = $1', [providerId]);
    
    const [year, month, day] = date.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);
    const dayOfWeek = dateObj.getDay(); // 0: domingo, 1: lunes, ..., 6: sabado
    const dayNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const currentDayName = dayNames[dayOfWeek];

    const weeklySchedule = hoursRes.rows.length > 0 && hoursRes.rows[0].weekly_schedule ? hoursRes.rows[0].weekly_schedule : null;
    let startHour = 6;
    let endHour = 20;
    let isDayActive = true;

    if (weeklySchedule && weeklySchedule[currentDayName]) {
      const dayConf = weeklySchedule[currentDayName];
      isDayActive = dayConf.activo !== false;
      startHour = dayConf.inicio !== undefined ? parseInt(dayConf.inicio) : 6;
      endHour = dayConf.fin !== undefined ? parseInt(dayConf.fin) : 20;
    } else {
      startHour = hoursRes.rows.length > 0 && hoursRes.rows[0].active_start_hour !== null ? parseInt(hoursRes.rows[0].active_start_hour) : 6;
      endHour = hoursRes.rows.length > 0 && hoursRes.rows[0].active_end_hour !== null ? parseInt(hoursRes.rows[0].active_end_hour) : 20;
    }

    if (!isDayActive) {
      return res.json({ success: true, slots: [] });
    }

    const slots = [];
    const startTime = new Date(year, month - 1, day, startHour, 0, 0);
    const endTime = new Date(year, month - 1, day, endHour, 0, 0);

    const now = new Date();

    let currentSlot = new Date(startTime);
    while (currentSlot < endTime) {
      const slotStart = new Date(currentSlot);
      const slotEnd = new Date(slotStart.getTime() + selectedDuration * 60 * 1000);

      // Formato HH:MM
      const hours = String(slotStart.getHours()).padStart(2, '0');
      const minutes = String(slotStart.getMinutes()).padStart(2, '0');
      const timeStr = `${hours}:${minutes}`;

      let isAvailable = true;

      // Deshabilitar slots pasados si la fecha consultada es hoy
      if (slotStart < now) {
        isAvailable = false;
      }

      // Si aún está disponible por hora, comprobar colisiones con citas existentes
      if (isAvailable) {
        for (const booking of activeBookings) {
          // Colisión: start1 < end2 AND end1 > start2
          if (slotStart.getTime() < booking.end.getTime() && slotEnd.getTime() > booking.start.getTime()) {
            isAvailable = false;
            break;
          }
        }
      }

      slots.push({
        time: timeStr,
        is_available: isAvailable
      });

      // Incrementar por 30 minutos
      currentSlot.setMinutes(currentSlot.getMinutes() + 30);
    }

    res.json({
      success: true,
      date,
      service_id,
      slots
    });

  } catch (error) {
    console.error('❌ ERROR EN GET /api/providers/:id/slots:', error);
    res.status(500).json({ error: 'Error interno al obtener slots de tiempo' });
  }
};
