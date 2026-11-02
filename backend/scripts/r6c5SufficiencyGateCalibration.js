/**
 * R6-C5 Sufficiency Gate Calibration
 * Grid search over gate parameters using precomputed R6-C4 Evidence Groups
 * Read-only, no modifications to production
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'eval');

// Grid parameters as specified
const GRID = {
  strong_score_threshold: [0.45, 0.50, 0.55, 0.60],
  coverage_threshold: [0.30, 0.40, 0.50, 0.60],
  coherence_threshold: [0.30, 0.50, 0.70],
  redundancy_max: [0.50, 0.60, 0.70],
  hard_negative_max: [0.30, 0.40, 0.50]
};

// Calculate total combinations
const totalCombinations = Object.values(GRID).reduce((acc, arr) => acc * arr.length, 1);

async function main() {
  const args = process.argv.slice(2);
  const run = args.find(a => a.startsWith('--run='))?.split('=')[1] || 'A';

  console.log('=== R6-C5 SUFFICIENCY GATE CALIBRATION ===');
  console.log('Run:', run);
  console.log('Grid combinations:', totalCombinations);

  // === ENV GUARD ===
  const ragUrl = process.env.RAG_DATABASE_URL || '';
  if (!(ragUrl.includes('localhost') || ragUrl.includes('127.0.0.1') || ragUrl.includes('0.0.0.0'))) {
    console.error('🚫 PRODUCTION DETECTED - ABORT');
    process.exit(1);
  }
  console.log('✅ ENV GUARD: PASS (local)');

  // === LOAD GOLD-V5 ===
  const goldPath = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset_v5_candidate.json');
  const gold = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
  const queries = gold.queries.filter(q => q.support_status !== 'UNSUPPORTED');
  console.log('GOLD-V5 queries:', queries.length);

  // Build expected_ids map
  const expectedIdsMap = {};
  for (const q of queries) {
    const core = q.expected_chunks?.core || [];
    const supporting = q.expected_chunks?.supporting || [];
    expectedIdsMap[q.query_id] = [...core, ...supporting];
  }

  // === LOAD R6-C4 GROUPS (precomputed) ===
  const r6c4Path = path.join(__dirname, '..', 'src', 'data', 'eval', `r6c4_evidence_grouping_experiment_${run.toLowerCase()}.json`);
  if (!fs.existsSync(r6c4Path)) {
    console.error('❌ R6-C4 artifact not found:', r6c4Path);
    process.exit(1);
  }
  const r6c4 = JSON.parse(fs.readFileSync(r6c4Path, 'utf8'));
  console.log('R6-C4 groups loaded:', r6c4.group_data.length, 'queries');

  // === CONTROL GATE (R6-C4 current) ===
  const CONTROL_GATE = {
    strong_score_threshold: 0.55,
    coverage_threshold: 0.50,
    coherence_threshold: 0.50,
    redundancy_max: 0.50,
    hard_negative_max: 0.30
  };

  // === EVALUATE GATE FUNCTION ===
  function evaluateGate(groups, gate) {
    let sufficient = 0, partial = 0, insufficient = 0;
    let falseSufficient = 0, falseUnsupported = 0;
    let queriesAffected = new Set();

    for (const queryData of groups) {
      const qid = queryData.query_id;
      const expectedIds = expectedIdsMap[qid] || [];
      
      for (const group of queryData.groups) {
        const hasExpected = group.chunk_ids.some(id => expectedIds.includes(id));
        
        // Evaluate gate
        const passesStrongScore = group.max_similarity >= gate.strong_score_threshold;
        const passesCoverage = group.coverage >= gate.coverage_threshold;
        const passesCoherence = group.coherence >= gate.coherence_threshold;
        const passesRedundancy = group.redundancy <= gate.redundancy_max;
        const passesHardNegative = group.hard_negative_ratio <= gate.hard_negative_max;

        const isSufficient = passesStrongScore && passesCoverage && passesCoherence && passesRedundancy && passesHardNegative;

        if (isSufficient) {
          sufficient++;
          if (!hasExpected) {
            falseSufficient++;
            queriesAffected.add(qid);
          }
        } else if (group.sufficiency_signal === 'PARTIAL' || (!passesStrongScore && (passesCoverage || passesCoherence))) {
          partial++;
        } else {
          insufficient++;
        }

        if (!hasExpected && group.evidence_score > 0.4) {
          falseUnsupported++;
          queriesAffected.add(qid);
        }
      }
    }

    return {
      sufficient_count: sufficient,
      partial_count: partial,
      insufficient_count: insufficient,
      false_sufficient: falseSufficient,
      false_unsupported: falseUnsupported,
      queries_affected: queriesAffected.size
    };
  }

  // === CLASSIFY QUERY STATE ===
  function classifyQueryState(queryData, gate) {
    const qid = queryData.query_id;
    const expectedIds = expectedIdsMap[qid] || [];
    const groups = queryData.groups;

    let state = 'INSUFFICIENT';
    let bestGroup = null;
    let hasExpectedInAny = false;

    for (const group of groups) {
      const hasExpected = group.chunk_ids.some(id => expectedIds.includes(id));
      if (hasExpected) hasExpectedInAny = true;

      const passesStrongScore = group.max_similarity >= gate.strong_score_threshold;
      const passesCoverage = group.coverage >= gate.coverage_threshold;
      const passesCoherence = group.coherence >= gate.coherence_threshold;
      const passesRedundancy = group.redundancy <= gate.redundancy_max;
      const passesHardNegative = group.hard_negative_ratio <= gate.hard_negative_max;
      const isSufficient = passesStrongScore && passesCoverage && passesCoherence && passesRedundancy && passesHardNegative;

      if (isSufficient && hasExpected) {
        if (state !== 'SUFFICIENT') state = 'SUFFICIENT';
        if (!bestGroup || group.evidence_score > bestGroup.evidence_score) bestGroup = group;
      } else if (isSufficient && !hasExpected) {
        if (state !== 'SUFFICIENT') state = 'FALSE_SUFFICIENT';
      } else if (hasExpected && (passesCoverage || passesCoherence)) {
        if (state === 'INSUFFICIENT') state = 'PARTIAL';
        if (!bestGroup || group.evidence_score > bestGroup.evidence_score) bestGroup = group;
      }
    }

    return {
      query_id: qid,
      state,
      best_group_id: bestGroup?.group_id || null,
      best_group_score: bestGroup?.evidence_score || 0,
      best_group_coverage: bestGroup?.coverage || 0,
      has_expected_in_any: hasExpectedInAny
    };
  }

  // === GENERATE ALL CONFIGURATIONS ===
  const configs = [];
  const keys = Object.keys(GRID);
  const values = Object.values(GRID);
  
  // Cartesian product
  function cartesianProduct(arrays) {
    return arrays.reduce((acc, arr) => 
      acc.flatMap(d => arr.map(v => [...d, v])), [[]]
    );
  }

  const combinations = cartesianProduct(values);
  console.log('Total configurations to evaluate:', combinations.length);

  // === EVALUATE ALL CONFIGURATIONS ===
  const allResults = [];
  
  for (const combo of combinations) {
    const gate = {};
    keys.forEach((k, i) => gate[k] = combo[i]);

    const metrics = evaluateGate(r6c4.group_data, gate);
    
    // Critical cases
    const criticalCases = {};
    for (const qid of ['cabello_002', 'cejas_004', 'cejas_008']) {
      const qd = r6c4.group_data.find(g => g.query_id === qid);
      if (qd) {
        criticalCases[qid] = classifyQueryState(qd, gate);
      }
    }

    // Global retrieval metrics (from R6-C4 experiment_c_metrics)
    const globalMetrics = {
      r_at_5: r6c4.experiment_c_metrics.r_at_5,
      r_at_10: r6c4.experiment_c_metrics.r_at_10,
      r_at_20: r6c4.experiment_c_metrics.r_at_20,
      r_at_50: r6c4.experiment_c_metrics.r_at_50,
      mrr: r6c4.experiment_c_metrics.mrr,
      query_success_at_100: r6c4.experiment_c_metrics.query_success_at_100
    };

    allResults.push({
      gate: {...gate},
      metrics: metrics,
      critical_cases: criticalCases,
      global_metrics: globalMetrics
    });
  }

  // === ANALYZE RESULTS ===
  // Control baseline
  const controlResult = allResults.find(r => 
    r.gate.strong_score_threshold === 0.55 &&
    r.gate.coverage_threshold === 0.50 &&
    r.gate.coherence_threshold === 0.50 &&
    r.gate.redundancy_max === 0.50 &&
    r.gate.hard_negative_max === 0.30
  );

  console.log('\n=== CONTROL (R6-C4 Gate) ===');
  console.log('Metrics:', JSON.stringify(controlResult.metrics, null, 2));
  console.log('Critical:', JSON.stringify(controlResult.critical_cases, null, 2));

  // Find SAFE-PASS candidates
  const safePass = allResults.filter(r => 
    r.metrics.false_unsupported <= 6 &&
    r.metrics.false_sufficient === 0 &&
    r.critical_cases.cejas_004?.state !== 'SUFFICIENT' &&
    r.critical_cases.cejas_004?.state !== 'FALSE_SUFFICIENT'
  );

  // Find MIXED candidates
  const mixed = allResults.filter(r => 
    r.metrics.false_unsupported <= 6 &&
    (r.metrics.false_sufficient > 0 || r.critical_cases.cejas_004?.state === 'SUFFICIENT' || r.critical_cases.cejas_004?.state === 'FALSE_SUFFICIENT')
  );

  // Find UNSAFE (cejas_004 = SUFFICIENT)
  const unsafe = allResults.filter(r => 
    r.critical_cases.cejas_004?.state === 'SUFFICIENT' || r.critical_cases.cejas_004?.state === 'FALSE_SUFFICIENT'
  );

  // Sort by: fewest false_unsupported, then fewest false_sufficient, then most conservative (higher thresholds)
  const sortKey = (r) => [
    r.metrics.false_unsupported,
    r.metrics.false_sufficient,
    -r.gate.strong_score_threshold,
    -r.gate.coverage_threshold,
    -r.gate.coherence_threshold,
    r.gate.redundancy_max,
    r.gate.hard_negative_max
  ];

  safePass.sort((a, b) => sortKey(a).join(',') > sortKey(b).join(',') ? 1 : -1);
  mixed.sort((a, b) => sortKey(a).join(',') > sortKey(b).join(',') ? 1 : -1);

  console.log('\n=== SAFE-PASS CANDIDATES (' + safePass.length + ') ===');
  if (safePass.length > 0) {
    const best = safePass[0];
    console.log('BEST:', JSON.stringify(best.gate, null, 2));
    console.log('Metrics:', JSON.stringify(best.metrics, null, 2));
    console.log('Critical:', JSON.stringify(best.critical_cases, null, 2));
  }

  console.log('\n=== MIXED CANDIDATES (' + mixed.length + ') ===');
  mixed.slice(0, 5).forEach(m => console.log('  Gate:', JSON.stringify(m.gate), '| F-Unsup:', m.metrics.false_unsupported, '| F-Suff:', m.metrics.false_sufficient, '| cejas_004:', m.critical_cases.cejas_004?.state));

  console.log('\n=== UNSAFE CANDIDATES (' + unsafe.length + ') ===');
  unsafe.forEach(u => console.log('  Gate:', JSON.stringify(u.gate), '| cejas_004:', u.critical_cases.cejas_004?.state));

  // === DETAILED CRITICAL CASE ANALYSIS ===
  const criticalDetail = {};
  for (const qid of ['cabello_002', 'cejas_004', 'cejas_008']) {
    const qd = r6c4.group_data.find(g => g.query_id === qid);
    const expectedIds = expectedIdsMap[qid] || [];
    
    // Show top groups with their gate evaluation for control and best safe-pass
    const controlGate = CONTROL_GATE;
    const bestGate = safePass.length > 0 ? safePass[0].gate : controlGate;
    
    const groupsWithEval = qd.groups.map(g => {
      const controlEval = {
        passes_strong: g.max_similarity >= controlGate.strong_score_threshold,
        passes_cov: g.coverage >= controlGate.coverage_threshold,
        passes_coh: g.coherence >= controlGate.coherence_threshold,
        passes_red: g.redundancy <= controlGate.redundancy_max,
        passes_hn: g.hard_negative_ratio <= controlGate.hard_negative_max,
        is_sufficient: g.max_similarity >= controlGate.strong_score_threshold &&
                       g.coverage >= controlGate.coverage_threshold &&
                       g.coherence >= controlGate.coherence_threshold &&
                       g.redundancy <= controlGate.redundancy_max &&
                       g.hard_negative_ratio <= controlGate.hard_negative_max
      };
      
      const bestEval = {
        passes_strong: g.max_similarity >= bestGate.strong_score_threshold,
        passes_cov: g.coverage >= bestGate.coverage_threshold,
        passes_coh: g.coherence >= bestGate.coherence_threshold,
        passes_red: g.redundancy <= bestGate.redundancy_max,
        passes_hn: g.hard_negative_ratio <= bestGate.hard_negative_max,
        is_sufficient: g.max_similarity >= bestGate.strong_score_threshold &&
                       g.coverage >= bestGate.coverage_threshold &&
                       g.coherence >= bestGate.coherence_threshold &&
                       g.redundancy <= bestGate.redundancy_max &&
                       g.hard_negative_ratio <= bestGate.hard_negative_max
      };

      return {
        group_id: g.group_id,
        evidence_score: g.evidence_score,
        coverage: g.coverage,
        coherence: g.coherence,
        redundancy: g.redundancy,
        hard_negative_ratio: g.hard_negative_ratio,
        max_similarity: g.max_similarity,
        chunk_ids: g.chunk_ids,
        has_expected: g.chunk_ids.some(id => expectedIds.includes(id)),
        control_eval: controlEval,
        best_eval: bestEval
      };
    });

    criticalDetail[qid] = {
      query_id: qid,
      expected_ids: expectedIds,
      expected_count: expectedIds.length,
      control_state: classifyQueryState(qd, controlGate),
      best_state: classifyQueryState(qd, bestGate),
      groups: groupsWithEval
    };
  }

  // === VERDICT ===
  let verdict = 'SUFFICIENCY-CALIBRATION-DISCONFIRMED';
  let selectedGate = CONTROL_GATE;

  if (safePass.length > 0) {
    verdict = 'SUFFICIENCY-CALIBRATION-PASS';
    selectedGate = safePass[0].gate;
  } else if (mixed.length > 0) {
    verdict = 'SUFFICIENCY-CALIBRATION-MIXED';
    selectedGate = mixed[0].gate;
  } else if (unsafe.length > 0) {
    verdict = 'SUFFICIENCY-CALIBRATION-UNSAFE';
  }

  // === FINAL REPORT ===
  const report = {
    cycle: 'R6-C5',
    run,
    timestamp: new Date().toISOString(),
    hypothesis: "Existe una configuración del Sufficiency Gate adaptada al espacio vectorial R6 que reduzca significativamente los FALSE UNSUPPORTED sin producir FALSE SUFFICIENT.",
    baseline_r6_provisional: r6c4.baseline_r6_provisional,
    control_gate: CONTROL_GATE,
    grid_parameters: GRID,
    total_configurations_evaluated: combinations.length,
    control_result: controlResult,
    all_configurations: allResults.map(r => ({
      gate: r.gate,
      metrics: r.metrics,
      critical_cases: r.critical_cases
    })),
    safe_pass_candidates: safePass.map(r => ({
      gate: r.gate,
      metrics: r.metrics,
      critical_cases: r.critical_cases
    })),
    mixed_candidates: mixed.map(r => ({
      gate: r.gate,
      metrics: r.metrics,
      critical_cases: r.critical_cases
    })),
    unsafe_candidates: unsafe.map(r => ({
      gate: r.gate,
      metrics: r.metrics,
      critical_cases: r.critical_cases,
      risk: 'FALSE-POSITIVE-RISK'
    })),
    critical_cases_detail: criticalDetail,
    selected_gate: selectedGate,
    verdict,
    limitations: [
      "Gate calibration uses precomputed R6-C4 groups; retrieval not re-evaluated",
      "Coverage metric based on keyword overlap (Jaccard), not semantic coverage",
      "R6-C4 groups already limited by retrieval ceiling (R@50=0.2)",
      "cejas_004 VECTOR_MISS: gold chunks absent from retrieval pool (rank >100)",
      "No LLM-based sufficiency assessment; purely heuristic gate",
      "Grid search space limited to 5 parameters x discrete values"
    ],
    next_recommendation: {
      if_pass: "R6-C6 Evidence Aggregator Experimental with calibrated gate",
      if_mixed: "Refine gate parameters or add claim-level evidence validation before R6-C6",
      if_fail: "Retrieval improvement required (R6-C7) or Corpus expansion (Director decision)",
      if_unsafe: "Gate fundamentally incompatible with R6 space; redesign sufficiency model"
    },
    reproducibility: {
      run_a_artifact: 'r6c5_sufficiency_gate_calibration_a.json',
      run_b_artifact: 'r6c5_sufficiency_gate_calibration_b.json',
      deterministic: true,
      depends_on: 'R6-C4 precomputed groups (deterministic)'
    },
    production_guard: { status: 'PASS', note: 'Read-only, uses precomputed artifacts, no BD access' }
  };

  const outPath = path.join(OUT_DIR, `r6c5_sufficiency_gate_calibration_${run.toLowerCase()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n=== REPORT ===');
  console.log('Verdict:', verdict);
  console.log('Selected Gate:', JSON.stringify(selectedGate, null, 2));
  console.log('Report saved:', outPath);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });