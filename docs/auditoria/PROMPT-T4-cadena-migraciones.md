# PROMPT — T4: cadena de migraciones que arranca en base nueva

> Entregar íntegro al chat desarrollador. Hay un revisor que evalúa con evidencia. T4 toca el entrypoint que arranca la API en producción: si se rompe, el contenedor queda en `Crashed` y el servicio cae. Nada se da por bueno sin dos arranques seguidos en base limpia.

---

## 1. Contexto verificado (no lo repitas, parte de aquí)

Repo `C:\Users\Compu casa\glowapp-firebase`, rama `main` en `e01b664`, árbol limpio. Backend Express + PostgreSQL con RLS; el entrypoint `backend/scripts/prepareRlsDatabase.js` aplica una lista curada de migraciones **en cada arranque** y **aborta si alguna falla**.

Hoy, medido en local con Docker (`postgis/postgis:16-3.4`, base `glowtest`, `trust`):

**A) Con la configuración del CI** (`MIGRAR_OMITIR=123_checkout_tenant_wompi.sql`):

```
📦 Base vacía: se aplica el esquema completo (init.sql incluido)
[OK] … 22 migraciones …
[ERROR] 129_otp_codigo_cifrado.sql: relation "otp_validaciones" does not exist
```

→ El paso 5 del workflow (`prepareRlsDatabase`) **está roto en `main`**, no solo por la facturación de Actions.

**B) Sin omitir la 123**, en base limpia:

```
[ERROR] 123_checkout_tenant_wompi.sql: 123: faltan columnas tenant_id (encontradas: 0)
```

→ Faltan `006` y `010`, que crean `booking_productos`, `pedidos_tienda`, `detalles_pedido_tienda` e `inventario_consignacion_prestador`.

**C) Al añadir los padres (001, 006, 010) delante, aparece otra cosa:**

```
[OK] init.sql
[OK] 054_create_core_tables.sql
[ERROR] 001_payment_system.sql: column "descripcion" of relation "platform_config" does not exist
```

→ `001_payment_system.sql:79` y `054_create_core_tables.sql:124` **crean la misma tabla** `platform_config` con columnas distintas (`descripcion` vs `description`). `CREATE TABLE IF NOT EXISTS` convierte la segunda en no-op: gana la que corre primero (054), y el `INSERT INTO platform_config (key, value, descripcion)` de la 001 (`:88`) revienta.

**D) Conflicto de la 125 con 068/084** (medido antes): las tres definen `app_usuario_por_email`, con `RETURNS SETOF usuarios` (068/084) y `RETURNS TABLE (…)` (125). `CREATE OR REPLACE` no puede cambiar el tipo de retorno: meter la 125 en la lista hace que **el segundo arranque** muera con `cannot change return type of existing function`.

**Dato que abarata la decisión:** el código solo lee `key` y `value` de `platform_config` (`providerController.js:26`, `paymentJobs.js:43`, `paymentRoutes.js:25`). Ninguna de las dos columnas de descripción se usa en ninguna parte.

---

## 2. Reglas (no negociables)

1. **Nada de esto toca producción.** No ejecutes el entrypoint contra `DATABASE_URL` de Railway. Si necesitas leer algo de producción, pídelo y se autoriza por separado; no lo hagas por iniciativa.
2. **No toques**: `ce334fab`, el trigger `enforce_append_only`, ni el rol de conexión.
3. Todo se prueba en Docker local con `postgis/postgis:16-3.4`.
4. Un commit por paso, en español, push a `main` **y** `staging`.
5. Evidencia con salida de comando. `E2` ejecución · `E1` lectura · `E0` no verificable. Un «debería funcionar» se rechaza.
6. No ocultes fallos con tuberías: `cmd > log 2>&1; rc=$?; tail …`.
7. Si aparece algo fuera de alcance, se anota y se reporta; no se arregla de paso.

**Autorización requerida** para escribir en migraciones o en el entrypoint:

```
AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — GLOWAPP-CLIENTE
```

---

## 3. Trabajo, en cuatro pasos con puerta de revisión

### Paso 1 — Barrer las colisiones antes de arreglar nada (solo lectura)

Las 127 migraciones no han convivido nunca en una base nueva, así que puede haber más `CREATE TABLE` duplicados con columnas divergentes, además de `platform_config`.

**Qué hacer:**
1. Script (puede ser Python o Node) que recorra `backend/migrations/*.sql`, extraiga cada `CREATE TABLE [IF NOT EXISTS] <tabla> ( … )` y agrupe por nombre.
2. Reportar: tablas definidas más de una vez, con la lista de columnas de cada versión y **el diff** entre ellas.
3. Para cada colisión: decir qué migración corre primero en la lista actual del entrypoint y, por tanto, qué columnas existen de verdad.

