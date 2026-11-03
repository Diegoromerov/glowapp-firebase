const db = require('../config/db');

/**
 * Caché acotada de la comprobación de estado (CI-23 / ronda 7).
 * El candado no puede decidir con `pgAvailable === null` («nunca se comprobó») como si fuera sano:
 * provoca UNA comprobación y decide con el resultado. El TTL evita martillar la base en cada
 * petición y la promesa en vuelo evita comprobaciones simultáneas.
 */
const CHECK_TTL_MS = 5000;
let ultimaComprobacionMs = 0;
let comprobacionEnVuelo = null;

/**
 * Devuelve el estado de la base garantizando que, si nunca se comprobó, se compruebe ahora
 * (una vez por TTL). No inventa estado: si la comprobación falla o explota, devuelve lo que
 * `getDbStatus()` reporte en ese momento.
 *
 * @returns {Promise<Object>} el estado de la base, ya comprobado si era desconocido
 */
async function asegurarEstadoComprobado() {
  const dbStatus = db.getDbStatus();
  const desconocido = !!dbStatus && dbStatus.pgAvailable === null && dbStatus.servingFabricatedData !== true;
  if (!desconocido || typeof db.testConnection !== 'function') {
    return dbStatus;
  }

  if (comprobacionEnVuelo) {
    await comprobacionEnVuelo;
    return db.getDbStatus();
  }

  if (Date.now() - ultimaComprobacionMs < CHECK_TTL_MS) {
    return dbStatus;
  }

  comprobacionEnVuelo = (async () => {
    try {
      await db.testConnection();
    } catch (e) {
      // El resultado real queda en getDbStatus(); no se fabrica un estado aquí.
    } finally {
      ultimaComprobacionMs = Date.now();
      comprobacionEnVuelo = null;
    }
  })();

  await comprobacionEnVuelo;
  return db.getDbStatus();
}


/**
 * Allowlist explícita de rutas de API exentas del bloqueo automático 503 durante estado degradado.
 * 
 * REGLAS OBLIGATORIAS (C7):
 * 1. Cada entrada TIENE un motivo explícito documentado a su lado.
 * 2. PROHIBIDO usar prefijos comodín (ej: /api/*, /api/public/*).
 * 3. PROHIBIDO eximir cualquier ruta de dinero o identidad (C-01/C-02/C-03).
 */
const DEGRADED_ALLOWLIST = new Set([
  '/api/health',    // Motivo: Endpoint de salud del sistema que debe reportar el estado de degradación (503 DEGRADED) por sí mismo.
  '/api/providers', // Motivo: Endpoint de búsqueda de prestadores con manejo propio de degradación que responde 503 + PROVIDER_SEARCH_DEGRADED.
  '/api/test-db',   // Motivo: Endpoint de diagnóstico de conectividad SQL y versión de PostGIS.
]);

/**
 * MATRIZ DE DEGRADACIÓN POR DEPENDENCIA (hallazgo P0 — degradedLock.js:52).
 *
 * Antes: el candado decidía con UN único flag binario (pgAvailable / servingFabricatedData) y
 * bloqueaba el 100% de /api, sin importar QUÉ dependencia había caído. Una dependencia lateral
 * (RAG/pgvector, Redis, IA externa) tenía el mismo blast radius que una caída del PostgreSQL
 * transaccional, que es lo que este hallazgo tipifica.
 *
 * Ahora: cada dependencia declara su alcance y su comportamiento de degradación.
 *   - `alcanceGlobal: true`  ⇒ su caída afecta a toda superficie de datos /api (solo el core).
 *   - `alcanceGlobal: false` ⇒ su caída degrada SOLO las superficies que la consumen
 *     (familias de ruta), sin bloquear el resto del servicio.
 *   - `comportamiento` documenta qué se hace con esa capa al caer (bloquear o degradar función).
 *
 * Regla de honestidad (C7): una dependencia LATERAL nunca puede eximir ni abrir dinero/identidad;
 * solo el core degradado bloquea esas superficies, y lo sigue haciendo con 503.
 */
