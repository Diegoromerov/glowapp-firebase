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

1. Invitación real por API, correo y aceptación con la cuenta autorizada comprobados el 25 de noviembre. Faltan rechazo de aceptación con otro correo, vencimiento y reenvío de una invitación que siga pendiente o haya expirado.

   Nota de auditoría: se corrigió `backend/scripts/qaSaasE2E.js` en `main` (`9c55f5383faf5157c792a928cf94bffe49d690c6`) para usar las rutas actuales, requerir correo registrado y solo aprobar el envío cuando `emailSent=true`; HTTP 409 ya no cuenta como éxito. Backend CI `45704648626` completó con `success`. El arnés aún no se ejecutó contra producción: hacerlo requiere la confirmación pendiente para enviar la invitación real a la cuenta especificada.
2. La matriz HTTP local ahora cubre OWNER, ADMIN, MANAGER, MEMBER y VIEWER para lectura del equipo/auditoría, invitación, cambio de rol, suspensión, retiro y reenvío. Aún hay que ejecutarla con contexto SaaS y datos reales para comprobar el alcance por sede/tenant en producción.
3. Probar en producción el límite de asientos, concurrencia y reactivación.

### Evidencia adicional de la revisión actual

- Siete suites focalizadas: **45/45 pruebas aprobadas**. La suite nueva `saas-team-rbac.test.js` usa el router real y sus guards; simula autenticación, contexto SaaS y servicio, por lo que acredita el comportamiento RBAC de las rutas, no una prueba de tenant completo. Las dos pruebas de `services/__tests__/saasMembershipService.test.js` se ejecutaron por separado porque el comando anterior apuntaba a una ruta inexistente.
- Se corrigió una expectativa obsoleta en `saasMembershipLegacyAcceptance.test.js`: la implementación serializa el cupo con `pg_advisory_xact_lock` por tenant y bloquea la fila de invitación con `FOR UPDATE OF si`, en vez de bloquear `business_profiles` directamente.
- Corrección publicada en `main`: commit `179c12105b5afdd03f6d57e56eecba63fa61c9ce`. El workflow GitHub Actions `45696306835` completó análisis, pruebas y build con `success`, y el job `Deploy glow_provider` publicó el artefacto en Firebase Hosting live.
- Las consultas HTTP directas a `/api/health`, `/api/saas/team` sin autenticación y `POST /api/saas/team/invite` sin autenticación no llegaron a recibir respuesta: el entorno de ejecución no pudo completar el handshake TLS con el dominio Railway, incluso con permiso de red. La invitación anónima no modificó datos ni envió correo; esas rutas siguen sin una comprobación HTTP nueva en producción.
- Evaluación visual autenticada en producción con `qa.fase2.202611241931@example.com`: `/#/salon` carga el salón **QA Salón Fase 2**. La pestaña inferior `Equipo` muestra el perfil, el miembro OWNER y el control “Invitar miembro”; el diálogo se abrió y se cerró sin enviar invitación.
- La pantalla de equipo carga el perfil al abrir y distingue carga, error con reintento y ausencia de salón. El tab del shell reutiliza el flujo SaaS canónico; se retiró la lista heredada de solo lectura.
- Corrección adicional publicada en `main` mediante `460e871572fdcce10aa5460530816f2facf808f1` y desplegada en Firebase por el workflow `45699765867`: la app ahora recibe `emailSent` del API y distingue entre correo confirmado y correo no confirmado al invitar o reenviar. Se verificó el build, el deploy y la pantalla Equipo de la cuenta propietaria. No se generó una invitación real.
- Corrección del enlace publicada en `main` (`aac672ccc5832e89bb9942745f86a181a29f1e49`, extendida por `c0653cea57076bd83bd053aef46dec5570e10a86`) y desplegada por el workflow `45702221814`: Flutter Web ahora captura la ruta de invitación con query dentro del hash. En producción se abrió `/#/auth/accept-invitation?token=` con token ficticio de 32 caracteres; la pantalla cargó y lo precargó. No se pulsó aceptar ni se llamó al API.
- El diálogo de invitación ahora explica que la persona debe tener cuenta GlowApp registrada, aceptar con ese correo y usar el enlace dentro de siete días. Publicado en `main` (`12bef27c996cd37c5bdfc1a022a6141481efb693`), con análisis, build y despliegue Firebase exitosos en el workflow `45703320465`.
- El analizador Dart de ambos archivos no reporta errores (solo avisos informativos), la compilación web local terminó correctamente y CI/build/deploy live aprobaron en el workflow `45696306835`.
- El avance de salida permanece en **75 %**: la pantalla de equipo está publicada y se confirmó una invitación/aceptación real. Aún faltan escenarios E2E de correo equivocado/vencimiento/reenvío, aislamiento real entre tenants y cupos/concurrencia/reactivación.