**Entregable del paso 1: solo el informe.** No toques SQL todavía. Es una puerta: el revisor decide el orden de arreglo con esa tabla delante.

### Paso 2 — Unificar `platform_config`

Decisión propuesta (confírmala con el informe del paso 1): **gana `description`**, que es la que hoy existe en bases nuevas porque la 054 corre antes.

**Qué hacer:**
1. Ajustar `001_payment_system.sql`: el `INSERT` debe usar `description` (o la columna que sobreviva).
2. Si la 001 necesita `descripcion` para algo más, cambiar solo lo mínimo y justificarlo.
3. Probar: base limpia → 001 y 054 aplican sin error.

### Paso 3 — Reincorporar los padres y la 125

**Qué hacer:**
1. Añadir `001_payment_system.sql`, `006_legal_architecture_pila_consignacion.sql` y `010_implement_glowstore_schema.sql` **antes** de la 123 (después de `054`), solo si el paso 1 no reveló más bloqueos.
2. Añadir `125_usuario_lookup_sin_contexto.sql` **al final** (después de `124`).
3. Poner `DROP FUNCTION IF EXISTS app_usuario_por_email(text);` antes del `CREATE OR REPLACE` en **068, 084 y 125**, para que el arranque converja siempre a la misma firma. Verifica antes que ninguna política ni vista dependa de esa función (hoy no la usa ninguna; compruébalo otra vez).
4. Comprobar que los llamadores siguen servidos: `oauthController.js:102` y `:262` seleccionan `id, nombre, email, rol, auth_provider, provider_id, tenant_id, onboarding_completo`, que son columnas que la firma de la 125 devuelve.

### Paso 4 — La prueba que decide

En base **vacía**, con la lista definitiva:

```bash
docker rm -f glowapp-ci 2>/dev/null
docker run -d --name glowapp-ci -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=glowtest -e POSTGRES_HOST_AUTH_METHOD=trust -p 55432:5432 postgis/postgis:16-3.4
# esperar a que acepte consultas, no solo pg_isready
until docker exec glowapp-ci psql -U postgres -d glowtest -tAc "select 1" >/dev/null 2>&1; do sleep 2; done

export DATABASE_URL_ADMIN="postgres://postgres@127.0.0.1:55432/glowtest"
export RLS_ROLE_PASSWORD="test_rls_password"

node backend/scripts/prepareRlsDatabase.js   # arranque 1
node backend/scripts/prepareRlsDatabase.js   # arranque 2 — el que de verdad importa
```

**Criterios de aceptación:**

| # | Criterio |
|---|---|
| 1 | Arranque 1 en base vacía: `exit 0`, sin ningún `[ERROR]`, y la lista completa de `[OK]` |
| 2 | Arranque 2 sobre la misma base: `exit 0` también (idempotencia real) |
| 3 | `select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname='app_usuario_por_email'` → **una sola fila** |
| 4 | `node backend/scripts/verifyTenantIsolation.js` con `TEST_DATABASE_URL=postgres://app_owner@127.0.0.1:55432/glowtest` → verde |
| 5 | La 129 ya no falla: `otp_validaciones` existe |
| 6 | La 123 aplica sin `MIGRAR_OMITIR` |

Si el paso 4 revela un tercer conflicto, **para y reporta**; no improvises sobre el entrypoint.

---

## 4. Formato del reporte

```
PASO <n> — <título>
Commit: <hash>   Rama: main + staging

Cambios
- archivo:línea — qué y por qué

Verificación
- <comando> → <salida resumida> (exit 0 / n filas)
- arranque 1: exit ? · arranque 2: exit ?
- app_usuario_por_email: n filas en pg_proc

Evidencia
- <E0-E3> — qué se comprobó y con qué

Riesgos y pendientes
- …
```

Al cerrar el paso 4, añade el JSON:

```json
{"tarea":"T4","estado":"completa|parcial|bloqueada","evidencia":"E2",
 "arranques":[1,2],"colisiones":["platform_config"],"falta":["…"]}
```

**El paso 1 se reporta solo, sin tocar código, y se espera revisión antes de seguir.**

---

## 5. Lo que el revisor ya sabe y va a comprobar

- Que el arreglo no sea «omitir la 123 y la 129 para que pase»: omitir deja el esquema incompleto y rompe esas rutas en silencio. Si propones omitir algo, justifica qué endpoint queda muerto y por qué es aceptable.
- Que no modifiques la 068 o la 084 más allá de la línea del `DROP`.
- Que el segundo arranque esté probado de verdad. Es el que tumbó producción con la 126.
- Que `git status` quede limpio: nada de scripts temporales olvidados ni bases de datos de prueba dentro del repo.
