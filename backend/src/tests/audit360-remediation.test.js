/**
 * audit360-remediation.test.js
 * Guardas de regresión de la remediación A360-2026-09-22.
 * No necesitan base de datos: son unidades puras + el escáner de credenciales.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BACKEND = path.resolve(__dirname, '../..');
const leer = (rel) => fs.readFileSync(path.join(BACKEND, rel), 'utf8');
// Los comentarios citan el código viejo para explicar el arreglo: al buscar
// fabricaciones hay que mirar el CÓDIGO, no los comentarios.
const soloCodigo = (src) => src
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n');

describe('A360 C-01 — el runner de migraciones no ejecuta rollbacks', () => {
  const { esMigracionAplicable } = require('../config/migrationRunner');

  test('excluye .down.sql y acepta el resto', () => {
    expect(esMigracionAplicable('035_fix_embedding_dimension_and_hnsw_index.down.sql')).toBe(false);
    expect(esMigracionAplicable('035_fix_embedding_dimension_and_hnsw_index.sql')).toBe(true);
    expect(esMigracionAplicable('001_init.sql')).toBe(true);
  });

  test('ningún rollback vivo dentro del directorio que escanea el arranque', () => {
    const enDirectorio = fs.readdirSync(path.join(BACKEND, 'migrations'))
      .filter((f) => f.endsWith('.down.sql'));
    expect(enDirectorio).toEqual([]);
  });

  test('los runners versionados excluyen explícitamente los rollbacks', () => {
    // Solo los runners TRACKEADOS cuentan para el gate: `check_*.js` y `run_*.js`
    // están en .gitignore (scripts ad-hoc locales), así que se verifican aparte
    // y solo si existen en este árbol.
    const versionados = ['index.js', 'src/config/migrationRunner.js'];
    const locales = [
      'check_and_migrate.js',
      'run_all_migrations.js',
      'run_migrations_ordered.js',
      'run_migrations_until_ready.js',
    ].filter((f) => fs.existsSync(path.join(BACKEND, f)));

    for (const r of versionados) {
      expect(leer(r)).toMatch(/endsWith\('\.down\.sql'\)/);
    }
    for (const r of locales) {
      expect(leer(r)).toMatch(/endsWith\('\.down\.sql'\)/);
    }
    // El runner versionado del arranque es el que importa: no puede quedar sin filtro.
    expect(leer('index.js')).toMatch(/endsWith\('\.down\.sql'\)/);
  });
});

describe('A360 C-03 — la capa de datos no fabrica filas en silencio', () => {
  const db = require('../config/db');

  test('expone el estado degradado para /health', () => {
    const status = db.getDbStatus();
    expect(status).toHaveProperty('servingFabricatedData');
    expect(status).toHaveProperty('memoryFallbackAllowed');
    expect(status).toHaveProperty('pgAvailable');
  });

  test('sin opt-in, el fallback en memoria no está permitido', () => {
    const anterior = { ...process.env };
    delete process.env.ALLOW_MEMORY_FALLBACK;
    process.env.NODE_ENV = 'production';
    try {
      // Se re-evalúa el módulo con el entorno de producción.
      jest.isolateModules(() => {
        const dbProd = require('../config/db');
        expect(dbProd.getDbStatus().memoryFallbackAllowed).toBe(false);
      });
    } finally {
      process.env = anterior;
    }
  });

  test('en producción la consulta real no se sustituye por datos inventados', async () => {
    const src = leer('src/config/db.js');
    // El corto-circuito que dejaba el proceso en modo fixtures para siempre ya no existe.
    expect(src).not.toMatch(/if \(isPgAvailable === false\) \{\s*return handleMemoryQuery/);
    // Y `testConnection` no miente cuando no puede fallback.
    expect(src).toMatch(/console\.error\('❌ PostgreSQL no disponible:'/);
  });
});

describe('A360 C-04 — el WebSocket exige token', () => {
  const src = soloCodigo(leer('src/services/websocketService.js'));

  test('no existe registro por id plano', () => {
    expect(src).not.toMatch(/data\.userId/);
    expect(src).not.toMatch(/No token verification/);
  });

  test('valida pertenencia a la reserva y no confía en el providerId del payload', () => {
    expect(src).toMatch(/client_id = \$2 OR provider_id = \$2/);
    expect(src).not.toMatch(/data\.providerId/);
    expect(src).toMatch(/ws\.authenticatedUserId/);
  });
});

describe('A360 C-05 — ningún cobro ni dispersión se fabrica', () => {
  // Antes estas guardas exigían la AUSENCIA de integración (501 y simuladores
  // "que se rechazan"). Con la integración real ya hecha, la guarda útil es la
  // otra cara del mismo invariante: que cobrar y dispersar dependan de la
  // pasarela, y que el repositorio no se autoconceda un estado de pago.
  test('el cobro de una cita exige un instrumento real y no se marca `paid` por su cuenta', () => {
    const src = soloCodigo(leer('src/controllers/bookingController.js'));

    // Ya no hay simulador ni referencias inventadas.
    expect(src).not.toMatch(/simdev_|wompi_sim_|simulated:\s*true/);
    // Se exige un instrumento tokenizado por Wompi y se llama a la API real.
    expect(src).toMatch(/MISSING_PAYMENT_INSTRUMENT/);
    expect(src).toMatch(/wompiClient\.createTransaction/);
    // Y no hay instrumento simulado: el cobro responde con la transacción pendiente.
    expect(src).toMatch(/PAYMENT_GATEWAY_NOT_CONFIGURED/);

    // La cita solo se marca pagada dentro del webhook APPROVED, nunca en el cobro.
    const inicio = src.indexOf('exports.payBooking');
    const fin = src.indexOf('procesarWebhookWompi');
    expect(inicio).toBeGreaterThan(-1);
    expect(fin).toBeGreaterThan(inicio);
    const cobro = src.slice(inicio, fin);
    expect(cobro).toMatch(/wompiClient\.createTransaction/); // la guarda no puede pasar en vacío
    expect(cobro).not.toMatch(/payment_status\s*=\s*'paid'/);
    expect(cobro).not.toMatch(/estado\s*=\s*'CONFIRMADA'/);
  });

  test('la dispersión usa la API real de pagos a terceros y ya no simula', () => {
    const src = leer('src/services/wompiService.js');
    expect(src).not.toMatch(/simuladorPermitido|rechazarSimulacion|setTimeout/);
    expect(src).toMatch(/wompiPayoutsClient\.createPayoutBatch/);
    expect(src).toMatch(/wompiPayoutsClient\.resolveBankId/);
    expect(src).toMatch(/isConfigured\(\)/);
  });

  test('la referencia y el estado del retiro los emite Wompi, no el repositorio', () => {
    const src = leer('src/services/wompiService.js');
    expect(src).toMatch(/referencia_wompi\s*=\s*\$3/);
    expect(src).toMatch(/mapearEstadoRetiro\(lote\.status\)/);
  });

  test('el webhook valida el checksum real de Wompi, no un esquema inventado', () => {
    const src = soloCodigo(leer('src/controllers/bookingController.js'));
    expect(src).not.toMatch(/x-wompi-signature|x-wompi-nonce|x-wompi-timestamp/);
    expect(src).toMatch(/verifyEventChecksum/);
  });

  test('la validación médica no afirma un pago verificado por Wompi', () => {
    const src = soloCodigo(leer('src/controllers/designsController.js'));
    expect(src).not.toMatch(/Pago de \$15\.000 COP verificado por Wompi/);
    expect(src).toMatch(/PAYMENT_GATEWAY_NOT_INTEGRATED/);
  });
});

describe('A360 C-06 — nada de credenciales en logs', () => {
  test('authController no imprime la contraseña', () => {
    const src = leer('src/controllers/authController.js');
    expect(src).not.toMatch(/"Password:", password/);
  });

  test('el seed no imprime la clave ni la hardcodea', () => {
    const src = leer('../seed_glowapp_kb.js');
    expect(src).not.toMatch(/CLAVE REAL LEIDA/);
    expect(src).not.toMatch(/nvapi-[A-Za-z0-9_-]{10,}/);
  });

  test('el OTP no se registra ni se devuelve salvo opt-in explícito', () => {
    const src = leer('src/routes/paymentRoutes.js');
    expect(src).not.toMatch(/OTP para reserva/);
    expect(src).toMatch(/EXPOSE_DEV_OTP/);
  });
});

describe('A360 C-11 — clave biométrica fail-closed', () => {
  test('en producción sin clave, el módulo no arranca', () => {
    const anterior = { ...process.env };
    delete process.env.BIOMETRIC_ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    process.env.NODE_ENV = 'production';
    try {
      jest.isolateModules(() => {
        expect(() => require('../services/biometricCryptoService')).toThrow(/BIOMETRIC_ENCRYPTION_KEY no está configurada/);
      });
    } finally {
      process.env = anterior;
    }
  });

  test('puede descifrar con la clave legada (necesario para migrar datos)', () => {
    const crypto = require('crypto');
    const prevSecret = process.env.JWT_SECRET;
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = 'test_jwt_secret_32_bytes_min_length_for_legacy';
    }
    try {
      const service = require('../services/biometricCryptoService');
      expect(typeof service.decryptWithLegacyKey).toBe('function');
      // Cifrado con la derivación antigua (sha256 del JWT_SECRET).
      const claveLegada = crypto.createHash('sha256')
        .update(process.env.JWT_SECRET)
        .digest();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', claveLegada, iv);
      let ct = cipher.update(JSON.stringify({ glowScore: 81 }), 'utf8', 'hex');
      ct += cipher.final('hex');
      const payload = `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ct}`;
      expect(service.decryptWithLegacyKey(payload)).toEqual({ glowScore: 81 });
    } finally {
      if (prevSecret === undefined) {
        delete process.env.JWT_SECRET;
      } else {
        process.env.JWT_SECRET = prevSecret;
      }
    }
  });
});

describe('A360 C-12 — el caché semántico está aislado por identidad', () => {
  test('la clave depende de la identidad y hay índice por identidad', () => {
    const src = leer('src/services/semanticCache.js');
    expect(src).toMatch(/generateCacheKey\(embedding, identity/);
    expect(src).toMatch(/semantic:index:\$\{scope\}/);
    expect(src).toMatch(/entry\.identity !== identity/);
  });
});

describe('A360 C-02 — escáner de credenciales versionadas', () => {
  test('no hay credenciales en archivos trackeados', () => {
    execFileSync('node', [path.join('scripts', 'verifyNoVersionedSecrets.js')], {
      cwd: BACKEND,
      stdio: 'pipe',
    });
  });
});
