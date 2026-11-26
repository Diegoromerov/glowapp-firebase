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

## Validación

- Pruebas focalizadas de facturas y suscripciones: **42/42 aprobadas** (mocks locales; no son cargos ni pruebas contra el proveedor).
- `node --check` en las rutas, servicios y entrypoint modificados: aprobado.
- `git diff --check`: aprobado.
- Railway Producción no tiene variables `STRIPE_*` configuradas. Por esto Stripe no puede procesar checkout real; el endpoint responde con estado de servicio no disponible hasta tener la configuración.
- No se inició checkout, cobro, renovación ni cancelación en producción.

## Estado por capacidad

| Capacidad | Estado | Pendiente para validarla |
| --- | --- | --- |
| Checkout | Parcial | Configurar precios y webhook de Stripe; construir el flujo oficial de Wompi para COP y sus cobros recurrentes. |
| Activación | Parcial | Ejecutar eventos firmados reales y comprobar que plan/permisos cambian sólo tras pago aprobado. |
| Renovación | Parcial | Probar cobro de un período posterior, facturación idempotente y evento de fallo. |
| Cancelación | Parcial | Verificar cancelación Stripe al fin de período y diseñar la operación compatible con Wompi. |
| Facturas | Parcial | Probar generación, descarga durable, envío y documento fiscal aplicable. El PDF actual se guarda en el filesystem efímero del backend. |
| Recuperación | Pendiente | Programar dunning, avisos al dueño, plazo de gracia y recuperación tras actualizar el método de pago. |

## Pendientes prioritarios

1. Acordar y configurar proveedor, precios, moneda y llaves mediante variables secretas; nunca incluirlas en commits o logs.
2. Completar Wompi con el flujo documentado de fuente de pago y transacciones recurrentes, y verificar su checksum de eventos y la referencia persistida de cada intento.
3. Configurar el webhook productivo y ejecutar pruebas de pago aprobado, pendiente, rechazado, duplicado, renovación, reintento y cancelación.
4. Definir estado de permisos durante mora y período de gracia, y conectar dunning con un scheduler real y correos.
5. Guardar facturas en almacenamiento duradero, enviar comprobantes y validar los requisitos tributarios antes de ofrecerlas como factura fiscal.
6. Completar en UI el historial de método de pago y las fechas/efectos de cancelación y cambio de nivel cuando esos flujos estén activos.

## Evidencia de publicación

La corrección de mapeo de facturas se publicó en `main` mediante PR #106 (commit `7f05ab84cd5ebb2c6cbabac8f03907898addf187`) y Railway confirmó deployment `a3d79965-b7a7-4902-95b2-bf3dd0808c67` en `SUCCESS`. Los cambios adicionales descritos aquí deben considerarse productivos sólo después de que su PR se integre y Railway confirme el commit desplegado.
