# PROMPT — T4 ejecución (pasos 2 a 4): que una base nueva nazca igual que producción

> Continúa el trabajo del paso 1 (barrido de colisiones, ya entregado y revisado). Aquí van las cuatro decisiones del revisor con su evidencia, el esquema real de producción como especificación, y el trabajo con su criterio de cierre.

---

## 1. Decisión de fondo

No se trata de «que el entrypoint no falle». Se trata de que **una base nueva quede estructuralmente igual que producción**. Si diverge, el fallo aparece meses después, en el peor sitio.

La especificación es la base real. Estas son sus columnas hoy (capturadas el 2026-11-05, solo lectura). **No consultes producción tú**: úsalo como fixture y, si necesitas algo más, pídelo.

```
platform_config     key,value,descripcion,updated_at,updated_by,tenant_id
usuarios            id,email,nombre,foto_url,auth_provider,provider_id,password_hash,phone,
                    rol,onboarding_completo,creado_en,is_active,habeas_data_accepted_at,
                    habeas_data_ip,terminos_accepted_at,terminos_ip,glowai_plan,
                    glowai_diagnosticos_mes,glowai_ciclo_reset_at,streak_actual,streak_maximo,
                    streak_ultimo_registro,colorimetria_diagnosticos_mes,colorimetria_mes_referencia,
                    glowstyle_outfits_mes,glowstyle_mes_referencia,tenant_id,worker_type,
                    responsable_iva,tarifa_iva,rut_numero,rut_responsabilidad_codigo,
                    responsable_iva_override,responsabilidad_iva_fuente,
                    responsabilidad_iva_actualizada_at,responsabilidad_iva_cambiada_por,fcm_token
admin_mfa           user_id,secret_key,is_enabled,backup_codes,created_at,tenant_id
productos           id,nombre,descripcion,precio,stock,imagen_url,tag_especialidad,creado_en,
                    tipo_visibilidad,precio_al_publico,precio_con_reserva,precio_prestador,
                    comision_prestador,tenant_id,costo,sku
beauty_profiles     id,user_id,face_scores,hands_diagnosis,recommendation,recommended_products,
                    created_at,updated_at,entry_point
biometric_consents  id,user_id,consent_type,created_at,ip_address,user_agent,revoked_at,granted,
                    granted_at,purpose,version_terms,updated_at
biometric_access_log id,user_id,accessed_at,ip_address,endpoint,user_agent,accessed_by,
                    access_type,consent_id,details
listas_precios      id,codigo,nombre,rol_destino,incluye_iva,vigente_desde,vigente_hasta,estado,
                    tenant_id,creado_en
precios_producto    lista_id,producto_id,precio,unidad_minima,vigente_desde,vigente_hasta,tenant_id
precios_historial   id,lista_id,producto_id,precio_anterior,precio_nuevo,actor_id,origen,motivo,
                    creado_en,tenant_id
webhook_events      id,provider,event_id,event_type,payload_hash,processed_at,result,error_message
```

## 2. Las cuatro decisiones del revisor

**D1 — Los padres van ANTES de la 054.**
Producción tiene la forma de los padres: `usuarios` sin `tipo_usuario`/`email_verificado`/`telefono`; `admin_mfa` con `secret_key`/`is_enabled`; `productos` con `nombre`/`precio`/`imagen_url`; `platform_config` con `descripcion`/`updated_by`. La 054 queda como no-op para esas cuatro tablas, que es lo que ya ocurre en producción.

**D2 — `platform_config` la gana la 001, con `descripcion`.**
No se toca el `INSERT` de la 001: se arregla poniendo la 001 delante. (La propuesta anterior de «gana `description`» queda descartada: era del orden, no de producción.)

**D3 — `biometric_consents`, `biometric_access_log`, `beauty_profiles`: unificar, no elegir ganador.**
Producción tiene la **unión** de las versiones, y esas columnas extra llegaron por `ALTER`. La base nueva debe acabar con la unión, vía `ALTER TABLE … ADD COLUMN IF NOT EXISTS` en la migración que corresponda. No muevas archivos para «que gane» una versión.

**D4 — Los duplicados exactos no se borran.**
`020/027`, `071/121`, `110/111` ya se aplicaron en producción; borrarlos reescribe historia y no aporta. Se quedan como no-op, con un comentario de una línea que lo diga. **Excepción a comprobar**: `precios_producto` necesita `tenant_id` (existe en producción y solo lo declara la 121). Si el `CREATE` de la 121 es no-op porque la 071 corrió antes, hay que añadirlo con `ALTER`, o la 120 (FORCE RLS) dejará esa tabla fuera del aislamiento.

## 3. Trabajo

### Paso 2 — Reordenar y corregir

1. Nuevo orden al inicio del array `MIGRACIONES` en `backend/scripts/prepareRlsDatabase.js`:

