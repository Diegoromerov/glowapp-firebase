#!/usr/bin/env node
/**
 * backend/scripts/buildCanonicalCorpus.js
 * R5-A — Construcción del CORPUS CANÓNICO de Aura (reproducible)
 *
 * REGLA DE CANONIZACIÓN (basada en auditoría CICLO 07):
 * 1. Fuente: backend/data/corpus/*_auto_*.json (1101 snapshots)
 *    — Los snapshots son LOTES INCREMENTALES: cada archivo agrega chunks nuevos al dominio
 *      (evidencia: 88/95 pares consecutivos con overlap 0)
 * 2. Para cada dominio (base_name del archivo):
 *    a. Unión de TODOS los chunks de TODOS los snapshots del dominio
 *    b. Agrupar por chunk_id
 *    c. chunk_id con UNA aparición → canónico directo (94.3% del corpus)
 *    d. chunk_id con MÚLTIPLES apariciones, mismo contenido → dedupe
 *    e. chunk_id con variantes de contenido (5.7%) → se elige la ÚLTIMA emisión temporal
 *       como versión vigente del pipeline. NO se declara mejor calidad:
 *       se marca requires_review=true en el manifest para validación humana.
 * 3. Los 12 archivos consolidados (sin _auto_) son OTRO pipeline (IDs cortos,
 *    approved_by_md, contenido disjunto) → NO se mezclan; se registran en el manifest
 *    como corpus_clinico_paralelo.
 *
 * Salida:
 *   backend/src/data/corpus_canonico/corpus_canonico.json   (chunks canónicos)
 *   backend/src/data/corpus_canonico/corpus_manifest.json   (manifest versionado)
 *
 * Uso: node scripts/buildCanonicalCorpus.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CORPUS_DIR = path.join(__dirname, '..', 'data', 'corpus');
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'corpus_canonico');

function baseName(file) {
  let n = file.replace(/_auto_\d+(_[0-9a-f]{8,})?\.json$/, '');
  n = n.replace(/_(parte|lote)\d+\.json$/, '');
  n = n.replace(/_chunks\.json$/, '');
  return n;
}

function getTs(file) {
  const m = file.match(/_auto_(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function loadChunks(file) {
  const raw = fs.readFileSync(path.join(CORPUS_DIR, file), 'utf8');
  const clean = (raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
  const data = JSON.parse(clean);
  return Array.isArray(data) ? data : (data.chunks || []);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// ── 1. Recopilar snapshots ──
const files = fs.readdirSync(CORPUS_DIR).filter(f => f.endsWith('.json'));
const autoFiles = files.filter(f => f.includes('_auto_'));
const consolidatedFiles = files.filter(f => !f.includes('_auto_'));

console.log(`📦 Snapshots _auto_: ${autoFiles.length}`);
console.log(`📦 Consolidados (sin _auto_): ${consolidatedFiles.length}`);

// ── 2. Agrupar por dominio ──
const domainSnapshots = {};
for (const f of autoFiles) {
  const dom = baseName(f);
  if (!domainSnapshots[dom]) domainSnapshots[dom] = [];
  domainSnapshots[dom].push({ file: f, ts: getTs(f) });
}
for (const dom of Object.keys(domainSnapshots)) {
  domainSnapshots[dom].sort((a, b) => a.ts - b.ts);
}

// ── 3. Canonización por dominio ──
const canonicalChunks = [];
const manifestDomains = [];
const variantResolutions = [];

for (const [dom, snaps] of Object.entries(domainSnapshots).sort()) {
  // Recopilar todas las apariciones por chunk_id
  const byId = {};
  for (const snap of snaps) {
    const chunks = loadChunks(snap.file);
    for (const c of chunks) {
      const cid = c.chunk_id || '';
      if (!cid) continue;
      if (!byId[cid]) byId[cid] = [];
      byId[cid].push({
        ts: snap.ts,
        file: snap.file,
        chunk: c,
        content: c.content || '',
      });
    }
  }

  let nUnique = 0, nVariants = 0, nDedup = 0;
  const sourceFilesUsed = new Set();

  for (const [cid, appearances] of Object.entries(byId)) {
    // Contenidos distintos por hash
    const contentHashes = [...new Set(appearances.map(a => sha256(a.content)))];
    const isVariant = contentHashes.length > 1;

    // Selección: última emisión temporal (versión vigente del pipeline)
    appearances.sort((a, b) => a.ts - b.ts);
    const chosen = appearances[appearances.length - 1];
    sourceFilesUsed.add(chosen.file);

    if (appearances.length > 1) {
      if (isVariant) {
        nVariants++;
        variantResolutions.push({
          chunk_id: cid,
          domain: dom,
          emissions: appearances.length,
          content_variants: contentHashes.length,
          selected_ts: chosen.ts,
          selected_file: chosen.file,
          requires_review: true,
          reason: 'Múltiples emisiones con contenido distinto. Se eligió la última emisión temporal como versión vigente del pipeline. Sin evidencia de superioridad de calidad: revisión humana requerida.',
        });
      } else {
        nDedup++;
      }
    } else {
      nUnique++;
    }

    const md = chosen.chunk.metadata || {};
    const sources = chosen.chunk.sources || [];
    const firstSource = Array.isArray(sources) && sources.length > 0
      ? (sources[0].institution || sources[0].url || 'unknown')
      : 'unknown';

    canonicalChunks.push({
      document_id: dom,
      document_version: '1.0', // Sin versionado explícito en el corpus original
      chunk_id: cid,
      content_hash: sha256(chosen.content),
      fuente: firstSource,
      seccion: 'unknown', // Los JSON no tienen estructura de secciones
      category: chosen.chunk.category || dom,
      title: chosen.chunk.title || '',
      content: chosen.content,
      risk_level: chosen.chunk.risk_level || 'unknown',
      phase: chosen.chunk.phase !== undefined ? chosen.chunk.phase : null,
      clinical_review_status: chosen.chunk.clinical_review_status || 'unknown',
      is_cross_reference: !!chosen.chunk.is_cross_reference,
      metadata: {
        ...md,
        _source_files: [...new Set(appearances.map(a => a.file))],
        _emissions: appearances.length,
        _content_variants: contentHashes.length,
      },
    });
  }

  manifestDomains.push({
    domain: dom,
    snapshots: snaps.length,
    chunk_ids_total: Object.keys(byId).length,
    chunks_canonical: Object.keys(byId).length,
    unique_single: nUnique,
    dedup_same_content: nDedup,
    variants: nVariants,
    source_files: [...sourceFilesUsed].sort(),
    first_ts: snaps[0].ts,
    last_ts: snaps[snaps.length - 1].ts,
  });

  console.log(`✅ ${dom}: ${Object.keys(byId).length} chunks canónicos (${nVariants} variantes, ${nDedup} dedup)`);
}

// ── 4. Consolidados (corpus clínico paralelo — NO integrado) ──
const consolidatedInfo = [];
for (const f of consolidatedFiles.sort()) {
  const chunks = loadChunks(f);
  const approved = chunks.filter(c => c.clinical_review_status === 'approved_by_md').length;
  consolidatedInfo.push({
    file: f,
    chunks: chunks.length,
    approved_by_md: approved,
    ids: [...new Set(chunks.map(c => c.chunk_id))].slice(0, 8),
  });
}

// ── 5. Escribir salida ──
fs.mkdirSync(OUT_DIR, { recursive: true });

const generatedAt = new Date().toISOString();
const corpusVersion = '1.0.0';

const manifest = {
  corpus_version: corpusVersion,
  generated_at: generatedAt,
  canonicalization_rule: {
    source: 'backend/data/corpus/*_auto_*.json (1101 snapshots)',
    rule: [
      '1. Los snapshots son LOTES INCREMENTALES: unión de chunks por dominio (base_name)',
      '2. Chunk_id con una sola emisión → canónico directo (94.3%)',
      '3. Chunk_id con múltiples emisiones del mismo contenido → dedupe',
      '4. Chunk_id con variantes de contenido (5.7%) → última emisión temporal como versión vigente, marcada requires_review=true',
      '5. NO se declara superioridad de calidad para la última emisión (sin evidencia)',
    ],
    excluded: '12 archivos consolidados (sin _auto_) = corpus clínico paralelo con approved_by_md, IDs cortos, contenido disjunto. NO integrados. Ver consolidated_files.',
  },
  domains: manifestDomains,
  totals: {
    domains: manifestDomains.length,
    canonical_chunks: canonicalChunks.length,
    variant_resolutions: variantResolutions.length,
  },
  variant_resolutions: variantResolutions,
  consolidated_files: consolidatedInfo,
  reproducible: 'node backend/scripts/buildCanonicalCorpus.js',
};

const canonicalOut = {
  corpus_version: corpusVersion,
  generated_at: generatedAt,
  total_chunks: canonicalChunks.length,
  chunks: canonicalChunks,
};

fs.writeFileSync(path.join(OUT_DIR, 'corpus_canonico.json'), JSON.stringify(canonicalOut, null, 2));
fs.writeFileSync(path.join(OUT_DIR, 'corpus_manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`\n📊 TOTAL: ${canonicalChunks.length} chunks canónicos en ${manifestDomains.length} dominios`);
console.log(`   Variantes resueltas (requires_review): ${variantResolutions.length}`);
console.log(`📁 Salida: ${OUT_DIR}`);
