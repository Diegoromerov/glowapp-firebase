# Fase 7 — Paquetes comerciales y lanzamiento gradual

**Estado:** En curso. Línea base vigente en `main` (`be1f987a0d6cfcd033f3bb1cd71296a52df6092e`); el ciclo de Prueba Gratis está desplegado en producción. Checkout conciliado, definición final de oferta y piloto siguen abiertos.

**Objetivo:** que la oferta presentada a salones coincida con el catálogo, las condiciones de contratación, las capacidades realmente protegidas y las cuotas medidas; preparar una salida gradual que pueda detenerse.

## Oferta actualmente declarada por el backend

La fuente de catálogo es `backend/src/config/saasCatalog.js` (versión 2), publicada por `GET /api/saas/catalog`. El backend incluye todos los niveles en la respuesta; `commerciallyAvailable` distingue los niveles que pueden contratarse. Los precios propuestos no son precios habilitados.

| Nivel | Precio mensual vigente en catálogo | Disponibilidad para nuevas altas/compra | Capacidades/cuotas principales declaradas |
|---|---:|---|---|
| Prueba Gratis | $0 | Alta inicial | 14 días declarados; 3 personas; 150 reservas directas/mes; caja, inventario, reportes, recursos, marca, fidelización, recetas, analítica, modo de prueba de facturación, Aura y WhatsApp con cuotas limitadas. |
| Freemium | $0 | Alta inicial | Permanente; 1 persona; 30 reservas directas/mes; mapa, reservas en línea, recibos no fiscales y reportes básicos. |
| Básico | $99.000 COP | Disponible comercialmente en catálogo; checkout de producción no verificado y sujeto a configuración | 5 personas; reservas sin límite declarado; caja, inventario, reportes, recursos (5) y checklists; facturación no incluida. |
| Crecimiento | Sin precio vigente; $169.000 es propuesto | No disponible | Oferta propuesta: hasta 10 personas y capacidades adicionales. |
| Profesional | $249.000 COP conserva el precio de cuentas existentes | No disponible para nuevas condiciones/compra | Conserva derechos compatibles de API/analítica/marca para cuentas actuales; la oferta V3 con condiciones nuevas está propuesta. |
| Empresarial | $599.000 COP conserva el precio de cuentas existentes | No disponible para nuevas condiciones/compra | Conserva derechos de cuentas actuales; la propuesta V3 de multi-sede, API y atención comercial no constituye oferta habilitada. |

Los valores propuestos de Growth, Pro y Enterprise no deben mostrarse como ofertas contratables. Los add-ons del catálogo declaran `available: false`. El onboarding Flutter consume el catálogo backend; si no puede cargarlo, su respaldo local permite solo Prueba Gratis, Freemium y Básico. En el selector, las nuevas altas pueden escoger Prueba Gratis o Freemium; el alta inicial rechaza planes pagos. Básico se contrata desde Facturación cuando el checkout está operativo.

## Evidencia técnica inspeccionada

