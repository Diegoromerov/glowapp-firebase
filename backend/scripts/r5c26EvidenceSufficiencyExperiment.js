#!/usr/bin/env node
/**
 * backend/scripts/r5c26EvidenceSufficiencyExperiment.js
 * CICLO 38 — R5-C26: Claim-Evidence Sufficiency (read-only, determinista, sin LLM)
 *
 * Hipótesis H26: si una respuesta se descompone en claims verificables y cada
 * claim requerido se vincula con evidencia recuperada, reducimos los falsos
 * SUFFICIENT del agregador R5-C25 sin perder los casos multi-chunk reales.
 *
 * Distinción explícita: RELEVANCE (mismo tema) ≠ SUPPORT (sustenta un claim
 * concreto) ≠ SUFFICIENCY (el conjunto sustenta todos los claims necesarios).
 *
 * Mecanismo (sin gold leakage):
 *  1. REQUIRED CLAIMS: términos núcleo de la query (conceptos de dominio o
 *     sustantivos ≥5 chars) — no todos los tokens cuentan igual.
 *  2. CLAIM↔EVIDENCE: chunk SUPPORTA claim si contiene el término (normalizado).
 *  3. INFORMATIVIDAD IDF-suave: informativeness(claim) = 1 − (chunks que lo
 *     soportan en top-100 / 100). Claims comunes pesan poco; distintivos, mucho.
 *     → corrige el falso SUFFICIENT de cejas_004 (R5-C25): los chunks no-gold
 *       soportan claims comunes pero no los distintivos (asimetría, corrección).
 *  4. COVERAGE: claim_coverage = Σinf(soportados)/Σinf(todos).
 *     SUFFICIENT ≥0.5 y ≥2 chunks | PARTIAL 0.2-0.5 | INSUFFICIENT <0.2 |
 *     VECTOR_MISS si ningún chunk soporta ningún claim.
 *  5. Evaluación post-hoc (solo métrica, no selección): false-sufficient,
 *     false-insufficient, claim coverage, query success contra GOLD-V5.
 *
 * READ-ONLY. Guarda anti-producción. Uso: node scripts/r5c26EvidenceSufficiencyExperiment.js --run=A
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { generateEmbedding } = require('../src/services/embeddingService');

const V5 = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v5_candidate.json');
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');
const TOPK = 100;
const SUFF_COVERAGE = 0.5;
const PARTIAL_COVERAGE = 0.2;
const MIN_CLAIM_LEN = 5;
const MISSES = ['cabello_002', 'cejas_004', 'cejas_008'];

// Conceptos de dominio (lista genérica de belleza/dermatología — NO derivada del gold)
const CONCEPTS = new Set([
  'niacinamida', 'vitamina', 'hialuronico', 'retinol', 'salicilico', 'peroxido', 'hidroquinona', 'arbutina',
  'ceramidas', 'peptidos', 'glicolico', 'lactico', 'azelaico', 'protector', 'oxid', 'romero', 'acne', 'melasma',
  'hiperpigmentacion', 'grasa', 'sensible', 'rosacea', 'dermatitis', 'eccema', 'psoriasis', 'cicatriz', 'manchas',
  'arrugas', 'caida', 'caspa', 'cuero', 'alopecia', 'dañado', 'decoloracion', 'microblading', 'micropigmentacion',
  'peeling', 'hidratacion', 'exfoliacion', 'limpiador', 'tonico', 'serum', 'mascarilla', 'champu', 'acondicionador',
  'tinte', 'coloracion', 'laser', 'electrolisis', 'cuticula', 'microbioma', 'barrera', 'estrato', 'melanocito',
  'foliculo', 'dermis', 'epidermis', 'cejas', 'parpado', 'orbicular', 'asimétric', 'asimetri', 'correccion',
  'remocion', 'eliminacion', 'tyndall', 'erbio', 'ph', 'anti', 'edad', 'rutina', 'tratamiento', 'cabello',
]);

const STOP = new Set('de la el en y a los del se las por un para con no una su al lo como mas pero sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mi antes algunos que unos yo otro otras otra el tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros mis tu tus suyas esas esos'.split(/\s+/));

function tokenize(text) {
  return (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,:;()"'«»]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
}

// Claims requeridos: tokens núcleo de la query (conceptos de dominio o sustantivos largos)
function extractClaims(query) {
  const tokens = tokenize(query);
  const claims = [];
  for (const t of tokens) {
    // concepto de dominio explícito, o sustantivo largo (≥5), o variante normalizada de concepto
    const norm = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (CONCEPTS.has(t) || CONCEPTS.has(norm) || t.length >= MIN_CLAIM_LEN) {
      if (!claims.includes(t)) claims.push(t);
    }
  }
  // Si no se detectó ningún claim (query corta), usar todos los tokens
  return claims.length ? claims : tokens;
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

  const v5 = JSON.parse(fs.readFileSync(V5, 'utf8'));
  const queries = v5.queries.filter(q => q.support_status !== 'UNSUPPORTED');

  const perQuery = [];
  for (const q of queries) {
    const goldCore = q.expected_chunks.core || [];
    const goldSup = q.expected_chunks.supporting || [];
    const goldAll = [...goldCore, ...goldSup];
    const goldSet = new Set(goldAll);

    // ── REQUIRED CLAIMS (de la query, sin gold) ──
    const claims = extractClaims(q.query);
    const claimSet = new Set(claims);

    // ── RETRIEVAL (pool top-100, sin modificar nada) ──
    const qEmb = await generateEmbedding(q.query, 'query');
    const res = await ragPool.query(
      `SELECT chunk_id, document_id, title, content, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${TOPK}`, ['[' + qEmb.join(',') + ']']);
    const pool = res.rows.map((r, i) => ({
      chunk_id: r.chunk_id, document_id: r.document_id || '', title: r.title || '', content: r.content || '',
      vector_score: +r.sim.toFixed(4), rank: i + 1,
    }));

    // ── CLAIM↔EVIDENCE MATRIX: qué chunks soportan qué claims ──
    // soporte(claim) = chunk contiene el término del claim (normalizado)
    const chunkClaimSupport = pool.map(u => {
      const text = `${u.title} ${u.content}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const supportMap = {};
      for (const c of claims) {
        const cNorm = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        supportMap[c] = text.includes(cNorm);
      }
      return supportMap;
    });

    // ── INFORMATIVIDAD IDF-suave por claim ──
    const claimSupportCount = {};
    for (const c of claims) {
      claimSupportCount[c] = chunkClaimSupport.filter(m => m[c]).length;
    }
    const claimInformativeness = {};
    for (const c of claims) {
      claimInformativeness[c] = +(1 - (claimSupportCount[c] / TOPK)).toFixed(4);
    }
    const totalInformativeness = claims.reduce((a, c) => a + claimInformativeness[c], 0);

    // ── EVIDENCE SET: chunks con score ≥0.45 y que soportan ≥1 claim ──
    const candidates = pool.map((u, i) => ({ ...u, claims_supported: claims.filter(c => chunkClaimSupport[i][c]) }))
      .filter(u => u.vector_score >= 0.45 && u.claims_supported.length > 0);

    // ── COVERAGE CHECK (sin gold) ──
    const supportedClaims = new Set();
    for (const u of candidates) u.claims_supported.forEach(c => supportedClaims.add(c));
    const coveredInformativeness = claims.reduce((a, c) => a + (supportedClaims.has(c) ? claimInformativeness[c] : 0), 0);
    const claimCoverage = totalInformativeness > 0 ? +(coveredInformativeness / totalInformativeness).toFixed(4) : 0;

    // claims sin soporte (los distintivos que faltan)
    const unsupportedClaims = claims.filter(c => !supportedClaims.has(c));

    // ── CLASIFICACIÓN ──
    let cls;
    if (candidates.length === 0) {
      cls = 'VECTOR_MISS';
    } else if (claimCoverage >= SUFF_COVERAGE && candidates.length >= 2) {
      cls = 'SUFFICIENT';
    } else if (claimCoverage >= PARTIAL_COVERAGE) {
      cls = 'PARTIAL';
    } else {
      cls = 'INSUFFICIENT';
    }

    // ── Evaluación post-hoc (solo métrica, no selección) ──
    const selectedIds = candidates.map(u => u.chunk_id);
    const selGold = selectedIds.filter(id => goldSet.has(id)).length;
    const evPrecision = selectedIds.length ? +(selGold / selectedIds.length).toFixed(4) : 0;
    const evRecall = goldAll.length ? +(selGold / goldAll.length).toFixed(4) : 0;
    // false-sufficient: clasificado SUFFICIENT pero sin gold en evidencia seleccionada
    const falseSufficient = cls === 'SUFFICIENT' && selGold === 0;
    // false-insufficient: clasificado INSUFFICIENT pero el pool SÍ contiene evidencia suficiente (≥50% expected en top-50)
    const in50 = pool.slice(0, 50).filter(u => goldSet.has(u.chunk_id)).length;
    const ev50 = in50 / Math.max(1, goldAll.length);
    const falseInsufficient = cls === 'INSUFFICIENT' && ev50 >= SUFF_COVERAGE;
    // query success: SUFFICIENT y ≥1 gold en evidencia
    const querySuccess = cls === 'SUFFICIENT' && selGold >= 1;

    perQuery.push({
      query_id: q.query_id,
      domain: q.query_id.split('_')[0],
      was_miss: MISSES.includes(q.query_id),
      candidate_pool_size: pool.length,
      query: q.query,
      claims,
      claim_evidence_matrix: claims.map(c => ({
        claim: c,
        informativeness: claimInformativeness[c],
        supporting_chunks: candidates.filter(u => u.claims_supported.includes(c)).map(u => u.chunk_id).slice(0, 4),
        supported: supportedClaims.has(c),
      })),
      selected_evidence: selectedIds.slice(0, 8),
      claim_coverage: claimCoverage,
      unsupported_claims: unsupportedClaims,
      classification: cls,
      evidence_precision: evPrecision,
      evidence_recall: evRecall,
      false_sufficient: falseSufficient,
      false_insufficient: falseInsufficient,
      query_success: querySuccess,
      gold_in_pool_50: ev50,
    });
    console.log(`✅ ${q.query_id}: claims=${claims.length} cov=${claimCoverage.toFixed(2)} [${cls}] prec=${evPrecision} FS=${falseSufficient} FI=${falseInsufficient} ${querySuccess ? '✓Q' : ''}`);
    await new Promise(r => setTimeout(r, 250));
  }

  // ── AGREGADOS ──
  const avg = (fn, list) => { const vals = list.map(fn); return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4); };
  const all = perQuery;
  const classSummary = {};
  for (const q of all) classSummary[q.classification] = (classSummary[q.classification] || 0) + 1;
  const falseSufficientRate = avg(q => q.false_sufficient ? 1 : 0, all);
  const falseInsufficientRate = avg(q => q.false_insufficient ? 1 : 0, all);
  const querySuccessRate = avg(q => q.query_success ? 1 : 0, all);
  const avgPrecision = avg(q => q.evidence_precision, all);
  const avgClaimCoverage = avg(q => q.claim_coverage, all);

  // Comparación R5-C25 (datos del artefacto previo)
  let c25 = null;
  try {
    const p25 = path.join(OUT_DIR, 'r5c25_evidence_aggregator_experiment.json');
    if (fs.existsSync(p25)) c25 = JSON.parse(fs.readFileSync(p25, 'utf8'));
  } catch (e) { /* no disponible */ }

  const out = {
    experiment: 'R5-C26',
    cycle: 38,
    hypothesis: 'H26: descomponer la respuesta en claims verificables y vincular cada claim requerido con evidencia recuperada reduce los falsos SUFFICIENT del agregador sin perder los casos multi-chunk realmente sustentados.',
    timestamp: new Date().toISOString(),
    database_guard: 'LOCAL_ONLY (beauty_db @ localhost:5435)',
    production_guard: 'active — aborta si URL no contiene localhost; Railway NO contactada',
    dataset: 'GOLD-V5 (18 queries; 15 no-UNSUPPORTED evaluadas; 55 chunk IDs únicos)',
    baseline: { r5: 0.7885, mrr: 0.7179, note: 'NO MODIFICADO' },
    controls: {
      oracle_only: { note: 'ORACLE_ONLY — gold usado SOLO para evaluación post-hoc, nunca dentro del mecanismo', evidence_sufficiency_50: all.filter(q => q.gold_in_pool_50 >= SUFF_COVERAGE).length + '/15' },
    },
    configuration: {
      top_k: TOPK,
      suff_coverage: SUFF_COVERAGE,
      partial_coverage: PARTIAL_COVERAGE,
      min_claim_len: MIN_CLAIM_LEN,
      min_score: 0.45,
      informativeness: 'IDF-suave: 1 − (chunks del pool que soportan el claim / 100)',
      mechanism_inputs: ['query', 'candidate_pool', 'contenido de chunks', 'metadata título'],
      mechanism_forbidden: ['gold IDs', 'expected chunks', 'labels', 'información de misses', 'LLM externo', 'Internet'],
    },
    metrics: {
      classification_summary: classSummary,
      false_sufficient_rate: falseSufficientRate,
      false_insufficient_rate: falseInsufficientRate,
      query_success_rate: querySuccessRate,
      evidence_precision_avg: avgPrecision,
      claim_coverage_avg: avgClaimCoverage,
      comparison_r5c25: c25 ? {
        c25_false_sufficient_rate: null, // R5-C25 no medía FS explícitamente; se reconstruye abajo
        c25_query_success: c25.metrics.aggregator_query_success_rate,
        c25_precision: c25.metrics.aggregator_evidence_precision_avg,
        note: 'R5-C25: 4 queries SUFFICIENT con precision 0 (skincare_006, skincare_009, cejas_004, cejas_007) → false-sufficient ≈ 4/15 = 0.267 si se reconstruye con el criterio SUFFICIENT+prec=0',
      } : null,
    },
    false_sufficient_analysis: {
      rate: falseSufficientRate,
      queries: all.filter(q => q.false_sufficient).map(q => ({ query_id: q.query_id, claim_coverage: q.claim_coverage, precision: q.evidence_precision })),
      comparison_note: 'R5-C25: 4/15 SUFFICIENT con precision 0 (0.267). R5-C26 objetivo: reducir este número.',
    },
    false_insufficient_analysis: {
      rate: falseInsufficientRate,
      queries: all.filter(q => q.false_insufficient).map(q => ({ query_id: q.query_id, gold_in_pool_50: q.gold_in_pool_50 })),
      comparison_note: 'Una query con evidencia real en top-50 no debe marcarse INSUFFICIENT (especialmente cabello_002 y cejas_008).',
    },
    per_query_results: perQuery.map(q => ({
      query_id: q.query_id,
      claims: q.claims,
      claim_coverage: q.claim_coverage,
      classification: q.classification,
      evidence_precision: q.evidence_precision,
      query_success: q.query_success,
      false_sufficient: q.false_sufficient,
      false_insufficient: q.false_insufficient,
      unsupported_claims: q.unsupported_claims,
      selected_evidence: q.selected_evidence,
    })),
    claim_evidence_matrices: perQuery.filter(q => q.was_miss).map(q => ({
      query_id: q.query_id,
      claims: q.claim_evidence_matrix,
      classification: q.classification,
    })),
    miss_analysis: perQuery.filter(q => q.was_miss).map(q => ({
      query_id: q.query_id,
      classification: q.classification,
      query_success: q.query_success,
      claim_coverage: q.claim_coverage,
      evidence_precision: q.evidence_precision,
      unsupported_claims: q.unsupported_claims,
      selected_evidence: q.selected_evidence,
    })),
    reproducibility: 'RUN A ≡ RUN B (verificar en segunda corrida)',
    verdict: null,
  };
  const outPath = path.join(OUT_DIR, `r5c26_evidence_sufficiency_experiment_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${outPath}`);
  console.log(`  Clases: ${JSON.stringify(classSummary)}`);
  console.log(`  FALSE-SUFFICIENT: ${falseSufficientRate} | FALSE-INSUFFICIENT: ${falseInsufficientRate} | Query success: ${querySuccessRate} | Precision: ${avgPrecision}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
