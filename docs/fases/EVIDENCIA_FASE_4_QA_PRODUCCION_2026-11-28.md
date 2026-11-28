# Fase 4 SaaS — evidencia QA en producción

**Fecha:** 28 de noviembre de 2026

**Entorno:** Railway `production`
**Commit final:** `59005823ade4b762a7c1572c8852355921504282`

Este informe complementa el registro de la [Fase 4 Equipo y permisos](ONBOARDING_FASE_4_EQUIPO_PERMISOS.md) con las verificaciones ejecutadas sobre las cuentas QA existentes.

## Defecto corregido

La cuenta ADMIN autenticaba con membresía activa y perfil `salon-18`, pero el panel no encontraba su salón. La base registraba `208_saas_membership_salon_read.sql`, aunque en `pg_policies` solo aparecía `tenant_isolation`. La migración 208 había podido finalizar y registrarse sin crear la política cuando faltaba un prerrequisito.

Se incorporó `209_repair_saas_membership_salon_read.sql`. Comprueba que existan `app_rls_user`, `salones`, `memberships` y `app_current_user_id()`; si falta alguno, aborta. La política añadida permite únicamente `SELECT` cuando el usuario autenticado tiene una membresía `ACTIVE` en el perfil empresarial enlazado. La política de aislamiento por tenant se conserva.

## Evidencia de despliegue y CI

- Commit final publicado en `main`: `59005823ade4b762a7c1572c8852355921504282`.
- Railway deployment `a40efa37-f296-497f-ad22-c83e2cc49079`: `SUCCESS`.
- `GET /api/health`: `env=production`, `dbMode=postgres`, base disponible, sin datos ficticios y 81 migraciones registradas.
- `schema_migrations` registra `209_repair_saas_membership_salon_read.sql` a las 09:15 UTC.
- `pg_policies` confirma `salones_active_membership_read` (`SELECT`, rol `app_rls_user`) y `tenant_isolation` (`ALL`, `public`).
- Backend CI run [46130930810](https://github.com/Diegoromerov/glowapp-firebase/actions/runs/46130930810): `success`. Integración PostgreSQL: 11/11 suites y 40/40 pruebas; contratos PostgreSQL: 4/4 suites y 44/44 pruebas. El guard de aislamiento verificó la política de tenant y la lectura SaaS limitada a membresía activa.
- `migrationsNoDuplicateNumbers.test.js`: 7/7 pruebas aprobadas localmente.

## Matriz de acceso productiva

La verificación autenticó las ocho cuentas QA existentes con el rol PostgreSQL restringido `app_rls_user` (`superuser=false`, `bypasses_rls=false`). No modificó membresías ni envió correo.

| Caso | Resultado |
| --- | --- |
| OWNER, ADMIN y MANAGER consultan el equipo de su salón | HTTP 200, tres miembros del salón propio |
| MEMBER y VIEWER consultan el equipo | HTTP 403 |
| Cliente y usuario sin membresía acceden al equipo | HTTP 403 `NO_ACTIVE_MEMBERSHIP` |
| ADMIN del salón A intenta leer salón B usando encabezado | HTTP 200, solo datos del salón A |
| ADMIN cambia contexto al salón B | HTTP 403 `MEMBERSHIP_NOT_FOUND_OR_INACTIVE` |
| Cuarto asiento en el plan `FREE_TRIAL` | HTTP 403 `SAAS_QUOTA_EXCEEDED`; quedan 3/3 asientos |
| ADMIN abre `GET /api/saas/bootstrap` | HTTP 200, tenant `salon-18` |
| ADMIN abre `GET /api/salon/my-salon` | HTTP 200, sede QA 18 |
| Analítica avanzada en `FREE_TRIAL` | HTTP 403, según entitlement |

Los salones QA 18 y 19 siguen en `FREE_TRIAL`, con tres asientos activos cada uno.

## Pendientes de validación

- **Sonia:** debe confirmar su acceso y rol desde su propia sesión. La cuenta de Sonia ya había aceptado una invitación; no se generó ni reenvió otra.
- **Smoke visual ADMIN:** no quedó evidencia concluyente. La pestaña del proveedor se mostró en blanco y el control de navegador se interrumpió antes de inspeccionar la causa. Los endpoints que alimentan el panel sí respondieron HTTP 200 tras el arreglo.

**Avance estimado de Fase 4: 95 %.** Las reglas RBAC, aislamiento, cupos y lectura SaaS se comprobaron en PostgreSQL/producción. La fase sigue abierta hasta completar el smoke visual y recibir la confirmación de Sonia.
