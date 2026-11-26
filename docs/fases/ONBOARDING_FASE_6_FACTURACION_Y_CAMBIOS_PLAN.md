# Onboarding SaaS — Fase 6: facturación y cambios de plan

**Corte:** 26 de noviembre de 2026  
**Estado:** implementación parcial; fase abierta.  
**Avance de código:** 35 % estimado.  
**Recorrido real de cobro en producción:** 0 % verificado.

## Objetivo y criterio de cierre

Gestionar checkout, activación, renovación, cancelación, comprobantes y recuperación de pago. La fase se cierra cuando la suscripción, el plan y sus permisos coinciden con cada evento de pago y eso se comprueba en un recorrido de principio a fin.

## Cambios realizados

- Las facturas ahora toman el identificador, monto, moneda y estado del evento real de pago; se enlazan a la suscripción y una repetición del mismo identificador externo actualiza la factura en vez de duplicarla.
- Se añadió `/api/webhooks/stripe-saas`. Verifica la firma de Stripe sobre el cuerpo original y aplica el limitador de webhooks. Sólo activa un plan después de recibir un checkout pagado, consultar la suscripción directamente a Stripe y comprobar que el precio corresponde al plan solicitado.
- La recuperación de eventos Stripe tolera que `invoice.paid` llegue antes de `checkout.session.completed`; los eventos fallidos se pueden reintentar en lugar de quedar marcados como procesados.
- Se impidió generar el enlace Wompi COP de un solo pago porque no había una conciliación SaaS que confirmara y aplicara ese pago. También se bloqueó el cambio directo de plan, que podía modificar permisos antes de cobrar y, en Wompi, cancelar la suscripción antes de fallar.
- La cancelación Wompi queda protegida hasta implementar y verificar su contrato real. La pantalla del prestador informa que la facturación está pausada y no permite iniciar cambios que el backend no puede completar con seguridad.
- Los webhooks liberan sus conexiones de base de datos tras sincronizar el plan.
- El job de avisos de trial y mora ejecuta sus consultas bajo el rol de sistema, obtiene el nombre y correo del titular, envía los avisos por el servicio de correo configurado y registra cada factura avisada para reducir duplicados. Se mantiene sin programación automática mientras no se auditen los destinatarios y las suscripciones que podrían cancelarse.

## Validación

- Pruebas focalizadas de facturas y suscripciones: **42/42 aprobadas** (mocks locales; no son cargos ni pruebas contra el proveedor).
- `node --check` en las rutas, servicios y entrypoint modificados: aprobado.
- `git diff --check`: aprobado.
- Prueba unitaria del job de recuperación: **2/2 aprobadas**; cubre el contexto de sistema y el envío/auditoría de factura vencida. No ejecuta correos ni cambios de suscripción reales.
- Railway Producción no tiene variables `STRIPE_*` configuradas. Una solicitud HTTP inocua al webhook respondió `503 Stripe SaaS webhook no configurado`, como debe ocurrir mientras falta esa configuración.
- El workflow Firebase [45778750924](https://github.com/Diegoromerov/glowapp-firebase/actions/runs/45778750924) terminó `success`: análisis y pruebas del prestador, build web y deploy live. El hosting del prestador devolvió HTTP 200 y el bundle público contiene el aviso “La facturación SaaS está temporalmente pausada”.
- Railway confirmó deployment `88271019-efeb-496c-b20a-b89c25759724`, commit `fd0ac71e0405b39e5d4a42a29cb4c3510d2d3785`, estado `SUCCESS`. `/api/health` devuelve `OK`, `production` y el mismo commit.
- No se inició checkout, cobro, renovación ni cancelación en producción.

## Estado por capacidad

| Capacidad | Estado | Pendiente para validarla |
| --- | --- | --- |
| Checkout | Parcial | Configurar precios y webhook de Stripe; construir el flujo oficial de Wompi para COP y sus cobros recurrentes. |
| Activación | Parcial | Ejecutar eventos firmados reales y comprobar que plan/permisos cambian sólo tras pago aprobado. |
| Renovación | Parcial | Probar cobro de un período posterior, facturación idempotente y evento de fallo. |
| Cancelación | Parcial | Verificar cancelación Stripe al fin de período y diseñar la operación compatible con Wompi. |
| Facturas | Parcial | Probar generación, descarga durable, envío y documento fiscal aplicable. El PDF actual se guarda en el filesystem efímero del backend. |
| Recuperación | Parcial en código; no activa en producción | El job tiene consultas con RLS, correos y auditoría; faltan auditoría de objetivos productivos, política de gracia y recuperación del método de pago. Mantenerlo sin cron hasta completar esa revisión. |

## Pendientes prioritarios

1. Acordar y configurar proveedor, precios, moneda y llaves mediante variables secretas; nunca incluirlas en commits o logs.
2. Completar Wompi con el flujo documentado de fuente de pago y transacciones recurrentes, y verificar su checksum de eventos y la referencia persistida de cada intento.
3. Configurar el webhook productivo y ejecutar pruebas de pago aprobado, pendiente, rechazado, duplicado, renovación, reintento y cancelación.
4. Auditar en producción qué trials/facturas serían afectados; definir estado de permisos durante mora y período de gracia. Solo entonces programar el job y comprobar los correos en una cuenta QA autorizada.
5. Guardar facturas en almacenamiento duradero, enviar comprobantes y validar los requisitos tributarios antes de ofrecerlas como factura fiscal.
6. Completar en UI el historial de método de pago y las fechas/efectos de cancelación y cambio de nivel cuando esos flujos estén activos.

## Evidencia de publicación

La corrección inicial de mapeo de facturas se publicó mediante PR #106 (commit `7f05ab84cd5ebb2c6cbabac8f03907898addf187`, Railway `SUCCESS`). Las protecciones de cobro, webhook y pantalla se integraron mediante PR #107 (commit `fd0ac71e0405b39e5d4a42a29cb4c3510d2d3785`, Railway `SUCCESS`; workflow Firebase live `45778750924`). El hosting productivo actual corresponde al prestador. No se publicó ni modificó la app cliente.
