'use strict';

/**
 * backend/src/openapi/criticalContract.js
 *
 * Contrato explícito (OpenAPI 3.0) de las operaciones CRÍTICAS del backend y las
 * expectativas de comportamiento que las acompañan.
 *
 * Por qué existe este archivo y no solo JSDoc en cada router:
 *   1. Los 4 routers críticos (auth, booking, payment, admin) tienen cientos de
 *      líneas; el contrato en un módulo único es auditable y revisable de una vez.
 *   2. El generador (buildOpenApi.js) lo inyecta en el artefacto OpenAPI, y el
 *      test de contrato exige que TODAS estas operaciones estén documentadas de
 *      verdad (x-glowapp-documented = true), no como stub autodescubierto.
 *   3. Si una ruta crítica cambia de método o de ruta en el código, la compuerta
 *      de deriva falla: la clave no coincidirá con ninguna operación montada
 *      (absentCritical en verifySpecAgainstApp.js).
 *
 * Alcance: auth, booking, payment, admin (los cuatro del hallazgo FIX-FLUTTER-09).
 */

const BEARER = [{ bearerAuth: [] }];

const jsonBody = (schema) => ({
  required: true,
  content: { 'application/json': { schema } },
});

/**
 * CLAVES = 'MÉTODO /ruta/en/formato/{param}' — el mismo formato que usan
 * routeInventory.toOpenApiPath() y verifySpecAgainstApp.compareSpecToApp().
 */
