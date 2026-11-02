// backend/src/services/biometric/delta.service.js
//
// Y-F3 — Cambio medido contra el baseline del mismo usuario.
//
// Qué hace y qué no: compara el escaneo actual con el anterior del mismo usuario,
// métrica por métrica, sobre `raw_score` (el float sin redondear; el `ui_score`
// entero esconde cambios de 2–3 puntos). No diagnostica: dice si la medición subió,
// bajó o quedó dentro del ruido.
//
// Ruido: `threshold` es el mínimo de |Δ| para considerar que hubo cambio. Por defecto
// 2.0 puntos de raw_score, que es el orden de test-retest que declara Perfect Corp.;
// se puede fijar con BIOMETRIC_DELTA_THRESHOLD sin tocar código.
//
// Polaridad: no se inventa. Solo se marca "mejor/peor" en las métricas cuya escala
// está documentada; en las demás se informa la magnitud y `polaridad: no_declarada`,
// porque afirmar que más textura es mejor (o peor) sería una interpretación clínica
// que este código no puede sostener.

const DEFAULT_THRESHOLD = Number(process.env.BIOMETRIC_DELTA_THRESHOLD || 2.0);

/** mayor_mejor: el score sube cuando la piel mejora. menor_mejor: al contrario. */
const POLARITY = Object.freeze({
  hd_moisture: 'mayor_mejor',
  hd_radiance: 'mayor_mejor',
  hd_firmness: 'mayor_mejor',
  hd_wrinkle: 'mayor_peor',
  hd_pore: 'mayor_peor',
  hd_acne: 'mayor_peor',
  hd_age_spot: 'mayor_peor',
  hd_redness: 'mayor_peor',
  hd_dark_circle: 'mayor_peor',
  hd_eye_bag: 'mayor_peor',
  hd_tear_trough: 'mayor_peor',
  hd_droopy_upper_eyelid: 'mayor_peor',
  hd_droopy_lower_eyelid: 'mayor_peor',
  skin_age: 'menor_mejor',
});

/** Familias que ya usa el producto para agrupar el diagnóstico. */
const FAMILIES = Object.freeze({
  hidratacion: ['hd_moisture'],
  textura: ['hd_texture'],
  poros: ['hd_pore'],
  arrugas: ['hd_wrinkle'],
  manchas: ['hd_age_spot', 'hd_redness'],
  firmeza: ['hd_firmness'],
  ojos: ['hd_dark_circle', 'hd_eye_bag', 'hd_droopy_upper_eyelid', 'hd_droopy_lower_eyelid', 'hd_tear_trough'],
  acne: ['hd_acne'],
});

const baseType = (key) => String(key).split('.')[0];
const zoneOf = (key) => {
  const parts = String(key).split('.');
  return parts.length > 1 ? parts[1] : 'whole';
};

const numeric = (metric) => {
  if (!metric) return null;
  if (typeof metric.raw_score === 'number' && Number.isFinite(metric.raw_score)) return metric.raw_score;
  if (typeof metric.ui_score === 'number' && Number.isFinite(metric.ui_score)) return metric.ui_score;
  return null;
};

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Compara dos mapas de métricas.
 * @param {Object} previous - payload.metrics del escaneo base
 * @param {Object} current - payload.metrics del escaneo nuevo
 * @param {{threshold?: number}} options
 */
function compareMetrics(previous, current, { threshold = DEFAULT_THRESHOLD } = {}) {
  const keys = new Set([...Object.keys(previous || {}), ...Object.keys(current || {})]);
  const comparisons = [];
  const onlyInBaseline = [];
  const onlyInCurrent = [];

  for (const key of keys) {
    const before = numeric(previous?.[key]);
    const after = numeric(current?.[key]);

    if (before === null && after === null) continue;
    if (before === null) { onlyInCurrent.push(key); continue; }
    if (after === null) { onlyInBaseline.push(key); continue; }

    const delta = after - before;
    const significant = Math.abs(delta) >= threshold;
    const polarity = POLARITY[baseType(key)] || 'no_declarada';

    let change = 'sin_cambio';
    if (significant) {
      if (polarity === 'no_declarada') change = 'cambio_medido';
      else {
        const mejor = (polarity === 'mayor_mejor' && delta > 0) || (polarity === 'mayor_peor' && delta < 0)
          || (polarity === 'menor_mejor' && delta < 0);
        change = mejor ? 'mejora' : 'empeora';
      }
    }

    comparisons.push({
      key,
      zone: zoneOf(key),
      type: baseType(key),
      polarity,
      before: round1(before),
      after: round1(after),
      delta: round1(delta),
      deltaPct: before === 0 ? null : Math.round((delta / Math.abs(before)) * 1000) / 10,
      significant,
      change,
      masks: {
        before: previous?.[key]?.mask_name || null,
        after: current?.[key]?.mask_name || null,
      },
    });
  }

  return { comparisons, onlyInBaseline, onlyInCurrent };
}

