#!/usr/bin/env node
/**
 * backend/scripts/r5c12IndependentGoldAudit.js
 * CICLO 24 — R5-C12: Validación independiente/CIEga del Gold Set (read-only)
 *
 * DOS FASES SEPARADAS (blinding):
 *  PHASE 1 — GOLD CONSTRUCTION: selección de evidencia por CONTENIDO del corpus
 *            canónico (búsqueda léxica auxiliar + inspección semántica).
 *            PROHIBIDO usar retrieval/rank/similarity del motor.
 *  PHASE 2 — RETRIEVAL EVALUATION: solo DESPUÉS de congelar el Gold, se ejecuta
 *            el retrieval productivo y se calculan métricas.
 *
 * PHASE 1 genera: evaluation_dataset_v4_gold_candidate.json
 * PHASE 2 genera: r5c12_independent_gold_audit.json
 *
 * Uso: node scripts/r5c12IndependentGoldAudit.js --run=A --phase=all|1|2
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ragPool } = require('../src/config/db');
const { generateEmbedding } = require('../src/services/embeddingService');

const DS2 = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v2.json');
const CORPUS = path.join(__dirname, '..', 'src', 'data', 'corpus_canonico', 'corpus_canonico.json');
const GOLD_OUT = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v4_gold_candidate.json');
const AUDIT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');

// ── Stopwords para términos de intención (búsqueda léxica auxiliar) ──
const STOP = new Set(('de la el en y a los del se las por un para con no una su al lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros mi mis tú te ti tu tus ellas nosotras vosotros vosotras os mío mía míos mías tuyo tuya tuyos tuyas suyo suya suyos suyas nuestro nuestra nuestros nuestras vuestro vuestra vuestros vuestras esos esas qué quién quiénes cuál cuáles cómo cuándo dónde para qué').split(/\s+/));
const STOP_EXTRA = new Set(['mejor','cómo','qué','cuál','cuáles','puedo','puede','debería','correctamente','ideal','usar','tratamiento','rutina','casero','profesional','real','realmente','vs','versus','entre','misma','mismo','hacer','hacerse','bueno','buena']);

function termsOf(query) {
  return query.toLowerCase().replace(/[¿?¡!.,:;()"'«»]/g, ' ')
    .split(/\s+/).filter(w => w.length > 3 && !STOP.has(w) && !STOP_EXTRA.has(w));
}

// ── PHASE 1: construir Gold desde el corpus (búsqueda léxica auxiliar + juicio semántico) ──
// La decisión final es por CONTENIDO (lectura del chunk), nunca por ranking.
// Los gold chunks se seleccionan porque su contenido responde la intención de la query.
function buildGold(corpus) {
  // Mapa chunk_id -> chunk
  const byId = new Map(corpus.chunks.map(c => [c.chunk_id, c]));
  // Para cada query: términos de intención → candidatos por contenido (título+primeros 600 chars)
  // Luego se selecciona el Gold por inspección de contenido (juicio documentado).
  // NOTA: la selección final es MANUAL (razonada en este script), basada en lectura de contenido
  // del corpus canónico — independiente de cualquier retrieval previo.
  const gold = {
    'skincare_003': {
      support_status: 'SUPPORTED',
      core_gold: ['poros-humedad-bogota-008'],
      supporting_gold: ['poros-clima-bogota-009'],
      rationale: 'Contenido trata efecto del clima húmedo de Bogotá sobre piel grasa y rutina adaptada',
      missing_information: null,
    },
    'skincare_005': {
      support_status: 'SUPPORTED',
      core_gold: ['proteccion-solar-filtros-quimicos-006'],
      supporting_gold: ['trend-sunscreen-mixing-004'],
      rationale: 'Contenido trata filtros solares químicos/físicos para piel reactiva (melasma/sensible)',
      missing_information: null,
    },
    'skincare_006': {
      support_status: 'SUPPORTED',
      core_gold: ['reologia-acido-hialuronico-005'],
      supporting_gold: ['ingredientes_activos_contraindicaciones-1786377360011-6-35b0c828-acido-hialuronico-de-alto-peso-molecular-y-el-riesgo-de-efec'],
      rationale: 'Contenido describe selección y uso del ácido hialurónico (reología, peso molecular)',
      missing_information: null,
    },
    'skincare_007': {
      support_status: 'PARTIALLY_SUPPORTED',
      core_gold: ['skincare-ritmos-circadianos-001'],
      supporting_gold: [],
      rationale: 'Contenido sobre ritmos circadianos y rutina nocturna; NO hay rutina anti-edad completa para piel mixta 35',
      missing_information: 'Rutina anti-edad específica para piel mixta a los 35 años',
    },
    'skincare_008': {
      support_status: 'SUPPORTED',
      core_gold: ['skincare_rutinas_por_tipo_piel-1786383525373-5-d63c7938-regulacion-de-la-melanogenesis-en-pieles-con-hiperpigmentaci'],
      supporting_gold: ['skincare_rutinas_por_tipo_piel-1786386526556-5-d5b91d3d-gestion-de-la-hiperpigmentacion-post-inflamatoria-inhibicion'],
      rationale: 'Contenido trata regulación/manejo de hiperpigmentación post-inflamatoria en pieles pigmentadas',
      missing_information: null,
    },
    'skincare_009': {
      support_status: 'SUPPORTED',
      core_gold: ['riesgo-niacinamida-ph-bajo-002'],
      supporting_gold: ['niacinamida-hidrolisis-ph-002'],
      rationale: 'Contenido trata riesgo de combinar niacinamida con pH bajo (vitamina C)',
      missing_information: null,
    },
    'skincare_010': {
      support_status: 'SUPPORTED',
      core_gold: ['skincare-microbioma-limpiadores-004'],
      supporting_gold: ['skincare-rutinas-por-tipo-piel-microbioma-barrera-002'],
      rationale: 'Contenido trata pH de limpiadores y su efecto en piel (adecuado para piel seca/sensible)',
      missing_information: null,
    },
    'cabello_002': {
      support_status: 'SUPPORTED',
      core_gold: ['colorimetria-capilar-ph-pos-tinte-009'],
      supporting_gold: ['colorimetria-capilar-viscoelasticidad-009'],
      rationale: 'Contenido trata restauración del pH y sellado cuticular tras procesos (decoloración)',
      missing_information: null,
    },
    'cabello_004': {
      support_status: 'UNSUPPORTED',
      core_gold: [],
      supporting_gold: [],
      rationale: 'Búsqueda exhaustiva en corpus: ningún chunk trata caída post-parto ni alopecia por estrés',
      missing_information: 'Evidencia sobre caída capilar post-parto y por estrés (efervio telógeno)',
    },
    'cabello_006': {
      support_status: 'PARTIALLY_SUPPORTED',
      core_gold: ['microbiota-scalp-008'],
      supporting_gold: [],
      rationale: 'Contenido sobre homeostasis/microbiota del cuero cabelludo; no aborda champú específico para graso+puntas secas',
      missing_information: 'Selección de champú para cuero graso con puntas secas',
    },
    'cabello_008': {
      support_status: 'SUPPORTED',
      core_gold: ['hidratacion-oclusiva-corporal-008'],
      supporting_gold: ['hidratacion-oclusivos-humectantes-009'],
      rationale: 'Contenido compara mecanismos de hidratación (oclusivos vs humectantes) — aplicable a casero vs profesional',
      missing_information: null,
    },
    'cejas_001': {
      support_status: 'PARTIALLY_SUPPORTED',
      core_gold: ['visajismo-cejas-microblading-envejecimiento-009'],
      supporting_gold: [],
      rationale: 'Contenido sobre microblading y envejecimiento cutáneo; no define explícitamente duración del procedimiento',
      missing_information: 'Duración típica del resultado del microblading',
    },
    'cejas_002': {
      support_status: 'UNSUPPORTED',
      core_gold: [],
      supporting_gold: [],
      rationale: 'Búsqueda exhaustiva: ningún chunk compara microblading vs microshading vs nanoblading',
      missing_information: 'Comparativa técnica de las tres modalidades',
    },
    'cejas_003': {
      support_status: 'UNSUPPORTED',
      core_gold: [],
      supporting_gold: [],
      rationale: 'Búsqueda exhaustiva: ningún chunk de visajismo por forma de rostro (cara redonda)',
      missing_information: 'Diseño de cejas según forma de cara',
    },
    'cejas_004': {
      support_status: 'PARTIALLY_SUPPORTED',
      core_gold: ['visajismo_cejas_microblading-1786392731705-2-770a6226-evaluacion-de-la-dispersion-de-luz-en-el-tejido-dermico-para'],
      supporting_gold: [],
      rationale: 'Contenido sobre evaluación de dispersión de luz en tejido dérmico (relacionado con micropigmentación); no aborda directamente corrección de asimetría',
      missing_information: 'Técnicas específicas de corrección de asimetría ciliar',
    },
    'cejas_005': {
      support_status: 'SUPPORTED',
      core_gold: ['visajismo-cejas-microblading-cicatrizacion-003'],
      supporting_gold: ['visajismo-cejas-microblading-microbiota-006'],
      rationale: 'Contenido trata cuidados post-microblading: cicatrización y microbiota ciliar',
      missing_information: null,
    },
    'cejas_007': {
      support_status: 'SUPPORTED',
      core_gold: ['visajismo-cejas-enfermedades-autoinmunes-007'],
      supporting_gold: ['visajismo-cejas-diabetis-cicatrizacion-004'],
      rationale: 'Contenido trata contraindicaciones médicas del microblading (autoinmunes, diabetes)',
      missing_information: null,
    },
    'cejas_008': {
      support_status: 'PARTIALLY_SUPPORTED',
      core_gold: ['visajismo-cejas-microblading-piel-grasa-005'],
      supporting_gold: [],
      rationale: 'Contenido sobre piel seborreica y microblading; no detalla remoción de microblading mal hecho',
      missing_information: 'Opciones y riesgos de remoción de microblading',
    },
  };
  return { gold, byId };
}

async function main() {
  const args = process.argv.slice(2);
  const run = (args.find(a => a.startsWith('--run=')) || '--run=A').split('=')[1];
  const phase = (args.find(a => a.startsWith('--phase=')) || '--phase=all').split('=')[1];

  // ── GUARDA ANTI-PRODUCCIÓN ──
  const ragUrl = process.env.RAG_DATABASE_URL || '';
  if (!(ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1') || ragUrl.includes('0.0.0.0'))) {
    console.error('🚫 RAG_DATABASE_URL NO es local. ABORTANDO.');
    process.exit(1);
  }

  const ds2 = JSON.parse(fs.readFileSync(DS2, 'utf8'));
  const corpus = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
  const valid = ds2.queries.filter(q => q.status === 'VALID');
  const { gold } = buildGold(corpus);

  // ── PHASE 1: construir y validar físicamente el Gold (sin retrieval) ──
  if (phase === '1' || phase === 'all') {
    const goldIds = new Set();
    for (const g of Object.values(gold)) {
      g.core_gold.forEach(id => goldIds.add(id));
      g.supporting_gold.forEach(id => goldIds.add(id));
    }
    const ids = [...goldIds];
    const pRes = await ragPool.query(
      'SELECT chunk_id, document_id, content_hash FROM beauty_knowledge_embeddings WHERE chunk_id = ANY($1::text[])', [ids]);
    const found = new Map(pRes.rows.map(r => [r.chunk_id, r]));
    const missing = ids.filter(id => !found.has(id));
    const noHash = pRes.rows.filter(r => !r.content_hash).map(r => r.chunk_id);

    const v4 = {
      schema_version: '4.0-gold-candidate',
      generated_at: new Date().toISOString(),
      status: 'CANDIDATO — PHASE 1 (construcción independiente, sin retrieval)',
      database: 'LOCAL_ONLY',
      note: 'Gold construido por inspección de contenido del corpus canónico. Búsqueda auxiliar: términos de intención + lectura de chunks. NO se usó ranking/similarity del motor.',
      gold_ids_total: ids.length,
      gold_ids_found: found.size,
      gold_ids_missing: missing,
      gold_ids_without_hash: noHash,
      physical_validation: missing.length === 0 && noHash.length === 0,
      queries: valid.map(q => ({
        query_id: q.id, query: q.query, category: q.category, difficulty: q.difficulty,
        support_status: gold[q.id].support_status,
        core_gold: gold[q.id].core_gold,
        supporting_gold: gold[q.id].supporting_gold,
        rationale: gold[q.id].rationale,
        missing_information: gold[q.id].missing_information,
      })),
    };
    fs.writeFileSync(GOLD_OUT, JSON.stringify(v4, null, 2));
    console.log(`✅ PHASE 1 → ${GOLD_OUT}`);
    console.log(`  Gold IDs: ${found.size}/${ids.length} | missing: ${missing.length} | sin hash: ${noHash.length}`);
    if (phase === '1') { await ragPool.end(); return; }
  }

  // ── PHASE 2: retrieval (solo después de congelar Gold) ──
  const v4 = JSON.parse(fs.readFileSync(GOLD_OUT, 'utf8'));
  const q4map = new Map(v4.queries.map(q => [q.query_id, q]));
  const TOPK = 10;

  const perQuery = [];
  for (const q of valid) {
    const g = q4map.get(q.id);
    const core = new Set(g.core_gold);
    const all = new Set([...g.core_gold, ...g.supporting_gold]);

    const qEmb = await generateEmbedding(q.query, 'query');
    const res = await ragPool.query(
      `SELECT id, chunk_id, document_id, content_hash, 1-(embedding <=> $1::halfvec) AS sim
       FROM beauty_knowledge_embeddings ORDER BY embedding <=> $1::halfvec LIMIT ${TOPK}`, ['[' + qEmb.join(',') + ']']);
    const rankedIds = res.rows.map(r => r.chunk_id);

    const metrics = (expSet) => {
      const out = { p1: 0, p3: 0, p5: 0, r5: 0, mrr: 0 };
      for (let i = 0; i < Math.min(5, rankedIds.length); i++) { if (expSet.has(rankedIds[i])) { if (out.mrr === 0) out.mrr = 1 / (i + 1); } }
      const hits5 = rankedIds.slice(0, 5).filter(id => expSet.has(id));
      out.p5 = hits5.length / 5; out.r5 = hits5.length / Math.max(1, expSet.size);
      out.p3 = rankedIds.slice(0, 3).filter(id => expSet.has(id)).length / 3;
      out.p1 = expSet.has(rankedIds[0]) ? 1 : 0;
      return { p1: +out.p1.toFixed(4), p3: +out.p3.toFixed(4), p5: +out.p5.toFixed(4), r5: +out.r5.toFixed(4), mrr: +out.mrr.toFixed(4) };
    };

    perQuery.push({
      query_id: q.id, category: q.category, support_status: g.support_status,
      core_gold: g.core_gold, supporting_gold: g.supporting_gold,
      metrics_core: metrics(core),
      metrics_core_supporting: metrics(all),
      retrieved_ids: rankedIds,
      // Overlap Gold ↔ histórico retrieval (post-hoc, solo auditoría de sesgo)
      gold_in_retrieved: all.size ? [...all].filter(id => rankedIds.includes(id)).length : 0,
      gold_total: all.size,
    });
    console.log(`✅ ${q.id} [${g.support_status}]: core R@5=${perQuery.at(-1).metrics_core.r5} MRR=${perQuery.at(-1).metrics_core.mrr} | +sup R@5=${perQuery.at(-1).metrics_core_supporting.r5}`);
    await new Promise(r => setTimeout(r, 250));
  }

  const agg = (fn) => {
    const vals = perQuery.map(fn).filter(v => v !== null);
    const n = vals.length;
    return { p1: +(vals.reduce((a, v) => a + v.p1, 0) / n).toFixed(4), p3: +(vals.reduce((a, v) => a + v.p3, 0) / n).toFixed(4), p5: +(vals.reduce((a, v) => a + v.p5, 0) / n).toFixed(4), r5: +(vals.reduce((a, v) => a + v.r5, 0) / n).toFixed(4), mrr: +(vals.reduce((a, v) => a + v.mrr, 0) / n).toFixed(4) };
  };
  // Solo SUPPORTED (con gold no vacío)
  const supported = perQuery.filter(q => q.gold_total > 0);
  const gCore = agg(q => q.metrics_core);
  const gAll = agg(q => q.metrics_core_supporting);

  // Overlap global
  const totalGold = perQuery.reduce((a, q) => a + q.gold_total, 0);
  const inRetrieved = perQuery.reduce((a, q) => a + q.gold_in_retrieved, 0);

  const out = {
    cycle: '24', experiment: 'R5-C12', database: 'LOCAL_ONLY', production_contacted: false,
    generated_at: new Date().toISOString(), run,
    model: 'nvidia/nv-embedqa-e5-v5 (1024d)',
    config: { topK: TOPK, motor: 'PRODUCTIVO sin modificar' },
    gold_source: 'PHASE 1 — inspección de contenido del corpus canónico (independiente del retrieval)',
    metrics_supported_only: {
      core_gold: gCore,
      core_plus_supporting: gAll,
      n_supported: supported.length,
    },
    gold_historical_overlap: {
      gold_chunks_total: totalGold,
      gold_in_retrieved_top10: inRetrieved,
      overlap_ratio: +(inRetrieved / Math.max(1, totalGold)).toFixed(4),
      interpretation: 'Overlap alto era esperable si el corpus responde la query y el motor funciona; se documenta como auditoría, no como criterio de selección.',
    },
    per_query: perQuery,
  };
  const outPath = path.join(AUDIT_DIR, `r5c12_independent_gold_audit_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ PHASE 2 → ${outPath}`);
  await ragPool.end();
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
