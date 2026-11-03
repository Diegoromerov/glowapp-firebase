# Reglas y registro de numeración de migraciones

**Un prefijo numérico = una migración.** El prefijo es el único contrato de orden
entre migraciones independientes, y por eso está custodiado por el guard
`backend/tests/migrationsNoDuplicateNumbers.test.js` (bloqueante dentro del gate
de jest).

Cómo funciona el runner, para entender por qué el número importa
(`backend/src/config/migrationRunner.js`):

1. Lee `backend/migrations/` **solo el nivel superior**, toma los `.sql` que **no**
   terminan en `.down.sql`, y los ordena **alfabéticamente**.
2. Registra cada migración por **nombre de archivo completo** en
   `schema_migrations (filename UNIQUE)` — con checksum para detectar drift.
3. Una migración ya registrada **no se re-ejecuta nunca**.

Consecuencia directa: si dos archivos comparten el número, el orden de aplicación
lo decide el alfabeto del sufijo, nadie puede razonarlo, y el `filename` sí es
distinto ⇒ **las dos se aplican**, en un orden que nadie eligió.

---

## 1. Colisión resuelta: 4 ramas eligieron `073` (bloqueador de merge de Fase D)

**Qué pasó.** Cuatro ramas de fix partieron **en aislamiento** desde el mismo
commit `9cb3fb077` (verificado: `git merge-base <rama> 9cb3fb077` = `9cb3fb077` en
las cuatro). Cada una miró el directorio, vio que el máximo era `072`, y eligió el
mismo número libre: `073`. Ninguna pudo ver a las otras, porque el número se asigna
mirando el estado local, no el estado del repositorio.

**Estado del que se partió:** `072_catalogo_autorizado_y_historial_protegido.sql`
(máximo real, medido con el guard: 15 números ya duplicados de forma *histórica*,
ninguno por encima de `072`).

**Asignación determinista** (`ASIGNACION_FASE_D` en el guard):

| N.º | Migración | Rama de origen | Hallazgo |
|-----|-----------|----------------|----------|
| `073` | `073_create_kyc_audit_logs.sql` | `agent/t_fix_legal_02-fix-cumplimiento-legal` | KYC: auditoría legal inmutable de verificaciones |
| `074` | `074_wallet_transactions_append_only.sql` | `agent/t_fix_pagos_05-fix-seguridad-pagos` | P0-02 · `wallet_transactions` append-only + `wallet_ledger_events` |
| `075` | `075_create_admin_audit_logs.sql` | `agent/t_fix_flutter_10-flutter-audit-fix` | FIX-FLUTTER-10 P2 · trazabilidad de acciones admin |
| `076` | `076_rag_embedding_dimension_2048.sql` | `agent/t_fix_ragaura_03-fix-rag-aura` | N-4 · pgvector `1024 → 2048` + HNSW |

**Criterio de asignación.** Es una asignación **fija y determinista**, fijada una
sola vez por la resolución de integración: `073` KYC → `074` wallet → `075` admin →
`076` RAG. No se deriva del orden de merge ni del alfabeto de los archivos de
origen, y eso es deliberado: lo que importa no es *qué* orden se eligió, sino que
sea **estable y reproducible**. Queda congelado por el guard — cualquier
reasignación posterior rompe el caso `la asignación de Fase D está materializada con
números distintos` y obliga a actualizar este documento a propósito, no por
accidente.

**Rollbacks.** Los `.down.sql` viven en `backend/migrations/rollback/` (convención
que ya existía, p. ej. `rollback/035_fix_embedding_dimension_and_hnsw_index.down.sql`).
El runner ignora `.down.sql` y no lee subdirectorios, así que un rollback **jamás**
se ejecuta en un arranque. Se renumeraron con su `up`:

- `rollback/074_wallet_transactions_append_only.down.sql`
- `rollback/076_rag_embedding_dimension_2048.down.sql`

Las migraciones `073` (KYC) y `075` (admin) no traían rollback: son `CREATE TABLE`
+ triggers `IF NOT EXISTS` / `CREATE OR REPLACE`, y su reversión es
`DROP TABLE` manual (documentado en el propio archivo).

**Contenido idéntico al de origen.** La renumeración cambió **solo el número** en
nombre de archivo y en los comentarios internos que lo citaban. Verificado con
`git show <rama>:<ruta-original> | diff - <ruta-nueva>` para los 6 archivos: ninguna
sentencia SQL fue tocada.

