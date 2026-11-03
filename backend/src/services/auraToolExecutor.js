// backend/src/services/auraToolExecutor.js
const atenaAgent = require('./agents/atenaAgent');
const hermesAgent = require('./agents/hermesAgent');
const chronosAgent = require('./agents/chronosAgent');
const hestiaAgent = require('./agents/hestiaAgent');
const valkyrieAgent = require('./agents/valkyrieAgent');
const { searchBeautyKnowledge } = require('./ragService');
const { checkConsent, logAccess } = require('./consentService');
const businessDiagnosticService = require('./businessDiagnosticService');
const businessWorkflowService = require('./businessWorkflowService');
const businessRequirementService = require('./businessRequirementService');
const businessRepository = require('../repositories/businessRepository');
const { KNOWLEDGE_CATEGORIES } = require('../config/knowledgeCategories');
const { pool } = require('../config/db');

/**
 * Etiquetas REALES del enum `estado_cita` de PostgreSQL.
 * Comparar contra un valor que no exista en el enum aborta la consulta completa con
 * `invalid input value for enum estado_cita: "FINALIZADA"`, aunque ese valor solo
 * aparezca dentro de un CASE WHEN. Por eso todas las comparaciones usan
 * `estado::text IN (...)` y estas listas.
 */
const ESTADOS_CITA = {
  ejecutadas: ['COMPLETADA', 'FINALIZADA_PRESTADOR'],
  confirmadas: ['CONFIRMADA', 'EN_PROGRESO'],
  pendientes: ['PENDIENTE_PAGO', 'ESPERANDO_OTP', 'CHECKIN_REALIZADO'],
  canceladas: ['CANCELADA'],
};

/** Lista de labels lista para un `IN (...)` de SQL. */
const sqlIn = (labels) => `(${labels.map((l) => `'${l}'`).join(', ')})`;

/**
 * Definicón de JSON Schemas de las herramientas (Tool Definitions) para DeepSeek / Gemini Function Calling
 */
