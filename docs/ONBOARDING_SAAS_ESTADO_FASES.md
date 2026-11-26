# Estado porcentual del onboarding SaaS

**Corte:** 26 de noviembre de 2026  
**Base:** evidencia de producción, reportes de fase y confirmaciones del usuario en esta conversación.

| Fase | Alcance | Avance verificado | Estado | Evidencia en repo y entorno local |
| --- | --- | ---: | --- | --- |
| 1. Entrada confiable | Alta, tenant válido, reintentos y acceso protegido | **100 %** | Cerrada por el usuario el 25 Nov 2026. | [Informe Fase 1](fases/ONBOARDING_FASE_1_PUERTA_SAAS.md): despliegue, bootstrap idempotente y pruebas de acceso. El informe separa los escenarios adicionales que no bloquearon el cierre. |
| 2. Configuración inicial del salón | Datos del salón, sede, horarios y servicios iniciales | **100 %** | Cerrada; evaluación visual confirmada por el usuario el 25 Nov 2026. | [Informe Fase 2](fases/ONBOARDING_FASE_2_CONFIGURACION_SALON.md) y [registro del salón QA](fases/QA_SALON_FASE_2.md): perfil, horario, servicio de prueba, persistencia y acceso. |
| 3. Plan y límites claros | Catálogo, beneficios, cuotas y aplicación en API | **100 %** | Cerrada y verificada en producción. | [Informe Fase 3](fases/ONBOARDING_FASE_3_PLANES_Y_LIMITES.md): catálogo V2, límites, CI y despliegues. |
| 4. Equipo y permisos | Invitaciones, roles, aislamiento y cupos | **90 %** | Abierta. Invitación/aceptación real de Sonia confirmadas; matriz de permisos, aislamiento entre tenants y concurrencia de cupos cubiertos por integración PostgreSQL en CI (**17/17** en run 45733109611). Resta el recorrido autenticado con dos cuentas reales en producción y la confirmación de Sonia desde su sesión. | [Informe Fase 4](fases/ONBOARDING_FASE_4_EQUIPO_PERMISOS.md): evidencia actualizada, pruebas CI y validaciones productivas pendientes. |
| 5. Puesta en marcha operativa | Guía, agenda y primera reserva atendida | **80 % estimado** | Abierta. Guía y acceso a agenda verificados visualmente con la cuenta QA propietaria. La prueba automatizada local cubre la guía y el bloqueo sin sede; el recorrido autenticado cliente→reserva→atención sigue sin verificarse. | [Informe Fase 5](fases/ONBOARDING_FASE_5_PUESTA_EN_MARCHA.md): código y pruebas locales; PR #90/#92, CI exitoso, despliegue Firebase live y smoke HTTP 200. Falta una identidad cliente QA separada para E2E. |
| 6. Facturación y cambios de plan | Checkout, activación, renovación, cancelación y recuperación | **0 % verificado** | Sin auditoría de criterios de salida en el repo. Falta validar que suscripción y permisos coincidan tras los eventos de pago. | Criterio de salida acordado: verificar el estado de suscripción y permisos tras cada evento del ciclo de pago. Aún no hay informe de fase ni evidencia de recorrido. |
| 7. Seguimiento y crecimiento | Métricas, uso frente a límites y recomendaciones | **0 % verificado** | Sin auditoría de criterios de salida en el repo. Falta comprobar métricas, avisos de capacidad y cambio de nivel. | Criterio de salida acordado: que el dueño consulte actividad y uso frente a límites y pueda decidir un cambio de nivel. Aún no hay informe de fase ni evidencia de recorrido. |

## Lectura del avance

- Las fases 1–3 están cerradas según el historial del proyecto; la fase 4 permanece abierta en **90 %**, tras integrar y ejecutar en CI la matriz PostgreSQL de membresías.
- La Fase 5 está en **80 % estimado**: guía y acceso a agenda publicados, build y CI aprobados; el criterio final de primera reserva atendida sigue pendiente. Las fases 6–7 continúan en **0 % verificado** porque todavía no se han auditado sus criterios de salida.
- No se calcula un porcentaje global: las fases no tienen ponderaciones acordadas y tres aún no cuentan con evaluación sustentada.

## Revisión y despliegue de Fase 5 (26 de noviembre de 2026)

