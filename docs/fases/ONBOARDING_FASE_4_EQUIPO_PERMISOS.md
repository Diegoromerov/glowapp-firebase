# Onboarding SaaS — Fase 4: equipo y permisos

**Estado:** implementación base desplegada; correcciones de compatibilidad en preparación local. Fase abierta.
**Corte:** 24 de noviembre de 2026.

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

## Hallazgo de RLS

Consulta de solo lectura a los catálogos PostgreSQL en producción:

- `memberships`: RLS deshabilitado, sin políticas.
- `membership_audit_logs`: RLS deshabilitado, sin políticas.
- `DATABASE_URL` conecta como rol `postgres`, con `rolsuper=true` y `rolbypassrls=true`.

Por tanto, las verificaciones HTTP demuestran los guards de la aplicación, pero no demuestran aislamiento mediante RLS. Activar RLS a ciegas no resolvería esto: el usuario actual de base de datos elude las políticas y el servicio usa conexiones de pool separadas para transacciones de membresía. Se requiere un cambio coordinado a una identidad de base de datos de privilegio mínimo, con contexto y políticas compatibles, y validación de las rutas que escriben membresías. No se hizo ese cambio durante esta ejecución.

## Pendientes para el cierre

1. Integrar, pasar CI oficial y desplegar la corrección local de las rutas heredadas de aceptación, cambio de rol y retiro.
2. Ejecutar la invitación de prueba para una cuenta QA autorizada; comprobar el correo entregado y la aceptación con el correo correcto.
3. Verificar rechazo con otro correo, vencimiento y reenvío del token.
4. Probar de forma controlada los permisos de `ADMIN`, `MANAGER`, `MEMBER` y `VIEWER`, incluida la restricción de que solo OWNER cambia roles.
5. Probar el límite de asientos al llegar al máximo y las condiciones de concurrencia/reactivación.
6. Diseñar e implementar la separación de privilegios de PostgreSQL y el RLS real de membresías/auditoría sin dejar rutas productivas fuera de compatibilidad.
7. Verificar todas las acciones por sede con cuentas miembro y propietario.

## Avance

**68 % estimado; fase abierta, no equivale a cierre.**

- Implementación canónica de equipo y pantalla publicada: comprobado en documentación de release.
- Guard del propietario/tenant para lectura de equipo y auditoría, y rechazo de cuenta sin membresía: comprobado por respuestas HTTP de producción.
- Aceptación heredada con límite de asientos y transacción, cambio de rol que conserva el subrol y retiro con estado `REMOVED` y auditoría: corrección local, aún no desplegada.
- Pruebas locales de la corrección: **22/22 aprobadas** (17 de servicios/mapeos y 5 de la ruta HTTP), usando la configuración normal de Jest/Babel después de completar `npm ci`.
- Invitación/correo/aceptación reales en producción: no probados; la consulta anterior encontró cero invitaciones heredadas pendientes.
- RLS efectivo: no cumple todavía, porque el rol productivo de conexión tiene `BYPASSRLS`.

El 60 % previo era una estimación, no una métrica instrumentada. El 68 % actual reconoce la corrección y pruebas locales, pero no se cuenta como despliegue.

No se crearon invitaciones, no se enviaron correos ni se modificaron membresías durante esta revisión.