---

## 2. Deuda histórica: 15 números duplicados desde antes de la Fase D

`main` ya llegaba con estos duplicados, **todos aplicados en producción**:

```
002  003  004  008  011  012  026  029  030  032  033  034  065  066  067
```

**Por qué NO se renumeran aquí.** `schema_migrations` rastrea por **nombre de
archivo**: renombrar un legacy cambiaría su `filename` y el runner lo trataría como
nueva ⇒ se re-ejecutaría. Varias de esas migraciones **no son idempotentes**, así
que eso no es una renumeración cosmética, es un incidente. Además hay rutas citadas
por nombre en el código, y hay que actualizarlas en el mismo cambio:

- `backend/scripts/prepareRlsDatabase.js:50` → `migrations/065_multi_tenant_hardening.sql`
- `backend/scripts/verifyCatalogoAutorizado.js:73` → `../migrations/072_catalogo_autorizado_y_historial_protegido.sql`

El reordenamiento **completo** del directorio (0→N secuencial, sin huecos) tiene
tarjeta propia y ya está en marcha:
**`agent/t_fix_8aeb7051-p2-3-consolidate-migrations`**. Duplicarlo aquí crearía dos
esquemas de renumeración en competencia y un conflicto mucho peor.

**Decisión:** el guard **congela** ese backlog en `BASELINE_DUPLICADOS_LEGACY`
(lista exacta de archivos por número, no solo el número). Queda visible y
verificable, y **cualquier duplicado nuevo falla**, sea cual sea su número:

- duplicado con número nuevo (≥ `073`) → falla por detección directa;
- duplicado colado bajo un número legacy → falla porque el baseline deja de
  coincidir con la realidad.

Un baseline obsoleto no protege: si alguien renumera o borra un legacy, el guard
falla y obliga a actualizar el baseline **y** este documento.

---

## 3. Colisión pendiente detectada (fuera del alcance de esta rama)

El mismo guard detecta una **segunda colisión en curso**, no reportada en el
hallazgo original, entre ramas que aún no han mergeado:

| N.º | Archivos | Ramas |
|-----|----------|-------|
| `049` | `049_fix_biometric_consents_user_id_type.sql` | `t_fix_bec_001`, `t_fix_qa_001`, `t_fix_veto_001` |
| `049` | `049_alter_embedding_dimension_to_2048.sql` | `t_fix_rag_001` |

`049` está libre en `main` (el directorio salta de `048` a `053`), y **cuatro ramas
lo reclamaron a la vez, con dos nombres distintos**: es exactamente el mismo patrón
de fallo que el `073`, un número más abajo. Al mergear, el guard **fallará**
(está diseñado para eso). Quien integre esas ramas debe asignar números distintos
antes de mergear, no ampliar el baseline.

---

## 4. Reglas para añadir una migración

1. **Toma el número libre más alto + 1**, comprobando el directorio **y las ramas
   en vuelo**, no solo tu worktree. Hoy: el máximo es `076` ⇒ el siguiente libre es
   **`077`**.
2. Formato `NNN_descripcion_en_snake_case.sql` (3 dígitos, con ceros a la izquierda).
3. Un `.down.sql` va en `rollback/`, con **el mismo prefijo y el mismo tallo** que su
   `up` (`074_x.sql` ⟺ `rollback/074_x.down.sql`). El guard lo verifica.
4. Antes de commitear:
   ```bash
   node backend/tests/migrationsNoDuplicateNumbers.test.js   # 0 fallos, exit 0
   ```
   El guard corre por **dos** vías, ambas bloqueantes: como paso propio en
   `.github/workflows/ci.yml` (antes de levantar PostgreSQL, porque el paso de jest
   queda `skipped` detrás de CI-46) y como test dentro del gate de jest
   (`testMatch` `**/tests/**/*.test.js`).
5. Si tu número choca con otra rama: **renumera tu migración** (la que aún no está
   aplicada). Nunca renumeres una ya aplicada, y nunca amplíes el baseline.

---

## 5. Evidencia

