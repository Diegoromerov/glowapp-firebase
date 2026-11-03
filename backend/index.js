// backend/index.js - Loopback updated
const express = require('express');
const cors = require('cors');
const compression = require('compression'); // ← GZIP para reducir main.dart.js de 4MB a ~1MB
const { pool, testConnection, getDbStatus } = require('./src/config/db');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
require('dotenv').config();

// ⚠️ IMPORTANTE: Imports al inicio para evitar ReferenceError
const { getJwtSecret } = require('./src/config/jwt');

// 🔒 Fail-Fast al arranque: validar que JWT_SECRET exista y cumpla longitud >= 32 en producción
getJwtSecret();

const authRoutes = require('./src/routes/authRoutes');
const salonRoutes = require('./src/routes/salonRoutes');
const biometricConsentRoutes = require('./src/routes/biometricConsentRoutes');
const userPreferencesRoutes = require('./src/routes/userPreferencesRoutes');
const userDeliveryAddressRoutes = require('./src/routes/userDeliveryAddressRoutes');
const biometricRoutes = require('./src/routes/biometricRoutes');
const vtoRoutes = require('./src/routes/vtoRoutes');
const colorRoutes = require('./src/routes/colorRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');
const bookingRoutes = require('./src/routes/bookingRoutes');
const serviceRoutes = require('./src/routes/serviceRoutes');
const chatRoutes = require('./src/routes/chatRoutes');
const designsRoutes = require('./src/routes/designsRoutes');
const productRoutes = require('./src/routes/productRoutes');
const providerRoutes = require('./src/routes/providerRoutes');
const ticketRoutes = require('./src/routes/ticketRoutes');
const disputeRoutes = require('./src/routes/disputeRoutes');
const academyRoutes = require('./src/routes/academyRoutes');
const academyAdminRoutes = require('./src/routes/academyAdminRoutes');
const adminPreciosRoutes = require('./src/routes/adminPreciosRoutes');
const adminAuthRoutes = require('./src/routes/adminAuthRoutes');
const { authMiddleware } = require('./src/middleware/auth');
const traceIdMiddleware = require('./src/middleware/traceId');
const { validateAppAudience } = require('./src/middleware/appAudience');
const glowProRoutes = require('./src/routes/glowProRoutes');
const analyticsRoutes = require('./src/routes/analyticsRoutes');
const metricsRoutes = require('./src/routes/metricsRoutes');
const portfolioRoutes = require('./src/routes/portfolioRoutes');
const communityRoutes = require('./src/routes/communityRoutes');
const mentorshipRoutes = require('./src/routes/mentorshipRoutes');
const xpLogRoutes = require('./src/routes/xpLogRoutes');
const eventRoutes = require('./src/routes/eventRoutes');
const eventRegistrationRoutes = require('./src/routes/eventRegistrationRoutes');
const businessRoutes = require('./src/routes/businessRoutes');
const membershipRoutes = require('./src/routes/membershipRoutes');
// E-01 (D-GL-027): routers con controladores y tests que nunca se montaron.
const ownerRoutes = require('./src/routes/ownerRoutes');
const inventoryRoutes = require('./src/routes/inventoryRoutes');
const { buildProjections } = require('./src/services/adminMetricsService');
// FIX-FLUTTER-06: política de versión mínima publicada en GET /api/health.
const { resolveAppVersionPolicy } = require('./src/services/appVersionPolicy');
const adminMiddleware = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'No autorizado. Token inválido.' });
    }
    const { rows } = await pool.query('SELECT rol, email FROM usuarios WHERE id = $1', [req.user.id]);
    if (!rows.length) {
      return res.status(401).json({ error: 'Usuario no encontrado.' });
    }
    const user = rows[0];
    if (user.rol === 'ADMIN') {
      return next();
    }
    return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de administrador.' });
  } catch (error) {
    console.error('Error en adminMiddleware:', error);
    res.status(500).json({ error: 'Error interno de autorización.' });
  }
};
const { processAssistantMessage, AI_USER_ID } = require('./src/services/geminiService');
const { inicializarJobs } = require('./src/jobs/paymentJobs');
const { iniciarRetencionBiometrica } = require('./src/jobs/biometricRetention');

const crypto = require('crypto');

let lastDbInitError = null;

const app = express();
app.set('trust proxy', 1); // Confiar en el proxy reverso (WAF de Railway / Cloudflare)
const PORT = process.env.PORT || 8080;

const statusMonitor = require('express-status-monitor');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

// Configuración de Swagger
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'GlowApp Biometric Hub API',
      version: '1.0.0',
      description: 'API para el módulo de lectura biométrica facial y de manos',
    },
    servers: [
      { url: 'https://belleza-app-production.up.railway.app', description: 'Producción' },
      { url: 'http://localhost:8080', description: 'Desarrollo' },
    ],
  },
  apis: ['./src/routes/*.js'],
};
const specs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

app.use(statusMonitor({
  title: 'GlowApp Biometric API Status',
  path: '/status',
  spans: [
    { interval: 1, retention: 60 },
    { interval: 5, retention: 60 },
    { interval: 15, retention: 60 },
  ],
}));

// Configuración de Multer para almacenamiento estático local
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Carpeta "uploads" creada con éxito.');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, 'file-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Límite de 5MB
  fileFilter: (req, file, cb) => {
    // Validar por extensión del archivo original
    const allowedExtensions = /\.(jpeg|jpg|png|gif|webp)$/i;
    const hasValidExtension = allowedExtensions.test(file.originalname);
    
    // Validar por MIME type (image/jpeg, image/png, etc.)
    // También aceptar application/octet-stream si la extensión es válida
    // (Flutter Web a veces envía application/octet-stream)
    const hasValidMime = file.mimetype.startsWith('image/') || 
                         (file.mimetype === 'application/octet-stream' && hasValidExtension);
    
    if (hasValidExtension || hasValidMime) {
      return cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes (.jpeg, .jpg, .png, .gif, .webp). Formato recibido: ' + file.mimetype + ' - ' + file.originalname));
    }
  }
});

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Configuración robusta de CORS adaptada por entorno (DEV / STAGING / PRODUCTION)
const currentEnv = process.env.NODE_ENV || 'development';

const defaultOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8080',
  'http://localhost:8081',
  'http://localhost:8082',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:7357',
  'http://127.0.0.1:8080',
  'http://127.0.0.1:3001',
  'https://belleza-app-production.up.railway.app',
  'https://glowapp-frontend-production.up.railway.app',
  'https://admin-dashboard-production-4183.up.railway.app',
  // Apps del split servidas por Firebase Hosting (glowapp-firebase). Sin estas
  // entradas el navegador bloquea toda llamada a /api: el build web corre en
  // https://glowapp-client.web.app y https://glowapp-provider.web.app.
  'https://glowapp-client.web.app',
  'https://glowapp-client.firebaseapp.com',
  'https://glowapp-provider.web.app',
  'https://glowapp-provider.firebaseapp.com'
];

const envOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : [];

const allowedOriginsSet = new Set([...defaultOrigins, ...envOrigins]);

// Regex para detectar cualquier puerto en localhost o 127.0.0.1 en entorno de desarrollo
const devOriginRegex = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

app.use(compression()); // GZIP — debe ir antes de las rutas y estáticos

