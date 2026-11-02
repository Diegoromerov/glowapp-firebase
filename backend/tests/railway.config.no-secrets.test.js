/**
 * P0 infra/observabilidad · t_fix_infra_01 — «Secrets expuestos en railway.yml»
 *
 * Hallazgo (AUD-INFRA-01 #1, E1 · revisión de configuración):
 *   railway.yml:11-16,27-28,39-40,59-92 declara variables sensibles
 *   (POSTGRES_PASSWORD, REDIS_PASSWORD, JWT_SECRET, GEMINI_API_KEY, DEEPSEEK_API_KEY,
 *   FAL_KEY, REPLICATE_API_TOKEN) dentro de config-as-code TRACKEADO en git. Rotar
 *   cualquiera de ellas exige editar el repositorio y redesplegar, y publica el
 *   inventario de secretos del despliegue.
 *
 * Invariante probada:
 *   Un archivo de configuración de despliegue VERSIONADO no declara material sensible
 *   — ni valores literales ni placeholders `${VAR}`. Los secretos se inyectan como
 *   variables de ENTORNO del servicio (Railway → Variables, o
 *   `railway variables --set`) y se documentan por nombre en `.env.example`.
 *   Así se rotan sin tocar el repositorio ni redesplegar.
 *
 * Test estático: no usa red, base de datos ni credenciales. Sólo lee archivos del repo.
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const RAILWAY_YML = path.join(REPO_ROOT, 'railway.yml');
const ENV_EXAMPLE = path.join(REPO_ROOT, '.env.example');

// Nombres de variable que transportan material sensible (contraseñas, tokens, claves).
const NOMBRE_SENSIBLE = /(PASSWORD|PASSWD|PWD|SECRET|TOKEN|API[_-]?KEY|(^|_)KEY$)/i;

// Secretos que railway.yml declaraba inline antes del fix: deben quedar en el entorno.
const SECRETOS_GESTIONADOS_POR_ENTORNO = [
  'POSTGRES_PASSWORD',
  'REDIS_PASSWORD',
  'JWT_SECRET',
  'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY',
  'FAL_KEY',
  'REPLICATE_API_TOKEN',
];

function leerYml() {
  return fs.readFileSync(RAILWAY_YML, 'utf8').replace(/\r\n?/g, '\n');
}

/**
 * Extrae los pares `- name: X` + `value: Y` declarados bajo los bloques `variables:`
 * de railway.yml. Devuelve { nombre, valor, linea }. (Parser mínimo, sin dependencias.)
 */
function declaracionesDeVariables(yml) {
  const lineas = yml.split('\n');
  const declaraciones = [];
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/^\s*-\s*name:\s*(.+?)\s*$/);
    if (!m) continue;
    const nombre = m[1].replace(/^["']|["']$/g, '');
    const sig = (lineas[i + 1] || '').match(/^\s*value:\s*(.*?)\s*$/);
    declaraciones.push({
      nombre,
      valor: sig ? sig[1].replace(/^["']|["']$/g, '') : null,
      linea: i + 1,
    });
  }
  return declaraciones;
}

describe('P0 infra/observabilidad · railway.yml no versiona secretos', () => {
  const yml = leerYml();

  test('railway.yml existe, es UTF-8 sin BOM y sigue describiendo el despliegue', () => {
    const raw = fs.readFileSync(RAILWAY_YML);
    expect(raw.length).toBeGreaterThan(0);
    expect(raw[0]).not.toBe(0xef); // sin BOM UTF-8
    expect(yml).toMatch(/^services:\s*$/m);
    // Wiring NO sensible intacto (regresión): servicios, hosts y health checks.
    expect(yml).toMatch(/name:\s*DB_HOST\s*\n\s*value:\s*pgvector-db/);
    expect(yml).toMatch(/name:\s*REDIS_HOST\s*\n\s*value:\s*redis/);
    expect(yml).toMatch(/healthCheckPath:\s*\/health/);
  });

  test('ninguna variable sensible se declara inline (name + value) en railway.yml', () => {
    const sensibles = declaracionesDeVariables(yml)
      .filter((d) => NOMBRE_SENSIBLE.test(d.nombre))
      .map((d) => `${d.linea}:${d.nombre}`);
    expect(sensibles).toEqual([]);
  });

  test('railway.yml no contiene valores literales para nombres sensibles (defensa en profundidad)', () => {
    const literales = declaracionesDeVariables(yml)
      .filter((d) => NOMBRE_SENSIBLE.test(d.nombre) && d.valor && !/^\$\{/.test(d.valor))
      .map((d) => `${d.linea}:${d.nombre}`);
    expect(literales).toEqual([]);
  });

  test('cada secreto retirado queda documentado por nombre en .env.example (entorno)', () => {
    expect(fs.existsSync(ENV_EXAMPLE)).toBe(true);
    const ejemplo = fs.readFileSync(ENV_EXAMPLE, 'utf8');
    for (const nombre of SECRETOS_GESTIONADOS_POR_ENTORNO) {
      expect(ejemplo).toMatch(new RegExp(`^${nombre}=`, 'm'));
    }
  });
});
