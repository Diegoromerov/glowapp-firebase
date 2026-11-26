# Onboarding SaaS — Fase 6: facturación y cambios de plan

**Corte:** 26 de noviembre de 2026  
**Estado:** implementación desplegada; fase abierta hasta validar el proveedor.
**Avance de implementación:** 80 % estimado (código, UI y despliegue; no equivale a validación de pagos).
**Recorrido de pago E2E con Wompi:** 0 % verificado.

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

## Contrato Wompi y consentimiento (26 de noviembre de 2026)

Se corrigió el contrato actual de Wompi para que el checkout no dependa del endpoint legado ni omita autorizaciones requeridas:

- Consulta los dos tokens de aceptación desde `GET /merchants/info`, con la llave pública en `x-merchant-public-key`.
- Pide y muestra por separado el consentimiento de términos y la autorización de tratamiento de datos antes de enviar el pago. Si no llegan ambos tokens o el usuario no marca ambas casillas, no continúa.
- Envía `accept_personal_auth` al crear transacciones y fuentes de pago; backend rechaza solicitudes que no traigan el token.
- Retira las llamadas del adaptador legado que suponían recursos REST tipo Stripe para clientes/suscripciones/cancelación. Un plan COP de pago ahora falla de forma explícita mientras el ciclo real no esté integrado, evitando guardar una suscripción ficticia o activar capacidades sin pago confirmado.
- Añade compatibilidad de `recurrent` en el cliente HTTP para la futura transacción con fuente de pago; esta opción por sí sola no constituye el ciclo SaaS.

