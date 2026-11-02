/**
 * backend/src/tests/embeddingService.eolModel.test.js
 * Regresión P0 (tarjeta t_fix_ragaura_01) — «Modelo NVIDIA EOL 410 Gone».
 *
 * Hallazgo (AUD-RAGAURA-01 · backend/src/services/embeddingService.js):
 *   El modelo por defecto `nvidia/nv-embedqa-e5-v5` alcanzó su end of life el
 *   2026-08-25 y la API NVIDIA NIM responde **HTTP 410 Gone** para él. La ruta
 *   vectorial no puede producir embeddings con un modelo retirado
 *   (RAG_ARCHITECTURE.md §9.1).
 *
 *   El único modelo de embeddings habilitado para la cuenta del proyecto es
 *   `nvidia/nemotron-3-embed-1b` (verificado con la key real: GET /v1/models → 200,
 *   POST /v1/embeddings con los otros 6 modelos del catálogo → 404 not found for account).
 *
 * TEST ROJO  (antes del fix): DEFAULT_CONFIG.model === 'nvidia/nv-embedqa-e5-v5'
 * TEST VERDE (después del fix): DEFAULT_CONFIG.model === 'nvidia/nemotron-3-embed-1b'
 */

const fs = require('fs');
const path = require('path');

const MODELO_EOL = 'nvidia/nv-embedqa-e5-v5';
const MODELO_VIVO = 'nvidia/nemotron-3-embed-1b';
const SRC_PATH = path.join(__dirname, '..', 'services', 'embeddingService.js');
const SOURCE = fs.readFileSync(SRC_PATH, 'utf8');

/** Re-requiere el servicio sin `NVIDIA_EMBEDDING_MODEL` para leer el DEFAULT real. */
function defaultConfigSinOverride() {
  const previo = process.env.NVIDIA_EMBEDDING_MODEL;
  delete process.env.NVIDIA_EMBEDDING_MODEL;
  jest.resetModules();
  const { DEFAULT_CONFIG } = require('../services/embeddingService');
  if (previo !== undefined) process.env.NVIDIA_EMBEDDING_MODEL = previo;
  return DEFAULT_CONFIG;
}

describe('embeddingService · el modelo por defecto no puede estar retirado (P0 410 Gone)', () => {
  test('el modelo por defecto ya no es el retirado (EOL 2026-08-25)', () => {
    expect(defaultConfigSinOverride().model).not.toBe(MODELO_EOL);
  });

  test('el modelo por defecto es el único vivo/habilitado para la cuenta', () => {
    expect(defaultConfigSinOverride().model).toBe(MODELO_VIVO);
  });

  test('el código no vuelve a caer por defecto en el modelo retirado', () => {
    // Ni como fallback de entorno ni como literal de configuración.
    expect(SOURCE).not.toMatch(
      /NVIDIA_EMBEDDING_MODEL\s*\|\|\s*['"]nvidia\/nv-embedqa-e5-v5['"]/
    );
    expect(SOURCE).not.toMatch(/model:\s*['"]nvidia\/nv-embedqa-e5-v5['"]/);
  });

  test('el modelo sigue siendo configurable por entorno (override explícito)', () => {
    expect(SOURCE).toMatch(/process\.env\.NVIDIA_EMBEDDING_MODEL/);
  });
});
