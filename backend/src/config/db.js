const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const pgMemory = require('./pgMemory');

// 🛡️ PARCHE DE SEGURIDAD Y AISLAMIENTO DE ENTORNOS
const isProduction = process.env.NODE_ENV === 'production';
const isStaging = process.env.NODE_ENV === 'staging';

if (isProduction && !process.env.DATABASE_URL) {
  console.warn('⚠️ [ENTORNO PRODUCCIÓN] DATABASE_URL no configurada explícitamente en producción.');
}

function getSslConfig(urlStr, hostStr) {
  const str = urlStr || '';
  const host = hostStr || process.env.DB_HOST || '';

  // El host puede venir DENTRO de la URL (DATABASE_URL). Antes solo se miraba DB_HOST, así que
  // cualquier DATABASE_URL —incluida una local de desarrollo— activaba SSL y el servidor
  // respondía "The server does not support SSL connections".
  let hostDeUrl = '';
  try {
    hostDeUrl = new URL(str).hostname;
  } catch (_) {
    hostDeUrl = '';
  }
  const esLocal = (h) => h === 'localhost' || h === '127.0.0.1' || h === '::1';

  if (
    str.includes('railway.internal') ||
    host.includes('railway.internal') ||
    esLocal(host) ||
    esLocal(hostDeUrl)
  ) {
    return false;
  }
  if (str || isProduction || isStaging) {
    return { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' };
  }
  return false;
}

// ── Límites de tiempo del pool ───────────────────────────────────────────────
// `connectionTimeoutMillis` solo cubre la ADQUISICIÓN de una conexión libre: no
// limita una consulta ya lanzada ni una transacción que queda abierta. Sin esos
// límites, un statement atascado retiene la conexión indefinidamente y el pool
// se agota sin que ninguna consulta haya fallado. Se fijan los tres que faltan,
// configurables por entorno para poder ajustarlos por despliegue:
//   DB_STATEMENT_TIMEOUT_MS              cancelación en servidor (PostgreSQL)
//   DB_QUERY_TIMEOUT_MS                  red de seguridad del cliente (pg)
//   DB_IDLE_IN_TRANSACTION_TIMEOUT_MS    mata transacciones que quedan idle
function msDesdeEntorno(nombre, porDefecto) {
  const crudo = process.env[nombre];
  const valor = crudo === undefined || crudo === '' ? porDefecto : parseInt(crudo, 10);
  return Number.isInteger(valor) && valor > 0 ? valor : porDefecto;
}

const CONNECTION_TIMEOUT_MS = msDesdeEntorno('DB_CONNECTION_TIMEOUT_MS', 5000);
const IDLE_TIMEOUT_MS = msDesdeEntorno('DB_IDLE_TIMEOUT_MS', 30000);
const STATEMENT_TIMEOUT_MS = msDesdeEntorno('DB_STATEMENT_TIMEOUT_MS', 30000);
// Por encima de statement_timeout: el servidor debe cancelar primero (error
// limpio y conexión reutilizable); query_timeout solo entra si eso no ocurre.
const QUERY_TIMEOUT_MS = msDesdeEntorno('DB_QUERY_TIMEOUT_MS', STATEMENT_TIMEOUT_MS + 5000);
const IDLE_IN_TRANSACTION_TIMEOUT_MS = msDesdeEntorno('DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', 30000);

const rawPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(process.env.DATABASE_URL ? {} : {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'beauty_db',
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
  }),
  ssl: getSslConfig(process.env.DATABASE_URL, process.env.DB_HOST),
  max: isProduction ? 30 : 20,
  connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  idleTimeoutMillis: IDLE_TIMEOUT_MS,
  // Sin límite de consulta, un statement colgado (lock, tabla bloqueada, red a
  // medias) retenía la conexión para siempre y el proceso se quedaba sin pool
  // sin que ninguna consulta hubiera fallado. statement_timeout lo cancela en
  // el servidor (error limpio, conexión reutilizable); query_timeout es la red
  // de seguridad del cliente, por eso va por encima de statement_timeout.
  statement_timeout: STATEMENT_TIMEOUT_MS,
  query_timeout: QUERY_TIMEOUT_MS,
  idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
});

rawPool.on('error', (err) => {
  console.error('❌ Error inesperado en el pool de PostgreSQL:', err.message);
});

// ── In-Memory Resilient Fallback for Local Dev/Demo when PostgreSQL is offline ──
const memoryUsers = new Map();
const memorySalones = new Map();
const memorySalonMiembros = [];
const memoryBookings = [];

