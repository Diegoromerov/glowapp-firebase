/**
 * P0 QA #4 · t_fix_qa_04 — «Sin staging Railway TEST_DATABASE_URL»
 *
 * Hallazgo (AUD-QA-01 #10, E0 · revisión de configuración):
 *   railway.yml:1 declara UN SOLO entorno Railway (producción). No existe un
 *   entorno staging con la misma configuración que producción ni la variable
 *   `TEST_DATABASE_URL`, de modo que la suite E2E (evidencia E2) no puede
 *   correr contra una base real con paridad de config sin tocar producción.
 *
 * Invariante probada:
 *   El archivo de despliegue declara un entorno `staging` en la rama `staging`
 *   que (a) clona la configuración de producción —mismos servicios/build—,
 *   (b) expone `TEST_DATABASE_URL` (inyectada por entorno, nunca literal) para
 *   la suite E2E, y (c) no añade material sensible al repositorio.
 *
 * Test estático: no usa red, base de datos ni credenciales. Sólo lee archivos del repo.
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const RAILWAY_YML = path.join(REPO_ROOT, 'railway.yml');

// Variables que el entorno staging NO debe volcar como literales (política de secretos).
const NOMBRE_SENSIBLE = /(PASSWORD|PASSWD|PWD|SECRET|TOKEN|API[_-]?KEY|(^|_)KEY$)/i;

function leerYml() {
  return fs.readFileSync(RAILWAY_YML, 'utf8').replace(/\r\n?/g, '\n');
}

/** Devuelve el bloque de un mapping de nivel raíz (`clave:` … hasta la próxima clave sin sangría). */
function seccionRaiz(yml, clave) {
  const lineas = yml.split('\n');
  const out = [];
  let dentro = false;
  for (const l of lineas) {
    if (!dentro) {
      if (new RegExp('^' + clave + ':\\s*$').test(l)) dentro = true;
      continue;
    }
    if (/^\S/.test(l)) break;
    out.push(l);
  }
  return dentro ? out.join('\n') : null;
}

/**
 * Extrae el sub-mapping `clave:` dentro de `seccion`, sea cual sea su sangría.
 * Devuelve el texto del bloque (sin la línea de la clave) o null.
 */
