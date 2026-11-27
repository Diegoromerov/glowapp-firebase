# Reglas y registro de numeración de migraciones

## 208: ubicación actual del prestador con consentimiento

Separa la última ubicación móvil del campo de ubicación del perfil. Guarda solo
una posición vigente por prestador, con precisión y marcas de captura/recepción;
la revocación elimina esa fila. La actualización se acepta únicamente en línea,
con consentimiento vigente, una captura reciente y precisión de hasta 100 m.
La migración es aditiva e idempotente. El mapa cliente usa estas coordenadas
solo para clientes autenticados cuando el consentimiento sigue activo y la
posición tiene menos de cinco minutos; de lo contrario vuelve a la ubicación
registrada del perfil. `app_rls_user` solo puede ver y modificar la fila cuyo
`provider_id` coincide con `app.user_id`; el directorio y la retención usan
`app_system`.

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

## 2. Deuda de duplicados ya desplegada

`main` ya llegaba con estos duplicados históricos, **todos aplicados en producción**:

```
002  003  004  008  011  012  026  029  030  032  033  034  065  066  067
```

Después se desplegaron dos migraciones con prefijo `179` desde ramas independientes:
`179_add_notification_prefs_metadata.sql` y `179_dispute_messages.sql`. Ambas están
registradas en producción por nombre de archivo. Se congelan en el baseline exacto;
no deben renombrarse, porque el runner podría volver a ejecutarlas.

También se desplegaron dos migraciones con prefijo `186` desde ramas independientes:
`186_disputas_workflow_audit.sql` y `186_encrypt_payout_data_and_review_sla.sql`.
Una consulta de solo lectura a `schema_migrations` de Railway production, ejecutada
el 23 de noviembre de 2026 (hora Bogotá), confirmó que **ambos nombres están registrados**. Se
congelan en `backend/tests/migrationsNoDuplicateNumbers.test.js`; no se renumeran ni
se cambian sus nombres porque el runner las repetiría por `filename`.

El techo del baseline de duplicados aplicados queda fijado en `186`. Cualquier
duplicado nuevo por encima de `186` sigue fallando el guard; solo se puede sumar un
duplicado existente al baseline con evidencia del nombre exacto registrado en
producción y una anotación aquí.

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

**Decisión:** el guard **congela** los duplicados desplegados en `BASELINE_DUPLICADOS_LEGACY`
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

1. **Toma un número libre**, comprobando el directorio **y las ramas en vuelo**, no
   solo tu worktree. No uses el siguiente consecutivo a ciegas: consulta el
   inventario actual y ejecuta el guard antes de integrar.
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
5. Si tu número choca con otra rama antes del despliegue: **renumera tu migración**.
   Nunca renumeres un archivo registrado en producción. Un duplicado que ya esté
   aplicado se congela solo tras verificar cada `filename` en `schema_migrations` y
   dejar evidencia en este registro y en el guard.

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

## 196_seed_business_vertical_catalog.sql

**Motivo:** la base de producción no tenía filas en `business_verticals`. El alta
de salón respondía 201, pero `ensureSalonOwnerIdentity` no podía insertar el perfil;
el bootstrap posterior devolvía 409 porque no encontraba una vertical. La siembra
del catálogo de aplicación no se ejecuta automáticamente en Railway.

**Qué hace:** persiste de forma idempotente las cuatro verticales ya definidas en
`src/db/seed_business_data.js`, sin modificar registros existentes. El código
`BEAUTY_SALON` satisface la búsqueda de vertical de belleza del provisionamiento SaaS.

**Validación:** pendiente en esta rama. Tras el despliegue en producción se repetirá
el alta, bootstrap idempotente y lectura de la sede con una cuenta QA nueva.

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

## 131: evidencia de consentimiento biométrico (Ley 1581)

- Añade a `biometric_consents` la marca de autorización expresa, el SHA-256 del aviso y el snapshot del texto presentado.
- Crea `biometric_consent_audit`, bitácora append-only con trigger para concesiones, cambios, revocaciones y eliminación del registro de autorización.
- Las rutas de supresión agregan eventos correlacionados de solicitud, éxito o fallo, con conteo afectado y sin incluir fotografías ni métricas.
- Las nuevas autorizaciones requieren la versión y hash vigentes. Los consentimientos históricos sin evidencia de aceptación expresa quedan con `explicit_authorization = false` y requieren nueva autorización.
- No tiene FK a `usuarios`: el log de evidencia no desaparece por cascada al cerrar la cuenta. Su acceso queda restringido por la API admin y debe sujetarse al plazo aprobado para evidencias de privacidad.