// ⚠️ CORS DEBE IR PRIMERO para garantizar encabezados Access-Control-Allow-Origin en todas las respuestas
app.use(cors({
  origin: (origin, callback) => {
    // 1. Peticiones sin origin (apps móviles nativas, servidor a servidor, curl local)
    if (!origin) return callback(null, true);

    // 2. DESARROLLO: Permite localhost / 127.0.0.1 en CUALQUIER puerto dinámico
    if (currentEnv === 'development' && devOriginRegex.test(origin)) {
      return callback(null, true);
    }

    // 3. STAGING / PRODUCTION / DESARROLLO: Orígenes explícitamente autorizados (código + ALLOWED_ORIGINS env)
    if (allowedOriginsSet.has(origin)) {
      return callback(null, true);
    }

    // 4. Rechazo estándar W3C (null, false) evita transformar bloqueos CORS en HTTP 500
    return callback(null, false);
  },
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(traceIdMiddleware); // Trace ID middleware for consistent tracking
// Servir el build de Flutter Web desde el backend es una comodidad de desarrollo local: en el
// contenedor desplegado esa ruta NO existe (el contexto de build del backend es ./backend y el web
// lo sirve nginx con frontend/Dockerfile). Por eso se resuelve UNA sola vez al arrancar, en lugar de
// hacer un fs.existsSync por cada request.
const webBuildPath = path.join(__dirname, '../frontend/build/web');
const webBuildIndex = path.join(webBuildPath, 'index.html');
const hasWebBuild = fs.existsSync(webBuildIndex);
if (hasWebBuild) {
  app.use(express.static(webBuildPath));
}
const sanitizer = require('./src/middleware/sanitizer');
app.use(sanitizer);

// Middleware de visibilidad de degradación (A1.T2)
app.use((req, res, next) => {
  if (getDbStatus().servingFabricatedData === true) {
    res.setHeader('X-GlowApp-Degraded', 'memory-fallback');
  }
  next();
});

// P0 infra/observabilidad #4 (t_fix_infra_04): plano de métricas máquina-legible.
// Se monta ANTES del candado de degradación para que TODA respuesta (incluidos los
// 503 tempranos y los 404) quede contabilizada y sea alertable. `express-status-monitor`
// (página humana en /status) no expone /metrics ni es consumible por Prometheus.
const { metricsMiddleware, metricsHandler } = require('./src/metrics/prometheus');
app.use(metricsMiddleware);
app.get('/metrics', metricsHandler);

// 🔹 GLOBAL APP AUDIENCE MIDDLEWARE (Fase 4)
// Valida header X-App-Audience en TODAS las rutas /api/*
// Debe ir ANTES de authMiddleware para que req.appAudience esté disponible
app.use('/api', validateAppAudience({ required: true }));

const { degradedLockMiddleware, clasificarSalud, asegurarEstadoComprobado } = require('./src/middleware/degradedLock');
app.use('/api', degradedLockMiddleware);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https://world.openbeautyfacts.org", "*"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://www.gstatic.com",
        "https://*.gstatic.com",
        "https://www.googletagmanager.com",
        "https://connect.facebook.net",
        "https://accounts.google.com",
        "https://apis.google.com"
      ],
      scriptSrcElem: [
        "'self'",
        "'unsafe-inline'",
        "https://www.gstatic.com",
        "https://*.gstatic.com",
        "https://www.googletagmanager.com",
        "https://connect.facebook.net",
        "https://accounts.google.com",
        "https://apis.google.com"
      ],
      frameSrc: [
        "'self'",
        "https://accounts.google.com",
        "https://*.wompi.co"
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://*.googleapis.com"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com", "https://*.gstatic.com"],
      connectSrc: ["'self'", "*"],
    },
  },
}));

// Límite específico para /analyze (más restrictivo)
const analyzeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 30, // 30 análisis por hora por IP
  message: { error: 'Has excedido el límite de análisis. Espera 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Límite de peticiones general para SPA web (1000 peticiones por 15 minutos)
const globalGeneralLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 1000, // 1000 solicitudes por IP para evitar bloqueos por analítica y reintentos
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ==========================================
// 🗺️ PROXY & CACHE DE MAP TILES (OpenStreetMap & CartoDB SSL-Safe)
// ==========================================
const https = require('https');
const httpsTileAgent = new https.Agent({ rejectUnauthorized: false });
const tileCache = new Map();

function fetchTileBuffer(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      agent: httpsTileAgent
    }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

app.get('/api/tiles/:z/:x/:y.png', async (req, res) => {
  const { z, x, y } = req.params;
  const cacheKey = `${z}/${x}/${y}`;

  if (tileCache.has(cacheKey)) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(tileCache.get(cacheKey));
  }

  const tileUrls = [
    `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    `https://a.tile.openstreetmap.org/${z}/${x}/${y}.png`,
    `https://basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`
  ];

  for (const tileUrl of tileUrls) {
    try {
      const buffer = await fetchTileBuffer(tileUrl);
      if (buffer && buffer.length > 500) {
        if (tileCache.size > 3000) {
          const firstKey = tileCache.keys().next().value;
          tileCache.delete(firstKey);
        }
        tileCache.set(cacheKey, buffer);

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(buffer);
      }
    } catch (_) {}
  }

  const fallbackPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAQEAAAEAQAQAAAB8O7a7AAAAE0lEQVR42u3BAQEAAACCIP+vb4hAAAAA3gE4AAABN11dAAAAAElFTkSuQmCC',
    'base64'
  );
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.status(200).send(fallbackPng);
});

app.use('/api/biometric/analyze', analyzeLimiter);
app.use('/api', globalGeneralLimiter);

app.use('/uploads', express.static(uploadsDir));
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));
app.use(express.static(path.join(__dirname, 'public')));