async function initDefaultUsers() {
  const hash = await bcrypt.hash('password123', 10);
  const hash2 = await bcrypt.hash('Password123!', 10);

  const addDemoUser = (id, email, name, role) => {
    const userObj = {
      id: id,
      nombre: name,
      email: email,
      password_hash: hash,
      phone: '3001234567',
      auth_provider: 'LOCAL',
      provider_id: `local_${email}`,
      rol: role,
      onboarding_completo: true,
      is_active: true
    };
    memoryUsers.set(email, userObj);
    return userObj;
  };

  addDemoUser(1, 'demo1@demo.com', 'Demo Salón 1', 'SALON');
  addDemoUser(2, 'salondemo@salon.com', 'Salón Demo', 'SALON');
  addDemoUser(3, 'salon@demo.com', 'Salón Demo', 'SALON');
  addDemoUser(4, 'admin@demo.com', 'Admin Demo', 'ADMIN');
  addDemoUser(5, 'cliente@demo.com', 'Cliente Demo', 'CLIENTE');
  addDemoUser(6, 'prestador@demo.com', 'Prestador Demo', 'PRESTADOR');

  // Owner user with 3 years SaaS history
  const propietario = addDemoUser(10, 'propietario@salonglow.com', 'Carlos Mendoza (Owner)', 'SALON');

  // Staff members
  const sofia = addDemoUser(11, 'sofia.lopez@salonglow.com', 'Sofía López', 'SALON');
  const mateo = addDemoUser(12, 'mateo.ruiz@salonglow.com', 'Mateo Ruíz', 'PRESTADOR');
  const valentina = addDemoUser(13, 'valentina.gomez@salonglow.com', 'Valentina Gómez', 'PRESTADOR');
  const camila = addDemoUser(14, 'camila.torres@salonglow.com', 'Camila Torres', 'PRESTADOR');
  const andres = addDemoUser(15, 'andres.morales@salonglow.com', 'Andrés Morales', 'PRESTADOR');

  memoryUsers.set('nuevosalon@salon.com', {
    id: 99,
    nombre: 'Nuevo Salón (Pendiente)',
    email: 'nuevosalon@salon.com',
    password_hash: hash,
    phone: '3009998877',
    auth_provider: 'LOCAL',
    provider_id: 'local_nuevosalon@salon.com',
    rol: 'SALON',
    onboarding_completo: false,
    is_active: true
  });

  // Main Salon Instance for Propietario
  const mainSalon = {
    id: 1,
    nombre_salon: 'Salon Glow — Sede Principal Norte',
    nit: '901888777-1',
    direccion: 'Calle 127 # 7-18, Usaquén',
    telefono: '3109998877',
    ciudad: 'Bogotá',
    plan_saas: 'ENTERPRISE_PRO',
    id_dueno: 10,
    latitude: 4.7012,
    longitude: -74.0321,
    location_enabled: true,
    location_public: true,
  };
  memorySalones.set(1, mainSalon);

  // Salon members dataset
  memorySalonMiembros.push(
    { id: 1, salon_id: 1, user_id: 10, nombre: 'Carlos Mendoza', email: 'propietario@salonglow.com', phone: '3109998877', sub_rol: 'DUEÑO', estatus: 'ACTIVO', creado_at: '2023-01-15T10:00:00Z' },
    { id: 2, salon_id: 1, user_id: 11, nombre: 'Sofía López', email: 'sofia.lopez@salonglow.com', phone: '3124567890', sub_rol: 'ADMINISTRADOR', estatus: 'ACTIVO', creado_at: '2023-02-01T09:00:00Z' },
    { id: 3, salon_id: 1, user_id: 12, nombre: 'Mateo Ruíz', email: 'mateo.ruiz@salonglow.com', phone: '3157890123', sub_rol: 'PRESTADOR_INDEPENDIENTE', estatus: 'ACTIVO', creado_at: '2023-03-10T14:30:00Z' },
    { id: 4, salon_id: 1, user_id: 13, nombre: 'Valentina Gómez', email: 'valentina.gomez@salonglow.com', phone: '3203456789', sub_rol: 'PRESTADOR_INDEPENDIENTE', estatus: 'ACTIVO', creado_at: '2023-05-20T11:15:00Z' },
    { id: 5, salon_id: 1, user_id: 14, nombre: 'Camila Torres', email: 'camila.torres@salonglow.com', phone: '3186543210', sub_rol: 'EMPLEADO', estatus: 'ACTIVO', creado_at: '2023-08-01T08:00:00Z' },
    { id: 6, salon_id: 1, user_id: 15, nombre: 'Andrés Morales', email: 'andres.morales@salonglow.com', phone: '3001112233', sub_rol: 'EMPLEADO', estatus: 'ACTIVO', creado_at: '2024-01-10T10:00:00Z' }
  );

  // Bookings dataset for Salon Dashboard & Metrics
  memoryBookings.push(
    { id: 'b101', service_id: 1, provider_id: 10, client_id: 5, service_name: 'Balayage Cenizo + Hidratación Plex', client_name: 'Mariana Silva', scheduled_at: new Date().toISOString(), status: 'CONFIRMED', price: 320000, total_amount: 320000, provider_name: 'Valentina Gómez' },
    { id: 'b102', service_id: 2, provider_id: 10, client_id: 5, service_name: 'Corte Caballero Premium + Barba', client_name: 'Alejandro Morales', scheduled_at: new Date().toISOString(), status: 'CONFIRMED', price: 65000, total_amount: 65000, provider_name: 'Mateo Ruíz' },
    { id: 'b103', service_id: 3, provider_id: 10, client_id: 5, service_name: 'Limpieza Facial Profunda Acneic', client_name: 'Laura Restrepo', scheduled_at: new Date(Date.now() + 3600000).toISOString(), status: 'IN_PROGRESS', price: 120000, total_amount: 120000, provider_name: 'Camila Torres' },
    { id: 'b104', service_id: 4, provider_id: 10, client_id: 5, service_name: 'Manicura Semipermanente Gel-X', client_name: 'Daniela Gutierrez', scheduled_at: new Date(Date.now() + 7200000).toISOString(), status: 'PENDING', price: 85000, total_amount: 85000, provider_name: 'Andrés Morales' },
    { id: 'b105', service_id: 5, provider_id: 10, client_id: 5, service_name: 'Ritual Keratina Orgánica Vegana', client_name: 'Carolina Botero', scheduled_at: new Date(Date.now() + 10800000).toISOString(), status: 'CONFIRMED', price: 280000, total_amount: 280000, provider_name: 'Valentina Gómez' }
  );
}

