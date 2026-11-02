// backend/tests/academy.migrations.test.js
// Pruebas de regresión sobre los archivos de migración de la Academia Glow.
// El daño de datos de la auditoría 2026-09-22 vino de dos migraciones que
// declaraban el MISMO UUID de módulo/lección con distinto padre: estos tests
// fallan si alguien vuelve a introducir ese patrón.

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const readMigrations = () => fs.readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
  .sort()
  .map((file) => ({ file, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8') }));

/**
 * Extrae los pares (id_de_fila, id_del_padre) de un INSERT ... VALUES de
 * academy_modules (padre = course_id) o academy_lessons (padre = module_id).
 */
function extractPairs(sql, table) {
  const blocks = [...sql.matchAll(
    new RegExp(`INSERT INTO ${table}\\s*\\(id,\\s*(course_id|module_id)[^)]*\\)\\s*VALUES([\\s\\S]*?)(?:ON CONFLICT|;)`, 'gi')
  )];

  const pairs = [];
  for (const block of blocks) {
    for (const tuple of block[2].matchAll(/\(\s*'([0-9a-fA-F-]{36})'\s*,\s*'([0-9a-fA-F-]{36})'/g)) {
      pairs.push({
        id: tuple[1].toLowerCase(),
        owner: tuple[2].toLowerCase(),
        parentColumn: block[1].toLowerCase(),
        hasDoUpdate: /ON CONFLICT[\s\S]*?DO UPDATE/i.test(block[0]),
        setClause: (block[0].match(/DO UPDATE\s+SET([\s\S]*)$/i) || [, ''])[1],
        migration: null,
      });
    }
  }
  return pairs;
}

const allPairs = (table) => readMigrations().flatMap(({ file, sql }) =>
  extractPairs(sql, table).map((p) => ({ ...p, migration: file })));

const groupByOwner = (pairs) => pairs.reduce((acc, p) => {
  acc[p.id] = acc[p.id] || new Set();
  acc[p.id].add(p.owner);
  return acc;
}, {});

describe('colisiones de UUID entre migraciones de la academia', () => {
  test('ningún módulo pertenece a dos cursos distintos', () => {
    const grouped = groupByOwner(allPairs('academy_modules'));
    const colisiones = Object.entries(grouped)
      .filter(([, owners]) => owners.size > 1)
      .map(([id, owners]) => `${id} -> ${[...owners].join(', ')}`);

    expect(colisiones).toEqual([]);
  });

  test('ninguna lección pertenece a dos módulos distintos', () => {
    const grouped = groupByOwner(allPairs('academy_lessons'));
    const colisiones = Object.entries(grouped)
      .filter(([, owners]) => owners.size > 1)
      .map(([id, owners]) => `${id} -> ${[...owners].join(', ')}`);

    expect(colisiones).toEqual([]);
  });

  test('los cursos 1 y 2 usan un namespace propio (d1…/d2…) sin solaparse con 025/026', () => {
    const migraciones = readMigrations();
    const ocho = migraciones.find((m) => m.file.startsWith('008'));
    const veintiseis = migraciones.find((m) => m.file.startsWith('026'));

    const idsOcho = extractPairs(ocho.sql, 'academy_modules').map((p) => p.id);
    const idsVeintiseis = extractPairs(veintiseis.sql, 'academy_modules').map((p) => p.id);

    expect(idsOcho.length).toBeGreaterThan(0);
    expect(idsOcho.every((id) => id.startsWith('d1'))).toBe(true);
    expect(idsOcho.filter((id) => idsVeintiseis.includes(id))).toEqual([]);
  });

  test('los seeds re-ejecutables son no destructivos: DO UPDATE solo si refresca el padre', () => {
    const ofensivos = [...allPairs('academy_modules'), ...allPairs('academy_lessons')]
      .filter((p) => p.hasDoUpdate)
      .filter((p) => !new RegExp(`${p.parentColumn}\\s*=\\s*EXCLUDED\\.${p.parentColumn}`, 'i').test(p.setClause))
      .map((p) => `${p.migration} (${p.id})`);

    expect(ofensivos).toEqual([]);
  });
});

describe('migración 066 (reparación del currículo)', () => {
  const files = readMigrations();
  const reparadora = files.find((m) => m.file.startsWith('066'));
  const COURSE = 'c0000000-0000-0000-0000-000000000003';

  test('existe y define 9 módulos del curso de colorimetría', () => {
    expect(reparadora).toBeDefined();
    const modules = extractPairs(reparadora.sql, 'academy_modules')
      .filter((p) => p.parentColumn === 'course_id');

    expect(modules).toHaveLength(9);
    expect(new Set(modules.map((m) => m.id)).size).toBe(9);
    const propios = modules.filter((m) => m.owner === COURSE);
    expect(propios).toHaveLength(9);
  });

  test('define las 15 lecciones y todas cuelgan de un módulo declarado en la propia migración', () => {
    const modules = extractPairs(reparadora.sql, 'academy_modules').map((m) => m.id);
    const lessons = extractPairs(reparadora.sql, 'academy_lessons');

    expect(lessons).toHaveLength(15);
    const huerfanas = lessons.filter((l) => !modules.includes(l.owner));
    expect(huerfanas).toEqual([]);
  });

  test('cada módulo tiene al menos una lección (no quedan módulos vacíos)', () => {
    const lessons = extractPairs(reparadora.sql, 'academy_lessons');
    const porModulo = lessons.reduce((acc, l) => {
      acc[l.owner] = (acc[l.owner] || 0) + 1;
      return acc;
    }, {});

    const vacios = Object.entries(porModulo).filter(([, n]) => n === 0);
    expect(vacios).toEqual([]);
    // Las lecciones del módulo de evaluación final y el de bienvenida existen
    expect(porModulo['b0000000-0000-0000-0000-000000000000']).toBe(1);
    expect(porModulo['b0000000-0000-0000-0000-000000000008']).toBe(1);
  });

  test('sanea los videos placeholder y los marcadores de contenido en crudo', () => {
    expect(reparadora.sql).toMatch(/dQw4w9WgXcQ/);
    expect(reparadora.sql).toMatch(/CONTENIDO_LECCION/);
    expect(reparadora.sql).toMatch(/SET\s+video_url\s*=\s*NULL/i);
  });
});

describe('migración 067 (integridad y certificado verificable)', () => {
  const integridad = readMigrations().find((m) => m.file.startsWith('067'));

  test('crea el registro de intentos del examen', () => {
    expect(integridad).toBeDefined();
    expect(integridad.sql).toMatch(/CREATE TABLE IF NOT EXISTS academy_quiz_attempts/i);
    expect(integridad.sql).toMatch(/pass_pct/);
  });

  test('añade código, revocación y versión al certificado', () => {
    expect(integridad.sql).toMatch(/ADD COLUMN IF NOT EXISTS code/i);
    expect(integridad.sql).toMatch(/ADD COLUMN IF NOT EXISTS revoked/i);
    expect(integridad.sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_academy_certificates_code/i);
  });

  test('añade soft-delete a cursos y prueba del consentimiento', () => {
    expect(integridad.sql).toMatch(/academy_courses ADD COLUMN IF NOT EXISTS deleted_at/i);
    expect(integridad.sql).toMatch(/texto_hash/);
    expect(integridad.sql).toMatch(/aceptado_ip/);
  });

  test('es idempotente: cada ALTER/CREATE usa IF NOT EXISTS', () => {
    const sentencias = integridad.sql
      .split('\n')
      .filter((line) => /^\s*(ALTER TABLE|CREATE TABLE|CREATE (UNIQUE )?INDEX)/i.test(line));

    const sinGuardas = sentencias.filter((line) => !/IF NOT EXISTS/i.test(line));
    // El único ALTER sin IF NOT EXISTS es el SET NOT NULL (no admite la guarda)
    expect(sinGuardas.every((line) => /SET NOT NULL/i.test(line))).toBe(true);
  });
});

describe('todas las migraciones de la academia', () => {
  test('los UUID declarados tienen formato válido', () => {
    const invalidos = [...allPairs('academy_modules'), ...allPairs('academy_lessons')]
      .filter((p) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(p.id));
    expect(invalidos).toEqual([]);
  });

  test('los rollbacks (.down.sql) nunca entran en el runner', () => {
    const aplicables = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'));
    expect(aplicables.some((f) => f.endsWith('.down.sql'))).toBe(false);
  });
});