El cambio quedó integrado mediante [PR #115](https://github.com/Diegoromerov/glowapp-firebase/pull/115), commit `80c50c743a448b8b3fb516df8232d9d501ccc7db`. Backend CI **45796505440** pasó; Flutter CI **45796776493** pasó análisis, pruebas y builds. Firebase workflow **45797536672** desplegó ambas apps. Posteriormente, [PR #116](https://github.com/Diegoromerov/glowapp-firebase/pull/116) incorporó el ciclo SaaS Wompi con fuentes de pago cifradas, registro de intentos, conciliación y renovación protegida; [PR #117](https://github.com/Diegoromerov/glowapp-firebase/pull/117) mejoró la respuesta para pagos ambiguos; [PR #118](https://github.com/Diegoromerov/glowapp-firebase/pull/118) añadió a Facturación el estado del último intento; y [PR #120](https://github.com/Diegoromerov/glowapp-firebase/pull/120) aisló las credenciales SaaS, rechazó sandbox en producción y limitó el worker al gateway live. Los cuatro PR están integrados en `main`; CI pasó y Railway desplegó el backend con migración 201. El workflow Firebase **45841726300** terminó `success`; Prestador se compiló y publicó en Hosting, que responde HTTP 200.

No se ejecutó una transacción de Wompi sandbox ni se inició un cobro real en producción. Los flags de checkout, COF y cobro live permanecen desactivados. Por tanto, la implementación está desplegada, pero el contrato real de la cuenta, el webhook y el ciclo completo aún no están demostrados.

El código de renovación COP, la fuente de pago por tenant, referencias únicas, ledger de intentos, conciliación idempotente de `transaction.updated`, comprobante ligado al pago, período de gracia, cancelación local y worker protegido ya están implementados y desplegados. Falta validarlos contra Wompi sandbox y confirmar que el comercio tenga habilitado el producto/contrato COF/RBM. Ningún cobro está habilitado en producción.

## Pendientes prioritarios

1. Obtener credenciales de **sandbox Wompi** y configurarlas solo en un entorno local de QA; nunca poner llaves de prueba en Railway producción ni compartir secretos en el chat, commits o logs. El código rechazará el uso del gateway sandbox en `NODE_ENV=production` y no aplicará eventos sandbox a suscripciones productivas.
2. Ejecutar contra sandbox alta de fuente de pago, aceptación/consentimiento, pago aprobado/declinado, webhook duplicado y conciliación del intento.
3. Confirmar con Wompi la habilitación comercial COF/RBM y la elegibilidad de Visa/Mastercard; probar renovación, reintentos, monto, cancelación y período de gracia en sandbox.
4. Validar desde la app Prestador el flujo de consentimiento, el estado del intento después de volver a abrir Facturación, comprobante y descarga autenticada por tenant.
5. Revisar destinatarios y política de mora antes de activar el job automático. Definir la comunicación de cobros fallidos y probarla con una cuenta de QA autorizada.
6. Validar envío del comprobante y requisitos tributarios antes de presentarlo como factura fiscal; hoy es un comprobante informativo y el smoke de R2 no creó una fila de factura.
7. Solo después de las verificaciones sandbox y confirmación comercial, configurar las llaves live dedicadas y activar checkout/COF/live mediante un cambio controlado. Mantener apagados todos los flags mientras cualquiera de esas condiciones falte.

## Evidencia de publicación

PR #113 agregó validaciones de planes y métodos de pago, y bloqueó el otorgamiento de capacidades mientras el primer pago siga incompleto. Backend CI **45789527296** pasó; Railway desplegó `e013333cc6ea1a1a888f6a1551c44312bc9954cd` en `585e5154-9c3a-4450-acd2-1b13f15e6c65` con estado `SUCCESS`. El health check confirmó HTTP 200 y PostgreSQL activo. Los PR #116–#118 llevaron el ciclo Wompi a `main`; PR #120 aisló credenciales y host; PR #122 añadió `payment_method.installments=1` al pago inicial y renovaciones, conforme a la documentación oficial.

La prueba real de almacenamiento ejecutada después usó las variables de producción del servicio por CLI y el certificado raíz del sistema (validación TLS activa). El PDF sintético se generó con `invoiceService`, se guardó/cargó/descifró en R2 y el objeto QA se eliminó y verificó ausente. La prueba no creó una fila en `invoices` ni una transacción; sigue pendiente el flujo pago→factura→descarga autenticada.

La corrección inicial de mapeo de facturas se publicó mediante PR #106 (commit `7f05ab84cd5ebb2c6cbabac8f03907898addf187`, Railway `SUCCESS`). Las protecciones iniciales de cobro, webhook y pantalla se integraron mediante PR #107. La recuperación por correo y rol RLS se publicó mediante PR #109. PDF cifrado en R2 y descarga autenticada se integraron mediante PR #110; PR #112 corrigió el mapeo del job de recuperación; PR #114 ajustó los controles de pago. Después, PR #116–#118 llevaron a producción el ciclo Wompi y el estado visible de intentos, PR #120 separó la configuración SaaS y bloqueó sandbox en producción, y PR #122 corrigió los campos de cuotas exigidos para fuentes de tarjeta. Checkout y renovación permanecen apagados hasta terminar las verificaciones de sandbox y COF/RBM; el job automático continúa sin activarse.

## Implementación del ciclo Wompi desplegada (26 de noviembre de 2026)

El código desplegado incluye:

- Checkout SaaS de tarjeta con tokenización en el cliente y aceptación explícita de términos, tratamiento de datos y cobro mensual. El monto se calcula exclusivamente desde el catálogo del servidor.
- Creación de payment source Wompi; el ID se cifra con AES-256-GCM y clave SaaS dedicada, con clave anterior opcional para rotación. No se almacenan PAN ni CVC.
- Ledger de intentos con referencia única, límite de un intento abierto por tenant, protección contra doble envío y estado `UNKNOWN` ante timeout para evitar repetir a ciegas un posible cobro.
- Webhook `transaction.updated`: valida checksum, vuelve a consultar la transacción en Wompi y coteja referencia, monto y moneda antes de activar/sincronizar el plan o emitir comprobante idempotente. Un evento que llega antes del commit se responde con reintento.
- Cancelación inmediata o al final del período; un worker cada 15 minutos procesa renovaciones, cancelaciones programadas y recuperación con máximo tres intentos y período de gracia de 14 días.
- El checkout permanece cerrado por defecto. Los flags de cobro y COF están apagados; además, un cobro en live requiere dos activaciones adicionales. La recurrencia live queda condicionada a confirmar elegibilidad comercial COF/RBM de Wompi.
- Se valida que la fuente de pago responda `AVAILABLE`. La renovación automática se conserva solo para Visa/Mastercard; si la transacción aprobada informa otra marca o no informa una marca elegible, se concede el período pagado y se programa cancelación al vencimiento, sin conservar una fuente para renovación.
- El manejo de errores del checkout conserva los códigos HTTP de validación/configuración y devuelve la referencia durable cuando hay un intento ambiguo; la app muestra referencia/estado y advierte que no se debe volver a pagar mientras se concilia.
- El resumen de Facturación lee el último intento del ledger con filtro por tenant. La app muestra estado, valor y referencia para intentos pendientes, ambiguos, rechazados o aprobados, incluso al volver a abrir la pantalla.
- La configuración SaaS utiliza llaves y URL propias (`WOMPI_SAAS_*`), separadas de citas y GlowShop. El entorno sandbox exige llaves de prueba y está rechazado en `NODE_ENV=production`; los webhooks SaaS en producción solo se procesan contra el host live. El worker automático exige configuración live, COF y flags productivos explícitos.
- El cobro inicial y las renovaciones con fuente de tarjeta envían `payment_method.installments=1`, como indica la [documentación oficial de fuentes de pago Wompi](https://docs.wompi.co/docs/colombia/fuentes-de-pago/) para fuentes que representan tarjetas.

PR #116–#118, #120 y #122 están integrados en `main`. Backend CI **45846354332** pasó. Railway desplegó el commit `50d5843d45f1e9c6fc67e354db1cde31d70b4cae` en API y panel; el deployment de API `d50339b6-41d0-4f8b-8a98-270d8f10f1a6` terminó `SUCCESS`; `/api/health` devolvió HTTP 200, `env=production`, PostgreSQL activo y el mismo SHA. En las variables de `glowapp-api` no hay ninguna `WOMPI_SAAS_*`; el log confirma que las renovaciones SaaS siguen desactivadas. Firebase **45841726300** publicó Prestador y el hosting responde HTTP 200. No se ejecutaron pagos: el E2E con Wompi sigue en **0 %**, ya que faltan credenciales sandbox para QA local y confirmación COF/RBM.

### Pendientes para cerrar Fase 6

Los pasos concretos y el orden seguro están en [Pendientes prioritarios](#pendientes-prioritarios). A la fecha, la CI y el despliegue ya están completados; los pendientes de cierre son validaciones sandbox, confirmación comercial COF/RBM, recorrido Prestador→pago→webhook→comprobante y revisiones fiscal/operativa.
6. Revisar recepción de comprobantes, tratamiento fiscal y evidencia de consentimiento antes de abrir el checkout.
