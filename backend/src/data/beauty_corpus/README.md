# Beauty Corpus - Documentación del Formato

Este directorio contiene la base de conocimiento curada para el sistema RAG de GlowApp. Cada archivo markdown representa un documento de conocimiento de belleza/skincare que será procesado, chunkeado, enriquecido con metadata e indexado en la tabla `beauty_knowledge_embeddings` con embeddings vectoriales de 2048 dimensiones (`nvidia/nemotron-3-embed-1b`).

## Estructura del Corpus

```
backend/src/data/beauty_corpus/
├── README.md                    # Este archivo
├── 001_skincare_basics.md      # Artículos fundamentales de skincare
├── 002_ingredients_deep_dive.md # Análisis profundo de ingredientes
├── 003_hair_care.md            # Cuidado capilar
├── 004_makeup_techniques.md    # Técnicas de maquillaje
├── 005_nail_care.md            # Cuidado de uñas
├── 006_body_care.md            # Cuidado corporal
├── 007_wellness_supplements.md # Wellness y suplementos
├── 008_hair_coloring.md        # Tintes y coloración capilar
├── 009_eyebrow_visagism.md     # Visagismo de cejas
├── 010_eyelash_care.md         # Cuidado de pestañas
├── 011_beard_grooming.md       # Barba y bigote
└── 012_seasonal_guides.md      # Guías por estación
```

## Formato de Archivos

Cada archivo markdown debe seguir este formato con **frontmatter YAML** obligatorio:

```markdown
---
category: skincare
skin_type: todas
season_station: todas
age_range: todas
source: glowapp_curated
---

# Título del Artículo

Contenido del artículo en markdown...
```

### Campos del Frontmatter

| Campo | Tipo | Valores Permitidos | Descripción |
|-------|------|-------------------|-------------|
| `category` | string | `skincare`, `maquillaje`, `cabello`, `cejas`, `pestañas`, `uñas`, `corporal`, `wellness`, `tintes`, `suplementos`, `barba` | Categoría principal del artículo |
| `skin_type` | string | `normal`, `seca`, `grasa`, `mixta`, `sensible`, `todas` | Tipo de piel objetivo |
| `season_station` | string | `primavera`, `verano`, `otoño`, `invierno`, `todas` | Estación colorimétrica |
| `age_range` | string | `adolescencia`, `20-30`, `30-40`, `40-50`, `50+`, `todas` | Rango etario objetivo |
| `source` | string | `glowapp_curated`, `provider_contributed`, `clinical_guideline`, `partner_api` | Origen del contenido |

> **Nota**: Estos valores se usan como valores por defecto durante el enriquecimiento de metadata. El enriquecedor (`metadataEnricher.js`) puede sobrescribirlos basándose en el contenido de cada chunk.

## Estructura del Contenido

El cuerpo del markdown debe seguir estas convenciones:

1. **Headers jerárquicos**: Usa `#`, `##`, `###` para estructurar el contenido. El chunker preserva la jerarquía.
2. **Párrafos separados por línea en blanco**: El chunker divide por párrafos primero.
3. **Oraciones completas**: El chunker respeta límites de oraciones (no corta a mitad de frase).
4. **Listas y tablas**: Se preservan en los chunks.

### Ejemplo de Estructura Recomendada

```markdown
---
category: skincare
skin_type: todas
season_station: todas
age_range: todas
source: glowapp_curated
---

# Nombre del Artículo Principal

## Introducción

Párrafo introductorio con contexto general...

## Sección 1: Concepto Clave

Explicación detallada...

### Subsección: Detalle Técnico

Más detalles...

## Sección 2: Aplicación Práctica

Pasos, tips, recomendaciones...

## Contraindicaciones y Precauciones

Advertencias importantes...

## Referencias

- Estudio X (Journal Y, 2023)
- Guía clínica Z
```

## Procesamiento Automático

Al ejecutar `npm run ingest:rag -- --source=corpus`, el pipeline hace:

1. **Lectura**: Lee todos los `.md` del directorio ordenados alfabéticamente
2. **Parseo**: Extrae frontmatter YAML + contenido markdown
3. **Chunking semántico** (`chunkingService.chunkMarkdownDocument`):
   - Divide por headers (`#`, `##`, `###`) preservando jerarquía
   - Chunks de 500-800 tokens (aprox 2000-3200 chars)
   - Overlap de 50 tokens entre chunks adyacentes
   - Respeta oraciones y párrafos
   - Genera `content_hash` SHA-256 determinista por chunk
4. **Enriquecimiento metadata** (`metadataEnricher.enrichChunkMetadata`):
   - `category`, `skin_type`, `season_station`, `age_range` por keywords/regex
   - `ingredients` array: extrae ingredientes conocidos (100+)
   - `contraindications` array: extrae contraindicaciones conocidas (20+)
   - Cache por `content_hash` para determinismo
   - Opcional: LLM (DeepSeek) para chunks ambiguos (`USE_LLM_ENRICHMENT=true`)
5. **Embeddings** (`embeddingService.generateEmbedding`):
   - Input type: `passage` para indexar
   - Modelo: nvidia/nemotron-3-embed-1b (2048 dims)
   - Circuit breaker + retry con backoff exponencial
   - Validación: exactamente 2048 dimensiones
6. **Upsert idempotente** en `beauty_knowledge_embeddings`:
   - `ON CONFLICT (title) DO UPDATE`
   - `content_hash` para detección de cambios
   - Batch de 10 chunks, 100ms delay (10 chunks/seg)

## Comandos Disponibles

```bash
# Ingesta completa (corpus markdown)
npm run ingest:rag -- --source=corpus

# Dry-run (simula sin escribir en BD)
npm run ingest:rag -- --source=corpus --dry-run

# Limitar a N documentos
npm run ingest:rag -- --source=corpus --limit=5

# Verbose (logs detallados)
npm run ingest:rag -- --source=corpus --verbose

# Ingesta desde SQL seed (histórico)
npm run ingest:rag -- --source=sql
```

## Verificación Post-Ingesta

```bash
# Verificar esquema y contenido
node scripts/verifyRagSchema.js

# Test de búsqueda vectorial
node -e "
const {searchBeautyKnowledge} = require('./src/services/ragService');
searchBeautyKnowledge('niacinamida poros', {topK: 3}).then(r => console.log(r));
"
```

## Buenas Prácticas para Contribuir

1. **Un tema por archivo**: Un archivo = un tema coherente
2. **Nombrado secuencial**: `001_`, `002_`, etc. para orden de ingesta
3. **Contenido verificable**: Citar fuentes científicas (Journal, AAD, etc.)
4. **Metadata precisa**: `category` correcto ayuda al filtrado semántico
5. **Contenido único**: Evitar duplicados; el upsert usa `title` como clave
4. **Longitud adecuada**: 500-3000 palabras por archivo para chunks óptimos

## Migración desde `seed_beauty_knowledge.sql`

El archivo `backend/sql/seed_beauty_knowledge.sql` contiene 25 entradas hardcodeadas que fueron migradas a formato markdown en `001_skincare_basics.md`. El SQL se mantiene como referencia histórica pero **ya no se usa en producción**. La ingesta ahora usa exclusivamente el corpus markdown.

## Troubleshooting

| Problema | Solución |
|----------|----------|
| Chunks muy grandes (>1000 tokens) | Añadir más headers `##` o párrafos vacíos |
| Chunks muy pequeños (<100 tokens) | Combinar secciones relacionadas |
| Metadata incorrecta | Revisar keywords en `metadataEnricher.js` |
| Embeddings fallan | Verificar `NVIDIA_API_KEY` y rate limits |
| Duplicados en BD | Verificar `title` único en frontmatter |

## Referencias Técnicas

- `chunkingService.js`: Chunking semántico con overlap
- `metadataEnricher.js`: Enriquecimiento heurístico + LLM opcional
- `embeddingService.js`: Wrapper NVIDIA NIM con circuit breaker
- `ingestBeautyKnowledge.js`: Orquestador principal
- `ragService.js`: Búsqueda vectorial en producción