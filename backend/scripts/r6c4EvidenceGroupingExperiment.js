/**
 * R6-C4 Evidence Grouping Experiment
 * Experimental layer: Vector retrieval → Candidates → Evidence Groups → Sufficiency Signals
 * Read-only, no modifications to production
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ragPool } = require('../src/config/db');

const MAX_EMBED_CHARS = 1400;
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');

// Simple Jaccard similarity for text overlap
function jaccardSimilarity(textA, textB) {
  const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(textB.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

// Cosine similarity for vectors (if needed)
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return (normA > 0 && normB > 0) ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

// Check if two chunks are redundant (high textual overlap)
function isRedundant(chunkA, chunkB, threshold = 0.7) {
  return jaccardSimilarity(chunkA.content || '', chunkB.content || '') >= threshold;
}

// Check if two chunks are complementary (different content, same domain)
function isComplementary(chunkA, chunkB, titleOverlapThreshold = 0.3) {
  const titleSim = jaccardSimilarity(chunkA.title || '', chunkB.title || '');
  const contentSim = jaccardSimilarity(chunkA.content || '', chunkB.content || '');
  return titleSim < titleOverlapThreshold && contentSim < 0.5 && chunkA.category === chunkB.category;
}

async function main() {
  const args = process.argv.slice(2);
  const run = args.find(a => a.startsWith('--run='))?.split('=')[1] || 'A';

  // === ENV GUARD ===
  const ragUrl = process.env.RAG_DATABASE_URL || '';
  if (!(ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1') || ragUrl.includes('0.0.0.0'))) {
    console.error('🚫 PRODUCTION DETECTED - ABORT');
    process.exit(1);
  }
  console.log('✅ ENV GUARD: PASS (local)');

  // === BD INTEGRITY ===
  const integrity = await ragPool.query(`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE embedding IS NULL) AS nulls,
           COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS nonnulls
    FROM beauty_knowledge_embeddings
  `);
  const idxCheck = await ragPool.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename='beauty_knowledge_embeddings' AND indexname LIKE '%hnsw%'");
  console.log('BD INTEGRITY:', JSON.stringify(integrity.rows[0]));

  // === LOAD GOLD-V5 ===
  const goldPath = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v5_candidate.json');
  const gold = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
  const queries = gold.queries.filter(q => q.support_status !== 'UNSUPPORTED');
  console.log('GOLD-V5 queries:', queries.length);

  // === EMBEDDING FUNCTION ===
  const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
  const NVIDIA_API_URL = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1/embeddings';
  const NVIDIA_EMBEDDING_MODEL = process.env.NVIDIA_EMBEDDING_MODEL || 'nvidia/nv-embedqa-e5-v5';

  async function generateEmbedding(text) {
    const embeddingText = text.length > MAX_EMBED_CHARS ? text.substring(0, MAX_EMBED_CHARS) : text;
    const response = await fetch(NVIDIA_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + NVIDIA_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: NVIDIA_EMBEDDING_MODEL,
        input: [embeddingText],
        input_type: 'passage',
        encoding_format: 'float',
      }),
    });
    if (!response.ok) throw new Error('API error: ' + response.status);
    const data = await response.json();
    return data.data[0].embedding;
  }

  // === RETRIEVAL FUNCTION ===
  async function retrieveVector(query, k = 100) {
    const emb = await generateEmbedding(query);
    const vecStr = '[' + emb.join(',') + ']';
    const res = await ragPool.query(
      `SELECT chunk_id, title, content, category, metadata,
              1 - (embedding <=> $1::halfvec) AS similarity
       FROM beauty_knowledge_embeddings
       ORDER BY embedding <=> $1::halfvec
       LIMIT $2`,
      [vecStr, k]
    );
    return res.rows.map(r => ({
      chunk_id: r.chunk_id,
      title: r.title,
      content: r.content,
      category: r.category,
      metadata: r.metadata,
      similarity: parseFloat(r.similarity)
    }));
  }

  // === CONTROL-A: VECTOR BASELINE ===
  function evaluateControlA(queryId, expectedIds, retrievalResults, k) {
    const topK = retrievalResults.slice(0, k).map(r => r.chunk_id);
    return topK.some(id => expectedIds.includes(id));
  }

  // === CONTROL-B: CANDIDATES (from R6-C2) ===
  function buildCandidates(retrievalResults, queryId) {
    if (!retrievalResults || retrievalResults.length === 0) return [];

    const byCategory = {};
    for (const r of retrievalResults) {
      const cat = r.category || 'unknown';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(r);
    }

    const candidates = [];
    let candidateId = 0;

    for (const [category, chunks] of Object.entries(byCategory)) {
      chunks.sort((a, b) => b.similarity - a.similarity);
      const topChunks = chunks.slice(0, 3);
      if (topChunks.length === 0) continue;

      candidates.push({
        candidate_id: `cand_${queryId}_${candidateId++}`,
        query_id: queryId,
        chunk_ids: topChunks.map(c => c.chunk_id),
        category: category,
        titles: topChunks.map(c => c.title),
        retrieval_scores: topChunks.map(c => parseFloat(c.similarity.toFixed(4))),
        evidence_text: topChunks.map(c => c.content).join(' | '),
        provenance: {
          source: 'vector_retrieval',
          retrieval_count: topChunks.length,
          categories_represented: 1,
          max_score: parseFloat(topChunks[0].similarity.toFixed(4)),
          min_score: parseFloat(topChunks[topChunks.length - 1].similarity.toFixed(4)),
          score_spread: parseFloat((topChunks[0].similarity - topChunks[topChunks.length - 1].similarity).toFixed(4))
        },
        candidate_score: parseFloat(topChunks[0].similarity.toFixed(4)),
        evidence_count: topChunks.length,
        confidence_signals: {
          has_high_score: topChunks[0].similarity > 0.6,
          score_above_threshold: topChunks[0].similarity > 0.45,
          multiple_chunks: topChunks.length > 1,
          category_coherent: true
        }
      });
    }

    candidates.sort((a, b) => b.candidate_score - a.candidate_score);
    return candidates;
  }

  function evaluateControlB(queryId, expectedIds, candidates, k) {
    const candidateChunks = candidates.slice(0, k).flatMap(c => c.chunk_ids);
    return candidateChunks.some(id => expectedIds.includes(id));
  }

  // === EXPERIMENT-C: EVIDENCE GROUPING ===
  function buildEvidenceGroups(candidates, query, queryId) {
    if (!candidates || candidates.length === 0) return [];

    // Flatten all candidate chunks with their source candidate info
    const allChunks = [];
    for (const cand of candidates) {
      for (let i = 0; i < cand.chunk_ids.length; i++) {
        allChunks.push({
          chunk_id: cand.chunk_ids[i],
          title: cand.titles[i],
          content: cand.evidence_text.split(' | ')[i] || '',
          category: cand.category,
          similarity: cand.retrieval_scores[i],
          candidate_id: cand.candidate_id,
          candidate_score: cand.candidate_score,
          candidate_category: cand.category
        });
      }
    }

    // Deduplicate by chunk_id (keep highest similarity)
    const chunkMap = new Map();
    for (const chunk of allChunks) {
      const existing = chunkMap.get(chunk.chunk_id);
      if (!existing || chunk.similarity > existing.similarity) {
        chunkMap.set(chunk.chunk_id, chunk);
      }
    }
    const uniqueChunks = Array.from(chunkMap.values());

    // Group by category first
    const byCategory = {};
    for (const chunk of uniqueChunks) {
      const cat = chunk.category || 'unknown';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(chunk);
    }

    const groups = [];
    let groupId = 0;

    for (const [category, chunks] of Object.entries(byCategory)) {
      // Sort by similarity
      chunks.sort((a, b) => b.similarity - a.similarity);

      // Build groups within category using complementarity
      const used = new Set();
      for (let i = 0; i < chunks.length; i++) {
        if (used.has(chunks[i].chunk_id)) continue;

        const primary = chunks[i];
        used.add(primary.chunk_id);

        // Find complementary chunks
        const complementary = [];
        const redundant = [];

        for (let j = i + 1; j < chunks.length; j++) {
          if (used.has(chunks[j].chunk_id)) continue;

          if (isRedundant(primary, chunks[j])) {
            redundant.push(chunks[j].chunk_id);
            used.add(chunks[j].chunk_id);
          } else if (isComplementary(primary, chunks[j])) {
            complementary.push(chunks[j]);
            used.add(chunks[j].chunk_id);
          }
        }

        // Also check cross-category complementarity for same query
        const crossComplementary = [];
        for (const [otherCat, otherChunks] of Object.entries(byCategory)) {
          if (otherCat === category) continue;
          for (const oc of otherChunks) {
            if (used.has(oc.chunk_id)) continue;
            // Check if title/keywords suggest complementarity
            const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
            const ocText = (oc.title + ' ' + oc.content).toLowerCase();
            const primaryText = (primary.title + ' ' + primary.content).toLowerCase();
            const ocMatches = queryWords.filter(w => ocText.includes(w)).length;
            const primaryMatches = queryWords.filter(w => primaryText.includes(w)).length;
            const overlap = queryWords.filter(w => ocText.includes(w) && primaryText.includes(w)).length;

            if (ocMatches > 0 && primaryMatches > 0 && overlap < Math.min(ocMatches, primaryMatches)) {
              crossComplementary.push(oc);
              used.add(oc.chunk_id);
            }
          }
        }

        const groupChunks = [primary, ...complementary, ...crossComplementary];
        const allChunkIds = groupChunks.map(c => c.chunk_id);

        // Calculate group metrics
        const similarities = groupChunks.map(c => c.similarity);
        const maxSim = Math.max(...similarities);
        const minSim = Math.min(...similarities);
        const meanSim = similarities.reduce((a, b) => a + b, 0) / similarities.length;

        // Redundancy: average pairwise Jaccard within group
        let redundancySum = 0, redundancyPairs = 0;
        for (let a = 0; a < groupChunks.length; a++) {
          for (let b = a + 1; b < groupChunks.length; b++) {
            redundancySum += jaccardSimilarity(groupChunks[a].content || '', groupChunks[b].content || '');
            redundancyPairs++;
          }
        }
        const redundancy = redundancyPairs > 0 ? redundancySum / redundancyPairs : 0;

        // Hard negative ratio: chunks with high similarity but likely irrelevant
        // Heuristic: high similarity (>0.6) but from different category than query domain
        const queryDomain = query.category || '';
        const hardNegatives = groupChunks.filter(c =>
          c.similarity > 0.6 && c.category !== queryDomain && c.category !== 'unknown'
        ).length;
        const hardNegativeRatio = groupChunks.length > 0 ? hardNegatives / groupChunks.length : 0;

        // Coherence: category consistency
        const categories = new Set(groupChunks.map(c => c.category));
        const coherence = categories.size === 1 ? 1.0 : 1.0 / categories.size;

        // Coverage proxy: unique query keywords covered
        const queryKeywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        let coveredKeywords = new Set();
        for (const gc of groupChunks) {
          const text = (gc.title + ' ' + gc.content).toLowerCase();
          for (const kw of queryKeywords) {
            if (text.includes(kw)) coveredKeywords.add(kw);
          }
        }
        const coverage = queryKeywords.length > 0 ? coveredKeywords.size / queryKeywords.length : 0;

        // Evidence score: weighted combination
        const evidenceScore = (
          maxSim * 0.4 +
          coverage * 0.3 +
          coherence * 0.15 +
          (1 - redundancy) * 0.1 +
          (1 - hardNegativeRatio) * 0.05
        );

        // Sufficiency signal
        const hasHighScore = maxSim >= 0.55; // R5-C28 gate
        const hasMultiChunk = groupChunks.length > 1;
        const hasCoverage = coverage >= 0.5;
        const hasCoherence = coherence >= 0.5;
        const lowRedundancy = redundancy < 0.5;
        const lowHardNegatives = hardNegativeRatio < 0.3;

        let sufficiencySignal = 'INSUFFICIENT';
        if (hasHighScore && hasCoverage && hasCoherence && lowRedundancy && lowHardNegatives) {
          sufficiencySignal = 'SUFFICIENT';
        } else if (hasCoverage || hasHighScore) {
          sufficiencySignal = 'PARTIAL';
        }

        groups.push({
          group_id: `grp_${queryId}_${groupId++}`,
          query_id: queryId,
          chunk_ids: allChunkIds,
          primary_chunk_id: primary.chunk_id,
          complementary_chunk_ids: complementary.map(c => c.chunk_id),
          cross_complementary_chunk_ids: crossComplementary.map(c => c.chunk_id),
          redundant_chunk_ids: redundant,
          categories: Array.from(categories),
          category: category, // primary category
          coverage: parseFloat(coverage.toFixed(4)),
          coherence: parseFloat(coherence.toFixed(4)),
          redundancy: parseFloat(redundancy.toFixed(4)),
          hard_negative_ratio: parseFloat(hardNegativeRatio.toFixed(4)),
          evidence_score: parseFloat(evidenceScore.toFixed(4)),
          max_similarity: parseFloat(maxSim.toFixed(4)),
          min_similarity: parseFloat(minSim.toFixed(4)),
          mean_similarity: parseFloat(meanSim.toFixed(4)),
          sufficiency_signal: sufficiencySignal,
          sufficiency_details: {
            has_high_score: hasHighScore,
            has_multi_chunk: hasMultiChunk,
            has_coverage: hasCoverage,
            has_coherence: hasCoherence,
            low_redundancy: lowRedundancy,
            low_hard_negatives: lowHardNegatives
          },
          provenance: {
            source: 'evidence_grouping',
            total_chunks: groupChunks.length,
            primary_category: category,
            categories_represented: categories.size,
            retrieval_method: 'vector + grouping',
            grouping_signals: ['category', 'complementarity', 'redundancy', 'cross_category']
          }
        });
      }
    }

    // Sort groups by evidence_score descending
    groups.sort((a, b) => b.evidence_score - a.evidence_score);
    return groups;
  }

  function evaluateExperimentC(queryId, expectedIds, groups, k = 5) {
    const groupChunks = groups.slice(0, k).flatMap(g => g.chunk_ids);
    return groupChunks.some(id => expectedIds.includes(id));
  }

  // === CLASSIFY GROUP SUFFICIENCY ===
  function classifyGroupState(groups, expectedIds) {
    // Check if any SUFFICIENT group contains expected IDs
    const sufficientGroups = groups.filter(g => g.sufficiency_signal === 'SUFFICIENT');
    const partialGroups = groups.filter(g => g.sufficiency_signal === 'PARTIAL');

    let hasExpectedInSufficient = false;
    let hasExpectedInPartial = false;
    let hasExpectedInAny = false;

    for (const g of sufficientGroups) {
      if (g.chunk_ids.some(id => expectedIds.includes(id))) {
        hasExpectedInSufficient = true;
        break;
      }
    }
    for (const g of partialGroups) {
      if (g.chunk_ids.some(id => expectedIds.includes(id))) {
        hasExpectedInPartial = true;
        break;
      }
    }
    for (const g of groups) {
      if (g.chunk_ids.some(id => expectedIds.includes(id))) {
        hasExpectedInAny = true;
        break;
      }
    }

    // False SUFFICIENT: declared SUFFICIENT but no expected chunks
    const falseSufficient = sufficientGroups.length > 0 && !hasExpectedInSufficient;
    // False UNSUPPORTED: evidence exists but all groups INSUFFICIENT
    const falseUnsupported = !hasExpectedInAny && groups.some(g => g.evidence_score > 0.4);

    return {
      sufficient_groups: sufficientGroups.length,
      partial_groups: partialGroups.length,
      has_expected_in_sufficient: hasExpectedInSufficient,
      has_expected_in_partial: hasExpectedInPartial,
      has_expected_in_any: hasExpectedInAny,
      false_sufficient: falseSufficient,
      false_unsupported: falseUnsupported
    };
  }

  // === MAIN EVALUATION LOOP ===
  const controlAResults = [];
  const controlBResults = [];
  const experimentCResults = [];
  const groupData = [];

  let controlAHits = {5: 0, 10: 0, 20: 0, 50: 0, 100: 0};
  let controlBHits = {5: 0, 10: 0, 20: 0, 50: 0, 100: 0};
  let expCHits = {5: 0, 10: 0, 20: 0, 50: 0, 100: 0};
  let totalRR_A = 0, totalRR_B = 0, totalRR_C = 0;
  let querySuccessA = 0, querySuccessB = 0, querySuccessC = 0;

  let falseSufficientCount = 0;
  let falseUnsupportedCount = 0;

  for (const q of queries) {
    const expectedIds = [...(q.expected_chunks?.core || []), ...(q.expected_chunks?.supporting || [])];

    // Retrieval (top 100)
    const retrieval = await retrieveVector(q.query, 100);

    // Control-A: Raw vector
    const firstHitA = retrieval.findIndex(r => expectedIds.includes(r.chunk_id));
    for (const k of [5, 10, 20, 50, 100]) {
      if (evaluateControlA(q.query_id, expectedIds, retrieval, k)) controlAHits[k]++;
    }
    if (firstHitA >= 0) totalRR_A += 1 / (firstHitA + 1);
    if (evaluateControlA(q.query_id, expectedIds, retrieval, 100)) querySuccessA++;

    controlAResults.push({
      query_id: q.query_id,
      expected_ids: expectedIds,
      hit_at_5: evaluateControlA(q.query_id, expectedIds, retrieval, 5),
      hit_at_10: evaluateControlA(q.query_id, expectedIds, retrieval, 10),
      hit_at_20: evaluateControlA(q.query_id, expectedIds, retrieval, 20),
      hit_at_50: evaluateControlA(q.query_id, expectedIds, retrieval, 50),
      hit_at_100: evaluateControlA(q.query_id, expectedIds, retrieval, 100),
      first_hit_rank: firstHitA >= 0 ? firstHitA + 1 : null,
      retrieval_top5: retrieval.slice(0, 5).map(r => ({ chunk_id: r.chunk_id, similarity: r.similarity }))
    });

    // Control-B: Candidates
    const candidates = buildCandidates(retrieval.slice(0, 50), q.query_id);
    const firstHitB = candidates.flatMap(c => c.chunk_ids).findIndex(id => expectedIds.includes(id));
    for (const k of [5, 10, 20, 50, 100]) {
      if (evaluateControlB(q.query_id, expectedIds, candidates, k)) controlBHits[k]++;
    }
    if (firstHitB >= 0) totalRR_B += 1 / (firstHitB + 1);
    if (evaluateControlB(q.query_id, expectedIds, candidates, 100)) querySuccessB++;

    controlBResults.push({
      query_id: q.query_id,
      expected_ids: expectedIds,
      hit_at_5: evaluateControlB(q.query_id, expectedIds, candidates, 5),
      hit_at_10: evaluateControlB(q.query_id, expectedIds, candidates, 10),
      hit_at_20: evaluateControlB(q.query_id, expectedIds, candidates, 20),
      hit_at_50: evaluateControlB(q.query_id, expectedIds, candidates, 50),
      hit_at_100: evaluateControlB(q.query_id, expectedIds, candidates, 100),
      first_hit_rank: firstHitB >= 0 ? firstHitB + 1 : null,
      candidate_count: candidates.length,
      candidates_top5: candidates.slice(0, 5).map(c => ({
        candidate_id: c.candidate_id,
        chunk_ids: c.chunk_ids,
        category: c.category,
        candidate_score: c.candidate_score,
        evidence_count: c.evidence_count
      }))
    });

    // Experiment-C: Evidence Groups
    const groups = buildEvidenceGroups(candidates, q.query, q.query_id);
    const firstHitC = groups.flatMap(g => g.chunk_ids).findIndex(id => expectedIds.includes(id));
    for (const k of [5, 10, 20, 50, 100]) {
      if (evaluateExperimentC(q.query_id, expectedIds, groups, k)) expCHits[k]++;
    }
    if (firstHitC >= 0) totalRR_C += 1 / (firstHitC + 1);
    if (evaluateExperimentC(q.query_id, expectedIds, groups, 100)) querySuccessC++;

    // Classify sufficiency
    const classification = classifyGroupState(groups, expectedIds);
    if (classification.false_sufficient) falseSufficientCount++;
    if (classification.false_unsupported) falseUnsupportedCount++;

    // Store group data
    groupData.push({
      query_id: q.query_id,
      groups: groups.map(g => ({
        group_id: g.group_id,
        chunk_ids: g.chunk_ids,
        primary_chunk_id: g.primary_chunk_id,
        categories: g.categories,
        coverage: g.coverage,
        coherence: g.coherence,
        redundancy: g.redundancy,
        hard_negative_ratio: g.hard_negative_ratio,
        evidence_score: g.evidence_score,
        max_similarity: g.max_similarity,
        sufficiency_signal: g.sufficiency_signal,
        sufficiency_details: g.sufficiency_details,
        provenance: g.provenance
      })),
      classification
    });

    experimentCResults.push({
      query_id: q.query_id,
      expected_ids: expectedIds,
      hit_at_5: evaluateExperimentC(q.query_id, expectedIds, groups, 5),
      hit_at_10: evaluateExperimentC(q.query_id, expectedIds, groups, 10),
      hit_at_20: evaluateExperimentC(q.query_id, expectedIds, groups, 20),
      hit_at_50: evaluateExperimentC(q.query_id, expectedIds, groups, 50),
      hit_at_100: evaluateExperimentC(q.query_id, expectedIds, groups, 100),
      first_hit_rank: firstHitC >= 0 ? firstHitC + 1 : null,
      group_count: groups.length,
      groups_top5: groups.slice(0, 5).map(g => ({
        group_id: g.group_id,
        chunk_ids: g.chunk_ids,
        categories: g.categories,
        evidence_score: g.evidence_score,
        sufficiency_signal: g.sufficiency_signal,
        coverage: g.coverage,
        redundancy: g.redundancy,
        hard_negative_ratio: g.hard_negative_ratio
      }))
    });

    await new Promise(r => setTimeout(r, 100));
  }

  const total = queries.length;

  // === AGGREGATE METRICS ===
  const controlAMetrics = {
    r_at_5: parseFloat((controlAHits[5] / total).toFixed(4)),
    r_at_10: parseFloat((controlAHits[10] / total).toFixed(4)),
    r_at_20: parseFloat((controlAHits[20] / total).toFixed(4)),
    r_at_50: parseFloat((controlAHits[50] / total).toFixed(4)),
    r_at_100: parseFloat((controlAHits[100] / total).toFixed(4)),
    mrr: parseFloat((totalRR_A / total).toFixed(4)),
    query_success_at_100: parseFloat((querySuccessA / total).toFixed(4))
  };

  const controlBMetrics = {
    r_at_5: parseFloat((controlBHits[5] / total).toFixed(4)),
    r_at_10: parseFloat((controlBHits[10] / total).toFixed(4)),
    r_at_20: parseFloat((controlBHits[20] / total).toFixed(4)),
    r_at_50: parseFloat((controlBHits[50] / total).toFixed(4)),
    r_at_100: parseFloat((controlBHits[100] / total).toFixed(4)),
    mrr: parseFloat((totalRR_B / total).toFixed(4)),
    query_success_at_100: parseFloat((querySuccessB / total).toFixed(4))
  };

  const expCMetrics = {
    r_at_5: parseFloat((expCHits[5] / total).toFixed(4)),
    r_at_10: parseFloat((expCHits[10] / total).toFixed(4)),
    r_at_20: parseFloat((expCHits[20] / total).toFixed(4)),
    r_at_50: parseFloat((expCHits[50] / total).toFixed(4)),
    r_at_100: parseFloat((expCHits[100] / total).toFixed(4)),
    mrr: parseFloat((totalRR_C / total).toFixed(4)),
    query_success_at_100: parseFloat((querySuccessC / total).toFixed(4))
  };

  // Evidence/Group metrics
  const evidenceMetrics = {
    avg_groups_per_query: parseFloat((groupData.reduce((s, d) => s + d.groups.length, 0) / total).toFixed(2)),
    avg_chunks_per_group: parseFloat((groupData.reduce((s, d) => s + d.groups.reduce((ss, g) => ss + g.chunk_ids.length, 0), 0) / Math.max(1, groupData.reduce((s, d) => s + d.groups.length, 0))).toFixed(2)),
    avg_evidence_score: parseFloat((groupData.reduce((s, d) => s + d.groups.reduce((ss, g) => ss + g.evidence_score, 0), 0) / Math.max(1, groupData.reduce((s, d) => s + d.groups.length, 0))).toFixed(4)),
    avg_coverage: parseFloat((groupData.reduce((s, d) => s + d.groups.reduce((ss, g) => ss + g.coverage, 0), 0) / Math.max(1, groupData.reduce((s, d) => s + d.groups.length, 0))).toFixed(4)),
    avg_redundancy: parseFloat((groupData.reduce((s, d) => s + d.groups.reduce((ss, g) => ss + g.redundancy, 0), 0) / Math.max(1, groupData.reduce((s, d) => s + d.groups.length, 0))).toFixed(4)),
    avg_hard_negative_ratio: parseFloat((groupData.reduce((s, d) => s + d.groups.reduce((ss, g) => ss + g.hard_negative_ratio, 0), 0) / Math.max(1, groupData.reduce((s, d) => s + d.groups.length, 0))).toFixed(4)),
    sufficient_groups_total: groupData.reduce((s, d) => s + d.groups.filter(g => g.sufficiency_signal === 'SUFFICIENT').length, 0),
    partial_groups_total: groupData.reduce((s, d) => s + d.groups.filter(g => g.sufficiency_signal === 'PARTIAL').length, 0),
    insufficient_groups_total: groupData.reduce((s, d) => s + d.groups.filter(g => g.sufficiency_signal === 'INSUFFICIENT').length, 0),
    false_sufficient_count: falseSufficientCount,
    false_unsupported_count: falseUnsupportedCount
  };

  // Critical cases detail
  const criticalQueries = queries.filter(qq => ['cabello_002', 'cejas_004', 'cejas_008'].includes(qq.query_id));
  const criticalDetail = [];
  for (const q of criticalQueries) {
    const aRes = controlAResults.find(r => r.query_id === q.query_id);
    const bRes = controlBResults.find(r => r.query_id === q.query_id);
    const cRes = experimentCResults.find(r => r.query_id === q.query_id);
    const gData = groupData.find(d => d.query_id === q.query_id);
    criticalDetail.push({
      query_id: q.query_id,
      query: q.query,
      category: q.category,
      expected_ids: [...(q.expected_chunks?.core || []), ...(q.expected_chunks?.supporting || [])],
      control_a: aRes,
      control_b: bRes,
      experiment_c: cRes,
      groups_full: gData?.groups || [],
      classification: gData?.classification || {}
    });
  }

  // Deltas
  const delta_AB = {
    r_at_5: parseFloat((controlBMetrics.r_at_5 - controlAMetrics.r_at_5).toFixed(4)),
    r_at_10: parseFloat((controlBMetrics.r_at_10 - controlAMetrics.r_at_10).toFixed(4)),
    r_at_20: parseFloat((controlBMetrics.r_at_20 - controlAMetrics.r_at_20).toFixed(4)),
    r_at_50: parseFloat((controlBMetrics.r_at_50 - controlAMetrics.r_at_50).toFixed(4)),
    r_at_100: parseFloat((controlBMetrics.r_at_100 - controlAMetrics.r_at_100).toFixed(4)),
    mrr: parseFloat((controlBMetrics.mrr - controlAMetrics.mrr).toFixed(4))
  };

  const delta_AC = {
    r_at_5: parseFloat((expCMetrics.r_at_5 - controlAMetrics.r_at_5).toFixed(4)),
    r_at_10: parseFloat((expCMetrics.r_at_10 - controlAMetrics.r_at_10).toFixed(4)),
    r_at_20: parseFloat((expCMetrics.r_at_20 - controlAMetrics.r_at_20).toFixed(4)),
    r_at_50: parseFloat((expCMetrics.r_at_50 - controlAMetrics.r_at_50).toFixed(4)),
    r_at_100: parseFloat((expCMetrics.r_at_100 - controlAMetrics.r_at_100).toFixed(4)),
    mrr: parseFloat((expCMetrics.mrr - controlAMetrics.mrr).toFixed(4))
  };

  const delta_BC = {
    r_at_5: parseFloat((expCMetrics.r_at_5 - controlBMetrics.r_at_5).toFixed(4)),
    r_at_10: parseFloat((expCMetrics.r_at_10 - controlBMetrics.r_at_10).toFixed(4)),
    r_at_20: parseFloat((expCMetrics.r_at_20 - controlBMetrics.r_at_20).toFixed(4)),
    r_at_50: parseFloat((expCMetrics.r_at_50 - controlBMetrics.r_at_50).toFixed(4)),
    r_at_100: parseFloat((expCMetrics.r_at_100 - controlBMetrics.r_at_100).toFixed(4)),
    mrr: parseFloat((expCMetrics.mrr - controlBMetrics.mrr).toFixed(4))
  };

  // === BASELINE R6 PROVISIONAL ===
  const baselineR6 = {
    r_at_5: 0.0000,
    r_at_10: 0.0000,
    r_at_20: 0.0667,
    r_at_50: 0.2000,
    mrr: 0.0097,
    query_success_at_50: 0.2000
  };

  // === FINAL REPORT ===
  const report = {
    cycle: 'R6-C4',
    run,
    timestamp: new Date().toISOString(),
    hypothesis: "Si los candidatos recuperados son transformados en grupos de evidencia utilizando señales de contenido, categoría, título, similitud y diversidad, entonces los casos cuya evidencia está distribuida en múltiples chunks podrán identificarse con mayor precisión que utilizando únicamente el ranking vectorial individual.",
    bd_integrity: integrity.rows[0],
    baseline_r6_provisional: baselineR6,
    control_a_metrics: controlAMetrics,
    control_b_metrics: controlBMetrics,
    experiment_c_metrics: expCMetrics,
    delta_a_to_b: delta_AB,
    delta_a_to_c: delta_AC,
    delta_b_to_c: delta_BC,
    evidence_metrics: evidenceMetrics,
    control_a_results: controlAResults,
    control_b_results: controlBResults,
    experiment_c_results: experimentCResults,
    group_data: groupData,
    critical_cases: criticalDetail,
    production_guard: { status: 'PASS', note: 'Local BD only, read-only, no modifications' }
  };

  const outPath = path.join(OUT_DIR, `r6c4_evidence_grouping_experiment_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n=== CONTROL-A (Vector Baseline) ===');
  console.log(JSON.stringify(controlAMetrics, null, 2));
  console.log('\n=== CONTROL-B (Candidates) ===');
  console.log(JSON.stringify(controlBMetrics, null, 2));
  console.log('\n=== EXPERIMENT-C (Evidence Groups) ===');
  console.log(JSON.stringify(expCMetrics, null, 2));
  console.log('\n=== DELTA A→B ===');
  console.log(JSON.stringify(delta_AB, null, 2));
  console.log('\n=== DELTA A→C ===');
  console.log(JSON.stringify(delta_AC, null, 2));
  console.log('\n=== DELTA B→C ===');
  console.log(JSON.stringify(delta_BC, null, 2));
  console.log('\n=== EVIDENCE METRICS ===');
  console.log(JSON.stringify(evidenceMetrics, null, 2));
  console.log('\nREPORT:', outPath);

  await ragPool.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });