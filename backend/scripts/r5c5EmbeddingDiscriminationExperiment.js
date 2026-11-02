#!/usr/bin/env node
/**
 * backend/scripts/r5c5EmbeddingDiscriminationExperiment.js
 * CICLO 17 — R5-C5: Experimento controlado de discriminación de embeddings
 *
 * READ-ONLY estricto: solo SELECT + generateEmbedding en memoria. Sin escrituras a BD.
 *
 * Diseño:
 *  - 18 queries VALID
 *  - Para cada query: query ORIGINAL vs query REFORMULADA (documentada, sin leakage)
 *  - Mide: sim(expected), sim(top1), margen, gap relevant/non-relevant, P@1/3/5, R@5, MRR
 *  - Reformulaciones: construidas para conservar la intención, SIN introducir
 *    keywords del corpus, chunk_ids, títulos, ni información inexistente.
 *
 * Uso: node scripts/r5c5EmbeddingDiscriminationExperiment.js --run=A
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { generateEmbedding } = require('../src/services/embeddingService');

const DS = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v2.json');
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');

// ── Reformulaciones controladas (auditables) ──
// Regla: conservan la intención original; NO mencionan chunk_ids, títulos del corpus,
// ni keywords escogidas para favorecer un expected. Solo reformulación semántica neutral.
const REFORMULATIONS = {
  'skincare_003': {
    reformulated: '¿Qué rutina de cuidado facial conviene para piel grasa viviendo en un clima húmedo?',
    rationale: 'Misma intención (rutina + piel grasa + clima húmedo), forma interrogativa neutra',
  },
  'skincare_005': {
    reformulated: '¿Qué protector solar es el más adecuado cuando la piel es sensible y presenta manchas oscuras?',
    rationale: 'Misma intención (protector solar + piel sensible + melasma descrito como manchas oscuras)',
  },
  'skincare_006': {
    reformulated: '¿De qué manera se debe aplicar el ácido hialurónico en la rutina facial?',
    rationale: 'Misma intención (uso correcto de ácido hialurónico), forma verbal neutra',
  },
  'skincare_007': {
    reformulated: '¿Qué pasos nocturnos se recomiendan para prevenir el envejecimiento en piel mixta madura?',
    rationale: 'Misma intención (rutina nocturna anti-edad + piel mixta + edad 35≈madura)',
  },
  'skincare_008': {
    reformulated: '¿Cómo tratar las manchas oscuras que quedan tras la inflamación en piel de tono moreno?',
    rationale: 'Misma intención (hiperpigmentación post-inflamatoria + piel morena), descripción coloquial',
  },
  'skincare_009': {
    reformulated: '¿Es seguro usar niacinamida junto con vitamina C en una misma rutina facial?',
    rationale: 'Misma intención (combinación niacinamida + vitamina C), forma interrogativa directa',
  },
  'skincare_010': {
    reformulated: '¿Qué limpiador facial es recomendable para piel seca y sensible?',
    rationale: 'Misma intención (mejor limpiador + piel seca + sensible), sin cambios de contenido',
  },
  'cabello_002': {
    reformulated: '¿Cómo se puede reparar el cabello que ha sido dañado por un proceso de decoloración?',
    rationale: 'Misma intención (tratamiento cabello dañado por decoloración), reformulación verbal',
  },
  'cabello_004': {
    reformulated: '¿Qué producto usar para la caída del cabello relacionada con el embarazo o el estrés?',
    rationale: 'Misma intención (caída post-parto + estrés), término embarazo en lugar de post-parto',
  },
  'cabello_006': {
    reformulated: '¿Qué champú elegir cuando el cuero cabelludo es graso pero las puntas están secas?',
    rationale: 'Misma intención (champú + cuero graso + puntas secas), reordenamiento neutro',
  },
  'cabello_008': {
    reformulated: '¿En qué se diferencia hidratar el cabello en casa frente a hacerlo con un profesional?',
    rationale: 'Misma intención (casero vs profesional + hidratación profunda), forma comparativa',
  },
  'cejas_001': {
    reformulated: '¿En qué consiste el microblading y durante cuánto tiempo se mantiene el resultado?',
    rationale: 'Misma intención (qué es + duración), reformulación interrogativa',
  },
  'cejas_002': {
    reformulated: '¿Qué distingue al microblading del microshading y del nanoblading?',
    rationale: 'Misma intención (diferencias entre las tres técnicas), sin añadir información',
  },
  'cejas_003': {
    reformulated: '¿Qué forma de cejas es la más favorecedora para un rostro redondo?',
    rationale: 'Misma intención (forma ideal + cara redonda), adjetivo favorecedora',
  },
  'cejas_004': {
    reformulated: '¿Se pueden corregir cejas asimétricas mediante micropigmentación?',
    rationale: 'Misma intención (corrección asimetría + micropigmentación), forma pasiva',
  },
  'cejas_005': {
    reformulated: '¿Qué cuidados conviene seguir después de un microblading y cuáles deben evitarse?',
    rationale: 'Misma intención (cuidados post + qué evitar), expansión neutra',
  },
  'cejas_007': {
    reformulated: '¿Quiénes no deberían realizarse microblading por razones de salud?',
    rationale: 'Misma intención (contraindicaciones), forma interrogativa sobre personas',
  },
  'cejas_008': {
    reformulated: '¿Qué opciones existen para retirar un microblading mal realizado y cuáles son los riesgos?',
    rationale: 'Misma intención (remoción + riesgos), reformulación neutra',
  },
};

// Stopwords para extracción de términos
const STOPWORDS = new Set(('de la el en y a los del se las por un para con no una su al lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros mi mis tú te ti tu tus ellas nosotras vosotros vosotras os mío mía míos mías tuyo tuya tuyos tuyas suyo suya suyos suyas nuestro nuestra nuestros nuestras vuestro vuestra vuestros vuestras esos esas esos esas qué quién quiénes cuál cuáles cómo cuándo dónde para qué').split(/\s+/));
const STOPWORDS_EXTRA = new Set(['mejor','cómo','qué','cuál','cuáles','puedo','puede','debería','correctamente','ideal','usar','tratamiento','rutina','casero','profesional','real','realmente','vs','versus','entre','misma','mismo','hacer','hacerse']);

function extractTerms(query) {
  return query.toLowerCase().replace(/[¿?¡!.,:;()"'«»]/g, ' ')
    .split(/\s+/).filter(w => w.length > 3 && !STOPWORDS.has(w) && !STOPWORDS_EXTRA.has(w));
}

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

async function runQuery(q, queryText, qv, expected, topK) {
  const res = await ragPool.query(
    `SELECT id, chunk_id, document_id, title, content, 1-(embedding <=> $1::halfvec) AS sim
     FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${topK}`, [qv]);
  const rows = res.rows;
  const ranked = rows.map(r => r.chunk_id);
  const metrics = computeMetrics(ranked, expected);
  // Similitud exacta query→expected (scan sobre esos IDs)
  const expSims = [];
  for (const expId of expected) {
    const er = await ragPool.query(
      `SELECT 1-(embedding <=> $1::halfvec) AS sim FROM beauty_knowledge_embeddings WHERE chunk_id = $2`, [qv, expId]);
    if (er.rows.length) expSims.push({ chunk_id: expId, sim: parseFloat(er.rows[0].sim.toFixed(4)) });
  }
  const top1 = rows[0];
  return {
    metrics,
    top1_chunk: top1 ? top1.chunk_id : null,
    top1_sim: top1 ? parseFloat(top1.sim.toFixed(4)) : null,
    expected_sims: expSims,
    expected_best_sim: expSims.length ? Math.max(...expSims.map(e => e.sim)) : null,
    margin: top1 && expSims.length ? +(parseFloat(top1.sim.toFixed(4)) - Math.max(...expSims.map(e => e.sim))).toFixed(4) : null,
    // Gap: top-10 non-relevant (no expected) vs expected
    non_relevant_sims: rows.filter(r => !expected.includes(r.chunk_id)).slice(0, 10).map(r => parseFloat(r.sim.toFixed(4))),
  };
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
    const expected = q.expected_chunks;
    const orig = q.query;
    const ref = REFORMULATIONS[q.id];
    if (!ref) { console.error(`❌ Sin reformulación para ${q.id}`); process.exit(1); }

    const qEmbOrig = await generateEmbedding(orig, 'query');
    const qEmbRef = await generateEmbedding(ref.reformulated, 'query');

    const resOrig = await runQuery(q, orig, '[' + qEmbOrig.join(',') + ']', expected, TOPK);
    const resRef = await runQuery(q, ref.reformulated, '[' + qEmbRef.join(',') + ']', expected, TOPK);

    perQuery.push({
      query_id: q.id,
      category: q.category,
      original_query: orig,
      reformulated_query: ref.reformulated,
      rationale: ref.rationale,
      original: resOrig,
      reformulated: resRef,
      delta_mrr: +(resRef.metrics.mrr - resOrig.metrics.mrr).toFixed(4),
      delta_r5: +(resRef.metrics.r5 - resOrig.metrics.r5).toFixed(4),
    });
    console.log(`✅ ${q.id}: orig MRR=${resOrig.metrics.mrr} R@5=${resOrig.metrics.r5} → ref MRR=${resRef.metrics.mrr} R@5=${resRef.metrics.r5}`);
    await new Promise(r => setTimeout(r, 250));
  }

  // Agregados
  const agg = (fn) => {
    const vals = perQuery.map(fn);
    const n = vals.length;
    return {
      p1: +(vals.reduce((a, v) => a + v.p1, 0) / n).toFixed(4),
      p3: +(vals.reduce((a, v) => a + v.p3, 0) / n).toFixed(4),
      p5: +(vals.reduce((a, v) => a + v.p5, 0) / n).toFixed(4),
      r5: +(vals.reduce((a, v) => a + v.r5, 0) / n).toFixed(4),
      mrr: +(vals.reduce((a, v) => a + v.mrr, 0) / n).toFixed(4),
    };
  };
  // Gap de discriminación global: mean(relevant) - mean(non-relevant)
  function globalGap(which) {
    let rel = [], non = [];
    for (const q of perQuery) {
      const r = q[which];
      if (r.expected_best_sim !== null) rel.push(r.expected_best_sim);
      non.push(...r.non_relevant_sims);
    }
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    return {
      relevant: { n: rel.length, mean: +mean(rel).toFixed(4), median: +med(rel).toFixed(4), min: +Math.min(...rel).toFixed(4), max: +Math.max(...rel).toFixed(4) },
      non_relevant: { n: non.length, mean: +mean(non).toFixed(4), median: +med(non).toFixed(4), min: +Math.min(...non).toFixed(4), max: +Math.max(...non).toFixed(4) },
      gap: +(mean(rel) - mean(non)).toFixed(4),
    };
  }

  const out = {
    cycle: '17', experiment: 'R5-C5', database: 'LOCAL_ONLY', production_contacted: false,
    generated_at: new Date().toISOString(), run,
    model: 'nvidia/nv-embedqa-e5-v5 (1024d)',
    config: { topK: TOPK, threshold: 'N/A (topK directo, sin threshold)', reformulation: 'controlada y documentada por query' },
    metrics: {
      original: { global: agg(q => q.original.metrics), gap: globalGap('original') },
      reformulated: { global: agg(q => q.reformulated.metrics), gap: globalGap('reformulated') },
    },
    per_query: perQuery,
  };
  const outPath = path.join(OUT_DIR, `r5c5_embedding_discrimination_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