const DEPENDENCIAS_CONOCIDAS = ['database', 'rag', 'redis', 'ai'];

const MATRIZ_DEGRADACION_POR_DEPENDENCIA = {
  database: {
    descripcion: 'PostgreSQL transaccional (datos de negocio, dinero e identidad).',
    alcanceGlobal: true,
    familiasDeRuta: [],
    comportamiento: 'BLOQUEAR_503',
    httpStatus: 503,
    header: 'memory-fallback'
  },
  rag: {
    descripcion: 'PostgreSQL RAG / pgvector (recuperación semántica y conocimiento de negocio).',
    alcanceGlobal: false,
    familiasDeRuta: ['/api/v1/business', '/api/chat', '/api/nia-beauty', '/api/v1/beauty'],
    comportamiento: 'DEGRADAR_FUNCION',
    httpStatus: 200,
    header: 'rag-degraded'
  },
  redis: {
    descripcion: 'Redis (caché y rate limiting distribuido; degrada a memoria local).',
    alcanceGlobal: false,
    familiasDeRuta: [],
    comportamiento: 'DEGRADAR_FUNCION',
    httpStatus: 200,
    header: 'cache-degraded'
  },
  ai: {
    descripcion: 'Proveedores de IA externos (Gemini/DeepSeek/NVIDIA); cae a fallback determinista.',
    alcanceGlobal: false,
    familiasDeRuta: ['/api/chat', '/api/nia-beauty', '/api/v1/beauty'],
    comportamiento: 'AI_FALLBACK',
    httpStatus: 200,
    header: 'ai-fallback'
  }
};

/**
 * Normaliza el estado heterogéneo de la BD a un mapa de dependencias degradadas.
 * El core se deriva del flag binario vigente; las dependencias laterales se leen de
 * `dependencias` / `dependencies` cuando el productor de estado las expone.
 *
 * @param {Object} dbStatus
 * @returns {Object} p. ej. { database: false, rag: true, redis: false, ai: false } (true = degradada)
 */
function normalizarEstadoDependencias(dbStatus) {
  const estado = {};
  for (const id of DEPENDENCIAS_CONOCIDAS) estado[id] = false;
  if (!dbStatus || typeof dbStatus !== 'object') return estado;

  const isStrict =
    process.env.NODE_ENV === 'production' ||
    process.env.NODE_ENV === 'staging' ||
    Boolean(process.env.RAILWAY_ENVIRONMENT);

  const databaseBlocked =
    (dbStatus.pgAvailable === false || dbStatus.servingFabricatedData === true) &&
    (!dbStatus.memoryFallbackAllowed || isStrict);

  if (databaseBlocked) {
    estado.database = true;
  }

  const extra = dbStatus.dependencias || dbStatus.dependencies;
  if (extra && typeof extra === 'object') {
    for (const id of DEPENDENCIAS_CONOCIDAS) {
      if (id === 'database') continue;
      if (extra[id] === true) estado[id] = true;
    }
  }

  return estado;
}

/**
 * Evalúa de forma pura el estado de dependencias y separa el bloqueo global del alcance lateral.
 *
 * @param {Object} estadoDependencias - mapa { id: boolean } (true = degradada)
 * @returns {{ bloqueoGlobal: boolean, dependenciasDegradadas: string[], dependenciasGlobales: string[], dependenciasScoped: string[] }}
 */
function evaluarDegradacionPorDependencia(estadoDependencias) {
  const estado = estadoDependencias || {};
  const dependenciasDegradadas = DEPENDENCIAS_CONOCIDAS.filter((id) => estado[id] === true);
  const dependenciasGlobales = dependenciasDegradadas.filter(
    (id) => MATRIZ_DEGRADACION_POR_DEPENDENCIA[id] && MATRIZ_DEGRADACION_POR_DEPENDENCIA[id].alcanceGlobal === true
  );
  const dependenciasScoped = dependenciasDegradadas.filter(
    (id) => MATRIZ_DEGRADACION_POR_DEPENDENCIA[id] && MATRIZ_DEGRADACION_POR_DEPENDENCIA[id].alcanceGlobal !== true
  );

  return { bloqueoGlobal: dependenciasGlobales.length > 0, dependenciasDegradadas, dependenciasGlobales, dependenciasScoped };
}