## 132: consentimiento de boletines y campañas

- Registra concesiones y retiros de `marketing_enabled` en una bitácora sin FK al usuario.
- Añade campañas y entregas por lotes, sin guardar copia de los correos de destinatarios; cada envío vuelve a comprobar la autorización.
- La API administrativa requiere un proveedor de correo configurado y reporta los estados reales de entrega.

## 133: métricas internas agregadas

- Elimina `user_id` de los eventos históricos y reduce metadatos a `screen_name` allowlisted.
- La captura nueva guarda solo tipo y pantalla, exige sesión y deja `user_id` nulo. El endpoint admin devuelve agregados por período.

## 134: auditoría de PQRSF y supresión ARCO

- Añade bitácora append-only de radicación, transición, verificación de identidad, mensajes (sin contenido) y ejecución de supresión.
- El flujo administrativo exige verificación explícita y confirmación separada antes de anonimizar la cuenta y borrar datos biométricos; bloquea cerrar una solicitud ARCO antes de ejecutarla.
- El manifiesto deja evidencia mínima de las categorías eliminadas y conservadas. Los registros financieros/contractuales que deban conservarse no se declaran borrados.

## 135: horario de atención del prestador

- Crea en `perfiles_prestador` las columnas `weekly_schedule`, `active_start_hour` y `active_end_hour` con sus valores por defecto (9 y 19).
- Corrige un drift de esquema: `/api/providers` y las rutas de horario leían esas columnas, pero ninguna migración de la cadena 000–134 las creaba; solo existían en `railway_seed.sql`, `seed/prestadores-demo-11.sql` y `scripts/e2e/schema-base.sql`. Toda base creada desde la cadena (CI, staging nuevo, restore limpio) fallaba con `column p.active_start_hour does not exist`.
- El backfill desde `weekly_schedule` solo toca filas con el rango horario nulo, y descarta valores de agenda que no sean numéricos para no abortar el arranque.
- Reejecutable: entra tanto en la lista de base vacía como en la de arranque. El `CHECK` de rango se agrega `NOT VALID` para no bloquear filas heredadas.

## 136: contrato de tipo de `services.id`

- Fija y hace visible el contrato real: `services.id` es `UUID` con `gen_random_uuid()` (init.sql:84) y `bookings.service_id` es `UUID` (init.sql:101), que es lo que devuelve producción.
- No convierte nada: cambiar una PK referenciada por `bookings` y `booking_productos` exige rewrite con ventana de mantenimiento. Solo emite el tipo detectado al arranque, en CI y en cada despliegue.
- Corrige la causa de la confusión: `054_create_core_tables.sql` declaraba `SERIAL` e `INTEGER` en un `CREATE TABLE IF NOT EXISTS` que nunca se aplicó porque `init.sql` corre antes.

## 153: revisión del RUT del prestador

- Agrega a `usuarios` el soporte documental del RUT (`rut_soporte_url`, `rut_soporte_hash`, `rut_soporte_mime`, `rut_soporte_bytes`, `rut_cargado_at`) y el ciclo de revisión (`revision_estado`, `revision_nota`, `revisado_por`, `revisado_at`).
- Cierra un hueco de 086/087: se podía declarar el código 48/49 sin adjuntar nada y nadie lo contrastaba. Ahora el documento es obligatorio para publicar y el equipo lo aprueba (D-GL-030).
- `revision_estado` arranca en `SIN_ENVIAR` para todas las filas: nadie queda aprobado por herencia. El valor de `responsable_iva` NO se toca aquí; se aplica al aprobar (ver `src/services/fiscalRevision.js`).
- Índice parcial `idx_usuarios_revision_pendiente` para la cola del panel.
- Reejecutable: `ADD COLUMN IF NOT EXISTS` y constraints guardados por nombre.

## 154: estado operativo del proveedor (Modo Exploración)

