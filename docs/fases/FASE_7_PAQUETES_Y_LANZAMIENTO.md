# Fase 7 — Paquetes comerciales y lanzamiento gradual

**Estado:** En curso. Catálogo V4, migración 203 y app del proveedor publicados en producción el 26 de noviembre de 2026. Checkout conciliado, definición final de oferta y piloto siguen abiertos.

**Objetivo:** que la oferta presentada a salones coincida con el catálogo, las condiciones de contratación, las capacidades realmente protegidas y las cuotas medidas; preparar una salida gradual que pueda detenerse.

## Ajuste de la oferta de prueba — 26 de noviembre de 2026

- La Prueba Gratis para nuevas altas se limita a módulos con flujo operativo en la aplicación: mapa, reservas, caja, inventario, reportes, recursos, cumplimiento, fidelización y recetas. Conserva el plazo de 14 días, hasta 3 personas y 150 reservas directas al mes.
- Marca personalizada, analítica avanzada, modo de prueba de facturación, Aura para negocio y WhatsApp se quitan de esta oferta hasta que sus rutas, integraciones y medición puedan verificarse.
- Los tenants que ya tenían la oferta anterior pasan a `FREE_TRIAL_LEGACY`; mantienen las capacidades y cuotas concedidas, junto con su vencimiento actual. No se les degrada por este cambio. Al expirar, el job sigue pasándolos a Freemium.
- `FREE_TRIAL_LEGACY` no aparece en el catálogo público, no se acepta como plan de alta/compra y sí conserva sus límites para el backend, el panel de consumo y la aplicación del proveedor.
- El cambio se integró en `main` (`7d8fb33`). Railway aplicó la migración 203; los logs confirman su éxito. El API responde catálogo V4, PostgreSQL disponible y Firebase Hosting del proveedor devuelve HTTP 200.
- En el commit `7f06dd3`, se retiró `INVOICING_ADDON` de las capacidades públicas de Básico porque el complemento sigue sin estar disponible. El add-on y la cuota de documentos permanecen desactivados; no se activaron cargos fiscales.
- CI de Backend pasó; el workflow de Firebase completó Analyze & Tests, análisis Flutter, build web del proveedor y deploy live con éxito.
- Se auditaron las rutas de catálogo: reservas directas y límites mensuales; membresías y asientos; caja; inventario del salón; recursos y límite por plan; recetas; cumplimiento; fidelización; mapa. No se encontró un bypass en los routers revisados. Esto es revisión de código/CI, no una prueba de compra ni una aceptación de usuarios en producción.

## Oferta actualmente declarada por el backend

La fuente de catálogo es `backend/src/config/saasCatalog.js` (versión 4), publicada por `GET /api/saas/catalog`. El nivel interno `FREE_TRIAL_LEGACY` conserva las condiciones ya concedidas y se excluye del catálogo público y del alta nueva. Los precios propuestos no son precios habilitados.

| Nivel | Precio mensual vigente en catálogo | Disponibilidad para nuevas altas/compra | Capacidades/cuotas principales declaradas |
|---|---:|---|---|
| Prueba Gratis | $0 | Alta inicial | 14 días declarados; hasta 3 personas; 150 reservas directas/mes; mapa, reservas, caja, inventario, reportes, recursos, cumplimiento, fidelización y recetas. |
| Freemium | $0 | Alta inicial | Permanente; 1 persona; 30 reservas directas/mes; mapa, reservas en línea, recibos no fiscales y reportes básicos. |
| Básico | $99.000 COP | Disponible comercialmente en catálogo; checkout de producción no verificado y sujeto a configuración | 5 personas; reservas sin límite declarado; caja, inventario, reportes, recursos (5) y checklists; facturación no incluida. |
| Crecimiento | Sin precio vigente; $169.000 es propuesto | No disponible | Oferta propuesta: hasta 10 personas y capacidades adicionales. |
| Profesional | $249.000 COP conserva el precio de cuentas existentes | No disponible para nuevas condiciones/compra | Conserva derechos compatibles de API/analítica/marca para cuentas actuales; la oferta V3 con condiciones nuevas está propuesta. |
| Empresarial | $599.000 COP conserva el precio de cuentas existentes | No disponible para nuevas condiciones/compra | Conserva derechos de cuentas actuales; la propuesta V3 de multi-sede, API y atención comercial no constituye oferta habilitada. |

Los valores propuestos de Growth, Pro y Enterprise no deben mostrarse como ofertas contratables. Los add-ons del catálogo declaran `available: false`. El onboarding Flutter consume el catálogo backend; si no puede cargarlo, su respaldo local ofrece solo Prueba Gratis, Freemium y Básico con la misma lista corregida de capacidades. En el selector, las nuevas altas pueden escoger Prueba Gratis o Freemium; el alta inicial rechaza planes pagos. Básico se contrata desde Facturación cuando el checkout está operativo.

## Evidencia técnica inspeccionada

| Área | Estado observado en `main` | Evaluación |
|---|---|---|
| Catálogo y precios | Catálogo V3 centraliza nombres, disponibilidad, capacidades y cuotas. `invoiceService` y Wompi consultan el precio de catálogo. | Fuente común disponible; oferta de prueba nueva corregida y derechos anteriores versionados. |
| Disponibilidad de compra | `subscriptionService`, checkout, Wompi y bootstrap rechazan niveles no disponibles. Los planes gratuitos se eligen en el alta. | Guard de disponibilidad presente. |
| Prueba de pago | El checkout Stripe usa `trialDays: 0`; `subscriptionService` solo deriva `trialDays` de catálogo (14 para FREE_TRIAL, 0 para pagos). El checkout COP depende de Wompi SaaS habilitado. | La contradicción histórica de 30 días en planes pagos ya no está en el código inspeccionado. |
| Prueba gratis del alta | El bootstrap persiste `saas_trial_started_at` y `saas_trial_ends_at`; el job independiente procesa vencimientos de perfil y sincroniza el plan del salón. El servicio admite una ejecución delimitada a un tenant UUID; el cron conserva su selección global. | CI PostgreSQL/RLS `45960610493` demuestra que el tenant objetivo se degrada y otro vencido queda intacto; PR #213 está en producción (`b963def`). Falta aceptación con QA productivo; no se alteró el plan de QA Salón Fase 2. |
| Personas | Las invitaciones protegen `TEAM_MANAGEMENT`; el servicio de membresías limita activos y pendientes con `TEAM_SEATS`. | Gate y cuota aplicados en las rutas revisadas; falta prueba end-to-end de aceptación y cambio de plan en producción. |
| Reservas | `bookingController` controla y consume `DIRECT_BOOKINGS` en transacción para reservas directas del salón; el marketplace tiene origen separado. El proveedor recibe el error estructurado, uso/límite y acceso a Facturación cuando agota el cupo. | PR #194 cubre con PostgreSQL real el rollback ante fallo, el límite 29→30/HTTP 429 y que marketplace no consume la cuota directa. PR #215 añade feedback de UI; CI `45962602718` pasó y Firebase Hosting live publicó la app en el workflow `45963726287` (HTTP 200). Falta aceptación funcional con tenant QA productivo. |
| Analítica y API | `/api/saas/analytics` requiere `ADVANCED_ANALYTICS`; crear/usar llaves exige `API_KEYS`, y las llamadas se miden al autenticar una API key. El backend valida nombre, scopes y vigencia. La integración expuesta hoy es de solo lectura de servicios. | El endpoint y cuota tienen cobertura PostgreSQL/RLS; llaves vencidas se rechazan sin consumo. PR #198 valida entradas y PR #200 restringe scopes a `read`, ocultando permisos sin endpoints y marcando los heredados como no habilitados. CI pasó y Hosting live publicó PR #200 (`45949299810`, HTTP 200). Sigue pendiente aceptar una llave válida de tenant QA en producción y decidir excedentes. |
| Caja, inventario, recursos y recetas | Rutas de salón aplican los entitlements `POS_INTEGRATION`/`POS_RECEIPTS_ONLY`, `INVENTORY`, `RESOURCES` y `RECIPES`; LOYALTY tiene gates administrativos y de cliente. | Gates visibles en las rutas inspeccionadas; hace falta inventariar todas las rutas/variantes para certificar cobertura integral. |
| WhatsApp, Aura, multi-sede y marca | No se encontró un flujo SaaS entregable y medido para WhatsApp, Aura de negocio o marca personalizada. Multi-sede tampoco se ofrece en los niveles disponibles. | Se retiraron esas capacidades de la Prueba Gratis nueva; los tenants existentes mantienen los derechos heredados hasta el vencimiento. |
| Facturación electrónica | Capacidades y add-ons aparecen en catálogo, varios como propuesta/no disponibles. | No ofrecer cobro ni servicio fiscal a partir de la mera presencia de la capacidad en el catálogo. |
| Agotamiento de cuotas | Las cuotas de reservas directas dan 429 atómico y distinguen marketplace; la app proveedor ya presenta el uso y el límite y abre Facturación. Recursos, asientos y API aplican sus propios límites y mensajes de backend. | La respuesta visible queda cerrada para reservas. Sigue faltando política uniforme y aceptación de UI por capacidad para recursos, equipo y API; no se cobran excedentes. |
| Cancelación Wompi | La cancelación detiene renovaciones y fija `cancel_at_period_end`, conservando el plan pagado hasta terminar el período cubierto; el job de renovación aplica Freemium al vencimiento. | PR #212, Backend CI `45959229138`, producción `52630da`. La prueba de lógica/despliegue no sustituye cobros ni conciliación con Wompi live; checkout sigue cerrado si falta configuración. |
| Producción | Railway API, dashboard y cron están saludables; el último despliegue del código de cuota quedó en `ff54de9`. Hosting live del proveedor publicó el bundle con el aviso de cupo y destino de Facturación; HTTP 200 en portada y JavaScript principal. | Evidencia de publicación y salud, no de una expiración real con tenant QA ni de cobros. Las rutas de pago siguen cerradas cuando falta configuración/conciliación segura. |

## Presentación del catálogo sincronizada — 26 de noviembre de 2026

- Se alinearon las descripciones de Prueba Gratis, Freemium y Básico entre el backend y el respaldo local Flutter. Ambas muestran los mismos períodos y cuotas principales.
- El catálogo remoto del onboarding ahora muestra Reservas en línea y traduce cuotas de recursos, Aura, WhatsApp, documentos, API y sedes a etiquetas comerciales; omite contadores internos de NIT, mapa y equipo que ya aparecen en otras partes de la tarjeta.
- Backend y proveedor se integraron en `main` (`2cb857b`). CI de backend y Flutter pasó; Railway reportó el API online y `GET /api/saas/catalog` devolvió catálogo V2 con FREE_TRIAL, FREEMIUM y BASIC disponibles. Firebase Hosting del proveedor respondió HTTP 200 tras el despliegue live.
- En PR #144 se agregó la comparación automatizada de la oferta activa del respaldo Flutter con el catálogo backend; los detalles y evidencia actualizados están abajo.

## Evidencia de producción del catálogo V3/V4 — 26 de noviembre de 2026

- Commit de producción: `7d8fb33945050b2ab12208103a63c8ab666e44be`.
- Railway API deployment `72bd847b-268b-45e7-a4eb-671642d01b1d`: SUCCESS. Sus logs registran `203_saas_trial_legacy_entitlements.sql` aplicada exitosamente.
- `GET /api/health`: `status=OK`, entorno production, commit `7d8fb33`, PostgreSQL disponible y 75 migraciones registradas.
- `GET /api/saas/catalog` con `X-App-Audience: provider`: versión 3; nuevos planes FREE_TRIAL, FREEMIUM y BASIC disponibles; `FREE_TRIAL_LEGACY` no se publica.
- Firebase workflow run `45866544786`: Analyze & Tests, Build glow_provider y Deploy glow_provider finalizaron SUCCESS. `https://glowapp-provider.web.app` responde HTTP 200.
- La revisión posterior del permiso de facturación se integró en `7f06dd3`; Railway deployment `db14df5e-4aee-411d-a12c-9e9f89d9ebd0` terminó SUCCESS. La API ahora devuelve catálogo V4, Básico ya no contiene `INVOICING_ADDON` y ese add-on sigue `available: false`.
- La compra real, la renovación y el downgrade controlado siguen pendientes. Wompi recurrente permanece desactivado; tampoco está configurado un proveedor de facturación electrónica.