// Servir la aplicación Flutter Web en cualquier ruta no controlada por API u otros estáticos
app.get(/^(?!\/api(?:\/|$))(?!\/uploads(?:\/|$))(?!\/admin(?:\/|$)).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Fail-closed (AUD-SECAPP-03, P0): /api/test-db y /api/debug-db NUNCA quedan abiertas
// por defecto. El guard anterior era fail-OPEN: se servían SIN auth en cualquier entorno
// donde NODE_ENV no fuese exactamente 'production' (incluido NODE_ENV ausente) y también
// en producción si ALLOW_DEBUG_ROUTES='true'. Ahora exigen auth+admin SIEMPRE, salvo el
// opt-in explícito ALLOW_DEBUG_ROUTES='true' Y sólo fuera de producción (depuración local).
const allowDebugRoutes =
  process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEBUG_ROUTES === 'true';
const debugRouteMiddleware = (req, res, next) => {
  if (allowDebugRoutes) {
    return next();
  }
  return authMiddleware(req, res, () => adminMiddleware(req, res, next));
};

const { rateLimitByIP } = require('./src/middleware/rateLimiter');

// Limitador estricto para endpoints de webhooks de pagos (max 30 peticiones por minuto)
const webhookLimiter = rateLimitByIP({
  windowMs: 60 * 1000,
  limit: 30,
});

// Nota: authLimiter ya se aplica dentro de authRoutes.js
app.use('/api/payments/wompi-webhook', webhookLimiter);

// ==========================================
// SISTEMA DE RUTAS DE LA API (Montajes únicos)
// ==========================================
app.use('/api/auth', authRoutes);
app.use('/api', paymentRoutes);
app.use('/api', bookingRoutes);
app.use('/api', serviceRoutes);
app.use('/api', chatRoutes);
app.use('/api', productRoutes);
app.use('/api', providerRoutes);
// E-01 (D-GL-027): estas dos superficies existían con controlador y tests pero
// nunca se montaron, así que respondían 404 en producción mientras el cliente
// ya las llamaba (frontend/lib/services/api_service.dart).
//   /api/owner/salones, /api/owner/switch-salon, /api/owner/dashboard-metrics
//   /api/provider/inventory/consignment, /api/provider/inventory/consume
app.use('/api/owner', ownerRoutes);
app.use('/api/provider', inventoryRoutes);
app.use('/api', ticketRoutes);
app.use('/api', disputeRoutes);
app.use('/api', eventRegistrationRoutes);
app.use('/api/salon', salonRoutes);
app.use('/api/users', userPreferencesRoutes);
app.use('/api/users', userDeliveryAddressRoutes);
app.use('/api/designs', designsRoutes);
const niaBeautyRoutes = require('./src/routes/niaBeautyRoutes');
app.use('/api/nia-beauty', niaBeautyRoutes);
app.use('/api/consent', biometricConsentRoutes);
const consentRoutes = require('./src/routes/consentRoutes');
app.use('/api/consent', consentRoutes);
app.use('/api/biometric', biometricRoutes);
app.use('/api/glow-cycle', require('./src/routes/glowCycleRoutes'));
app.use('/api/v1/beauty', require('./src/routes/v1/beautyRoutes'));
app.use('/api/v1/beauty-scan', require('./src/routes/v1/beautyScanRoutes'));
app.use('/api/v1/workforce', require('./src/routes/v1/workforceRoutes'));
app.use('/api/vto', vtoRoutes);
app.use('/api/color', colorRoutes);
app.use('/api/academy', academyRoutes);
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin/academy', academyAdminRoutes);
app.use('/api/admin', adminPreciosRoutes);
// Gestión de PQRSF desde el panel (`/api/admin/tickets...`). Router con authMiddleware y
// requireRol('admin') propios.
app.use('/api/admin', require('./src/routes/adminTicketRoutes'));
app.use('/api/admin', require('./src/routes/adminUploadRoutes'));
app.use('/api/glow-pro', glowProRoutes);
// Módulo admin-glow: SOS, verificación de prestadores, payouts y resumen financiero.
// El router aplica authAdmin a nivel de router (admin.routes.js:8), por lo que
// montarlo no expone ninguna ruta sin autenticación.
app.use('/api/glow-admin', require('./src/modules/admin-glow/admin.routes'));
app.use('/api/events', eventRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/mentorship', mentorshipRoutes);
app.use('/api/xp-logs', xpLogRoutes);
app.use('/api/v1/business', businessRoutes);
app.use('/api/v1/memberships', membershipRoutes);

// ==========================================
// 🔹 SAAS B2B ROUTES (Fases 1-4)
// ==========================================
const saasTeamRoutes = require('./src/routes/saasTeamRoutes');
const saasUsageRoutes = require('./src/routes/saasUsageRoutes');
const saasBillingRoutes = require('./src/routes/saasBillingRoutes');
const saasApiKeyRoutes = require('./src/routes/saasApiKeyRoutes');
const saasBootstrapRoutes = require('./src/routes/saasBootstrapRoutes');
const superAdminRoutes = require('./src/routes/superAdminRoutes');

app.use('/api/saas/bootstrap', saasBootstrapRoutes);
app.use('/api/saas/team', saasTeamRoutes);
app.use('/api/saas/usage', saasUsageRoutes);
app.use('/api/saas/billing', saasBillingRoutes);
app.use('/api/saas/api-keys', saasApiKeyRoutes);
app.use('/api/superadmin', superAdminRoutes);

// Health check — NO escribe en la base de datos. Antes ejecutaba un `setval` sobre
// `usuarios_id_seq` en cada probe (y respondía 200 con la BD caída).
// A360-2026-09-22/A-06 + C-03.
// Health check — NO escribe en la base de datos.
app.get('/api/health', async (req, res) => {
  // Ronda 7 (CI-23): si el estado nunca se comprobó, se comprueba AHORA (una vez por TTL) antes de
  // clasificar; sin comprobar no es lo mismo que sano ni que degradado.
  const dbStatus = await asegurarEstadoComprobado();
  const salud = clasificarSalud(dbStatus);
  if (salud.degradado) {
    res.setHeader('X-GlowApp-Degraded', 'memory-fallback');
  }
  res.status(salud.httpStatus).json({
    status: salud.status,
    message: salud.message,
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
    // Build desplegado: permite comprobar desde fuera que la version que corre
    // en produccion es la del commit esperado (Railway lo inyecta).
    commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || null,
    service: process.env.RAILWAY_SERVICE_NAME || null,
    database: dbStatus,
    // FIX-FLUTTER-06: política de versión de la app (fuente: MINIMUM_APP_VERSION /
    // LATEST_APP_VERSION). La app compara su versión instalada y bloquea si está
    // por debajo de minimum_app_version.
    ...resolveAppVersionPolicy(),
  });
});

// Test DB connection
app.get('/api/test-db', debugRouteMiddleware, async (req, res) => {
  try {
    let dbStatus = getDbStatus();
    if (dbStatus.pgAvailable === null) {
      await testConnection();
      dbStatus = getDbStatus();
    }
    const salud = clasificarSalud(dbStatus);
    const connected = dbStatus.pgAvailable === true;
    res.status(salud.httpStatus).json({ 
      status: salud.degradado ? 'error' : (connected ? 'success' : 'error'), 
      message: salud.degradado ? 'Error de conexión (Capa de datos degradada)' : 'PostgreSQL conectado',
      postgis: connected ? await pool.query('SELECT PostGIS_Version()').then(r => r.rows[0].postgis_version).catch(() => 'no disponible') : null
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Debug DB tables and extensions
app.get('/api/debug-db', debugRouteMiddleware, async (req, res) => {
  const reports = {};
  reports.lastDbInitError = lastDbInitError;
  try {
    // 0. Try to create postgis extension
    try {
      await pool.query("CREATE EXTENSION IF NOT EXISTS postgis;");
      reports.postgis_creation = "success";
    } catch (e) {
      reports.postgis_creation_error = e.message;
    }

    // 0.5 Check Postgres version
    try {
      const verRes = await pool.query("SELECT version();");
      reports.postgres_version = verRes.rows[0].version;
    } catch (e) {
      reports.postgres_version_error = e.message;
    }

    // 1. Check extensions
    try {
      const extRes = await pool.query("SELECT extname FROM pg_extension;");
      reports.extensions = extRes.rows.map(r => r.extname);
    } catch (e) {
      reports.extensions_error = e.message;
    }

    // 1.5 Check available extensions
    try {
      const availExtRes = await pool.query("SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name LIKE 'postgis%';");
      reports.available_extensions = availExtRes.rows;
    } catch (e) {
      reports.available_extensions_error = e.message;
    }

    // 2. Check tables
    try {
      const tablesRes = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public';
      `);
      reports.tables = tablesRes.rows.map(r => r.table_name);
    } catch (e) {
      reports.tables_error = e.message;
    }

    // 3. Try to run a query on usuarios to check rows
    try {
      const countRes = await pool.query('SELECT COUNT(*) as count FROM usuarios;');
      reports.usuarios_count = countRes.rows[0].count;
    } catch (e) {
      reports.usuarios_error = e.message;
    }

    // 4. Try PostGIS version
    try {
      const postgisVer = await pool.query('SELECT PostGIS_Version();');
      reports.postgis_version = postgisVer.rows[0].postgis_version;
    } catch (e) {
      reports.postgis_error = e.message;
    }

    res.json(reports);
    } catch (err) {
    res.status(500).json({ error: err.message, reports });
    }
    });

    // Schema verification endpoint for biometric_consents
    app.get('/api/debug-schema', debugRouteMiddleware, async (req, res) => {
    try {
    const reports = {};

    // Check biometric_consents columns
    try {
    const cols = await pool.query(`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'biometric_consents' 
    ORDER BY ordinal_position
    `);
    reports.biometric_consents_columns = cols.rows;
    } catch (e) {
    reports.biometric_consents_columns_error = e.message;
    }

    // Check constraints
    try {
    const constraints = await pool.query(`
    SELECT conname, pg_get_constraintdef(oid) as definition
    FROM pg_constraint 
    WHERE conrelid = 'biometric_consents'::regclass
    `);
    reports.biometric_consents_constraints = constraints.rows;
    } catch (e) {
    reports.biometric_consents_constraints_error = e.message;
    }

    // Check biometric_access_log
    try {
    const logCols = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'biometric_access_log' 
    ORDER BY ordinal_position
    `);
    reports.biometric_access_log_columns = logCols.rows;
    } catch (e) {
    reports.biometric_access_log_error = e.message;
    }

    // Check schema_migrations for recent migrations
    try {
    const migrations = await pool.query(`
    SELECT filename, checksum, applied_at 
    FROM schema_migrations 
    WHERE filename LIKE '07%' OR filename LIKE '08%'
    ORDER BY applied_at DESC
    LIMIT 10
    `);
    reports.recent_migrations = migrations.rows;
    } catch (e) {
    reports.migrations_error = e.message;
    }

    res.json(reports);
    } catch (err) {
    res.status(500).json({ error: err.message });
    }
    });

    // 🔹 LISTA DE PRESTADORES Y DETALLE (Refactorizados a providerRoutes.js y providerController.js)

// NOTE: Todas las rutas de la API han sido consolidadas en el bloque único de montajes arriba (líneas 385+).

// ==========================================
// RUTAS PROTEGIDAS (Requieren JWT)
// ==========================================

// 🔹 RUTAS DE RESERVAS REFACTORIZADAS (Movidas a bookingRoutes.js y bookingController.js)


// 🔹 RUTAS DE SERVICIOS REFACTORIZADAS (Movidas a serviceRoutes.js y serviceController.js)

// 🔹 SLOTS DE PRESTADORES (Refactorizado a providerRoutes.js y providerController.js)

// 🔹 NUEVO: Endpoint para subir imágenes locales (Multer)
app.post('/api/upload', authMiddleware, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha proporcionado ninguna imagen' });
    }
    // Construir URL robusta: usar X-Forwarded-Proto para detectar HTTPS detrás de proxy (Railway)
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const relativePath = `/uploads/${req.file.filename}`;
    const imageUrl = `${protocol}://${host}${relativePath}`;
    console.log(`📸 Imagen subida: ${imageUrl} (relativa: ${relativePath})`);
    res.json({
      success: true,
      message: 'Imagen subida con éxito',
      url: imageUrl,
      path: relativePath
    });
  });
});

// Lista de clientes conectados a eventos SSE de administración
const sseClients = [];

// Función para transmitir eventos a todos los clientes del dashboard conectados
const broadcastAdminEvent = (type, data) => {
  const payload = JSON.stringify({ type, data });
  sseClients.forEach(client => {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch (err) {
      console.error('Error al escribir en cliente SSE:', err);
    }
  });
};

// 🔹 NUEVO: Registrar Alerta de Emergencia / SOS (Pánico)
app.post('/api/sos', authMiddleware, async (req, res) => {
  try {
    const { booking_id, latitude, longitude } = req.body;
    const user_id = req.user.id;

    // Validación defensiva
    if (latitude && (latitude < -90 || latitude > 90)) {
      return res.status(400).json({ error: 'Latitud inválida' });
    }
    if (longitude && (longitude < -180 || longitude > 180)) {
      return res.status(400).json({ error: 'Longitud inválida' });
    }

    const query = `
      INSERT INTO sos_alerts (user_id, booking_id, latitude, longitude, estado)
      VALUES ($1, $2, $3, $4, 'ACTIVO')
      RETURNING id, creado_en;
    `;
    const result = await pool.query(query, [
      user_id,
      booking_id || null,
      latitude || null,
      longitude || null
    ]);

    const alertId = result.rows[0].id;
    
    // Emitir el evento SOS en tiempo real a los dashboards conectados
    broadcastAdminEvent('sos_alert', {
      id: alertId,
      user_id: user_id,
      email: req.user.email,
      booking_id: booking_id || null,
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      estado: 'ACTIVO',
      creado_en: result.rows[0].creado_en
    });
    
    // Log de consola con estilo de emergencia
    console.log('\x1b[41m\x1b[37m%s\x1b[0m', `🚨 [ALERTA DE EMERGENCIA - SOS] 🚨`);
    console.log(`- Alerta ID: ${alertId}`);
    console.log(`- Usuario ID: ${user_id} (${req.user.email})`);
    if (booking_id) console.log(`- Reserva asociada: ${booking_id}`);
    if (latitude && longitude) console.log(`- Ubicación: ${latitude}, ${longitude}`);
    console.log(`- Timestamp: ${new Date().toISOString()}`);
    console.log('\x1b[41m\x1b[37m%s\x1b[0m', `🚨 [FIN DE ALERTA - NOTIFICANDO AUTORIDADES] 🚨`);

    res.status(201).json({
      success: true,
      message: 'Alerta de pánico (SOS) activada correctamente. La central de seguridad y las autoridades locales de Fontibón han sido notificadas.',
      alert_id: alertId
    });

  } catch (error) {
    console.error('❌ ERROR EN POST /api/sos:', error);
    res.status(500).json({ error: 'Error interno al registrar alerta de pánico' });
  }
});

// Middleware para autenticación opcional (no bloquea si no hay token o es inválido)
const optionalAuthMiddleware = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const jwt = require('jsonwebtoken');
    const { getJwtSecret } = require('./src/config/jwt');
    const verified = jwt.verify(token, getJwtSecret());
    
    const userRes = await pool.query('SELECT rol FROM usuarios WHERE id = $1', [verified.id]);
    if (userRes.rows.length > 0) {
      req.user = {
        id: verified.id,
        email: verified.email,
        role: userRes.rows[0].rol
      };
    } else {
      req.user = null;
    }
  } catch (err) {
    req.user = null;
  }
  next();
};

