// backend/src/config/ragConfig.js
/**
 * Configuración del retrieval RAG en un solo lugar.
 *
 * Por qué existe: el umbral de similitud estaba hardcodeado en tres puntos del
 * camino real (ragService, y dos llamadas en geminiService), así que cambiarlo
 * en uno solo no cambiaba el comportamiento de producción — el clásico
 * "configuración dispersa" que hace que un fix parezca no aplicado.
 *
 * Calibración (cierre FASE 0, GOLD-V5 · 18 consultas · topK=5):
 *
 *   umbral | con resultados | recall@5 core | precision gold | MRR
 *   0.45   | 13/18          | 0.250         | 0.156          | 0.250
 *   0.40   | 16/18          | 0.317         | 0.211          | 0.338
 *   0.30   | 18/18          | 0.350         | 0.222          | 0.349
 *
 * Con 0.45 cinco consultas legítimas se quedaban sin resultados y caían a
 * full-text. 0.30 responde las 18 y mejora recall, precisión y MRR a la vez:
 * el umbral deja de ser el filtro de calidad y el ranking decide (decisión D3
 * del PLAN_MEJORA_RAG).
 */
const DEFAULT_SIMILARITY_THRESHOLD = 0.3;
const DEFAULT_TOP_K = 5;

function readThreshold() {
  const raw = process.env.RAG_SIMILARITY_THRESHOLD;
  if (raw === undefined || raw === '') return DEFAULT_SIMILARITY_THRESHOLD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    console.warn(
      `[ragConfig] RAG_SIMILARITY_THRESHOLD inválido ("${raw}"); usando ${DEFAULT_SIMILARITY_THRESHOLD}`
    );
    return DEFAULT_SIMILARITY_THRESHOLD;
  }
  return parsed;
}

const RAG_SIMILARITY_THRESHOLD = readThreshold();

module.exports = {
  RAG_SIMILARITY_THRESHOLD,
  DEFAULT_SIMILARITY_THRESHOLD,
  DEFAULT_TOP_K,
};
