# Onboarding SaaS — Fase 6: facturación y cambios de plan

**Corte:** 26 de noviembre de 2026  
**Estado:** implementación parcial; fase abierta.  
**Avance de código:** 40 % estimado.
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
- El job de avisos de trial y mora ejecuta sus consultas bajo el rol de sistema, obtiene el contacto de cobro desde `business_profiles.billing_email/billing_name` y usa `usuarios.email/nombre` como respaldo. Se corrigieron referencias a una tabla `users` y columnas `owner_id/full_name` que no existen en el esquema versionado y que habrían impedido ejecutar el job. El job se mantiene sin programación automática mientras no se auditen en producción los destinatarios y las suscripciones que podría degradar o cancelar.
- El servicio de suscripciones rechaza planes no publicados, monedas no soportadas y planes pagados sin método/ID de suscripción de pasarela. Un pago `incomplete` o un estado `trialing` de un plan pagado queda registrado, pero no otorga capacidades ni emite comprobante local; sólo `active` sincroniza el plan pagado. Freemium se registra como `active`.
- Los comprobantes se generan como PDF, se cifran con AES-256-GCM con una clave derivada y separada para este uso, y se almacenan en R2 bajo una ruta por tenant. La descarga consulta la factura con tenant ID, descifra el objeto y responde con `private, no-store`; producción falla de forma cerrada si falta R2, en vez de perder el archivo en el disco efímero. El documento se identifica como comprobante informativo y declara que no reemplaza una factura electrónica.
- Se corrigió la variable de impuesto indefinida del generador PDFkit, se escapó el HTML de respaldo y se evita aplicar el cálculo COP a eventos USD. La tasa fiscal comercial sigue pendiente de validación tributaria.
- La app prestador lista el enlace autenticado del comprobante y lo descarga con los encabezados de sesión antes de abrir la vista de impresión; ya no intenta abrir en navegador externo una ruta que requiere bearer token. La sección y el PDF usan “comprobante” para no presentarlo como factura electrónica.

## Validación

- Pruebas focalizadas de facturas y suscripciones: **42/42 aprobadas** (mocks locales; no son cargos ni pruebas contra el proveedor).
- `node --check` en las rutas, servicios y entrypoint modificados: aprobado.
- `git diff --check`: aprobado.
- Prueba unitaria del job de recuperación: **2/2 aprobadas**; cubre el contexto de sistema y el envío/auditoría de factura vencida. No ejecuta correos ni cambios de suscripción reales.
- Pruebas locales focalizadas de facturación, almacenamiento, ruta de descarga y suscripciones: **12/12 aprobadas en el último bloque ejecutado**; incluye PDF válido, cifrado/descifrado R2 simulado, aislamiento por tenant, descarga sin caché y tratamiento USD. No se cargó un objeto real a R2 ni se creó una factura en producción.
- La suite `subscriptionService.test.js` pasó **40/40** tras añadir cobertura para plan no publicado, ausencia de método de pago y suscripción `incomplete`; `node --check` y `git diff --check` también pasaron.
- Smoke controlado de producción con `railway run` en `glowapp-api`: `invoiceService.generateInvoicePDF` creó un PDF sintético, se subió cifrado a R2, se descargó y descifró con contenido válido. El objeto temporal QA se borró y se verificó su ausencia. No se insertó fila en `invoices`, no se usó un tenant real ni se generó cobro.
- `flutter analyze lib/screens/saas/billing_screen.dart`: sin problemas. El método de descarga binaria autenticada se agregó a `glow_core`; el análisis local se ejecutó sobre la pantalla y no representa una prueba E2E.
- La corrección de consultas del job pasó Backend CI **45788092490** (sintaxis, pruebas, contrato, PostgreSQL e integración). PR #112 quedó integrado a `main` como `8329dc4ed27bcefde5b53395ac621e8a10969964`.
- Railway Producción desplegó el commit `8329dc4ed27bcefde5b53395ac621e8a10969964` en deployment `0629473d-6621-4ea4-a727-ebe36c2ba095`, estado `SUCCESS`. `/api/health` respondió HTTP 200, `env=production`, `pgAvailable=true`, `dbMode=postgres` y el mismo SHA.
- PR #113 pasó Backend CI **45789527296** y quedó integrado en `main` como `e013333cc6ea1a1a888f6a1551c44312bc9954cd`. Railway deployment `585e5154-9c3a-4450-acd2-1b13f15e6c65` terminó `SUCCESS`; `/api/health` respondió HTTP 200 con ese SHA y PostgreSQL activo. Los ocho servicios quedaron en línea, sin fallos recientes ni despliegues pendientes.
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
| Facturas | Parcial en código | Generación PDF y round-trip cifrado R2 comprobados en producción con objeto sintético y limpieza verificada. Falta el recorrido con registro de factura QA, autorización por tenant y endpoint autenticado, además del envío del comprobante. El documento no es factura electrónica y la tasa tributaria debe validarse. |
| Recuperación | Parcial en código; no activa en producción | El job tiene consultas con RLS, correos y auditoría; el mapeo de contactos coincide con el esquema migrado y pasó CI. Faltan auditoría de objetivos productivos, política de gracia y recuperación del método de pago. Mantenerlo sin cron hasta completar esa revisión. |

