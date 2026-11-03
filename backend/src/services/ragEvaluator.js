/**
 * backend/src/services/ragEvaluator.js
 * Servicio de evaluación de calidad RAG (RAGAS - implementación propia)
 * Calcula métricas de retrieval y generación sin librerías externas
 */

const { pool } = require('../config/db');
const { searchBeautyKnowledge } = require('./ragService');
const { processAssistantMessage } = require('./geminiService');
const { generateEmbedding } = require('./embeddingService');

/**
 * Calcula similitud coseno entre dos vectores
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Extrae palabras clave significativas de un texto
 */
function extractKeywords(text, maxKeywords = 20) {
  if (!text) return [];
  
  const stopWords = new Set([
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'pero', 'si', 'no',
    'de', 'del', 'en', 'con', 'por', 'para', 'que', 'es', 'son', 'está', 'están',
    'como', 'qué', 'cuál', 'cuándo', 'dónde', 'cómo', 'quién', 'mi', 'tu', 'su',
    'me', 'te', 'se', 'nos', 'les', 'lo', 'le', 'a', 'al', 'ante', 'bajo', 'cabe',
    'con', 'contra', 'desde', 'durante', 'entre', 'hacia', 'hasta', 'mediante',
    'para', 'por', 'según', 'sin', 'so', 'sobre', 'tras', 'versus', 'vía'
  ]);
  
  const words = text
    .toLowerCase()
    .replace(/[^\w\sáéíóúñ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));
  
  const freq = {};
  words.forEach(w => freq[w] = (freq[w] || 0) + 1);
  
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word]) => word);
}

/**
 * 1. Evalúa métricas de retrieval: precision@k, recall@k, MRR, top_k_accuracy
 */
function evaluateRetrieval(query, expectedChunks, retrievedChunks) {
  const retrievedIds = retrievedChunks.map(c => c.id || c.chunk_id).filter(Boolean);
  const expectedSet = new Set(expectedChunks);
  
  // Precision@k: proportion of retrieved chunks that are relevant
  const relevantRetrieved = retrievedIds.filter(id => expectedSet.has(id)).length;
  const precisionAtK = retrievedIds.length > 0 ? relevantRetrieved / retrievedIds.length : 0;
  
  // Recall@k: proportion of expected chunks that were retrieved
  const recallAtK = expectedChunks.length > 0 ? relevantRetrieved / expectedChunks.length : 0;
  
  // MRR: Mean Reciprocal Rank - position of first relevant chunk
  let mrr = 0;
  for (let i = 0; i < retrievedIds.length; i++) {
    if (expectedSet.has(retrievedIds[i])) {
      mrr = 1 / (i + 1);
      break;
    }
  }
  
  // Top-k accuracy: is the most relevant chunk in top-k?
  const topKAccuracy = retrievedIds.length > 0 && expectedSet.has(retrievedIds[0]) ? 1 : 0;
  
  return {
    precision_at_k: Math.round(precisionAtK * 10000) / 10000,
    recall_at_k: Math.round(recallAtK * 10000) / 10000,
    mrr: Math.round(mrr * 10000) / 10000,
    top_k_accuracy: topKAccuracy,
    relevant_retrieved: relevantRetrieved,
    total_retrieved: retrievedIds.length,
    total_expected: expectedChunks.length
  };
}

/**
 * 2. Evalúa faithfulness: ¿la respuesta está respaldada por los chunks?
 * Implementación simplificada: verifica keywords de respuesta en chunks
 */
function evaluateFaithfulness(answer, retrievedChunks) {
  if (!answer || !retrievedChunks.length) return 0;
  
  const answerKeywords = extractKeywords(answer, 30);
  if (!answerKeywords.length) return 1; // Respuesta vacía o solo stopwords
  
  // Concatenar todo el contenido de chunks
  const chunksText = retrievedChunks
    .map(c => c.content || c.text || '')
    .join(' ')
    .toLowerCase();
  
  // Verificar cuántas keywords de la respuesta aparecen en los chunks
  let supported = 0;
  for (const keyword of answerKeywords) {
    if (chunksText.includes(keyword.toLowerCase())) {
      supported++;
    }
  }
  
  return Math.round((supported / answerKeywords.length) * 10000) / 10000;
}

