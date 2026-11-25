# Onboarding SaaS — Fase 4: equipo y permisos

**Estado:** endurecimiento RLS desplegado y validado en producción; faltan recorridos funcionales E2E. Fase abierta.
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

Conclusión antes de la corrección: el rol runtime tenía privilegio mínimo, pero las tablas de equipo no tenían RLS. La migración 200 define políticas específicas y configura el contexto de perfil SaaS para las consultas de membresías y auditoría.

### Validación PostgreSQL y despliegue (25 Nov 2026)

Se inspeccionó la base PostgreSQL nativa desde el contenedor activo de Railway, sin extraer ni mostrar credenciales. La migración 200 se ejecutó dentro de transacciones temporales, con rollback explícito al terminar. Bajo `app_rls_user` (`BYPASSRLS=false`), el OWNER de prueba pudo leer su propio equipo, no pudo ver membresías ni auditoría de otro perfil y la búsqueda de usuarios del equipo funcionó. También se creó una invitación sintética, se confirmó que otra cuenta no puede leerla, se aceptó con la cuenta correcta y se escribieron los dos eventos de auditoría. Dentro de la transacción, las dos tablas mostraron RLS habilitado y forzado, con cinco políticas para `memberships` y cuatro para `membership_audit_logs`.

La prueba transaccional se revirtió antes del despliegue: no dejó invitaciones ni filas de auditoría. Luego se publicó el commit `8efabdfec726360425f3fc54406e53550fb17f0d` en `main`. Railway desplegó `ea6b9b44-f99f-4c50-8441-066622b5f6d2` con estado `SUCCESS` y aplicó `200_saas_memberships_rls.sql`.

La inspección posterior en PostgreSQL confirma la migración registrada a las 06:18:41 UTC, RLS habilitado y forzado en ambas tablas, cinco políticas en `memberships` y cuatro en `membership_audit_logs`. Con `app_rls_user` (`BYPASSRLS=false`), el propietario ve su equipo, el sondeo entre perfiles no devuelve filas y la función de consulta del equipo funciona. `/api/health` devuelve `OK`; los checks de Railway API y admin-dashboard están en `success`.

Otra transacción temporal comprobó permisos de negocio sin dejar filas: ADMIN pudo invitar, pero no cambiar roles; MEMBER no pudo invitar; OWNER sí pudo cambiar el rol de un miembro; los eventos de auditoría no se pudieron actualizar. La transacción se revirtió completa.

## Pendientes para el cierre

1. Ejecutar una invitación por API con una cuenta QA y comprobar correo entregado, aceptación con correo correcto, rechazo con otro correo, vencimiento y reenvío.
2. La matriz HTTP local ahora cubre OWNER, ADMIN, MANAGER, MEMBER y VIEWER para lectura del equipo/auditoría, invitación, cambio de rol, suspensión, retiro y reenvío. Aún hay que ejecutarla con contexto SaaS y datos reales para comprobar el alcance por sede/tenant en producción.
3. Probar en producción el límite de asientos, concurrencia y reactivación.

### Evidencia adicional de la revisión actual