/** Agrupa por familia y por zona, sin decidir nada que no esté medido. */
function groupComparisons(comparisons) {
  const byFamily = {};
  for (const [family, prefixes] of Object.entries(FAMILIES)) {
    const items = comparisons.filter((c) => prefixes.includes(c.type));
    if (items.length === 0) continue;
    const deltas = items.map((c) => c.delta);
    byFamily[family] = {
      metrics: items.length,
      deltaMedio: round1(deltas.reduce((a, b) => a + b, 0) / deltas.length),
      mejoras: items.filter((c) => c.change === 'mejora').length,
      empeoras: items.filter((c) => c.change === 'empeora').length,
      sinCambio: items.filter((c) => c.change === 'sin_cambio').length,
      cambioSinPolaridad: items.filter((c) => c.change === 'cambio_medido').length,
    };
  }

  const byZone = {};
  for (const item of comparisons) {
    byZone[item.zone] = byZone[item.zone] || { metrics: 0, deltas: [], mejoras: 0, empeoras: 0 };
    byZone[item.zone].metrics += 1;
    byZone[item.zone].deltas.push(item.delta);
    if (item.change === 'mejora') byZone[item.zone].mejoras += 1;
    if (item.change === 'empeora') byZone[item.zone].empeoras += 1;
  }
  for (const zone of Object.keys(byZone)) {
    const deltas = byZone[zone].deltas;
    byZone[zone].deltaMedio = round1(deltas.reduce((a, b) => a + b, 0) / deltas.length);
    delete byZone[zone].deltas;
  }

  return { byFamily, byZone };
}

function overallVerdict(comparisons, glowDelta, threshold) {
  const significativos = comparisons.filter((c) => c.significant);
  if (significativos.length === 0 && Math.abs(glowDelta) < threshold) return 'SIN_CAMBIO';

  const mejoras = comparisons.filter((c) => c.change === 'mejora').length;
  const empeoras = comparisons.filter((c) => c.change === 'empeora').length;

  if (mejoras === 0 && empeoras === 0) return 'CAMBIO_SIN_POLARIDAD';
  if (mejoras > 0 && empeoras === 0) return 'MEJORO';
  if (empeoras > 0 && mejoras === 0) return 'EMPEORO';
  return 'MIXTO';
}

/**
 * Comparación completa.
 * @param {Object} params
 * @param {Object} params.previous - { metrics, legacy, capturedAt }
 * @param {Object} params.current - { metrics, legacy, capturedAt }
 * @param {number} params.glowScoreBefore
 * @param {number} params.glowScoreAfter
 * @param {number} [params.threshold]
 */
function compareScans({ previous, current, glowScoreBefore, glowScoreAfter, threshold = DEFAULT_THRESHOLD }) {
  const { comparisons, onlyInBaseline, onlyInCurrent } = compareMetrics(
    previous?.metrics,
    current?.metrics,
    { threshold }
  );

  const glowDelta = (typeof glowScoreAfter === 'number' && typeof glowScoreBefore === 'number')
    ? round1(glowScoreAfter - glowScoreBefore)
    : null;

  const { byFamily, byZone } = groupComparisons(comparisons);

  return {
    threshold,
    baselineCapturedAt: previous?.capturedAt || null,
    currentCapturedAt: current?.capturedAt || null,
    compared: comparisons.length,
    significant: comparisons.filter((c) => c.significant).length,
    verdict: overallVerdict(comparisons, glowDelta ?? 0, threshold),
    glowScore: {
      before: typeof glowScoreBefore === 'number' ? round1(glowScoreBefore) : null,
      after: typeof glowScoreAfter === 'number' ? round1(glowScoreAfter) : null,
      delta: glowDelta,
      significant: glowDelta === null ? null : Math.abs(glowDelta) >= threshold,
    },
    byFamily,
    byZone,
    comparisons,
    onlyInBaseline,
    onlyInCurrent,
    notes: [
      `Umbral de cambio: |Δ| >= ${threshold} puntos de raw_score.`,
      'Solo las métricas con escala documentada reciben juicio de mejora o empeora.',
      'Esto mide cambio contra tu propio baseline; no es un diagnóstico médico.',
    ],
  };
}

module.exports = {
  DEFAULT_THRESHOLD,
  POLARITY,
  FAMILIES,
  compareMetrics,
  compareScans,
};
