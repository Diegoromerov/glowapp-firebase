# Estado porcentual del onboarding SaaS

**Corte:** 25 de noviembre de 2026  
**Base:** evidencia de producción, reportes de fase y confirmaciones del usuario en esta conversación.

| Fase | Alcance | Avance verificado | Estado | Evidencia en repo y entorno local |
| --- | --- | ---: | --- | --- |
| 1. Entrada confiable | Alta, tenant válido, reintentos y acceso protegido | **100 %** | Cerrada por el usuario el 25 Nov 2026. | [Informe Fase 1](fases/ONBOARDING_FASE_1_PUERTA_SAAS.md): despliegue, bootstrap idempotente y pruebas de acceso. El informe separa los escenarios adicionales que no bloquearon el cierre. |
| 2. Configuración inicial del salón | Datos del salón, sede, horarios y servicios iniciales | **100 %** | Cerrada; evaluación visual confirmada por el usuario el 25 Nov 2026. | [Informe Fase 2](fases/ONBOARDING_FASE_2_CONFIGURACION_SALON.md) y [registro del salón QA](fases/QA_SALON_FASE_2.md): perfil, horario, servicio de prueba, persistencia y acceso. |
| 3. Plan y límites claros | Catálogo, beneficios, cuotas y aplicación en API | **100 %** | Cerrada y verificada en producción. | [Informe Fase 3](fases/ONBOARDING_FASE_3_PLANES_Y_LIMITES.md): catálogo V2, límites, CI y despliegues. |
| 4. Equipo y permisos | Invitaciones, roles, aislamiento y cupos | **75 %** | Abierta. Invitación y aceptación de Sonia están confirmadas en producción. La corrección de reenvío está en `main` y live (PR #78; workflow `45717709704`). La prueba de interfaz está en `main` y CI pasó (PR #80; run `45720828857`). La cobertura local del servicio y permisos de rutas pasó **10/10**; los tests de reenvío de invitación vencida se integraron mediante PR #82 (commit `79104f6`), Backend CI `45722376630` success. Son pruebas simuladas; el panel del propietario mostró a Sonia como Personal seleccionado en el diálogo (sin guardar cambios); falta su confirmación desde su sesión. También restan aislamiento con tenants reales y cupos concurrentes/reactivación. | [Informe Fase 4](fases/ONBOARDING_FASE_4_EQUIPO_PERMISOS.md): evidencia de producción, pruebas locales/CI y pendientes. |
| 5. Puesta en marcha operativa | Guía, agenda y primera reserva atendida | **0 % verificado** | Sin auditoría de criterios de salida en el repo. No significa que no existan módulos operativos; falta probar la primera operación de extremo a extremo. | Criterio de salida acordado: completar primera reserva y atenderla desde el sistema. Aún no hay informe de fase ni evidencia de recorrido. |
| 6. Facturación y cambios de plan | Checkout, activación, renovación, cancelación y recuperación | **0 % verificado** | Sin auditoría de criterios de salida en el repo. Falta validar que suscripción y permisos coincidan tras los eventos de pago. | Criterio de salida acordado: verificar el estado de suscripción y permisos tras cada evento del ciclo de pago. Aún no hay informe de fase ni evidencia de recorrido. |
| 7. Seguimiento y crecimiento | Métricas, uso frente a límites y recomendaciones | **0 % verificado** | Sin auditoría de criterios de salida en el repo. Falta comprobar métricas, avisos de capacidad y cambio de nivel. | Criterio de salida acordado: que el dueño consulte actividad y uso frente a límites y pueda decidir un cambio de nivel. Aún no hay informe de fase ni evidencia de recorrido. |

## Lectura del avance

- Las fases 1–3 están cerradas según el historial del proyecto; la fase 4 permanece abierta en 75 %.
- Las fases 5–7 figuran como **0 % verificado** porque todavía no se han auditado sus criterios de salida dentro de este plan. No significa que todo su código o pantallas estén ausentes.
- No se calcula un porcentaje global: las fases no tienen ponderaciones acordadas y tres aún no cuentan con evaluación sustentada.

## Evidencia de Fase 4

- `POST /api/saas/team/invite`: HTTP 201 y confirmación de envío.
- `POST /api/salon/accept-invitation`: HTTP 200; después de recargar, Sonia aparece como miembro del equipo.
- En producción, reenviar tras la aceptación devolvió HTTP 404, resultado esperado porque no queda invitación pendiente. La versión anterior conservó la lista obsoleta y mostró una excepción técnica; esa falla se corrigió y la corrección quedó publicada en el despliegue que sigue.
- En el commit que estaba en producción `fa9ef02ea919a6f6c6b2d0148ee5485bf25fce82`: **3 suites, 18/18 pruebas aprobadas**. Son pruebas focalizadas con mocks, no validación de concurrencia ni de dos tenants reales.
- En el PR #78, commit de rama `13b03b8`: backend **3 suites, 21/21**, Flutter **2/2** y build web del proveedor completados. Backend CI terminó `success` (run `45716904955`).
- El PR #78 se integró a `main` como `5fdaa3634fcd2fa2695ffc8ebd155b37f8971dc7`. El workflow Firebase `45717709704` finalizó `success` para ese SHA y publicó `glow_provider` en el canal live. `https://glowapp-provider.web.app/` y `/main.dart.js` respondieron HTTP 200; el bundle contiene el mensaje de éxito actualizado y no el mensaje técnico anterior.
- No se repitió el reenvío desde producción: Sonia ya está activa y no hay una invitación pendiente que permita recorrer el botón sin crear otra invitación o enviar otro correo. La evidencia de interfaz procede de las pruebas Flutter locales más la inspección del bundle publicado. Siguen sin demostrarse aislamiento entre dos tenants autenticados ni concurrencia real de cupos.

## Próxima labor

1. Completar pruebas E2E de correo equivocado, vencimiento y reenvío de invitación pendiente/expirada con datos de QA controlados.
2. Completar pruebas productivas seguras de permisos por tenant y cupos/concurrencia/reactivación.
3. Solicitar a Sonia la verificación de su rol cuando esté disponible.
4. Auditar las fases 5, 6 y 7 antes de asignarles un porcentaje de implementación.

## Actualización de evidencia del repositorio y entorno local (25 de noviembre de 2026)

- La tabla mantiene la Fase 4 en **75 %**. El valor no aumenta porque el cierre aún requiere validar aislamiento entre tenants autenticados y cupos bajo concurrencia/reactivación.
- El PR #85 añade pruebas de integración contra PostgreSQL desechable de CI para dos invitaciones compitiendo por el último asiento y para una invitación concurrente con reactivación. Ejecución Backend CI **45725359850**, job **139593737007**: fallaron las dos nuevas pruebas en assertExactlyOneSeatWinner porque ninguna operación se cumplió; el test no alcanzó a demostrar el rechazo esperado por límite HTTP 403. Las suites existentes del mismo job pasaron; el resultado global fue **10 aprobadas, 2 fallidas**. El motivo de rechazo de las operaciones todavía no está diagnosticado, por lo que este PR no se considera evidencia aprobatoria ni está integrado.
- No se probó ni modificó la base de datos de producción. Las pruebas apuntan al PostgreSQL efímero de CI y simulan el envío de correo.
- **Verificación de checkout local:** `D:\\codex-work\\phase4-rebase-20261125` está en la rama `main`, HEAD local `58a5e5fe138ce4e69b9da0565f8e871a34b966ad`, con cambios sin confirmar en UI de equipo, servicios Glow Core, pruebas y documentación de Fase 4. El documento local registra 7 suites y 45/45 pruebas dirigidas aprobadas, más una inspección visual autenticada del panel. Ese resultado es evidencia local previamente registrada; no se volvió a ejecutar en esta revisión y el checkout sucio no se presume idéntico al `main` remoto. El directorio de trabajo de Codex de esta sesión no era un repositorio; el checkout se localizó aparte.
- Pendiente para aceptar la evidencia: mostrar las causas reales de rechazo en el test, corregir lo necesario y conseguir un CI verde para ambas carreras. Hasta entonces, la fase sigue abierta en **75 %**.