- La app del salón tenía una agenda que listaba reservas, pero el estado vacío solo decía que las citas aparecerían al reservar. La pantalla de Servicios ya ofrecía una instrucción básica para crear el primer servicio.
- Se añadió a la agenda vacía una guía secuencial con enlaces al perfil del salón, disponibilidad semanal del prestador, catálogo de servicios y agenda operativa.
- El acceso «Ver cómo atender citas» abre `ProviderDashboardScreen` en la pestaña Agenda. Esta pantalla existente contiene los controles de gestión de reservas y el flujo de atención.
- Se añadió `salonId` opcional a `ProviderDashboardScreen` y se pasa al consultar reservas desde el recorrido SaaS, usando el encabezado `x-active-salon-id` que ya admite `ApiService.fetchProviderBookings`.
- Los cambios en `apps/glow_provider/lib/screens/salon/salon_shell.dart` y `apps/glow_provider/lib/screens/provider/provider_dashboard_screen.dart` se integraron mediante PR #90 en `main`, commit **`0676e3d5817902b8a6b2c9016ba4920da2b2a728`**.
- CI de push **45751393943** terminó `success` con análisis y pruebas de las apps según el workflow. La suite Flutter existente del prestador pasó **15/15** localmente.
- Workflow manual **45751654219** terminó `success`: análisis/pruebas, build web de `glow_provider` y despliegue Firebase Hosting a `live` completados. La app cliente no se compiló ni desplegó en ese workflow.
- Smoke productivo: `https://glowapp-provider.web.app/` respondió HTTP 200; `main.dart.js` HTTP 200 (5.721.699 bytes) y contiene el texto de la guía (`Prepara tu`, `primera reserva`, `Completa estos pasos`) y `x-active-salon-id`. `Last-Modified: Thu, 26 Nov 2026 03:56:46 GMT`.
- No se creó ni modificó una cita en producción. La única cuenta QA disponible no tiene una cuenta cliente separada para completar el recorrido de forma segura.
- Al auditar las acciones de inicio/cierre se detectó que la primera versión enviaba explícitamente `salonId` al listar, pero dichas acciones obtenían `x-active-salon-id` del store global, que el shell SaaS no seleccionaba. PR #92, commit **`ab003eae203740921f28d2ee1ea99459ea75e522`**, fija la sede activa al completar el bootstrap y falla de forma cerrada si falta un ID numérico positivo. CI push **45753120632** pasó; workflow live **45753408944** terminó `success`.
- Smoke posterior a la corrección: el hosting y `main.dart.js` respondieron HTTP 200; el bundle publicado contiene los textos de la guía, el error de sede inválida, `active_salon_id` y `x-active-salon-id`. Última modificación observada: `Thu, 26 Nov 2026 04:13:37 GMT`.
- Evidencia del checkout local revisado: rama `main`, HEAD `cb7e3b4` (`Registra validación operativa de fase 5`), limpio y siguiendo `origin/main`. El código de guía/contexto está en `apps/glow_provider/lib/screens/salon/salon_shell.dart`; la navegación a la agenda y consulta de reservas está en `apps/glow_provider/lib/screens/provider/provider_dashboard_screen.dart`; la cobertura widget está en `apps/glow_provider/test/salon_shell_first_operation_test.dart` (2/2). El commit de documentación no cambia el código desplegado, cuyo merge de producto para el contexto activo es `ab003ea`.
- Evidencia CI y producción: merge PR #91 (`f8f70dd`) con CI exitoso; merge PR #92 (`ab003ea`) con push CI `45753120632` exitoso y publicación Firebase `45753408944` exitosa. Smoke posterior confirmó HTTP 200 en el hosting y el bundle web.
- Cobertura que sí acredita la prueba local: guía visible/enlaces de navegación y CTA deshabilitado cuando no hay salón activo. No acredita una reserva real, filtrado observado en agenda, inicio de servicio ni cierre por OTP.
- Inspección visual autenticada adicional en producción con la cuenta propietaria QA: tras recargar apareció la guía de cuatro pasos; el CTA abrió «Mi Agenda Pro» con filtros y estado vacío. Confirma el acceso visual, pero no reserva ni atención. Durante la inspección se halló una etiqueta que llamaba «servicios» al conteo de citas; la corrección del texto está en curso y aún requiere despliegue.
- El criterio de salida sigue pendiente hasta demostrar reserva creada desde Cliente, aparición en la agenda del salón correcto y ciclo de atención completado. **80 % estimado** representa guía, rutas, contexto de tenant y publicación comprobados; no equivale a E2E completo.
- El workflow advirtió que algunas acciones usan Node.js 20 y serán ejecutadas con Node.js 24; no afectó el éxito del build ni el despliegue.