## Hallazgos corregidos y cerrados

- Se reemplazaron las cifras antiguas de la tabla y del checkout por los valores actuales del catálogo V2.
- Se separaron los precios vigentes heredados de Pro/Empresarial de sus nuevas ofertas propuestas.
- Se resolvió el hallazgo de que el alta no persistía ni procesaba el vencimiento de la Prueba Gratis: fechas, aviso y job de transición ya están publicados.
- Se retiró la afirmación de que los planes pagos obtienen 30 días de prueba: el código actual inspeccionado usa `trialDays: 0` para planes pagos.
- Se distinguió el conteo de reserva directa de las reservas de marketplace y el uso de API keys de otras interacciones del producto.

## Trabajo restante para cerrar Fase 7

| Prioridad | Trabajo | Criterio de cierre |
|---|---|---|
| P0 | Validar de extremo a extremo la expiración de una prueba nueva, el downgrade a Freemium y la protección de una suscripción pagada. | Job y despliegue activos; ejecución manual sin vencimientos confirmó que no degrada tenants prematuramente. Falta una prueba controlada con tenant de QA y fecha expirada, más evidencia de protección de suscripción pagada. |
| P0 | Confirmar que checkout, consentimiento, renovación y cambio de plan funcionan con configuración productiva. Wompi checkout permanece cerrado si faltan sus credenciales/flags; Stripe requiere su configuración y webhook. | Una compra autorizada de QA se concilia una sola vez y activa el plan correcto; sin cobros reales a usuarios ajenos. |
| P1 | Completar matriz por capacidad con catálogo → guard → rutas de lectura/escritura → métrica → agotamiento → UI, incluyendo todos los canales de reserva e invitación. | Cada beneficio vendido tiene gate y prueba de autorización; cada cuota tiene definición y efecto coherente. |
| P1 | Paridad Flutter/backend del catálogo activo. | **Cerrado:** CI compara disponibilidad/compra, nombre, descripción, precio, beneficios y todas las cuotas declaradas para Prueba Gratis, Freemium y Básico. Los planes propuestos permanecen no contratables. |
| P1 | Acordar y mostrar qué pasa al alcanzar cada límite, qué datos se conservan al bajar de plan y cómo reactivar al mejorar de nivel. | Mensajes y comportamiento de API/UI coinciden y no destruyen datos al bajar de plan. |
| P2 | Aclarar alcance operativo de WhatsApp, Aura, POS, multi-sede y soporte; comprobar proveedor, permisos, cuotas y capacidad de atención antes de activar oferta. | Beneficio se puede entregar y medir; soporte/SLA no se promete sin capacidad. |
| P2 | Preparar piloto y rollout gradual: cohortes, métricas de fallo/uso/soporte, interruptores y reversión. | Piloto medido; criterios de ampliación y reversión escritos; no hay divergencias de tenant/plan/cuota. |

## Seguridad del ciclo de prueba — 26 de noviembre de 2026

