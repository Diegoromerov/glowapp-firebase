/**
 * backend/src/config/knowledgeCategories.js
 * Vocabulario canónico de categorías de la base de conocimiento de Aura.
 *
 * Fuente: `SELECT DISTINCT category FROM beauty_knowledge_embeddings` sobre el corpus
 * canónico (5.619 chunks, 12 dominios). Es la ÚNICA lista válida para `filters.category`:
 * el corpus NO usa etiquetas humanas ("Piel", "Cabello", "Uñas") sino estos slugs.
 *
 * Se usa en dos puntos:
 *   1. `auraToolExecutor` — enum del tool, para que el LLM elija un valor válido.
 *   2. `ragService` — validación defensiva: un valor fuera de este vocabulario NO se
 *      aplica como filtro (fail-open) en vez de devolver 0 filas en silencio.
 *
 * Si el corpus cambia, actualizar aquí: el test `knowledgeCategories.test.js` compara
 * esta lista contra la base de datos cuando hay conexión disponible.
 */

const KNOWLEDGE_CATEGORIES = Object.freeze([
  'colorimetria_capilar_tinte',
  'colorimetria_piel_undertone',
  'cuidado_corporal_y_spa',
  'diagnostico_capilar',
  'guias_unas',
  'ingredientes_activos_contraindicaciones',
  'maquillaje_tecnicas_por_ocasion',
  'skincare_rutinas_por_tipo_piel',
  'tendencias_belleza_virales',
  'textura_poros',
  'tratamientos_esteticos_faciales',
  'visajismo_cejas_microblading',
]);

const KNOWLEDGE_CATEGORY_SET = new Set(KNOWLEDGE_CATEGORIES);

/**
 * Normaliza una etiqueta para compararla con el vocabulario canónico.
 * Acepta variantes con mayúsculas, acentos o espacios ("Guías Uñas" → "guias_unas").
 * NO traduce etiquetas humanas a categorías (no existe un mapeo 1:1: "Cabello" puede ser
 * `diagnostico_capilar`, `colorimetria_capilar_tinte` o `tendencias_belleza_virales`).
 *
 * @param {string} value
 * @returns {string} valor normalizado
 */
function normalizeCategory(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_');
}

/**
 * Devuelve la categoría canónica si el valor es reconocible, o null si no pertenece
 * al vocabulario (en ese caso el llamador NO debe filtrar).
 *
 * @param {string} value
 * @returns {string|null}
 */
function resolveCategory(value) {
  if (!value) return null;
  const normalized = normalizeCategory(value);
  return KNOWLEDGE_CATEGORY_SET.has(normalized) ? normalized : null;
}

module.exports = {
  KNOWLEDGE_CATEGORIES,
  normalizeCategory,
  resolveCategory,
};
