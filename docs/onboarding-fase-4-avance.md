# Onboarding SaaS — Fase 4: equipo y permisos

**Corte de evidencia:** 25 de noviembre de 2026
**Rama del endurecimiento RLS:** `codex/fase4-membership-rls`
**Estado productivo de la fase:** abierta; **65 % de criterios de salida verificados**, según el informe vigente de producción.
**Estado de esta rama:** cambios locales sin commit; migración 200 no aplicada ni desplegada.

> La fase técnica SaaS 3 (membresías) corresponde a la fase 4 del plan de onboarding. No confundir el avance productivo documentado de onboarding (65 %) con la preparación local de la migración RLS descrita abajo (59 % estimado).

## Estado productivo verificado

La implementación canónica de equipo está publicada: membresías, roles, invitaciones, estados, cupos y pantalla de equipo. La evidencia productiva registrada confirma que el OWNER puede consultar equipo/auditoría y que una cuenta autenticada sin membresía es rechazada. Railway registra el despliegue del API en `SUCCESS`; el informe actualizado se integró mediante el commit `15e055c`.

El cierre sigue pendiente porque no se ha hecho el recorrido real de invitación, entrega/aceptación por correo, validación de todos los roles y cupos, ni la consulta específica de políticas RLS para ambas tablas. El rol runtime `app_rls_user` está verificado sin `BYPASSRLS`, pero eso por sí solo no demuestra que `memberships` y `membership_audit_logs` tengan políticas RLS.

## Preparación local adicional de RLS

| Frente del cambio local | Avance estimado | Evidencia / brecha |
|---|---:|---|
| Contexto de usuario y perfil SaaS | 70 % | Middleware y consultas locales fijan el contexto dentro de la transacción; pruebas dirigidas pasan. Falta comprobar rutas con el esquema PostgreSQL desplegado. |
| Membresías, roles y cupos | 60 % | Servicio y pruebas cubren invitaciones, aceptación, cambios y límites; falta integración con el PostgreSQL Railway real. |
| Auditoría e inmutabilidad | 75 % | Migraciones 082, 112, 114, 190 y 200 pasan escenarios RLS en PGlite. Falta probar propiedad, permisos y roles reales del clúster productivo. |
| Bootstrap y recuperación | 80 % | PGlite confirma creación inicial e idempotencia del mismo OWNER activo, y rechaza promoción no autorizada. Falta contrastarlo con el esquema completo. |
| Validación integral del cambio | 35 % | La migración 200 se ejecutó en una transacción temporal sobre el PostgreSQL nativo de producción y se revirtió. Con `app_rls_user` se comprobó acceso del OWNER a su equipo, bloqueo de membresías/auditoría de otros perfiles y funcionamiento de la búsqueda de usuarios del equipo. Aún faltan flujos completos y políticas persistidas. |

**Preparación del cambio estimada: 64 %**, ponderando por igual esos cinco frentes. Es una estimación del cambio propuesto, no el porcentaje de la fase productiva completa.

## Cambios locales

- Se añadió `backend/migrations/200_saas_memberships_rls.sql` para limitar acceso a membresías y auditoría por usuario y perfil SaaS.
- Se conectó la migración a los procesos de preparación RLS y al registro de migraciones.
- Se ajustaron middleware, rutas y consultas para fijar `app.user_id` y el perfil SaaS usando el mismo cliente transaccional.
- Se reforzaron aceptación de invitaciones heredadas y el alta idempotente del propietario.

## Verificación local

- Seis suites dirigidas pasan: **38/38 pruebas**, incluyendo `saasMembershipService`, `salonMembership`, `saasContext`, `saasBootstrapRoutes`, `sequelizeTenantContext` y `membership-management`.
- La suite `membership-management` se actualizó para el contrato actual del controlador PostgreSQL. Ejercita las rutas y la autorización real del router; sustituye solo los middleware de autenticación/contexto, cubiertos por pruebas específicas aparte, y simula el servicio transaccional.
- `node --check` pasó en los archivos JavaScript revisados.
- Las migraciones 082, 112, 114, 190 y 200 pasaron escenarios de RLS en PGlite: alta y reintento del OWNER, invitación, aceptación y auditoría, denegación entre perfiles, bloqueo de cambio de rol del OWNER y protección contra modificación del historial.
- **PostgreSQL nativo de producción:** la migración 200 se aplicó temporalmente dentro de transacciones y se revirtió. Bajo `app_rls_user` pasaron las comprobaciones de propietario, aislamiento entre perfiles, búsqueda de usuarios, creación de invitación, rechazo de lectura por otra cuenta, aceptación y auditoría. La base no conserva los datos de prueba ni la migración. Esta prueba acredita compatibilidad con el esquema productivo actual, pero no equivale a despliegue.
- `git -c core.whitespace=cr-at-eol diff --check` debe usarse para respetar los archivos CRLF del repositorio; la comprobación sin esa opción reporta los finales CRLF de `salonController.js` como espacios finales.

## Pendientes antes de publicar la migración 200

1. Integrar el cambio sobre el `main` productivo vigente, ejecutar CI relevante y desplegar backend/migración.
2. Confirmar en la base productiva que la migración quedó registrada y que ambas tablas tienen RLS habilitado/forzado con las políticas esperadas.
3. Comprobar invitación, aceptación por token/correo, cambio de roles, cupos concurrentes y bootstrap idempotente en las rutas completas.
4. Confirmar que todas las lecturas/escrituras del servicio funcionan bajo el nuevo contexto y que la auditoría sigue siendo append-only.

## Decisión

La fase de onboarding permanece abierta. La versión de equipo y permisos está desplegada parcialmente en producción; el refuerzo RLS de esta rama aún no está publicado. La migración 200 pasó una prueba transaccional en el PostgreSQL productivo real y fue revertida; no se debe contar como desplegada hasta verificar su aplicación persistente y los flujos completos.