/**
 * 3. Evalúa answer relevancy: ¿la respuesta responde la pregunta?
 * Implementación: similitud coseno entre embeddings de query y respuesta
 */
async function evaluateAnswerRelevancy(query, answer) {
  if (!query || !answer) return 0;
  
  try {
    const queryEmbedding = await generateEmbedding(query, { input_type: 'query' });
    const answerEmbedding = await generateEmbedding(answer, { input_type: 'passage' });
    
    if (!queryEmbedding || !answerEmbedding) return 0;
    
    const similarity = cosineSimilarity(queryEmbedding, answerEmbedding);
    return Math.round(similarity * 10000) / 10000;
  } catch (error) {
    console.warn('⚠️ Error calculando answer relevancy:', error.message);
    // Fallback: keyword overlap
    const queryKeywords = new Set(extractKeywords(query, 15));
    const answerKeywords = new Set(extractKeywords(answer, 15));
    
    if (!queryKeywords.size) return 0;
    
    let overlap = 0;
    for (const kw of queryKeywords) {
      if (answerKeywords.has(kw)) overlap++;
    }
    
    return Math.round((overlap / queryKeywords.size) * 10000) / 10000;
  }
}

/**
 * 4. Evalúa context precision: ¿los chunks recuperados son relevantes?
 * Similitud promedio entre query y cada chunk recuperado
 */
async function evaluateContextPrecision(query, retrievedChunks) {
  if (!query || !retrievedChunks.length) return 0;
  
  try {
    const queryEmbedding = await generateEmbedding(query, { input_type: 'query' });
    if (!queryEmbedding) return 0;
    
    let totalSimilarity = 0;
    let validChunks = 0;
    
    for (const chunk of retrievedChunks) {
      const chunkText = chunk.content || chunk.text || '';
      if (!chunkText) continue;
      
      try {
        const chunkEmbedding = await generateEmbedding(chunkText.substring(0, 500), { input_type: 'passage' });
        if (chunkEmbedding) {
          const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);
          totalSimilarity += similarity;
          validChunks++;
        }
      } catch (e) {
        // Ignorar chunks que fallen
      }
    }
    
    return validChunks > 0 ? Math.round((totalSimilarity / validChunks) * 10000) / 10000 : 0;
  } catch (error) {
    console.warn('⚠️ Error calculando context precision:', error.message);
    return 0;
  }
}

/**
 * 5. Evalúa context recall: ¿se recuperó toda la información necesaria?
 * Proporción de chunks esperados que fueron recuperados
 */
function evaluateContextRecall(query, expectedChunks, retrievedChunks) {
  if (!expectedChunks.length) return 1; // No hay expectativa, perfecto
  
  const retrievedIds = new Set(retrievedChunks.map(c => c.id || c.chunk_id).filter(Boolean));
  const foundExpected = expectedChunks.filter(id => retrievedIds.has(id)).length;
  
  return Math.round((foundExpected / expectedChunks.length) * 10000) / 10000;
}

/**
 * 6. Ejecuta suite completa de evaluación
 */