function subBloque(seccion, clave) {
  if (!seccion) return null;
  const lineas = seccion.split('\n');
  let indent = null;
  let start = -1;
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(new RegExp('^(\\s*)' + clave + ':\\s*$'));
    if (m) {
      indent = m[1].length;
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;
  const out = [];
  for (let i = start; i < lineas.length; i++) {
    const l = lineas[i];
    if (l.trim() === '') continue;
    const lead = l.match(/^(\s*)/)[1].length;
    if (lead <= indent) break;
    out.push(l);
  }
  return out.join('\n');
}

/** Nombres de servicio declarados bajo `services:` (producción) — indentación de 2 espacios. */
function serviciosProduccion(yml) {
  const bloque = seccionRaiz(yml, 'services');
  if (!bloque) return [];
  return bloque
    .split('\n')
    .map((l) => l.match(/^  ([A-Za-z0-9_-]+):\s*(#.*)?$/))
    .filter(Boolean)
    .map((m) => m[1]);
}

/** Nombres listados como `- <nombre>` dentro de un bloque. */
function itemsLista(texto) {
  if (!texto) return [];
  return texto
    .split('\n')
    .map((l) => l.match(/^\s*-\s*([A-Za-z0-9_-]+)\s*$/))
    .filter(Boolean)
    .map((m) => m[1]);
}

/** Pares `- name: X` + `value: Y` declarados en un bloque `variables:`. */
function declaraciones(texto) {
  if (!texto) return [];
  const lineas = texto.split('\n');
  const out = [];
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/^\s*-\s*name:\s*(.+?)\s*$/);
    if (!m) continue;
    const valor = (lineas[i + 1] || '').match(/^\s*value:\s*(.*?)\s*$/);
    out.push({
      nombre: m[1].replace(/^["']|["']$/g, ''),
      valor: valor ? valor[1].replace(/^["']|["']$/g, '') : null,
    });
  }
  return out;
}

describe('P0 QA #4 · railway.yml declara entorno staging para evidencia E2', () => {
  const yml = leerYml();

  test('railway.yml existe, es UTF-8 sin BOM y conserva la topología de producción', () => {
    const raw = fs.readFileSync(RAILWAY_YML);
    expect(raw.length).toBeGreaterThan(0);
    expect(raw[0]).not.toBe(0xef); // sin BOM UTF-8
    expect(yml).toMatch(/^services:\s*$/m);
    // Regresión: el cableado de producción no cambia.
    expect(yml).toMatch(/name:\s*DB_HOST\s*\n\s*value:\s*pgvector-db/);
    expect(yml).toMatch(/name:\s*REDIS_HOST\s*\n\s*value:\s*redis/);
    expect(yml).toMatch(/healthCheckPath:\s*\/health/);
    expect(serviciosProduccion(yml)).toEqual(
      expect.arrayContaining(['pgvector-db', 'redis', 'ai-worker', 'backend'])
    );
  });

  test('declara un bloque `environments:` con los entornos production y staging', () => {
    const envs = seccionRaiz(yml, 'environments');
    expect(envs).not.toBeNull();
    expect(envs).toMatch(/^  production:\s*$/m);
    expect(envs).toMatch(/^  staging:\s*$/m);
  });

  test('staging clona la configuración de producción (mismos servicios/build)', () => {
    const envs = seccionRaiz(yml, 'environments');
    const staging = subBloque(envs, 'staging');
    expect(staging).not.toBeNull();
    expect(staging).toMatch(/^    clone_of:\s*production\s*$/m);
    // El conjunto de servicios de staging es idéntico al de producción.
    const serviciosStaging = itemsLista(subBloque(staging, 'services'));
    expect(serviciosStaging.slice().sort()).toEqual(serviciosProduccion(yml).slice().sort());
  });

  test('staging está ligado a la rama `staging` (misma que dispara el CI)', () => {
    const envs = seccionRaiz(yml, 'environments');
    const staging = subBloque(envs, 'staging');
    expect(staging).toMatch(/^    branch:\s*staging\s*$/m);
  });

  test('staging declara NODE_ENV=staging y la TEST_DATABASE_URL de la suite E2E', () => {
    const envs = seccionRaiz(yml, 'environments');
    const staging = subBloque(envs, 'staging');
    const variables = subBloque(staging, 'variables');
    expect(variables).not.toBeNull();
    expect(variables).toMatch(/name:\s*NODE_ENV\s*\n\s*value:\s*staging/);
    expect(variables).toMatch(/name:\s*TEST_DATABASE_URL\s*\n\s*value:\s*\$\{TEST_DATABASE_URL\}/);
  });

  test('staging no introduce secretos literales en el repositorio (coherencia con la política)', () => {
    const envs = seccionRaiz(yml, 'environments');
    const staging = subBloque(envs, 'staging');
    // Debe viajar como placeholder ${VAR} toda variable (a) sensible por nombre o
    // (b) cuyo valor embeba credenciales (esquema://…:…@host). Nunca literales.
    const sensibles = declaraciones(subBloque(staging, 'variables'))
      .filter((d) => {
        if (!d.valor) return NOMBRE_SENSIBLE.test(d.nombre) && d.valor !== null;
        const esPlaceholder = /^\$\{[^}]+\}$/.test(d.valor);
        return !esPlaceholder && (NOMBRE_SENSIBLE.test(d.nombre) || /:\/\//.test(d.valor) || /@/.test(d.valor));
      })
      .map((d) => `${d.nombre}=${d.valor}`);
    expect(sensibles).toEqual([]);
  });
});
