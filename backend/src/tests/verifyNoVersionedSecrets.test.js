const { analizarSalida, validarLinea } = require('../../scripts/verifyNoVersionedSecrets');

describe('verifyNoVersionedSecrets — Pipeline Pure Scanner Test (CRLF / LF Invariance & Mutation Proof)', () => {
  const targetFile = 'src/config/jwt.js';
  const secretLine = "const MI_CLAVE_SECRETA = 'Xk92LmQ7ppQzRt4VbN8wYs3Dd6Ff';";

  test('C2: CRLF y LF entran por analizarSalida y producen el mismo conjunto de hallazgos (no vacío)', () => {
    const rawLF   = `${targetFile}:10:${secretLine}\n`;
    const rawCRLF = `${targetFile}:10:${secretLine}\r\n`;

    const resLF   = analizarSalida(rawLF);
    const resCRLF = analizarSalida(rawCRLF);

    expect(resLF.hallazgos.length).toBeGreaterThan(0);
    expect(resCRLF.hallazgos.length).toBeGreaterThan(0);
    expect(resCRLF.hallazgos).toEqual(resLF.hallazgos);
    expect(resCRLF.exitCode).toBe(1);
    expect(resLF.exitCode).toBe(1);
  });

  test('C3: Entrada conocida produce exactamente N hallazgos (comprueba que el escáner no está mudo)', () => {
    const rawInput = `${targetFile}:10:${secretLine}\n`;
    const res = analizarSalida(rawInput);

    expect(res.hallazgos).toHaveLength(1);
    expect(res.hallazgos[0]).toEqual({
      archivo: targetFile,
      numLinea: '10',
      nombre: 'valor por defecto literal para variable sensible'
    });
    expect(res.exitCode).toBe(1);
  });

  test('C4 (Prueba de Mutación): Sin normalización (normalize = false), la entrada CRLF retiene \\r y difiere de la versión LF limpia', () => {
    const rawLF   = `${targetFile}:10:${secretLine}\n`;
    const rawCRLF = `${targetFile}:10:${secretLine}\r\n`;

    const resLFWithNorm   = analizarSalida(rawLF, { normalize: true });
    const resCRLFWithNorm = analizarSalida(rawCRLF, { normalize: true });
    expect(resLFWithNorm.hallazgos).toEqual(resCRLFWithNorm.hallazgos);

    const resLFNoNorm   = analizarSalida(rawLF, { normalize: false });
    const resCRLFNoNorm = analizarSalida(rawCRLF, { normalize: false });

    expect(resCRLFNoNorm.hallazgos).not.toEqual(resLFNoNorm.hallazgos);
  });

  test('Regla 1: Contraseña documentada en prosa o comentario es detectada por el escáner (con y sin acento)', () => {
    const proseLineAccent = "-- contraseña para todos los usuarios es: secret123";
    const proseLineNoAccent = "// contrasena por defecto: secret123";
    const rawInputAccent = `seed.sql:1:${proseLineAccent}\n`;
    const rawInputNoAccent = `seed.sql:2:${proseLineNoAccent}\n`;

    const resAccent = analizarSalida(rawInputAccent);
    const resNoAccent = analizarSalida(rawInputNoAccent);

    expect(resAccent.hallazgos).toHaveLength(1);
    expect(resAccent.hallazgos[0].nombre).toBe('contraseña documentada en prosa o comentario');
    expect(resNoAccent.hallazgos).toHaveLength(1);
    expect(resNoAccent.hallazgos[0].nombre).toBe('contraseña documentada en prosa o comentario');
  });

  test('Regla 2: Hash bcrypt versionado es detectado por el escáner (detección estática del patrón $2a$/$2b$)', () => {
    // Hash bcrypt con patrón $2a$/$2b$ (la regla es estática: ya no depende de bcryptjs)
    const hashLine = "INSERT INTO usuarios VALUES ('$2a$10$XG3dsKkJJFx9cldnFJHGt.FJqYVTNiSsoJAaSVwUQkYis22mXk/7O');";
    const rawInput = `seed.sql:5:${hashLine}\n`;
    const res = analizarSalida(rawInput);

    expect(res.hallazgos).toHaveLength(1);
    expect(res.hallazgos[0]).toEqual({
      archivo: 'seed.sql',
      numLinea: '5',
      nombre: 'hash bcrypt versionado'
    });
    expect(res.exitCode).toBe(1);
  });

  test('Regla 2 (N-2): El patrón bcrypt $2b$ se detecta en un seed .sql versionado (fuera de JS)', () => {
    const sqlLine = "(101,'x@y.com','$2b$12$K7vXbM8Wz2oPl9R1NqYeOu1AhGj5FkLmNpQrStUvWxYzAbCdEfGhI','X',true),";
    const res = analizarSalida(`backend/railway_seed.sql:9:${sqlLine}\n`);

    expect(res.hallazgos).toHaveLength(1);
    expect(res.hallazgos[0]).toEqual({
      archivo: 'backend/railway_seed.sql',
      numLinea: '9',
      nombre: 'hash bcrypt versionado'
    });
    expect(res.exitCode).toBe(1);
  });

  test('Regla 2 (N-2): El marcador __SEED_PASSWORD_HASH__ NO se marca (placeholder reconocido)', () => {
    const placeholderLine = "const PASSWORD_HASH = '__SEED_PASSWORD_HASH__';";
    const res = analizarSalida(`backend/src/config/db.js:173:${placeholderLine}\n`);

    expect(res.hallazgos).toHaveLength(0);
    expect(res.exitCode).toBe(0);
  });

  test('Regla 3: Valor por defecto literal en variable sensible sigue siendo detectado (re-verificación de cobertura)', () => {
    const defaultValLine = "const DB_PASS = 'SuperSecret123!';";
    const rawInput = `src/config/db.js:15:${defaultValLine}\n`;
    const res = analizarSalida(rawInput);

    expect(res.hallazgos).toHaveLength(1);
    expect(res.hallazgos[0]).toEqual({
      archivo: 'src/config/db.js',
      numLinea: '15',
      nombre: 'valor por defecto literal para variable sensible'
    });
    expect(res.exitCode).toBe(1);
  });

  test('Regla 3 (ronda 2): Expresiones de fallback process.env.X || "literal" y process.env.X ?? "literal" son detectadas', () => {
    const line1 = "const DB_PASSWORD = process.env.DB_PASSWORD || 'Literal123!';";
    const line2 = "const JWT_SECRET = process.env.JWT_SECRET || 'devsecret123';";
    const line3 = "const API_KEY = process.env.API_KEY ?? 'live_key_1234567890';";

    expect(analizarSalida(`src/config/db.js:1:${line1}\n`).hallazgos).toHaveLength(1);
    expect(analizarSalida(`src/config/db.js:2:${line2}\n`).hallazgos).toHaveLength(1);
    expect(analizarSalida(`src/config/db.js:3:${line3}\n`).hallazgos).toHaveLength(1);
  });

  describe('Regla 7 (ronda 3 — CI-52): Discriminación de falsos positivos vs defectos reales', () => {
    test('Casos Negativos (7 constantes legítimas NO deben ser marcadas)', () => {
      const casosLegitimos = [
        { linea: "const SECRET_HEADER = 'authorization';", desc: "SECRET_HEADER" },
        { linea: "const KEY_ALGO = 'HS256';", desc: "KEY_ALGO" },
        { linea: "const TOKEN_TYPE = 'Bearer';", desc: "TOKEN_TYPE" },
        { linea: "const API_KEY_HEADER = 'x-api-key';", desc: "API_KEY_HEADER" },
        { linea: "const DB_PASSWORD_FIELD = 'password_hash';", desc: "DB_PASSWORD_FIELD" },
        { linea: "const TOKEN_KEY = 'glow_token';", desc: "TOKEN_KEY" },
        { linea: "const SECRET_NAME = 'JWT_SECRET';", desc: "SECRET_NAME" }
      ];

      for (const caso of casosLegitimos) {
        const res = analizarSalida(`src/config/app.js:10:${caso.linea}\n`);
        expect(res.hallazgos).toHaveLength(0);
      }
    });

    test('Casos Positivos (fallos reales DEBEN ser marcados, incluyendo fallbacks de baja entropía CI-52 bis)', () => {
      const casosDefectuosos = [
        { linea: "const DB_PASSWORD = process.env.X_PASSWORD || 'Literal123!';", desc: "X_PASSWORD fallback" },
        { linea: "const API_KEY = process.env.API_KEY ?? 'live_key_1234567890';", desc: "API_KEY nullish fallback" },
        { linea: "DB_PASSWORD=Literal123!", desc: "Dotenv inline assignment" },
        { linea: "const DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';", desc: "DB_PASSWORD weak postgres fallback" },
        { linea: "const KYC_WEBHOOK_SECRET = process.env.KYC_WEBHOOK_SECRET || 'glowapp_secure_kyc_webhook_secret_2026';", desc: "KYC secret fallback" },
        { linea: "const ADMIN_SECRET = 'SuperSecret123!';", desc: "ADMIN_SECRET direct assignment" },
        { linea: "const X_PASSWORD = process.env.X_PASSWORD || 'letmein';", desc: "X_PASSWORD low-entropy fallback (CI-52 bis fix)" },
        { linea: "const X_PASSWORD = process.env.X_PASSWORD ?? 'secret';", desc: "X_PASSWORD low-entropy nullish fallback (CI-52 bis fix)" }
      ];

      for (const caso of casosDefectuosos) {
        const res = analizarSalida(`src/config/app.js:10:${caso.linea}\n`);
        expect(res.hallazgos.length).toBeGreaterThanOrEqual(1);
        expect(res.hallazgos[0].nombre).toBe('valor por defecto literal para variable sensible');
      }
    });
  });

  test('Coexistencia legacy: validarLinea (normalize = false) demuestra divergencia por \\r', () => {
    const lineLF   = "const MI_CLAVE_SECRETA = 'Xk92LmQ7ppQzRt4VbN8wYs3Dd6Ff';";
    const lineCRLF = "const MI_CLAVE_SECRETA = 'Xk92LmQ7ppQzRt4VbN8wYs3Dd6Ff\r';";

    const evalLFNoNorm   = validarLinea(lineLF, targetFile, 'valor por defecto literal para variable sensible', false);
    const evalCRLFNoNorm = validarLinea(lineCRLF, targetFile, 'valor por defecto literal para variable sensible', false);

    expect(evalLFNoNorm.val).toBe('Xk92LmQ7ppQzRt4VbN8wYs3Dd6Ff');
    expect(evalCRLFNoNorm.val).toBe('Xk92LmQ7ppQzRt4VbN8wYs3Dd6Ff\r');
    expect(evalCRLFNoNorm.val).not.toBe(evalLFNoNorm.val);
  });

  describe('Regla 8 (N-10): contraseñas EN TEXTO PLANO versionadas', () => {
    const NOMBRE = 'contraseña en texto plano (literal versionado)';

    test('Positivos: las formas del hallazgo N-10 se detectan (una por línea)', () => {
      const casos = [
        { archivo: 'seed/prestador-demo.sql', n: '7', linea: "-- Contraseña en texto plano: 'Demo123456'" },
        { archivo: 'seed/prestador-demo.sql', n: '149', linea: "    RAISE NOTICE 'Password: Demo123456';" },
        { archivo: 'src/db/seed_3years_saas_data.js', n: '26', linea: "        password_hash: '<HASH>', // password123" },
        { archivo: 'src/db/seed_3years_saas_data.js', n: '230', linea: "    console.log('   Password: password123');" },
        { archivo: 'scripts/beauty-app-start.ps1', n: '34', linea: '    client = @{ email = "a@b.com"; password = "password123"; role = "client" }' }
      ];

      for (const caso of casos) {
        const res = analizarSalida(`${caso.archivo}:${caso.n}:${caso.linea}\n`);
        expect(res.hallazgos).toHaveLength(1);
        expect(res.hallazgos[0].nombre).toBe(NOMBRE);
        expect(res.exitCode).toBe(1);
      }
    });

    test('Negativos: referencias de código, tipos, actas y prosa de UI NO se marcan', () => {
      const casos = [
        '    password: process.env.DB_PASSWORD,',
        '  login: (email: string, password: string) => Promise<AuthResponse>;',
        '    const hashedPassword = await bcrypt.hash(password, 10);',
        "    const password_hash = params[2] || '';",
        '  "registerPasswordError": "Minimum 6 characters",',
        '      "Login password: S4TextField",',
        "        password_hash: '<HASH>', // hash bcrypt de la clave demo (REDACTED — se define con SEED_PASSWORD al sembrar)"
      ];

      for (const linea of casos) {
        expect(analizarSalida(`src/config/app.js:10:${linea}\n`).hallazgos).toHaveLength(0);
      }
    });

    test('El valor nunca se imprime: el hallazgo sólo trae archivo, línea y tipo', () => {
      const res = analizarSalida("backend/seed/prestador-demo.sql:149:    RAISE NOTICE 'Password: Demo123456';\n");
      expect(Object.keys(res.hallazgos[0]).sort()).toEqual(['archivo', 'nombre', 'numLinea']);
    });
  });
});