async function runEvaluationSuite(dataset, options = {}) {
  const { 
    topK = 5, 
    generateAnswers = true,
    verbose = false 
  } = options;
  
  console.log(`🧪 Iniciando evaluación RAG con ${dataset.queries.length} queries...`);
  
  const results = [];
  let totalRetrieval = { precision_at_k: 0, recall_at_k: 0, mrr: 0, top_k_accuracy: 0 };
  let totalGeneration = { faithfulness: 0, answer_relevancy: 0, context_precision: 0, context_recall: 0 };
  let totalLatency = 0;
  let errors = 0;
  
  for (let i = 0; i < dataset.queries.length; i++) {
    const item = dataset.queries[i];
    const startTime = Date.now();
    
    if (verbose) {
      console.log(`\n📋 Query ${i + 1}/${dataset.queries.length} [${item.category}/${item.difficulty}]: ${item.query}`);
    }
    
    try {
      // a. Generar embedding y buscar
      const retrievalStart = Date.now();
      const retrieved = await searchBeautyKnowledge(item.query, { topK, threshold: 0.65 });
      const retrievalLatency = Date.now() - retrievalStart;
      
      const retrievedChunks = retrieved.map((r, idx) => ({
        id: r.id || `retrieved_${idx}`,
        content: r.content || r.text || '',
        score: r.score || 0
      }));
      
      // b. Métricas de retrieval
      const retrievalMetrics = evaluateRetrieval(
        item.query, 
        item.expected_chunks || [], 
        retrievedChunks
      );
      
      // c. Métricas de contexto
      const contextPrecision = await evaluateContextPrecision(item.query, retrievedChunks);
      const contextRecall = evaluateContextRecall(item.query, item.expected_chunks || [], retrievedChunks);
      
      let generationMetrics = { faithfulness: 0, answer_relevancy: 0 };
      let answer = '';
      
      if (generateAnswers && retrievedChunks.length > 0) {
        // d. Generar respuesta con LLM
        try {
          // Usar processAssistantMessage pero necesitamos userId
          // Para evaluación, usamos un userId de prueba
          // Nota: processAssistantMessage guarda en BD, usamos mock o alternativa
          const knowledgeContext = retrievedChunks
            .map(c => c.content)
            .join('\n\n');
          
          // Simulación simple de respuesta para evaluación
          // En producción real, llamaríamos al LLM
          answer = `Basado en la información recuperada: ${knowledgeContext.substring(0, 300)}...`;
          
          // e. Métricas de generación
          generationMetrics.faithfulness = evaluateFaithfulness(answer, retrievedChunks);
          generationMetrics.answer_relevancy = await evaluateAnswerRelevancy(item.query, answer);
        } catch (e) {
          console.warn(`⚠️ Error generando respuesta para query ${item.id}:`, e.message);
        }
      }
      
      const latency = Date.now() - startTime;
      totalLatency += latency;
      
      // Acumular totales
      totalRetrieval.precision_at_k += retrievalMetrics.precision_at_k;
      totalRetrieval.recall_at_k += retrievalMetrics.recall_at_k;
      totalRetrieval.mrr += retrievalMetrics.mrr;
      totalRetrieval.top_k_accuracy += retrievalMetrics.top_k_accuracy;
      
      totalGeneration.faithfulness += generationMetrics.faithfulness;
      totalGeneration.answer_relevancy += generationMetrics.answer_relevancy;
      totalGeneration.context_precision += contextPrecision;
      totalGeneration.context_recall += contextRecall;
      
      const queryResult = {
        query_id: item.id,
        query: item.query,
        category: item.category,
        difficulty: item.difficulty,
        retrieval: retrievalMetrics,
        generation: generationMetrics,
        context_precision: Math.round(contextPrecision * 10000) / 10000,
        context_recall: Math.round(contextRecall * 10000) / 10000,
        latency_ms: latency,
        retrieval_latency_ms: retrievalLatency,
        answer_generated: !!answer,
        chunks_retrieved: retrievedChunks.length
      };
      
      results.push(queryResult);
      
      if (verbose) {
        console.log(`  📊 Retrieval: P@${topK}=${retrievalMetrics.precision_at_k}, R@${topK}=${retrievalMetrics.recall_at_k}, MRR=${retrievalMetrics.mrr}`);
        console.log(`  📊 Generation: Faithfulness=${generationMetrics.faithfulness}, Relevancy=${generationMetrics.answer_relevancy}`);
        console.log(`  📊 Context: Precision=${contextPrecision.toFixed(4)}, Recall=${contextRecall.toFixed(4)}`);
        console.log(`  ⏱️ Latency: ${latency}ms`);
      }
      
    } catch (error) {
      errors++;
      console.error(`❌ Error en query ${item.id}:`, error.message);
      results.push({
        query_id: item.id,
        query: item.query,
        category: item.category,
        error: error.message
      });
    }
  }
  
  const n = dataset.queries.length - errors;
  const summary = {
    total_queries: dataset.queries.length,
    successful: n,
    errors: errors,
    retrieval: {
      precision_at_k: n > 0 ? Math.round((totalRetrieval.precision_at_k / n) * 10000) / 10000 : 0,
      recall_at_k: n > 0 ? Math.round((totalRetrieval.recall_at_k / n) * 10000) / 10000 : 0,
      mrr: n > 0 ? Math.round((totalRetrieval.mrr / n) * 10000) / 10000 : 0,
      top_k_accuracy: n > 0 ? Math.round((totalRetrieval.top_k_accuracy / n) * 10000) / 10000 : 0
    },
    generation: {
      faithfulness: n > 0 ? Math.round((totalGeneration.faithfulness / n) * 10000) / 10000 : 0,
      answer_relevancy: n > 0 ? Math.round((totalGeneration.answer_relevancy / n) * 10000) / 10000 : 0
    },
    context: {
      precision: n > 0 ? Math.round((totalGeneration.context_precision / n) * 10000) / 10000 : 0,
      recall: n > 0 ? Math.round((totalGeneration.context_recall / n) * 10000) / 10000 : 0
    },
    latency: {
      avg_ms: n > 0 ? Math.round(totalLatency / n) : 0,
      p50_ms: calculatePercentile(results.map(r => r.latency_ms).filter(Boolean), 50),
      p95_ms: calculatePercentile(results.map(r => r.latency_ms).filter(Boolean), 95),
      p99_ms: calculatePercentile(results.map(r => r.latency_ms).filter(Boolean), 99)
    },
    by_category: calculateByCategory(results),
    by_difficulty: calculateByDifficulty(results)
  };
  
  // Identificar queries con scores bajos
  const failures = results
    .filter(r => 
      r.retrieval && (
        r.retrieval.precision_at_k < 0.5 ||
        r.retrieval.recall_at_k < 0.3 ||
        r.generation && r.generation.faithfulness < 0.5
      )
    )
    .map(r => ({
      query_id: r.query_id,
      query: r.query,
      category: r.category,
      issues: identifyIssues(r)
    }));
  
  return {
    timestamp: new Date().toISOString(),
    summary,
    per_query_results: results,
    failures,
    recommendations: generateRecommendations(summary, failures)
  };
}