```
init.sql → 000_create_usuarios.sql → 001_payment_system.sql → 003 → 006 → 009 → 010
        → 054 → 055 → 056 → 057 → 058 → … → 120 → 121 → 122 → 123 → 124 → 125 → 127 → 128 → 129
```

   Los nombres y números exactos los confirmas leyendo `backend/migrations/`. Justifica cada archivo que añadas que no esté ya en la lista.

2. `125_usuario_lookup_sin_contexto.sql` al final, y `DROP FUNCTION IF EXISTS app_usuario_por_email(text);` **antes del `CREATE OR REPLACE` en 068, 084 y 125**. Comprueba primero que ninguna política o vista depende de la función.

3. Para cada tabla con colisión, tras el reordenamiento: comparar columnas de la base nueva con el fixture de arriba y añadir los `ALTER TABLE … ADD COLUMN IF NOT EXISTS` que falten, en la migración que corresponda (no en una migración nueva al final, salvo que la columna no pertenezca a ninguna existente; si creas una, que sea aditiva e idempotente).

### Paso 3 — Nada de omitir para que pase

`MIGRAR_OMITIR` deja de usarse para 123 y 129: si siguen fallando, es que falta algo, no que haya que esconderlo. Se puede mantener el mecanismo, pero el arranque de referencia debe correr **sin** omitir nada.

### Paso 4 — Verificación (la que decide)

```bash
docker rm -f glowapp-ci 2>/dev/null
docker run -d --name glowapp-ci -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=glowtest -e POSTGRES_HOST_AUTH_METHOD=trust -p 55432:5432 postgis/postgis:16-3.4
until docker exec glowapp-ci psql -U postgres -d glowtest -tAc "select 1" >/dev/null 2>&1; do sleep 2; done

export DATABASE_URL_ADMIN="postgres://postgres@127.0.0.1:55432/glowtest"
export RLS_ROLE_PASSWORD="test_rls_password"

node backend/scripts/prepareRlsDatabase.js   # arranque 1
node backend/scripts/prepareRlsDatabase.js   # arranque 2  ← el que tumbó producción con la 126
```

| # | Criterio | Cómo se demuestra |
|---|---|---|
| 1 | Arranque 1 en base vacía | `exit 0`, cero `[ERROR]`, lista completa de `[OK]` |
| 2 | Arranque 2 sobre la misma base | `exit 0` |
| 3 | `app_usuario_por_email` con una sola firma | `select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname='app_usuario_por_email'` → 1 fila |
| 4 | Aislamiento | `TEST_DATABASE_URL=postgres://app_owner@127.0.0.1:55432/glowtest node backend/scripts/verifyTenantIsolation.js` → verde |
| 5 | `otp_validaciones` existe | `to_regclass('public.otp_validaciones')` no nulo (la 129 aplica) |
| 6 | La 123 aplica sin omitir | sin `MIGRAR_OMITIR`, sin error |
| 7 | **Base nueva ≈ producción** | diff de `information_schema.columns` contra el fixture: **ninguna columna de producción puede faltar**. Las extra se reportan y se justifican |
| 8 | RLS cubre las tablas nuevas | `select count(*) from pg_class where relrowsecurity and relname in ('precios_producto','listas_precios','precios_historial')` → 3 |

Si el paso 4 destapa un quinto conflicto que no está en el informe del paso 1: **para y reporta**. No improvises sobre el entrypoint.

## 4. Reglas

1. **Producción no se toca.** Ningún `node scripts/prepareRlsDatabase.js` con `DATABASE_URL` de Railway. Si algo exige mirar producción, se pide.
2. No toques `ce334fab`, el trigger `enforce_append_only`, ni el rol de conexión.
3. No borres migraciones. No reformatees SQL ajeno: el diff se revisa línea a línea.
4. Commits atómicos en español, push a `main` **y** `staging`. Despliegue web no aplica en esta tarea.
5. Evidencia con salida de comando. Sin ella, la tarea es `parcial`.
6. `git status` limpio al terminar: ni scripts temporales ni bases de prueba dentro del repo.
7. Al terminar: para y reporta. No sigas con T5.

Autorización requerida para tocar migraciones y entrypoint:

```
AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — GLOWAPP-CLIENTE
```

## 5. Formato del reporte

```
T4 — cadena de migraciones
Commit: <hash>   Rama: main + staging

Reordenamiento
- archivos añadidos/movidos y por qué (referido a D1-D4)

Cambios de esquema
- migración:línea — columna/tabla — por qué

Verificación
- arranque 1 → exit ? · arranque 2 → exit ?
- app_usuario_por_email: n filas
- verifyTenantIsolation → resultado
- to_regclass('otp_validaciones') → ...
- diff de columnas vs producción: n faltantes, n extra

JSON
{"tarea":"T4","estado":"completa|parcial|bloqueada","evidencia":"E2",
 "arranques":[1,2],"faltantes":[],"extra":[],"falta":["…"]}
```