| Qué | Comando | Resultado |
|-----|---------|-----------|
| Colisión real | `node backend/tests/migrationsNoDuplicateNumbers.test.js` (4 migraciones con su `073` original) | **ROJO** · exit 1 · `073 (4): 073_create_admin_audit_logs.sql, 073_create_kyc_audit_logs.sql, 073_rag_embedding_dimension_2048.sql, 073_wallet_transactions_append_only.sql` |
| Fix aplicado | `node backend/tests/migrationsNoDuplicateNumbers.test.js` | **VERDE** · exit 0 · `7/7 casos en verde · 0 fallo(s)` |
| El guard no es vacuo | sembrar `077_control_a.sql` + `077_control_b.sql` y correr el guard | **ROJO** · exit 1 · 5/7 casos, falla «0 duplicados fuera del baseline» y el baseline |
| Origen común | `git merge-base <rama> 9cb3fb077` × 4 | `9cb3fb077` en las 4 |
| Contenido intacto | `git show <rama>:<ruta-original> \| diff - <ruta-nueva>` × 6 | solo el número |

---

## 6. Migración 077 — Fix biometric_consents schema (Post-Fase D)

**Problema:** Migración 026 renombró columnas que el código usa (`consent_type`→`version`, `ip_address`→`ip`, etc.). Migración 037 añadió columnas con `IF NOT EXISTS` sobre el esquema renombrado, creando duplicados/conflictos. El código INSERTa en columnas que no existen o tienen nombres distintos → error 500 en consent grant.

**Solución (077):**
1. Renombra columnas de vuelta a lo que el código espera (`version`→`consent_type`, `ip`→`ip_address`, `user_agent`→`device_info`, `accepted_at`→`created_at`)
2. Asegura columnas faltantes (`granted`, `granted_at`, `revoked_at`, `purpose`, `version_terms`, `updated_at`)
3. Crea constraint UNIQUE `(user_id, consent_type, version_terms)` para ON CONFLICT
4. Elimina índice legacy `unique_active_consent` (usa columna `active` no usada por código)
5. Asegura tabla `biometric_access_log` y trigger `updated_at`

**Archivo:** `077_fix_biometric_consents_schema.sql`
**Rollback:** `rollback/077_fix_biometric_consents_schema.down.sql`

**Validación:** Script verifica columnas esperadas, constraint UNIQUE, tabla access_log.

---

## 7. Migración 081 — PQRSF: tiempos de respuesta y autor del mensaje (F1)

**Problema.** `007_soporte_y_pqrsf.sql` dejó el hilo en `ticket_mensajes` con un único dato
de tiempo (`fecha_envio`) y sin autor. Consecuencias medidas: el "tiempo de primera
respuesta" solo existía como `MIN(fecha_envio)` cruzado contra `usuarios.rol` (consulta
frágil, reescrita en cada métrica), no se registraba **cuándo** un ticket pasó a
`RESUELTO`/`CERRADO` (solo cuándo se tocó por última vez), y no había forma de distinguir
a un operador humano de un agente — justo la costura que hace falta para automatizar
respuestas.

**Solución (081).** Añade `tickets.primera_respuesta_en | resuelto_en | cerrado_en` y
`ticket_mensajes.autor_tipo (USUARIO|OPERADOR|AGENTE) | es_borrador`, con backfill del
histórico (el autor se deduce del rol del remitente; un `PRESTADOR` **no** es operador, y
los mensajes sin remitente resoluble se asumen `USUARIO` para no inflar las métricas).

**Archivo:** `081_pqrsf_sla_y_autor.sql`
**Rollback:** `rollback/081_pqrsf_sla_y_autor.down.sql` (dropea columnas; **no** toca los
mensajes: la conversación es intocable)

**Por qué 081 y no 077 — corrige la regla 1 de este documento.** La regla decía «hoy el
máximo es 076 ⇒ el siguiente libre es 077», y **ya era falsa**: `077` está ocupado y en el
directorio convive `080_business_documents_signed_by_text.sql`. El guard compara contra el
**directorio real** (`fs.readdirSync`), no contra este documento, así que el número se elige
mirando el disco y **las ramas en vuelo**, nunca la cifra escrita aquí. Un documento que
dice cuál es el "siguiente libre" caduca cada vez que alguien añade una migración; por eso
no se deja una cifra como fuente de verdad.