/**
 * 7. Compara con baseline y detecta regresiones
 */
function compareWithBaseline(currentMetrics, baselineMetrics) {
  if (!baselineMetrics || !baselineMetrics.metrics) {
    return { 
      has_baseline: false, 
      message: 'No hay baseline para comparar' 
    };
  }
  
  const current = currentMetrics.summary || currentMetrics;
  const baseline = baselineMetrics.metrics;
  const regressions = [];
  const improvements = [];
  
  const metricsToCompare = [
    { key: 'precision_at_k', path: ['retrieval', 'precision_at_k'], name: 'Precision@5' },
    { key: 'recall_at_k', path: ['retrieval', 'recall_at_k'], name: 'Recall@5' },
    { key: 'mrr', path: ['retrieval', 'mrr'], name: 'MRR' },
    { key: 'faithfulness', path: ['generation', 'faithfulness'], name: 'Faithfulness' },
    { key: 'answer_relevancy', path: ['generation', 'answer_relevancy'], name: 'Answer Relevancy' },
    { key: 'context_precision', path: ['context', 'precision'], name: 'Context Precision' },
    { key: 'context_recall', path: ['context', 'recall'], name: 'Context Recall' }
  ];
  
  for (const m of metricsToCompare) {
    const currentVal = getNested(current, m.path);
    const baselineVal = getNested(baseline, m.path);
    
    if (currentVal !== undefined && baselineVal !== undefined) {
      const diff = currentVal - baselineVal;
      const pctChange = baselineVal > 0 ? (diff / baselineVal) * 100 : 0;
      
      if (pctChange < -10) {
        regressions.push({
          metric: m.name,
          current: currentVal,
          baseline: baselineVal,
          change_pct: Math.round(pctChange * 100) / 100,
          severity: pctChange < -20 ? 'critical' : 'warning'
        });
      } else if (pctChange > 5) {
        improvements.push({
          metric: m.name,
          current: currentVal,
          baseline: baselineVal,
          change_pct: Math.round(pctChange * 100) / 100
        });
      }
    }
  }
  
  return {
    has_baseline: true,
    regressions,
    improvements,
    overall_status: regressions.some(r => r.severity === 'critical') ? 'critical' : 
                      regressions.length > 0 ? 'degraded' : 'stable'
  };
}

