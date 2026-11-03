# Plan Fase 6 — RLS en producción (app_rls_user)

**Objetivo**: Hacer que RLS sea efectiva en producción cambiando la conexión principal de `postgres` (superusuario) a `app_rls_user` (rol aislado), y crear conexión de sistema `app_system` para webhooks/cron.

**Estado actual (verificado)**:
- CI valida RLS con `app_rls_user` / `app_owner` ✅ (run 41586542898: 26 tablas con tenant_id, 26 con FORCE, aislamiento verificado)
- `setupRlsRole.sql` crea roles y grants ✅
- `tenantRouting.js` maneja transacción por petición con `SET LOCAL app.tenant_id` ✅
- `RLS_ROLE_PASSWORD` existe en Railway (variable de `glowapp-api`) ✅
- Producción conecta como `postgres` → ignora FORCE RLS (P-092 abierta) ❌

---

## Paso 1 — Preparar variables y entrypoint

**1.1** Añadir `DB_SYSTEM_URL` a Railway (mismo host/DB, usuario `app_system`, sin password porque es NOLOGIN y se usa vía `SET LOCAL ROLE` desde `app_rls_user`).

**1.2** Modificar `backend/entrypoint.sh` para:
- Ejecutar `setupRlsRole.sql` al arranque (idempotente)
- Validar que `RLS_ROLE_PASSWORD` esté seteada
- Construir `DATABASE_URL` para `app_rls_user` a partir de la URL original

**1.3** Modificar `backend/src/config/db.js`:
- Leer `DATABASE_URL` (app_rls_user) y `DB_SYSTEM_URL` (app_system) por separado
- El pool principal usa `app_rls_user`
- `tenantRouting.runAsSystem` usa conexión de sistema

---

## Paso 2 — Despliegue a Staging

**2.1** Aplicar variables en `glowapp-api-staging`:
- `RLS_ROLE_PASSWORD` (ya existe)
- `DB_SYSTEM_URL` = `postgres://app_system@<host>/<db>`

**2.2** Deploy a staging y verificar:
- `/api/health` → 200, `database.pgAvailable: true`
- `/api/providers` con `X-App-Audience: client` → 200, datos filtrados por tenant
- Webhook Wompi → 200 (usa `runAsSystem`)
- Logs: `app_rls_user` conectado, no `postgres`

---

## Paso 3 — Despliegue a Producción

**3.1** Mismas variables en `glowapp-api-production`

**3.2** Deploy y verificación idéntica

---

## Paso 4 — Validación de aislamiento real

**4.1** Query cross-tenant desde app → debe devolver 0 filas (no error, filtrado por RLS)

**4.2** INSERT sin `tenant_id` en tabla con FORCE → debe fallar (42501) o trigger lo rellena

**4.3** `verifyTenantIsolation.js` contra staging/producción (solo lectura) → PASS

---

## Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| `app_rls_user` no tiene permisos en tabla nueva | `setupRlsRole.sql` usa `ALTER DEFAULT PRIVILEGES`; entrypoint lo corre en cada arranque |
| Webhook Wompi deja de ver transacciones | `runAsSystem` escala a `app_system` (BYPASSRLS) dentro de transacción |
| Password rota / variable faltante | Entrypoint valida `RLS_ROLE_PASSWORD` y aborta si falta |
| Rollback rápido | `DATABASE_URL` original (postgres) se mantiene como `DATABASE_URL_ADMIN` para migraciones; basta revertir la variable principal |

---

## Criterios de aceptación

- [ ] `setupRlsRole.sql` corre en entrypoint sin error
- [ ] `DATABASE_URL` apunta a `app_rls_user` (logs: `app_rls_user` no `postgres`)
- [ ] `DB_SYSTEM_URL` configurada y usada por webhook/cron
- [ ] Staging: `/api/health` 200, aislamiento verificado
- [ ] Producción: `/api/health` 200, aislamiento verificado
- [ ] P-092 cerrada