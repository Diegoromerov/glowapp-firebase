/**
 * Test de contrato de RUTAS y de FORMA entre el panel admin y el backend.
 *
 * Casos reales que lo motivan (los tres son el mismo desempalme):
 *
 * 1. `app/page.tsx` llamaba a /api/admin/sos/active, /api/admin/provider/pending y
 *    /api/admin/dashboard/financial-summary. Las tres existen, pero el modulo que
 *    las implementa (backend/src/modules/admin-glow/admin.routes.js) NUNCA estaba
 *    montado en index.js, asi que respondian 404 y el dashboard siempre caia a su
 *    estado parcial.
 *
 * 2. /api/categorias no existe: ni ruta en el backend ni tabla en la base de datos.
 *
 * 3. Aunque se montara el router, SOS y prestadores habrian salido VACIOS en
 *    silencio: el panel leia `data.alerts` y `data.pending`, pero el backend
 *    devuelve `{ success, count, data: [...] }`, donde `data` YA es el array.
 *    Mismo patron que el bug de `coherencia.incoherencias`.
 *
 * Este test compara el panel contra el backend real, de modo que un desalineamiento
 * falla en CI en vez de en produccion.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');           // admin-dashboard/
const repoRoot = join(root, '..');                       // beauty-app/
const appDir = join(root, 'src', 'app');
const backendIndex = join(repoRoot, 'backend', 'index.js');
const backendDir = join(repoRoot, 'backend');

/**
 * Rutas del panel SIN contraparte en el backend que estan aceptadas HOY.
 * Es un registro de deuda conocida: si esta lista crece, hay que justificarlo
 * en el plan (cada entrada tapa un fallo real del panel).
 */
const IGNORAR = new Set([
  // Fase 2 del plan: no existe endpoint /api/categorias, ni tabla `categorias`,
  // ni columna productos.categoria_id. El <select> y la columna de categoria de
  // /admin/productos no pueden poblarse nunca. Falta decidir: derivar de
  // productos.tag_especialidad o crear el modelo completo.
  '/api/categorias',
]);

// ---------------------------------------------------------------------------
// Extraccion de las rutas del BACKEND
// ---------------------------------------------------------------------------

