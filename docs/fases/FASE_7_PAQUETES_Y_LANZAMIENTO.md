# Fase 7 — Paquetes comerciales y lanzamiento gradual

**Estado:** En curso. Catálogo V3, migración 203 y app del proveedor publicados en producción el 26 de noviembre de 2026. Checkout conciliado, definición final de oferta y piloto siguen abiertos.

**Objetivo:** que la oferta presentada a salones coincida con el catálogo, las condiciones de contratación, las capacidades realmente protegidas y las cuotas medidas; preparar una salida gradual que pueda detenerse.

## Ajuste de la oferta de prueba — 26 de noviembre de 2026

- La Prueba Gratis para nuevas altas se limita a módulos con flujo operativo en la aplicación: mapa, reservas, caja, inventario, reportes, recursos, cumplimiento, fidelización y recetas. Conserva el plazo de 14 días, hasta 3 personas y 150 reservas directas al mes.
- Marca personalizada, analítica avanzada, modo de prueba de facturación, Aura para negocio y WhatsApp se quitan de esta oferta hasta que sus rutas, integraciones y medición puedan verificarse.
- Los tenants que ya tenían la oferta anterior pasan a `FREE_TRIAL_LEGACY`; mantienen las capacidades y cuotas concedidas, junto con su vencimiento actual. No se les degrada por este cambio. Al expirar, el job sigue pasándolos a Freemium.
- `FREE_TRIAL_LEGACY` no aparece en el catálogo público, no se acepta como plan de alta/compra y sí conserva sus límites para el backend, el panel de consumo y la aplicación del proveedor.
- El cambio se integró en `main` (`7d8fb33`). Railway aplicó la migración 203; los logs confirman su éxito. El API responde catálogo V3, PostgreSQL disponible y Firebase Hosting del proveedor devuelve HTTP 200.
- CI de Backend pasó; el workflow de Firebase completó Analyze & Tests, análisis Flutter, build web del proveedor y deploy live con éxito.
- Se auditaron las rutas de catálogo: reservas directas y límites mensuales; membresías y asientos; caja; inventario del salón; recursos y límite por plan; recetas; cumplimiento; fidelización; mapa. No se encontró un bypass en los routers revisados. Esto es revisión de código/CI, no una prueba de compra ni una aceptación de usuarios en producción.

## Oferta actualmente declarada por el backend

La fuente de catálogo es `backend/src/config/saasCatalog.js` (versión 3), publicada por `GET /api/saas/catalog`. El nivel interno `FREE_TRIAL_LEGACY` conserva las condiciones ya concedidas y se excluye del catálogo público y del alta nueva. Los precios propuestos no son precios habilitados.

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
| Prueba gratis del alta | El bootstrap persiste `saas_trial_started_at` y `saas_trial_ends_at`; el job independiente procesa vencimientos de perfil y sincroniza el plan del salón. | Inicio, fecha visible y downgrade programado están en producción. La ejecución controlada sin datos vencidos no prueba todavía el caso de expiración real. |
| Personas | Las invitaciones protegen `TEAM_MANAGEMENT`; el servicio de membresías limita activos y pendientes con `TEAM_SEATS`. | Gate y cuota aplicados en las rutas revisadas; falta prueba end-to-end de aceptación y cambio de plan en producción. |
| Reservas | `bookingController` controla y consume `DIRECT_BOOKINGS` en transacción para reservas directas del salón; el marketplace tiene origen separado. | La cuota representa reservas directas, no todas las reservas recibidas. Falta evidencia de cobertura en todos los canales, reintentos y límites en producción. |
| Analítica y API | `/api/saas/analytics` requiere `ADVANCED_ANALYTICS`; crear/usar llaves exige `API_KEYS`, y las llamadas de API se miden al autenticar una API key. | Aplicación localizada. “Procesos de integración” debe explicar que cuenta llamadas autenticadas por llave, no operaciones cotidianas de la app. |
| Caja, inventario, recursos y recetas | Rutas de salón aplican los entitlements `POS_INTEGRATION`/`POS_RECEIPTS_ONLY`, `INVENTORY`, `RESOURCES` y `RECIPES`; LOYALTY tiene gates administrativos y de cliente. | Gates visibles en las rutas inspeccionadas; hace falta inventariar todas las rutas/variantes para certificar cobertura integral. |
| WhatsApp, Aura, multi-sede y marca | No se encontró un flujo SaaS entregable y medido para WhatsApp, Aura de negocio o marca personalizada. Multi-sede tampoco se ofrece en los niveles disponibles. | Se retiraron esas capacidades de la Prueba Gratis nueva; los tenants existentes mantienen los derechos heredados hasta el vencimiento. |
| Facturación electrónica | Capacidades y add-ons aparecen en catálogo, varios como propuesta/no disponibles. | No ofrecer cobro ni servicio fiscal a partir de la mera presencia de la capacidad en el catálogo. |
| Agotamiento de cuotas | `consumeUsage` aplica límite atómico en sus puntos de uso; disponibilidad y comportamiento varían por ruta. No hay una política comercial uniforme documentada para todos los límites. | Definir aviso, bloqueo, tolerancia y recuperación para cada métrica antes del lanzamiento. |
| Producción | Migration 202 aplicada; salud de API informa PostgreSQL disponible. El job dedicado corre a diario a las 06:00 de Bogotá; su ejecución manual de control reportó 0 pruebas vencidas, 0 salones actualizados y 0 eventos, conforme a la ventana inicial de 14 días. Firebase Hosting del proveedor fue publicado y responde HTTP 200. | Evidencia de despliegue y ejecución del job, no de una expiración real ni de un cobro real. Las rutas de pagos siguen cerradas cuando falta configuración/conciliación segura. |