// ── BOOT SECURITY GUARD ──
if (process.env.NODE_ENV === 'production' && process.env.ALLOW_MEMORY_FALLBACK === 'true') {
  console.error('🚨 [CRITICAL SECURITY ERROR] ALLOW_MEMORY_FALLBACK is strictly prohibited in production! Aborting boot.');
  process.exit(1);
}

if (process.env.NODE_ENV !== 'production' && (process.env.ALLOW_MEMORY_FALLBACK === 'true' || process.env.NODE_ENV === 'test')) {
  initDefaultUsers();
}

function handleMemoryQuery(text, params = []) {
  servingFabricatedData = true;
  if (pgMemory.enabled && pgMemory.adapter && typeof pgMemory.adapter.query === 'function') {
    return pgMemory.adapter.query(text, params);
  }
  const queryStr = String(text).toUpperCase();

  // SELECT to_regclass
  if (queryStr.includes('TO_REGCLASS')) {
    return { rows: [{ exists: 'usuarios' }] };
  }

  // SELECT usuarios
  if (queryStr.includes('FROM USUARIOS')) {
    const emailParam = params.find(p => typeof p === 'string' && p.includes('@'));
    if (emailParam) {
      const cleanEmail = emailParam.trim().toLowerCase();
      let user = memoryUsers.get(cleanEmail);
      if (!user) {
        // Auto-crear usuario dinámico de pruebas con contraseña hash estándar (Password123!)
        user = {
          id: memoryUsers.size + 1,
          nombre: cleanEmail.split('@')[0],
          email: cleanEmail,
          password_hash: 'PLACEHOLDER_bcrypt_hash_set_via_env', // bcrypt hash placeholder
          auth_provider: 'LOCAL',
          provider_id: `local_${cleanEmail}`,
          rol: cleanEmail.includes('admin') ? 'ADMIN' : (cleanEmail.includes('salon') ? 'SALON' : (cleanEmail.includes('prestador') || cleanEmail.includes('provider') ? 'PRESTADOR' : 'CLIENTE')),
          onboarding_completo: true,
          is_active: true
        };
        memoryUsers.set(cleanEmail, user);
      }
      return { rows: user ? [user] : [] };
    }
    const idParam = params.find(p => typeof p === 'number' || (!isNaN(parseInt(p)) && p > 0));
    if (idParam) {
      const idNum = parseInt(idParam);
      for (const u of memoryUsers.values()) {
        if (u.id === idNum) return { rows: [u] };
      }
    }
    return { rows: Array.from(memoryUsers.values()) };
  }

  // INSERT usuarios
  if (queryStr.includes('INSERT INTO USUARIOS')) {
    const nombre = params[0] || 'Usuario Demo';
    const email = (params[1] || `user_${Date.now()}@demo.com`).toLowerCase();
    const password_hash = params[2] || '';
    const phone = params[3] || null;
    const providerId = params[4] || `local_${email}`;
    const rol = params[5] || 'CLIENTE';
    const onboarding = params[6] !== undefined ? params[6] : (rol === 'CLIENTE');

    const newUser = {
      id: memoryUsers.size + 1,
      nombre,
      email,
      password_hash,
      phone,
      auth_provider: 'LOCAL',
      provider_id: providerId,
      rol,
      onboarding_completo: onboarding,
      is_active: true
    };
    memoryUsers.set(email, newUser);
    return { rows: [newUser] };
  }

  // UPDATE usuarios
  if (queryStr.includes('UPDATE USUARIOS')) {
    let userToUpdate = null;
    for (const p of params) {
      if (p === undefined || p === null) continue;
      for (const u of memoryUsers.values()) {
        if (u.id == p || u.email == String(p).toLowerCase()) {
          userToUpdate = u;
          break;
        }
      }
      if (userToUpdate) break;
    }
    if (userToUpdate) {
      if (queryStr.includes('ONBOARDING_COMPLETO = TRUE') || queryStr.includes('ONBOARDING_COMPLETO = $')) {
        userToUpdate.onboarding_completo = true;
      }
      if (queryStr.includes('ROL =')) {
        const rolParam = params.find(p => ['CLIENTE', 'PRESTADOR', 'SALON'].includes(String(p).toUpperCase()));
        if (rolParam) userToUpdate.rol = rolParam.toUpperCase();
      }
      return { rows: [userToUpdate] };
    }
    return { rows: [{ id: params[0], onboarding_completo: true }] };
  }

  // Check perfiles_prestador
  if (queryStr.includes('FROM PERFILES_PRESTADOR') || queryStr.includes('PERFILES_PRESTADOR')) {
    const allProviders = [
      {
        id: '101',
        full_name: 'Carolina Mendoza Rios',
        business_name: 'Carolina Hair Studio',
        description: 'Especialista en Balayage y Colorimetria Avanzada',
        avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?q=80&w=200&auto=format&fit=crop',
        phone: '+573124567890',
        rating_avg: 4.8,
        rating_count: 10,
        is_verified: true,
        latitude: 4.6730,
        longitude: -74.1420,
        loyalty_tier: 'Avant-Garde Elite',
        distance_meters: 450
      },
      {
        id: '102',
        full_name: 'Santiago Castro Devia',
        business_name: 'Santiago Barber Shop',
        description: 'Barberia clasica y corte masculino moderno',
        avatar_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=200&auto=format&fit=crop',
        phone: '+573157890123',
        rating_avg: 4.7,
        rating_count: 8,
        is_verified: true,
        latitude: 4.6750,
        longitude: -74.1360,
        loyalty_tier: 'Visage Pro',
        distance_meters: 820
      },
      {
        id: '103',
        full_name: 'Valeria Sofia Tobon',
        business_name: 'Valeria Tobon Makeup',
        description: 'Maquillaje profesional para eventos y novias',
        avatar_url: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?q=80&w=200&auto=format&fit=crop',
        phone: '+573203456789',
        rating_avg: 4.9,
        rating_count: 15,
        is_verified: true,
        latitude: 4.6710,
        longitude: -74.1460,
        loyalty_tier: 'Avant-Garde Elite',
        distance_meters: 1100
      },
      {
        id: '104',
        full_name: 'Ana Silva Torres',
        business_name: 'Ana Silva Nail Art',
        description: 'Manicura semipermanente y extensiones de unas',
        avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=200&auto=format&fit=crop',
        phone: '+573159876543',
        rating_avg: 4.6,
        rating_count: 6,
        is_verified: true,
        latitude: 4.6720,
        longitude: -74.1385,
        loyalty_tier: 'Creative Edge',
        distance_meters: 1500
      },
      {
        id: '105',
        full_name: 'Diana Marcela Gomez',
        business_name: 'Diana Gomez Estetica',
        description: 'Tratamientos faciales, hidratacion y limpieza profunda',
        avatar_url: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=200&auto=format&fit=crop',
        phone: '+573186543210',
        rating_avg: 4.9,
        rating_count: 12,
        is_verified: true,
        latitude: 4.6780,
        longitude: -74.1310,
        loyalty_tier: 'Visage Pro',
        distance_meters: 980
      },
      {
        id: '3',
        full_name: 'Carlos Ruiz',
        business_name: 'Carlos Nails & Spa',
        description: 'Manicura semipermanente y nail art',
        avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&fit=crop',
        phone: '+573003334444',
        rating_avg: 4.0,
        rating_count: 5,
        is_verified: true,
        latitude: 4.6735,
        longitude: -74.1422,
        loyalty_tier: 'Visage Pro',
        distance_meters: 500
      },
      {
        id: '2',
        full_name: 'María López',
        business_name: 'Studio María Hair',
        description: 'Especialista en balayage y cortes modernos',
        avatar_url: 'https://images.unsplash.com/photo-1570158268183-d296b2892211?w=200&fit=crop',
        phone: '+573001112222',
        rating_avg: 4.8,
        rating_count: 10,
        is_verified: true,
        latitude: 4.6097,
        longitude: -74.0817,
        loyalty_tier: 'Avant-Garde Elite',
        distance_meters: 7500
      }
    ];

    const isSingleById = queryStr.includes('WHERE P.ID =') || queryStr.includes('WHERE P.ID=') || queryStr.includes('WHERE (P.ID =') || queryStr.includes('WHERE ID =');
    if (isSingleById && params.length > 0) {
      const targetId = String(params[0]);
      const found = allProviders.filter(p => String(p.id) === targetId);
      return { rows: found };
    }
    return { rows: allProviders };
  }

  // Check services
  if (queryStr.includes('FROM SERVICES')) {
    const allServices = [
      { id: 's101_1', provider_id: 101, name: 'Balayage Cenizo + Hidratacion Plex', description: 'Tecnica de iluminacion capilar ceniza con cuidado protector.', price: 320000, duration_minutes: 180, category: 'hair' },
      { id: 's101_2', provider_id: 101, name: 'Corte Tendencia + Cepillado', description: 'Corte moderno personalizado.', price: 65000, duration_minutes: 60, category: 'hair' },
      { id: 's102_1', provider_id: 102, name: 'Corte Premium + Perfilado de Barba', description: 'Corte y afeitado tradicional.', price: 45000, duration_minutes: 50, category: 'hair' },
      { id: 's102_2', provider_id: 102, name: 'Camuflaje de Canas Masculino', description: 'Servicio rapido de cobertura de canas.', price: 50000, duration_minutes: 40, category: 'hair' },
      { id: 's103_1', provider_id: 103, name: 'Maquillaje Social Premium', description: 'Maquillaje elegante de larga duracion.', price: 140000, duration_minutes: 75, category: 'makeup' },
      { id: 's103_2', provider_id: 103, name: 'Maquillaje de Novia (Con Prueba)', description: 'Maquillaje especial y prueba de estilo.', price: 280000, duration_minutes: 120, category: 'makeup' },
      { id: 's104_1', provider_id: 104, name: 'Manicura Semipermanente Profesional', description: 'Durabilidad garantizada con esmaltado semipermanente.', price: 55000, duration_minutes: 60, category: 'nails' },
      { id: 's104_2', provider_id: 104, name: 'Extension de Unas en Gel-X', description: 'Extensiones de unas elegantes.', price: 120000, duration_minutes: 100, category: 'nails' },
      { id: 's105_1', provider_id: 105, name: 'Limpieza Facial Profunda', description: 'Limpieza profunda de impurezas.', price: 95000, duration_minutes: 75, category: 'facials' },
      { id: 's105_2', provider_id: 105, name: 'Hidratacion Acido Hialuronico', description: 'Tratamiento facial hidratante intensivo.', price: 120000, duration_minutes: 60, category: 'facials' },
      { id: 's3_1', provider_id: 3, name: 'Manicura Semipermanente', description: 'Limpieza, limado y esmaltado duradero', price: 25000, duration_minutes: 60, category: 'nails' },
      { id: 's2_1', provider_id: 2, name: 'Corte + Lavado', description: 'Incluye diagnóstico capilar', price: 35000, duration_minutes: 45, category: 'hair' },
      { id: 's2_2', provider_id: 2, name: 'Balayage Completo', description: 'Técnica de iluminación personalizada', price: 120000, duration_minutes: 150, category: 'hair' }
    ];
    const idParam = params.find(p => p !== undefined && p !== null && !isNaN(parseInt(p)));
    if (idParam !== undefined) {
      return { rows: allServices.filter(s => String(s.provider_id) === String(idParam)) };
    }
    return { rows: allServices };
  }

  // Check portfolio_items
  if (queryStr.includes('FROM PORTFOLIO_ITEMS')) {
    const allPortfolio = [
      { id: 'p101_1', provider_id: 101, title: 'Balayage Cenizo Premium', image_url: 'https://images.unsplash.com/photo-1562322140-8baeececf3df?q=80&w=800', category: 'hair' },
      { id: 'p101_2', provider_id: 101, title: 'Cabello Iluminado Ondas', image_url: 'https://images.unsplash.com/photo-1492106087820-71f1a00d2b11?q=80&w=800', category: 'hair' },
      { id: 'p102_1', provider_id: 102, title: 'Mid Fade Clasico', image_url: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?q=80&w=800', category: 'hair' },
      { id: 'p102_2', provider_id: 102, title: 'Afeitado y Toalla Caliente', image_url: 'https://images.unsplash.com/photo-1621605815971-fbc98d665033?q=80&w=800', category: 'hair' },
      { id: 'p103_1', provider_id: 103, title: 'Maquillaje de Ojos Smokey', image_url: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?q=80&w=800', category: 'makeup' },
      { id: 'p103_2', provider_id: 103, title: 'Maquillaje Novia Natural', image_url: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?q=80&w=800', category: 'makeup' },
      { id: 'p104_1', provider_id: 104, title: 'Manicura Semipermanente Roja', image_url: 'https://images.unsplash.com/photo-1604654894610-df63bc536371?q=80&w=800', category: 'nails' },
      { id: 'p104_2', provider_id: 104, title: 'Diseno Frances Clasico', image_url: 'https://images.unsplash.com/photo-1629732047847-50b7ef46c3bb?q=80&w=800', category: 'nails' },
      { id: 'p105_1', provider_id: 105, title: 'Limpieza Facial Exfoliante', image_url: 'https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?q=80&w=800', category: 'facials' },
      { id: 'p3_1', provider_id: 3, title: 'Uñas Semipermanentes Pastel', image_url: 'https://images.unsplash.com/photo-1604654894610-df49068853b0?q=80&w=600', category: 'nails' },
      { id: 'p2_1', provider_id: 2, title: 'Rubio Balayage Cenizo', image_url: 'https://images.unsplash.com/photo-1562322140-8baeececf3df?q=80&w=600', category: 'hair' }
    ];
    const idParam = params.find(p => p !== undefined && p !== null && !isNaN(parseInt(p)));
    if (idParam !== undefined) {
      return { rows: allPortfolio.filter(item => String(item.provider_id) === String(idParam)) };
    }
    return { rows: allPortfolio };
  }

  // Check reviews
  if (queryStr.includes('FROM REVIEWS')) {
    const allReviews = [
      { id: 'r101', provider_id: 101, rating: 5, comment: 'El balayage me quedo increible! Super profesional y el cabello se siente muy hidratado.', client_name: 'Cliente Demo', created_at: new Date().toISOString() },
      { id: 'r102', provider_id: 102, rating: 5, comment: 'Excelente perfilado de barba y el trato premium fue inmejorable.', client_name: 'Cliente Demo', created_at: new Date().toISOString() },
      { id: 'r103', provider_id: 103, rating: 5, comment: 'El maquillaje social me duro toda la noche intacto. Excelente tecnica!', client_name: 'Cliente Demo', created_at: new Date().toISOString() },
      { id: 'r104', provider_id: 104, rating: 5, comment: 'Las extensiones de Gel-X quedaron super naturales y muy resistentes.', client_name: 'Cliente Demo', created_at: new Date().toISOString() },
      { id: 'r105', provider_id: 105, rating: 5, comment: 'Excelente tratamiento facial, la piel queda muy suave e hidratada.', client_name: 'Cliente Demo', created_at: new Date().toISOString() },
      { id: 'r3', provider_id: 3, rating: 4, comment: 'Buen servicio de manicure.', client_name: 'Ana Gómez', created_at: new Date().toISOString() },
      { id: 'r2', provider_id: 2, rating: 5, comment: 'Muy puntual y el corte excelente.', client_name: 'Ana Gómez', created_at: new Date().toISOString() }
    ];
    const idParam = params.find(p => p !== undefined && p !== null && !isNaN(parseInt(p)));
    if (idParam !== undefined) {
      return { rows: allReviews.filter(rev => String(rev.provider_id) === String(idParam)) };
    }
    return { rows: allReviews };
  }

  // INSERT INTO salones
  if (queryStr.includes('INSERT INTO SALONES')) {
    const nombre_salon = params[0] || 'Salón de Belleza';
    const nit = params[1] || null;
    const direccion = params[2] || null;
    const telefono = params[3] || null;
    const ciudad = params[4] || null;
    const id_dueno = params[5] || 1;
    const plan_saas = 'FREE_TRIAL';

    const newSalon = {
      id: memorySalones.size + 10,
      nombre_salon,
      nit,
      direccion,
      telefono,
      ciudad,
      id_dueno,
      plan_saas
    };
    memorySalones.set(newSalon.id, newSalon);

    for (const u of memoryUsers.values()) {
      if (u.id == id_dueno) {
        u.rol = 'SALON';
        u.onboarding_completo = true;
      }
    }
    return { rows: [newSalon] };
  }

  // INSERT INTO salon_miembros
  if (queryStr.includes('INSERT INTO SALON_MIEMBROS')) {
    const salon_id = params[0] || 1;
    const user_id = params[1] || 1;
    const sub_rol = params[2] || 'DUEÑO';
    const estatus = params[3] || 'ACTIVO';
    const member = { id: memorySalonMiembros.length + 1, salon_id, user_id, sub_rol, estatus };
    memorySalonMiembros.push(member);
    return { rows: [member] };
  }

  // Check bookings
  if (queryStr.includes('BOOKINGS')) {
    return { rows: memoryBookings };
  }

  // Check business_profiles
  if (queryStr.includes('BUSINESS_PROFILES')) {
    return {
      rows: [
        { id: 'bp-glow-norte', owner_user_id: 10, name: 'Salon Glow — Sede Norte', address: 'Calle 127 # 7-18', city: 'Bogotá', created_at: '2023-01-15T10:00:00Z' },
        { id: 'bp-glow-chapinero', owner_user_id: 10, name: 'Salon Glow — Sede Chapinero', address: 'Carrera 13 # 63-24', city: 'Bogotá', created_at: '2023-06-01T10:00:00Z' },
        { id: 'bp-glow-zonat', owner_user_id: 10, name: 'Salon Glow — Sede Zona T', address: 'Calle 82 # 12-10', city: 'Bogotá', created_at: '2024-01-15T10:00:00Z' }
      ]
    };
  }

  // Check memberships
  if (queryStr.includes('MEMBERSHIPS')) {
    return {
      rows: [
        { id: 'mem-1', user_id: 10, business_profile_id: 'bp-glow-norte', role: 'OWNER', is_active: true },
        { id: 'mem-2', user_id: 10, business_profile_id: 'bp-glow-chapinero', role: 'OWNER', is_active: true },
        { id: 'mem-3', user_id: 10, business_profile_id: 'bp-glow-zonat', role: 'OWNER', is_active: true }
      ]
    };
  }

  // Check salones / salon_miembros
  if (queryStr.includes('JOIN USUARIOS') && queryStr.includes('SALON_MIEMBROS')) {
    return { rows: memorySalonMiembros };
  }

  if (queryStr.includes('SALONES') || queryStr.includes('SALON_MIEMBROS')) {
    const userIdParam = queryStr.includes('USER_ID = $2') || queryStr.includes('USER_ID=$2')
      ? params[1]
      : params.find(p => p !== undefined && p !== null && !isNaN(parseInt(p)));
    if (userIdParam !== undefined) {
      const uId = parseInt(userIdParam);
      const sUser = Array.from(memorySalones.values()).find(s => s.id_dueno == uId);
      if (sUser) return { rows: [{ ...sUser, sub_rol: 'DUEÑO' }] };
      const mUser = memorySalonMiembros.find(m => m.user_id == uId);
      if (mUser) return { rows: [{ id: mUser.salon_id, sub_rol: mUser.sub_rol || 'DUEÑO' }] };
      for (const u of memoryUsers.values()) {
        if (u.id == uId && u.rol === 'SALON' && u.onboarding_completo) {
          return { rows: [{ id: 1, nombre_salon: u.nombre, sub_rol: 'DUEÑO' }] };
        }
      }
      return { rows: [] };
    }
    const list = Array.from(memorySalones.values());
    if (list.length > 0) return { rows: list };
    return { rows: [{ id: 1, nombre_salon: 'Salón Demo' }] };
  }

  return { rows: [] };
}

// Enrutado de consultas a la conexión dedicada de la petición.
// Módulo aislado a propósito: no toca handleMemoryQuery ni la degradación a
// memoria (ver la cabecera de tenantRouting.js).
const tenantRouting = require('./tenantRouting');

// ── Modo de base de datos ───────────────────────────────────────────────────
// El modo memoria existe para poder trabajar en local SIN PostgreSQL. Lo que no
// puede hacer es sustituir el resultado de una consulta que FALLÓ: eso convierte
// un error de SQL en un éxito vacío y deja al proceso sirviendo datos inventados
// sin un solo error en el log.
//
// Lo que hacía antes, medido:
//   pool.query('SELECT * FROM tabla_que_no_existe_zzz')  ->  { rows: [] }
// y además dejaba el flag en false para siempre, porque el cortocircuito de la
// cabecera impedía volver a intentar el pool real: un solo tropiezo condenaba al
// proceso entero a memoria hasta reiniciar.
//
// Ahora el modo es una DECISIÓN DE ARRANQUE, no un accidente por consulta:
//   'indefinido' -> aún no se ha probado: se intenta el pool real
//   'postgres'   -> hay base: los errores de SQL se propagan siempre
//   'memoria'    -> no hay base: se sirve memoria, y se reintenta cada 5 s para
//                   que un servidor que vuelve no deje el proceso en memoria.
let dbMode = 'indefinido';
let ultimoIntentoFallidoEn = 0;
const ENFRIAMIENTO_ENTRE_INTENTOS_MS = 5000;
let memoriaForzada = false;

// En los TESTS el módulo es hermético: sin DATABASE_URL explícita no se toca
// ninguna base real, ni se escribe en la de desarrollo que responda en DB_PORT.
// Es la MISMA regla que aplica src/config/database.js para Sequelize, para que
// los dos caminos de datos no discrepen. Sin esto, las suites de integración se
// conectan a la base que haya levantada: pasan en local y caen en CI, y además
// escriben en una base que no es suya.
if (process.env.NODE_ENV === 'test' && !process.env.DATABASE_URL) {
  dbMode = 'memoria';
  memoriaForzada = true;
}

// Fallos de ENLACE: no se puede hablar con el servidor, o todavía está
// arrancando. Solo estos justifican servir memoria en lugar de lanzar.
const CODIGOS_DE_ENLACE = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET',
  'EPIPE', 'EAI_AGAIN',
  '08000', '08001', '08003', '08004', '08006', // connection_exception y familia
  '57P01', '57P02', '57P03',                    // admin_shutdown, crash_shutdown, cannot_connect_now
]);

function esErrorDeEnlace(err) {
  if (!err) return false;
  if (err.code && CODIGOS_DE_ENLACE.has(err.code)) return true;
  return /ECONNREFUSED|Connection terminated|Connection refused|the database system is starting up|could not connect to server/i
    .test(String(err.message || ''));
}

/** ¿Toca volver a probar el pool real, o seguimos en enfriamiento tras fallar? */
function tocaReintentar() {
  return Date.now() - ultimoIntentoFallidoEn >= ENFRIAMIENTO_ENTRE_INTENTOS_MS;
}

function clienteEnMemoria() {
  return {
    query: async (text, params) => handleMemoryQuery(text, params),
    release: () => {}
  };
}

function isStrictEnvironment() {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.NODE_ENV === 'staging' ||
    Boolean(process.env.RAILWAY_ENVIRONMENT) ||
    Boolean(process.env.RAILWAY_SERVICE_NAME) ||
    Boolean(process.env.RAILWAY_PROJECT_ID)
  );
}