- Crea `usuarios.estado_operativo` (`EXPLORACION`, `EN_VERIFICACION`, `HABILITADO`, `SUSPENDIDO`), su fecha de cambio y el motivo, más la bitácora append-only `estado_operativo_historial`.
- Separa "qué documentos tiene" de "qué puede hacer": hasta ahora `onboarding_completo` respondía las dos cosas y obligaba a subir cédula, RUT y certificado antes de ver la app.
- **Backfill con abuelo**: quien ya operaba queda `HABILITADO`; exploración es default sólo para cuentas nuevas. Sin esto, el despliegue le cortaría la venta a los prestadores activos.
- Índice parcial para listar los que no están habilitados (el panel de conversión).

## 155: slug de la vitrina pública del proveedor

- Agrega `usuarios.slug` con índice único por `LOWER(slug)` (sólo filas con slug).
- Es el identificador del perfil público `/p/<slug>` de D-GL-031: un proveedor en exploración comparte el enlace y muestra su perfil con el sello "aún no recibe reservas", sin botón de reserva.
- Se guarda y no se recalcula: forma parte del enlace que el proveedor comparte.
- No siembra slugs: se generan al publicar la vitrina, para no inventar identificadores de quienes nunca la usen.

## 156–159: protección de cuentas de retiro y autorizaciones

- 156 agrega estado de verificación, campos del titular y respaldo del último destino aprobado para `provider_wallet`.
- 157 registra desafíos de correo de un solo uso para cambios de cuenta; 158 conserva la cuenta aprobada previa y aplica el periodo de protección tras una modificación.
- 159 registra desafíos de correo para retiros, con expiración, límite de intentos, uso único y vínculo al hash de monto/ciclo/destino.
- Las tablas de desafíos aplican RLS y privilegios explícitos para los roles de aplicación.

## 177: reparación RLS de métricas logísticas

- Elimina la comparación inválida entre `zona_id` y `app.tenant_id`: una zona logística no identifica por sí sola a su tenant.
- Hasta que exista esa relación en el esquema, `app_rls_user` queda sin lectura ni escritura en `logistica_metricas_diarias`; `app_system` conserva acceso para jobs operacionales.
- Vuelve a declarar `fn_actualizado_en()` para que la migración 170 pueda crear su trigger en instalaciones donde la función no existía.
- Es idempotente y repara instalaciones donde la migración 173 ya quedó registrada y el runner la omitiría.

## 178: actualización incremental del catálogo DIVIPOLA

- Conserva intacta la migración histórica 167 para evitar deriva de checksum en bases ya existentes.
- Amplía las columnas requeridas y carga los 1.122 registros DIVIPOLA por código DANE, sin sobrescribir vínculos de zona preexistentes.
- Crea y enlaza zonas base faltantes, sin confundirlas con zonas de prefijo postal; elimina el código ficticio `99999`.
- Reejecutable dentro de una transacción y verificada contra el esquema histórico que ya tenía 167 registrada.

## 179: mensajes de disputas

- Agrega el hilo de respuestas y notas internas vinculado a la disputa y al tenant.
- Aplica RLS para el rol de aplicación y acceso explícito al rol de sistema usado por los endpoints administrativos.

## 181: peso opcional de producto para fulfillment

- Agrega `productos.peso_kg` como `NUMERIC(8,3)` nullable para que el orquestador de fulfillment pueda leer el peso cuando exista.
- No altera filas existentes ni inventa pesos; el código conserva el fallback de 0,5 kg cuando el campo queda `NULL`.
## 182: alineación de zona en métricas logísticas

- Usa ciudad y departamento persistidos en `envios.destino_ciudad` y `envios.destino_departamento`, columnas del contrato 174.
- No añade columnas ficticias a `pedidos_tienda`; conserva intacta la migración 180 ya desplegada.
- Reemplaza la función agregadora y se aplica tanto en bases nuevas como en arranque idempotente.

## 183: suspensión de visibilidad pública de usuarios

- Añade `usuarios.visibilidad_suspendida`, independiente de `is_active`, para ocultar y restaurar perfiles públicos sin bloquear el inicio de sesión.
- La búsqueda pública, la ficha del proveedor y la vitrina pública omiten perfiles suspendidos; en salones también se comprueba el estado del usuario dueño.
- La acción administrativa queda restringida a cuentas `PRESTADOR` y `SALON`, y registra auditoría.

