#!/usr/bin/env node
/**
 * backend/scripts/evaluateRag.js
 * Script ejecutable para evaluación automatizada del RAG
 * Uso: node scripts/evaluateRag.js [options]
 */

const fs = require('fs');
const path = require('path');

// Cargar dependencias
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { runEvaluationSuite, compareWithBaseline } = require('../src/services/ragEvaluator');
const { checkQualityGates, generateQualityGatesReport } = require('../src/config/qualityGates');

// Configuración por defecto
const DEFAULT_DATASET = path.join(__dirname, '..', 'src', 'data', 'eval', 'evaluation_dataset.json');
const DEFAULT_BASELINE = path.join(__dirname, '..', 'src', 'data', 'eval', 'baseline_metrics.json');
const DEFAULT_OUTPUT = path.join(__dirname, '..', 'src', 'data', 'eval', `evaluation_report_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dataset: DEFAULT_DATASET,
    baseline: DEFAULT_BASELINE,
    output: DEFAULT_OUTPUT,
    failOnRegression: false,
    verbose: false,
    topK: 5,
    generateAnswers: true
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dataset' && i + 1 < args.length) {
      options.dataset = path.resolve(args[++i]);
    } else if (arg === '--baseline' && i + 1 < args.length) {
      options.baseline = path.resolve(args[++i]);
    } else if (arg === '--output' && i + 1 < args.length) {
      options.output = path.resolve(args[++i]);
    } else if (arg === '--fail-on-regression') {
      options.failOnRegression = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--topK' && i + 1 < args.length) {
      options.topK = parseInt(args[++i], 10);
    } else if (arg === '--no-answers') {
      options.generateAnswers = false;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  
  return options;
}

function printHelp() {
  console.log(`
🧪 GlowApp RAG Evaluation Script

Uso: node scripts/evaluateRag.js [opciones]

Opciones:
  --dataset <path>           Archivo JSON del dataset de evaluación (default: src/data/eval/evaluation_dataset.json)
  --baseline <path>          Archivo JSON de baseline para comparación (default: src/data/eval/baseline_metrics.json)
  --output <path>            Archivo de salida para el reporte (default: src/data/eval/evaluation_report_<timestamp>.json)
  --fail-on-regression       Exit code 1 si hay regresión detectada
  --verbose                  Mostrar detalle por query
  --topK <number>            Número de chunks a recuperar (default: 5)
  --no-answers               No generar respuestas (solo métricas de retrieval)
  --help, -h                 Mostrar esta ayuda

Ejemplos:
  node scripts/evaluateRag.js --verbose
  node scripts/evaluateRag.js --fail-on-regression --baseline src/data/eval/baseline_metrics.json
  node scripts/evaluateRag.js --dataset custom_dataset.json --output report.json
`);
}

async function main() {
  const options = parseArgs();
  
  console.log('🧪 GlowApp RAG Evaluation Suite');
  console.log('='.repeat(50));
  console.log(`Dataset: ${options.dataset}`);
  console.log(`Baseline: ${options.baseline}`);
  console.log(`Output: ${options.output}`);
  console.log(`Top-K: ${options.topK}`);
  console.log(`Generate Answers: ${options.generateAnswers}`);
  console.log(`Fail on Regression: ${options.failOnRegression}`);
  console.log('');
  
  // Verificar que existe el dataset
  if (!fs.existsSync(options.dataset)) {
    console.error(`❌ Dataset no encontrado: ${options.dataset}`);
    process.exit(1);
  }
  
  // Cargar dataset
  let dataset;
  try {
    dataset = JSON.parse(fs.readFileSync(options.dataset, 'utf-8'));
    console.log(`✅ Dataset cargado: ${dataset.queries.length} queries`);
  } catch (e) {
    console.error(`❌ Error leyendo dataset: ${e.message}`);
    process.exit(1);
  }
  
  // Cargar baseline si existe
  let baseline = null;
  if (fs.existsSync(options.baseline)) {
    try {
      baseline = JSON.parse(fs.readFileSync(options.baseline, 'utf-8'));
      console.log(`✅ Baseline cargado: ${baseline.timestamp}`);
    } catch (e) {
      console.warn(`⚠️ Error leyendo baseline: ${e.message}`);
    }
  } else {
    console.log('ℹ️  No hay baseline, se creará uno nuevo con esta evaluación');
  }
  
  // Ejecutar evaluación
  console.log('\n🚀 Ejecutando evaluación...\n');
  
  const startTime = Date.now();
  
  try {
    const report = await runEvaluationSuite(dataset, {
      topK: options.topK,
      generateAnswers: options.generateAnswers,
      verbose: options.verbose
    });
    
    // Comparar con baseline si existe
    if (baseline) {
      console.log('\n📊 Comparando con baseline...');
      const comparison = compareWithBaseline(report, baseline);
      report.comparison = comparison;
      
      if (comparison.has_baseline) {
        console.log(`Status: ${comparison.overall_status}`);
        if (comparison.regressions.length > 0) {
          console.log(`⚠️  ${comparison.regressions.length} regresión(es) detectada(s)`);
          for (const r of comparison.regressions) {
            console.log(`  - ${r.metric}: ${r.current.toFixed(4)} vs ${r.baseline.toFixed(4)} (${r.change_pct.toFixed(1)}%) [${r.severity}]`);
          }
        }
        if (comparison.improvements.length > 0) {
          console.log(`✅ ${comparison.improvements.length} mejora(s) detectada(s)`);
        }
      }
    }
    
    // Verificar quality gates
    console.log('\n🔍 Verificando Quality Gates...');
    const gateResult = checkQualityGates(report);
    report.quality_gates = gateResult;
    
    console.log(generateQualityGatesReport(gateResult));
    
    // Guardar reporte
    const outputDir = path.dirname(options.output);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(options.output, JSON.stringify(report, null, 2));
    console.log(`\n💾 Reporte guardado en: ${options.output}`);
    
    // Actualizar baseline si no existe o si es mejor
    if (!baseline || (gateResult.passed && report.summary.retrieval.precision_at_k > (baseline.metrics?.retrieval?.precision_at_5 || 0))) {
      const newBaseline = {
        timestamp: new Date().toISOString(),
        version: dataset.version || '1.0',
        metrics: {
          retrieval: report.summary.retrieval,
          generation: report.summary.generation,
          latency: report.summary.latency
        },
        quality_gates_passed: gateResult.passed
      };
      fs.writeFileSync(options.baseline, JSON.stringify(newBaseline, null, 2));
      console.log(`📝 Baseline actualizado en: ${options.baseline}`);
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`\n⏱️  Tiempo total: ${totalTime}ms`);
    console.log(`✅ Evaluación completada: ${report.summary.successful}/${report.summary.total_queries} queries exitosas`);
    
    // Exit code
    if (options.failOnRegression && gateResult.failures.length > 0) {
      console.log('\n🚫 Fallando por regresión (--fail-on-regression)');
      process.exit(1);
    }
    
    if (!gateResult.passed) {
      console.log('\n⚠️  Quality gates fallaron (pero --fail-on-regression no activado)');
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Error durante evaluación:', error);
    process.exit(1);
  }
}

main();