/**
 * Dependencias laterales (no globales) que consume una ruta, según las familias de la matriz.
 * Devuelve [] para rutas sin dependencia lateral (incluidas dinero/identidad: solo dependen del core).
 *
 * @param {string} reqPath - path completo sin query
 * @returns {string[]}
 */
function dependenciasDeRuta(reqPath) {
  const path = String(reqPath || '').split('?')[0];
  return DEPENDENCIAS_CONOCIDAS.filter((id) => {
    const def = MATRIZ_DEGRADACION_POR_DEPENDENCIA[id];
    if (!def || def.alcanceGlobal === true) return false;
    return def.familiasDeRuta.some((prefijo) => path === prefijo || path.startsWith(prefijo + '/'));
  });
}

/**
 * Decide de forma pura la degradación de UNA ruta a partir del estado de dependencias.
 * Conserva el bloqueo global cuando el core cae; si no, degrada solo las superficies laterales afectadas.
 *
 * @param {string} reqPath
 * @param {Object} estadoDependencias
 * @returns {{ bloqueada: boolean, degradada: boolean, header: (string|null), httpStatus: number, dependencias: string[] }}
 */
function decidirDegradacionDeRuta(reqPath, estadoDependencias) {
  const evaluacion = evaluarDegradacionPorDependencia(estadoDependencias);
  if (evaluacion.bloqueoGlobal) {
    const core = MATRIZ_DEGRADACION_POR_DEPENDENCIA.database;
    return { bloqueada: true, degradada: true, header: core.header, httpStatus: core.httpStatus, dependencias: evaluacion.dependenciasDegradadas };
  }

  const depsRuta = dependenciasDeRuta(reqPath);
  const degradadasRuta = depsRuta.filter((id) => estadoDependencias && estadoDependencias[id] === true);
  const def = degradadasRuta.length > 0 ? MATRIZ_DEGRADACION_POR_DEPENDENCIA[degradadasRuta[0]] : null;

  return {
    bloqueada: false,
    degradada: degradadasRuta.length > 0,
    header: def ? def.header : null,
    httpStatus: def ? def.httpStatus : 200,
    dependencias: degradadasRuta
  };
}


/**
 * Clasifica de forma pura el estado de salud de la base de datos sin mentir.
 * 
 * @param {Object} dbStatus - Objeto devuelto por getDbStatus()
 * @returns {{ status: string, message: string, httpStatus: number, degradado: boolean }}
 */
function clasificarSalud(dbStatus) {
  if (!dbStatus) {
    return { status: 'UNKNOWN', message: 'Estado de base de datos no disponible', httpStatus: 200, degradado: false };
  }

  // Estado sin comprobar (indefinido / null): NO es DEGRADED, es CHECKING / UNKNOWN con HTTP 200
  if (dbStatus.pgAvailable === null && !dbStatus.servingFabricatedData) {
    return { status: 'UNKNOWN', message: 'Backend con estado de base de datos sin comprobar', httpStatus: 200, degradado: false };
  }

  // Estado degradado real: pgAvailable === false o servingFabricatedData === true
  const degradado = dbStatus.servingFabricatedData === true || dbStatus.pgAvailable === false;
  if (degradado) {
    return { status: 'DEGRADED', message: 'Backend con capa de datos degradada', httpStatus: 503, degradado: true };
  }

  return { status: 'OK', message: 'Backend funcionando', httpStatus: 200, degradado: false };
}

/**
 * Decide de forma pura si el candado debe bloquear una petición según el estado de la BD.
 * 
 * @param {Object} dbStatus - Objeto devuelto por getDbStatus()
 * @returns {{ shouldBlock: boolean, reason: string, httpStatus?: number, header?: string }}
 */