## Presentación del catálogo sincronizada — 26 de noviembre de 2026

- Se alinearon las descripciones de Prueba Gratis, Freemium y Básico entre el backend y el respaldo local Flutter. Ambas muestran los mismos períodos y cuotas principales.
- El catálogo remoto del onboarding ahora muestra Reservas en línea y traduce cuotas de recursos, Aura, WhatsApp, documentos, API y sedes a etiquetas comerciales; omite contadores internos de NIT, mapa y equipo que ya aparecen en otras partes de la tarjeta.
- Backend y proveedor se integraron en `main` (`2cb857b`). CI de backend y Flutter pasó; Railway reportó el API online y `GET /api/saas/catalog` devolvió catálogo V2 con FREE_TRIAL, FREEMIUM y BASIC disponibles. Firebase Hosting del proveedor respondió HTTP 200 tras el despliegue live.
- Sigue faltando una prueba automatizada que compare integralmente descripción, capacidades y funciones visibles del catálogo remoto con el respaldo local. Por eso la paridad de catálogo se considera mejorada, pero todavía parcial.

## Evidencia de producción del catálogo V3 — 26 de noviembre de 2026

- Commit de producción: `7d8fb33945050b2ab12208103a63c8ab666e44be`.
- Railway API deployment `72bd847b-268b-45e7-a4eb-671642d01b1d`: SUCCESS. Sus logs registran `203_saas_trial_legacy_entitlements.sql` aplicada exitosamente.
- `GET /api/health`: `status=OK`, entorno production, commit `7d8fb33`, PostgreSQL disponible y 75 migraciones registradas.
- `GET /api/saas/catalog` con `X-App-Audience: provider`: versión 3; nuevos planes FREE_TRIAL, FREEMIUM y BASIC disponibles; `FREE_TRIAL_LEGACY` no se publica.
- Firebase workflow run `45866544786`: Analyze & Tests, Build glow_provider y Deploy glow_provider finalizaron SUCCESS. `https://glowapp-provider.web.app` responde HTTP 200.
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
| P1 | Completar paridad Flutter/backend para nombres, precios, límites, capacidades y funciones visibles. Las descripciones comerciales activas ya están alineadas y el render remoto oculta métricas internas; falta probar integralmente esos invariantes en CI. | Cambios divergentes de oferta activa fallan CI; el modo sin conexión conserva la misma oferta y no inventa beneficios. |
| P1 | Acordar y mostrar qué pasa al alcanzar cada límite, qué datos se conservan al bajar de plan y cómo reactivar al mejorar de nivel. | Mensajes y comportamiento de API/UI coinciden y no destruyen datos al bajar de plan. |
| P2 | Aclarar alcance operativo de WhatsApp, Aura, POS, multi-sede y soporte; comprobar proveedor, permisos, cuotas y capacidad de atención antes de activar oferta. | Beneficio se puede entregar y medir; soporte/SLA no se promete sin capacidad. |
| P2 | Preparar piloto y rollout gradual: cohortes, métricas de fallo/uso/soporte, interruptores y reversión. | Piloto medido; criterios de ampliación y reversión escritos; no hay divergencias de tenant/plan/cuota. |

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

- Base: `main` en `2cb857bb48a3d794b904a113cbb645b8f569f5f2`.
- Evidencia: inspección estática del catálogo, bootstrap, facturación, servicio de suscripción, cron de vencimiento, gates, rutas de operación, medidor, selector Flutter y respaldo local.
- La auditoría de código se complementó con verificación de salud productiva, ejecución del job y confirmación del hosting.
- Resultado: se cerró la brecha técnica de inicio y vencimiento programado de Prueba Gratis. Fase 7 permanece abierta por la prueba controlada de downgrade, conciliación productiva de cobros, matriz integral de cuotas y rutas, decisiones comerciales pendientes y piloto medido.