## Pendientes prioritarios

1. Configurar y verificar precios, moneda y llaves del proveedor mediante variables secretas; nunca incluirlas en commits o logs.
2. Completar Wompi con el flujo documentado de fuente de pago y transacciones recurrentes, y verificar su checksum de eventos y la referencia persistida de cada intento.
3. Configurar el webhook productivo y ejecutar pruebas de pago aprobado, pendiente, rechazado, duplicado, renovación, reintento y cancelación.
4. Auditar en producción qué trials/facturas serían afectados; definir estado de permisos durante mora y período de gracia. Solo entonces programar el job y comprobar los correos en una cuenta QA autorizada.
5. Validar la fila de factura, autorización por tenant y descarga autenticada con un pago QA confirmado; la prueba actual cubrió PDF y R2 con un objeto sintético sin crear fila ni cobro. Conectar el envío del comprobante y validar los requisitos tributarios antes de ofrecerlo como factura fiscal.
6. Completar en UI el historial de método de pago y las fechas/efectos de cancelación y cambio de nivel cuando esos flujos estén activos.

## Evidencia de publicación

PR #113 agregó validaciones de planes y métodos de pago, y bloqueó el otorgamiento de capacidades mientras el primer pago siga incompleto. Backend CI **45789527296** pasó; Railway desplegó `e013333cc6ea1a1a888f6a1551c44312bc9954cd` en `585e5154-9c3a-4450-acd2-1b13f15e6c65` con estado `SUCCESS`. El health check confirmó HTTP 200, PostgreSQL activo y cero servicios Railway con fallos o despliegues pendientes.

La prueba real de almacenamiento ejecutada después usó las variables de producción del servicio por CLI y el certificado raíz del sistema (validación TLS activa). El PDF sintético se generó con `invoiceService`, se guardó/cargó/descifró en R2 y el objeto QA se eliminó y verificó ausente. La prueba no creó una fila en `invoices` ni una transacción; sigue pendiente el flujo pago→factura→descarga autenticada.

La corrección inicial de mapeo de facturas se publicó mediante PR #106 (commit `7f05ab84cd5ebb2c6cbabac8f03907898addf187`, Railway `SUCCESS`). Las protecciones de cobro, webhook y pantalla se integraron mediante PR #107 (commit `fd0ac71e0405b39e5d4a42a29cb4c3510d2d3785`, Railway `SUCCESS`; workflow Firebase live `45778750924`). La recuperación por correo y rol RLS se publicó mediante PR #109 (commit `8106235863e5f916a8462b6ffcad255056594f58`, Railway deployment `120645d8-a591-4500-84ba-a37b746557a3`, `SUCCESS`). La implementación de PDF cifrado en R2 y la descarga autenticada desde la app Prestador se integró mediante PR #110 (commit `e458f850f598375209cdf6ff7e6ff4488e397a98`); el workflow Firebase `45786316389` publicó la app Prestador. PR #112 corrigió el mapeo de consultas del job de recuperación al esquema migrado; CI `45788092490` pasó y Railway desplegó `8329dc4ed27bcefde5b53395ac621e8a10969964` en `0629473d-6621-4ea4-a727-ebe36c2ba095`, `SUCCESS`. El smoke de producción de ese SHA devolvió HTTP 200 con PostgreSQL activo. No se cargó ni leyó un objeto real de R2 ni se generó una factura en producción. No se publicó ni modificó la app Cliente. Checkout, pruebas E2E de pagos y el job automático siguen pendientes porque Stripe no está configurado; el job permanece sin cron.