- Se verificó que `FREE_TRIAL` no necesita ni debe crear objetos de facturación en Stripe: su plazo lo gestiona `business_profiles.saas_trial_ends_at` y el job SaaS independiente la degrada a Freemium.
- `subscriptionService` ahora limita la creación de customer/suscripción Stripe a planes pagos. El alta gratuita conserva el registro local para estado y presentación, sin medio de pago ni renovación externa.
- El cambio se integró en `main` (`7a9474b`) y Railway lo desplegó en producción (deployment `0d9c984a-3a7e-4e37-8ad2-117e91ae78e5`, SUCCESS). La CI de backend pasó tras un reintento; el primer fallo fue el E2E de catálogo/RLS, que pasó en el reintento.
- Verificación productiva posterior: `/api/health` devuelve `OK`; `GET /api/saas/catalog` devuelve versión 4, Prueba Gratis de 14 días y Básico sin `INVOICING_ADDON`.
- No se ejecutó ni se canceló ninguna suscripción remota en Stripe. El cambio evita crear nuevas suscripciones remotas para pruebas; no reconcilia ni cancela registros históricos existentes en Stripe.
- La prueba real de expiración y downgrade con tenant QA todavía falta. Esto no cierra el checkout, conciliación de pagos, auditoría integral de cuotas, decisiones comerciales ni piloto; Fase 7 sigue en curso.

## Paridad de medición de reservas — 26 de noviembre de 2026

- Se corrigió el dashboard SaaS para usar el mismo período mensual de Bogotá que usa el contador de cuotas, incluidos historial y reporte de recordatorios.
- La recuperación histórica de reservas directas ahora deduplica reservas agrupadas con `primary_booking_id` y filtra únicamente la reserva primaria, igual que el contador transaccional que permite o bloquea nuevas reservas.
- PR #136 se integró a `main` en `36823f8`; Backend CI pasó. Railway production deployment `696816cc-811b-42f1-8cb2-d74419154520` terminó SUCCESS y `/api/health` confirmó `OK` con ese commit.
- Este arreglo cierra la discrepancia de período y deduplicación para reservas directas; no certifica todavía las demás métricas, todos los canales de reserva ni el comportamiento de agotamiento por plan.

## Vencimiento con pago confirmado — 26 de noviembre de 2026

- El job de expiración ahora conserva el acceso de prueba solo si encuentra una suscripción de plan pago en estado `active`. Los registros `incomplete`, `trialing` o `past_due` no extienden la prueba sin confirmación de pago; los estados locales `FREE_TRIAL`/`FREE_TRIAL_LEGACY` tampoco la bloquean.
- El cambio se integró en `main` (`44a16dc`). Backend CI pasó; Railway desplegó con SUCCESS tanto `glowapp-api` (`3849d5ea-4e92-4692-a9e1-98b2110e17a6`) como `saas-trial-lifecycle` (`408ca727-bbd6-4751-966f-812e913e9750`). `/api/health` devolvió `OK` para el commit `44a16dc`.
- No se invocó el cron manualmente en producción para no afectar tenants que pudieran haber vencido. La ejecución controlada que distingue plan activo pagado de intento sin pago requiere un tenant QA aislado; permanece pendiente.

## Secuencia de implementación recomendada

1. Resolver el vencimiento de Prueba Gratis con fecha de inicio y transición segura, sin alterar retroactivamente tenants existentes.
2. Cerrar tabla de entitlements, rutas, cuotas y comportamiento ante exceso; corregir gates faltantes comprobados.
3. Sincronizar onboarding/facturación y respaldo local con el catálogo, con paridad exigida por CI.
4. Confirmar configuración de pago en producción y realizar recorrido de QA controlado, evitando cobros a usuarios reales.
5. Ejecutar piloto gradual, medirlo y documentar rollback antes de ampliar.

## Riesgo comercial y de datos

La modificación de precios, acceso o prueba puede afectar contratos y funciones de salones existentes. Esta revisión no cambió esos datos. La implementación del vencimiento debe dar una ventana explícita a los tenants actuales, mantener íntegra su información y permitir recuperar el nivel al contratar. Los planes propuestos, complementos y capacidades sin integración verificada no se deben activar por inferencia.

## Avance de producción — 26 de noviembre de 2026