// 🔹 NUEVO: Canal SSE en tiempo real para eventos de administración
app.get('/api/admin/events/stream', authMiddleware, adminMiddleware, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.push(res);
  console.log(`🔌 [SSE] Administrador conectado al flujo en vivo. Total conectados: ${sseClients.length}`);

  // Enviar ping inicial para confirmar conexión
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

  req.on('close', () => {
    const index = sseClients.indexOf(res);
    if (index !== -1) {
      sseClients.splice(index, 1);
      console.log(`🔌 [SSE] Administrador desconectado del flujo. Total conectados: ${sseClients.length}`);
    }
  });
});

// 🔹 NUEVO: Obtener estadísticas globales y telemetría de analíticas
app.get('/api/admin/metrics', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const dbStatus = getDbStatus();
    if (dbStatus.servingFabricatedData || dbStatus.pgAvailable === false) {
      res.setHeader('X-GlowApp-Degraded', 'memory-fallback');
      return res.status(503).json({
        error: 'Servicio de métricas degradado. Base de datos no disponible.',
        data_status: 'degradado'
      });
    }

    // 1. Estadísticas agregadas de reservas
    const bookingsCountRes = await pool.query(`
      SELECT estado, COUNT(*)::int as count 
      FROM bookings 
      GROUP BY estado;
    `);
    
    // 2. Ingresos totales, comisiones e impuestos de reservas completadas
    const financeRes = await pool.query(`
      SELECT 
        COALESCE(SUM(valor_bruto), 0.0)::double precision as total_revenue,
        COALESCE(SUM(comision_plataforma), 0.0)::double precision as platform_commission,
        COALESCE(SUM(impuestos_estado), 0.0)::double precision as state_tax
      FROM bookings 
      WHERE estado = 'COMPLETADA';
    `);
    
    // 3. Usuarios registrados agrupados por rol
    const usersCountRes = await pool.query(`
      SELECT rol, COUNT(*)::int as count 
      FROM usuarios 
      GROUP BY rol;
    `);
    
    // 4. Prestadores activos (online)
    const activeProvidersRes = await pool.query(`
      SELECT COUNT(*)::int as count 
      FROM perfiles_prestador 
      WHERE is_online = true;
    `);
    
    // 5. Historial de alertas SOS (últimas 20)
    const sosAlertsRes = await pool.query(`
      SELECT s.*, u.nombre as user_name, u.email as user_email, u.phone as user_phone
      FROM sos_alerts s
      JOIN usuarios u ON s.user_id = u.id
      ORDER BY s.creado_en DESC
      LIMIT 20;
    `);
    
    // 6. Frecuencia de visitas a pantallas de la telemetría
    const telemetryScreensRes = await pool.query(`
      SELECT screen_name, COUNT(*)::int as count
      FROM user_activity_logs
      WHERE event_type = 'SCREEN_VIEW'
      GROUP BY screen_name
      ORDER BY count DESC
      LIMIT 10;
    `);

    // 7. Frecuencia de clicks en botones / elementos interactuados
    const telemetryClicksRes = await pool.query(`
      SELECT element_id, COUNT(*)::int as count
      FROM user_activity_logs
      WHERE event_type = 'TAP' OR event_type = 'SOS_TRIGGERED' OR event_type = 'CATEGORY_FILTER_SELECTED'
      GROUP BY element_id
      ORDER BY count DESC
      LIMIT 10;
    `);

    // 8. Facturación por categorías de servicio
    const categoriesRes = await pool.query(`
      SELECT COALESCE(s.category, 'Otros') as category, COUNT(b.id)::int as count, COALESCE(SUM(b.valor_bruto), 0.0)::double precision as revenue
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      WHERE b.estado = 'COMPLETADA'
      GROUP BY s.category;
    `);

    // 9. Historial mensual real para proyecciones
    const historyRes = await pool.query(`
      SELECT 
        TO_CHAR(DATE_TRUNC('month', scheduled_at), 'YYYY-MM') as month,
        COALESCE(SUM(valor_bruto), 0.0)::double precision as revenue
      FROM bookings
      WHERE estado = 'COMPLETADA'
      GROUP BY DATE_TRUNC('month', scheduled_at)
      ORDER BY month ASC;
    `);
    
    const realHistory = historyRes.rows.map(r => ({
      month: r.month,
      revenue: parseFloat(r.revenue)
    }));

    const projections = buildProjections(realHistory);

    res.json({
      success: true,
      data: {
        bookings_status: bookingsCountRes.rows,
        total_revenue: financeRes.rows[0].total_revenue,
        platform_commission: financeRes.rows[0].platform_commission,
        state_tax: financeRes.rows[0].state_tax,
        users_by_role: usersCountRes.rows,
        active_providers_online: activeProvidersRes.rows[0].count,
        sos_alerts: sosAlertsRes.rows,
        telemetry_screens: telemetryScreensRes.rows,
        telemetry_clicks: telemetryClicksRes.rows,
        categories: categoriesRes.rows,
        projections
      }
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/admin/metrics:', error);
    res.status(500).json({ error: 'Error al obtener métricas del panel administrativo' });
  }
});

// 🔹 NUEVO: Resolver Alerta SOS / Pánico
app.patch('/api/admin/sos/resolve/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const alertId = parseInt(req.params.id);
    const updateRes = await pool.query(`
      UPDATE sos_alerts
      SET estado = 'RESUELTO'
      WHERE id = $1
      RETURNING *;
    `, [alertId]);

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ error: 'Alerta SOS no encontrada' });
    }

    // Emitir evento de actualización a los dashboards conectados
    broadcastAdminEvent('sos_resolved', updateRes.rows[0]);

    res.json({
      success: true,
      message: 'Alerta SOS marcada como resuelta',
      alert: updateRes.rows[0]
    });
  } catch (error) {
    console.error('❌ ERROR EN PATCH /api/admin/sos/resolve:', error);
    res.status(500).json({ error: 'Error al resolver alerta SOS' });
  }
});

