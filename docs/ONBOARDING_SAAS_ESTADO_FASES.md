# Estado porcentual del onboarding SaaS

**Corte:** 25 de noviembre de 2026  
**Base:** evidencia de producción, reportes de fase y confirmaciones del usuario en esta conversación.

| Fase | Alcance | Avance verificado | Estado | Evidencia local en el repo |
| --- | --- | ---: | --- | --- |
| 1. Entrada confiable | Alta, tenant válido, reintentos y acceso protegido | **100 %** | Cerrada por el usuario el 25 Nov 2026. | [Informe Fase 1](fases/ONBOARDING_FASE_1_PUERTA_SAAS.md): despliegue, bootstrap idempotente y pruebas de acceso. El informe separa los escenarios adicionales que no bloquearon el cierre. |
| 2. Configuración inicial del salón | Datos del salón, sede, horarios y servicios iniciales | **100 %** | Cerrada; evaluación visual confirmada por el usuario el 25 Nov 2026. | [Informe Fase 2](fases/ONBOARDING_FASE_2_CONFIGURACION_SALON.md) y [registro del salón QA](fases/QA_SALON_FASE_2.md): perfil, horario, servicio de prueba, persistencia y acceso. |
| 3. Plan y límites claros | Catálogo, beneficios, cuotas y aplicación en API | **100 %** | Cerrada y verificada en producción. | [Informe Fase 3](fases/ONBOARDING_FASE_3_PLANES_Y_LIMITES.md): catálogo V2, límites, CI y despliegues. |
| 4. Equipo y permisos | Invitaciones, roles, aislamiento y cupos | **75 %** | Abierta. Invitación y aceptación de Sonia confirmadas en producción; 21/21 pruebas de backend, 2/2 pruebas de estado Flutter y build web aprobados en local. La corrección UX del reenvío espera publicación. Restan verificar su rol desde su sesión, aislamiento real entre tenants y cupos concurrentes/reactivación. | [Informe Fase 4](fases/ONBOARDING_FASE_4_EQUIPO_PERMISOS.md): estados HTTP, pruebas ejecutadas y pendientes. |
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
- Reenviar tras la aceptación devuelve HTTP 404 porque ya no existe una invitación pendiente. La app deja la lista anterior y presenta una excepción técnica; debe actualizar el equipo y mostrar un mensaje comprensible.
- Suites locales en el commit de producción `fa9ef02ea919a6f6c6b2d0148ee5485bf25fce82`: **3 suites, 18/18 pruebas aprobadas**. Son pruebas focalizadas con mocks, no validación de concurrencia ni de dos tenants reales.

## Próxima labor

1. Corregir y verificar la actualización de la lista cuando el backend informa que una invitación ya fue aceptada.
2. Completar pruebas productivas seguras de permisos por tenant y cupos/concurrencia/reactivación.
3. Solicitar a Sonia la verificación de su rol cuando esté disponible.
4. Auditar las fases 5, 6 y 7 antes de asignarles un porcentaje de implementación.
