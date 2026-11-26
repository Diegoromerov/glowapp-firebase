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
- La pantalla de facturación ahora consulta las capacidades del backend: oculta el portal de pagos y la gestión de tarjeta cuando Stripe no está configurado, y no ofrece cancelar desde UI las suscripciones Wompi mientras ese flujo no exista. El resumen declara proveedor y capacidades efectivas; las rutas rechazan portal/cancelación si Stripe no está disponible.

## Validación

- Pruebas focalizadas de facturas y suscripciones: **42/42 aprobadas** (mocks locales; no son cargos ni pruebas contra el proveedor).
- `node --check` en las rutas, servicios y entrypoint modificados: aprobado.
- `git diff --check`: aprobado.
- Prueba unitaria del job de recuperación: **2/2 aprobadas**; cubre el contexto de sistema y el envío/auditoría de factura vencida. No ejecuta correos ni cambios de suscripción reales.
- Pruebas locales focalizadas de facturación, almacenamiento, ruta de descarga y suscripciones: **12/12 aprobadas en el último bloque ejecutado**; incluye PDF válido, cifrado/descifrado R2 simulado, aislamiento por tenant, descarga sin caché y tratamiento USD. Ese bloque no creó una fila de factura en producción; el smoke real de R2 se registra por separado abajo.
- La suite `subscriptionService.test.js` pasó **40/40** tras añadir cobertura para plan no publicado, ausencia de método de pago y suscripción `incomplete`; `node --check` y `git diff --check` también pasaron.
- Smoke controlado de producción con `railway run` en `glowapp-api`: `invoiceService.generateInvoicePDF` creó un PDF sintético, se subió cifrado a R2, se descargó y descifró con contenido válido. El objeto temporal QA se borró y se verificó su ausencia. No se insertó fila en `invoices`, no se usó un tenant real ni se generó cobro.
- `flutter analyze lib/screens/saas/billing_screen.dart`: sin problemas. El método de descarga binaria autenticada se agregó a `glow_core`; el análisis local se ejecutó sobre la pantalla y no representa una prueba E2E.
- La corrección de consultas del job pasó Backend CI **45788092490** (sintaxis, pruebas, contrato, PostgreSQL e integración). PR #112 quedó integrado a `main` como `8329dc4ed27bcefde5b53395ac621e8a10969964`.
- Railway Producción desplegó el commit `8329dc4ed27bcefde5b53395ac621e8a10969964` en deployment `0629473d-6621-4ea4-a727-ebe36c2ba095`, estado `SUCCESS`. `/api/health` respondió HTTP 200, `env=production`, `pgAvailable=true`, `dbMode=postgres` y el mismo SHA.
- PR #113 pasó Backend CI **45789527296** y quedó integrado en `main` como `e013333cc6ea1a1a888f6a1551c44312bc9954cd`. Railway deployment `585e5154-9c3a-4450-acd2-1b13f15e6c65` terminó `SUCCESS`; `/api/health` respondió HTTP 200 con ese SHA y PostgreSQL activo. Los ocho servicios quedaron en línea, sin fallos recientes ni despliegues pendientes.
- El commit documental `121646359366c41c1a1a33ab9944386cd4a357c3` también terminó desplegado en Railway (`b83e7a4d-097b-4f86-805e-b13ea4023a3c`, `SUCCESS`). El health check actual respondió HTTP 200, confirmó ese SHA y PostgreSQL activo; los ocho servicios quedaron en línea y sin trabajo pendiente.
- Railway Producción no tiene variables `STRIPE_*` configuradas. Una solicitud HTTP inocua al webhook respondió `503 Stripe SaaS webhook no configurado`, como debe ocurrir mientras falta esa configuración.
- El workflow Firebase [45778750924](https://github.com/Diegoromerov/glowapp-firebase/actions/runs/45778750924) terminó `success`: análisis y pruebas del prestador, build web y deploy live. El hosting del prestador devolvió HTTP 200 y el bundle público contiene el aviso “La facturación SaaS está temporalmente pausada”.
- Railway confirmó deployment `88271019-efeb-496c-b20a-b89c25759724`, commit `fd0ac71e0405b39e5d4a42a29cb4c3510d2d3785`, estado `SUCCESS`. `/api/health` devuelve `OK`, `production` y el mismo commit.
- No se inició checkout, cobro, renovación ni cancelación en producción.
- PR #114 pasó Backend CI tras un reintento completo (run **45792534477**: sintaxis, pruebas, PostgreSQL, contratos y E2E de catálogo). Se integró a `main` en commit **`3dac67ca9a6ba5879609c57d8c9c17acb6b2a497`**. Railway Producción desplegó API (`574c15d8-dccd-408e-91b4-3ffa72cc6862`) y panel administrativo (`6c4fd54f-ef6f-43a9-b53f-e3a90f8f7a53`) en `SUCCESS`; los ocho servicios están en línea, sin fallos recientes ni trabajo pendiente. La prueba E2E que falló inicialmente pasó en el reintento.

## Estado por capacidad

| Capacidad | Estado | Pendiente para validarla |
| --- | --- | --- |
| Checkout | Parcial | Configurar precios y webhook de Stripe; construir el flujo oficial de Wompi para COP y sus cobros recurrentes. |
| Activación | Parcial | Ejecutar eventos firmados reales y comprobar que plan/permisos cambian sólo tras pago aprobado. |
| Renovación | Parcial | Probar cobro de un período posterior, facturación idempotente y evento de fallo. |
| Cancelación | Parcial | Verificar cancelación Stripe al fin de período y diseñar la operación compatible con Wompi. |
| Facturas | Parcial en código | Generación PDF y round-trip cifrado R2 comprobados en producción con objeto sintético y limpieza verificada. Falta el recorrido con registro de factura QA, autorización por tenant y endpoint autenticado, además del envío del comprobante. El documento no es factura electrónica y la tasa tributaria debe validarse. |
| Recuperación | Parcial en código; no activa en producción | El job tiene consultas con RLS, correos y auditoría; el mapeo de contactos coincide con el esquema migrado y pasó CI. Faltan auditoría de objetivos productivos, política de gracia y recuperación del método de pago. Mantenerlo sin cron hasta completar esa revisión. |

## Avance siguiente: contrato Wompi y consentimiento (26 de noviembre de 2026)

En la rama de trabajo se está corrigiendo el contrato actual de Wompi para evitar que la aceptación de pagos falle por el endpoint legado o por omitir autorización de datos:

- Consulta los dos tokens de aceptación desde `GET /merchants/info`, con la llave pública en `x-merchant-public-key`.
- Pide y muestra por separado el consentimiento de términos y la autorización de tratamiento de datos antes de enviar el pago. Si no llegan ambos tokens o el usuario no marca ambas casillas, no continúa.
- Envía `accept_personal_auth` al crear transacciones y fuentes de pago; backend rechaza solicitudes que no traigan el token.
- Retira las llamadas del adaptador legado que suponían recursos REST tipo Stripe para clientes/suscripciones/cancelación. Un plan COP de pago ahora falla de forma explícita mientras el ciclo real no esté integrado, evitando guardar una suscripción ficticia o activar capacidades sin pago confirmado.
- Añade compatibilidad de `recurrent` en el cliente HTTP para la futura transacción con fuente de pago; esta opción por sí sola no constituye el ciclo SaaS.

El cambio quedó integrado mediante [PR #115](https://github.com/Diegoromerov/glowapp-firebase/pull/115), commit `80c50c743a448b8b3fb516df8232d9d501ccc7db`. Backend CI **45796505440** pasó; el workflow de Flutter **45796776493** pasó análisis y pruebas de `glow_core`, Prestador y Cliente, y compiló las dos webs. El workflow Firebase **45797536672** terminó `SUCCESS` con despliegue live de ambas apps; Cliente y Prestador responden HTTP 200. Railway Producción desplegó API y panel administrativo en `SUCCESS`; el health check de `/api/health` confirmó el mismo commit, PostgreSQL activo, `dbMode=postgres` y sin fallback a datos simulados. El entorno quedó con los ocho servicios en línea, cero fallos recientes y sin despliegues pendientes.

No se usaron las credenciales de QA ni se envió una transacción. La prueba de pago queda pendiente en sandbox; no se inició un cobro real en producción.

La implementación integral de renovación COP aún debe añadir la creación/almacenamiento de payment source por tenant, referencias únicas por período, registro de intentos, conciliación e idempotencia de `transaction.updated`, factura ligada al pago aprobado, política de mora/gracia, cancelación local de futuras renovaciones y worker con bloqueo estricto de entorno. La recurrencia de Wompi queda condicionada a que el comercio tenga habilitado el producto/contrato aplicable; no se activa ningún cobro real mientras Wompi siga en sandbox.

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

La corrección inicial de mapeo de facturas se publicó mediante PR #106 (commit `7f05ab84cd5ebb2c6cbabac8f03907898addf187`, Railway `SUCCESS`). Las protecciones de cobro, webhook y pantalla se integraron mediante PR #107 (commit `fd0ac71e0405b39e5d4a42a29cb4c3510d2d3785`, Railway `SUCCESS`; workflow Firebase live `45778750924`). La recuperación por correo y rol RLS se publicó mediante PR #109 (commit `8106235863e5f916a8462b6ffcad255056594f58`, Railway deployment `120645d8-a591-4500-84ba-a37b746557a3`, `SUCCESS`). La implementación de PDF cifrado en R2 y la descarga autenticada desde la app Prestador se integró mediante PR #110 (commit `e458f850f598375209cdf6ff7e6ff4488e397a98`); el workflow Firebase `45786316389` publicó la app Prestador. PR #112 corrigió el mapeo de consultas del job de recuperación al esquema migrado; CI `45788092490` pasó y Railway desplegó `8329dc4ed27bcefde5b53395ac621e8a10969964` en `0629473d-6621-4ea4-a727-ebe36c2ba095`, `SUCCESS`. PR #114 ajustó los controles de pago a las capacidades disponibles; CI `45792534477` pasó en el reintento y se integró como `3dac67ca9a6ba5879609c57d8c9c17acb6b2a497`. Railway API y panel están en `SUCCESS` con los ocho servicios en línea. No se inició checkout, cobro, renovación ni cancelación en producción. Checkout, pruebas E2E de pagos y el job automático siguen pendientes porque Stripe no está configurado; el job permanece sin cron.

## Avance de implementación del ciclo Wompi (26 de noviembre de 2026)

La rama `codex/phase6-wompi-recurring-cycle` añade al código local:

- Checkout SaaS de tarjeta con tokenización en el cliente y aceptación explícita de términos, tratamiento de datos y cobro mensual. El monto se calcula exclusivamente desde el catálogo del servidor.
- Creación de payment source Wompi; el ID se cifra con AES-256-GCM y clave SaaS dedicada, con clave anterior opcional para rotación. No se almacenan PAN ni CVC.
- Ledger de intentos con referencia única, límite de un intento abierto por tenant, protección contra doble envío y estado `UNKNOWN` ante timeout para evitar repetir a ciegas un posible cobro.
- Webhook `transaction.updated`: valida checksum, vuelve a consultar la transacción en Wompi y coteja referencia, monto y moneda antes de activar/sincronizar el plan o emitir comprobante idempotente. Un evento que llega antes del commit se responde con reintento.
- Cancelación inmediata o al final del período; un worker cada 15 minutos procesa renovaciones, cancelaciones programadas y recuperación con máximo tres intentos y período de gracia de 14 días.
- El checkout permanece cerrado por defecto. Los flags de cobro y COF están apagados; además, un cobro en live requiere dos activaciones adicionales. La recurrencia live queda condicionada a confirmar elegibilidad comercial COF/RBM de Wompi.
- Se valida que la fuente de pago responda `AVAILABLE`. La renovación automática se conserva solo para Visa/Mastercard; si la transacción aprobada informa otra marca o no informa una marca elegible, se concede el período pagado y se programa cancelación al vencimiento, sin conservar una fuente para renovación.
- El manejo de errores del checkout conserva los códigos HTTP de validación/configuración y devuelve la referencia durable cuando hay un intento ambiguo; la app muestra referencia/estado y advierte que no se debe volver a pagar mientras se concilia.

El commit `f7f7da2` se integró a `main` mediante PR #116 y Railway producción lo desplegó con estado `SUCCESS` el 26 de noviembre de 2026. Los logs confirman que `201_saas_wompi_recurring_billing.sql` se aplicó y que el job de renovaciones quedó desactivado. La CI del PR pasó y `/api/health` confirmó backend y PostgreSQL disponibles en el commit desplegado. No se ejecutaron pagos, no se usaron credenciales y no hubo cargos. La Fase 6 permanece abierta y el E2E de pago permanece en **0 %**, porque no se ha validado la cuenta sandbox ni el ciclo real de Wompi.

### Pendientes para cerrar Fase 6

1. Pasar revisión CI de migración, RLS, idempotencia del webhook, renovación y reintentos; desplegar el código con los flags apagados.
2. Confirmar y probar el contrato Wompi de fuentes de pago en sandbox, incluido el webhook y una transacción de QA autorizada.
3. Verificar COF/RBM con Wompi antes de habilitar cobros periódicos; probar el ciclo mensual y su monto constante en un entorno autorizado.
4. Comprobar cancelación, cambio de plan, renovación aprobada/rechazada, reintentos, mora y período de gracia con eventos reales de sandbox.
5. Probar en la app la autorización del precio mensual, estado pendiente, conciliación, comprobante y descarga por tenant.
6. Revisar recepción de comprobantes, tratamiento fiscal y evidencia de consentimiento antes de abrir el checkout.