const CRITICAL_OPERATIONS = {
  'POST /api/auth/register': {
    area: 'auth',
    operation: {
      summary: 'Registro de usuario con email y contraseña',
      operationId: 'post_api_auth_register',
      tags: ['auth'],
      requestBody: jsonBody({
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
          nombre: { type: 'string' },
          role: { type: 'string', enum: ['client', 'provider', 'owner'] },
        },
      }),
      responses: {
        201: { description: 'Usuario registrado; devuelve token y perfil.' },
        400: { description: 'Faltan campos obligatorios o formato inválido.' },
        409: { description: 'El email ya está registrado.' },
        429: { description: 'Rate limit de autenticación excedido.' },
        500: { description: 'Error interno al crear el usuario.' },
      },
    },
  },

  'POST /api/auth/login': {
    area: 'auth',
    operation: {
      summary: 'Inicio de sesión con email y contraseña',
      operationId: 'post_api_auth_login',
      tags: ['auth'],
      requestBody: jsonBody({
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 },
        },
      }),
      responses: {
        200: { description: 'Sesión iniciada; devuelve token y perfil.' },
        400: { description: 'Email y contraseña son obligatorios.' },
        401: { description: 'Credenciales inválidas.' },
        429: { description: 'Rate limit de autenticación excedido.' },
        500: { description: 'Error interno al autenticar.' },
      },
    },
  },

  'POST /api/auth/logout': {
    area: 'auth',
    operation: {
      summary: 'Cierre de sesión (invalida el token)',
      operationId: 'post_api_auth_logout',
      tags: ['auth'],
      security: BEARER,
      responses: {
        200: { description: 'Sesión cerrada.' },
        401: { description: 'Token ausente, inválido o revocado.' },
        500: { description: 'Error interno al cerrar sesión.' },
      },
    },
  },

  'POST /api/bookings': {
    area: 'booking',
    operation: {
      summary: 'Crear una reserva',
      operationId: 'post_api_bookings',
      tags: ['bookings'],
      security: BEARER,
      requestBody: jsonBody({
        type: 'object',
        required: ['serviceId', 'fechaHora'],
        properties: {
          serviceId: { type: 'integer' },
          fechaHora: { type: 'string', format: 'date-time' },
          notas: { type: 'string' },
        },
      }),
      responses: {
        201: { description: 'Reserva creada.' },
        400: { description: 'Cuerpo o parámetros inválidos.' },
        401: { description: 'No autenticado.' },
        403: { description: 'El rol del usuario no puede reservar.' },
        404: { description: 'Servicio inexistente.' },
        409: { description: 'Conflicto de disponibilidad.' },
        500: { description: 'Error interno al crear la reserva.' },
      },
    },
  },

  'GET /api/bookings/client': {
    area: 'booking',
    operation: {
      summary: 'Listar las reservas del cliente autenticado',
      operationId: 'get_api_bookings_client',
      tags: ['bookings'],
      security: BEARER,
      responses: {
        200: {
          description: 'Listado de reservas del cliente.',
          content: {
            'application/json': {
              schema: { type: 'array', items: { type: 'object' } },
            },
          },
        },
        401: { description: 'No autenticado.' },
        403: { description: 'El rol del usuario no puede listar reservas de cliente.' },
        500: { description: 'Error interno.' },
      },
    },
  },

  'POST /api/bookings/{id}/pay': {
    area: 'booking',
    operation: {
      summary: 'Iniciar o confirmar el pago de una reserva',
      operationId: 'post_api_bookings_id_pay',
      tags: ['bookings', 'payments'],
      security: BEARER,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      ],
      requestBody: jsonBody({
        type: 'object',
        properties: {
          method: { type: 'string', enum: ['wompi', 'wallet', 'cash'] },
        },
      }),
      responses: {
        200: { description: 'Pago iniciado o confirmado.' },
        400: { description: 'Solicitud de pago inválida.' },
        401: { description: 'No autenticado.' },
        403: { description: 'La reserva no pertenece al usuario.' },
        404: { description: 'Reserva inexistente.' },
        409: { description: 'La reserva ya está pagada o en un estado incompatible.' },
        500: { description: 'Error interno del procesador de pagos.' },
      },
    },
  },

  'POST /api/payments/wompi-webhook': {
    area: 'payment',
    operation: {
      summary: 'Webhook de Wompi (confirmación asíncrona de pago)',
      description:
        'Endpoint público por diseño: se autentica con la firma del proveedor (checksum), ' +
        'no con el token del usuario. Un evento válido responde 200 de forma idempotente ' +
        'para que Wompi no reintente; un evento cuya firma no se puede verificar responde 401, ' +
        'de modo que un fallo transitorio de configuración no haga perder la confirmación.',
      operationId: 'post_api_payments_wompi_webhook',
      tags: ['payments'],
      security: [],
      requestBody: jsonBody({
        type: 'object',
        properties: {
          event: { type: 'string' },
          data: { type: 'object' },
          signature: { type: 'object' },
        },
      }),
      responses: {
        200: { description: 'Evento aceptado (procesado o ignorado de forma idempotente).' },
        400: { description: 'Evento malformado o firma inválida.' },
        401: { description: 'Firma del proveedor no verificable.' },
        500: { description: 'Error interno al procesar el evento.' },
      },
    },
  },

  'GET /api/admin/dashboard': {
    area: 'admin',
    operation: {
      summary: 'Métricas del panel administrativo',
      operationId: 'get_api_admin_dashboard',
      tags: ['admin'],
      security: BEARER,
      responses: {
        200: { description: 'Métricas del panel.' },
        401: { description: 'No autenticado.' },
        403: { description: 'El usuario no tiene rol administrador.' },
        500: { description: 'Error interno.' },
      },
    },
  },

  'GET /api/admin/disputes': {
    area: 'admin',
    operation: {
      summary: 'Listar disputas para administración',
      operationId: 'get_api_admin_disputes',
      tags: ['admin'],
      security: BEARER,
      responses: {
        200: { description: 'Listado de disputas.' },
        401: { description: 'No autenticado.' },
        403: { description: 'El usuario no tiene rol administrador.' },
        500: { description: 'Error interno.' },
      },
    },
  },

  'PUT /api/admin/disputes/{id}/resolve': {
    area: 'admin',
    operation: {
      summary: 'Resolver una disputa',
      operationId: 'put_api_admin_disputes_id_resolve',
      tags: ['admin'],
      security: BEARER,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      ],
      requestBody: jsonBody({
        type: 'object',
        required: ['resolution'],
        properties: {
          resolution: { type: 'string', enum: ['favor_cliente', 'favor_prestador', 'anulada'] },
          nota: { type: 'string' },
        },
      }),
      responses: {
        200: { description: 'Disputa resuelta.' },
        400: { description: 'Resolución inválida.' },
        401: { description: 'No autenticado.' },
        403: { description: 'El usuario no tiene rol administrador.' },
        404: { description: 'Disputa inexistente.' },
        500: { description: 'Error interno.' },
      },
    },
  },
};

const CRITICAL_OPERATION_KEYS = Object.keys(CRITICAL_OPERATIONS).sort();