## 184: solicitudes de cambio de datos fiscales

- Guarda los nuevos datos del RUT y su soporte en columnas separadas mientras están pendientes de revisión.
- Los datos fiscales efectivos solo se reemplazan cuando un administrador aprueba el documento.
- Migra las solicitudes pendientes/rechazadas del flujo anterior sin alterar prestadores ya aprobados.

## 185: número consecutivo visible para citas

- Agrega `bookings.booking_number` como identidad consecutiva única para mostrarla en la app.
- Conserva `bookings.id` UUID como clave primaria y como referencia usada por pagos, PQRSF y demás relaciones.

## 186: protección de destinos de retiro y plazo de revisión

- Amplía a `TEXT` los campos que guardan cuentas y datos identificatorios cifrados, incluidos los snapshots de retiro.
- Añade el parámetro `payout_account_review_sla_hours` con objetivo inicial de 48 horas calendario.
- La migración SQL prepara el esquema; las filas existentes se cifran después con `node scripts/encryptPayoutData.js` y `PAYOUT_DATA_ENCRYPTION_KEY`.

## 187: soportes excepcionales y métricas del flujo de cuentas de retiro

- Registra sesiones del prestador para medir inicios, envíos, abandonos, revisiones, aperturas de soporte y fallos de transferencia.
- Permite solicitar soporte de titularidad solo ante una diferencia, rechazo de transferencia o revisión de seguridad; la evidencia se cifra y se elimina a los 30 días.
- No integra verificación bancaria automática para cuentas tradicionales; la revisión permanece administrativa.

## 188: acceso del prestador a su billetera bajo RLS

- Permite al prestador leer y registrar su propia `provider_wallet`, incluso cuando su cuenta no tiene `tenant_id`.
- Mantiene el aislamiento por tenant para las filas pertenecientes al tenant y elimina políticas históricas que podrían ampliar permisos por OR.
- Fija también el contexto de tenant en la transacción de registro de cuenta cuando está disponible.

## 189: relación explícita entre sede y perfil SaaS

- Añade `salones.business_profile_id` como vínculo explícito y nullable hacia `business_profiles`.
- Completa las sedes existentes con el mapeo histórico `salon-<id>` únicamente durante el backfill; el código de ejecución deja de reconstruir esa identidad para resolver relaciones.
- No altera `salones.tenant_id`, que continúa siendo el identificador legado entero hacia `tenants`.
- La migración es aditiva y deja pendiente convertir la columna a `NOT NULL` hasta conciliar toda fila de producción.

## 190: gobierno de membresías SaaS

- Extiende `memberships` para soportar invitaciones nominales a usuarios registrados, vencimiento y hash de token; conserva compatibles las columnas históricas de invitación.
- Añade estados de baja/expiración y una bitácora append-only de invitación, aceptación, cambio de rol, suspensión y retiro.
- Conserva `user_id` obligatorio y el índice único existente; la invitación se envía a una cuenta GlowApp existente y se valida de nuevo contra el correo al aceptar.
- No migra ni elimina filas existentes; los datos de membresía actuales permanecen.

## 191: alcance de negocio y sede en servicios y reservas

- Añade a `services` el perfil SaaS y la sede propietaria, y a `bookings` la sede donde ocurre la reserva.
- Completa únicamente relaciones inequívocas: perfiles únicos por prestador, sedes únicas por perfil y sede heredada del servicio para reservas existentes.
- Mantiene `NULL` en relaciones ambiguas para revisión; crea claves foráneas `NOT VALID` para proteger nuevas escrituras sin bloquear la migración por datos históricos aún no conciliados, incluidas relaciones compuestas para que sede y negocio coincidan en servicios y reservas.
- Conserva los servicios asociados al negocio sin sede fija: pueden reservarse en una sede del mismo negocio. Rechaza con error explícito las reservas de servicios sin negocio cuando la atribución es ambigua.
- Es aditiva. Si se revierte la aplicación, volver a la versión anterior del backend y conservar las columnas/datos para evitar pérdida histórica.

## 192: registro de entregas de recordatorios de reservas