/** Convierte '/src/routes/x' en la ruta real del archivo. */
function resolverRequire(rel) {
  const base = join(backendDir, rel.replace(/^\.\//, ''));
  for (const c of [`${base}.js`, join(base, 'index.js')]) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * Forma canonica de un camino, para que panel y backend se comparen igual:
 * `${expr}` (panel) y `:param` (backend) son el mismo comodin.
 */
function canon(p) {
  return p
    .split('?')[0]
    .replace(/\$\{[^}]*\}/g, '*')
    .split('/')
    .filter(Boolean)
    .map((s) => (s.startsWith(':') ? '*' : s))
    .join('/');
}

function rutasDelBackend() {
  const rutas = new Set();
  if (!existsSync(backendIndex)) return rutas;

  const idx = readFileSync(backendIndex, 'utf8');
  const requires = {};
  for (const m of idx.matchAll(/const\s+(\w+)\s*=\s*require\(['"](\.\/[^'"]+)['"]\)/g)) {
    requires[m[1]] = m[2];
  }

  // app.use('/api/x', ident)  y  app.use('/api/x', require('./src/routes/y'))
  const montajes = [];
  for (const m of idx.matchAll(/app\.use\(\s*['"](\/api[^'"]*)['"]\s*,\s*(require\(\s*['"]([^'"]+)['"]\s*\)|(\w+))/g)) {
    const [, mount, , inlinePath, ident] = m;
    // ojo: m[2] (el grupo de la alternancia) es truthy en AMBAS ramas.
    // Hay que discriminar por m[3] (la ruta del require inline), no por m[2].
    montajes.push({ mount, archivo: inlinePath || requires[ident] });
  }

  for (const { mount, archivo } of montajes) {
    if (!archivo) continue;
    const f = resolverRequire(archivo);
    if (!f) continue;
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)) {
      const ruta = `${mount.replace(/\/$/, '')}/${m[2].replace(/^\//, '')}`.replace(/\/{2,}/g, '/');
      // Se registra el PAR (metodo, camino). Guardar solo el camino hacia que un GET
      // sin ruta propia pasara por cubierto por el PUT del mismo camino: asi se colo
      // GET /api/admin/precios/:productoId, que NO existe y dejaba el modal del
      // catalogo sin los precios reales (una pagina si, la otra no).
      rutas.add(`${m[1].toUpperCase()} ${canon(ruta.replace(/\/$/, '') || '/')}`);
    }
  }
  return rutas;
}

/** Todas las llamadas fetch('/api/...') del panel, con su archivo:linea. */
function llamadasDelPanel() {
  const out = [];
  const recorrer = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) {
        if (p.includes(join('app', 'api'))) continue; // el propio proxy BFF
        recorrer(p);
        continue;
      }
      if (!e.endsWith('.tsx') && !e.endsWith('.ts')) continue;
      const src = readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
      const llamadas = [...src.matchAll(/fetch\(\s*[`'"]([^`'"]*)[`'"]/g)];
      llamadas.forEach((m, i) => {
        if (!m[1].startsWith('/api/')) return;
        // El metodo vive en el objeto de opciones, que suele ocupar varias lineas:
        // se busca hasta el siguiente fetch. Si no hay literal (`{ method }` con una
        // variable) se asume GET, que es el valor por defecto de fetch.
        const fin = i + 1 < llamadas.length ? llamadas[i + 1].index : src.length;
        const opciones = src.slice(m.index, fin);
        const mm = opciones.match(/method:\s*['"](\w+)['"]/);
        const linea = src.slice(0, m.index).split('\n').length;
        out.push({
          ruta: m[1],
          metodo: mm ? mm[1].toUpperCase() : 'GET',
          donde: `${p.slice(root.length + 1)}:${linea}`,
        });
      });
    }
  };
  recorrer(appDir);
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('toda llamada del panel tiene una ruta real en el backend (metodo + camino)', () => {
  const backend = rutasDelBackend();
  assert.ok(backend.size > 0, 'no se extrajo ninguna ruta del backend');

  // Se compara el PAR completo. Comparar solo el camino deja pasar un GET sin
  // ruta propia si el mismo camino existe con otro metodo (paso con
  // GET /api/admin/precios/:productoId, que solo existia como PUT).
  const huerfanas = llamadasDelPanel()
    .filter((c) => !IGNORAR.has(c.ruta))
    .filter((c) => !backend.has(`${c.metodo} ${canon(c.ruta)}`));

  assert.deepEqual(
    huerfanas.map((c) => `${c.metodo} ${c.ruta}  (${c.donde})`),
    [],
    'hay llamadas del panel sin ruta correspondiente (mismo metodo) en el backend'
  );
});

test('toda llamada del panel pasa el allowlist del proxy BFF', () => {
  const bff = readFileSync(join(appDir, 'api', '[...path]', 'route.ts'), 'utf8');
  const m = bff.match(/ALLOWED_PATH_PREFIXES\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(m, 'no se encontro ALLOWED_PATH_PREFIXES en el proxy BFF');
  const permitidos = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);

  const bloqueadas = llamadasDelPanel()
    .filter((c) => !IGNORAR.has(c.ruta))
    .filter((c) => {
      const pathStr = c.ruta.split('?')[0].replace(/^\/api\//, '').replace(/\$\{[^}]*\}/g, 'x');
      return !permitidos.some((pref) => pathStr.startsWith(pref) || pathStr === pref.slice(0, -1));
    });

  assert.deepEqual(
    bloqueadas.map((c) => `${c.ruta}  (${c.donde})`),
    [],
    'hay llamadas del panel que el proxy BFF rechazaria con 404'
  );
});

test('regresion: el modulo admin-glow esta montado y el dashboard apunta ahi', () => {
  const idx = readFileSync(backendIndex, 'utf8');
  assert.match(
    idx,
    /app\.use\(\s*['"]\/api\/glow-admin['"]/,
    'el modulo admin-glow (SOS, prestadores, resumen financiero) no esta montado en index.js'
  );

  const page = readFileSync(join(appDir, 'page.tsx'), 'utf8');
  for (const ruta of ['sos/active', 'provider/pending', 'dashboard/financial-summary']) {
    assert.match(
      page,
      new RegExp(`/api/glow-admin/${ruta.replace(/\//g, '\\/')}`),
      `el dashboard no llama a /api/glow-admin/${ruta}`
    );
  }
});

test('regresion: el dashboard no lee campos que el backend no devuelve', () => {
  const page = readFileSync(join(appDir, 'page.tsx'), 'utf8');
  const controller = readFileSync(
    join(backendDir, 'src', 'modules', 'admin-glow', 'admin.controller.js'),
    'utf8'
  );

  // El backend devuelve { success, count, data } -> `data` YA es la coleccion.
  // `data.alerts` / `data.pending` son campos fantasma: dan undefined y la
  // pantalla muestra una lista vacia sin ningun error.
  assert.match(controller, /data:\s*alerts/, 'el backend debe seguir devolviendo `data` como la coleccion');
  assert.match(controller, /data:\s*list/, 'el backend debe seguir devolviendo `data` como la coleccion');

  assert.doesNotMatch(page, /resJson\?\.data\?\.alerts/, 'el panel lee data.alerts, campo que el backend no devuelve');
  assert.doesNotMatch(page, /resJson\?\.data\?\.pending/, 'el panel lee data.pending, campo que el backend no devuelve');
});

test('deuda conocida (fase 2): /api/categorias sigue sin endpoint ni tabla', () => {
  // Si este test empieza a fallar es porque la deuda se resolvio: entonces hay
  // que quitar '/api/categorias' de IGNORAR y cerrar la fase 2 del plan.
  assert.ok(IGNORAR.has('/api/categorias'), 'la deuda de categorias desaparecio de IGNORAR');

  const page = readFileSync(
    join(appDir, '(dashboard)', 'admin', 'productos', 'page.tsx'),
    'utf8'
  );
  assert.match(page, /\/api\/categorias/, 'el panel ya no llama a /api/categorias: revisar el plan');

  // El esquema tiene DOS dueños (migraciones + DDL en runtime en index.js),
  // asi que hay que comprobar los dos antes de afirmar que la tabla no existe.
  const ddl = readdirSync(join(backendDir, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(backendDir, 'migrations', f), 'utf8'))
    .concat(readFileSync(backendIndex, 'utf8'))
    .join('\n');

  assert.doesNotMatch(
    ddl,
    /CREATE TABLE[^;]*\bcategorias\b/i,
    'la tabla categorias ya existe: cerrar la fase 2 del plan'
  );
});

test('regresion: el estado que escribe resolveSOSAlert lo permite el CHECK de sos_alerts', () => {
  // Causa raiz del boton "Atender" que parecia no hacer nada: el controlador
  // escribia 'ATENDIDO', pero el CHECK de la tabla solo admite 'ACTIVO' y
  // 'RESUELTO'. Postgres abortaba el UPDATE por violacion de constraint y la
  // alerta nunca se atendia. Un valor de enum invalido NO da 404: da error en
  // runtime dentro del catch, que lo disfraza de fallo interno generico.
  const ddl = readFileSync(backendIndex, 'utf8');
  const bloque = ddl.match(/CREATE TABLE IF NOT EXISTS sos_alerts[\s\S]*?\);/);
  assert.ok(bloque, 'no se encontro el DDL de sos_alerts en index.js');

  const check = bloque[0].match(/CHECK \(estado IN \(([^)]*)\)\)/);
  assert.ok(check, 'sos_alerts no declara CHECK sobre estado');
  const permitidos = [...check[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(permitidos.length > 0, 'no se extrajeron valores permitidos del CHECK');

  const ctrl = readFileSync(
    join(backendDir, 'src', 'modules', 'admin-glow', 'admin.controller.js'),
    'utf8'
  );
  const usados = [...ctrl.matchAll(/updateSOSAlertStatus\([^)]*?'([^']+)'/g)].map((m) => m[1]);
  assert.ok(usados.length > 0, 'no hay ninguna llamada a updateSOSAlertStatus con estado literal');

  for (const valor of usados) {
    assert.ok(
      permitidos.includes(valor),
      `el controlador escribe '${valor}', que el CHECK de sos_alerts no permite (${permitidos.join(', ')})`
    );
  }
});

test('regresion: la pantalla de SOS muestra la resolucion sin campos fantasma', () => {
  const page = readFileSync(join(appDir, '(dashboard)', 'admin', 'sos', 'page.tsx'), 'utf8');

  // Pide tambien las atendidas: sin eso no puede mostrar ninguna resolucion.
  assert.match(page, /sos\/active\?estado=TODOS/, 'la pantalla no pide las alertas atendidas');
  assert.match(page, /resolucion/, 'la pantalla no lee la resolucion');
  assert.match(page, /resuelto_en/, 'la pantalla no lee cuando se atendio');

  // El backend persiste 'RESUELTO' (unico valor admitido ademas de 'ACTIVO').
  assert.doesNotMatch(page, /'ATENDIDO'/, "la pantalla usa 'ATENDIDO', que no es un estado valido");
});

test('regresion: el modelo persiste la resolucion y su fecha', () => {
  const model = readFileSync(
    join(backendDir, 'src', 'modules', 'admin-glow', 'admin.model.js'),
    'utf8'
  );

  // Guardar la atencion debe escribir los tres campos, no solo el estado.
  assert.match(model, /resolucion = \$3/, 'updateSOSAlertStatus no guarda la resolucion');
  assert.match(model, /resuelto_en = NOW\(\)/, 'updateSOSAlertStatus no registra cuando se atendio');
  assert.match(model, /resuelto_por = \$4/, 'updateSOSAlertStatus no registra quien atendio');

  // Y no debe volver a pisar creado_en (la fecha de emision del SOS).
  const actualizacion = model.match(/async function updateSOSAlertStatus[\s\S]*?`;/);
  assert.ok(actualizacion, 'no se encontro updateSOSAlertStatus');
  assert.doesNotMatch(
    actualizacion[0],
    /creado_en\s*=/,
    'updateSOSAlertStatus vuelve a sobrescribir creado_en (destruye la fecha de emision)'
  );

  // El listado debe devolver los campos que la pantalla pinta.
  const listado = model.match(/async function getActiveSOSAlerts[\s\S]*?`;/);
  assert.ok(listado, 'no se encontro getActiveSOSAlerts');
  for (const campo of ['s.resolucion', 's.resuelto_en']) {
    assert.ok(listado[0].includes(campo), `getActiveSOSAlerts no devuelve ${campo}`);
  }
  assert.match(listado[0], /'TODOS'/, 'getActiveSOSAlerts no soporta el filtro TODOS');
});