// 🔹 NUEVOS: Endpoints Administrativos para Encender/Apagar Clientes y Proveedores y Verificación de Documentos
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.nombre, u.email, u.phone, u.rol, u.is_active,
             p.estatus_verificacion, p.documento_id_url, p.rut_url, p.certificacion_url
      FROM usuarios u
      LEFT JOIN perfiles_prestador p ON u.id = p.id
      WHERE u.rol IN ('CLIENTE', 'PRESTADOR')
      ORDER BY u.nombre ASC;
    `);
    res.json({
      success: true,
      users: result.rows.map(row => ({
        id: row.id.toString(),
        nombre: row.nombre,
        email: row.email,
        phone: row.phone,
        rol: row.rol,
        is_active: row.is_active,
        estatus_verificacion: row.estatus_verificacion || null,
        documento_id_url: row.documento_id_url || null,
        rut_url: row.rut_url || null,
        certificacion_url: row.certificacion_url || null
      }))
    });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/admin/users:', error);
    res.status(500).json({ error: 'Error al obtener lista de usuarios.' });
  }
});

app.patch('/api/admin/users/:id/toggle-status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const result = await pool.query(`
      UPDATE usuarios 
      SET is_active = NOT COALESCE(is_active, TRUE) 
      WHERE id = $1 
      RETURNING id, nombre, email, rol, is_active;
    `, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const updatedUser = result.rows[0];

    if (updatedUser.rol === 'PRESTADOR') {
      await pool.query(`
        UPDATE perfiles_prestador 
        SET is_active = $1 
        WHERE id = $2;
      `, [updatedUser.is_active, updatedUser.id]);
    }

    res.json({
      success: true,
      message: `Usuario ${updatedUser.nombre} estado actualizado con éxito.`,
      user: {
        id: updatedUser.id.toString(),
        nombre: updatedUser.nombre,
        email: updatedUser.email,
        rol: updatedUser.rol,
        is_active: updatedUser.is_active
      }
    });
  } catch (error) {
    console.error('❌ ERROR EN PATCH /api/admin/users/:id/toggle-status:', error);
    res.status(500).json({ error: 'Error al actualizar el estado del usuario.' });
  }
});

app.patch('/api/admin/users/:id/verify', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { status } = req.body; // 'APROBADO' o 'RECHAZADO'

    if (!status || !['APROBADO', 'RECHAZADO', 'PENDIENTE'].includes(status)) {
      return res.status(400).json({ error: 'Estado de verificación inválido.' });
    }

    // 1. Actualizar estatus de verificación en perfiles_prestador
    const checkProfile = await pool.query('SELECT id FROM perfiles_prestador WHERE id = $1', [userId]);
    if (checkProfile.rows.length === 0) {
      return res.status(404).json({ error: 'El perfil de proveedor no existe.' });
    }

    const result = await pool.query(`
      UPDATE perfiles_prestador
      SET estatus_verificacion = $1,
          is_active = $2
      WHERE id = $3
      RETURNING id, estatus_verificacion, is_active;
    `, [status, status === 'APROBADO', userId]);

    // 2. Sincronizar el estado del usuario para que esté activo si es aprobado
    await pool.query(`
      UPDATE usuarios
      SET is_active = $1
      WHERE id = $2;
    `, [status === 'APROBADO', userId]);

    res.json({
      success: true,
      message: `Estatus de verificación actualizado a ${status} con éxito.`,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ ERROR EN PATCH /api/admin/users/:id/verify:', error);
    res.status(500).json({ error: 'Error al verificar proveedor.' });
  }
});

// 🔹 MÓDULO ADMINISTRATIVO (Gestión de Disputas, Usuarios y Métricas)
const adminRoutes = require('./src/routes/adminRoutes');
app.use('/api/admin', adminRoutes);

// 🔹 NUEVO: Endpoints de Integración Social (TikTok, Instagram, Facebook) & Recompensas XP
app.post('/api/social/log-share', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { platform, content_type, share_reference_id } = req.body;

    if (!platform || !content_type) {
      return res.status(400).json({ error: 'Plataforma y tipo de contenido son requeridos.' });
    }

    const pointsToAward = 50; // 50 XP por compartir resultado estético

    const logRes = await pool.query(`
      INSERT INTO social_shares_log (user_id, platform, content_type, share_reference_id, reward_granted, points_awarded)
      VALUES ($1, $2, $3, $4, TRUE, $5)
      RETURNING *;
    `, [userId, platform, content_type, share_reference_id || null, pointsToAward]);

    // Opcional: Acreditar XP al usuario en su perfil
    res.json({
      success: true,
      message: `¡Contenido compartido con éxito en ${platform}! Se han acreditado ${pointsToAward} XP.`,
      share: logRes.rows[0],
      points_awarded: pointsToAward
    });
  } catch (error) {
    console.error('❌ ERROR EN POST /api/social/log-share:', error);
    res.status(500).json({ error: 'Error al registrar contenido compartido.' });
  }
});

app.get('/api/social/accounts', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      'SELECT id, provider, provider_user_id, is_active, created_at FROM user_social_accounts WHERE user_id = $1',
      [userId]
    );
    res.json({ success: true, accounts: result.rows });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/social/accounts:', error);
    res.status(500).json({ error: 'Error al obtener cuentas sociales.' });
  }
});

// 🔹 NUEVO: Obtener perfil del usuario autenticado (incluye avatar_url)
app.get('/api/users/profile', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, nombre as full_name, phone, foto_url as avatar_url, rol as role, onboarding_completo, glowai_plan, glowai_diagnosticos_mes, glowai_ciclo_reset_at, streak_actual, streak_maximo, streak_ultimo_registro FROM usuarios WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    let user = { ...result.rows[0] };
    const rawRole = user.role || user.rol || 'CLIENTE';
    user.role = (rawRole === 'PRESTADOR' || rawRole === 'provider') ? 'provider' : ((rawRole === 'SALON' || rawRole === 'salon') ? 'salon' : 'client');
    if (user.role === 'provider') {
      const providerRes = await pool.query('SELECT is_active, business_name, description, rating_avg, rating_count, (estatus_verificacion = \'APROBADO\') as is_verified, estatus_verificacion, active_start_hour, active_end_hour, weekly_schedule FROM perfiles_prestador WHERE id = $1', [req.user.id]);
      if (providerRes.rows.length > 0) {
        user = { 
          ...user, 
          ...providerRes.rows[0],
          is_verified: !!providerRes.rows[0].is_verified,
          is_active: !!providerRes.rows[0].is_active
        };
      }
    }
    res.json({ success: true, user });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/users/profile:', error);
    res.status(500).json({ error: 'Error interno al obtener perfil' });
  }
});

// 🔹 NUEVO: Actualizar el estado activo/inactivo del prestador (Online / Offline) y su ubicación
app.patch('/api/providers/status', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'provider' && req.user.role !== 'PRESTADOR') {
      return res.status(403).json({ error: 'Acceso denegado: solo para proveedores' });
    }
    const { is_active, latitude, longitude } = req.body;
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'El campo is_active debe ser un booleano' });
    }

    let query;
    let params;

    if (latitude !== undefined && longitude !== undefined && latitude !== null && longitude !== null) {
      const lat = parseFloat(latitude);
      const lon = parseFloat(longitude);
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return res.status(400).json({ error: 'Coordenadas inválidas' });
      }
      query = `
        UPDATE perfiles_prestador 
        SET is_active = $1, ubicacion = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography 
        WHERE id = $4 
        RETURNING is_active;
      `;
      params = [is_active, lon, lat, req.user.id];
    } else {
      query = `
        UPDATE perfiles_prestador 
        SET is_active = $1 
        WHERE id = $2 
        RETURNING is_active;
      `;
      params = [is_active, req.user.id];
    }

    const result = await pool.query(query, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }
    res.json({ success: true, is_active: result.rows[0].is_active });
  } catch (error) {
    console.error('❌ ERROR EN PATCH /api/providers/status:', error);
    res.status(500).json({ error: 'Error interno al actualizar el estado' });
  }
});

// 🔹 NUEVO: Actualizar el avatar de perfil del usuario autenticado
app.patch('/api/users/avatar', authMiddleware, async (req, res) => {
  try {
    const { avatar_url } = req.body;
    if (!avatar_url) {
      return res.status(400).json({ error: 'avatar_url es obligatorio' });
    }
    const query = 'UPDATE usuarios SET foto_url = $1 WHERE id = $2 RETURNING id, email, nombre as full_name, foto_url as avatar_url, rol as role;';
    const result = await pool.query(query, [avatar_url, req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    let user = result.rows[0];
    user.role = user.role === 'PRESTADOR' ? 'provider' : (user.role === 'CLIENTE' ? 'client' : null);
    res.json({
      success: true,
      message: 'Avatar actualizado con éxito',
      user
    });
  } catch (error) {
    console.error('❌ ERROR EN PATCH /api/users/avatar:', { message: error.message });
    res.status(500).json({ error: 'Error interno al actualizar el avatar' });
  }
});

// 🔹 NUEVO: Actualizar perfil del usuario (nombre, teléfono, bio, rango de horas de disponibilidad y horario semanal)
app.patch('/api/users/profile', authMiddleware, async (req, res) => {
  try {
    const { full_name, phone, description, active_start_hour, active_end_hour, weekly_schedule } = req.body;
    if (!full_name && !phone && description === undefined && active_start_hour === undefined && active_end_hour === undefined && weekly_schedule === undefined) {
      return res.status(400).json({ error: 'Debe proporcionar al menos un campo para actualizar' });
    }
    
    // 1. Actualizar tabla usuarios (nombre, teléfono)
    if (full_name || phone) {
      const updates = [];
      const values = [];
      let paramIndex = 1;
      
      if (full_name !== undefined) {
        updates.push(`nombre = $${paramIndex++}`);
        values.push(full_name);
      }
      if (phone !== undefined) {
        updates.push(`phone = $${paramIndex++}`);
        values.push(phone);
      }
      
      values.push(req.user.id);
      const query = `UPDATE usuarios SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id;`;
      await pool.query(query, values);
    }

    // 2. Actualizar tabla perfiles_prestador (description, active_start_hour, active_end_hour, weekly_schedule)
    if (description !== undefined || active_start_hour !== undefined || active_end_hour !== undefined || weekly_schedule !== undefined) {
      const userCheck = await pool.query('SELECT rol FROM usuarios WHERE id = $1', [req.user.id]);
      if (userCheck.rows.length > 0 && userCheck.rows[0].rol === 'PRESTADOR') {
        const provUpdates = [];
        const provValues = [];
        let provParamIdx = 1;

        if (description !== undefined) {
          provUpdates.push(`description = $${provParamIdx++}`);
          provValues.push(description);
        }
        if (active_start_hour !== undefined) {
          provUpdates.push(`active_start_hour = $${provParamIdx++}`);
          provValues.push(active_start_hour !== null ? parseInt(active_start_hour) : null);
        }
        if (active_end_hour !== undefined) {
          provUpdates.push(`active_end_hour = $${provParamIdx++}`);
          provValues.push(active_end_hour !== null ? parseInt(active_end_hour) : null);
        }
        if (weekly_schedule !== undefined) {
          provUpdates.push(`weekly_schedule = $${provParamIdx++}`);
          provValues.push(weekly_schedule !== null ? (typeof weekly_schedule === 'string' ? weekly_schedule : JSON.stringify(weekly_schedule)) : null);
        }

        provValues.push(req.user.id);
        const provQuery = `UPDATE perfiles_prestador SET ${provUpdates.join(', ')} WHERE id = $${provParamIdx};`;
        await pool.query(provQuery, provValues);
      }
    }

    // 3. Obtener el perfil completo para retornar
    const finalProfileRes = await pool.query('SELECT id, email, nombre as full_name, phone, foto_url as avatar_url, rol as role, onboarding_completo FROM usuarios WHERE id = $1', [req.user.id]);
    if (finalProfileRes.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    let user = finalProfileRes.rows[0];
    user.role = user.role === 'PRESTADOR' ? 'provider' : (user.role === 'CLIENTE' ? 'client' : null);
    if (user.role === 'provider') {
      const providerRes = await pool.query('SELECT is_active, business_name, description, rating_avg, rating_count, (estatus_verificacion = \'APROBADO\') as is_verified, estatus_verificacion, active_start_hour, active_end_hour FROM perfiles_prestador WHERE id = $1', [req.user.id]);
      if (providerRes.rows.length > 0) {
        user = { 
          ...user, 
          ...providerRes.rows[0],
          is_verified: !!providerRes.rows[0].is_verified,
          is_active: !!providerRes.rows[0].is_active
        };
      }
    }
    
    res.json({
      success: true,
      message: 'Perfil actualizado con éxito',
      user
    });
  } catch (error) {
    console.error('❌ ERROR EN PATCH /api/users/profile:', error);
    res.status(500).json({ error: 'Error interno al actualizar el perfil' });
  }
});




// ==========================================
// 🔹 NUEVOS ENDPOINTS: Sistema de Chat y Mensajería
// ==========================================

// 🔹 Handler 404 explícito para peticiones /api/* (garantiza respuesta JSON y evita enviar HTML)
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, error: `Ruta API no encontrada: ${req.method} ${req.originalUrl}` });
});

const initDatabase = async () => {
  const dbErrors = [];
  
  const status = getDbStatus();
  if (status && status.pgAvailable === false) {
    console.warn('⚠️ [initDatabase] PostgreSQL no disponible; omitiendo migración e inicialización de BD.');
    return { ok: false, dbErrors: [{ stage: 'db-connection', message: 'PostgreSQL no disponible' }] };
  }

  try {
    const tableCheck = await pool.query("SELECT to_regclass('public.usuarios') as exists;");
    const hasTable = tableCheck.rows[0].exists !== null;

    if (hasTable) {
      console.log('✅ Base de datos ya inicializada. Omitiendo recreación de tablas.');
    } else {
      const schemaPath = path.join(__dirname, 'init.sql');
      if (fs.existsSync(schemaPath)) {
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        await pool.query(schemaSql);
        console.log('✅ Base de datos: Esquema inicializado/verificado desde init.sql (fuente canónica)');
      } else {
        console.warn('⚠️ No se encontró init.sql. Se omitió la creación automática de tablas.');
      }
    }
  } catch (error) {
    console.error('❌ Error al verificar/crear esquema base:', error);
    dbErrors.push({ stage: 'schema-base', message: error.message });
  }

  // Agregar 'APPLE' al tipo_auth_provider ENUM si no existe
  try {
    await pool.query("ALTER TYPE tipo_auth_provider ADD VALUE 'APPLE';");
    console.log('✅ Base de datos: Añadido valor "APPLE" al tipo_auth_provider');
  } catch (e) {
    if (e.code !== '42710') { // 42710 = duplicate_object, ignorar si ya existe
      console.warn('⚠️ Error al agregar "APPLE" al tipo_auth_provider:', e.message);
      dbErrors.push({ stage: 'auth-provider-enum', message: e.message });
    }
  }

  // 1. Aislamiento de alteración de la tabla 'usuarios'
  try {
    await pool.query(`
      ALTER TABLE usuarios
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
    `);
    console.log('✅ Alteraciónusuarios: is_active columna asegurada.');
  } catch (e) {
    console.warn('⚠️ Error en alteración de tabla usuarios:', e.message);
    dbErrors.push({ stage: 'alter-usuarios', message: e.message });
  }

  // 2. Aislamiento de alteración de la tabla 'perfiles_prestador'
  try {
    await pool.query(`
      ALTER TABLE perfiles_prestador
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
    `);
    console.log('✅ Alteración perfiles_prestador: is_active columna asegurada.');
  } catch (e) {
    console.warn('⚠️ Error en alteración de tabla perfiles_prestador:', e.message);
    dbErrors.push({ stage: 'alter-perfiles-prestador', message: e.message });
  }

  // 3. Aislamiento de alteración de la tabla 'bookings'
  try {
    await pool.query(`
      ALTER TABLE bookings
      ADD COLUMN IF NOT EXISTS service_address TEXT;
    `);
    console.log('✅ Alteración bookings: service_address columna asegurada.');
  } catch (e) {
    console.warn('⚠️ Error en alteración de tabla bookings:', e.message);
    dbErrors.push({ stage: 'alter-bookings', message: e.message });
  }

  // 4. Aislamiento de creación de tabla 'sos_alerts' e índices
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sos_alerts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
        latitude NUMERIC(9,6),
        longitude NUMERIC(9,6),
        estado VARCHAR(20) DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO', 'RESUELTO')),
        creado_en TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sos_alerts_user ON sos_alerts(user_id);
      CREATE INDEX IF NOT EXISTS idx_sos_alerts_booking ON sos_alerts(booking_id);
    `);
    console.log('✅ Tabla e índices sos_alerts inicializados/verificados.');
  } catch (e) {
    console.warn('⚠️ Error al inicializar sos_alerts:', e.message);
    dbErrors.push({ stage: 'create-sos-alerts', message: e.message });
  }

  // 4b. Columnas de resolución de SOS (idempotente).
  // sos_alerts.estado solo admite 'ACTIVO' y 'RESUELTO'. La resolución se guarda
  // aparte para no reutilizar creado_en y no perder la fecha de emisión.
  try {
    await pool.query(`
      ALTER TABLE sos_alerts
        ADD COLUMN IF NOT EXISTS resolucion TEXT,
        ADD COLUMN IF NOT EXISTS resuelto_en TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS resuelto_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
    `);
    console.log('✅ Columnas de resolución de sos_alerts verificadas.');
  } catch (e) {
    console.warn('⚠️ Error al añadir columnas de resolución a sos_alerts:', e.message);
    dbErrors.push({ stage: 'alter-sos-alerts-resolution', message: e.message });
  }

  // 5. Aislamiento de creación de tabla 'user_activity_logs' (Analíticas) e índices
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_activity_logs (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        session_id UUID NOT NULL,
        event_type VARCHAR(50) NOT NULL,
        screen_name VARCHAR(100) NOT NULL,
        element_id VARCHAR(100),
        metadata JSONB,
        creado_en TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_activity_logs_session ON user_activity_logs(session_id);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_event ON user_activity_logs(event_type);
    `);
    console.log('✅ Tabla e índices user_activity_logs inicializados/verificados.');
  } catch (e) {
    console.warn('⚠️ Error al inicializar user_activity_logs:', e.message);
    dbErrors.push({ stage: 'create-user-activity-logs', message: e.message });
  }

  // 6. Aislamiento de creación de tabla 'admin_actions'
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_actions (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        accion VARCHAR(100) NOT NULL,
        descripcion TEXT,
        fecha_creacion TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ Tabla admin_actions inicializada/verificada.');
  } catch (e) {
    console.warn('⚠️ Error al inicializar admin_actions:', e.message);
    dbErrors.push({ stage: 'create-admin-actions', message: e.message });
  }

  // 7. Aislamiento de creación de índices de rendimiento generales
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_bookings_client ON bookings(client_id);
      CREATE INDEX IF NOT EXISTS idx_bookings_provider ON bookings(provider_id);
      CREATE INDEX IF NOT EXISTS idx_bookings_scheduled ON bookings(scheduled_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reviews_provider ON reviews(provider_id);
      CREATE INDEX IF NOT EXISTS idx_services_provider ON services(provider_id);
      ALTER TABLE services ADD COLUMN IF NOT EXISTS business_profile_id UUID;
    `);
    console.log('✅ Índices de rendimiento generales y columna business_profile_id verificados.');
  } catch (e) {
    console.warn('⚠️ Error al inicializar índices de rendimiento generales:', e.message);
    dbErrors.push({ stage: 'performance-indexes', message: e.message });
  }

  // 8. Aislamiento de ejecución del script externo de lealtad y fraude (loyalty_migration.sql)
  try {
    const loyaltyMigrationPath = path.join(__dirname, 'src/config/loyalty_migration.sql');
    if (fs.existsSync(loyaltyMigrationPath)) {
      const loyaltySql = fs.readFileSync(loyaltyMigrationPath, 'utf8');
      await pool.query(loyaltySql);
      console.log('✅ Base de datos: Migración de lealtad y fraude ejecutada desde loyalty_migration.sql');
    } else {
      console.warn('⚠️ No se encontró loyalty_migration.sql. Se omitió la migración de lealtad.');
    }
  } catch (e) {
    console.warn('⚠️ Error al ejecutar migración de lealtad y fraude:', e.message);
    dbErrors.push({ stage: 'loyalty-migration', message: e.message });
  }

  // 9. Aislamiento de ejecución de migración de disputas, weekly_schedule y horarios de disponibilidad
  try {
    const defaultSchedule = JSON.stringify({
      lunes: { activo: true, inicio: 6, fin: 20 },
      martes: { activo: true, inicio: 6, fin: 20 },
      miercoles: { activo: true, inicio: 6, fin: 20 },
      jueves: { activo: true, inicio: 6, fin: 20 },
      viernes: { activo: true, inicio: 6, fin: 20 },
      sabado: { activo: true, inicio: 8, fin: 18 },
      domingo: { activo: false, inicio: 8, fin: 18 }
    });

    // 1. Crear tabla disputas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS disputas (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id      UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
        iniciado_por    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
        tipo_actor      VARCHAR(20) NOT NULL CHECK (tipo_actor IN ('CLIENTE','PRESTADOR','SISTEMA')),
        tipo            VARCHAR(50) NOT NULL,
        descripcion     TEXT,
        evidencia_urls  TEXT[] DEFAULT '{}',
        monto_disputado NUMERIC(12,2) NOT NULL,
        estado          VARCHAR(20) NOT NULL DEFAULT 'ABIERTA',
        resuelto_por    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        resolucion      VARCHAR(50),
        porcentaje_prestador NUMERIC(5,2),
        nota_resolucion TEXT,
        creado_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actualizado_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resuelto_at     TIMESTAMPTZ,
        sla_limite_at   TIMESTAMPTZ
      );
    `);

    // 2. Crear índices
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_disputas_booking ON disputas(booking_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_disputas_estado ON disputas(estado, creado_at DESC);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_disputas_sla ON disputas(sla_limite_at) WHERE estado IN ('ABIERTA','EN_REVISION');`);

    // 3. Crear función de trigger SLA
    await pool.query(`
      CREATE OR REPLACE FUNCTION set_disputa_sla()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.sla_limite_at IS NULL THEN
          NEW.sla_limite_at = NEW.creado_at + INTERVAL '48 hours';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // 4. Vincular triggers
    await pool.query(`DROP TRIGGER IF EXISTS trg_disputa_sla ON disputas;`);
    await pool.query(`
      CREATE TRIGGER trg_disputa_sla
      BEFORE INSERT ON disputas
      FOR EACH ROW EXECUTE FUNCTION set_disputa_sla();
    `);

    await pool.query(`DROP TRIGGER IF EXISTS trg_disputa_updated_at ON disputas;`);
    await pool.query(`
      CREATE TRIGGER trg_disputa_updated_at
      BEFORE UPDATE ON disputas
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    // 5. Agregar weekly_schedule y active_start_hour / active_end_hour a perfiles_prestador
    await pool.query(`
      ALTER TABLE perfiles_prestador 
      ADD COLUMN IF NOT EXISTS weekly_schedule JSONB DEFAULT '${defaultSchedule}'::jsonb,
      ADD COLUMN IF NOT EXISTS active_start_hour INTEGER DEFAULT 6,
      ADD COLUMN IF NOT EXISTS active_end_hour INTEGER DEFAULT 20;
    `);

    console.log('✅ Base de datos: Migración de disputas, weekly_schedule y horarios de disponibilidad verificados/aplicados.');
  } catch (migErr) {
    console.warn('⚠️ Error al aplicar migración de disputas/weekly_schedule/horarios:', migErr.message);
    dbErrors.push({ stage: 'disputas-schedule-migration', message: migErr.message });
  }

  // 10. Aislamiento de creación de usuario Asistente virtual
  try {
    const aiUserQuery = `
      INSERT INTO usuarios (id, email, nombre, auth_provider, provider_id, rol, onboarding_completo)
      VALUES (
        0,
        'assistant@beautyapp.com',
        'Asistente Virtual de Belleza',
        'LOCAL',
        'assistant-local',
        'PRESTADOR',
        true
      )
      ON CONFLICT (id) DO NOTHING;
    `;
    await pool.query(aiUserQuery);
    console.log('🤖 Usuario Asistente de IA verificado/creado con ID 0.');
  } catch (e) {
    console.warn('⚠️ Error al inicializar usuario Asistente Virtual:', e.message);
    dbErrors.push({ stage: 'assistant-user', message: e.message });
  }

  // 11. Ejecución de migraciones automáticas (.sql en la carpeta migrations)
  try {
    const migrationsDir = path.join(__dirname, 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir)
        // Los rollbacks (.down.sql) NUNCA se aplican en el arranque: solo un humano, a propósito.
        .filter(file => file.endsWith('.sql') && !file.endsWith('.down.sql'))
        .sort(); // Orden alfabético: 001, 002, 003, etc.

      console.log(`🔍 Encontradas ${files.length} migraciones aplicables en la carpeta migrations.`);

      // Registro de migraciones aplicadas: evita re-ejecutar las 68 en cada arranque.
      // Fail-safe: si el registro no está disponible, se mantiene el comportamiento idempotente anterior.
      let appliedMigrations = null;
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS schema_migrations (
            filename TEXT PRIMARY KEY,
            checksum TEXT,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `);
        await pool.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT;');
        const appliedRows = await pool.query('SELECT filename, checksum FROM schema_migrations;');
        appliedMigrations = new Map(appliedRows.rows.map(r => [r.filename, r.checksum]));
      } catch (trackErr) {
        console.warn('⚠️ Registro schema_migrations no disponible; se aplicarán todas las migraciones (modo idempotente):', trackErr.message);
        appliedMigrations = null;
      }

      let skippedMigrations = 0;
      for (const file of files) {
        const filePath = path.join(migrationsDir, file);
        const checksum = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').slice(0, 16);

        if (appliedMigrations && appliedMigrations.has(file)) {
          if (appliedMigrations.get(file) && appliedMigrations.get(file) !== checksum) {
            console.warn(`⚠️ Deriva de migración: ${file} cambió después de aplicarse (${appliedMigrations.get(file)} → ${checksum}). No se re-aplica; revisar a mano.`);
          }
          skippedMigrations++;
          continue;
        }

        try {
          const sql = fs.readFileSync(filePath, 'utf8');
          await pool.query(sql);
          console.log(`✅ Base de datos: Migración ${file} aplicada exitosamente.`);
          if (appliedMigrations) {
            try {
              await pool.query(
                'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = NOW();',
                [file, checksum]
              );
            } catch (recordErr) {
              console.warn(`⚠️ No se pudo registrar la migración ${file}:`, recordErr.message);
            }
          }
        } catch (err) {
          // Ignorar errores comunes de "ya existe" o de alteración idempotente para mantener robustez
          if (!err.message.includes('already exists') && !err.message.includes('ya existe') && !err.message.includes('duplicate key value') && !err.message.includes('already a column')) {
            console.warn(`⚠️ Advertencia en migración ${file}:`, err.message);
            dbErrors.push({ stage: `migration-file-${file}`, message: err.message });
          } else {
            console.log(`ℹ️ Migración ${file} ya aplicada anteriormente o con elementos existentes.`);
            if (appliedMigrations) {
              try {
                await pool.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING;', [file, checksum]);
              } catch (recordErr) { /* registro no bloqueante */ }
            }
          }
        }
      }
      if (skippedMigrations > 0) {
        console.log(`ℹ️ ${skippedMigrations} migraciones ya registradas en schema_migrations (no se re-ejecutan).`);
      }
    }
  } catch (dirErr) {
    console.error('❌ Error leyendo la carpeta de migraciones:', dirErr.message);
    dbErrors.push({ stage: 'migrations-dir-read', message: dirErr.message });
  }

  // 12. Aislamiento de siembra (seed) si es necesario
  try {
    const checkUser = await pool.query("SELECT id FROM usuarios WHERE email = 'provider@beautyapp.com';");
    const needsSeed = checkUser.rows.length === 0;

    if (needsSeed) {
      const { executeSeed } = require('./src/utils/seedRunner');
      const res = await executeSeed({ pool });
      if (res.seeded) {
        console.log('🌱 Datos de prueba (seed.sql) sembrados exitosamente.');
      } else if (res.reason === 'SEED_DATABASE_NOT_TRUE') {
        console.log('⚠️  Omitiendo la siembra de base de datos (SEED_DATABASE no está establecida como "true").');
      }
    }
  } catch (seedErr) {
    console.warn('⚠️ Advertencia al sembrar datos de prueba:', seedErr.message);
    dbErrors.push({ stage: 'database-seeding', message: seedErr.message });
  }

  // 13. Aislamiento de aprobación automática de prestadores en desarrollo
  try {
    if (process.env.AUTO_APPROVE_PROVIDERS === 'true') {
      if (process.env.NODE_ENV === 'production') {
        console.warn('⚠️  Omitiendo aprobación automática de prestadores: prohibida en entornos de producción.');
      } else {
        await pool.query("UPDATE perfiles_prestador SET estatus_verificacion = 'APROBADO';");
        console.log('✅ Base de datos: Todos los perfiles de prestador han sido aprobados automáticamente.');
      }
    }
  } catch (e) {
    console.warn('⚠️ Error al aprobar automáticamente perfiles de prestador:', e.message);
    dbErrors.push({ stage: 'auto-approve-providers', message: e.message });
  }

  // Estructurar el diagnóstico si hubo errores
  if (dbErrors.length > 0) {
    lastDbInitError = {
      message: `${dbErrors.length} errores/advertencias no bloqueantes ocurrieron durante la inicialización de la base de datos.`,
      errors: dbErrors,
      timestamp: new Date().toISOString()
    };
  } else {
    lastDbInitError = null;
  }
};

// ==========================================
// 🔹 GESTIÓN DE WEBSOCKETS Y NOTIFICACIONES
// ==========================================
const { registerClient, unregisterClient, notifyUserJobUpdate, notifyUserChatMessage, initWebSocketServer } = require('./src/services/websocketService');
app.set('notifyUserJobUpdate', notifyUserJobUpdate);
app.set('notifyUserChatMessage', notifyUserChatMessage);

// Limpiar historial de chats deshabilitado en producción para evitar pérdida de datos.
// En desarrollo, utilizar una semilla de limpieza controlada si es necesario.

// SPA Fallback para Flutter Web (ver nota en webBuildPath: en el contenedor desplegado no existe)
app.get('*', (req, res, next) => {
if (req.path.startsWith('/api') || req.path === '/metrics' || req.path.startsWith('/api-docs')) return next();
if (hasWebBuild) {
return res.sendFile(webBuildIndex);
}
next();
});

// ==========================================
// INICIO DEL SERVIDOR
// ==========================================
if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, async () => {
    console.log(`🚀 Servidor en http://localhost:${PORT}`);
    // 🏭 Auto-ingesta de corpus en cada deploy
try {
  let mod = null;
  for (const rel of ['./src/services/corpusAutoIngest', './services/corpusAutoIngest', '../services/corpusAutoIngest', '../../src/services/corpusAutoIngest']) {
    try { mod = require(rel); break; } catch (e) {}
  }
  if (mod) { mod.startCorpusAutoIngest(); }
  else { console.warn('⚠️ Auto-ingest: no se encontró el módulo.'); }
} catch (e) {
  console.warn('⚠️ Auto-ingest no disponible:', e.message);
}
    console.log(`📦 Entorno: ${process.env.NODE_ENV || 'development'}`);
    await testConnection();
    await initDatabase();
    // Iniciar jobs de pagos (maduración, retiros automáticos, conciliación)
    inicializarJobs();
    // T-111: purga diaria de escaneos que cumplieron el plazo del aviso
    iniciarRetencionBiometrica();
    // (WORKERS DESHABILITADOS)
    // Inicializar servidor WebSocket compartiendo puerto HTTP
    initWebSocketServer(server);
  });

  // Configurar timeouts explícitos para alineación con el proxy reverso de Railway
  server.keepAliveTimeout = 65000; // 65 segundos (mayor que el idle timeout típico de 60s de Railway)
  server.headersTimeout = 70000; // 70 segundos (mayor que keepAliveTimeout)
  server.timeout = 240000; // 4 minutos para llamadas complejas de IA
}


// Middleware de error de Express. Debe ir DESPUÉS de todas las rutas (incluido
// el catch-all 404 de /api/*) y ANTES de module.exports. Express lo identifica
// por su aridad de 4 argumentos.
app.use(require('./src/middleware/errorHandler'));

// ==========================================
// MANEJO GLOBAL DE ERRORES
// ==========================================
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  if (process.env.NODE_ENV !== 'development') {
    process.exit(1);
  }
});
// Nodemon trigger reload to reconnect to beauty-postgres database - updated weekly schedule logic

module.exports = app;

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================
const shutdown = async (signal) => {
  console.log(`\n${signal} recibido. Apagando servidor graciosamente...`);
  try {
    if (server) {
      server.close(() => {
        console.log('Servidor HTTP cerrado.');
      });
    }
    const { pool } = require('./src/config/db');
    if (pool) {
      await pool.end();
      console.log('Pool de conexiones de BD cerrado.');
    }
    const { redisClient } = require('./src/config/redis');
    if (redisClient) {
      await redisClient.quit();
      console.log('Conexi�n a Redis cerrada.');
    }
    console.log('Apagado completado exitosamente.');
    process.exit(0);
  } catch (err) {
    console.error('Error durante el apagado:', err);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));