- Crea una bitácora por negocio, reserva, tipo de recordatorio y canal (push/correo), con estado, proveedor, identificador externo, error y costo real cuando esté disponible.
- No vuelve a enviar entregas confirmadas; el claim evita concurrencia. Si el proveedor acepta un mensaje y el proceso cae antes de registrar la respuesta, el resultado externo es ambiguo y el reintento puede duplicar el mensaje porque FCM/SMTP/Brevo no comparten una clave de idempotencia.
- Los mensajes se cuentan por canal y no incrementan `ONLINE_BOOKING`.
- Conserva el contador de intentos por entrega cuando un proveedor falla, para distinguir intentos de mensajes aceptados.
- Costos no informados por el proveedor permanecen `NULL`; no se imputan valores estimados.
- La tabla aplica RLS mediante una membresía activa y el usuario autenticado. La migración 192 otorga `SELECT` directo al rol RLS y escrituras al rol de sistema; la migración 193 revoca privilegios directos de escritura que venían de los privilegios por defecto del esquema. La membresía existente de `app_rls_user` a `app_system` permite al backend cambiar de rol explícitamente dentro de operaciones de sistema confiables; RLS no reemplaza esa frontera de confianza. La retención depende del negocio y la política de datos; no se guarda cuerpo del mensaje ni dirección de correo.
- Migración aditiva. Rollback operativo: volver a la versión anterior; no borrar filas ni tabla si ya hay bitácora de producción.

## 193: privilegios directos de lectura para ledger de recordatorios

- Revoca todos los privilegios directos de tabla/secuencia del ledger a `app_rls_user` y concede únicamente `SELECT` sobre la tabla.
- Conserva las escrituras para `app_system`, que el backend utiliza mediante transacciones de sistema explícitas.
- No elimina ni modifica filas del ledger.


## 197: lectura de perfiles SaaS por membresía activa

- Añade una política SELECT para app_rls_user que deja leer business_profiles al proveedor propietario o a un usuario con membership ACTIVE.
- Corrige el caso del onboarding en el que el tenant se crea, pero el contexto de tenant legado no coincide con business_profiles.tenant_id; bootstrap y saasContext dejaban de encontrar la membership válida.
- La política existente de aislamiento por tenant se conserva. No se conceden permisos de escritura ni acceso por el identificador de salón enviado en la petición.
- La migración es aditiva e idempotente. Rollback: DROP POLICY IF EXISTS business_profiles_active_membership_read ON public.business_profiles.


## 198: horario comercial de la sede

- Añade `salones.horario_atencion` para guardar los días y horas generales de apertura del establecimiento.
- Mantiene separada la disponibilidad individual de cada profesional, que continúa en `perfiles_prestador.weekly_schedule`.
- Permite dejar el horario sin configurar y completarlo o editarlo después desde el perfil del salón.

## 199: propietario de servicios compatible con salones SaaS

- Alinea `services.provider_id` con el usuario dueño del catálogo (`usuarios.id`), como ya establece la migración 054.
- Permite que un salón SaaS cree servicios aunque su propietario no sea un prestador individual con fila en `perfiles_prestador`.
- Conserva las filas existentes: la FK se valida contra usuarios y cada perfil individual existente ya referencia a un usuario.
- No cambia la pertenencia al negocio ni a la sede, que siguen protegidas por `business_profile_id` y `salon_id`.

## 200: RLS de membresías SaaS y auditoría de equipo

- Activa y fuerza RLS para `memberships` y `membership_audit_logs` bajo el rol de aplicación.
- Un miembro puede leer su propia membresía; un miembro activo puede leer el equipo y la auditoría del perfil SaaS seleccionado.
- OWNER/ADMIN pueden gestionar membresías dentro de ese perfil. El alta inicial de OWNER solo se admite para el proveedor del perfil cuando aún no hay membresías.
- El invitado solo puede activar su propia invitación pendiente y no puede cambiar el rol, el correo, el perfil ni el usuario asociado.
- La auditoría permite insertar eventos autorizados, pero no actualizar ni borrar registros.
- Añade funciones `SECURITY DEFINER` de alcance limitado para resolver datos mínimos del equipo y buscar el correo de destino; no se exponen consultas libres sobre `usuarios`.
- Es aditiva. Reversión: desplegar código compatible anterior y retirar las políticas/triggers únicamente después de confirmar que no hay escrituras que dependan del nuevo contrato; no se borran filas.

## 201: facturación recurrente SaaS con Wompi