- El cambio `be1f987` está integrado en `main`. CI del backend, análisis y pruebas de Flutter, build web del proveedor y job de despliegue Firebase live finalizaron correctamente.
- La migration `202_saas_trial_lifecycle.sql` se aplicó en Railway producción. En altas nuevas se guardan `saas_trial_started_at` y `saas_trial_ends_at`; las pruebas existentes recibieron una ventana explícita de 14 días desde la migración.
- La pantalla Facturación muestra estado y fecha de finalización de la prueba. El job `saas-trial-lifecycle` está separado del servidor web y programado diariamente a las 06:00 de Bogotá. Procesa downgrade idempotente a Freemium, sincroniza el plan del salón y escribe auditoría; excluye suscripciones pagas activas.
- La invocación manual de control terminó correctamente con 0 tenants vencidos, 0 salones modificados y 0 eventos. En ese instante no había una prueba dentro de la ventana vencida; por tanto, no se afirma haber probado el downgrade real con tenant vencido.
- API de producción reportó HTTP 200, PostgreSQL disponible y sin datos fabricados. La app proveedor en Firebase Hosting live reportó HTTP 200.
- No se activó ni se probó un cobro real. El catálogo y el código mantienen los niveles de nueva contratación limitados a los disponibles; checkout y cambio de plan dependen de credenciales/configuración y conciliación segura del proveedor.

## Registro de esta ejecución

## Paridad de la pantalla de uso y reportes — 26 de noviembre de 2026

