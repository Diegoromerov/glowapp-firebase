#!/usr/bin/env node
/**
 * backend/scripts/buildDatasetV3Candidate.js
 * CICLO 22 — R5-C10: Construcción del benchmark V3 CANDIDATO (read-only)
 *
 * NO modifica: evaluation_dataset_v2.json, baseline_real_r5b.json, corpus, BD.
 * Solo genera el artefacto candidato a partir de la evidencia consolidada R5-C2..C8.
 *
 * Uso: node scripts/buildDatasetV3Candidate.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');

const DS2 = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v2.json');
const OUT = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v3_candidate.json');

// Clasificación formal por query (derivada de evidencia R5-C2/C6/C7 — ver rag_diagnostic_r5c9.md)
const CLASS = {
  'skincare_003': { status: 'SUPPORTED_ALIGNED', note: 'Evidencia E3 clima+poros recuperada en top-5; expected corregido' },
  'skincare_005': { status: 'SUPPORTED_MISALIGNED', note: 'Evidencia E3 filtros solares recuperada; expected v2 incluía mascarillas magnéticas (irrelevante)' },
  'skincare_006': { status: 'SUPPORTED_MISALIGNED', note: 'Evidencia E3 AH peso molecular/reología; expected v2 incompleto' },
  'skincare_007': { status: 'PARTIALLY_SUPPORTED', note: 'Solo E1 ritmos circadianos; no hay rutina anti-edad nocturna completa en corpus' },
  'skincare_008': { status: 'SUPPORTED_ALIGNED', note: 'Expected correcto: 5/5 top-10, ranks 1-3, MRR 1.0' },
  'skincare_009': { status: 'SUPPORTED_MISALIGNED', note: 'Evidencia E3 niacinamida+pH; expected v2 declaraba cobre+VitC (error GT)' },
  'skincare_010': { status: 'SUPPORTED_MISALIGNED', note: 'Evidencia E3 pH limpiadores; expected v2 declaraba piel seca vs deshidratada' },
  'cabello_002': { status: 'SUPPORTED_MISALIGNED', note: 'Evidencia E3 restauración pH post-proceso; expected v2 declaraba SERS diagnóstico' },
  'cabello_004': { status: 'UNSUPPORTED', note: 'E0 verificado HNSW+exact+paráfrasis: no existe evidencia de caída post-parto/estrés' },
  'cabello_006': { status: 'PARTIALLY_SUPPORTED', note: 'E2 microbiota; corpus centrado en tinte, no en champú' },
  'cabello_008': { status: 'SUPPORTED_MISALIGNED', note: 'Evidencia E3 oclusivos vs humectantes; expected v2 declaraba bioimpedancia' },
  'cejas_001': { status: 'PARTIALLY_SUPPORTED', note: 'E2 envejecimiento; no hay definición+duración directa' },
  'cejas_002': { status: 'UNSUPPORTED', note: 'E0: no existe comparativa microblading/microshading/nanoblading' },
  'cejas_003': { status: 'UNSUPPORTED', note: 'E0: no existe visajismo por forma de cara' },
  'cejas_004': { status: 'SUPPORTED_MISALIGNED', note: 'Evidencia E1-E3 dispersión luz existe; Q2 (R5-C6) la recupera con MRR 1.0' },
  'cejas_005': { status: 'SUPPORTED_MISALIGNED', note: 'Evidencia E3 cicatrización en rank 2; expected v2 parcial' },
  'cejas_007': { status: 'SUPPORTED_MISALIGNED', note: 'Evidencia E3 autoinmunes+diabéticos en top-4; expected v2 declaraba piel grasa (rank 18)' },
  'cejas_008': { status: 'SUPPORTED_MISALIGNED', note: 'Evidencia E1-E3 contraindicaciones/piel grasa; remoción láser no en top-20 Q0 pero rescatable Q2' },
};

// Expected v3: primary/supporting (IDs verificados contra BD)
const EXPECTED = {
  'skincare_003': { primary: ['poros-clima-bogota-009', 'poros-humedad-bogota-008'], supporting: ['skincare-rutinas-por-tipo-piel-osmolaridad-006'] },
  'skincare_005': { primary: ['proteccion-solar-filtros-quimicos-006'], supporting: ['trend-sunscreen-mixing-004'] },
  'skincare_006': { primary: ['reologia-acido-hialuronico-005'], supporting: ['ingredientes_activos_contraindicaciones-1786377360011-6-35b0c828-acido-hialuronico-de-alto-peso-molecular-y-el-riesgo-de-efec', 'reologia-ah-006'] },
  'skincare_007': { primary: ['skincare-ritmos-circadianos-001'], supporting: ['tendencias-belleza-virales-skincare-cicadiano-002'] },
  'skincare_008': { primary: ['skincare_rutinas_por_tipo_piel-1786383525373-5-d63c7938-regulacion-de-la-melanogenesis-en-pieles-con-hiperpigmentaci'], supporting: ['skincare_rutinas_por_tipo_piel-1786386526556-5-d5b91d3d-gestion-de-la-hiperpigmentacion-post-inflamatoria-inhibicion'] },
  'skincare_009': { primary: ['riesgo-niacinamida-ph-bajo-002'], supporting: ['niacinamida-hidrolisis-ph-002'] },
  'skincare_010': { primary: ['skincare-microbioma-limpiadores-004'], supporting: ['skincare-rutinas-por-tipo-piel-microbioma-barrera-002'] },
  'cabello_002': { primary: ['colorimetria-capilar-ph-pos-tinte-009'], supporting: ['colorimetria-capilar-viscoelasticidad-009'] },
  'cabello_004': { primary: [], supporting: [] },
  'cabello_006': { primary: ['microbiota-scalp-008'], supporting: ['colorimetria-capilar-microbiota-003'] },
  'cabello_008': { primary: ['hidratacion-oclusiva-corporal-008'], supporting: ['hidrofaciales-tecnologia-006', 'hidratacion-oclusivos-humectantes-009'] },
  'cejas_001': { primary: ['visajismo-cejas-microblading-envejecimiento-009'], supporting: ['visajismo-cejas-microblading-piel-grasa-005'] },
  'cejas_002': { primary: [], supporting: [] },
  'cejas_003': { primary: [], supporting: [] },
  'cejas_004': { primary: ['visajismo_cejas_microblading-1786392731705-2-770a6226-evaluacion-de-la-dispersion-de-luz-en-el-tejido-dermico-para'], supporting: ['visajismo-cejas-microblading-metamerismo-003'] },
  'cejas_005': { primary: ['visajismo-cejas-microblading-cicatrizacion-003'], supporting: ['visajismo-cejas-microblading-microbiota-006'] },
  'cejas_007': { primary: ['visajismo-cejas-enfermedades-autoinmunes-007'], supporting: ['visajismo-cejas-diabetis-cicatrizacion-004'] },
  'cejas_008': { primary: ['visajismo-cejas-microblading-piel-grasa-005'], supporting: ['visajismo-cejas-enfermedades-autoinmunes-007'] },
};

async function main() {
  const ragUrl = process.env.RAG_DATABASE_URL || '';
  if (!(ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1') || ragUrl.includes('0.0.0.0'))) {
    console.error('🚫 RAG_DATABASE_URL NO es local. ABORTANDO.');
    process.exit(1);
  }

  const ds2 = JSON.parse(fs.readFileSync(DS2, 'utf8'));
  const valid = ds2.queries.filter(q => q.status === 'VALID');

  // Verificar presencia de todos los IDs en BD
  const allIds = new Set();
  for (const e of Object.values(EXPECTED)) { e.primary.forEach(i => allIds.add(i)); e.supporting.forEach(i => allIds.add(i)); }
  const lit = '{' + [...allIds].join(',') + '}';
  const res = await ragPool.query('SELECT chunk_id FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($1::text[])', [[...allIds]]);
  const found = new Set(res.rows.map(r => r.chunk_id));
  const missing = [...allIds].filter(i => !found.has(i));

  const queries = valid.map(q => {
    const cls = CLASS[q.id];
    const exp = EXPECTED[q.id] || { primary: [], supporting: [] };
    return {
      query_id: q.id,
      query: q.query,
      category: q.category,
      difficulty: q.difficulty,
      v2_expected_chunks: q.expected_chunks,
      status: cls.status,
      status_note: cls.note,
      expected_chunks: { primary: exp.primary, supporting: exp.supporting },
      allow_better_evidence: cls.status === 'SUPPORTED_MISALIGNED' || cls.status === 'SUPPORTED_ALIGNED',
    };
  });

  const out = {
    schema_version: '3.0-candidate',
    generated_at: new Date().toISOString(),
    source: 'evaluation_dataset_v2.json + evidencia R5-C2..C8 (rag_diagnostic_r5c9.md)',
    status: 'CANDIDATE — pendiente revisión del Director. NO es el benchmark oficial.',
    database: 'LOCAL_ONLY',
    production_contacted: false,
    official_baseline_unchanged: true,
    id_verification: { total_ids: allIds.size, present_in_db: found.size, missing: missing },
    classification_summary: (() => {
      const s = {};
      queries.forEach(q => { s[q.status] = (s[q.status] || 0) + 1; });
      return s;
    })(),
    queries: queries,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`✅ ${OUT}`);
  console.log(`Clasificación: ${JSON.stringify(out.classification_summary)}`);
  console.log(`IDs verificados: ${found.size}/${allIds.size} en BD`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