/**
 * Comportamiento observable de las rutas críticas SIN credenciales válidas.
 * Es lo que el test de contrato ejecuta contra los routers reales y luego
 * verifica que el código de estado observado esté declarado en el contrato.
 * Datos derivados de la ejecución real (ver evidencia RED/GREEN del fix).
 */
const CRITICAL_PROBES = [
  {
    key: 'POST /api/auth/register',
    mount: 'auth',
    request: { method: 'post', path: '/api/auth/register', body: { email: 'x' } },
    expectStatus: 400,
    expectBodyKeys: ['error'],
  },
  {
    key: 'POST /api/auth/login',
    mount: 'auth',
    request: { method: 'post', path: '/api/auth/login', body: { email: 'x' } },
    expectStatus: 400,
    expectBodyKeys: ['error'],
  },
  {
    key: 'POST /api/auth/login',
    mount: 'auth',
    request: {
      method: 'post',
      path: '/api/auth/login',
      body: { email: 'contrato@glowapp.test', // Fixture, no credencial: el contrato espera 401. Se marca PLACEHOLDER para que la
      // compuerta de credenciales versionadas (N-10) no lo confunda con un secreto real.
      password: 'PLACEHOLDER_password_invalida' },
    },
    expectStatus: 401,
    expectBodyKeys: ['error'],
  },
  {
    key: 'POST /api/bookings',
    mount: 'core',
    request: { method: 'post', path: '/api/bookings', body: {} },
    expectStatus: 401,
    expectBodyKeys: ['error'],
  },
  {
    key: 'GET /api/bookings/client',
    mount: 'core',
    request: { method: 'get', path: '/api/bookings/client' },
    expectStatus: 401,
    expectBodyKeys: ['error'],
  },
  {
    key: 'POST /api/bookings/{id}/pay',
    mount: 'core',
    request: { method: 'post', path: '/api/bookings/1/pay', body: {} },
    expectStatus: 401,
    expectBodyKeys: ['error'],
  },
  {
    key: 'POST /api/payments/wompi-webhook',
    mount: 'core',
    request: { method: 'post', path: '/api/payments/wompi-webhook', body: {} },
    // Un evento sin firma verificable NO se acusa como recibido: responder 200
    // le diría a Wompi "deja de reintentar" una confirmación de pago que nunca
    // procesamos (y una firma que falla por configuración se perdería para
    // siempre). El 200 idempotente es para eventos VÁLIDOS.
    expectStatus: 401,
    expectBodyKeys: ['error'],
  },
  {
    key: 'GET /api/admin/dashboard',
    mount: 'core',
    request: { method: 'get', path: '/api/admin/dashboard' },
    expectStatus: 401,
    expectBodyKeys: ['error'],
  },
  {
    key: 'GET /api/admin/disputes',
    mount: 'admin',
    request: { method: 'get', path: '/api/admin/disputes' },
    expectStatus: 401,
    expectBodyKeys: ['error'],
  },
  {
    key: 'PUT /api/admin/disputes/{id}/resolve',
    mount: 'admin',
    request: { method: 'put', path: '/api/admin/disputes/1/resolve', body: {} },
    expectStatus: 401,
    expectBodyKeys: ['error'],
  },
];

/**
 * Rutas de Express a montar en la app de prueba por cada `mount` del probe.
 * Se montan los routers directamente (sin el app completo) para que el contrato
 * se pueda comprobar sin base de datos: el middleware degradado del index.js
 * responde 503 a todo /api cuando no hay conexión.
 */
const CRITICAL_MOUNTS = {
  auth: [['/api/auth', '../../routes/authRoutes']],
  core: [
    ['/api', '../../routes/bookingRoutes'],
    ['/api', '../../routes/paymentRoutes'],
  ],
  admin: [['/api/admin', '../../routes/adminRoutes']],
};

/**
 * Defectos de enrutamiento pre-existentes (mismo método+ruta montado 2 veces).
 * La compuerta tolera estos y falla si aparece uno NUEVO.
 * Detectados con: npx jest src/tests/routing.contract.test.js y el inventario real.
 */
const KNOWN_DUPLICATE_OPERATIONS = [
  'GET /api/admin/disputes',
  'POST /api/portfolio',
];

module.exports = {
  CRITICAL_OPERATIONS,
  CRITICAL_OPERATION_KEYS,
  CRITICAL_PROBES,
  CRITICAL_MOUNTS,
  KNOWN_DUPLICATE_OPERATIONS,
};
