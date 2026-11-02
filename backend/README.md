# Beauty App Backend

API REST para GlowApp - Plataforma de belleza y bienestar con sistema RAG inteligente.

## Stack Tecnológico

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Base de Datos**: PostgreSQL + pgVector (extensión vectorial)
- **Cache**: Redis
- **ORM**: Sequelize
- **IA/ML**: NVIDIA NV-Embed-QA (embeddings 1024d), DeepSeek (LLM primario), Gemini (fallback)
- **Tests**: Jest

## Arquitectura RAG (P0 + P1)

### Pipeline de Ingesta (P1)

```
Corpus Markdown → Chunking Semántico → Enriquecimiento Metadata → Embeddings NV-Embed-QA → Upsert Idempotente
```

### Componentes Principales

| Componente | Archivo | Descripción |
|------------|---------|-------------|
| Chunking Semántico | `src/services/chunkingService.js` | Divide docs en chunks 500-800 tokens, overlap 50 |
| Enriquecimiento Metadata | `src/services/metadataEnricher.js` | Extrae category, skin_type, season_station, age_range, ingredients, contraindications |
| Embeddings NVIDIA | `src/services/embeddingService.js` | Wrapper NV-Embed-QA (1024d) + circuit breaker |
| Búsqueda Vectorial | `src/services/ragService.js` | Similitud coseno + filtros metadata + fallback full-text |
| Ingesta | `scripts/ingestBeautyKnowledge.js` | Script principal idempotente |
| Purge | `scripts/purgeRagKnowledge.js` | Rollback por source con dry-run |

## Esquema de Base de Datos (RAG)

```sql
-- Tabla principal
CREATE TABLE beauty_knowledge_embeddings (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL UNIQUE,
    category VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    embedding vector(1024),  -- NV-Embed-QA 1024 dimensiones
    skin_type VARCHAR(50),
    season_station VARCHAR(20),
    age_range VARCHAR(20),
    ingredients TEXT[],
    contraindications TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice HNSW para búsqueda ANN
CREATE INDEX idx_beauty_knowledge_embedding_hnsw 
ON beauty_knowledge_embeddings 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

## Comandos de Ingesta RAG

### Instalación
```bash
cd backend
npm install
```

### Variables de Entorno Requeridas
```env
# Base de datos
DATABASE_URL=postgresql://user:***@host:5432/db

# NVIDIA NIM Embeddings
NVIDIA_API_KEY=your_nvidia_api_key
NVIDIA_EMBED_URL=https://integrate.api.nvidia.com/v1
NVIDIA_EMBEDDING_MODEL=nvidia/nv-embedqa-e5-v5   # ⚠️ EOL 2026-08-25 (410 Gone) — ver RAG_ARCHITECTURE.md §9.1

# Feature flags
ENABLE_BEAUTY_RAG=true
RAG_TOP_K=5
RAG_SIMILARITY_THRESHOLD=0.72

# Opcional: LLM enrichment para chunks ambiguos
USE_LLM_ENRICHMENT=false
DEEPSEEK_API_KEY=your_deepseek_key
```

### Ejecutar Ingesta

```bash
# Ingesta completa desde corpus markdown (recomendado)
npm run ingest:rag -- --source=corpus

# Dry-run (simula sin escribir en BD)
npm run ingest:rag -- --source=corpus --dry-run

# Limitar a N documentos
npm run ingest:rag -- --source=corpus --limit=10

# Verbose (logs detallados por chunk)
npm run ingest:rag -- --source=corpus --verbose

# Ingesta desde SQL seed (histórico, no recomendado)
npm run ingest:rag -- --source=sql
```

### Verificación Post-Ingesta

```bash
# Verificar esquema y contenido
node scripts/verifyRagSchema.js

# Test de búsqueda vectorial
node -e "
const {searchBeautyKnowledge} = require('./src/services/ragService');
searchBeautyKnowledge('niacinamida poros', {topK: 3}).then(r => console.log(r));
"
```

### Purge (Rollback)

```bash
# Dry-run: ver qué se borraría (seguro)
npm run purge:rag -- --source=corpus --dry-run

# Eliminación real (requiere --confirm)
npm run purge:rag -- --source=corpus --confirm

# Borrar TODO (peligroso)
npm run purge:rag -- --source=all --confirm
```

## Corpus de Conocimiento

Los documentos fuente están en `src/data/beauty_corpus/` con formato markdown + frontmatter YAML:

```markdown
---
category: skincare
skin_type: todas
season_station: todas
age_range: todas
source: glowapp_curated
---

# Título del Artículo