## Evidencia de Fase 4

- `POST /api/saas/team/invite`: HTTP 201 y confirmación de envío.
- `POST /api/salon/accept-invitation`: HTTP 200; después de recargar, Sonia aparece como miembro del equipo.
- En producción, reenviar tras la aceptación devolvió HTTP 404, resultado esperado porque no queda invitación pendiente. La versión anterior conservó la lista obsoleta y mostró una excepción técnica; esa falla se corrigió y la corrección quedó publicada en el despliegue que sigue.
- En el commit que estaba en producción `fa9ef02ea919a6f6c6b2d0148ee5485bf25fce82`: **3 suites, 18/18 pruebas aprobadas**. Son pruebas focalizadas con mocks, no validación de concurrencia ni de dos tenants reales.
- En el PR #78, commit de rama `13b03b8`: backend **3 suites, 21/21**, Flutter **2/2** y build web del proveedor completados. Backend CI terminó `success` (run `45716904955`).
- El PR #78 se integró a `main` como `5fdaa3634fcd2fa2695ffc8ebd155b37f8971dc7`. El workflow Firebase `45717709704` finalizó `success` para ese SHA y publicó `glow_provider` en el canal live. `https://glowapp-provider.web.app/` y `/main.dart.js` respondieron HTTP 200; el bundle contiene el mensaje de éxito actualizado y no el mensaje técnico anterior.
- No se repitió el reenvío desde producción: Sonia ya está activa y no hay una invitación pendiente que permita recorrer el botón sin crear otra invitación o enviar otro correo. La evidencia de interfaz procede de las pruebas Flutter locales más la inspección del bundle publicado. Siguen sin demostrarse aislamiento entre dos tenants autenticados ni concurrencia de cupos en producción.

## Próxima labor

1. Completar el recorrido autenticado en producción entre dos cuentas y tenants de QA, incluyendo cupos/reactivación; requiere una segunda cuenta de QA.
2. Pedir a Sonia que confirme su rol desde su propia sesión cuando esté disponible.
3. Auditar las fases 5, 6 y 7 antes de asignarles un porcentaje de implementación.

## Actualización de evidencia del repositorio y entorno local (26 de noviembre de 2026)

- La tabla mantiene la Fase 4 en **75 %**. El valor no aumenta porque el cierre aún requiere validar aislamiento entre tenants autenticados y cupos bajo concurrencia/reactivación.
- El PR #85 integra en `main` pruebas de integración contra PostgreSQL desechable de CI para dos invitaciones que compiten por el último asiento y para una invitación concurrente con reactivación. El primer intento reveló que `prepareRlsDatabase.js` omitía la migración 112 (`invite_token`/estado `PENDING`), y el segundo que la limpieza del fixture no suspendía el trigger append-only de auditoría. Ambos problemas de la prueba se corrigieron; no se modificó lógica de producción.
- Backend CI **45726724863**, job **139597377748**, para el commit de PR `a181a106d7078326ed8268900f36fa8e832d4cbb`: **3 suites, 12/12 pruebas aprobadas**; pasan las carreras entre dos invitaciones y entre invitación/reactivación. La preparación de base, contratos, verificaciones de aislamiento y E2E del catálogo también finalizaron correctamente. PR #85 se integró a `main` como **`910b93cfc50cf5b18a89d4b3ffb1babdc1551b5d`**.
- Después de integrar y actualizar el informe, `GET /api/health` de producción respondió HTTP 200 con `env=production`, `dbMode=postgres`, PostgreSQL disponible y sin fallback de datos; el backend informó el commit `812c45cc238db64bb73b8f0f3821e86485289c57`. Es un check de disponibilidad, no una prueba de membresías.
- Esta evidencia acredita serialización de cupos sobre PostgreSQL real efímero de CI. No se probó ni modificó la base de producción; la entrega de correo se simula. Por ello se conserva **75 %** hasta la verificación productiva de cupos/reactivación, aislamiento autenticado entre tenants y escenarios E2E restantes.
- **Verificación de checkout local:** `D:\\codex-work\\phase4-rebase-20261125` está en la rama `main`, HEAD local `58a5e5fe138ce4e69b9da0565f8e871a34b966ad`, con cambios sin confirmar en UI de equipo, servicios Glow Core, pruebas y documentación de Fase 4. El documento local registra 7 suites y 45/45 pruebas dirigidas aprobadas, más una inspección visual autenticada del panel. Ese resultado es evidencia local previamente registrada; no se volvió a ejecutar en esta revisión y el checkout sucio no se presume idéntico al `main` remoto. El directorio de trabajo de Codex de esta sesión no era un repositorio; el checkout se localizó aparte.
- Pendiente para cerrar: ejecutar la verificación de cupos/reactivación y alcance de roles entre tenants en producción con controles seguros, además de completar correo equivocado, vencimiento y reenvío E2E. La fase sigue abierta en **75 %**.