const AURA_TOOLS_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'query_user_biometric_profile',
      description: 'Invoca a ATENA para obtener el perfil biométrico del usuario (diagnóstico facial, manos, subtono de piel y paleta de colorimetría).',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'number', description: 'ID numérico del usuario' }
        },
        required: ['userId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_nearby_services',
      description: 'Invoca a HERMES para buscar servicios y prestadores de belleza cercanos a la ubicación geográfica usando PostGIS.',
      parameters: {
        type: 'object',
        properties: {
          latitude: { type: 'number', description: 'Latitud (ej. 4.6097 en Bogotá)' },
          longitude: { type: 'number', description: 'Longitud (ej. -74.0817 en Bogotá)' },
          category: { type: 'string', description: 'Categoría opcional (ej. Uñas, Cabello, Piel, Cejas)' },
          maxDistanceKm: { type: 'number', description: 'Radio máximo en kilómetros (por defecto 5)' }
        },
        required: ['latitude', 'longitude']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_provider_availability',
      description: 'Invoca a HERMES para verificar la disponibilidad de agenda de un prestador evitando colisiones.',
      parameters: {
        type: 'object',
        properties: {
          providerId: { type: 'number', description: 'ID del prestador' },
          serviceId: { type: 'string', description: 'ID o UUID del servicio' },
          date: { type: 'string', description: 'Fecha sugerida en formato YYYY-MM-DD' }
        },
        required: ['providerId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'evaluate_user_rebooking',
      description: 'Invoca a CHRONOS para evaluar si el usuario tiene tratamientos que vencieron o requieren agendamiento de mantenimiento.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'number', description: 'ID numérico del usuario' }
        },
        required: ['userId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'recommend_glowstore_products',
      description: 'Invoca a HESTIA para recomendar productos de la tienda GlowStore compatibles con la piel o necesidad del usuario.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'number', description: 'ID opcional del usuario para personalización' },
          queryText: { type: 'string', description: 'Término de búsqueda de producto' },
          category: { type: 'string', description: 'Categoría del producto (ej. Piel, Uñas, Cabello)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_provider_b2b_insights',
      description: 'Invoca a VALKYRIE para generar inteligencia de negocios, ocupación de horas muertas y descuentos dinámicos para un prestador.',
      parameters: {
        type: 'object',
        properties: {
          providerId: { type: 'number', description: 'ID numérico del prestador' }
        },
        required: ['providerId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_beauty_knowledge_rag',
      description: 'Busca información técnica sobre rutinas cosméticas, ingredientes, compatibilidad de piel y cuidado en casa en la base de conocimiento.',
      parameters: {
        type: 'object',
        properties: {
          queryText: { type: 'string', description: 'Consulta del usuario sobre rutina o producto' },
          category: {
            type: 'string',
            description: 'Categoría del conocimiento. Usar SOLO uno de estos valores; omitir el campo si ninguno aplica.',
            enum: KNOWLEDGE_CATEGORIES,
          }
        },
        required: ['queryText']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'trigger_ui_redirection',
      description: 'Genera una redirección visual en la aplicación Flutter al Módulo de Ideas o herramientas específicas de visajismo.',
      parameters: {
        type: 'object',
        properties: {
          moduleKey: {
            type: 'string',
            enum: ['nails-classic', 'skin-tone', 'hair-diagnostic', 'skin-texture', 'eyebrow-visagism', 'nails-style'],
            description: 'Clave del módulo gráfico al cual redirigir'
          }
        },
        required: ['moduleKey']
      }
    }
  },
  // ── BUSINESS READ-ONLY TOOLS (GOAL 05 — PHASE E) ──
  {
    type: 'function',
    function: {
      name: 'get_business_profile_summary',
      description: 'Consulta de solo lectura del resumen de expediente, puntaje de cumplimiento normativo y tareas para el prestador autenticado.',
      parameters: {
        type: 'object',
        properties: {
          providerId: { type: 'string', description: 'ID del prestador autenticado (extraído de JWT)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_business_tasks',
      description: 'Consulta de solo lectura del listado de tareas de formalización, bioseguridad y SST para el negocio del prestador.',
      parameters: {
        type: 'object',
        properties: {
          providerId: { type: 'string', description: 'ID del prestador' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_regulatory_knowledge_rag',
      description: 'Busca regulaciones sanitarias, laborales, bioseguridad (RH1) y decretos aplicables a establecimientos de belleza en Colombia.',
      parameters: {
        type: 'object',
        properties: {
          queryText: { type: 'string', description: 'Consulta sobre normatividad (ej. concepto sanitario, manual bioseguridad)' },
          jurisdiction: { type: 'string', description: 'Jurisdicción opcional (NATIONAL, MUNICIPAL)' }
        },
        required: ['queryText']
      }
    }
  },
  // ── PROVIDER & SALON AGGREGATIONS & OPERATIONAL TOOLS ──
  {
    type: 'function',
    function: {
      name: 'get_provider_appointments',
      description: 'Consulta citas y reservas del prestador o salón autenticado. Devuelve el total EXACTO en base, el desglose por estado y una muestra de las citas; para responder cuántas hay, usa totalAppointments (la lista es parcial).',
      parameters: {
        type: 'object',
        properties: {
          timeRange: {
            type: 'string',
            enum: ['all', 'today', 'this_week', 'this_month', 'upcoming'],
            description: 'Rango temporal a consultar (por defecto this_month)'
          },
          status: {
            type: 'string',
            enum: ['all', 'pending', 'confirmed', 'completed', 'cancelled'],
            description: 'Filtro por estado de la cita'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_provider_financial_metrics',
      description: 'Calcula métricas financieras y facturación del prestador o salón autenticado (ingresos brutos, netos, desglose de IVA y comisiones) para un rango como este mes.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['this_month', 'last_month', 'this_week', 'all_time'],
            description: 'Periodo de cálculo financiero (por defecto this_month)'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_salon_operational_summary',
      description: 'Obtiene el resumen operacional de la sede o salón administrado por el usuario (número de profesionales/miembros en equipo, citas globales e información del salón).',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  }
];

/**
 * Orquesta y ejecuta las herramientas delegando en Agentes y Servicios de GlowApp
 */
async function executeAuraTool(toolName, args, userId, userRole = 'provider', tenantId = null) {
  console.log(`🛠️ [AURA Orchestration] Ejecutando herramienta: ${toolName}, Args:`, args);

  // Verificación de consentimiento para herramientas biométricas
  const BIOMETRIC_TOOLS = ['query_user_biometric_profile'];
  const BIOMETRIC_SENSITIVE_TOOLS = ['query_user_biometric_profile', 'recommend_glowstore_products'];

  if (BIOMETRIC_SENSITIVE_TOOLS.includes(toolName)) {
    const targetUserId = args.userId || userId;
    if (String(targetUserId) !== String(userId)) {
      return { 
        error: 'ownership_required', 
        message: 'No tienes permisos para acceder a los datos biométricos de otro usuario.' 
      };
    }
  }

  if (BIOMETRIC_TOOLS.includes(toolName)) {
    const targetUserId = args.userId || userId;
    const consent = await checkConsent(targetUserId, 'all_biometric');
    
    if (!consent.granted) {
      await logAccess({
        userId: targetUserId,
        accessedBy: 'ATENA',
        accessType: 'attempt_biometric_profile',
        ip: null,
        details: { toolName, requiredConsent: 'all_biometric' }
      });
      
      return { 
        error: 'consent_required', 
        message: 'No tienes consentimiento biométrico activo. Por favor otórgalo en Configuración > Privacidad > Datos Biométricos.' 
      };
    }

    await logAccess({
      userId: targetUserId,
      accessedBy: 'ATENA',
      accessType: 'read_biometric_profile',
      ip: null,
      details: { toolName }
    });
  }

  try {
    switch (toolName) {
      case 'query_user_biometric_profile': {
        const targetUserId = args.userId || userId;
        return await atenaAgent.getBiometricDiagnosis(targetUserId);
      }

      case 'search_nearby_services': {
        return await hermesAgent.findNearbyServices({
          latitude: args.latitude,
          longitude: args.longitude,
          category: args.category,
          maxDistanceKm: args.maxDistanceKm
        });
      }

      case 'check_provider_availability': {
        return await hermesAgent.checkAvailability({
          providerId: args.providerId,
          serviceId: args.serviceId,
          date: args.date
        });
      }

      case 'evaluate_user_rebooking': {
        const targetUserId = args.userId || userId;
        return await chronosAgent.evaluateUserRebooking(targetUserId);
      }

      case 'recommend_glowstore_products': {
        return await hestiaAgent.recommendProducts({
          userId: args.userId || userId,
          queryText: args.queryText,
          category: args.category
        });
      }

      case 'get_provider_b2b_insights': {
        return await valkyrieAgent.getProviderInsights({
          providerId: args.providerId
        });
      }

      case 'search_beauty_knowledge_rag': {
        // ragService lee la categoría en `filters.category` y la valida contra el
        // vocabulario canónico (config/knowledgeCategories): si el valor no existe en el
        // corpus NO se filtra (fail-open) y queda registrado en la traza, en vez de
        // devolver 0 chunks en silencio. El enum del tool ya expone los valores válidos.
        // tenantId se propaga para el aislamiento multi-tenant.
        const results = await searchBeautyKnowledge(args.queryText, {
          filters: args.category ? { category: args.category } : {},
          tenantId
        });
        return { status: 'success', knowledge: results };
      }

      case 'trigger_ui_redirection': {
        return {
          status: 'success',
          redirectionTag: `Redirección Módulo Ideas: ${args.moduleKey}`
        };
      }

      // ── BUSINESS READ-ONLY TOOLS EXECUTION ──
      case 'get_business_profile_summary': {
        const targetProviderId = String(userId);
        const summary = await businessDiagnosticService.getProfileSummary(targetProviderId, tenantId);
        if (!summary) {
          return { status: 'not_found', message: 'No se encontró expediente de negocio para este usuario.' };
        }
        return { status: 'success', summary };
      }

      case 'get_business_tasks': {
        const targetProviderId = String(userId);
        const tasks = await businessWorkflowService.getTasksForProvider(targetProviderId, tenantId);
        return { status: 'success', tasksCount: tasks.length, tasks };
      }

      case 'search_regulatory_knowledge_rag': {
        // ATENCIÓN (auditoría 2026-09-22): el corpus canónico de `beauty_knowledge_embeddings`
        // NO contiene documentos regulatorios (0 chunks con 'business'/'resolucion'/'formalizacion';
        // 2 con 'invima'), así que esta búsqueda devuelve vacío por FALTA DE DATOS, no por el
        // filtro. El filtro `domain` ya no apunta a una clave inexistente
        // (`metadata->>'domain'` no existe en ningún chunk): ahora compara contra la categoría
        // canónica y `metadata->'applicable_modules'`. Cargar el corpus regulatorio es una
        // decisión de datos pendiente (PLAN_MEJORA_RAG.md, Fase 4).
        const results = await searchBeautyKnowledge(args.queryText, {
          filters: { domain: 'BUSINESS', jurisdiction: args.jurisdiction },
          tenantId
        });
        return { status: 'success', domain: 'REGULATORY', knowledge: results };
      }

      // ── OPERATIONAL & FINANCIAL TOOLS (PRESTADOR / SALÓN) ──
      case 'get_provider_appointments': {
        const parsedUserId = parseInt(userId, 10);
        if (isNaN(parsedUserId)) {
          return { status: 'error', message: 'Identificador de usuario inválido.' };
        }

        const timeRange = args.timeRange || 'this_month';
        const statusFilter = args.status || 'all';

        let dateCondition = '';
        if (timeRange === 'today') {
          dateCondition = "AND (scheduled_at >= CURRENT_DATE AND scheduled_at < CURRENT_DATE + INTERVAL '1 day')";
        } else if (timeRange === 'this_week') {
          dateCondition = "AND scheduled_at >= DATE_TRUNC('week', CURRENT_DATE) AND scheduled_at < DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '1 week'";
        } else if (timeRange === 'this_month') {
          dateCondition = "AND scheduled_at >= DATE_TRUNC('month', CURRENT_DATE) AND scheduled_at < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'";
        } else if (timeRange === 'upcoming') {
          dateCondition = "AND scheduled_at >= NOW()";
        }

        let statusCondition = '';
        if (statusFilter === 'pending') {
          statusCondition = `AND estado::text IN ${sqlIn([...ESTADOS_CITA.pendientes, ...ESTADOS_CITA.confirmadas])}`;
        } else if (statusFilter === 'confirmed') {
          statusCondition = `AND estado::text IN ${sqlIn(ESTADOS_CITA.confirmadas)}`;
        } else if (statusFilter === 'completed') {
          statusCondition = `AND estado::text IN ${sqlIn(ESTADOS_CITA.ejecutadas)}`;
        } else if (statusFilter === 'cancelled') {
          statusCondition = `AND estado::text IN ${sqlIn(ESTADOS_CITA.canceladas)}`;
        }

        // Filtro compartido por el conteo y la muestra: si divergen, el total miente.
        const scopeCondition = `(b.provider_id = $1 OR b.business_profile_id = (
            SELECT id::text FROM business_profiles WHERE provider_id = $1 LIMIT 1
          ))
          ${dateCondition}
          ${statusCondition}`;

        // Conteo EXACTO en base. Antes se contaban las filas devueltas con LIMIT 50,
        // así que un mes con más de 50 citas se reportaba como "50" sin avisar.
        const countQuery = `
          SELECT b.estado, count(*)::int AS total
          FROM bookings b
          WHERE ${scopeCondition}
          GROUP BY b.estado;
        `;
        const countRes = await pool.query(countQuery, [parsedUserId]);

        const countsByStatus = {};
        let totalAppointments = 0;
        for (const row of countRes.rows || []) {
          const estado = row.estado || 'DESCONOCIDO';
          const n = Number(row.total) || 0;
          countsByStatus[estado] = n;
          totalAppointments += n;
        }

        // Muestra acotada solo para dar contexto (cliente, servicio, fecha).
        const PREVIEW_LIMIT = 20;
        const previewQuery = `
          SELECT 
            b.id,
            b.scheduled_at,
            b.estado,
            b.valor_bruto,
            b.pago_neto_prestador,
            b.service_address,
            u.nombre as client_name,
            s.name as service_name
          FROM bookings b
          LEFT JOIN usuarios u ON u.id = b.client_id
          LEFT JOIN services s ON s.id = b.service_id
          WHERE ${scopeCondition}
          ORDER BY b.scheduled_at ASC
          LIMIT ${PREVIEW_LIMIT};
        `;
        const previewRes = await pool.query(previewQuery, [parsedUserId]);
        const appointments = previewRes.rows || [];

        return {
          status: 'success',
          timeRange,
          filterStatus: statusFilter,
          totalAppointments,
          breakdownByStatus: countsByStatus,
          previewLimit: PREVIEW_LIMIT,
          previewReturned: appointments.length,
          truncated: totalAppointments > appointments.length,
          countingNote: 'totalAppointments y breakdownByStatus son el conteo exacto en base. La lista appointments es una muestra; NO la cuentes para responder cuántas citas hay.',
          appointments: appointments.map(apt => ({
            id: apt.id,
            fecha: apt.scheduled_at,
            estado: apt.estado,
            cliente: apt.client_name || 'Cliente GlowApp',
            servicio: apt.service_name || 'Servicio de Belleza',
            monto: apt.valor_bruto,
            direccion: apt.service_address
          }))
        };
      }

      case 'get_provider_financial_metrics': {
        const parsedUserId = parseInt(userId, 10);
        if (isNaN(parsedUserId)) {
          return { status: 'error', message: 'Identificador de usuario inválido.' };
        }

        const period = args.period || 'this_month';
        let dateCondition = "AND scheduled_at >= DATE_TRUNC('month', CURRENT_DATE) AND scheduled_at < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'";

        if (period === 'last_month') {
          dateCondition = "AND scheduled_at >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AND scheduled_at < DATE_TRUNC('month', CURRENT_DATE)";
        } else if (period === 'this_week') {
          dateCondition = "AND scheduled_at >= DATE_TRUNC('week', CURRENT_DATE) AND scheduled_at < DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '1 week'";
        } else if (period === 'all_time') {
          dateCondition = "";
        }

        const query = `
          SELECT 
            COUNT(id) as total_citas,
            COALESCE(SUM(CASE WHEN estado::text IN ${sqlIn(ESTADOS_CITA.ejecutadas)} THEN valor_bruto ELSE 0 END), 0) as facturacion_bruta,
            COALESCE(SUM(CASE WHEN estado::text IN ${sqlIn(ESTADOS_CITA.confirmadas)} THEN valor_bruto ELSE 0 END), 0) as facturacion_confirmada,
            COALESCE(SUM(CASE WHEN estado::text IN ${sqlIn(ESTADOS_CITA.ejecutadas)} THEN pago_neto_prestador ELSE 0 END), 0) as ingreso_neto_prestador,
            COALESCE(SUM(CASE WHEN estado::text IN ${sqlIn(ESTADOS_CITA.ejecutadas)} THEN subtotal_base ELSE 0 END), 0) as total_subtotal_base,
            COALESCE(SUM(CASE WHEN estado::text IN ${sqlIn(ESTADOS_CITA.ejecutadas)} THEN iva_valor ELSE 0 END), 0) as total_iva_recaudado,
            COUNT(CASE WHEN estado::text IN ${sqlIn(ESTADOS_CITA.ejecutadas)} THEN 1 END) as citas_ejecutadas,
            COUNT(CASE WHEN estado::text IN ${sqlIn(ESTADOS_CITA.canceladas)} THEN 1 END) as citas_canceladas,
            COUNT(CASE WHEN estado::text IN ${sqlIn([...ESTADOS_CITA.pendientes, ...ESTADOS_CITA.confirmadas])} THEN 1 END) as citas_pendientes
          FROM bookings
          WHERE (provider_id = $1 OR business_profile_id = (
            SELECT id::text FROM business_profiles WHERE provider_id = $1 LIMIT 1
          ))
          ${dateCondition};
        `;

        const res = await pool.query(query, [parsedUserId]);
        const metrics = res.rows?.[0] || {};

        return {
          status: 'success',
          period,
          facturacion_bruta: parseFloat(metrics.facturacion_bruta || 0),
          facturacion_confirmada: parseFloat(metrics.facturacion_confirmada || 0),
          ingreso_neto_prestador: parseFloat(metrics.ingreso_neto_prestador || 0),
          subtotal_base: parseFloat(metrics.total_subtotal_base || 0),
          iva_recaudado: parseFloat(metrics.total_iva_recaudado || 0),
          resumen_citas: {
            total: parseInt(metrics.total_citas || 0, 10),
            ejecutadas: parseInt(metrics.citas_ejecutadas || 0, 10),
            pendientes: parseInt(metrics.citas_pendientes || 0, 10),
            canceladas: parseInt(metrics.citas_canceladas || 0, 10)
          }
        };
      }

      case 'get_salon_operational_summary': {
        const parsedUserId = parseInt(userId, 10);
        if (isNaN(parsedUserId)) {
          return { status: 'error', message: 'Identificador de usuario inválido.' };
        }

        const salonQuery = `
          SELECT 
            s.id,
            s.nombre_salon,
            s.direccion,
            s.ciudad,
            s.plan_saas,
            (SELECT COUNT(*) FROM memberships m
              JOIN business_profiles bp ON bp.id = m.business_profile_id
             WHERE bp.id = left('salon-' || s.id::text, 36) AND m.status = 'ACTIVE') as total_profesionales,
            (SELECT COUNT(*) FROM bookings b WHERE b.provider_id IN (
               SELECT m2.user_id FROM memberships m2
                 JOIN business_profiles bp2 ON bp2.id = m2.business_profile_id
                WHERE bp2.id = left('salon-' || s.id::text, 36) AND m2.status = 'ACTIVE'
             ) AND b.scheduled_at >= DATE_TRUNC('month', CURRENT_DATE)) as total_citas_mes
          FROM salones s
          WHERE s.id_dueno = $1
          LIMIT 1;
        `;

        const res = await pool.query(salonQuery, [parsedUserId]);
        if (!res.rows || res.rows.length === 0) {
          return {
            status: 'not_found',
            message: 'No se encontró un salón o sede registrado para este usuario administrador.'
          };
        }

        const salon = res.rows[0];
        return {
          status: 'success',
          salon: {
            id: salon.id,
            nombre: salon.nombre_salon,
            direccion: salon.direccion,
            ciudad: salon.ciudad,
            plan: salon.plan_saas,
            equipo_profesionales: parseInt(salon.total_profesionales || 0, 10),
            citas_este_mes: parseInt(salon.total_citas_mes || 0, 10)
          }
        };
      }

      default:
        return { error: `Herramienta desconocida o no autorizada: ${toolName}` };
    }
  } catch (error) {
    console.error(`❌ Error ejecutando herramienta AURA (${toolName}):`, error.message);
    return { error: `Error interno al ejecutar la herramienta ${toolName}: ${error.message}` };
  }
}

module.exports = {
  AURA_TOOLS_DEFINITIONS,
  executeAuraTool
};