Contenido estructurado con headers (#, ##, ###)...
```

Ver `src/data/beauty_corpus/README.md` para documentación completa.

## Búsqueda Vectorial (Producción)

```javascript
const { searchBeautyKnowledge, formatKnowledgeContext } = require('./src/services/ragService');

// Búsqueda básica
const chunks = await searchBeautyKnowledge('niacinamida poros', { 
  topK: 5, 
  threshold: 0.72 
});

// Búsqueda con filtros metadata
const chunks = await searchBeautyKnowledge('hidratación', {
  topK: 5,
  threshold: 0.72,
  filters: {
    skin_type: 'seca',
    category: 'skincare',
    ingredients: ['ácido hialurónico', 'ceramidas']
  }
});

// Formatear para system prompt
const context = formatKnowledgeContext(chunks);
```

### Respuesta de Búsqueda
```javascript
[
  {
    id: 1,
    title: 'Niacinamida - El Ingrediente Multiusos',
    category: 'skincare',
    content: 'La niacinamida (vitamina B3)...',
    metadata: { ... },
    skinType: 'grasa',
    seasonStation: 'todas',
    ageRange: 'todas',
    ingredients: ['niacinamida', 'ceramidas'],
    contraindications: [],
    similarity: 0.89
  }
]
```

## Tests

```bash
# Tests unitarios RAG/AURA core
npm test -- --testPathPattern="(auraToolExecutor|fase5_e2e|sprint)"

# Tests específicos P1 (nuevos)
npm test -- --testPathPattern="(chunkingService|metadataEnricher|embeddingService)"

# Todos los tests
npm test
```

## Estructura de Archivos P1

```
backend/
├── src/
│   ├── services/
│   │   ├── chunkingService.js          # Chunking semántico
│   │   ├── metadataEnricher.js         # Enriquecimiento metadata
│   │   ├── embeddingService.js         # Wrapper NVIDIA NIM
│   │   ├── ragService.js               # Búsqueda + ingesta
│   │   └── ...otros servicios
│   ├── utils/
│   │   └── piiSanitizer.js             # Sanitización PII en logs
│   └── tests/
│       ├── chunkingService.test.js     # Tests chunking (5 casos)
│       ├── metadataEnricher.test.js    # Tests metadata (8 casos)
│       └── embeddingService.test.js    # Tests embeddings (6 casos)
├── scripts/
│   ├── ingestBeautyKnowledge.js        # Ingesta principal
│   ├── purgeRagKnowledge.js            # Rollback
│   └── verifyRagSchema.js              # Verificación esquema
├── src/data/beauty_corpus/
│   ├── README.md                       # Documentación corpus
│   └── 001_skincare_basics.md          # Corpus inicial
└── migrations/
    ├── 035_fix_embedding_dimension_and_hnsw_index.sql
    └── 035_fix_embedding_dimension_and_hnsw_index.down.sql
```

## Migraciones P0 (Base)

```bash
# Ver migraciones pendientes
npx knex migrate:list

# Aplicar migraciones
npx knex migrate:latest

# Rollback (usa .down.sql)
npx knex migrate:rollback
```

### Migración 035 (P0 - Vector 1024d + HNSW)
- `vector(768)` → `vector(1024)` compatible con NV-Embed-QA
- Índice HNSW `vector_cosine_ops` (fallback IVFFlat)
- 6 columnas metadata + 6 índices
- DOWN idempotente con advertencia de pérdida de embeddings

## Monitoreo y Logs

Los logs usan `piiSanitizer.sanitizeForLog()` para redactar:
- Emails → `[EMAIL_REDACTED]`
- Teléfonos CO → `[TELEFONO_REDACTED]`
- IPs → `[IP_REDACTED]`
- Edades → `[EDAD_REDACTED]`
- GPS → `[COORDS_REDACTED]`
- Truncado a 500 chars

## Troubleshooting

| Problema | Solución |
|----------|----------|
| Embeddings fallan | Verificar `NVIDIA_API_KEY` y rate limits |
| Chunks muy grandes | Añadir headers `##` en markdown |
| Metadata incorrecta | Revisar keywords en `metadataEnricher.js` |
| Índice HNSW no creado | Verificar versión pgVector ≥ 0.5 |
| Duplicados en BD | Verificar `title` único en frontmatter |

## Referencias

- [NVIDIA NV-Embed-QA Documentation](https://catalog.ngc.nvidia.com/orgs/nvidia/teams/ea/models/nv-embedqa-e5-v5)
- [pgVector HNSW Index](https://github.com/pgvector/pgvector#hnsw-indexes)
- [PostgreSQL Full-Text Search](https://www.postgresql.org/docs/current/textsearch.html)