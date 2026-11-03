#!/usr/bin/env python3
"""Build r6c12_finetuning_feasibility.json programmatically (avoids escaping errors)."""
import json, os

data = {
    "cycle": "R6-C12",
    "status": "FEASIBILITY-BLOCKED",
    "official_model": "nv-embedqa-e5-v5",
    "production_model_change": False,
    "feasible_adaptation_paths": [
        {
            "path": "PROJECTION_HEAD_POST_NVIDIA",
            "description": "Capa de proyección (lineal/MLP) entrenada sobre embeddings de salida NVIDIA e5-v5. NVIDIA permanece como generador oficial; la proyección re-mapea el espacio semántico.",
            "nvidia_untouched": True,
            "requires_weights_access": False,
            "production_impact": "Re-embedding experimental del corpus proyectado fuera de BD productiva; requiere aprobación del Director para runtime.",
            "dataset_requirement": "Training data auto-generado del corpus (títulos como queries) + hard negatives intra-categoría; GOLD-V5 solo como TEST.",
            "feasibility_rating": "TECHNICALLY_POSSIBLE_BUT_UNDERDATAED",
            "risk": "15 queries GOLD no bastan para entrenar sin overfit; data sintética del corpus puede no capturar el gap semántico de conceptos especializados (Tyndall, SERS, simetría muscular)."
        },
        {
            "path": "OPEN_MODEL_DERIVATIVE_RESEARCH_BASELINE",
            "description": "Entrenar fine-tune/adaptación de un modelo open con arquitectura compatible (intfloat/multilingual-e5-large, NV-Embed-v2) EXCLUSIVAMENTE como RESEARCH BASELINE experimental, fuera de producción. NO como reemplazo de NVIDIA.",
            "nvidia_untouched": True,
            "requires_weights_access": False,
            "production_impact": "0 — solo artefactos experimentales locales",
            "dataset_requirement": "Mismo corpus; requiere infraestructura ML no presente (torch/transformers no instalados en backend)",
            "feasibility_rating": "TECHNICALLY_POSSIBLE_INFRA_BLOCKED",
            "risk": "Sin infra ML en repo; instalación local experimental permitida pero coste alto; no resuelve producción."
        },
        {
            "path": "SPECIALIZED_RERANKER_COMPLEMENT",
            "description": "Cross-encoder bilingüe de reranking entrenado sobre pares del dominio. Complementa retrieval NVIDIA sin tocar embeddings.",
            "nvidia_untouched": True,
            "requires_weights_access": False,
            "production_impact": "Solo en fase de selección final de candidatos",
            "dataset_requirement": "Pares query-doc anotados del dominio — GOLD-V5 (58 pares) insuficiente sin minería adicional",
            "feasibility_rating": "TECHNICALLY_POSSIBLE_BUT_UNDERDATAED",
            "risk": "R6-C11 demostró que 8/13 misses ni siquiera entran al candidate pool → reranker no los rescata (criterio 17 del prompt R6-C11)."
        }
    ],
    "blocked_paths": [
        {
            "path": "FINE_TUNING_DIRECT_NVIDIA_E5V5",
            "reason": "nv-embedqa-e5-v5 es modelo NVIDIA NIM gestionado: NO existe en HuggingFace (0 resultados de búsqueda), NO hay pesos públicos descargables, la API /v1/embeddings solo expone inferencia. No se puede fine-tunear directamente.",
            "evidence": "huggingface.co/api/models?search=nv-embedqa-e5 devuelve 0 resultados; integrate.api.nvidia.com/v1/models/nvidia/nv-embedqa-e5-v5 devuelve solo id/object/owned_by sin metadata de pesos"
        },
        {
            "path": "LORA_ADAPTER_ON_E5V5",
            "reason": "LoRA requiere acceso a los pesos del modelo base. NIM no los expone. Sin base model local, no hay adapter posible.",
            "evidence": "Mismo acceso API que fine-tuning directo"
        },
        {
            "path": "DISTILLATION_FROM_NVIDIA",
            "reason": "Requiere un corpus grande de (query, doc) del dominio para entrenar el estudiante. Disponible: 15 queries GOLD con 58 positivos — insuficiente. Sin dataset de entrenamiento, la destilación no es viable.",
            "evidence": "GOLD-V5: 15 SUPPORTED / 58 positive pairs / 0 negativos explícitos"
        },
        {
            "path": "SUPERVISED_CONTRASTIVE_TRAINING_WITH_GOLD_V5",
            "reason": "GOLD-V5 tiene 15 queries supported y 58 pares positivos; 0 negativos explícitos; 3 chunks compartidos entre queries (leakage). No permite separación train/dev/test estadísticamente sólida. GOLD-V5 es un dataset de EVALUACIÓN, no de entrenamiento.",
            "evidence": "54 chunks únicos, 3 compartidos (cejas_001/005/007/008); queries v1/v2 usan chunk_ids legacy (chunk_skincare_*) que NO existen en el corpus canónico (0/80 match) → no aportan pares válidos"
        },
        {
            "path": "TRAINING_DATASET_FROM_LEGACY_QUERIES",
            "reason": "12 queries v1 no presentes en v5 apuntan a chunk_ids viejos (chunk_skincare_*) que no existen en corpus canónico ni en BD (0/80). No se pueden construir pares positivos válidos.",
            "evidence": "evaluation_dataset.json 30 queries, expected_chunks con formato chunk_skincare_*; matching contra corpus_canonico = 0/80"
        }
    ],
    "vector_miss_diagnosis": [
        {"query": "cejas_004", "chunk": "visajismo-cejas-microblading-musculatura-orbicular-009", "exists_in_db": True, "has_embedding": True, "vector_rank": None, "fts_rank": None, "content_len": 1269, "semantic_match": "ALTA (dinámica muscular orbicular - simetría)", "diagnosis": "F_EMBEDDING_REPRESENTATION", "evidence": "contenido altamente relevante al query; fuera de top-200 vectorial; no recuperado por FTS"},
        {"query": "cejas_004", "chunk": "visajismo-microblading-arquitectura-muscular-008", "exists_in_db": True, "has_embedding": True, "vector_rank": None, "fts_rank": None, "content_len": 1217, "semantic_match": "ALTA (arquitectura muscular - asimetría)", "diagnosis": "F_EMBEDDING_REPRESENTATION", "evidence": "contenido directamente sobre simetría del diseño; fuera de top-200"},
        {"query": "cejas_004", "chunk": "microblading-envejecimiento-009", "exists_in_db": True, "has_embedding": True, "vector_rank": None, "fts_rank": None, "content_len": 1113, "semantic_match": "MEDIA-ALTA (ptosis/envejecimiento afecta simetría)", "diagnosis": "F_EMBEDDING_REPRESENTATION", "evidence": "concepto relacionado, no lexical; fuera de top-200"},
        {"query": "cejas_004", "chunk": "microblading-psicologia-007", "exists_in_db": True, "has_embedding": True, "vector_rank": None, "fts_rank": None, "content_len": 1138, "semantic_match": "MEDIA (percepción subjetiva de simetría)", "diagnosis": "F_EMBEDDING_REPRESENTATION", "evidence": "sesgos cognitivos en evaluación de simetría; gap semántico"},
        {"query": "cejas_005", "chunk": "visajismo-cejas-microblading-fotoproteccion-avanzada-007", "exists_in_db": True, "has_embedding": True, "vector_rank": None, "fts_rank": None, "content_len": 1158, "semantic_match": "MEDIA (cuidados post - fotoprotección)", "diagnosis": "F_EMBEDDING_REPRESENTATION", "evidence": "concepto de cuidados post-microblading, terminología específica"},
        {"query": "cejas_005", "chunk": "impacto-variabilidad-glucemica-cicatrizacion-001", "exists_in_db": True, "has_embedding": True, "vector_rank": None, "fts_rank": None, "content_len": 1275, "semantic_match": "MEDIA (cicatrización post-microblading)", "diagnosis": "F_EMBEDDING_REPRESENTATION", "evidence": "concepto fisiológico especializado"},
        {"query": "cejas_008", "chunk": "guias_unas-electrolisis-y-matriz-001", "exists_in_db": True, "has_embedding": True, "vector_rank": None, "fts_rank": None, "content_len": 1164, "semantic_match": "MEDIA (electrólisis - remoción, cross-domain uñas)", "diagnosis": "F_EMBEDDING_REPRESENTATION", "evidence": "chunk de categoría guias_unas recuperable para remoción de microblading — gap cross-domain"},
        {"query": "cejas_008", "chunk": "terapia-laser-erbio-glass-002", "exists_in_db": True, "has_embedding": True, "vector_rank": None, "fts_rank": None, "content_len": 1185, "semantic_match": "ALTA (láser para remoción de tatuajes/pigmento)", "diagnosis": "F_EMBEDDING_REPRESENTATION", "evidence": "láser erbio-glass 1550nm directamente relevante a remoción; cross-domain tratamientos_esteticos"},
        {"query": "cejas_008", "chunk": "visajismo-cejas-microblading-efecto-tyndall-003", "exists_in_db": True, "has_embedding": True, "vector_rank": None, "fts_rank": None, "content_len": 1259, "semantic_match": "ALTA (efecto Tyndall en microblading mal ejecutado)", "diagnosis": "F_EMBEDDING_REPRESENTATION", "evidence": "fenómeno físico-químico especializado; término técnico Tyndall"},
        {"query": "cabello_002", "chunk": "diagnostico_capilar-1786404223187-3-83fda2b9-espectroscopia-de-raman-de-superficie-sers-para-la-deteccion", "exists_in_db": True, "has_embedding": True, "vector_rank": None, "fts_rank": None, "content_len": 1092, "semantic_match": "MEDIA-ALTA (detección daño proteico capilar - cabello dañado por decoloración)", "diagnosis": "F_EMBEDDING_REPRESENTATION", "evidence": "SERS detecta proteínas de estrés del tallo; concepto científico ultraespecializado"},
        {"query": "cabello_006", "chunk": "estabilidad-ph-cuero-cabelludo-004", "exists_in_db": True, "has_embedding": True, "vector_rank": None, "fts_rank": None, "content_len": 1187, "semantic_match": "MEDIA (homeostasis cuero cabelludo - champú cuero cabelludo graso)", "diagnosis": "F_EMBEDDING_REPRESENTATION", "evidence": "concepto fisiológico de homeostasis"},
        {"query": "skincare_003", "chunk": "ingredientes_activos_contraindicaciones-1786387012476-3-4ef2629c-acido-capriloil-salicilico-lha-y-la-descamacion-acumulativa-", "exists_in_db": True, "has_embedding": True, "vector_rank": None, "fts_rank": None, "content_len": 1132, "semantic_match": "MEDIA (LHA para piel grasa)", "diagnosis": "F_EMBEDDING_REPRESENTATION", "evidence": "ingrediente activo LHA relevante a rutina piel grasa"},
        {"query": "skincare_007", "chunk": "skincare-rutinas-autofagia-peptidos-003", "exists_in_db": True, "has_embedding": True, "vector_rank": None, "fts_rank": None, "content_len": 1177, "semantic_match": "MEDIA (autofagia/péptidos - anti-edad nocturna)", "diagnosis": "F_EMBEDDING_REPRESENTATION", "evidence": "mecanismo celular de autofagia en rutina anti-edad"}
    ],
    "classification_summary": {
        "A_corpus_inexistente": 0,
        "B_corpus_semantic_miss": 13,
        "C_corpus_lexical_miss": 0,
        "D_ranking_problem": 0,
        "E_query_representation": 0,
        "F_embedding_representation": 13,
        "G_ambiguous": 0
    },
    "training_dataset_available": {
        "gold_v5": {"queries_supported": 15, "positive_pairs": 58, "unique_chunks": 54, "explicit_negatives": 0, "shared_chunks_leakage": 3, "suitable_for_training": False, "role": "EVALUATION_ONLY"},
        "legacy_queries_v1_v2": {"queries": "30+30", "usable_pairs": 0, "reason": "chunk_ids legacy (chunk_skincare_*) no existen en corpus canónico (0/80 match)"},
        "corpus_for_mining": {"chunks_db": 5663, "chunks_canonical": 5619, "categories": 24, "positive_mining_viable": False, "negative_mining_viable": True, "hard_negative_strategy": "chunks de misma categoría no-gold; top-K por similitud", "synthetic_query_generation": "títulos de chunks como queries (viable para pretraining de proyección, no para validar gap semántico)"},
        "verdict": "INSUFICIENTE para entrenamiento supervisado con GOLD-V5 como train+eval sin leakage. Suficiente solo para minería de negativos y experimentos auto-supervisados de proyección con GOLD-V5 como TEST puro."
    },
    "recommended_experiment": {
        "id": "R6-C12-A_DOMAIN_ADAPTATION_PROTOTYPE",
        "status": "DESIGNED_NOT_EXECUTED",
        "architecture": {
            "type": "PROJECTION_HEAD_ON_NVIDIA_EMBEDDINGS",
            "detail": "Entrenar proyección lineal/MLP sobre embeddings de salida NVIDIA e5-v5 (1024d) usando loss contrastiva/triplet. NVIDIA NIM intacto (solo inferencia). Embeddings del corpus obtenidos read-only desde BD local."
        },
        "dataset": {
            "train": "Pares auto-generados del corpus: (title_chunk como query, chunk como positive) + hard negatives intra-categoría. ~5000+ pares sintéticos.",
            "validation": "Subset de GOLD-V5 separado por categoría (p.ej. 3 queries cejas) — SOLO para monitoreo, no para tuning de hiperparámetros",
            "test": "GOLD-V5 completo (15 queries, 58 GOLD) — test puro, nunca tocado en train",
            "leakage_control": "Train con data sintética del corpus (sin GOLD); GOLD-V5 solo eval. Los 3 chunks compartidos entre queries GOLD permanecen en test."
        },
        "training_objective": "Contrastive (InfoNCE): similarity(query_emb_NVIDIA->proj, pos_emb->proj) > similarity(query_emb->proj, hard_neg_emb->proj). Baseline = identidad (sin proyección).",
        "baseline_comparison": {"mrr": 0.7222, "r5": 0.6156, "r10": 0.6545, "r50": 0.8011, "vector_miss": 13, "source": "R6-C11 NVIDIA_BASELINE_CONFIRMED"},
        "metrics": ["MRR", "R@5", "R@10", "R@50", "Query Success", "VECTOR_MISS resolved (>=3/13)", "cabello_002", "cejas_004", "cejas_008"],
        "reproducibility": {"seed": "fijo", "model_version": "nvidia/nv-embedqa-e5-v5 (NIM, inferencia)", "dataset_hash": "SHA-256 del corpus derivado", "hyperparameters": "registrados", "code": "scripts/r6c12*.js + python experimental", "date": "registrada", "hardware": "local", "run_a_equals_b": True},
        "stop_conditions": [
            "NVIDIA NIM sin acceso a pesos (CONFIRMADO)",
            "dataset insuficiente sin leakage (GOLD-V5 = 15 queries eval-only, CONFIRMADO)",
            "infra ML ausente (torch/transformers no instalados)",
            "proyección entrenada sobre data sintética no garantiza capturar gap semántico"
        ]
    },
    "success_criteria": {
        "mrr_ge_baseline": True,
        "r5_ge_baseline": True,
        "r10_ge_baseline": True,
        "no_new_critical_misses": True,
        "recover_at_least_3_of_13": True,
        "reproducible_run_a_equals_b": True,
        "ideal": "MRR > 0.7222 AND R@5 > 0.6156 AND VECTOR_MISS >= 3/13"
    },
    "stop_conditions": [
        "NVIDIA NIM no permite acceso a pesos → CONFIRMADO (nv-embedqa-e5-v5 no existe en HF, solo API inferencia)",
        "No existe mecanismo razonable de adaptación directa → CONFIRMADO para fine-tuning/LoRA sobre e5-v5",
        "No existe dataset suficiente → CONFIRMADO (GOLD-V5 15 queries eval-only; legacy v1/v2 inutilizable)",
        "GOLD-V5 no permite separar train/eval → CONFIRMADO (15 queries, 3 chunks compartidos)",
        "Leakage inevitable → PARCIAL (controlable solo con train sintético del corpus + GOLD test puro)",
        "Experimento no reproducible → EVITABLE con seed fijo + registro completo",
        "Adaptación obligaría a reemplazar NVIDIA en producción → NO aplica a projection head (NVIDIA intacto)"
    ],
    "risks": [
        "Projection head entrenada con queries sintéticas (títulos) puede no capturar el gap de conceptos especializados: Tyndall, SERS, simetría muscular, electrólisis — el gap es semántico-cognitivo, no lexical.",
        "Overfit: 58 pares GOLD reales son insuficientes; data sintética puede memorizar estructura de títulos sin generalizar.",
        "GOLD-V5 como test puro es pequeño (15 queries): variación de métricas alta, diferencia de +1 GOLD = ~7% de recovery.",
        "Sin infraestructura ML (torch/transformers), el prototipo requiere instalación local experimental (permitida, fuera de producción).",
        "Si la proyección mejora GOLD pero degrada queries reales no cubiertas por GOLD → regresión no detectada por el benchmark.",
        "Re-embedding proyectado del corpus (5,663 chunks) en producción implicaría modificar embeddings productivos — PROHIBIDO en R6; requeriría ciclo de aprobación del Director."
    ],
    "final_recommendation": "R6-C12 queda como FEASIBILITY-BLOCKED para fine-tuning directo: nv-embedqa-e5-v5 es un modelo NVIDIA NIM gestionado sin pesos accesibles (no existe en HuggingFace; API solo expone inferencia), y GOLD-V5 (15 queries / 58 pares / 0 negativos explícitos) es un dataset de evaluación, no de entrenamiento. La vía técnicamente más segura y la única que mantiene NVIDIA como modelo oficial es PROJECTION_HEAD sobre embeddings de salida NVIDIA, entrenada con data sintética del corpus (títulos→queries + hard negatives intra-categoría) y GOLD-V5 como TEST puro. Esta vía es experimental (fuera de producción), reproducible (seed fija), y no requiere tocar NVIDIA, la BD ni el corpus. El siguiente ciclo (R6-C13) debería decidir entre: (a) ejecutar R6-C12-A prototipo de proyección con infra ML local, o (b) cerrar R6 documentando el techo de representación de e5-v5 para conceptos especializados como limitación conocida del modelo oficial.",
    "production_guards": {
        "env_guard": "PASS",
        "read_only": True,
        "no_railway": True,
        "no_production_modification": True,
        "nvidia_unchanged": True,
        "embeddings_untouched": True,
        "hnsw_untouched": True,
        "bd_writes": 0
    }
}

out = r"C:\beauty-app\backend\src\data\eval\r6c12_finetuning_feasibility.json"
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print("WROTE", out, os.path.getsize(out), "bytes")