/** Marca el modo memoria y deja constancia del motivo real. */
function pasarAMemoria(err) {
  if (isStrictEnvironment()) {
    console.error(`🚨 [CRITICAL DB ERROR] Fallo de enlace con PostgreSQL en entorno protegido (${err?.code || 'sin código'}: ${err?.message}) — SE PROHÍBE EL MODO MEMORIA EN PRODUCCIÓN/STAGING.`);
    throw err;
  }
  dbMode = 'memoria';
  servingFabricatedData = true;
  ultimoIntentoFallidoEn = Date.now();
  console.warn(`⚠️ [DB] Sin enlace con PostgreSQL (${err?.code || 'sin código'}: ${err?.message}) — se sirve memoria local.`);
}

const pool = {
  query: async (text, params) => {
    // Si la petición tiene una conexión dedicada (y por tanto su app.tenant_id
    // fijado de forma local), la consulta debe ejecutarse en ESA conexión.
    // Deliberadamente NO hay fallback a memoria en esta rama: si la transacción
    // de la petición falla, debe propagarse el error en vez de sustituirlo por
    // los datos de handleMemoryQuery.
    const activeClient = tenantRouting.getActiveClient();
    if (activeClient) {
      return activeClient.query(text, params);
    }

    if (isStrictEnvironment() && dbMode === 'memoria') {
      throw new Error('CRITICAL DB ERROR: Database memory fallback is strictly prohibited in production/staging.');
    }

    if ((pgMemory.isMemoryMode || dbMode === 'memoria') && pgMemory.enabled && pgMemory.adapter && typeof pgMemory.adapter.query === 'function') {
      servingFabricatedData = true;
      return pgMemory.adapter.query(text, params);
    }

    if (dbMode === 'memoria') {
      if (memoriaForzada || !tocaReintentar()) {
        servingFabricatedData = true;
        return handleMemoryQuery(text, params);
      }
      // Enfriamiento cumplido: se comprueba si la base ha vuelto. Si vuelve, se
      // abandona el modo memoria; si no, se sigue sirviendo memoria sin lanzar.
      try {
        const res = await rawPool.query(text, params);
        dbMode = 'postgres';
        servingFabricatedData = false;
        return res;
      } catch (err) {
        if (!esErrorDeEnlace(err)) throw err;
        pasarAMemoria(err);
        return handleMemoryQuery(text, params);
      }
    }

    try {
      const res = await rawPool.query(text, params);
      if (dbMode === 'indefinido') {
        dbMode = 'postgres';
        servingFabricatedData = false;
      }
      return res;
    } catch (err) {
      if (!esErrorDeEnlace(err)) {
        // Error de SQL (tabla o columna inexistente, violación de constraint...).
        // NO se sustituye por datos en memoria: se propaga.
        throw err;
      }
      pasarAMemoria(err);
      return handleMemoryQuery(text, params);
    }
  },
  connect: async () => {
    if (isStrictEnvironment() && dbMode === 'memoria') {
      throw new Error('CRITICAL DB ERROR: Database memory fallback is strictly prohibited in production/staging.');
    }
    if ((pgMemory.isMemoryMode || dbMode === 'memoria') && pgMemory.enabled && pgMemory.pool) {
      servingFabricatedData = true;
      return pgMemory.pool.connect();
    }
    if (dbMode === 'memoria' && (memoriaForzada || !tocaReintentar())) {
      servingFabricatedData = true;
      return clienteEnMemoria();
    }
    try {
      const client = await rawPool.connect();
      if (dbMode !== 'postgres') {
        dbMode = 'postgres';
        servingFabricatedData = false;
      }
      return client;
    } catch (err) {
      if (!esErrorDeEnlace(err)) throw err;
      pasarAMemoria(err);
      if (pgMemory.enabled && pgMemory.pool) {
        return pgMemory.pool.connect();
      }
      return clienteEnMemoria();
    }
  },
  on: (...args) => rawPool.on(...args)
};

