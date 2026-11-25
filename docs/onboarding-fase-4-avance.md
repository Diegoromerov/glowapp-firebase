# Onboarding SaaS — Fase 4: equipo y permisos

**Corte de evidencia:** 25 de noviembre de 2026
**Rama del endurecimiento RLS:** `codex/fase4-membership-rls`
**Estado productivo de la fase:** abierta; **75 % de criterios de salida verificados**.
**Despliegue:** commit `8efabdfec726360425f3fc54406e53550fb17f0d`; Railway `ea6b9b44-f99f-4c50-8441-066622b5f6d2` (`SUCCESS`).

> La fase técnica SaaS 3 (membresías) corresponde a la fase 4 del plan de onboarding. El 75 % es un estimado de criterios de salida cumplidos; los recorridos E2E de correo, matriz completa de permisos y cupos siguen pendientes.

## Estado productivo verificado

La implementación canónica de equipo está publicada: membresías, roles, invitaciones, estados, cupos y pantalla de equipo. La migración 200 también está aplicada en producción. El OWNER puede leer su propio equipo bajo `app_rls_user` y el sondeo de otros perfiles queda aislado; Railway y `/api/health` confirman el despliegue correcto.

El cierre sigue pendiente porque no se ha hecho el recorrido real de invitación, entrega/aceptación por correo, validación de todos los roles ni pruebas de cupo concurrente y reactivación.

## Preparación local adicional de RLS

| Frente del cambio local | Avance estimado | Evidencia / brecha |
|---|---:|---|
| Contexto de usuario y perfil SaaS | 70 % | Middleware y consultas locales fijan el contexto dentro de la transacción; pruebas dirigidas pasan. Falta comprobar rutas con el esquema PostgreSQL desplegado. |
| Membresías, roles y cupos | 60 % | Servicio y pruebas cubren invitaciones, aceptación, cambios y límites; falta integración con el PostgreSQL Railway real. |
| Auditoría e inmutabilidad | 75 % | Migraciones 082, 112, 114, 190 y 200 pasan escenarios RLS en PGlite. Falta probar propiedad, permisos y roles reales del clúster productivo. |
| Bootstrap y recuperación | 80 % | PGlite confirma creación inicial e idempotencia del mismo OWNER activo, y rechaza promoción no autorizada. Falta contrastarlo con el esquema completo. |
| Validación integral del cambio | 60 % | Migración 200 aplicada y comprobada en PostgreSQL productivo; transacciones previas probaron invitación, aceptación, reglas OWNER/ADMIN/MEMBER y auditoría con rollback. Falta recorrer API, correo real, MANAGER/VIEWER y cupos. |

**Cobertura técnica estimada: 69 %**, promedio de esos cinco frentes; no sustituye el 75 % de criterios de salida de la fase.

## Cambios desplegados

- Se añadió `backend/migrations/200_saas_memberships_rls.sql` para limitar acceso a membresías y auditoría por usuario y perfil SaaS.
- Se conectó la migración a los procesos de preparación RLS y al registro de migraciones.
- Se ajustaron middleware, rutas y consultas para fijar `app.user_id` y el perfil SaaS usando el mismo cliente transaccional.
- Se reforzaron aceptación de invitaciones heredadas y el alta idempotente del propietario.

## Verificación local

- Seis suites dirigidas pasan: **38/38 pruebas**, incluyendo `saasMembershipService`, `salonMembership`, `saasContext`, `saasBootstrapRoutes`, `sequelizeTenantContext` y `membership-management`.
- La suite `membership-management` se actualizó para el contrato actual del controlador PostgreSQL. Ejercita las rutas y la autorización real del router; sustituye solo los middleware de autenticación/contexto, cubiertos por pruebas específicas aparte, y simula el servicio transaccional.
- `node --check` pasó en los archivos JavaScript revisados.
- Las migraciones 082, 112, 114, 190 y 200 pasaron escenarios de RLS en PGlite: alta y reintento del OWNER, invitación, aceptación y auditoría, denegación entre perfiles, bloqueo de cambio de rol del OWNER y protección contra modificación del historial.
- **PostgreSQL nativo, antes del despliegue:** la migración 200 pasó una prueba transaccional; invitación, rechazo a otra cuenta, aceptación y auditoría se revirtieron sin dejar datos.
- **PostgreSQL nativo, después del despliegue:** migración 200 registrada; RLS habilitado y forzado en ambas tablas con cinco políticas para `memberships` y cuatro para `membership_audit_logs`. Bajo `app_rls_user` (`BYPASSRLS=false`), el OWNER ve su equipo, no ve otros perfiles y funciona `app_saas_team_user_info`.
- **PostgreSQL nativo, transacción revertida:** ADMIN puede invitar, no cambiar roles; MEMBER no puede invitar; OWNER cambia rol; las filas de auditoría no admiten actualización. La transacción hizo rollback y no dejó datos.
- Railway API: despliegue `ea6b9b44-f99f-4c50-8441-066622b5f6d2` en `SUCCESS`; health check `/api/health` devuelve `OK`, 72 migraciones registradas y la última aplicación corresponde a la migración 200. Los checks de Railway API y admin-dashboard para el commit están en `success`.
- `git -c core.whitespace=cr-at-eol diff --check` debe usarse para respetar los archivos CRLF del repositorio; la comprobación sin esa opción reporta los finales CRLF de `salonController.js` como espacios finales.

## Pendientes para cerrar la fase

1. Comprobar invitación por API, entrega de correo, aceptación con cuenta correcta, rechazo con cuenta distinta, vencimiento y reenvío.
2. Completar por API los permisos de `MANAGER` y `VIEWER`, y el alcance de las acciones de todos los roles por sede.
3. Verificar límite de asientos, concurrencia y reactivación mediante recorridos completos.
4. Confirmar en esos recorridos que la auditoría sigue siendo append-only.

## Decisión

La fase permanece abierta con 75 % de criterios estimados. El refuerzo RLS está desplegado y verificado en el PostgreSQL productivo; faltan recorridos E2E por API/correo, completar la matriz de roles y validar cupos para cerrar el trabajo.
