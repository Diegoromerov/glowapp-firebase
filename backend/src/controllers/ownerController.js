const { pool } = require('../config/db');

// ==========================================
// 🏢 OBTENER LISTA DE SEDES DEL PROPIETARIO
// ==========================================
exports.getOwnerSalones = async (req, res) => {
  try {
    const ownedIds = req.ownedSalonIds || [];

    if (ownedIds.length === 0) {
      return res.json({ success: true, salones: [] });
    }

    const salonesRes = await pool.query(
      `SELECT s.id, s.nombre_salon, s.nit, s.direccion, s.telefono, s.ciudad, s.plan_saas, s.id_dueno,
              s.latitude, s.longitude, s.location_enabled, s.location_public,
              COUNT(DISTINCT m.user_id) FILTER (WHERE m.status = 'ACTIVE') AS total_colaboradores
         FROM salones s
    LEFT JOIN business_profiles bp ON bp.id = left('salon-' || s.id::text, 36)
    LEFT JOIN memberships m ON m.business_profile_id = bp.id
        WHERE s.id = ANY($1::int[])
     GROUP BY s.id
     ORDER BY s.id ASC`,
      [ownedIds]
    );

    res.json({
      success: true,
      salones: salonesRes.rows.map((row) => ({
        ...row,
        total_colaboradores: Number(row.total_colaboradores || 0),
      })),
    });
  } catch (error) {
    console.error('❌ ERROR GET OWNER SALONES:', error.message);
    res.status(500).json({ error: 'Error al consultar las sedes del propietario' });
  }
};

// ==========================================
// 🔄 SELECCIONAR / CAMBIAR DE SEDE ACTIVA
// ==========================================
exports.switchSalon = async (req, res) => {
  try {
    const targetSalonId = req.salonId;
    const membership = req.salonMembership;

    res.json({
      success: true,
      message: `Contexto de sede cambiado exitosamente a la sede ID ${targetSalonId}`,
      active_salon_id: targetSalonId,
      sub_rol: membership ? membership.sub_rol : 'DUEÑO',
      contract_note: 'El cliente es responsable de almacenar active_salon_id y reenviarlo vía cabecera x-active-salon-id o query/body.',
    });
  } catch (error) {
    console.error('❌ ERROR SWITCH SALON:', error.message);
    res.status(500).json({ error: 'Error al cambiar de sede activa' });
  }
};