### Verificación adicional de producción (25 Nov 2026)

- El commit `0b2285bf92410f216a8f9e7af7fe79537be0f45c` corrigió el guard del arnés E2E para reconocer el host real de producción `glowapp-api-production.up.railway.app`; sin `--force`, el script aborta antes de crear datos. Checks de Railway `glowapp - glowapp-api` y `glowapp - admin-dashboard`: `success`.
- Verificación HTTP de solo lectura: `GET /api/health` devolvió 200, `env=production`, `dbMode=postgres` y el mismo SHA de commit. `GET /api/saas/team` y `GET /api/saas/team/audit`, con `X-App-Audience: salon` pero sin credenciales, devolvieron 401. Sin esa cabecera devolvían 400 por el middleware de audiencia.
- Estas respuestas confirman disponibilidad del servicio y rechazo anónimo. No prueban el acceso de un miembro autenticado, la separación entre dos tenants ni la aplicación de cupos bajo concurrencia. No se crearon membresías ni se enviaron correos en estas consultas.

## Avance

**75 % estimado de criterios de salida verificados; fase abierta.** Ponderación vigente: modelo y backend de membresías disponibles (20/25 %), guards básicos comprobados en producción (15 %), políticas de invitación/roles/cupo implementadas y CI probada (15 %), aceptación heredada con protecciones de cupo (10 %), RLS dirigido desplegado y verificado en PostgreSQL (5 %), verificación transaccional de reglas OWNER/ADMIN/MEMBER y auditoría (5 % de los 10 % asignados a roles/alcance por sede), y UI de Equipo publicada y visualmente validada (5 %). El grupo E2E de invitaciones/correo/aceptación pesa 15 % y sigue incompleto: ya se verificó una invitación y aceptación real; faltan correo equivocado, vencimiento y reenvío pendiente/expirado. También restan matriz y alcance por sede con tenant real (5 %), y cupos con concurrencia/reactivación (5 %). Los pesos miden criterios cumplidos, no líneas de código ni cantidad de despliegues.

- Implementación canónica de equipo y pantalla publicada: comprobado en documentación de release.
- Guard del propietario/tenant para lectura de equipo y auditoría, y rechazo de cuenta sin membresía: comprobado por respuestas HTTP de producción.
- Aceptación heredada con límite de asientos y transacción, cambio de rol que conserva el subrol y retiro con estado `REMOVED` y auditoría: desplegados mediante PR #73, commit de producción `b8899c002303f7f4218db3f4452362f6db53c2da`.
- CI oficial de backend del PR #73: aprobado; pruebas locales focalizadas: **22/22 aprobadas** con Jest/Babel.
- Railway producción: despliegue `ea6b9b44-f99f-4c50-8441-066622b5f6d2`, `SUCCESS`, commit `8efabdfec726360425f3fc54406e53550fb17f0d`. El arranque reporta `app_rls_user` sin `BYPASSRLS` y aplicación exitosa de migración 200.
- PostgreSQL productivo: migración registrada; `memberships` y `membership_audit_logs` tienen RLS habilitado/forzado con 5 y 4 políticas. Pruebas de lectura bajo `app_rls_user` confirman visibilidad del propio equipo y aislamiento de otros perfiles.
- Pruebas transaccionales de roles/auditoría: ADMIN puede invitar y no puede cambiar roles; MEMBER no puede invitar; OWNER cambia rol; auditoría append-only. Todas las filas sintéticas se revirtieron.
- Invitación/aceptación sintética a nivel PostgreSQL se comprobó en transacción revertida antes del despliegue. La invitación por API, correo y aceptación de Sonia se verificaron después; no se creó una invitación extra para las pruebas restantes.