| Área | Estado observado en `main` | Evaluación |
|---|---|---|
| Catálogo y precios | Catálogo V2 centraliza nombres, disponibilidad, capacidades y cuotas. `invoiceService` y Wompi consultan el precio de catálogo. | Fuente común disponible; el informe previo describía cifras antiguas y se corrige aquí. |
| Disponibilidad de compra | `subscriptionService`, checkout, Wompi y bootstrap rechazan niveles no disponibles. Los planes gratuitos se eligen en el alta. | Guard de disponibilidad presente. |
| Prueba de pago | El checkout Stripe usa `trialDays: 0`; `subscriptionService` solo deriva `trialDays` de catálogo (14 para FREE_TRIAL, 0 para pagos). El checkout COP depende de Wompi SaaS habilitado. | La contradicción histórica de 30 días en planes pagos ya no está en el código inspeccionado. |
| Prueba gratis del alta | El bootstrap guarda `saas_plan`, crea el perfil/membership y no crea una fila en `subscriptions` ni guarda fecha de inicio/fin de prueba en el perfil. El job de vencimiento solo procesa `subscriptions.trial_end`. | **Brecha P0:** el alta anuncia 14 días, pero el flujo normal de alta no inicia ni vence esa prueba; por tanto, no está demostrado que termine a los 14 días ni que luego pase a Freemium. |
| Personas | Las invitaciones protegen `TEAM_MANAGEMENT`; el servicio de membresías limita activos y pendientes con `TEAM_SEATS`. | Gate y cuota aplicados en las rutas revisadas; falta prueba end-to-end de aceptación y cambio de plan en producción. |
| Reservas | `bookingController` controla y consume `DIRECT_BOOKINGS` en transacción para reservas directas del salón; el marketplace tiene origen separado. | La cuota representa reservas directas, no todas las reservas recibidas. Falta evidencia de cobertura en todos los canales, reintentos y límites en producción. |
| Analítica y API | `/api/saas/analytics` requiere `ADVANCED_ANALYTICS`; crear/usar llaves exige `API_KEYS`, y las llamadas de API se miden al autenticar una API key. | Aplicación localizada. “Procesos de integración” debe explicar que cuenta llamadas autenticadas por llave, no operaciones cotidianas de la app. |
| Caja, inventario, recursos y recetas | Rutas de salón aplican los entitlements `POS_INTEGRATION`/`POS_RECEIPTS_ONLY`, `INVENTORY`, `RESOURCES` y `RECIPES`; LOYALTY tiene gates administrativos y de cliente. | Gates visibles en las rutas inspeccionadas; hace falta inventariar todas las rutas/variantes para certificar cobertura integral. |
| WhatsApp, Aura, multi-sede y marca | Hay capacidades y cuotas en el catálogo, pero esta revisión no encontró un mapa completo de rutas de producto, proveedor activo, medición y guard para cada una. | No declararlos como diferenciales habilitados hasta cerrar ese mapa y validar cada flujo. |
| Facturación electrónica | Capacidades y add-ons aparecen en catálogo, varios como propuesta/no disponibles. | No ofrecer cobro ni servicio fiscal a partir de la mera presencia de la capacidad en el catálogo. |
| Agotamiento de cuotas | `consumeUsage` aplica límite atómico en sus puntos de uso; disponibilidad y comportamiento varían por ruta. No hay una política comercial uniforme documentada para todos los límites. | Definir aviso, bloqueo, tolerancia y recuperación para cada métrica antes del lanzamiento. |
| Producción | Migration 202 aplicada; salud de API informa PostgreSQL disponible. El job dedicado corre a diario a las 06:00 de Bogotá; su ejecución manual de control reportó 0 pruebas vencidas, 0 salones actualizados y 0 eventos, conforme a la ventana inicial de 14 días. Firebase Hosting del proveedor fue publicado y responde HTTP 200. | Evidencia de despliegue y ejecución del job, no de una expiración real ni de un cobro real. Las rutas de pagos siguen cerradas cuando falta configuración/conciliación segura. |

## Correcciones realizadas en este informe

- Se reemplazaron las cifras antiguas de la tabla y del checkout por los valores actuales del catálogo V2.
- Se separaron los precios vigentes heredados de Pro/Empresarial de sus nuevas ofertas propuestas.
- Se registró que el alta normal no persiste ni procesa el vencimiento de la prueba gratuita de 14 días. Es un defecto funcional, no una decisión comercial que deba ocultarse con copy.
- Se retiró la afirmación de que los planes pagos obtienen 30 días de prueba: el código actual inspeccionado usa `trialDays: 0` para planes pagos.
- Se distinguió el conteo de reserva directa de las reservas de marketplace y el uso de API keys de otras interacciones del producto.

## Trabajo restante para cerrar Fase 7

| Prioridad | Trabajo | Criterio de cierre |
|---|---|---|
| P0 | Validar de extremo a extremo la expiración de una prueba nueva, el downgrade a Freemium y la protección de una suscripción pagada. | Job y despliegue activos; ejecución manual sin vencimientos confirmó que no degrada tenants prematuramente. Falta una prueba controlada con tenant de QA y fecha expirada, más evidencia de protección de suscripción pagada. |
| P0 | Confirmar que checkout, consentimiento, renovación y cambio de plan funcionan con configuración productiva. Wompi checkout permanece cerrado si faltan sus credenciales/flags; Stripe requiere su configuración y webhook. | Una compra autorizada de QA se concilia una sola vez y activa el plan correcto; sin cobros reales a usuarios ajenos. |
| P1 | Completar matriz por capacidad con catálogo → guard → rutas de lectura/escritura → métrica → agotamiento → UI, incluyendo todos los canales de reserva e invitación. | Cada beneficio vendido tiene gate y prueba de autorización; cada cuota tiene definición y efecto coherente. |
| P1 | Conciliar fallback Flutter y catálogo backend para nombres, límites, capacidades, disponibilidad y texto. Mantener el backend como fuente de verdad; añadir comprobación de paridad al CI. | Cambios incompatibles rompen CI; modo sin conexión no inventa precios/ofertas. |
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

- Base: `main` en `be1f987a0d6cfcd033f3bb1cd71296a52df6092e`.
- Evidencia: inspección estática del catálogo, bootstrap, facturación, servicio de suscripción, cron de vencimiento, gates, rutas de operación, medidor, selector Flutter y respaldo local.
- Este registro describe la ejecución documental anterior: no cambió aplicación/datos y no hizo llamadas autenticadas a producción.
- Resultado: se cerró la brecha técnica de inicio y vencimiento programado de Prueba Gratis. Fase 7 permanece abierta por la prueba controlada de downgrade, conciliación productiva de cobros, matriz integral de cuotas y rutas, decisiones comerciales pendientes y piloto medido.
