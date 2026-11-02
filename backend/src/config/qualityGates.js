/**
 * backend/src/config/qualityGates.js
 * Umbrales de calidad para evaluación RAG (RAGAS)
 * Quality Gates que determinan si el sistema pasa o falla
 */

const QUALITY_GATES = {
  // Métricas de Retrieval (búsqueda vectorial)
  retrieval: {
    precision_at_5: 0.70,    // 70% de chunks en top-5 deben ser relevantes
    recall_at_5: 0.60,       // 60% de chunks esperados deben estar en top-5
    mrr: 0.65,               // Primer chunk relevante en posición promedio ≤ 2 (1/MRR ≈ 1.5)
    top_k_accuracy: 0.50,    // El chunk más relevante en posición 1 al menos 50% veces
    context_precision: 0.70, // Chunks recuperados deben ser relevantes para la query
  },
  
  // Métricas de Generación (respuesta LLM)
  generation: {
    faithfulness: 0.80,      // 80% de la respuesta debe estar respaldada por chunks
    answer_relevancy: 0.75,  // 75% de relevancia en la respuesta
  },
  
  // Métricas de Latencia
  latency: {
    p50_ms: 3000,            // 50% de queries < 3 segundos
    p95_ms: 8000,            // 95% de queries < 8 segundos
    p99_ms: 15000,           // 99% de queries < 15 segundos
  },
  
  // Métricas de Disponibilidad
  availability: {
    error_rate: 0.05,        // Máximo 5% de consultas con error
    fallback_rate: 0.20,     // Máximo 20% de consultas usando fallback (Gemini/safe)
  }
};

/**
 * Verifica si las métricas pasan los quality gates
 * @param {Object} metrics - Métricas calculadas (output de runEvaluationSuite)
 * @returns {Object} { passed: boolean, failures: Array, warnings: Array }
 */
