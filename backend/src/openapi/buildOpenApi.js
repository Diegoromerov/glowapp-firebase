'use strict';

/**
 * backend/src/openapi/buildOpenApi.js
 *
 * Generador del contrato OpenAPI 3.0 de GlowApp.
 *
 * El documento se construye mezclando tres fuentes, en este orden de precedencia:
 *
 *   1. CRITICAL_OPERATIONS  (src/openapi/criticalContract.js)
 *      Contrato explícito de auth, booking, payment y admin: cuerpos, esquemas
 *      de respuesta y seguridad. Marca la operación como documentada.
 *
 *   2. Anotaciones `@swagger` de los routers (swagger-jsdoc).
 *      Mecanismo pre-existente del repo; se conserva y se le amplía el glob a
 *      `src/routes/**\/*.js` para que los routers de v1 también entren.
 *
 *   3. Inventario de rutas REALMENTE montadas (routeInventory.extractApiRoutes).
 *      Garantiza que ninguna operación montada quede fuera del documento: las que
 *      no tienen contrato entran como stub marcado `x-glowapp-documented: false`.
 *      Así la deriva es medible en vez de invisible.
 *
 * El documento resultante es DETERMINISTA: no incluye fechas, rutas absolutas ni
 * datos de entorno, de modo que el artefacto versionado se puede comparar byte a
 * byte con el regenerado (compuerta de deriva).
 */

const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const { extractApiRoutes, toOpenApiPath } = require('./routeInventory');
const { CRITICAL_OPERATIONS } = require('./criticalContract');

const BASE_DEFINITION = {
  openapi: '3.0.0',
  info: {
    title: 'GlowApp API',
    version: '1.0.0',
    description:
      'Contrato HTTP del backend de GlowApp. Artefacto GENERADO por ' +
      'backend/src/openapi/buildOpenApi.js — no editar a mano. ' +
      'Cada operación declara `x-glowapp-documented`: true cuando tiene contrato ' +
      'explícito (crítico o anotado con @swagger) y false cuando es un stub ' +
      'autodescubierto desde el router.',
  },
  servers: [
    { url: 'https://belleza-app-production.up.railway.app', description: 'Producción' },
    { url: 'http://localhost:8080', description: 'Desarrollo' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token JWT emitido por POST /api/auth/login o /api/auth/register.',
      },
    },
  },
};

const ROUTE_GLOBS = ['src/routes/*.js', 'src/routes/**/*.js'];

function toGlob(absPath) {
  return absPath.split(path.sep).join('/');
}

/**
 * Ejecuta swagger-jsdoc sobre los routers para recoger las anotaciones existentes.
 * Nunca lanza: si swagger-jsdoc falla, el contrato sigue siendo válido porque el
 * inventario de rutas cubre el 100% de las operaciones montadas.
 */
function collectAnnotatedSpec() {
  const routesDir = path.join(__dirname, '..', 'routes');
  try {
    return swaggerJsdoc({
      definition: { openapi: '3.0.0', info: BASE_DEFINITION.info },
      apis: ROUTE_GLOBS.map((g) => toGlob(path.join(routesDir, g.replace('src/routes/', '')))),
    });
  } catch (err) {
    return { paths: {} };
  }
}

function operationIdOf(method, openapiPath) {
  return (
    method.toLowerCase() +
    openapiPath
      .replace(/[{}]/g, ' ')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  );
}

function tagOf(openapiPath) {
  const segments = openapiPath.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  if (segments.length === 0) return 'general';
  if (segments[0] === 'v1' && segments[1]) return `v1-${segments[1]}`;
  return segments[0];
}

function pathParametersOf(openapiPath) {
  const names = [...openapiPath.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]);
  return names.map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
}

/**
 * Stub para una operación montada sin contrato declarado.
 * Deliberadamente NO inventa códigos de estado ni esquemas: solo deja constancia
 * de que la operación existe y no tiene contrato (`x-glowapp-documented: false`).
 */
function discoveredOperation(method, openapiPath) {
  return {
    summary: `${method} ${openapiPath} (autodescubierto, sin contrato declarado)`,
    operationId: operationIdOf(method, openapiPath),
    tags: [tagOf(openapiPath)],
    parameters: pathParametersOf(openapiPath),
    responses: {
      default: {
        description:
          'Sin contrato declarado. Operación descubierta en el router; añadir ' +
          'contrato explícito en criticalContract.js o con anotación @swagger.',
      },
    },
    'x-glowapp-documented': false,
  };
}

function documentedOperation(operation, extra) {
  return {
    ...operation,
    'x-glowapp-documented': true,
    ...extra,
  };
}

/**
 * Construye el documento OpenAPI a partir del app real.
 * @param {import('express').Express} app
 * @returns {object} documento OpenAPI 3.0
 */
function buildOpenApiDocument(app) {
  const annotated = collectAnnotatedSpec();
  const annotatedPaths = annotated.paths || {};
  const liveRoutes = extractApiRoutes(app);

  const paths = {};
  const extraComponents = annotated.components || {};
  let documentedCount = 0;
  let discoveredCount = 0;

  liveRoutes.forEach(({ method, path: expressPath }) => {
    const openapiPath = toOpenApiPath(expressPath);
    const verb = method.toLowerCase();
    const critical = CRITICAL_OPERATIONS[`${method} ${openapiPath}`];
    const annotatedOp =
      annotatedPaths[openapiPath] && annotatedPaths[openapiPath][verb]
        ? annotatedPaths[openapiPath][verb]
        : null;

    let operation;
    if (critical) {
      operation = documentedOperation(critical.operation, {
        'x-glowapp-critical': true,
        'x-glowapp-area': critical.area,
      });
    } else if (annotatedOp) {
      operation = documentedOperation(annotatedOp, { 'x-glowapp-critical': false });
    } else {
      operation = discoveredOperation(method, openapiPath);
    }

    if (operation['x-glowapp-documented']) documentedCount += 1;
    else discoveredCount += 1;

    if (!paths[openapiPath]) paths[openapiPath] = {};
    paths[openapiPath][verb] = operation;
  });

  // Rutas anotadas a mano que ya no están montadas: contrato obsoleto. Se
  // incluyen marcadas como huérfanas para que la compuerta lo pueda denunciar.
  Object.keys(annotatedPaths).forEach((annotatedPath) => {
    // El JSDoc del repo mezcla ambas notaciones ('/api/events/{id}' y
    // '/api/.../:id'): se normaliza a la notación OpenAPI antes de comparar.
    const openapiPath = toOpenApiPath(annotatedPath);
    const item = annotatedPaths[annotatedPath] || {};
    Object.keys(item).forEach((verb) => {
      const normalizedVerb = verb.toLowerCase();
      if (paths[openapiPath] && paths[openapiPath][normalizedVerb]) return; // ya montada
      if (!paths[openapiPath]) paths[openapiPath] = {};
      paths[openapiPath][normalizedVerb] = documentedOperation(item[verb], {
        'x-glowapp-orphan': true,
        'x-glowapp-critical': false,
      });
    });
  });

  return {
    ...BASE_DEFINITION,
    components: {
      ...BASE_DEFINITION.components,
      ...extraComponents,
      securitySchemes: {
        ...BASE_DEFINITION.components.securitySchemes,
        ...(extraComponents.securitySchemes || {}),
      },
    },
    paths,
    'x-glowapp-contract': {
      generator: 'backend/src/openapi/buildOpenApi.js',
      routesMounted: liveRoutes.length,
      operationsDocumented: documentedCount,
      operationsDiscovered: discoveredCount,
    },
  };
}

/**
 * Ordena recursivamente las claves de los objetos para que la serialización sea
 * estable entre ejecuciones y máquinas (la compuerta de deriva compara cadenas).
 */
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortDeep(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function serializeSpec(document) {
  return `${JSON.stringify(sortDeep(document), null, 2)}\n`;
}

module.exports = {
  BASE_DEFINITION,
  ROUTE_GLOBS,
  buildOpenApiDocument,
  serializeSpec,
  sortDeep,
};