**Verificación — no lectura del SQL, sino ejecución contra Postgres 16 real** (contenedor
`glow-ci-pg`, base desechable `pqrsf_f1`), aplicando el esquema REAL (`007` + `045`) y datos
sintéticos con fechas fijas: columnas creadas; `autor_tipo` con 2 `OPERADOR` (los del rol
`ADMIN`) y 4 `USUARIO`; `primera_respuesta_en` exacta y `NULL` donde nunca respondió un
operador; `resuelto_en`/`cerrado_en` solo donde corresponde; el `CHECK` **acepta `AGENTE` y
rechaza** cualquier otro valor; **re-aplicar la migración no cambia ningún dato** (hash
idéntico: el runner re-aplica lo que no esté registrado en `schema_migrations`); y el
rollback deja las columnas fuera con los 7 mensajes intactos.

---

## 2. Y-F1 usa `100`: el siguiente libre se lee del disco, no de este documento

**Archivo:** `100_create_biometric_scan_sessions.sql`
**Qué crea:** serie temporal del escaneo facial (`biometric_scan_sessions`) con las
métricas cifradas, el `provider_task_id` de YouCam y los contadores de auditoría
(`requested_actions`, `missing_metrics`, `metrics_count`). No toca ninguna tabla
existente: `beauty_profiles` sigue siendo el último perfil y `biometric_history` el
registro que exige el consentimiento.
**Por qué 100:** el máximo numérico real del directorio era `099` (las posteriores son
`2026…` con timestamp). El guard `migrationsNoDuplicateNumbers` se ejecutó después de
crear el archivo y quedó en verde.
**Verificación:** no lectura del SQL, sino aplicación sobre un Postgres en memoria
(`pg-mem`): la migración aplica, acepta un `INSERT` con `metrics_count = 29`,
`requested_actions`/`missing_metrics` en `JSONB` y rechaza `metrics_encrypted NULL`.
Pendiente: aplicación en la base real, que ocurre sola en el siguiente arranque del
runner (`schema_migrations` la registra por nombre de archivo).

---

## 3. Y-F1b usa `101`: versión del consentimiento en el escaneo

**Archivo:** `101_add_consent_version_to_scan_sessions.sql`
**Qué crea:** dos columnas en `biometric_scan_sessions` — `consent_version`
(`version_terms` vigente al escanear) y `consent_outdated` (el escaneo se autorizó con
un texto anterior). No toca `biometric_consents`: esa tabla ya tenía `version_terms`
desde la `037`, lo que faltaba era usarlo.
**Por qué 101:** `100` quedó ocupado por Y-F1 en esta misma rama; el guard de
numeración se ejecutó después y siguió en verde.
**Verificación:** aplicada sobre Postgres en memoria después de la `100`; un `INSERT`
con `consent_version '1.0'` devuelve `consent_outdated = true`, otro sin versión deja
`NULL`, y re-aplicarla no falla (`ADD COLUMN IF NOT EXISTS`). Pendiente: base real, en
el siguiente arranque del runner.

---

## 4. Y-F3 usa `102`: comparaciones guardadas, no recalculadas

**Archivo:** `102_create_biometric_scan_comparisons.sql`
**Qué crea:** `biometric_scan_comparisons` — una fila por escaneo comparado, con el
detalle cifrado, el veredicto y los contadores en claro. `UNIQUE (current_scan_id)`
impide recalcular la misma comparación y `CHECK (baseline_scan_id <> current_scan_id)`
impide que un escaneo se compare consigo mismo (daría Δ = 0 y un «sin cambio» falso).
**Por qué 102:** `100` y `101` quedaron ocupados en las fases anteriores de esta rama.
**Verificación:** aplicadas 100 → 101 → 102 sobre Postgres en memoria; un `INSERT` con
`threshold 2.00` devuelve `MEJORO` con `compared_count 29`, y ambos rechazos (mismo
escaneo, duplicado de `current_scan_id`) saltan. Guard de numeración en verde (7 pruebas).

---

## 5. Y-F5 usa `104`: huella de la foto para no pagar dos veces

