// backend/tests/rag.embedding-dimension.test.js
//
// Hallazgo P0 N-4 (t_fix_ragaura_03 · RAG_ARCHITECTURE.md §9.1/§9.2, PLAN_MEJORA_RAG.md FASE 0):
//   La columna pgvector y el código siguen pidiendo 1024 dimensiones, pero el ÚNICO modelo de
//   embeddings habilitado para la cuenta del proyecto (`nvidia/nemotron-3-embed-1b`, medido en
//   RAG_ARCHITECTURE.md §9.1) devuelve vectores de 2048 dimensiones. Consecuencia: la ingesta
//   falla (no guarda el vector) y `ragService` degrada a full-text: la búsqueda vectorial queda
//   efectivamente desactivada.
//
// Este test es ESTÁTICO (solo lee archivos del repositorio; no abre BD ni llama a la red) y
// compara las TRES fuentes que deben coincidir con la dimensión del modelo vivo:
//   1. el DDL efectivo de la columna `embedding` en las migraciones,
//   2. `expectedDimension` de `embeddingService.js`,
//   3. `EXPECTED_DIMS` de `ragService.js`.
// Si las tres no igualan la dimensión del modelo vivo, la ruta vectorial está rota.

const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..');
const MIGRATIONS_DIR = path.join(BACKEND_ROOT, 'migrations');
// Las migraciones del RAG viven en migrations/rag/ (runner propio contra
// RAG_DATABASE_URL). Para los chequeos de contenido cuentan igual.
const RAG_MIGRATIONS_DIR = path.join(MIGRATIONS_DIR, 'rag');
const EMBEDDING_SERVICE = path.join(BACKEND_ROOT, 'src', 'services', 'embeddingService.js');
const RAG_SERVICE = path.join(BACKEND_ROOT, 'src', 'services', 'ragService.js');

// Dimensión del modelo de embeddings VIVO (medida contra la API real; ver RAG_ARCHITECTURE.md §9.1).
// `nvidia/nv-embedqa-e5-v5` (1024d) alcanzó EOL 2026-08-25 → HTTP 410 Gone.
const LIVE_MODEL = 'nvidia/nemotron-3-embed-1b';
const LIVE_MODEL_DIMENSION = 2048;
const RETIRED_MODELS = ['nvidia/nv-embedqa-e5-v5'];
const MODEL_DIMENSIONS = {
  'nvidia/nemotron-3-embed-1b': 2048,
  'nvidia/nv-embedqa-e5-v5': 1024,
};

const read = (p) => fs.readFileSync(p, 'utf8');

const stripSqlComments = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n\r]*/g, ' ');

/** Migraciones SQL aplicables (excluye .down.sql, igual que migrationRunner.js). */
const applicableMigrations = () => {
  const dirs = [MIGRATIONS_DIR, RAG_MIGRATIONS_DIR].filter((d) => fs.existsSync(d));
  return dirs
    .flatMap((dir) => fs.readdirSync(dir)
      .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
      .map((file) => ({ file, dir })))
    .sort((a, b) => a.file.localeCompare(b.file))
    .map(({ file, dir }) => ({ file, sql: stripSqlComments(read(path.join(dir, file))) }));
};

/**
 * Dimensión EFECTIVA de `beauty_knowledge_embeddings.embedding`: la última declaración
 * `embedding vector(N)` / `embedding halfvec(N)` / `ALTER COLUMN embedding TYPE ...` en
 * orden de ejecución (pgvector limita HNSW/IVFFlat a 2000 dims con `vector`, por eso
 * el corpus usa `halfvec(2048)`).
 * (nombres de archivo ordenados alfabéticamente, como los aplica migrationRunner).
 */
const effectiveColumnDimension = () => {
  const re = /embedding\s+(?:TYPE\s+)?(?:halfvec|vector)\((\d+)\)/g;
  let last = null;
  let lastFile = null;
  for (const { file, sql } of applicableMigrations()) {
    let m;
    while ((m = re.exec(sql)) !== null) {
      last = Number(m[1]);
      lastFile = file;
    }
  }
  return { dimension: last, file: lastFile };
};

const configuredModel = () => {
  const src = read(EMBEDDING_SERVICE);
  const m = src.match(/model:\s*process\.env\.NVIDIA_EMBEDDING_MODEL\s*\|\|\s*'([^']+)'/);
  if (!m) throw new Error('No se pudo determinar el modelo por defecto en embeddingService.js');
  return m[1];
};

const declaredExpectedDimension = () => {
  const m = read(EMBEDDING_SERVICE).match(/expectedDimension\s*:\s*(\d+)/);
  if (!m) throw new Error('No se encontró expectedDimension en embeddingService.js');
  return Number(m[1]);
};

const declaredRagServiceDims = () => {
  const m = read(RAG_SERVICE).match(/EXPECTED_DIMS\s*=\s*(\d+)/);
  if (!m) throw new Error('No se encontró EXPECTED_DIMS en ragService.js');
  return Number(m[1]);
};

describe('RAG · dimensión de embeddings vs modelo vivo', () => {
  test('el modelo configurado es el modelo VIVO de 2048 dimensiones (no un modelo retirado)', () => {
    const model = configuredModel();
    expect(RETIRED_MODELS).not.toContain(model);
    expect(MODEL_DIMENSIONS[model]).toBe(LIVE_MODEL_DIMENSION);
    expect(model).toBe(LIVE_MODEL);
  });

  test('expectedDimension (embeddingService) coincide con la dimensión del modelo vivo', () => {
    const model = configuredModel();
    const modelDim = MODEL_DIMENSIONS[model];
    expect(modelDim).toBe(LIVE_MODEL_DIMENSION);
    expect(declaredExpectedDimension()).toBe(modelDim);
  });

  test('EXPECTED_DIMS (ragService) coincide con la dimensión del modelo vivo', () => {
    const model = configuredModel();
    expect(MODEL_DIMENSIONS[model]).toBe(LIVE_MODEL_DIMENSION);
    expect(declaredRagServiceDims()).toBe(LIVE_MODEL_DIMENSION);
  });

  test('la columna pgvector efectiva coincide con la dimensión del modelo vivo', () => {
    const { dimension, file } = effectiveColumnDimension();
    expect(dimension).not.toBeNull();
    const model = configuredModel();
    // Las TRES fuentes deben coincidir con el modelo vivo.
    expect({ column: dimension, model: MODEL_DIMENSIONS[model], live: LIVE_MODEL_DIMENSION })
      .toEqual({ column: LIVE_MODEL_DIMENSION, model: LIVE_MODEL_DIMENSION, live: LIVE_MODEL_DIMENSION });
    expect(file).toBeTruthy();
  });

  test('existe una migración que reconstruye la columna a 2048 y recrea el índice HNSW', () => {
    const migrations = applicableMigrations();
    const target = migrations.filter(({ sql }) =>
      /(?:halfvec|vector)\(2048\)/.test(sql) &&
      /USING\s+hnsw\s*\(\s*embedding\s+(?:halfvec|vector)_cosine_ops\s*\)/i.test(sql)
    );
    expect(target.length).toBeGreaterThan(0);
  });

  test('la migración de dimensión documenta la re-ingesta obligatoria del corpus', () => {
    const migrations = applicableMigrations();
    const target = migrations.find(({ sql }) => /(?:halfvec|vector)\(2048\)/.test(sql));
    expect(target).toBeTruthy();
    expect(target.sql.toLowerCase()).toMatch(/re-?ingesta|re-?ingest/);
  });
});
