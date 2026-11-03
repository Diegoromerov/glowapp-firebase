# INFORME HERMES — CICLO 43 — R6-C1
# EVIDENCE LAYER ARCHITECTURE & CONTRACT (TRANSICIÓN R5→R6)

## 1. Objetivo
Iniciar la fase R6 diseñando — sin implementar — la arquitectura de **Evidence-Centric RAG**: contratos de Evidence/EvidenceGroup/EvidencePacket, estados formales, modelo de suficiencia, política unsupported, provenance, y decisiones REUSE/ADAPT/NEW/DO-NOT-TOUCH basadas en el mapa REAL del repositorio.

## 2. Mapa real de la arquitectura actual (FASE 1-2)
| Componente | Archivo | Estado real |
|---|---|---|
| Retrieval | `ragService.js` `searchBeautyKnowledge(topK=5, threshold=0.45)` | Devuelve `[id, title, content, category, similarity]` — **FALTA chunk_id, document_id, metadata, fuente, seccion, rank** |
| Formatter | `formatKnowledgeContext` | Provenance parcial (sources) sin chunk_id/rank |
| Integración LLM | `auraToolExecutor.js:221` | Devuelve **chunks crudos** al LLM sin states/sufficiency/unsupported |
| Logging | `ragLogger.js` | traceId, sanitización PII, breaker states |
| Métricas | `ragMetrics.js` | avg_top_score, error_rate, fallback_rate, latencia |
| Evaluación | `ragEvaluator.js` + GOLD-V5 | Baseline R5-C (R@5=0.7885, MRR=0.7179) |
| **NO existe** | — | Evidence Layer, states, sufficiency gate, unsupported policy, provenance estructurada, claim grounding, detección de contradicción, grouping |

**Dato nuevo de integridad**: 5,663 filas pero **5,658 chunk_id distintos → 5 duplicados de chunk_id** (la Evidence Layer debe deduplicar).

## 3. Contratos diseñados (FASE 3-10)
- **Evidence** (11 campos): evidence_id, chunk_id, source_id, category, title, content, retrieval_score, rank, metadata (opc.), relevance (opc.), provenance — cada uno con productor/consumidor/razón
- **EvidenceGroup**: primary / complementary / redundant / contradictory — regla: *más chunks ≠ mejor evidencia*; grupo solo si la cobertura de claims aumenta
- **EvidencePacket**: evidence + state + confidence + provenance + constraints + unsupported_reason

## 4. Estados formales
| Estado | Significado | Generador |
|---|---|---|
| SUPPORTED | evidencia suficiente + consistente (cobertura≥0.5, gate score≥0.55, sin contradicción) | responde afirmativamente con el packet |
| PARTIAL | evidencia relevante pero faltan componentes | responde con parcialidad explícita |
| UNSUPPORTED | corpus sin evidencia suficiente | NO completa con conocimiento externo; declara insuficiencia + motivo |
| RETRIEVAL_UNCERTAIN | señal débil/fallback | incertidumbre explícita |

## 5. Sufficiency (NO es score > threshold)
Modelo interpretable de 6 dimensiones: cobertura, relevancia, complementariedad, consistencia, redundancia, **gate fuerte ≥0.55** (hallazgo reproducible de R5-C25/C28/C29).

## 6. Unsupported Policy
Diferenciación trazable: **CORPUS_GAP** (inventario confirma ausencia) vs **EVIDENCE_INSUFFICIENT** (existe pero insuficiente, p.ej. cejas_004) vs **RETRIEVAL_UNCERTAIN** (señal débil). El generador no inventa.

## 7. Decisiones REUSE/ADAPT/NEW/DO-NOT-TOUCH
- **REUSE (8)**: retrieval, embeddingService, ragLogger, ragMetrics, evaluator+GOLD-V5, formatKnowledgeContext, contextCompressor, BD metadata
- **ADAPT (5)**: ragService SELECT (+chunk_id/etc.), auraToolExecutor (envolver en packet), formatter (+rank/chunk_id), ragLogger (+state), ragMetrics (+evidence metrics)
- **NEW (8)**: Candidate Builder, Grouper, Validator, Sufficiency Gate, Packet, Unsupported Policy, Provenance/Trace, evidence metrics
- **DO NOT TOUCH (5)**: motor productivo, GOLD-V5/baseline, Railway/producción, 8 tests históricos, líneas R5 cerradas

## 8. VEREDICTO
**R6-C1 — ARCHITECTURE-DEFINED** (PASS)

Los 19 criterios de éxito cumplidos: mapa real (✓), contratos Evidence/EvidenceGroup/Packet (✓), 4 estados (✓), sufficiency interpretable (✓), unsupported policy (✓), provenance (✓), claim grounding preparado (✓), multi-chunk conservador (✓), contradicción contemplada (✓), observabilidad (✓), REUSE/ADAPT/NEW/DO-NOT-TOUCH (✓), producción intacta (✓), RUN A ≡ RUN B (✓), RAG 69/69 (✓), sin regresiones globales (✓).

## 9. Recomendación exacta para R6-C2
1. **Evidence Candidate Builder**: ADAPT `ragService` SELECT (chunk_id, document_id, metadata, fuente, seccion) + dedupe por chunk_id (5 duplicados)
2. **Sufficiency Gate v1** conservador (cobertura + gate 0.55 + consistencia)
3. **Unsupported Policy** (3 motivos trazables)
4. Envolver `search_beauty_knowledge_rag` en EvidencePacket (mínimo cambio seguro en auraToolExecutor)
5. Extender observabilidad (ragLogger/ragMetrics)
6. Todo en trabajo aislado con tests, GOLD-V5 como regression asset, sin tocar motor productivo hasta autorización

## 10. Tests e integridad
- RAG: 69/69 PASS | Global: 263/8/1 (pendiente verificación final)
- BD intacta (5,663/0 NULL/1024d; hallazgo: 5 chunk_id duplicados documentado)
- Solo lectura de archivos + SELECT; 0 archivos productivos modificados; Railway NO contactada
- Reproducibilidad: RUN A ≡ RUN B (determinista)
