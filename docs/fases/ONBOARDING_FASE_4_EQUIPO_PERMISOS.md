# Onboarding SaaS — Fase 4: equipo y permisos

**Estado:** correcciones de compatibilidad desplegadas en producción; validación funcional parcial. Fase abierta.
**Corte:** 25 de noviembre de 2026.

## Objetivo y criterio de cierre

Incorporar al personal según el nivel del salón, con invitaciones, aceptación, roles y permisos; impedir que se excedan los asientos incluidos en el plan.

La fase se cierra cuando el flujo de invitación y aceptación funciona con el correo correcto, se rechaza una cuenta distinta, los roles aplican los permisos esperados y las invitaciones/miembros respetan el límite de asientos. También debe comprobarse el aislamiento del equipo entre salones.

## Implementación disponible

- El backend centraliza listar, invitar, aceptar, reenviar, cambiar rol, suspender, reactivar y retirar en `saasMembershipService`.
- `memberships` es la fuente canónica; las invitaciones tienen hash de token, vencimiento de siete días y vinculación al correo invitado.
- `OWNER` cambia roles. `ADMIN` administra invitaciones y estados; no puede cambiar roles ni propiedad.
- Invitaciones activas y pendientes cuentan como asientos. Las operaciones de alta/reactivación/aceptación usan bloqueo del perfil para serializar el cupo.
- La migración 190 creó el historial append-only de auditoría; la API solo lo expone al OWNER/ADMIN del tenant.
- La pantalla de equipo presenta miembros e invitaciones y acciones de suspensión/reactivación.

La implementación se había documentado como desplegada en producción en [FASE_3_MEMBRESIAS_ROLES.md](FASE_3_MEMBRESIAS_ROLES.md). Ese número corresponde al plan técnico SaaS; en el plan de onboarding, equipo y permisos es la Fase 4.

## Evidencia comprobada en producción

Pruebas de solo lectura o denegación de acceso, realizadas con las cuentas QA existentes:

| Escenario | Resultado | Qué demuestra |
| --- | --- | --- |
| Propietario consulta `GET /api/saas/team` | HTTP 200; rol OWNER y un miembro | El propietario resuelve el tenant y puede ver su equipo. |
| Propietario consulta `GET /api/saas/team/audit` | HTTP 200; cero eventos | La ruta de auditoría está disponible para el propietario. |
| Cuenta autenticada sin membresía consulta `GET /api/saas/team` | HTTP 401 | No obtiene contexto ni listado del equipo SaaS. |
| Cuenta autenticada sin membresía solicita `POST /api/saas/team/invite` | HTTP 401 | No puede llegar al servicio que crea invitaciones. No se creó invitación ni se envió correo. |
| La misma cuenta consulta `GET /api/salon/17/members` | HTTP 403 | La ruta heredada de equipo también deniega a quien no pertenece al salón. |
| La misma cuenta solicita `PATCH /api/saas/team/132/role` | HTTP 401 | Una cuenta sin contexto no puede cambiar roles. El cambio no se ejecutó. |
| Catálogo y perfil SaaS | Catálogo HTTP 200; perfil QA HTTP 200 | El API de producción sigue disponible durante estas verificaciones. |

## Hallazgo de RLS y corrección de evidencia

La afirmación anterior de que `DATABASE_URL` conectaba como `postgres` con `BYPASSRLS` era incorrecta. Se contrastó con los logs de arranque del despliegue Railway de producción `d9cdecc9-ab7c-467a-9296-96afa2e26df6` (25 de noviembre de 2026): el contenedor verificó explícitamente `current_user = app_rls_user` y `bypassrls = false`. El despliegue terminó en `SUCCESS`.

Eso acredita que la conexión ordinaria de la aplicación no es superusuario ni elude RLS. **No acredita que todas las tablas de equipo estén aisladas por RLS.** La revisión del código vigente encontró que las migraciones 082 y 190 crean `memberships` y `membership_audit_logs`, respectivamente, pero ninguna habilita RLS ni declara políticas para esas tablas. El validador de `prepareRlsDatabase.js` inspecciona únicamente tablas con columna `tenant_id`; `memberships` usa `business_profile_id` y `membership_audit_logs` tampoco tiene `tenant_id`, así que el mensaje general `sin política: ninguna` no las cubre.