- Siete suites focalizadas: **45/45 pruebas aprobadas**. La suite nueva `saas-team-rbac.test.js` usa el router real y sus guards; simula autenticación, contexto SaaS y servicio, por lo que acredita el comportamiento RBAC de las rutas, no una prueba de tenant completo. Las dos pruebas de `services/__tests__/saasMembershipService.test.js` se ejecutaron por separado porque el comando anterior apuntaba a una ruta inexistente.
- Se corrigió una expectativa obsoleta en `saasMembershipLegacyAcceptance.test.js`: la implementación serializa el cupo con `pg_advisory_xact_lock` por tenant y bloquea la fila de invitación con `FOR UPDATE OF si`, en vez de bloquear `business_profiles` directamente.
- Corrección publicada en `main`: commit `179c12105b5afdd03f6d57e56eecba63fa61c9ce`. El workflow GitHub Actions `45696306835` completó análisis, pruebas y build con `success`, y el job `Deploy glow_provider` publicó el artefacto en Firebase Hosting live.
- Las consultas HTTP directas a `/api/health`, `/api/saas/team` sin autenticación y `POST /api/saas/team/invite` sin autenticación no llegaron a recibir respuesta: el entorno de ejecución no pudo completar el handshake TLS con el dominio Railway, incluso con permiso de red. La invitación anónima no modificó datos ni envió correo; esas rutas siguen sin una comprobación HTTP nueva en producción.
- Evaluación visual autenticada en producción con `qa.fase2.202611241931@example.com`: `/#/salon` carga el salón **QA Salón Fase 2**. La pestaña inferior `Equipo` muestra el perfil, el miembro OWNER y el control “Invitar miembro”; el diálogo se abrió y se cerró sin enviar invitación.
- La pantalla de equipo carga el perfil al abrir y distingue carga, error con reintento y ausencia de salón. El tab del shell reutiliza el flujo SaaS canónico; se retiró la lista heredada de solo lectura.
- El analizador Dart de ambos archivos no reporta errores (solo avisos informativos), la compilación web local terminó correctamente y CI/build/deploy live aprobaron en el workflow `45696306835`.
- El avance sube de **70 % a 75 %** al quedar publicada y comprobada la pantalla de equipo. La invitación real por API/correo, aceptación, aislamiento por rol/tenant con cuentas reales y cupos/concurrencia siguen pendientes.

## Avance

**75 % estimado de criterios de salida verificados; fase abierta.** Ponderación vigente: modelo y backend de membresías disponibles (20/25 %), guards básicos comprobados en producción (15 %), políticas de invitación/roles/cupo implementadas y CI probada (15 %), aceptación heredada con protecciones de cupo (10 %), RLS dirigido desplegado y verificado en PostgreSQL (5 %), verificación transaccional de reglas OWNER/ADMIN/MEMBER y auditoría (5 % de los 10 % asignados a roles/alcance por sede), y UI de Equipo publicada y visualmente validada (5 %). Restan: invitación/correo/aceptación por API E2E (15 %), matriz y alcance por sede con tenant real (5 %), y cupos con concurrencia/reactivación (5 %). Los pesos miden criterios cumplidos, no líneas de código ni cantidad de despliegues.

- Implementación canónica de equipo y pantalla publicada: comprobado en documentación de release.
- Guard del propietario/tenant para lectura de equipo y auditoría, y rechazo de cuenta sin membresía: comprobado por respuestas HTTP de producción.
- Aceptación heredada con límite de asientos y transacción, cambio de rol que conserva el subrol y retiro con estado `REMOVED` y auditoría: desplegados mediante PR #73, commit de producción `b8899c002303f7f4218db3f4452362f6db53c2da`.
- CI oficial de backend del PR #73: aprobado; pruebas locales focalizadas: **22/22 aprobadas** con Jest/Babel.
- Railway producción: despliegue `ea6b9b44-f99f-4c50-8441-066622b5f6d2`, `SUCCESS`, commit `8efabdfec726360425f3fc54406e53550fb17f0d`. El arranque reporta `app_rls_user` sin `BYPASSRLS` y aplicación exitosa de migración 200.
- PostgreSQL productivo: migración registrada; `memberships` y `membership_audit_logs` tienen RLS habilitado/forzado con 5 y 4 políticas. Pruebas de lectura bajo `app_rls_user` confirman visibilidad del propio equipo y aislamiento de otros perfiles.
- Pruebas transaccionales de roles/auditoría: ADMIN puede invitar y no puede cambiar roles; MEMBER no puede invitar; OWNER cambia rol; auditoría append-only. Todas las filas sintéticas se revirtieron.
- Invitación/aceptación sintética a nivel PostgreSQL se comprobó en transacción revertida antes del despliegue. Invitación por API, correo real y aceptación real siguen pendientes; no se dejaron filas de prueba.

El 60 % y el 80 % reportados antes eran estimaciones, no métricas instrumentadas. El 80 % sobrecontó criterios al tratar el despliegue de compatibilidad como prueba de aceptación E2E y al describir mal el rol PostgreSQL. La estimación actual de 75 % reconoce el RLS desplegado y verificado, más una matriz parcial de permisos comprobada en PostgreSQL; la fase sigue abierta hasta terminar los recorridos por API, correo y cupos.

No se persistieron invitaciones ni cambios de membresía de prueba, y no se enviaron correos durante esta revisión.