**Archivo:** `104_add_image_fingerprint_to_scan_sessions.sql`
**Qué añade:** `image_hash` — HMAC-SHA256 del JPEG normalizado con pepper del servidor
— con índice por `(user_id, image_hash)`.
**Qué NO añade:** ninguna columna para el descriptor perceptual. El dHash de 64 bits es
un dato biométrico derivado, así que viaja **dentro del payload cifrado** de la sesión
(AES-256-GCM) y se compara descifrando las últimas 20 sesiones del usuario.
**Por qué HMAC y no sha256 pelado:** un sha256 de la foto es un identificador estable:
cualquiera con acceso a la base podría comprobar si una foto concreta pertenece a un
usuario. Con pepper, sin la clave eso no se puede.
**Si falta el pepper:** no se calcula el hash exacto y la caché se apoya sólo en el
dHash; el escaneo nunca se bloquea por eso.
**Aislamiento:** toda búsqueda filtra por `user_id`; la misma foto de otra persona nunca
devuelve métricas ajenas.
**Un acierto no es una medición:** no se inserta sesión nueva ni comparación, así que la
serie no se llena de duplicados con Δ0.
**Verificación:** 100 → 104 sobre Postgres en memoria, re-aplicable; la columna
`image_phash` no existe; el ciphertext no contiene el dHash en claro; la construcción de
la ventana temporal se validó contra el Postgres de producción (12 pruebas de la fase).

## 6. T-111 usa `106`: el plazo de conservación necesita un log sin usuario

**Archivo:** `106_biometric_retention.sql`
**Qué añade:** `biometric_access_log.user_id` pasa a admitir `NULL` y se crea
`idx_biometric_scan_sessions_captured_at`.
**Por qué `NULL` en el log:** la purga por retención borra escaneos de muchas personas en
una sola pasada. Dejar constancia de lo que hizo exigía un `user_id` que la tabla no
permitía dejar vacío; la alternativa habría sido guardar identificadores de gente cuyos
datos se acababan de suprimir. La fila de purga queda con `accessed_by =
'system_retention'`, `access_type = 'retention_purge'` y conteos agregados.
**Por qué el índice:** el índice existente es `(user_id, captured_at)` y no sirve para
«todo lo anterior a esta fecha», que es exactamente la consulta de la purga.
**Qué NO añade:** ninguna columna de fecha de purga. El borrado se prueba por conteo y
por la fila de auditoría; una columna «purged_at» sobre una sesión borrada no existe por
definición.
**Verificación:** el corte se calcula con `retentionCutoff()` (24 meses desde el último
escaneo) y `dryRun` cuenta sin borrar antes de ejecutar.

---

## 7. Migración 111 — el SaaS B2B reclamó un `107` ya ocupado

**Archivo:** `111_saas_billing_schema.sql` (antes `107_saas_billing_schema.sql`).
**Qué pasó.** Dos PRs del 20-oct partieron con horas de diferencia y ambos vieron libre
el `107`: `107_rls_politicas_sin_contexto.sql` (01:02) y `107_saas_billing_schema.sql`
(14:56). Los dos entraron en `main` y el guard quedó en rojo **después** del merge, con
el gate de CI fallando en `main` desde entonces. Las dos están aplicadas en producción.
**Qué se hizo:** renumerar la **más nueva** al siguiente libre real del directorio
(`111`; el máximo en disco era `110`), según la regla 5.
**Por qué renumerar una ya aplicada no rompe nada aquí:** el runner registra por
`filename`, así que la próxima ejecución manual la volverá a aplicar bajo el nombre
nuevo. Se verificó sentencia por sentencia que el archivo es idempotente: 3
`CREATE TABLE IF NOT EXISTS`, 10 `CREATE INDEX IF NOT EXISTS`, un bloque `DO` que crea
el trigger solo si no existe y `CREATE OR REPLACE FUNCTION`. Re-ejecutar es no-op.
La fila `107_saas_billing_schema.sql` de `schema_migrations` se deja como registro
histórico de lo que realmente se ejecutó; no se borra.
**Lección para la próxima:** el número se elige mirando el directorio **y las ramas en
vuelo en el remoto**, no solo el worktree. Dos ramas del mismo día se pisan igual.

## 112_memberships_invite_columns.sql (pendiente de aplicar)

**Motivo:** `saasTeamRoutes.js` escribe `invite_token`, `invited_by` y `status='PENDING'`,
pero 082 no creó esas columnas y su CHECK solo admitía `INVITED/ACTIVE/SUSPENDED/REVOKED`.
Invitaciones y aceptaciones fallaban en tiempo de ejecución.

**Además:** `business_verticals` estaba vacía en producción (0 filas) y
`business_profiles.vertical_id` es NOT NULL con FK, así que provisionar un tenant
era imposible. La migración siembra la vertical `BELLEZA` si la tabla está vacía.

**Validado:** ejecutada dentro de una transacción contra la BD de producción y
revertida con ROLLBACK; también aplicada dos veces seguidas para confirmar
idempotencia. No se ha aplicado de forma persistente.