const testConnection = async () => {
  try {
    const client = await rawPool.connect();
    const res = await client.query('SELECT current_database(), current_user');
    client.release();
    dbMode = 'postgres';
    servingFabricatedData = false;
    console.log(`✅ Conexión exitosa a PostgreSQL [DB: ${res.rows[0].current_database}, Entorno: ${process.env.NODE_ENV || 'development'}]`);
    return true;
  } catch (err) {
    if (isStrictEnvironment()) {
      console.error('❌ PostgreSQL no disponible:', err.message);
      console.error('❌ CRITICAL DB ERROR: Fallo de conexión a PostgreSQL en producción/staging:', err.message);
      throw err;
    }
    dbMode = 'memoria';
    servingFabricatedData = true;
    ultimoIntentoFallidoEn = Date.now();
    // Se imprime el MOTIVO. Antes solo decía "no disponible", así que una
    // credencial incorrecta o una base inexistente eran indistinguibles de un
    // servidor apagado, y el fallo real se perdía.
    console.warn(`⚠️ PostgreSQL local no disponible (${err.code || 'sin código'}: ${err.message})`);
    console.warn('⚠️ Modo de persistencia en memoria local (solo desarrollo). Lo que falle por SQL seguirá lanzando error.');
    return true;
  }
};

// ── Conexión a la base de datos RAG (pgvector) ──
const ragPool = (process.env.RAG_DATABASE_URL || process.env.DATABASE_URL)
  ? new Pool({
      connectionString: process.env.RAG_DATABASE_URL || process.env.DATABASE_URL,
      ssl: getSslConfig(process.env.RAG_DATABASE_URL || process.env.DATABASE_URL),
      max: isProduction ? 15 : 10,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      idleTimeoutMillis: IDLE_TIMEOUT_MS,
      statement_timeout: STATEMENT_TIMEOUT_MS,
      query_timeout: QUERY_TIMEOUT_MS,
      idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
    })
  : null;

