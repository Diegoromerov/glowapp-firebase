#!/usr/bin/env node
/**
 * backend/scripts/r5c6QueryCorpusCoverageExperiment.js
 * CICLO 18 — R5-C6: QUERY FORMULATION + CORPUS COVERAGE (read-only)
 *
 * Separa experimentalmente:
 *  - QUERY FORMULATION: Q0 original vs Q1 paráfrasis vs Q2 clarificación de intención
 *  - CORPUS COVERAGE: clasificación E0-E3 de la evidencia disponible por query
 *
 * Reglas anti-leakage:
 *  - Q1/Q2 se derivan SOLO de la intención de la query original (documentadas con rationale)
 *  - NO se usan expected_chunks para construir reformulaciones
 *  - expected_chunks se usan SOLO en la evaluación final
 *
 * Métricas en DOS capas:
 *  - Capa 1: contra expected_chunks oficiales (benchmark)
 *  - Capa 2: contra evidence_chunks (chunks del top-10 que son semánticamente relevantes)
 *
 * Uso: node scripts/r5c6QueryCorpusCoverageExperiment.js --run=A
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { generateEmbedding } = require('../src/services/embeddingService');

const DS = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v2.json');
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');

// ── Q0/Q1/Q2 por query (documentado, sin leakage) ──
// Q1 = paráfrasis (misma intención, forma distinta)
// Q2 = clarificación de intención (intención implícita explícita, SIN información nueva)
const QUERY_VARIANTS = {
  'skincare_003': {
    q0: 'Rutina para piel grasa en clima húmedo de Bogotá',
    q1: '¿Qué rutina de cuidado facial conviene para piel grasa viviendo en un clima húmedo?',
    q2: '¿Qué productos y pasos debo incluir en mi rutina diaria si tengo piel grasa y vivo en una ciudad húmeda como Bogotá?',
    rationale: 'Q1: misma intención en forma interrogativa. Q2: hace explícito "productos y pasos de rutina diaria" — implícito en "rutina". No agrega keywords de corpus.',
  },
  'skincare_005': {
    q0: 'Mejor protector solar para piel sensible con melasma',
    q1: '¿Qué protector solar es el más adecuado cuando la piel es sensible y presenta manchas oscuras?',
    q2: '¿Qué características debe tener un protector solar para una persona con piel sensible que además tiene manchas oscuras por melasma?',
    rationale: 'Q1: manchas oscuras = melasma (descripción). Q2: pide características del producto — intención implícita de selección.',
  },
  'skincare_006': {
    q0: '¿Cómo usar ácido hialurónico correctamente?',
    q1: '¿De qué manera se debe aplicar el ácido hialurónico en la rutina facial?',
    q2: '¿En qué momento del día y con qué orden de aplicación se usa el ácido hialurónico para obtener el mejor resultado?',
    rationale: 'Q1: paráfrasis. Q2: hace explícito "momento y orden de aplicación" — implícito en "usar correctamente".',
  },
  'skincare_007': {
    q0: 'Rutina nocturna anti-edad para piel mixta 35 años',
    q1: '¿Qué pasos nocturnos se recomiendan para prevenir el envejecimiento en piel mixta madura?',
    q2: '¿Qué productos debo aplicar por la noche, en orden, para cuidar el envejecimiento de una piel mixta de 35 años?',
    rationale: 'Q1: 35≈madura, anti-edad≈prevenir envejecimiento. Q2: explícito "productos por la noche en orden" — implícito en rutina.',
  },
  'skincare_008': {
    q0: 'Tratamiento para hiperpigmentación post-inflamatoria en piel morena',
    q1: '¿Cómo tratar las manchas oscuras que quedan tras la inflamación en piel de tono moreno?',
    q2: '¿Qué tratamientos existen para las manchas que deja la inflamación de la piel, específicamente en personas de piel morena?',
    rationale: 'Q1: descripción coloquial. Q2: pide tratamientos explícitamente — intención implícita.',
  },
  'skincare_009': {
    q0: '¿Puedo combinar niacinamida y vitamina C en la misma rutina?',
    q1: '¿Es seguro usar niacinamida junto con vitamina C en una misma rutina facial?',
    q2: '¿Existe alguna interacción problemática entre la niacinamida y la vitamina C si se aplican en la misma rutina de cuidado facial?',
    rationale: 'Q1: paráfrasis. Q2: hace explícita la pregunta de interacción/seguridad — intención implícita.',
  },
  'skincare_010': {
    q0: 'Mejor limpiador para piel seca y sensible',
    q1: '¿Qué limpiador facial es recomendable para piel seca y sensible?',
    q2: '¿Qué características debería tener un limpiador facial adecuado para piel seca y sensible, y qué ingredientes evitar?',
    rationale: 'Q1: paráfrasis. Q2: explícito "características e ingredientes" — selección implícita en "mejor".',
  },
  'cabello_002': {
    q0: 'Tratamiento para cabello dañado por decoloración',
    q1: '¿Cómo se puede reparar el cabello que ha sido dañado por un proceso de decoloración?',
    q2: '¿Qué productos o procedimientos ayudan a restaurar un cabello que quedó dañado después de una decoloración?',
    rationale: 'Q1: paráfrasis. Q2: explícito "productos o procedimientos de restauración" — intención de tratamiento.',
  },
  'cabello_004': {
    q0: 'Caída de cabello post-parto y estrés, qué usar',
    q1: '¿Qué producto usar para la caída del cabello relacionada con el embarazo o el estrés?',
    q2: '¿Qué tratamiento existe para la pérdida de cabello que ocurre después del parto o por épocas de mucho estrés?',
    rationale: 'Q1: post-parto≈embarazo. Q2: explícito "tratamiento para pérdida de cabello" — intención de remedio.',
  },
  'cabello_006': {
    q0: 'Mejor champú para cuero cabelludo graso y puntas secas',
    q1: '¿Qué champú elegir cuando el cuero cabelludo es graso pero las puntas están secas?',
    q2: '¿Qué tipo de champú es adecuado para un cuero cabelludo graso con puntas secas, y qué debe evitar?',
    rationale: 'Q1: paráfrasis. Q2: explícito "tipo de champú y qué evitar" — selección implícita.',
  },
  'cabello_008': {
    q0: 'Tratamiento casero vs profesional para hidratación profunda',
    q1: '¿En qué se diferencia hidratar el cabello en casa frente a hacerlo con un profesional?',
    q2: '¿Cuál es la diferencia entre los tratamientos caseros y los profesionales para la hidratación profunda del cabello, y cuál es más efectivo?',
    rationale: 'Q1: paráfrasis comparativa. Q2: explícito "efectividad" — intención de comparación de resultados.',
  },
  'cejas_001': {
    q0: '¿Qué es el microblading y cuánto dura?',
    q1: '¿En qué consiste el microblading y durante cuánto tiempo se mantiene el resultado?',
    q2: '¿Qué es el procedimiento de microblading, en qué consiste, y cuánto tiempo dura su efecto sobre las cejas?',
    rationale: 'Q1: paráfrasis. Q2: explícito "procedimiento sobre cejas" — contexto implícito.',
  },
  'cejas_002': {
    q0: 'Diferencia entre microblading, microshading y nanoblading',
    q1: '¿Qué distingue al microblading del microshading y del nanoblading?',
    q2: '¿Cuáles son las diferencias técnicas entre las técnicas de microblading, microshading y nanoblading para cejas?',
    rationale: 'Q1: paráfrasis. Q2: explícito "diferencias técnicas" — intención comparativa.',
  },
  'cejas_003': {
    q0: 'Forma de cejas ideal para cara redonda',
    q1: '¿Qué forma de cejas es la más favorecedora para un rostro redondo?',
    q2: '¿Qué diseño de cejas se recomienda para equilibrar un rostro redondo y qué características debe tener?',
    rationale: 'Q1: paráfrasis. Q2: explícito "diseño para equilibrar" — intención de recomendación de diseño.',
  },
  'cejas_004': {
    q0: 'Corrección de cejas asimétricas con micropigmentación',
    q1: '¿Se pueden corregir cejas asimétricas mediante micropigmentación?',
    q2: '¿Cómo corrige la micropigmentación la asimetría entre las dos cejas y qué técnicas de diseño se usan?',
    rationale: 'Q1: paráfrasis. Q2: explícito "cómo corrige y técnicas de diseño" — intención de método.',
  },
  'cejas_005': {
    q0: 'Cuidados post-microblading: qué hacer y qué evitar',
    q1: '¿Qué cuidados conviene seguir después de un microblading y cuáles deben evitarse?',
    q2: '¿Qué se debe hacer y qué se debe evitar durante la recuperación después de un microblading?',
    rationale: 'Q1: paráfrasis. Q2: explícito "durante la recuperación" — contexto temporal implícito.',
  },
  'cejas_007': {
    q0: 'Contraindicaciones del microblading: quién NO debería hacerse',
    q1: '¿Quiénes no deberían realizarse microblading por razones de salud?',
    q2: '¿Qué condiciones de salud o características de la piel hacen que una persona no deba hacerse microblading?',
    rationale: 'Q1: paráfrasis. Q2: explícito "condiciones de salud o características de la piel" — intención de enumerar contraindicaciones.',
  },
  'cejas_008': {
    q0: 'Remoción de microblading mal hecho: opciones y riesgos',
    q1: '¿Qué opciones existen para retirar un microblading mal realizado y cuáles son los riesgos?',
    q2: '¿Qué métodos existen para eliminar un microblading mal ejecutado, qué riesgos tiene cada uno y cómo elegir?',
    rationale: 'Q1: paráfrasis. Q2: explícito "métodos, riesgos y elección" — intención de decisión informada.',
  },
};

function computeMetrics(rankedIds, expected) {
  const out = { p1: 0, p3: 0, p5: 0, r5: 0, mrr: 0 };
  for (let i = 0; i < Math.min(5, rankedIds.length); i++) {
    if (expected.includes(rankedIds[i])) { if (out.mrr === 0) out.mrr = 1 / (i + 1); }
  }
  const hits5 = rankedIds.slice(0, 5).filter(id => expected.includes(id));
  out.p5 = hits5.length / 5;
  out.r5 = hits5.length / Math.max(1, expected.length);
  out.p3 = rankedIds.slice(0, 3).filter(id => expected.includes(id)).length / 3;
  out.p1 = expected.includes(rankedIds[0]) ? 1 : 0;
  return { p1: +out.p1.toFixed(4), p3: +out.p3.toFixed(4), p5: +out.p5.toFixed(4), r5: +out.r5.toFixed(4), mrr: +out.mrr.toFixed(4) };
}

async function retrieve(qv, topK) {
  const res = await ragPool.query(
    `SELECT id, chunk_id, document_id, title, content, 1-(embedding <=> $1::halfvec) AS sim
     FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${topK}`, [qv]);
  return res.rows.map(r => ({ chunk_id: r.chunk_id, title: r.title, sim: parseFloat(r.sim.toFixed(4)) }));
}

async function main() {
  const args = process.argv.slice(2);
  const run = (args.find(a => a.startsWith('--run=')) || '--run=A').split('=')[1];

  // ── GUARDA ANTI-PRODUCCIÓN ──
  const ragUrl = process.env.RAG_DATABASE_URL || '';
  if (!(ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1') || ragUrl.includes('0.0.0.0'))) {
    console.error('🚫 RAG_DATABASE_URL NO es local. ABORTANDO.');
    process.exit(1);
  }

  const ds = JSON.parse(fs.readFileSync(DS, 'utf8'));
  const valid = ds.queries.filter(q => q.status === 'VALID');
  const TOPK = 10;

  const perQuery = [];
  for (const q of valid) {
    const v = QUERY_VARIANTS[q.id];
    if (!v) { console.error(`❌ Sin variantes para ${q.id}`); process.exit(1); }
    const expected = q.expected_chunks;

    const variants = {};
    for (const [name, text] of [['q0', v.q0], ['q1', v.q1], ['q2', v.q2]]) {
      const qEmb = await generateEmbedding(text, 'query');
      const rows = await retrieve('[' + qEmb.join(',') + ']', TOPK);
      const ranked = rows.map(r => r.chunk_id);
      variants[name] = {
        metrics_official: computeMetrics(ranked, expected),
        top10: rows,
        // Auditoría de evidencia: chunks del top-10 con sim >= 0.45 (banda relevante observada)
        candidates_ge_045: rows.filter(r => r.sim >= 0.45).map(r => r.chunk_id),
      };
    }
    perQuery.push({ query_id: q.id, query: v.q0, category: q.category, expected_chunks: expected, rationale: v.rationale, ...variants });
    console.log(`✅ ${q.id}: Q0 MRR=${variants.q0.metrics_official.mrr} | Q1=${variants.q1.metrics_official.mrr} | Q2=${variants.q2.metrics_official.mrr}`);
    await new Promise(r => setTimeout(r, 250));
  }

  // Agregados
  function agg(key) {
    const vals = perQuery.map(p => p[key].metrics_official);
    const n = vals.length;
    return {
      p1: +(vals.reduce((a, v) => a + v.p1, 0) / n).toFixed(4),
      p3: +(vals.reduce((a, v) => a + v.p3, 0) / n).toFixed(4),
      p5: +(vals.reduce((a, v) => a + v.p5, 0) / n).toFixed(4),
      r5: +(vals.reduce((a, v) => a + v.r5, 0) / n).toFixed(4),
      mrr: +(vals.reduce((a, v) => a + v.mrr, 0) / n).toFixed(4),
    };
  }

  const out = {
    cycle: '18', experiment: 'R5-C6', database: 'LOCAL_ONLY', production_contacted: false,
    generated_at: new Date().toISOString(), run,
    model: 'nvidia/nv-embedqa-e5-v5 (1024d)',
    config: { topK: TOPK, threshold: 'N/A (topK directo)', variants: 'Q0 original / Q1 paráfrasis / Q2 clarificación de intención' },
    metrics: { q0: agg('q0'), q1: agg('q1'), q2: agg('q2') },
    per_query: perQuery,
  };
  const outPath = path.join(OUT_DIR, `r5c6_query_corpus_coverage_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