function decidirBloqueo(dbStatus) {
  if (!dbStatus) {
    return { shouldBlock: false, reason: 'NO_STATUS' };
  }

  // Si la BD está sin comprobar (pgAvailable === null) y no se fabrican datos, NO se bloquea por flag rancio.
  if (dbStatus.pgAvailable === null && !dbStatus.servingFabricatedData) {
    return { shouldBlock: false, reason: 'UNCHECKED' };
  }

  const isDegraded = dbStatus.servingFabricatedData === true || dbStatus.pgAvailable === false;
  if (isDegraded) {
    if (dbStatus.memoryFallbackAllowed && process.env.NODE_ENV !== 'production') {
      return { shouldBlock: false, reason: 'MEMORY_FALLBACK_ALLOWED' };
    }
    return { shouldBlock: true, reason: 'DEGRADED_DB', httpStatus: 503, header: 'memory-fallback' };
  }

  return { shouldBlock: false, reason: 'HEALTHY' };
}

/**
 * Middleware para bloquear todas las rutas bajo /api cuando la capa de datos está degradada.
 * Garantiza que ninguna superficie de datos engañe al cliente con HTTP 200 y datos en memoria/fabricados.
 * Alcance real: todas las rutas bajo /api, incluyendo explícitamente dinero (C-02) e identidad (C-01).
 * Razón de negocio: el webhook de Wompi recibe 503 y la pasarela reintenta; es preferible a procesar dinero o identidad contra datos fabricados.
 */
async function degradedLockMiddleware(req, res, next) {
  let dbStatus;
  try {
    dbStatus = await asegurarEstadoComprobado();
  } catch (e) {
    dbStatus = db.getDbStatus();
  }
  const decision = decidirBloqueo(dbStatus);

  // Extraer el path completo de la URL sin query parameters
  const rawUrl = req.originalUrl || req.url || '';
  const reqPath = rawUrl.split('?')[0];

  const estadoDependencias = normalizarEstadoDependencias(dbStatus);
  const evaluacion = evaluarDegradacionPorDependencia(estadoDependencias);

  // Bloqueo global: dependencia core degradada (o el flag binario vigente). Blast radius 100% honesto.
  if (decision.shouldBlock || evaluacion.bloqueoGlobal) {
    // Si la ruta está en la allowlist motivada, permitir que su propio controller procese y responda
    if (DEGRADED_ALLOWLIST.has(reqPath)) {
      return next();
    }

    // Para cualquier otra superficie de datos bajo /api: bloquear con 503 y declarar la degradación
    res.setHeader('X-GlowApp-Degraded', decision.header || MATRIZ_DEGRADACION_POR_DEPENDENCIA.database.header);
    return res.status(decision.httpStatus || MATRIZ_DEGRADACION_POR_DEPENDENCIA.database.httpStatus).json({
      success: false,
      error: 'DATA_LAYER_DEGRADED',
      message: 'Servicio no disponible en modo degradado sin conexión a la base de datos'
    });
  }

  // Core sano: aplicar la matriz por dependencia. Una dependencia lateral caída degrada SOLO
  // las superficies que la consumen; no bloquea el resto del servicio (blast radius acotado).
  const degradacionRuta = decidirDegradacionDeRuta(reqPath, estadoDependencias);
  if (degradacionRuta.degradada && degradacionRuta.header) {
    res.setHeader('X-GlowApp-Degraded', degradacionRuta.header);
  }
  return next();
}

module.exports = {
  DEGRADED_ALLOWLIST,
  MATRIZ_DEGRADACION_POR_DEPENDENCIA,
  DEPENDENCIAS_CONOCIDAS,
  degradedLockMiddleware,
  clasificarSalud,
  decidirBloqueo,
  normalizarEstadoDependencias,
  evaluarDegradacionPorDependencia,
  dependenciasDeRuta,
  decidirDegradacionDeRuta,
  asegurarEstadoComprobado
};