Conclusión: rol runtime con privilegio mínimo **verificado**; RLS específico de membresías y auditoría **no configurado en las migraciones revisadas y pendiente de consulta dirigida a producción**. No atribuir al RLS protección que hoy demuestran los guards del API. Antes de activarlo, hay que definir políticas y contexto compatibles con las transacciones de `saasMembershipService`, desplegar la migración y probar todos los flujos.

## Pendientes para el cierre

1. Ejecutar la invitación de prueba para una cuenta QA autorizada; comprobar el correo entregado y la aceptación con el correo correcto.
2. Verificar rechazo con otro correo, vencimiento y reenvío del token.
3. Probar de forma controlada los permisos de `ADMIN`, `MANAGER`, `MEMBER` y `VIEWER`, incluida la restricción de que solo OWNER cambia roles.
4. Probar en producción el límite de asientos al llegar al máximo y las condiciones de concurrencia/reactivación.
5. Consultar directamente en producción `relrowsecurity`, `relforcerowsecurity` y `pg_policies` para ambas tablas; después diseñar e implementar RLS compatible con los contextos y transacciones de `saasMembershipService`.
6. Verificar todas las acciones por sede con cuentas miembro y propietario.

## Avance

**65 % estimado de criterios de salida verificados; fase abierta.** Ponderación revisada: modelo y pantalla de equipo implementados/publicados (25 %), guards de acceso básico comprobados en producción (15 %), políticas de invitación/roles/cupo implementadas y CI probada (15 %), aceptación de invitaciones heredadas endurecida y desplegada (10 %). Quedan pendientes: recorrido E2E de invitación/correo/aceptación (15 %), comprobación de permisos por rol y alcance por sede (10 %), corte y concurrencia de asientos en integración (5 %), y RLS dirigido para membresías/auditoría (5 %). Los pesos miden criterios cumplidos, no líneas de código ni despliegues.

- Implementación canónica de equipo y pantalla publicada: comprobado en documentación de release.
- Guard del propietario/tenant para lectura de equipo y auditoría, y rechazo de cuenta sin membresía: comprobado por respuestas HTTP de producción.
- Aceptación heredada con límite de asientos y transacción, cambio de rol que conserva el subrol y retiro con estado `REMOVED` y auditoría: desplegados mediante PR #73, commit de producción `b8899c002303f7f4218db3f4452362f6db53c2da`.
- CI oficial de backend del PR #73: aprobado; pruebas locales focalizadas: **22/22 aprobadas** con Jest/Babel.
- Railway producción: el despliegue inicial del código fue `f961ee37-a7b0-4742-b74f-965a4fb7dff3`, estado `SUCCESS`, para el commit `b8899c002303f7f4218db3f4452362f6db53c2da`. El despliegue documental posterior vigente al corte es `d9cdecc9-ab7c-467a-9296-96afa2e26df6`, estado `SUCCESS`. Sus logs de arranque verifican `app_rls_user` con `bypassrls=false`; PostgreSQL disponible, sin datos fabricados ni fallback de memoria.
- Invitación/correo/aceptación reales en producción: no probados; la consulta anterior encontró cero invitaciones heredadas pendientes.
- RLS dirigido en `memberships` y `membership_audit_logs`: pendiente; las migraciones vigentes no activan políticas para ellas. El rol general de aplicación sí está verificado sin `BYPASSRLS`.

El 60 % y el 80 % reportados antes eran estimaciones, no métricas instrumentadas. El 80 % sobrecontó criterios al tratar el despliegue de compatibilidad como prueba de aceptación E2E y al describir mal el rol PostgreSQL. La estimación actual de 65 % mantiene la fase abierta hasta contar con recorridos de invitación, permisos/cupos e inspección de RLS específica.

No se crearon invitaciones, no se enviaron correos ni se modificaron membresías durante esta revisión.