- Añade a `subscriptions` datos de facturación, consentimiento y fuente de pago cifrada, junto con el número de reintentos y la marca/últimos cuatro dígitos de tarjeta.
- Crea `saas_billing_attempts` como ledger por tenant, con referencias únicas, intentos abiertos únicos y RLS en `app.business_profile_id`.
- La fuente reutilizable nunca almacena PAN ni CVC; su ID cifrado se conserva solo donde se necesita para la renovación.
- Es aditiva. Despliegue confirmado en Railway producción el 26 de noviembre de 2026; el worker y checkout quedaron desactivados por configuración.

## 202: ciclo de vida de prueba gratis SaaS

- Añade inicio y vencimiento a la prueba gratuita de cada tenant.
- Los tenants `FREE_TRIAL` existentes reciben una ventana de transición de 14 días desde la migración; no se degradan al desplegar.
- El bootstrap nuevo guarda los 14 días declarados en el catálogo y devuelve la fecha a la app para mostrarla en Facturación.
- Un job aislado pasa a Freemium únicamente las pruebas vencidas y sincroniza el plan en el perfil SaaS y sus sedes. No envía correos ni modifica suscripciones pagas.
- Es aditiva; al revertir la lógica/job se conserva el nivel actual de cada tenant. No borrar columnas ni modificar planes automáticamente durante rollback.

## 203: derechos heredados de la prueba gratis SaaS

- Los salones que ya tenían `FREE_TRIAL` al desplegar la corrección pasan a `FREE_TRIAL_LEGACY`, que conserva sus capacidades y cuotas anteriores y no se ofrece a nuevas altas.
- El catálogo nuevo elimina del plan de prueba las capacidades sin flujo SaaS entregable: marca personalizada, WhatsApp, Aura para negocio, analítica avanzada y facturación electrónica de prueba.
- Se sincroniza el código del backend, la comparación de planes, el fallback de Flutter y la expiración de prueba. Al vencer, los planes de prueba nuevos y heredados pasan a Freemium; el registro de auditoría conserva el plan de origen.
- La migración conserva el vencimiento ya asignado y solo crea 14 días cuando falta fecha; no modifica suscripciones ni cargos.
- Es reversible volviendo al catálogo y al código anterior y restaurando `FREE_TRIAL` desde `FREE_TRIAL_LEGACY` únicamente para tenants que sigan en prueba. No eliminar la columna de vencimiento ni alterar datos de suscripción.

## 204: métrica de reservas directas SaaS

- Añade `DIRECT_BOOKINGS` a la restricción de `usage_metrics.feature`, junto con las métricas ya admitidas.
- Corrige el error de integridad que rechazaba todas las escrituras del contador aunque catálogo y código ya usaban esta métrica.
- Es aditiva para datos: reemplaza la CHECK constraint sin cambiar filas existentes. Rollback: retirar el código que escribe `DIRECT_BOOKINGS` y recrear la restricción anterior solo si no quedan filas con esa métrica.

## 205: resolución segura de claves API SaaS

- Añade una función `SECURITY DEFINER` de alcance estrecho que resuelve una clave activa únicamente por su hash y devuelve el tenant, plan y scopes necesarios para iniciar RLS.
- La función no expone el hash ni información de claves revocadas o expiradas y solo se concede al rol de runtime.
- Es aditiva. Rollback: retirar el endpoint de integraciones y luego eliminar la función.

## 206: tarifa de reserva en citas

- Garantiza que `bookings.tarifa_reserva`, usado por el controlador al crear citas, exista en instalaciones reconstruidas.
- No reaplica la migración 011, que también reemplazaba el trigger de comisiones.
- Aditiva e idempotente; rollback: eliminar la columna solo tras retirar sus usos y verificar los datos existentes.

## 207: métrica de consultas Aura para negocio

- Permite `AURA_QUERIES` en la restricción de uso SaaS para que el contador del catálogo pueda persistirse.
- El incremento se limita a una membresía activa y al plan que tenga `AURA_BUSINESS`; el upsert aplica límite mensual bajo bloqueo transaccional.
- No habilita los planes Growth/Pro/Enterprise ni cambia cuotas. Es aditiva; rollback: retirar primero el consumo de Aura y recrear la restricción anterior solo si no quedan métricas `AURA_QUERIES`.