const testRagConnection = async () => {
  if (!ragPool) {
    return false;
  }
  try {
    const client = await ragPool.connect();
    const res = await client.query('SELECT current_database()');
    client.release();
    console.log(`✅ RAG conectado a: ${res.rows[0].current_database}`);
    return true;
  } catch (err) {
    return false;
  }
};

let isPgAvailable = null;
let servingFabricatedData = false;

const memoryFallbackAllowed = () => {
  if (isStrictEnvironment()) return false;
  return (
    pgMemory.enabled ||
    process.env.NODE_ENV === 'test' ||
    process.env.NODE_ENV === 'development' ||
    process.env.ALLOW_MEMORY_FALLBACK === 'true'
  );
};

const getDbStatus = () => ({
  pgAvailable: dbMode === 'indefinido' ? null : dbMode === 'postgres',
  servingFabricatedData,
  memoryFallbackAllowed: memoryFallbackAllowed(),
  dbMode
});

/** ¿Está la conexión sirviendo memoria por decisión explícita (pruebas sin base)
 *  o por falta de enlace? Lo usa businessRepository para decidir si un error de
 *  SQL debe PROPAGARSE (hay base: el error es real) o si la memoria es la fuente
 *  legítima (no hay base). Sin esta distinción, el repositorio convertía
 *  cualquier error de SQL en datos inventados y la API parecía funcionar. */
const dbEnMemoria = () => dbMode === 'memoria';

module.exports = { pool, testConnection, getDbStatus, ragPool, testRagConnection, dbEnMemoria, memoryFallbackAllowed };