// ==========================================
// 📊 DASHBOARD DE MÉTRICAS CONSOLIDADAS MULTI-SEDE
// ==========================================
exports.getDashboardMetrics = async (req, res) => {
  try {
    const ownedIds = req.ownedSalonIds || [];
    const { startDate, endDate, salon_id } = req.query;

    if (ownedIds.length === 0) {
      return res.json({
        success: true,
        metrics: {
          ingresos_brutos: 0,
          comision_plataforma: 0,
          impuestos_estado: 0,
          ingresos_netos_negocio: 0,
          pago_neto_prestadores: 0,
          total_citas: 0,
          sedes_compartidas: false,
          prestadores_cross_tenant: false,
          prestadores_multinegocio: false,
          prestadores_externos: [],
          desglose_por_sede: [],
          top_prestadores: [],
        },
      });
    }

    // GRAVE 4 FIX: Calcular sedes_compartidas (intra-propietario) sobre TODAS las sedes del propietario
    const allProvidersRes = await pool.query(
      `SELECT m.user_id AS provider_id, substring(bp.id from 7)::int AS salon_id, u.nombre AS nombre_prestador
         FROM memberships m
         JOIN business_profiles bp ON bp.id = m.business_profile_id
         JOIN usuarios u ON m.user_id = u.id
        WHERE substring(bp.id from 7)::int = ANY($1::int[]) AND m.status = 'ACTIVE'
          AND bp.id ~ '^salon-[0-9]+$'`,
      [ownedIds]
    );

    const allProviderSalonMap = new Map();
    const providerNames = new Map();
    let hasSharedProviders = false;

    for (const row of allProvidersRes.rows) {
      const pId = Number(row.provider_id);
      const sId = Number(row.salon_id);
      providerNames.set(pId, row.nombre_prestador);

      if (!allProviderSalonMap.has(pId)) {
        allProviderSalonMap.set(pId, new Set());
      }
      allProviderSalonMap.get(pId).add(sId);
      if (allProviderSalonMap.get(pId).size > 1) {
        hasSharedProviders = true;
      }
    }

    // Filtrar sedes activas para el reporte si se pasa el query param salon_id
    let targetSalonIds = ownedIds;
    if (salon_id) {
      const parsedId = Number(salon_id);
      if (ownedIds.includes(parsedId)) {
        targetSalonIds = [parsedId];
      }
    }

    // Obtener los prestadores de las sedes solicitadas en el filtro
    const targetProvidersRes = await pool.query(
      `SELECT DISTINCT m.user_id AS provider_id
         FROM memberships m
         JOIN business_profiles bp ON bp.id = m.business_profile_id
        WHERE substring(bp.id from 7)::int = ANY($1::int[]) AND m.status = 'ACTIVE'
          AND bp.id ~ '^salon-[0-9]+$'`,
      [targetSalonIds]
    );

    const providerIds = targetProvidersRes.rows.map((r) => Number(r.provider_id));

    if (providerIds.length === 0) {
      return res.json({
        success: true,
        metrics: {
          ingresos_brutos: 0,
          comision_plataforma: 0,
          impuestos_estado: 0,
          ingresos_netos_negocio: 0,
          pago_neto_prestadores: 0,
          total_citas: 0,
          sedes_compartidas: hasSharedProviders,
          prestadores_cross_tenant: false,
          prestadores_multinegocio: false,
          prestadores_externos: [],
          desglose_por_sede: [],
          top_prestadores: [],
        },
      });
    }

    // GRAVE 3 FIX: Detección de Fuga Cross-Tenant (membresía en salones de OTROS propietarios)
    const externalCheckRes = await pool.query(
      `SELECT m.user_id AS provider_id, substring(bp.id from 7)::int AS salon_id
         FROM memberships m
         JOIN business_profiles bp ON bp.id = m.business_profile_id
        WHERE m.user_id = ANY($1::int[])
          AND m.status = 'ACTIVE'
          AND bp.id ~ '^salon-[0-9]+$'
          AND NOT (substring(bp.id from 7)::int = ANY($2::int[]))`,
      [providerIds, ownedIds]
    );

    const externalProvidersMap = new Map();
    for (const row of externalCheckRes.rows) {
      const pId = Number(row.provider_id);
      const sId = Number(row.salon_id);
      if (!externalProvidersMap.has(pId)) {
        externalProvidersMap.set(pId, []);
      }
      externalProvidersMap.get(pId).push(sId);
    }

    const hasCrossTenantProviders = externalProvidersMap.size > 0;
    const prestadoresExternos = Array.from(externalProvidersMap.entries()).map(([pId, salonesIds]) => ({
      provider_id: pId,
      nombre: providerNames.get(pId) || `Prestador #${pId}`,
      otros_salones_ids: salonesIds,
    }));

    // SEMÁNTICA DE RANGO DE FECHAS: `scheduled_at` corresponde a la fecha programada de la cita (TIMESTAMPTZ)
    let queryText = `
      SELECT id, provider_id, valor_bruto, comision_plataforma, impuestos_estado, pago_neto_prestador, scheduled_at
        FROM bookings
       WHERE provider_id = ANY($1::int[])
         AND estado IN ('COMPLETADA', 'FINALIZADA_PRESTADOR')
    `;
    const queryParams = [providerIds];

    if (startDate) {
      queryParams.push(startDate);
      queryText += ` AND scheduled_at >= $${queryParams.length}`;
    }
    if (endDate) {
      queryParams.push(endDate);
      queryText += ` AND scheduled_at <= $${queryParams.length}`;
    }

    const bookingsRes = await pool.query(queryText, queryParams);

    let totalBruto = 0;
    let totalComision = 0;
    let totalImpuestos = 0;
    let totalNetoPrestadores = 0;
    let totalCitas = bookingsRes.rows.length;

    // Estructuras para desglose
    const salonMetricsMap = new Map();
    for (const sId of targetSalonIds) {
      salonMetricsMap.set(sId, {
        salon_id: sId,
        ingresos_brutos: 0,
        comision_plataforma: 0,
        ingresos_netos_negocio: 0,
        pago_neto_prestadores: 0,
        total_citas: 0,
        sedes_compartidas: false,
      });
    }

    const providerMetricsMap = new Map();

    for (const row of bookingsRes.rows) {
      const pId = Number(row.provider_id);
      const bruto = Number(row.valor_bruto || 0);
      const comision = Number(row.comision_plataforma || 0);
      const impuestos = Number(row.impuestos_estado || 0);
      const netoPrestador = Number(row.pago_neto_prestador || 0);
      const netoNegocio = bruto - comision - impuestos;

      totalBruto += bruto;
      totalComision += comision;
      totalImpuestos += impuestos;
      totalNetoPrestadores += netoPrestador;

      // Métricas por prestador
      if (!providerMetricsMap.has(pId)) {
        providerMetricsMap.set(pId, {
          provider_id: pId,
          nombre: providerNames.get(pId) || `Prestador #${pId}`,
          ingresos_generados: 0,
          total_citas: 0,
        });
      }
      const pStats = providerMetricsMap.get(pId);
      pStats.ingresos_generados += bruto;
      pStats.total_citas += 1;

      // Desglose por sedes vinculadas al prestador (intra-propietario)
      const salonsForProvider = allProviderSalonMap.get(pId) || new Set();
      const isShared = salonsForProvider.size > 1;

      for (const sId of salonsForProvider) {
        if (salonMetricsMap.has(sId)) {
          const sStats = salonMetricsMap.get(sId);
          sStats.ingresos_brutos += bruto;
          sStats.comision_plataforma += comision;
          sStats.ingresos_netos_negocio += netoNegocio;
          sStats.pago_neto_prestadores += netoPrestador;
          sStats.total_citas += 1;
          if (isShared) sStats.sedes_compartidas = true;
        }
      }
    }

    const totalNetoNegocio = totalBruto - totalComision - totalImpuestos;

    const desglosePorSede = Array.from(salonMetricsMap.values());
    const topPrestadores = Array.from(providerMetricsMap.values())
      .sort((a, b) => b.ingresos_generados - a.ingresos_generados)
      .slice(0, 10);

    const metricsData = {
      ingresos_brutos: totalBruto,
      comision_plataforma: totalComision,
      impuestos_estado: totalImpuestos,
      ingresos_netos_negocio: totalNetoNegocio,
      pago_neto_prestadores: totalNetoPrestadores,
      total_citas: totalCitas,
      // sedes_compartidas = intra-propietario (el prestador labora en N sedes del MISMO dueño)
      sedes_compartidas: hasSharedProviders,
      // prestadores_cross_tenant / prestadores_multinegocio = pertenencia externa (el prestador labora en salones de OTRO dueño)
      prestadores_cross_tenant: hasCrossTenantProviders,
      prestadores_multinegocio: hasCrossTenantProviders,
      prestadores_externos: prestadoresExternos,
      desglose_por_sede: desglosePorSede,
      top_prestadores: topPrestadores,
    };

    if (hasCrossTenantProviders) {
      metricsData.advertencia =
        'Los totales pueden incluir reservas de salones ajenos cuando un prestador trabaja para varios negocios de distintos propietarios.';
    }

    res.json({
      success: true,
      metrics: metricsData,
    });
  } catch (error) {
    console.error('❌ ERROR GET DASHBOARD METRICS:', error.message);
    res.status(500).json({ error: 'Error al consultar las métricas del dashboard del propietario' });
  }
};
