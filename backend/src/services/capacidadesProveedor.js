'use strict';

/**
 * Capacidades del proveedor (D-GL-031, Modo Exploración).
 *
 * Único árbitro de "qué puede hacer esta cuenta". Ninguna ruta decide por su
 * cuenta con un `if` suelto: si mañana cambia una regla, cambia aquí y todas las
 * puertas quedan consistentes.
 *
 * Regla de negocio en una línea: en EXPLORACION todo lo que no mueva dinero ni
 * toque a un cliente real está permitido.
 */

const ESTADOS = Object.freeze({
  EXPLORACION: 'EXPLORACION',
  EN_VERIFICACION: 'EN_VERIFICACION',
  HABILITADO: 'HABILITADO',
  SUSPENDIDO: 'SUSPENDIDO',
});

/** Capacidades que el resto del backend puede exigir. */
const CAPACIDADES = Object.freeze({
  VER_DASHBOARD: 'VER_DASHBOARD',
  EDITAR_PERFIL: 'EDITAR_PERFIL',
  GESTIONAR_AGENDA: 'GESTIONAR_AGENDA',
  CREAR_SERVICIOS: 'CREAR_SERVICIOS',
  PUBLICAR_SERVICIOS: 'PUBLICAR_SERVICIOS',
  RECIBIR_RESERVAS: 'RECIBIR_RESERVAS',
  COBRAR: 'COBRAR',
  RETIRAR: 'RETIRAR',
  FACTURAR: 'FACTURAR',
  COMPRAR: 'COMPRAR',
  MENSAJERIA_CLIENTES: 'MENSAJERIA_CLIENTES',
  USAR_API: 'USAR_API',
});

// Lo que un explorador puede hacer. Todo lo que no esté aquí queda cerrado.
const PERMITIDAS_EN_EXPLORACION = Object.freeze([
  CAPACIDADES.VER_DASHBOARD,
  CAPACIDADES.EDITAR_PERFIL,
  CAPACIDADES.GESTIONAR_AGENDA,
  CAPACIDADES.CREAR_SERVICIOS,
]);

const ROLES_PROVEEDOR = Object.freeze(['PRESTADOR', 'SALON', 'PROVIDER']);

/**
 * Días de exploración activa (D-GL-031). Suficiente para enamorarse de la
 * herramienta, insuficiente para usarla como CRM gratis indefinidamente.
 */
const DIAS_EXPLORACION = 30;

/**
 * Días transcurridos desde `estado_operativo_desde`.
 * Sin fecha devuelve `null`: una cuenta sin marca de tiempo no se caduca, porque
 * castigar un dato faltante (backfills, filas viejas) sería un bug silencioso.
 */
function diasEnEstado(desde, ahora = new Date()) {
  if (!desde) return null;
  const inicio = desde instanceof Date ? desde : new Date(desde);
  if (Number.isNaN(inicio.getTime())) return null;
  const ms = ahora.getTime() - inicio.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function normalizarEstado(valor) {
  const estado = String(valor || '').toUpperCase();
  return ESTADOS[estado] ? estado : ESTADOS.EXPLORACION;
}

/**
 * Capacidades de la cuenta.
 *
 * @param {object} datos
 * @param {string} datos.estadoOperativo  EXPLORACION | EN_VERIFICACION | HABILITADO | SUSPENDIDO
 * @param {string} [datos.rol]
 * @returns {{estado: string, permitidas: string[], mapa: Record<string, boolean>, puede: (c: string) => boolean}}
 */
function calcularCapacidades({ estadoOperativo, rol, estadoDesde, ahora, diasExploracion } = {}) {
  const estado = normalizarEstado(estadoOperativo);
  const esProveedor = ROLES_PROVEEDOR.includes(String(rol || '').toUpperCase());
  const limite = Number.isFinite(Number(diasExploracion)) ? Number(diasExploracion) : DIAS_EXPLORACION;
  const dias = estado === ESTADOS.EXPLORACION ? diasEnEstado(estadoDesde, ahora) : null;
  const vencida = dias !== null && dias >= limite;

  // Sin rol de proveedor no hay nada que habilitar aquí: la autorización por rol
  // (RBAC) se resuelve en otro middleware.
  if (!esProveedor) {
    return {
      estado,
      vencida: false,
      dias_en_estado: dias,
      dias_restantes: null,
      permitidas: [],
      mapa: {},
      puede: () => false,
    };
  }

  // SUSPENDIDO no conserva escritura: sólo puede ver su cuenta. Exploración
  // vencida queda igual: lectura, hasta que verifique.
  const permitidas =
    estado === ESTADOS.HABILITADO
      ? Object.values(CAPACIDADES)
      : estado === ESTADOS.SUSPENDIDO || vencida
        ? [CAPACIDADES.VER_DASHBOARD]
        : PERMITIDAS_EN_EXPLORACION;

  const mapa = {};
  for (const capacidad of Object.values(CAPACIDADES)) {
    mapa[capacidad] = permitidas.includes(capacidad);
  }

  return {
    estado,
    vencida,
    dias_en_estado: dias,
    dias_restantes: dias === null ? null : Math.max(0, limite - dias),
    permitidas: [...permitidas],
    mapa,
    puede: (capacidad) => permitidas.includes(capacidad),
  };
}

/** Mensaje de bloqueo: siempre dice el siguiente paso, nunca un error seco. */
const MOTIVOS = Object.freeze({
  [ESTADOS.EXPLORACION]: {
    mensaje: 'Estás en Modo Exploración. Verifica tus documentos para cobrar y recibir reservas.',
    siguiente_paso: 'VERIFICAR_DOCUMENTOS',
  },
  [ESTADOS.EN_VERIFICACION]: {
    mensaje: 'Estamos revisando tus documentos. Te avisamos cuando quede habilitada la cuenta.',
    siguiente_paso: 'ESPERAR_REVISION',
  },
  [ESTADOS.SUSPENDIDO]: {
    mensaje: 'Tu cuenta está suspendida. Escríbenos para revisarla.',
    siguiente_paso: 'CONTACTAR_SOPORTE',
  },
});

/**
 * Motivo del bloqueo, con el siguiente paso siempre explícito.
 * La exploración vencida tiene su propio mensaje: "verifica" no es lo mismo que
 * "se te acabó el tiempo de prueba".
 */
function motivoBloqueo(estadoOperativo, { vencida = false } = {}) {
  const estado = normalizarEstado(estadoOperativo);
  if (vencida && estado === ESTADOS.EXPLORACION) {
    return {
      mensaje:
        'Tu periodo de exploración terminó. Verifica tus documentos para volver a editar tu negocio.',
      siguiente_paso: 'VERIFICAR_DOCUMENTOS',
    };
  }
  return MOTIVOS[estado] || null;
}

module.exports = {
  ESTADOS,
  CAPACIDADES,
  PERMITIDAS_EN_EXPLORACION,
  DIAS_EXPLORACION,
  diasEnEstado,
  calcularCapacidades,
  motivoBloqueo,
  normalizarEstado,
};