## Actualización Fase 4: invitación y reenvío E2E (26 de noviembre de 2026)

- El PR #86 se integró a `main` mediante commit **`a9770a1b20a36a83a2d15db0e6d9b9fea50525ed`**. Añade pruebas de integración PostgreSQL para rechazar aceptación desde un correo distinto, aceptar con el correo invitado y renovar una invitación vencida, incluyendo token y eventos de auditoría. La entrega de correo se simula.
- Backend CI **45728682884**, job **139605712028**, terminó `success` en el reintento: **3 suites, 14/14 pruebas de integración aprobadas**; el resto del job pasó sintaxis, contratos y verificaciones de aislamiento. El primer intento del mismo job tuvo una falla intermitente en la carrera invitación/reactivación (error de tipos SQL en competencia); el reintento pasó. Por ello el registro CI se toma como evidencia automatizada, no como garantía de recurrencia del problema.
- Los dos escenarios nuevos de invitación pasaron y ahora forman parte de la cobertura persistente en `main`. No se envió correo ni se modificaron datos de producción.
- El porcentaje sigue en **75 %** porque aún faltan las pruebas productivas controladas de aislamiento entre tenants, cupos y reactivación, además de la confirmación de Sonia desde su sesión. La etapa no está cerrada.
- El checkout local conserva su estado previo y los cambios sin confirmar descritos arriba; el nuevo CI corrió sobre el merge de GitHub, no sobre ese checkout. No se mezclaron ni reemplazaron sus archivos locales.

### Verificación visual adicional en producción — Sonia (26 de noviembre de 2026)

- En la sesión autenticada ya abierta en `glowapp-provider.web.app`, la pantalla Mi Equipo mostró a Sonia Herrera en la lista del QA Salón Fase 2. Al abrir el diálogo Cambiar rol, el valor seleccionado fue **Personal**.
- Se canceló el diálogo sin guardar. No se cambiaron permisos ni se generó una invitación o correo. La pantalla confirma lo que el OWNER ve; la confirmación desde la sesión propia de Sonia continúa pendiente.
- Esto refuerza la evidencia de visualización del rol, pero no demuestra autorización de rutas ni aislamiento entre tenants. Por tanto, la Fase 4 permanece en **75 %**.


## Actualización Fase 4: aislamiento entre tenants (26 de noviembre de 2026)

- PR #87 se integró a `main` como **`972e1646b873a9e4a2e74d8434674f28ac2e5297`**. Añade una prueba PostgreSQL que usa dos tenants efímeros y el rol restringido `app_rls_user`.
- Backend CI **45730062940**, job **139609566560**, terminó `success`: integración **15/15**. Se verificó lectura del propio equipo/auditoría; cero filas del otro tenant en memberships, auditoría y `app_saas_team_user_info`; y cero miembros al consultar el servicio con el actor del tenant distinto.
- La prueba usa la migración/RLS real y la conexión de aplicación restringida, pero las filas son fixtures efímeros de CI. No es una sesión HTTP autenticada en producción ni una operación sobre los datos productivos; por eso la tabla permanece en **75 %**.
- Railway desplegó automáticamente el merge de tests sin cambios de lógica de producto. Quedan la comprobación autenticada end-to-end en producción, los cupos/reactivación productivos y la confirmación de Sonia desde su sesión.
## Actualización de evidencia Fase 4 — HTTP autenticado en PostgreSQL CI (26 de noviembre de 2026)