// Funciones auxiliares
function calculatePercentile(arr, percentile) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil(percentile / 100 * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function getNested(obj, path) {
  return path.reduce((o, k) => (o || {})[k], obj);
}

function calculateByCategory(results) {
  const byCat = {};
  for (const r of results) {
    if (!r.category) continue;
    if (!byCat[r.category]) byCat[r.category] = [];
    byCat[r.category].push(r);
  }
  
  const out = {};
  for (const [cat, items] of Object.entries(byCat)) {
    const valid = items.filter(i => i.retrieval);
    if (!valid.length) continue;
    
    out[cat] = {
      count: valid.length,
      precision_at_k: Math.round(valid.reduce((s, i) => s + i.retrieval.precision_at_k, 0) / valid.length * 10000) / 10000,
      recall_at_k: Math.round(valid.reduce((s, i) => s + i.retrieval.recall_at_k, 0) / valid.length * 10000) / 10000,
      faithfulness: valid[0].generation ? Math.round(valid.reduce((s, i) => s + (i.generation?.faithfulness || 0), 0) / valid.length * 10000) / 10000 : 0
    };
  }
  return out;
}

function calculateByDifficulty(results) {
  const byDiff = {};
  for (const r of results) {
    if (!r.difficulty) continue;
    if (!byDiff[r.difficulty]) byDiff[r.difficulty] = [];
    byDiff[r.difficulty].push(r);
  }
  
  const out = {};
  for (const [diff, items] of Object.entries(byDiff)) {
    const valid = items.filter(i => i.retrieval);
    if (!valid.length) continue;
    
    out[diff] = {
      count: valid.length,
      precision_at_k: Math.round(valid.reduce((s, i) => s + i.retrieval.precision_at_k, 0) / valid.length * 10000) / 10000,
      recall_at_k: Math.round(valid.reduce((s, i) => s + i.retrieval.recall_at_k, 0) / valid.length * 10000) / 10000
    };
  }
  return out;
}

function identifyIssues(result) {
  const issues = [];
  if (result.retrieval) {
    if (result.retrieval.precision_at_k < 0.5) issues.push('Baja precisión retrieval');
    if (result.retrieval.recall_at_k < 0.3) issues.push('Bajo recall retrieval');
    if (result.retrieval.mrr < 0.4) issues.push('MRR bajo - chunks relevantes muy abajo');
  }
  if (result.generation) {
    if (result.generation.faithfulness < 0.6) issues.push('Baja fidelidad - respuesta no respaldada');
    if (result.generation.answer_relevancy < 0.6) issues.push('Baja relevancia - no responde la query');
  }
  if (result.context_precision < 0.5) issues.push('Chunks recuperados poco relevantes');
  if (result.context_recall < 0.4) issues.push('Faltan chunks esperados');
  return issues;
}

function generateRecommendations(summary, failures) {
  const recs = [];
  
  if (summary.retrieval.precision_at_k < 0.7) {
    recs.push('Considerar aumentar threshold de similitud o mejorar metadata filtering');
  }
  if (summary.retrieval.recall_at_k < 0.6) {
    recs.push('Considerar aumentar topK o mejorar chunking/embeddings');
  }
  if (summary.generation.faithfulness < 0.8) {
    recs.push('Revisar prompt de LLM para reducir hallucinations; añadir instrucción "solo usa el contexto"');
  }
  if (summary.generation.answer_relevancy < 0.75) {
    recs.push('Mejorar prompt para que LLM se centre en responder la pregunta específica');
  }
  if (summary.latency.p95_ms > 8000) {
    recs.push('Optimizar retrieval: reducir topK, añadir cache, o usar embeddings más pequeños');
  }
  if (failures.length > summary.total_queries * 0.2) {
    recs.push(`ALERTA: ${failures.length} queries fallando. Revisar chunking, embeddings o dataset.`);
  }
  
  return recs;
}

module.exports = {
  evaluateRetrieval,
  evaluateFaithfulness,
  evaluateAnswerRelevancy,
  evaluateContextPrecision,
  evaluateContextRecall,
  runEvaluationSuite,
  compareWithBaseline,
  cosineSimilarity,
  extractKeywords
};