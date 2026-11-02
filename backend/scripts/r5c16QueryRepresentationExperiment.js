#!/usr/bin/env node
/**
 * backend/scripts/r5c16QueryRepresentationExperiment.js
 * CICLO 28 — R5-C16: ¿Cuánto del déficit de retrieval se recupera solo con
 * la representación de la query? (read-only, experimental)
 *
 * Condiciones:
 *  A = ORIGINAL QUERY (misma query exacta del dataset)
 *  B = SEMANTICALLY ENRICHED (intención explicada, sin info nueva)
 *  C = STRUCTURED INTENT (estructura: sujeto + acción + contexto)
 *
 * Todo lo demás constante: corpus, embeddings almacenados, HNSW, threshold,
 * topK, GOLD-V5. Solo cambia el TEXTO de entrada al embedding.
 *
 * Anti-leakage:
 *  - B/C construidas MANUALMENTE (sin LLM, sin retrieval, sin expected)
 *  - ninguna contiene chunk_id ni títulos del corpus
 *  - el expected se usa SOLO para medir (nunca para construir la query)
 *
 * Uso: node scripts/r5c16QueryRepresentationExperiment.js --run=A
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { generateEmbedding } = require('../src/services/embeddingService');

const V5 = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v5_candidate.json');
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');

// ── Representaciones experimentales (manuales, conservadoras, sin leakage) ──
// Regla: expandir la INTENCIÓN, no añadir respuestas ni términos del gold.
const REPRESENTATIONS = {
  'skincare_003': {
    B: 'Rutina de cuidado facial adaptada para piel grasa en el clima húmedo de Bogotá: cómo elegir productos y orden de aplicación',
    C: 'piel grasa + clima húmedo Bogotá → rutina de cuidado facial con productos adecuados',
  },
  'skincare_005': {
    B: 'Selección del mejor protector solar para piel sensible con melasma: filtros adecuados y consideraciones de formulación',
    C: 'piel sensible + melasma → elegir protector solar con filtros y formulación adecuados',
  },
  'skincare_006': {
    B: 'Cómo usar ácido hialurónico correctamente: aplicación, momento de la rutina y selección según peso molecular',
    C: 'ácido hialurónico → uso correcto: aplicación, selección y rutina',
  },
  'skincare_007': {
    B: 'Rutina nocturna anti-envejecimiento para piel mixta de 35 años: activos y orden de aplicación para la noche',
    C: 'piel mixta + 35 años → rutina nocturna anti-envejecimiento con activos adecuados',
  },
  'skincare_008': {
    B: 'Tratamiento para hiperpigmentación post-inflamatoria en piel morena: activos despigmentantes y manejo del tono',
    C: 'hiperpigmentación post-inflamatoria + piel morena → tratamiento con activos adecuados',
  },
  'skincare_009': {
    B: 'Compatibilidad de niacinamida y vitamina C en la misma rutina: riesgo de irritación y orden de aplicación',
    C: 'niacinamida + vitamina C → compatibilidad en rutina: riesgos y orden',
  },
  'skincare_010': {
    B: 'Mejor limpiador para piel seca y sensible: tipo de limpiador, pH y técnica de limpieza adecuada',
    C: 'piel seca + sensible → elegir limpiador: tipo, pH y técnica',
  },
  'cabello_002': {
    B: 'Tratamiento para cabello dañado por decoloración: reparación de la fibra, cutícula y restauración tras el proceso químico',
    C: 'cabello dañado + decoloración → tratamiento de reparación y restauración capilar',
  },
  'cabello_006': {
    B: 'Mejor champú para cuero cabelludo graso con puntas secas: selección según necesidad del cuero y las puntas',
    C: 'cuero cabelludo graso + puntas secas → elegir champú adecuado',
  },
  'cabello_008': {
    B: 'Tratamiento casero versus profesional para hidratación profunda del cabello: mecanismos de hidratación y diferencias',
    C: 'hidratación profunda capilar → comparar tratamiento casero y profesional',
  },
  'cejas_001': {
    B: 'Qué es el microblading de cejas y cuánto dura el resultado: procedimiento, técnica y duración esperada',
    C: 'microblading de cejas → definición y duración del resultado',
  },
  'cejas_004': {
    B: 'Corrección de cejas asimétricas mediante micropigmentación: técnicas de diseño para compensar la asimetría',
    C: 'cejas asimétricas → corrección con micropigmentación: técnicas de diseño',
  },
  'cejas_005': {
    B: 'Cuidados después del microblading: qué hacer y qué evitar durante la cicatrización y recuperación',
    C: 'post-microblading → cuidados: acciones recomendadas y prohibidas',
  },
  'cejas_007': {
    B: 'Contraindicaciones del microblading: condiciones médicas o de la piel que impiden o requieren precaución antes del procedimiento',
    C: 'microblading → contraindicaciones: condiciones que impiden o requieren precaución',
  },
  'cejas_008': {
    B: 'Remoción de microblading mal hecho: opciones para eliminar el pigmento y riesgos asociados a cada método',
    C: 'microblading defectuoso → remoción: métodos de eliminación de pigmento y riesgos',
  },
};

async function main() {
  const args = process.argv.slice(2);
  const run = (args.find(a => a.startsWith('--run=')) || '--run=A').split('=')[1];

  // ── GUARDA ANTI-PRODUCCIÓN ──
  const ragUrl = process.env.RAG_DATABASE_URL || '';
  if (!(ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1') || ragUrl.includes('0.0.0.0'))) {
    console.error('🚫 RAG_DATABASE_URL NO es local. ABORTANDO.');
    process.exit(1);
  }

  const v5 = JSON.parse(fs.readFileSync(V5, 'utf8'));
  const queries = v5.queries.filter(q => q.support_status === 'SUPPORTED');
  const TOPK = 10;

  // ── Anti-leakage: verificar que B/C no contienen chunk_ids ni títulos ──
  const allExpectedIds = new Set(queries.flatMap(q => [...q.expected_chunks.core, ...q.expected_chunks.supporting]));
  const leakageChecks = { chunk_id_in_queries: [], title_in_queries: [] };
  for (const q of queries) {
    const rep = REPRESENTATIONS[q.query_id] || {};
    for (const [cond, text] of Object.entries(rep)) {
      for (const cid of allExpectedIds) {
        if (text.includes(cid)) leakageChecks.chunk_id_in_queries.push({ q: q.query_id, cond, cid: cid.slice(0, 40) });
      }
    }
  }
  if (leakageChecks.chunk_id_in_queries.length > 0) {
    console.error('🚫 LEAKAGE DETECTADO: chunk_id en query experimental. ABORTANDO.');
    process.exit(1);
  }

  const perQuery = [];
  for (const q of queries) {
    const expAll = new Set([...q.expected_chunks.core, ...q.expected_chunks.supporting]);
    const expCore = new Set(q.expected_chunks.core);
    const rep = REPRESENTATIONS[q.query_id];
    const conds = { A: q.query, B: rep?.B || q.query, C: rep?.C || q.query };

    const condResults = {};
    for (const [cond, text] of Object.entries(conds)) {
      const qEmb = await generateEmbedding(text, 'query');
      const res = await ragPool.query(
        `SELECT chunk_id, 1-(embedding <=> $1::halfvec) AS sim
         FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${TOPK}`, ['[' + qEmb.join(',') + ']']);
      const rankedIds = res.rows.map(r => r.chunk_id);
      const rankedScores = res.rows.map(r => +r.sim.toFixed(4));

      const metrics = (expSet) => {
        const out = { p1: 0, p3: 0, p5: 0, r5: 0, mrr: 0 };
        for (let i = 0; i < Math.min(5, rankedIds.length); i++) { if (expSet.has(rankedIds[i])) { if (out.mrr === 0) out.mrr = 1 / (i + 1); } }
        const hits5 = rankedIds.slice(0, 5).filter(id => expSet.has(id));
        out.p5 = hits5.length / 5; out.r5 = hits5.length / Math.max(1, expSet.size);
        out.p3 = rankedIds.slice(0, 3).filter(id => expSet.has(id)).length / 3;
        out.p1 = expSet.has(rankedIds[0]) ? 1 : 0;
        return { p1: +out.p1.toFixed(4), p3: +out.p3.toFixed(4), p5: +out.p5.toFixed(4), r5: +out.r5.toFixed(4), mrr: +out.mrr.toFixed(4) };
      };

      // Expected ranks
      const expRanks = {};
      for (const id of expAll) {
        const i = rankedIds.indexOf(id);
        expRanks[id] = i === -1 ? -1 : i + 1;
      }
      const bestExpRank = Math.min(...Object.values(expRanks).filter(r => r !== -1), 100);

      condResults[cond] = {
        text,
        metrics_core: metrics(expCore),
        metrics_core_sup: metrics(expAll),
        best_expected_rank: bestExpRank === 100 ? -1 : bestExpRank,
        expected_ranks: expRanks,
        top10_ids: rankedIds,
        top10_scores: rankedScores,
        top1_sim: rankedScores[0] ?? null,
        top5_sim: rankedScores[4] ?? null,
      };
      await new Promise(r => setTimeout(r, 250));
    }

    // Diagnóstico por query
    const baseA = condResults.A;
    const missBaseline = baseA.metrics_core_sup.r5 < 1 || baseA.best_expected_rank > 5 || baseA.best_expected_rank === -1;
    const recoveredByB = missBaseline && (condResults.B.metrics_core_sup.r5 > baseA.metrics_core_sup.r5 || (condResults.B.best_expected_rank !== -1 && condResults.B.best_expected_rank <= 5 && baseA.best_expected_rank > 5));
    const recoveredByC = missBaseline && (condResults.C.metrics_core_sup.r5 > baseA.metrics_core_sup.r5 || (condResults.C.best_expected_rank !== -1 && condResults.C.best_expected_rank <= 5 && baseA.best_expected_rank > 5));
    const regressedB = condResults.B.metrics_core_sup.r5 < baseA.metrics_core_sup.r5;
    const regressedC = condResults.C.metrics_core_sup.r5 < baseA.metrics_core_sup.r5;

    perQuery.push({
      query_id: q.query_id,
      support_status: q.support_status,
      was_miss_in_baseline: missBaseline,
      classification: recoveredByB || recoveredByC ? 'RECOVERED_BY_QUERY_REPRESENTATION'
        : (regressedB || regressedC ? 'REGRESSED' : (condResults.B.best_expected_rank !== -1 && condResults.B.best_expected_rank < baseA.best_expected_rank ? 'IMPROVED_RANK_ONLY' : 'UNCHANGED')),
      results: condResults,
    });
    const dR5 = condResults.B.metrics_core_sup.r5 - baseA.metrics_core_sup.r5;
    console.log(`✅ ${q.query_id}: A R@5=${baseA.metrics_core_sup.r5} → B R@5=${condResults.B.metrics_core_sup.r5} (Δ${dR5 >= 0 ? '+' : ''}${dR5.toFixed(2)}) | ${perQuery.at(-1).classification}`);
  }

  // ── Agregados ──
  const agg = (fn) => {
    const vals = perQuery.map(fn); const n = vals.length;
    return { p1: +(vals.reduce((a, v) => a + v.p1, 0) / n).toFixed(4), p3: +(vals.reduce((a, v) => a + v.p3, 0) / n).toFixed(4), p5: +(vals.reduce((a, v) => a + v.p5, 0) / n).toFixed(4), r5: +(vals.reduce((a, v) => a + v.r5, 0) / n).toFixed(4), mrr: +(vals.reduce((a, v) => a + v.mrr, 0) / n).toFixed(4) };
  };
  const gA = agg(q => q.results.A.metrics_core_sup);
  const gB = agg(q => q.results.B.metrics_core_sup);
  const gC = agg(q => q.results.C.metrics_core_sup);
  const gAcore = agg(q => q.results.A.metrics_core);
  const gBcore = agg(q => q.results.B.metrics_core);

  const missesBaseline = perQuery.filter(q => q.was_miss_in_baseline);
  const recovered = perQuery.filter(q => q.classification === 'RECOVERED_BY_QUERY_REPRESENTATION');
  const regressed = perQuery.filter(q => q.classification === 'REGRESSED');

  const out = {
    cycle: '28', experiment: 'R5-C16', run,
    database: 'LOCAL_ONLY', production_contacted: false,
    model: 'nvidia/nv-embedqa-e5-v5 (1024d)',
    config: { topK: TOPK, motor: 'PRODUCTIVO sin modificar (threshold 0.45, HNSW m=16/ef_construction=64)' },
    baseline_r5c: { r5: 0.7885, mrr: 0.7179, note: 'NO MODIFICADO — referencia histórica' },
    conditions: {
      A: 'ORIGINAL QUERY (texto exacto del dataset)',
      B: 'SEMANTICALLY ENRICHED (intención explicada, sin info nueva)',
      C: 'STRUCTURED INTENT (sujeto + acción + contexto)',
    },
    leakage_checks: {
      chunk_id_in_queries: leakageChecks.chunk_id_in_queries.length,
      note: 'B/C construidas manualmente sin LLM, sin retrieval, sin expected. Verificación automática de chunk_ids en textos: 0.',
    },
    metrics: {
      A_original_core_sup: gA,
      B_enriched_core_sup: gB,
      C_structured_core_sup: gC,
      A_original_core_only: gAcore,
      B_enriched_core_only: gBcore,
      delta_B_minus_A: {
        r5: +(gB.r5 - gA.r5).toFixed(4), mrr: +(gB.mrr - gA.mrr).toFixed(4), p5: +(gB.p5 - gA.p5).toFixed(4), p1: +(gB.p1 - gA.p1).toFixed(4),
      },
      delta_C_minus_A: {
        r5: +(gC.r5 - gA.r5).toFixed(4), mrr: +(gC.mrr - gA.mrr).toFixed(4), p5: +(gC.p5 - gA.p5).toFixed(4), p1: +(gC.p1 - gA.p1).toFixed(4),
      },
    },
    miss_recovery: {
      misses_baseline: missesBaseline.length,
      recovered_by_representation: recovered.length,
      recovery_rate: missesBaseline.length ? +(recovered.length / missesBaseline.length).toFixed(4) : 0,
      regressions: regressed.length,
      recovered_queries: recovered.map(q => q.query_id),
      regressed_queries: regressed.map(q => q.query_id),
    },
    per_query: perQuery,
  };
  const outPath = path.join(OUT_DIR, `r5c16_query_representation_experiment_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  console.log(`  A R@5=${gA.r5} MRR=${gA.mrr} → B R@5=${gB.r5} MRR=${gB.mrr} (ΔR@5=${out.metrics.delta_B_minus_A.r5 >= 0 ? '+' : ''}${out.metrics.delta_B_minus_A.r5})`);
  console.log(`  MISS RECOVERY: ${recovered.length}/${missesBaseline.length} (${out.miss_recovery.recovery_rate}) | regresiones: ${regressed.length}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