- PR #88 añade una prueba de integración que atraviesa JWT, `authMiddleware`, transacción de tenant, `saasContext`, router SaaS, servicio y RLS con dos salones/propietarios efímeros.
- Backend CI **45731660547**, job **139614897545**: **3 suites, 16/16 pruebas aprobadas**. Cada JWT recibió solo su propio equipo y tenant, incluso al enviar como parámetro el identificador del salón ajeno.
- El primer intento reveló que el preparador RLS no aplicaba las migraciones 109 (`business_profiles.saas_plan`) y 189 (`salones.business_profile_id`), requeridas por el contexto SaaS real. Se incluyeron ambas migraciones y se enlazó cada salón fixture a su perfil.
- El primer intento también reprodujo una incompatibilidad de tipos PostgreSQL en la consulta de reactivación de membresías; se fijó explícitamente el parámetro de estado como `text`. La prueba de concurrencia invitación/reactivación pasó en el CI final.
- La verificación usa PostgreSQL de CI y datos desechables. No consultó ni modificó la base productiva, no envió correos y no representa el inicio de sesión de Sonia.
- La Fase 4 permanece en **75 %**: quedan la confirmación de Sonia desde su sesión real y los recorridos productivos controlados para cupos/reactivación. La prueba HTTP de CI reduce el riesgo técnico y demuestra la ruta de autenticación, pero no reemplaza esas verificaciones de producción.

### Evidencia Fase 4 — matriz RBAC HTTP y retiro de miembros (26 de noviembre de 2026)

- PR #89 se integró en `main` como `fb996aa129b839a15b7f910f409650ae87f65fed`.
- Backend CI run **45733109611**, job **139619717500**: **3 suites, 17/17 pruebas aprobadas**. La nueva prueba atraviesa JWT, auth, tenant transaction, `saasContext`, router, guards, servicio y RLS sobre dos salones desechables.
- En CI, ADMIN pudo invitar y reactivar dentro del cupo; no pudo cambiar roles. OWNER sí cambió el rol. MEMBER recibió 403 al intentar invitar, reactivar y cambiar roles. La eliminación lógica de la invitación liberó el asiento para la reactivación.
- La prueba encontró que el flujo de retiro asignaba texto a `memberships.removed_by` (INTEGER). Se corrigió el casteo del actor a entero. Sin correo real ni escrituras en producción.
- Railway desplegó el backend en producción: **1181df47-416f-4426-a3ad-f7ecd2cd0408**, commit `fb996aa`. Los 8 servicios quedaron en línea, sin fallos recientes ni despliegues pendientes.
- El avance de la Fase 4 se conserva en **75 %**: la matriz de permisos y el retiro/reactivación están cubiertos en CI con PostgreSQL, pero falta validarlos con el recorrido y cuentas reales de producción. Sonia aún debe confirmar desde su propia sesión.


### Smoke de producción — disponibilidad y acceso anónimo (26 de noviembre de 2026, 01:09 UTC)

- `GET /api/health` respondió `200` para el commit `5ef3e63e2416b0b0f5cfb4111edc82160c9f0211`; `env=production`, `dbMode=postgres`, `pgAvailable=true` y `servingFabricatedData=false`.
- Sin credenciales y con `X-App-Audience: salon`, `GET /api/saas/team` y `GET /api/saas/team/audit` devolvieron `401`. La consulta no cambió datos ni creó eventos.
- Confirma salud del backend y denegación anónima; no sustituye la prueba de dos usuarios autenticados en tenants distintos ni demuestra cupos/reactivación en cuentas productivas. La Fase 4 continúa en **75 %**.

## Revisión de avance Fase 4 — integración completa en CI (26 de noviembre de 2026)

- El porcentaje anterior de **75 %** quedó superado por la cobertura añadida en PR #88 y #89; la tabla se actualiza a **90 % estimado**, manteniendo la fase abierta por las comprobaciones productivas con cuentas separadas.
- Backend CI run **45733109611**, job **139619717500**, concluyó `success`. El job ejecutó el paso «Tests de integración contra Postgres real»: **3 suites, 17/17 pruebas aprobadas**, incluida `tests/saasMembershipConcurrency.integration.test.js`.
- La suite usa PostgreSQL efímero y fixtures limpiados. Cubre dos invitaciones compitiendo por el último cupo; invitación contra reactivación; correo incorrecto/correcto; expiración y reenvío; aislamiento RLS entre salones; vinculación JWT→tenant por HTTP; y permisos OWNER/ADMIN/MEMBER. La entrega de email se simula.
- Producción está en `main` commit `883ad735a79baa7f925c849e75d80dbe2e690aa4`: `/api/health` informa PostgreSQL disponible y commit actual; `/api/saas/team` y `/api/saas/team/audit` devuelven 401 sin credenciales. Railway: ocho servicios en línea y cero despliegues pendientes.
- El **10 % restante** corresponde a validar en producción el recorrido con dos identidades/tenants de QA y a la confirmación de Sonia desde su propia sesión. No se deben crear invitaciones ni alterar membresías reales sin preparar esas cuentas y controlar los correos.