- La app del proveedor separa `DIRECT_BOOKINGS` de solicitudes API y deja de presentar cuotas `0` como ilimitadas. Solo límites nulos o explícitamente ilimitados se muestran con ese estado.
- La cuota `API_CALLS` se presenta como solicitudes de integración externas autenticadas mediante llave API; el uso normal dentro de GlowApp no las consume.
- Los cortes de mes de SuperAdmin se alinean a `America/Bogota`, igual que el medidor SaaS. El documento de Fase 2 se corrigió para reflejar ese contrato.
- PR [#140](https://github.com/Diegoromerov/glowapp-firebase/pull/140), commit `837d9b9`, integrado a `main`. PR CI #45893949292 y CI de Flutter #45894126815 pasaron.
- Railway desplegó API y panel administrativo para el commit `837d9b9`; deployment de API `6fe2c085-649f-4103-9913-2934632a572b` terminó SUCCESS. `/api/health` devolvió `OK`, PostgreSQL disponible y sin fallback de datos.
- Firebase workflow #45894457431 pasó análisis, pruebas Glow Core y análisis del proveedor; el build web y despliegue Hosting live terminaron SUCCESS. `https://glowapp-provider.web.app` devolvió HTTP 200.
- La ejecución inicial de Backend CI en `main` tuvo un fallo aislado en el E2E del catálogo restringido, pese a que el mismo commit pasó ese E2E en PR CI. El reintento de la ejecución #45894126757 pasó el E2E y el flujo completo.

## Precio visible desde el catálogo SaaS — 26 de noviembre de 2026

- La pantalla de cambio de plan ya no utiliza el precio fijo del enum Flutter: muestra el `priceCop` y el `interval` convertidos desde el catálogo backend. El fallback local mantiene su precio cuando la API no responde.
- Las unidades de cuotas en beneficios ahora usan la unidad publicada por backend, con el texto local solo como fallback.
- PR [#142](https://github.com/Diegoromerov/glowapp-firebase/pull/142), commit `623065c`, integrado a `main`. Flutter CI #45895878565 pasó análisis y pruebas.
- El workflow Firebase #45896199703 publicó la app proveedor en Hosting live con éxito. La API productiva entrega Básico a `99.000 COP/mes`; los niveles propuestos permanecen con `commerciallyAvailable: false`. Hosting responde HTTP 200.
- En ese momento faltaba la comparación integral; PR #144 la agregó para todos los datos de fallback de los planes activos.

## Paridad del catálogo activo en CI y onboarding — 26 de noviembre de 2026

- PR [#144](https://github.com/Diegoromerov/glowapp-firebase/pull/144), commit `9740d7f`, quedó integrado en `main`.
- `saasCommercialCatalog.nodetest.js` compara Prueba Gratis, Freemium y Básico entre el catálogo backend y el respaldo Flutter: nombre, descripción, precio, beneficios visibles, todas las cuotas declaradas y banderas de disponibilidad/compra.
- El texto local de Prueba Gratis quedó alineado a 150 reservas mensuales y se normalizaron unidades de cuota. El E2E de catálogo reintenta disponibilidad de API mientras inicia el esquema, evitando la carrera de arranque observada en CI.
- Backend CI del PR y de `main` #45897948551 pasó; Flutter CI #45897948635 pasó. Firebase live #45898280790 terminó SUCCESS; el hosting proveedor responde HTTP 200.
- Se cierra el punto de paridad del catálogo activo. La auditoría de rutas, entitlements, cuotas operativas y agotamiento continúa abierta.

- Base: `main` en `2cb857bb48a3d794b904a113cbb645b8f569f5f2`.
- Evidencia: inspección estática del catálogo, bootstrap, facturación, servicio de suscripción, cron de vencimiento, gates, rutas de operación, medidor, selector Flutter y respaldo local.
- La auditoría de código se complementó con verificación de salud productiva, ejecución del job y confirmación del hosting.
- Resultado: se cerró la brecha técnica de inicio y vencimiento programado de Prueba Gratis. Fase 7 permanece abierta por la prueba controlada de downgrade, conciliación productiva de cobros, matriz integral de cuotas y rutas, decisiones comerciales pendientes y piloto medido.

## Cuota de reservas desde el controlador real — 27 de noviembre de 2026

- PR [#194](https://github.com/Diegoromerov/glowapp-firebase/pull/194), integrado en `main` como `244a4c05f2015b610725137e5be635bb663ba91e`.
- La prueba de integración ejecuta `createBooking` con PostgreSQL/PostGIS real de CI y confirma que si falla el alta, la reserva de cuota revierte junto con la transacción; la cuota permanece en 29 y no queda una reserva parcial.
- La prueba confirma que la última reserva directa permitida cambia el uso de 29 a 30; una nueva reserva directa responde 429 `SAAS_QUOTA_EXCEEDED`. Una reserva del marketplace sigue el origen independiente y no incrementa `DIRECT_BOOKINGS`.
- CI del PR `45946611097` y CI de `main` `45946792869` pasaron, incluidas integración PostgreSQL, aislamiento RLS y E2E de API.
- Railway producción desplegó el commit `244a4c0` (deployment `91a23716-f278-46dc-8860-e6377274c341`) con estado SUCCESS. `/api/health` respondió `OK`, PostgreSQL disponible y sin datos simulados.
- Durante la validación se completó el registro en el arranque y preparación de CI de migraciones aditivas faltantes `097`, `098`, `099`, `198` y `206`; los logs de Railway confirman su aplicación correcta en producción.
- Este cierre cubre el camino del controlador y su atomicidad; no sustituye aceptación de usuario en tenant QA ni cierra el resto de Fase 7.

## Continuación Fase 7: cancelación y agotamiento de cuota — 27 de noviembre de 2026

- **Cancelación Wompi:** PR #212 corrige el retiro anticipado del acceso pagado; CI `45959229138` y producción `52630da` confirmaron el despliegue. El período pagado se conserva y no se inicia la renovación cancelada. El cobro real/conciliación live sigue pendiente de credenciales y proveedor configurado.
- **Vencimiento QA seguro:** PR #213 (`b963def`) permite limitar la operación a un UUID de tenant, con regresión PostgreSQL/RLS CI `45960610493`; el cron diario sigue global. No se cambió el plan del salón QA productivo.
- **Feedback de reservas:** PR #215 (`ff54de9`) conserva la métrica de cuota en Glow Core y muestra al prestador el uso mensual, el límite y el acceso a Facturación. CI de `main` `45962602718` pasó pruebas de Glow Core y ambas apps. Firebase Hosting live `45963726287` compiló y publicó el bundle; portada y JavaScript principal respondieron HTTP 200.
- La revisión no activa precios propuestos, complementos, facturación electrónica ni renovaciones reales. Fase 7 sigue abierta por aceptación QA productiva, conciliación de cobros, matriz completa de agotamiento/roles, decisiones comerciales pendientes y piloto.