El 60 % y el 80 % reportados antes eran estimaciones, no métricas instrumentadas. El 80 % sobrecontó criterios al tratar el despliegue de compatibilidad como prueba de aceptación E2E y al describir mal el rol PostgreSQL. La estimación actual de 75 % reconoce el RLS desplegado y verificado, una matriz parcial de permisos comprobada en PostgreSQL y la invitación/aceptación real descrita abajo; la fase sigue abierta hasta completar los casos restantes por API, correo, alcance por tenant y cupos.

No se persistieron invitaciones ni cambios de membresía de prueba, y no se enviaron correos durante esta revisión.

### Continuación de pruebas (25 Nov 2026)

- En producción se creó la invitación autorizada a Sonia como Personal. `POST /api/saas/team/invite` respondió HTTP 201 y la app mostró confirmación de envío. Después, `POST /api/salon/accept-invitation` respondió HTTP 200; al recargar el panel del propietario, Sonia aparece como miembro del equipo. Esto confirma la invitación y aceptación de esa cuenta.
- Dos intentos posteriores de reenviar la misma invitación respondieron HTTP 404. Es el resultado esperado porque la membresía ya está `ACTIVE`, no pendiente. La pantalla del propietario conservó su lista previa hasta recargar; al recibir el 404, la app mantuvo el estado obsoleto y mostró `Exception: Invitación pendiente no encontrada`. Queda como mejora de UX: actualizar el equipo tras ese 404 y presentar un aviso entendible de que la invitación ya fue aceptada.
- Sobre el commit que estaba en producción `fa9ef02ea919a6f6c6b2d0148ee5485bf25fce82` se ejecutaron tres suites focalizadas en checkout aislado: `saas-team-rbac.test.js`, `saasMembershipLegacyAcceptance.test.js` y `saasMembershipService.test.js`. Resultado: **3 suites, 18/18 pruebas aprobadas**. Estas pruebas no simulan concurrencia real ni dos tenants autenticados en producción.
- Estas suites usan servicios o base de datos simulados: no prueban concurrencia real en PostgreSQL ni separación entre dos tenants autenticados en producción. Tampoco se generó una invitación nueva para probar correo equivocado, vencimiento o reenvío, para no enviar correos adicionales ni modificar el acceso real de Sonia.
- Las comprobaciones pendientes siguen siendo la matriz autenticada entre tenants/sedes reales, cupos concurrentes y reactivación en producción, además de corregir y verificar el estado obsoleto/error técnico del botón de reenvío. Sonia revisará su acceso y rol desde su propia sesión más adelante.

- Corrección en la rama `codex/fase4-team-resend-refresh`, commit `13b03b8`: la pantalla recarga el equipo si la invitación ya no está pendiente, comunica el resultado con un mensaje entendible y limpia errores anteriores cuando la carga tiene éxito. En esa rama, las tres suites backend pasan **21/21** y `TeamState` pasa **2/2**. El build web de proveedor completó; generó `build/web` con avisos WASM de `flutter_secure_storage_web` y `rive_common`, sin bloquearlo. Backend CI del PR #78 (run `45716904955`) terminó `success`. El PR sigue abierto y la corrección aún no está desplegada.

El 75 % se mantiene: la aceptación real aumenta la evidencia, pero no satisface por sí sola los escenarios pendientes del criterio E2E ni los casos de concurrencia/aislamiento.

