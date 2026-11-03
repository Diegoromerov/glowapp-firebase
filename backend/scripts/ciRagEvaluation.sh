#!/bin/bash
# backend/scripts/ciRagEvaluation.sh
# Script para ejecutar evaluación RAG en CI/CD (GitHub Actions, Railway, etc.)
# Exit code: 0 = éxito, 1 = fallo en quality gates o regresión

set -e  # Salir en cualquier error

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Help early exit
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  echo "CI RAG Evaluation Script"
  echo "Usage: ciRagEvaluation.sh [options]"
  echo "Options:"
  echo "  --help, -h     Show this help"
  echo "  --fail-on-regression  Exit with code 1 if quality gates fail"
  exit 0
fi

# Configuración
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EVAL_SCRIPT="$PROJECT_ROOT/scripts/evaluateRag.js"
DATASET="$PROJECT_ROOT/src/data/eval/evaluation_dataset.json"
BASELINE="$PROJECT_ROOT/src/data/eval/baseline_metrics.json"
OUTPUT_DIR="$PROJECT_ROOT/src/data/eval"

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     GlowApp RAG Evaluation - CI/CD Pipeline                  ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Función para log con timestamp
log() {
  echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Función de error
error() {
  echo -e "${RED}[ERROR]${NC} $1" >&2
}

# Función de éxito
success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Función de advertencia
warning() {
  echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Verificar que existe el script de evaluación
if [ ! -f "$EVAL_SCRIPT" ]; then
  error "Script de evaluación no encontrado: $EVAL_SCRIPT"
  exit 1
fi

# Verificar que existe el dataset
if [ ! -f "$DATASET" ]; then
  error "Dataset no encontrado: $DATASET"
  exit 1
fi

# Verificar Node.js
if ! command -v node &> /dev/null; then
  error "Node.js no está instalado"
  exit 1
fi

NODE_VERSION=$(node --version)
log "Node.js version: $NODE_VERSION"

# Verificar dependencias
log "Verificando dependencias..."
cd "$PROJECT_ROOT"
if [ ! -d "node_modules" ]; then
  warning "node_modules no encontrado, instalando dependencias..."
  npm ci --production=false
fi

# Ejecutar migraciones si es necesario
log "Ejecutando migraciones de base de datos..."
if command -v npx &> /dev/null; then
  npx knex migrate:latest 2>/dev/null || warning "Migraciones fallaron o ya aplicadas"
fi

# Crear directorio de salida si no existe
mkdir -p "$OUTPUT_DIR"

# Timestamp para el reporte
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
REPORT_FILE="$OUTPUT_DIR/ci_evaluation_report_${TIMESTAMP}.json"

log "Iniciando evaluación RAG..."
log "Dataset: $DATASET"
log "Baseline: $BASELINE"
log "Reporte: $REPORT_FILE"

# Ejecutar evaluación
EVAL_START=$(date +%s)

if node "$EVAL_SCRIPT" \
  --dataset "$DATASET" \
  --baseline "$BASELINE" \
  --output "$REPORT_FILE" \
  --fail-on-regression \
  --verbose; then
  
  EVAL_END=$(date +%s)
  DURATION=$((EVAL_END - EVAL_START))
  
  success "Evaluación completada en ${DURATION}s"
  log "Reporte guardado en: $REPORT_FILE"
  
  # Verificar quality gates en el reporte
  if command -v jq &> /dev/null; then
    GATE_PASSED=$(jq -r '.quality_gates.passed' "$REPORT_FILE" 2>/dev/null || echo "false")
    FAILURES=$(jq -r '.quality_gates.failures | length' "$REPORT_FILE" 2>/dev/null || echo "0")
    
    if [ "$GATE_PASSED" = "true" ]; then
      success "✅ Todos los Quality Gates PASARON"
    else
      error "❌ $FAILURES Quality Gate(s) FALLARON"
      jq -r '.quality_gates.failures[] | "  - \(.metric): \(.actual) (esperado \(.expected))"' "$REPORT_FILE" 2>/dev/null
      exit 1
    fi
    
    # Mostrar resumen
    TOTAL=$(jq -r '.summary.total_queries' "$REPORT_FILE" 2>/dev/null || echo "0")
    SUCCESSFUL=$(jq -r '.summary.successful' "$REPORT_FILE" 2>/dev/null || echo "0")
    PRECISION=$(jq -r '.summary.retrieval.precision_at_k' "$REPORT_FILE" 2>/dev/null || echo "0")
    RECALL=$(jq -r '.summary.retrieval.recall_at_k' "$REPORT_FILE" 2>/dev/null || echo "0")
    FAITHFULNESS=$(jq -r '.summary.generation.faithfulness' "$REPORT_FILE" 2>/dev/null || echo "0")
    RELEVANCY=$(jq -r '.summary.generation.answer_relevancy' "$REPORT_FILE" 2>/dev/null || echo "0")
    
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}                    RESUMEN DE EVALUACIÓN                     ${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "Total Queries:        $TOTAL"
    echo -e "Exitosas:             $SUCCESSFUL"
    echo -e "Precision@5:          $PRECISION"
    echo -e "Recall@5:             $RECALL"
    echo -e "Faithfulness:         $FAITHFULNESS"
    echo -e "Answer Relevancy:     $RELEVANCY"
    echo -e "Duración:             ${DURATION}s"
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
  else
    warning "jq no instalado, no se puede parsear reporte JSON automáticamente"
  fi
  
  exit 0
  
else
  EVAL_END=$(date +%s)
  DURATION=$((EVAL_END - EVAL_START))
  
  error "Evaluación FALLÓ después de ${DURATION}s"
  log "Revisar reporte en: $REPORT_FILE"
  exit 1
fi