## Separación de migraciones del RAG → `migrations/rag/`

**Motivo:** `index.js` aplica `migrations/*.sql` contra `DATABASE_URL` (base principal),
pero 035, 046, 048, 054 y 076 son del RAG (pgvector, `RAG_DATABASE_URL`). Contra la base
principal fallaban siempre y el arranque mostraba 5 advertencias que parecían fallos de
código: `could not access file "$libdir/vector"`, `column "metadata" does not exist`,
`function uuid_generate_v4() does not exist`.

**Qué se hizo:**
- Las cinco se movieron a `migrations/rag/` (el runner de arranque no entra en subcarpetas).
- Runner propio: `npm run rag:migrate` (`scripts/runRagMigrations.js`), registra en el
  `schema_migrations` de la base RAG. Soporta `-- --dry`.
- `054`: `uuid_generate_v4()` → `gen_random_uuid()` (la base RAG no tiene `uuid-ossp`);
  verificado que `gen_random_uuid()` está disponible.

**Pendiente conocido:** `076_rag_embedding_dimension_2048.sql` no es aplicable tal como
está: pide `vector(2048)` con índice **ivfflat** y pgvector limita ivfflat a 2000
dimensiones. Requiere decidir `halfvec(2048)` o índice `hnsw` antes de tocarla.

## 076 pasa a `halfvec(2048)` (no `vector(2048)`)

La versión previa pedía `vector(2048)` + índice HNSW. Es imposible: pgvector limita
HNSW e IVFFlat a 2000 dimensiones para el tipo `vector`, así que la migración fallaba
con `column cannot have more than 2000 dimensions for ivfflat index` y nunca se aplicó.
Producción tiene pgvector 0.8.6, que soporta `halfvec` hasta 4000 dims con HNSW.

- Columna: `halfvec(2048)`; índice `hnsw (embedding halfvec_cosine_ops)`.
- Código: los 113 casts `::vector` de las consultas a `beauty_knowledge_embeddings`
  pasan a `::halfvec` (42 archivos). `aura_knowledge_chunks` sigue en `vector(1024)`.
- Test de regresión acepta `halfvec` y `vector` en el DDL.

## Re-ingesta: el script es `ingestCanonicalCorpus.js`

`ingestBeautyKnowledge.js` usa el pool de la base PRINCIPAL y escribe en su tabla
vestigial `beauty_knowledge_embeddings` (`embedding real[]`, 6 filas). El corpus real
(6.420 chunks) vive en la base RAG y solo `scripts/ingestCanonicalCorpus.js` usa
`ragPool`. Flags: `--limit=N`, `--dry-run`. Su guard de seguridad permite
`railway.internal`, por eso corre dentro del contenedor.

## 113: columnas de alcance del RAG (`tenant_id`, `deleted_at`, `expires_at`)

`ragService` arma el WHERE con esas tres columnas y el SELECT con dos de ellas, pero la
base RAG nunca las recibió: su migración (`080_rag_rls_multi_tenant_hardening.sql`) ya no
existe en el repo y se aplicó contra la base principal. Medido: **toda consulta fallaba**
con `column "tenant_id" does not exist` en la ruta vectorial y en el fallback → el RAG
devolvía `[]` siempre. No era el umbral: la búsqueda no llegaba a ejecutarse.

113 las añade (`tenant_id INTEGER`, `deleted_at`/`expires_at` TIMESTAMPTZ) con las 5.619
filas en `tenant_id NULL` = conocimiento global. Sin RLS: el aislamiento va en el WHERE
(`appendTenantCondition`), y RLS necesitaría el GUC `app.tenant_id` que el pool del RAG no fija.

## 114: índice GIN para la rama léxica

Sin índice, `to_tsvector('spanish', title || content)` se calculaba sobre las 5.619 filas en
cada consulta: p50 **1.036 ms** en el híbrido frente a 242 ms en vectorial. El índice usa la
misma expresión que la consulta, o el planner no lo toma.

## 115: columna generada `search_vector`

El primer intento (114) dejó de escanear, pero `ts_rank_cd` seguía recalculando el tsvector
fila a fila: **1.431 ms**. Con `search_vector` como columna generada y GIN propio, el plan pasa
a `Bitmap Index Scan` y la consulta cuesta **12,4 ms**. Requiere
`SET max_parallel_maintenance_workers = 0` para el build (mismo fallo de memoria compartida que
en 076).
