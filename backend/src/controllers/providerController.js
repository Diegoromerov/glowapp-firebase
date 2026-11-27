const db = require('../config/db');
const pool = db.pool;
const { getPlansWithEntitlement, SAAS_CAPABILITIES } = require('../config/saasEntitlements');
const { runAsSystem } = require('../config/tenantRouting');
const { systemPool } = require('../config/db');
const { getColombiaDayRange, getColombiaDateParts, isValidColombiaDate, getColombiaSchedule, intersectColombiaSchedules, buildAvailabilitySlots } = require('../utils/bookingCalendar');
const { evaluarElegibilidadReserva, salonVisibleEnMarketplace } = require('../utils/bookingEligibility');

// GET /api/providers → LISTA DE PRESTADORES Y SALONES (Geolocalización con PostGIS y Entitlements)
exports.getProviders = async (req, res) => {
  try {
    // La búsqueda cruza proveedores de varios tenants y requiere leer su
    // directorio público; una sesión de cliente activa RLS de su tenant.
    const queryAsSystem = (sql, values) =>
      runAsSystem({ pool, systemPool }, (client) => client.query(sql, values));

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
        const configRes = await queryAsSystem(
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
            (p.is_active = true AND u.is_active = true AND u.estado_operativo = 'HABILITADO'
              AND p.estatus_verificacion = 'APROBADO'
              AND EXISTS (
                SELECT 1 FROM services ready_service
                 WHERE ready_service.is_active = true
                   AND (ready_service.provider_id::text = p.id::text OR ready_service.business_profile_id::text IN (
                     SELECT ready_profile.id::text FROM business_profiles ready_profile
                      WHERE ready_profile.provider_id::text = p.id::text
                   ))
              )) as can_receive_bookings,
            false as is_salon,
            ST_X(COALESCE(live.location, p.ubicacion)::geometry) AS longitude,
            ST_Y(COALESCE(live.location, p.ubicacion)::geometry) AS latitude,
            COALESCE(pl.tier, 'Creative Edge') as loyalty_tier,
            p.active_start_hour as start_hour,
            p.active_end_hour as end_hour,
            p.weekly_schedule as weekly_schedule,
            ST_Distance(COALESCE(live.location, p.ubicacion), ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_meters,
            (live.provider_id IS NOT NULL) AS is_live_location,
            live.captured_at AS live_location_updated_at,
            ST_X(p.ubicacion::geometry) AS registered_longitude,
            ST_Y(p.ubicacion::geometry) AS registered_latitude
          FROM perfiles_prestador p
          INNER JOIN usuarios u ON p.id = u.id
          LEFT JOIN provider_loyalty pl ON p.id = pl.provider_id
          LEFT JOIN provider_live_locations live
            ON live.provider_id = p.id
           AND $5::boolean = true
           AND p.is_active = true
           AND p.live_location_consent = true
           AND live.captured_at >= NOW() - INTERVAL '5 minutes'
           AND live.received_at >= NOW() - INTERVAL '5 minutes'
          WHERE p.is_active = true AND u.is_active = true
            AND p.estatus_verificacion = 'APROBADO'
            AND COALESCE(u.visibilidad_suspendida, false) = false
            AND (live.location IS NOT NULL OR p.ubicacion IS NOT NULL)
            AND ST_DWithin(
              COALESCE(live.location, p.ubicacion),
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
            CAST(NULL AS numeric) as rating_avg,
            0 as rating_count,
            (salon_owner.is_active = true AND salon_owner.estado_operativo = 'HABILITADO'
              AND (salon_profile.id IS NULL OR salon_profile.estatus_verificacion = 'APROBADO')) as is_verified,
            (salon_owner.is_active = true AND salon_owner.estado_operativo = 'HABILITADO'
              AND (salon_profile.id IS NULL OR (salon_profile.is_active = true
                AND salon_profile.estatus_verificacion = 'APROBADO'))
              AND EXISTS (
                SELECT 1 FROM services ready_service
                 WHERE ready_service.is_active = true
                   AND (ready_service.salon_id::text = s.id::text
                     OR (ready_service.salon_id IS NULL
                       AND ready_service.business_profile_id::text = s.business_profile_id::text))
              )) as can_receive_bookings,
            true as is_salon,
            COALESCE(s.longitude, ST_X(s.ubicacion::geometry)) AS longitude,
            COALESCE(s.latitude, ST_Y(s.ubicacion::geometry)) AS latitude,
            'Creative Edge' as loyalty_tier,
            NULL::int as start_hour,
            NULL::int as end_hour,
            NULL::jsonb as weekly_schedule,
            ST_Distance(s.ubicacion, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_meters,
            false AS is_live_location,
            NULL::timestamptz AS live_location_updated_at,
            COALESCE(s.longitude, ST_X(s.ubicacion::geometry)) AS registered_longitude,
            COALESCE(s.latitude, ST_Y(s.ubicacion::geometry)) AS registered_latitude
          FROM salones s
          JOIN usuarios salon_owner ON salon_owner.id = s.id_dueno
          LEFT JOIN perfiles_prestador salon_profile ON salon_profile.id = salon_owner.id
          WHERE salon_owner.is_active = true
            AND COALESCE(salon_owner.visibilidad_suspendida, false) = false
            AND s.ubicacion IS NOT NULL
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
      const includeLiveLocations = req.user?.role === 'client';
      result = await queryAsSystem(query, [lon, lat, radius, eligiblePlans, includeLiveLocations]);
    } catch (postgisErr) {
      // Nunca se inventa una coordenada cuando falla el cálculo espacial: un
      // pin aproximado puede atribuir falsamente la ubicación de otra persona.
      console.warn('⚠️ Consulta geográfica PostGIS no disponible:', postgisErr.message);
      return res.status(503).json({
        success: false,
        error: 'PROVIDER_LOCATION_UNAVAILABLE',
        message: 'No se pudo calcular la ubicación de los prestadores.'
      });
    }

    // Mapeo explícito para tipos nativos
    const formattedProviders = (result.rows || []).map(row => ({
      id: row.id.toString(),
      full_name: row.full_name || 'Prestador GlowApp',
      avatar_url: row.avatar_url || '',
      business_name: row.business_name || '',
      description: row.description || '',
      // Sin resenas la nota es NULL y el conteo 0. Antes se respondia 5.0 con
      // 1 opinion: un prestador nuevo aparecia perfecto y no habia forma de
      // distinguirlo de uno con 40 resenas de 4.8, que es justo lo que una
      // calificacion sirve para saber.
      rating_avg: row.rating_avg === null || row.rating_avg === undefined
        ? null
        : parseFloat(row.rating_avg),
      rating_count: parseInt(row.rating_count) || 0,
      can_receive_bookings: !!row.can_receive_bookings,
      // Puntuacion ponderada para ordenar: arranca en la media del sitio y se
      // acerca a la nota real a medida que llegan resenas.
      rating_score: (() => {
        const previa = 4.0;   // media de referencia del marketplace
        const peso = 5;       // resenas necesarias para pesar tanto como la media
        const n = parseInt(row.rating_count) || 0;
        const nota = row.rating_avg === null || row.rating_avg === undefined
          ? previa
          : parseFloat(row.rating_avg);
        return Number((((nota * n) + (previa * peso)) / (n + peso)).toFixed(2));
      })(),
      is_verified: !!row.is_verified,
      is_salon: !!row.is_salon,
      loyalty_tier: row.loyalty_tier || 'Creative Edge',
      distance_meters: Math.round(row.distance_meters || 0),
      latitude: row.latitude == null ? null : parseFloat(row.latitude),
      longitude: row.longitude == null ? null : parseFloat(row.longitude),
      registered_latitude: row.registered_latitude == null ? null : parseFloat(row.registered_latitude),
      registered_longitude: row.registered_longitude == null ? null : parseFloat(row.registered_longitude),
      is_live_location: row.is_live_location === true,
      live_location_updated_at: row.live_location_updated_at || null
    }));

    const providersWithCoordinates = formattedProviders.filter((provider) =>
      Number.isFinite(provider.latitude) && Number.isFinite(provider.longitude)
    );

    // ── «Cerca y disponible hoy» ─────────────────────────────────────────────
    // Una ficha a 300 m que solo tiene cita el jueves no resuelve "quiero algo
    // hoy". Se calcula el primer hueco real de cada prestador y la
    // disponibilidad pasa por delante de la distancia en el orden.
    const ahora = new Date();
    const idsIndividuales = result.rows
      .filter((r) => !r.is_salon)
      .map((r) => parseInt(r.id, 10))
      .filter((n) => Number.isFinite(n));

    const porId = new Map(result.rows.map((r) => [String(r.id), r]));

    if (idsIndividuales.length) {
      const rangoDiaBogota = getColombiaDayRange(ahora);
      const fechaBogota = getColombiaDateParts(ahora);

      let reservasHoy = { rows: [] };
      let duraciones = { rows: [] };
      try {
        [reservasHoy, duraciones] = await Promise.all([
          queryAsSystem(
            `SELECT b.provider_id, b.scheduled_at, COALESCE(s.duration_minutes, 60) AS dur
               FROM bookings b
               LEFT JOIN services s ON s.id = b.service_id
              WHERE b.provider_id = ANY($1::int[])
                AND b.estado::text NOT IN ('CANCELADA', 'CANCELLED')
                AND b.scheduled_at >= $2 AND b.scheduled_at < $3`,
            [idsIndividuales, rangoDiaBogota.start, rangoDiaBogota.endExclusive]
          ),
          queryAsSystem(
            `SELECT provider_id, MIN(duration_minutes) AS dur
               FROM services
              WHERE provider_id = ANY($1::int[]) AND is_active = true
              GROUP BY provider_id`,
            [idsIndividuales]
          ),
        ]);
      } catch (agendaErr) {
        // Sin agenda no se puede afirmar disponibilidad: mejor no prometerla.
        console.warn('⚠️ No se pudo calcular la disponibilidad de hoy:', agendaErr.message);
      }

      const duracionPor = new Map(
        duraciones.rows.map((r) => [String(r.provider_id), parseInt(r.dur, 10) || 60])
      );
      const ocupadosPor = new Map();
      for (const fila of reservasHoy.rows) {
        const clave = String(fila.provider_id);
        const inicio = new Date(fila.scheduled_at);
        const fin = new Date(inicio.getTime() + (parseInt(fila.dur, 10) || 60) * 60000);
        if (!ocupadosPor.has(clave)) ocupadosPor.set(clave, []);
        ocupadosPor.get(clave).push({ inicio, fin });
      }

      for (const prov of providersWithCoordinates) {
        const fila = porId.get(String(prov.id));
        const schedule = getColombiaSchedule({
          date: fechaBogota,
          weeklySchedule: fila?.weekly_schedule,
          activeStartHour: fila?.start_hour,
          activeEndHour: fila?.end_hour,
        });
        const slots = !prov.is_salon && schedule?.isActive
          ? buildAvailabilitySlots({
              date: fechaBogota,
              startHour: schedule.startHour,
              endHour: schedule.endHour,
              durationMinutes: duracionPor.get(String(prov.id)) || 60,
              activeBookings: (ocupadosPor.get(String(prov.id)) || []).map((booking) => ({
                start: booking.inicio,
                end: booking.fin,
              })),
              now: ahora,
            })
          : [];
        prov.next_slot_today = slots.find((slot) => slot.is_available)?.time || null;
        prov.available_today = Boolean(prov.next_slot_today);
      }

      providersWithCoordinates.sort((a, b) => {
        if (a.available_today !== b.available_today) return a.available_today ? -1 : 1;
        const franjaA = Math.floor(a.distance_meters / 1000);
        const franjaB = Math.floor(b.distance_meters / 1000);
        if (franjaA !== franjaB) return franjaA - franjaB;
        return (b.rating_score || 0) - (a.rating_score || 0);
      });
    } else {
      for (const prov of providersWithCoordinates) {
        prov.next_slot_today = null;
        prov.available_today = false;
      }
    }

    const response = {
      success: true,
      count: providersWithCoordinates.length,
      data: providersWithCoordinates
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
    if (String(id).startsWith('salon_')) {
      const salonId = Number(String(id).slice('salon_'.length));
      if (!Number.isSafeInteger(salonId) || salonId <= 0) return res.status(400).json({ error: 'ID inválido' });
      const eligiblePlans = getPlansWithEntitlement(SAAS_CAPABILITIES.MAP_VISIBILITY);
      const salonRes = await pool.query(`
        SELECT s.id AS salon_id, s.id_dueno AS provider_id, s.nombre_salon AS business_name,
               s.nombre_salon AS full_name, s.direccion, s.ciudad, s.business_profile_id,
               u.foto_url AS avatar_url, u.phone,
               (u.is_active = true AND u.estado_operativo = 'HABILITADO'
                 AND (salon_profile.id IS NULL OR salon_profile.estatus_verificacion = 'APROBADO')) AS is_verified,
               (u.is_active = true AND u.estado_operativo = 'HABILITADO'
                 AND (salon_profile.id IS NULL OR (salon_profile.is_active = true
                   AND salon_profile.estatus_verificacion = 'APROBADO'))
                 AND EXISTS (
                   SELECT 1 FROM services ready_service
                    WHERE ready_service.is_active = true
                      AND (ready_service.salon_id = s.id
                        OR (ready_service.salon_id IS NULL
                          AND ready_service.business_profile_id = s.business_profile_id))
                 )) AS can_receive_bookings
          FROM salones s
          JOIN usuarios u ON u.id = s.id_dueno
          LEFT JOIN business_profiles bp ON bp.id = s.business_profile_id
          LEFT JOIN perfiles_prestador salon_profile ON salon_profile.id = u.id
         WHERE s.id = $1
           AND s.location_enabled = true
           AND s.location_public = true
           AND COALESCE(u.visibilidad_suspendida, false) = false
           AND UPPER(COALESCE(s.plan_saas, bp.saas_plan, 'FREE_TRIAL')) = ANY($2)
         LIMIT 1`, [salonId, eligiblePlans]);
      if (!salonRes.rows.length) return res.status(404).json({ error: 'No encontrado' });
      const salon = salonRes.rows[0];
      const servicesRes = await pool.query(`
        SELECT id, provider_id, business_profile_id, salon_id, name, description, price, duration_minutes, category
          FROM services
         WHERE is_active = true
           AND (salon_id = $1 OR (salon_id IS NULL AND business_profile_id = $2))
         ORDER BY name`, [salonId, salon.business_profile_id]);
      const [portfolioRes, reviewsRes] = await Promise.all([
        pool.query('SELECT id, image_url, title, category FROM portfolio_items WHERE provider_id = $1 ORDER BY created_at DESC LIMIT 10', [salon.provider_id]),
        pool.query(`SELECT r.rating, r.comment, r.aspectos, r.created_at, u.nombre AS client_name
                      FROM reviews r JOIN usuarios u ON u.id = r.client_id
                     WHERE r.provider_id = $1 ORDER BY r.created_at DESC LIMIT 5`, [salon.provider_id]),
      ]);
      return res.json({
        success: true,
        data: {
          provider: {
            ...salon,
            id: String(salon.provider_id),
            is_salon: true,
            is_verified: !!salon.is_verified,
            can_receive_bookings: !!salon.can_receive_bookings && servicesRes.rows.length > 0,
            rating_avg: null,
            rating_count: 0,
            completed_bookings_count: 0,
            punctuality_sample_count: 0,
            punctual_bookings_count: 0,
            punctuality_percentage: null,
          },
          services: servicesRes.rows,
          salons: [{ id: salon.salon_id, name: salon.business_name, address: salon.direccion, city: salon.ciudad }],
          portfolio: portfolioRes.rows,
          reviews: reviewsRes.rows,
        },
      });
    }
    const numericId = parseInt(id);
    if (isNaN(numericId)) return res.status(400).json({ error: 'ID inválido' });
    
    // 1. Datos del proveedor (JOIN con usuarios para foto_url)
    const providerQ = `
      SELECT p.id, p.is_active AS profile_is_active, u.is_active AS user_is_active,
             u.estado_operativo, u.nombre as full_name, u.foto_url as avatar_url, u.phone,
             p.business_name, p.description, p.rating_avg, 
             p.rating_count, (p.estatus_verificacion = 'APROBADO') as is_verified 
      FROM perfiles_prestador p 
      JOIN usuarios u ON p.id = u.id 
      WHERE p.id = $1 AND COALESCE(u.visibilidad_suspendida, false) = false;
    `;
    const providerRes = await pool.query(providerQ, [numericId]);
    if (providerRes.rows.length === 0) return res.status(404).json({ error: 'No encontrado' });

    // Métricas públicas basadas en eventos registrados en bookings.
    // Para puntualidad solo contamos citas completadas cuyo inicio quedó
    // registrado; las citas antiguas sin check-in no se asumen puntuales.
    const statsRes = await runAsSystem({ pool }, (client) => client.query(
      `SELECT
         COUNT(*) FILTER (
           WHERE estado IN ('COMPLETADA', 'FINALIZADA_PRESTADOR')
         )::int AS completed_bookings_count,
         COUNT(*) FILTER (
           WHERE estado IN ('COMPLETADA', 'FINALIZADA_PRESTADOR')
             AND checkin_at IS NOT NULL
         )::int AS punctuality_sample_count,
         COUNT(*) FILTER (
           WHERE estado IN ('COMPLETADA', 'FINALIZADA_PRESTADOR')
             AND checkin_at IS NOT NULL
             AND checkin_at <= scheduled_at + INTERVAL '15 minutes'
         )::int AS punctual_bookings_count
       FROM bookings
       WHERE provider_id = $1`,
      [numericId]
    ));
    const stats = statsRes.rows[0] || {};
    const completedBookingsCount = Number(stats.completed_bookings_count) || 0;
    const punctualitySampleCount = Number(stats.punctuality_sample_count) || 0;
    const punctualBookingsCount = Number(stats.punctual_bookings_count) || 0;
    const punctualityPercentage = punctualitySampleCount > 0
      ? Math.round((punctualBookingsCount / punctualitySampleCount) * 100)
      : null;

    const servicesQ = `
      SELECT s.id, s.provider_id, s.business_profile_id, s.salon_id,
             s.name, s.description, s.price, s.duration_minutes, s.category
        FROM services s
       WHERE s.is_active = true
         AND (s.provider_id = $1 OR s.business_profile_id IN (
           SELECT bp.id FROM business_profiles bp
            WHERE bp.provider_id = $1 OR EXISTS (
              SELECT 1 FROM memberships m
               WHERE m.business_profile_id = bp.id AND m.user_id = $1 AND m.status = 'ACTIVE'
            )
         ))
       ORDER BY s.name;
    `;
    const servicesRes = await pool.query(servicesQ, [numericId]);

    const salonsRes = await pool.query(`
      SELECT DISTINCT s.id, s.nombre_salon AS name, s.direccion AS address, s.ciudad AS city
        FROM salones s
        JOIN business_profiles bp ON bp.id = s.business_profile_id
       WHERE bp.provider_id = $1 OR EXISTS (
         SELECT 1 FROM memberships m
          WHERE m.business_profile_id = bp.id AND m.user_id = $1 AND m.status = 'ACTIVE'
       )
       ORDER BY s.id`, [numericId]);

    const portfolioQ = `
      SELECT id, image_url, title, category 
      FROM portfolio_items 
      WHERE provider_id = $1 
      ORDER BY created_at DESC LIMIT 10;
    `;
    const portfolioRes = await pool.query(portfolioQ, [numericId]);

    const reviewsQ = `
      SELECT r.rating, r.comment, r.aspectos, r.created_at, u.nombre as client_name 
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
          id: providerRes.rows[0].id.toString(),
          can_receive_bookings: providerRes.rows[0].profile_is_active === true
            && providerRes.rows[0].user_is_active === true
            && providerRes.rows[0].estado_operativo === 'HABILITADO'
            && providerRes.rows[0].is_verified === true
            && servicesRes.rows.length > 0,
          completed_bookings_count: completedBookingsCount,
          punctuality_sample_count: punctualitySampleCount,
          punctual_bookings_count: punctualBookingsCount,
          punctuality_percentage: punctualityPercentage
        },
        services: servicesRes.rows,
        salons: salonsRes.rows,
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
    const providerId = Number(req.params.id);
    const { date, service_id } = req.query;
    const salonId = req.query.salon_id ? Number(req.query.salon_id) : null;

    if (!Number.isSafeInteger(providerId) || providerId <= 0 || providerId > 2147483647) {
      return res.status(400).json({ success: false, code: 'BOOKING_PROVIDER_INVALID', error: 'Identificador de prestador inválido.' });
    }
    if (!date || typeof service_id !== 'string' || service_id.trim() === '') {
      return res.status(400).json({ error: 'Faltan parámetros requeridos (date, service_id)' });
    }

    const serviceIds = [...new Set(service_id.split(',').map(s => s.trim()).filter(s => s.length > 0))];
    if (serviceIds.length === 0) {
      return res.status(400).json({ error: 'Formato de service_id inválido' });
    }
    if (serviceIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
      return res.status(400).json({ success: false, code: 'BOOKING_SERVICE_INVALID', error: 'Uno o más identificadores de servicio no son válidos.' });
    }
    if (req.query.salon_id && (!Number.isSafeInteger(salonId) || salonId <= 0 || salonId > 2147483647)) {
      return res.status(400).json({ success: false, code: 'BOOKING_SALON_INVALID', error: 'salon_id inválido' });
    }
    if (!isValidColombiaDate(date)) {
      return res.status(400).json({ success: false, code: 'BOOKING_DATE_INVALID', error: 'date debe tener formato YYYY-MM-DD.' });
    }
    const providerRows = await runAsSystem({ pool }, (client) => client.query(
      `SELECT u.is_active, u.estado_operativo, p.estatus_verificacion
         FROM usuarios u
         LEFT JOIN perfiles_prestador p ON p.id = u.id
        WHERE u.id = $1`,
      [providerId]
    ));
    const elegibilidad = evaluarElegibilidadReserva(providerRows.rows[0] || null);
    if (!elegibilidad.permitido) {
      return res.status(elegibilidad.status).json({
        success: false,
        code: elegibilidad.code,
        error: elegibilidad.error,
      });
    }
    const bookingDay = getColombiaDayRange(`${date}T12:00:00.000Z`);

    // 1. Obtener la duración total acumulada de los servicios solicitados
    const serviceRes = await runAsSystem({ pool }, (client) => client.query(
      `SELECT SUM(duration_minutes) AS total_duration,
              COUNT(*) AS match_count,
              COUNT(*) FILTER (WHERE business_profile_id IS NULL) AS unresolved_scope_count,
              ARRAY_REMOVE(ARRAY_AGG(DISTINCT salon_id), NULL) AS service_salon_ids,
              ARRAY_REMOVE(ARRAY_AGG(DISTINCT business_profile_id), NULL) AS business_profile_ids
         FROM services
        WHERE id = ANY($1::uuid[])
          AND is_active = true
          AND (provider_id = $2 OR business_profile_id IN (
            SELECT bp.id FROM business_profiles bp
             WHERE bp.provider_id = $2 OR EXISTS (
               SELECT 1 FROM memberships m
                WHERE m.business_profile_id = bp.id AND m.user_id = $2 AND m.status = 'ACTIVE'
             )
          ))
          AND ($3::integer IS NULL OR salon_id IS NULL OR salon_id = $3);`,
      [serviceIds, providerId, salonId]
    ));
    if (serviceRes.rows.length === 0 || parseInt(serviceRes.rows[0].match_count) !== serviceIds.length) {
      return res.status(404).json({ error: 'Uno o más servicios no fueron encontrados o están inactivos' });
    }
    const selectedDuration = parseInt(serviceRes.rows[0].total_duration);
    const serviceSalonIds = (serviceRes.rows[0].service_salon_ids || []).map(Number);
    const businessProfileIds = serviceRes.rows[0].business_profile_ids || [];
    if (Number(serviceRes.rows[0].unresolved_scope_count) > 0) {
      const profilesRes = await runAsSystem({ pool }, (client) => client.query(
        'SELECT COUNT(*)::int AS count FROM business_profiles WHERE provider_id = $1',
        [Number(providerId)]
      ));
      if (Number(profilesRes.rows[0]?.count || 0) > 0) {
        return res.status(409).json({
          success: false,
          code: 'BOOKING_SERVICE_SCOPE_UNRESOLVED',
          error: 'Uno o más servicios aún no están asignados a un negocio. El prestador debe asignarlos antes de habilitar reservas SaaS.',
        });
      }
    }
    if (new Set(businessProfileIds.map(String)).size > 1) {
      return res.status(400).json({ success: false, code: 'BOOKING_SCOPE_MISMATCH', error: 'Los servicios pertenecen a negocios distintos.' });
    }
    if (new Set(serviceSalonIds).size > 1 || (salonId && serviceSalonIds.some((id) => id !== salonId))) {
      return res.status(400).json({ success: false, code: 'BOOKING_SCOPE_MISMATCH', error: 'Los servicios no pertenecen a la sede seleccionada.' });
    }
    let targetSalonId = salonId || serviceSalonIds[0] || null;
    if (targetSalonId) {
      const salonRes = await runAsSystem({ pool }, (client) => client.query(
        `SELECT s.id, s.business_profile_id, s.location_enabled, s.location_public,
                UPPER(COALESCE(s.plan_saas, bp.saas_plan, 'FREE_TRIAL')) AS plan_saas
           FROM salones s
           LEFT JOIN business_profiles bp ON bp.id = s.business_profile_id
          WHERE s.id = $1
            AND (
              (cardinality($2::varchar[]) > 0 AND s.business_profile_id = ANY($2::varchar[])
                AND EXISTS (
                  SELECT 1 FROM business_profiles scope_bp
                   WHERE scope_bp.id = s.business_profile_id
                     AND (scope_bp.provider_id = $3 OR EXISTS (
                       SELECT 1 FROM memberships m
                        WHERE m.business_profile_id = scope_bp.id AND m.user_id = $3 AND m.status = 'ACTIVE'
                     ))
                ))
              OR (cardinality($2::varchar[]) = 0 AND (
                (s.business_profile_id IS NULL AND s.id_dueno = $3)
                OR EXISTS (
                  SELECT 1 FROM business_profiles scope_bp
                   WHERE scope_bp.id = s.business_profile_id
                     AND (scope_bp.provider_id = $3 OR EXISTS (
                       SELECT 1 FROM memberships m
                        WHERE m.business_profile_id = scope_bp.id AND m.user_id = $3 AND m.status = 'ACTIVE'
                     ))
                )
              ))
            )`,
        [targetSalonId, businessProfileIds, Number(providerId)]
      ));
      if (!salonRes.rows.length) {
        return res.status(404).json({ success: false, code: 'BOOKING_SALON_NOT_FOUND', error: 'La sede no existe o no corresponde a los servicios.' });
      }
      if (req.appAudience === 'client' && !salonVisibleEnMarketplace(salonRes.rows[0])) {
        return res.status(404).json({
          success: false,
          code: 'SALON_NOT_PUBLIC',
          error: 'No encontramos el prestador seleccionado.',
        });
      }
      const salonBusinessProfileId = salonRes.rows[0].business_profile_id;
      if (salonBusinessProfileId && Number(serviceRes.rows[0].unresolved_scope_count) > 0) {
        return res.status(409).json({
          success: false,
          code: 'BOOKING_SERVICE_SCOPE_UNRESOLVED',
          error: 'Uno o más servicios aún no están asignados al negocio de esta sede.',
        });
      }
      if (salonBusinessProfileId && businessProfileIds.some((id) => String(id) !== String(salonBusinessProfileId))) {
        return res.status(400).json({ success: false, code: 'BOOKING_SCOPE_MISMATCH', error: 'Los servicios no pertenecen al negocio de la sede seleccionada.' });
      }
    } else if (businessProfileIds.length === 1) {
      const sedesRes = await runAsSystem({ pool }, (client) => client.query(
        'SELECT id FROM salones WHERE business_profile_id = $1 ORDER BY id LIMIT 2',
        [businessProfileIds[0]]
      ));
      if (sedesRes.rows.length > 1) {
        return res.status(400).json({ success: false, code: 'BOOKING_SALON_REQUIRED', error: 'Selecciona la sede donde quieres reservar.' });
      }
      if (sedesRes.rows.length === 1) targetSalonId = Number(sedesRes.rows[0].id);
    }

    // 2. Obtener todas las citas activas para ese día
    const bookingsQuery = `
      SELECT b.scheduled_at, COALESCE(s.duration_minutes, 60) AS duration_minutes
      FROM bookings b
      LEFT JOIN services s ON b.service_id = s.id
      WHERE b.provider_id = $1 
        AND b.scheduled_at >= $2
        AND b.scheduled_at < $3
        AND b.estado::text NOT IN ('CANCELADA', 'CANCELLED');
    `;
    const bookingsRes = await runAsSystem({ pool }, (client) => client.query(bookingsQuery, [providerId, bookingDay.start, bookingDay.endExclusive]));
    const activeBookings = bookingsRes.rows.map(row => {
      const start = new Date(row.scheduled_at);
      const duration = Number(row.duration_minutes) || 60;
      const end = new Date(start.getTime() + duration * 60 * 1000);
      return { start, end };
    });

    // 3. Obtener el horario configurado del prestador
    const hoursRes = await runAsSystem({ pool }, (client) => client.query(
      `SELECT p.active_start_hour, p.active_end_hour, p.weekly_schedule, s.horario_atencion
         FROM (SELECT $1::integer AS provider_id, $2::integer AS salon_id) requested
         LEFT JOIN perfiles_prestador p ON p.id = requested.provider_id
         LEFT JOIN salones s ON s.id = requested.salon_id`, [providerId, targetSalonId]
    ));
    
    const providerHours = hoursRes.rows[0] || {};
    const providerSchedule = getColombiaSchedule({
      date,
      weeklySchedule: providerHours.weekly_schedule,
      activeStartHour: providerHours.active_start_hour,
      activeEndHour: providerHours.active_end_hour,
    });
    const schedule = intersectColombiaSchedules(providerSchedule, providerHours.horario_atencion, date);

    if (!schedule?.isActive) {
      return res.json({ success: true, slots: [] });
    }

    const slots = buildAvailabilitySlots({
      date,
      startHour: schedule.startHour,
      endHour: schedule.endHour,
      durationMinutes: selectedDuration,
      activeBookings,
    });

    res.json({
      success: true,
      date,
      service_id,
      salon_id: targetSalonId,
      slots
    });

  } catch (error) {
    console.error('❌ ERROR EN GET /api/providers/:id/slots:', error);
    res.status(500).json({ error: 'Error interno al obtener slots de tiempo' });
  }
};