function checkQualityGates(metrics) {
  const failures = [];
  const warnings = [];
  
  const summary = metrics.summary || metrics;
  
  // Verificar métricas de retrieval
  const retrieval = summary.retrieval || {};
  const generation = summary.generation || {};
  const context = summary.context || {};
  const latency = summary.latency || {};
  const availability = summary.availability || {};
  
  // Retrieval gates
  if (retrieval.precision_at_k !== undefined && retrieval.precision_at_k < QUALITY_GATES.retrieval.precision_at_5) {
    failures.push({
      gate: 'retrieval.precision_at_5',
      metric: 'Precision@5',
      expected: QUALITY_GATES.retrieval.precision_at_5,
      actual: retrieval.precision_at_k,
      severity: 'error',
      message: `Precision@5 (${retrieval.precision_at_k.toFixed(2)}) por debajo del umbral (${QUALITY_GATES.retrieval.precision_at_5})`
    });
  }
  
  if (retrieval.recall_at_k !== undefined && retrieval.recall_at_k < QUALITY_GATES.retrieval.recall_at_5) {
    failures.push({
      gate: 'retrieval.recall_at_5',
      metric: 'Recall@5',
      expected: QUALITY_GATES.retrieval.recall_at_5,
      actual: retrieval.recall_at_k,
      severity: 'error',
      message: `Recall@5 (${retrieval.recall_at_k.toFixed(2)}) por debajo del umbral (${QUALITY_GATES.retrieval.recall_at_5})`
    });
  }
  
  if (retrieval.mrr !== undefined && retrieval.mrr < QUALITY_GATES.retrieval.mrr) {
    warnings.push({
      gate: 'retrieval.mrr',
      metric: 'MRR',
      expected: QUALITY_GATES.retrieval.mrr,
      actual: retrieval.mrr,
      severity: 'warning',
      message: `MRR (${retrieval.mrr.toFixed(2)}) por debajo del umbral (${QUALITY_GATES.retrieval.mrr})`
    });
  }
  
  if (context.precision !== undefined && context.precision < QUALITY_GATES.retrieval.context_precision) {
    failures.push({
      gate: 'retrieval.context_precision',
      metric: 'Context Precision',
      expected: QUALITY_GATES.retrieval.context_precision,
      actual: context.precision,
      severity: 'error',
      message: `Context Precision (${context.precision.toFixed(2)}) por debajo del umbral (${QUALITY_GATES.retrieval.context_precision})`
    });
  }
  
  // Generation gates
  if (generation.faithfulness !== undefined && generation.faithfulness < QUALITY_GATES.generation.faithfulness) {
    failures.push({
      gate: 'generation.faithfulness',
      metric: 'Faithfulness',
      expected: QUALITY_GATES.generation.faithfulness,
      actual: generation.faithfulness,
      severity: 'error',
      message: `Faithfulness (${generation.faithfulness.toFixed(2)}) por debajo del umbral (${QUALITY_GATES.generation.faithfulness})`
    });
  }
  
  if (generation.answer_relevancy !== undefined && generation.answer_relevancy < QUALITY_GATES.generation.answer_relevancy) {
    failures.push({
      gate: 'generation.answer_relevancy',
      metric: 'Answer Relevancy',
      expected: QUALITY_GATES.generation.answer_relevancy,
      actual: generation.answer_relevancy,
      severity: 'error',
      message: `Answer Relevancy (${generation.answer_relevancy.toFixed(2)}) por debajo del umbral (${QUALITY_GATES.generation.answer_relevancy})`
    });
  }
  
  // Latency gates
  if (latency.p50_ms !== undefined && latency.p50_ms > QUALITY_GATES.latency.p50_ms) {
    warnings.push({
      gate: 'latency.p50_ms',
      metric: 'Latencia P50',
      expected: QUALITY_GATES.latency.p50_ms,
      actual: latency.p50_ms,
      severity: 'warning',
      message: `Latencia P50 (${latency.p50_ms}ms) por encima del umbral (${QUALITY_GATES.latency.p50_ms}ms)`
    });
  }
  
  if (latency.p95_ms !== undefined && latency.p95_ms > QUALITY_GATES.latency.p95_ms) {
    warnings.push({
      gate: 'latency.p95_ms',
      metric: 'Latencia P95',
      expected: QUALITY_GATES.latency.p95_ms,
      actual: latency.p95_ms,
      severity: 'warning',
      message: `Latencia P95 (${latency.p95_ms}ms) por encima del umbral (${QUALITY_GATES.latency.p95_ms}ms)`
    });
  }
  
  if (latency.p99_ms !== undefined && latency.p99_ms > QUALITY_GATES.latency.p99_ms) {
    failures.push({
      gate: 'latency.p99_ms',
      metric: 'Latencia P99',
      expected: QUALITY_GATES.latency.p99_ms,
      actual: latency.p99_ms,
      severity: 'error',
      message: `Latencia P99 (${latency.p99_ms}ms) por encima del umbral (${QUALITY_GATES.latency.p99_ms}ms)`
    });
  }
  
  // Availability gates
  if (availability.error_rate !== undefined && availability.error_rate > QUALITY_GATES.availability.error_rate) {
    failures.push({
      gate: 'availability.error_rate',
      metric: 'Error Rate',
      expected: QUALITY_GATES.availability.error_rate,
      actual: availability.error_rate,
      severity: 'error',
      message: `Error rate (${(availability.error_rate * 100).toFixed(1)}%) por encima del umbral (${(QUALITY_GATES.availability.error_rate * 100).toFixed(1)}%)`
    });
  }
  
  if (availability.fallback_rate !== undefined && availability.fallback_rate > QUALITY_GATES.availability.fallback_rate) {
    warnings.push({
      gate: 'availability.fallback_rate',
      metric: 'Fallback Rate',
      expected: QUALITY_GATES.availability.fallback_rate,
      actual: availability.fallback_rate,
      severity: 'warning',
      message: `Fallback rate (${(availability.fallback_rate * 100).toFixed(1)}%) por encima del umbral (${(QUALITY_GATES.availability.fallback_rate * 100).toFixed(1)}%)`
    });
  }
  
  return {
    passed: failures.length === 0,
    failures,
    warnings,
    summary: {
      total_gates_checked: Object.keys(QUALITY_GATES).reduce((sum, cat) => sum + Object.keys(QUALITY_GATES[cat]).length, 0),
      failed: failures.length,
      warned: warnings.length,
      critical_failures: failures.filter(f => f.severity === 'error').length
    }
  };
}

/**
 * Genera reporte legible de quality gates
 */
function generateQualityGatesReport(checkResult) {
  let report = '\n📊 QUALITY GATES REPORT\n';
  report += '='.repeat(50) + '\n';
  
  if (checkResult.passed) {
    report += '✅ TODOS LOS QUALITY GATES PASARON\n\n';
  } else {
    report += `❌ ${checkResult.failures.length} GATE(S) FALLARON\n\n`;
  }
  
  if (checkResult.failures.length > 0) {
    report += '🚨 ERRORES CRÍTICOS:\n';
    for (const f of checkResult.failures) {
      report += `  • ${f.metric}: ${f.actual.toFixed(4)} (esperado ≥ ${f.expected})\n`;
      report += `    ${f.message}\n`;
    }
    report += '\n';
  }
  
  if (checkResult.warnings.length > 0) {
    report += '⚠️  ADVERTENCIAS:\n';
    for (const w of checkResult.warnings) {
      report += `  • ${w.metric}: ${w.actual.toFixed(4)} (esperado ≥ ${w.expected})\n`;
      report += `    ${w.message}\n`;
    }
    report += '\n';
  }
  
  report += `Resumen: ${checkResult.summary.failed} fallos, ${checkResult.summary.warned} advertencias\n`;
  
  return report;
}

module.exports = {
  QUALITY_GATES,
  checkQualityGates,
  generateQualityGatesReport
};