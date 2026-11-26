# Fase 7 — Auditoría técnica de entitlements y cuotas

**Estado:** auditoría técnica parcial. Backend CI `45902457105` aprobó las cuatro suites PostgreSQL (18/18 pruebas), incluida la integración aislada del vencimiento. La prueba crea fixtures desechables y no equivale a ejecutar el cron ni validar un tenant QA en producción; tampoco certifica todas las variantes.

**Actualización de cuotas de recursos:** Backend CI `45903596883` aprobó cinco suites PostgreSQL (19/19 pruebas). La suite nueva compitió por el quinto recurso Básico y confirmó una creación, un rechazo `SAAS_QUOTA_EXCEEDED` y exactamente cinco filas persistidas. Es evidencia de concurrencia en la capa de controlador con PostgreSQL efímero, no una comprobación HTTP autenticada ni de producción.

**Evidencia CI revisada:** Backend CI `45897948551` ejecutó la suite `tests/saasMembershipConcurrency.integration.test.js` contra un contenedor PostGIS/PostgreSQL efímero y reportó PASS; dentro de esa ejecución pasaron 17 pruebas de las tres suites PostgreSQL seleccionadas. Es evidencia de integración en PostgreSQL de CI, no de Railway producción.

**Verificación adicional de autenticación QA en producción:** el primer POST sin `X-App-Audience` recibió `400 BAD_REQUEST` («Header X-App-Audience requerido»). Con `X-App-Audience: provider`, el login QA y `GET /api/auth/session` respondieron correctamente tras desplegar `0b55181`. Railway confirma que la cuenta corresponde al rol `PRESTADOR`, no `CLIENTE`; no se creó reserva ni se intentó pagar. La cuenta no sirve para el recorrido del cliente, pero sí permitió corregir y verificar el endpoint de sesión.

## Hallazgos por capacidad

| Capacidad / métrica | Evidencia observada en backend | Evaluación actual |
|---|---|---|
| `TEAM_MANAGEMENT` / `TEAM_SEATS` | `salonRoutes.js` y `saasTeamRoutes.js` verifican la capacidad en invitaciones y cambios de rol. `saasMembershipService.js` serializa los cambios por tenant y limita invitaciones, reactivaciones y reenvíos considerando miembros activos y pendientes. `backend/tests/saasMembershipConcurrency.integration.test.js` cubre PostgreSQL real, competencia por el último asiento, reactivación y aislamiento entre dos salones; CI #45897948551 reportó PASS. | Gate y cuota implementados; concurrencia/RLS con PostgreSQL de CI verificados. No se encontró evidencia de que la suite se ejecute contra Railway producción ni de recorrido completo con la cuenta QA. |
| `DIRECT_BOOKINGS` | `bookingController.createBooking` aplica el límite dentro de la transacción, bloquea la fila del tenant, cuenta el histórico al inicializar el medidor y solo consume para origen `SALON_DIRECT`. `bookingOrigin.saas.nodetest.js` verifica el mapeo provider/cliente, no la transacción de cuota. | Código de medición/bloqueo localizado; prueba de origen únicamente. Falta E2E que demuestre cuota al límite, rollback/reintento, reservas agrupadas y concurrencia, con ambos orígenes. |
| `RESOURCES` | `salonRoutes.js` exige `RESOURCES`; `salonOpsController.crearRecurso` serializa por salón con bloqueo asesor transaccional antes de contar y crear, y pasa contexto RLS a su conexión. | CI `45906440782`: 5 suites PostgreSQL, 20/20 pruebas. La ruta HTTP autenticada confirma propietario permitido, usuario ajeno denegado y una sola creación al competir por el último cupo (exactamente cinco recursos). API desplegada en Railway `0c43b72`; falta recorrido funcional con tenant QA real. |
| `INVENTORY` | Cuatro rutas de inventario en `salonRoutes.js` exigen el entitlement; `saasSalonModuleEntitlements.nodetest.js` verifica estáticamente esos gates. | Gate y comprobación estática presentes. El catálogo no declara cuota numérica; falta prueba runtime de permisos/alcance por rol y tenant. |
| `POS_INTEGRATION` / `POS_RECEIPTS_ONLY` | Las cuatro rutas de caja exigen al menos una de las dos capacidades. | Gate localizado; falta confirmar que operaciones fiscales, integraciones de POS y recibos no fiscales se separan según el beneficio prometido. |
| `RECIPES` | Lectura y actualización de insumos de servicio exigen `RECIPES`. | Gate localizado. No se anuncia una cuota numérica. Falta probar efecto del consumo al finalizar una cita y acceso por rol. |
| `COMPLIANCE` | Las rutas de diagnóstico, tareas y documentos en `businessRoutes.js` exigen `COMPLIANCE`. | Gate localizado en las rutas revisadas; no se certificó cobertura de todo endpoint alternativo o legado. |
| `LOYALTY` | Rutas administrativas SaaS aplican `router.use(requireEntitlement('LOYALTY'))`; saldo, catálogo y canje del cliente exigen `requireSalonEntitlement('LOYALTY')`. Pruebas nodetest inspeccionan los gates. | Gate localizado en administración y cliente; prueba estática presente. Se mantiene separado de puntos globales GlowApp. Falta recorrido E2E multiparte y permisos por tenant. |
| `API_CALLS` | Middleware de API key ejecuta `consumeUsage` antes de procesar la solicitud autenticada y responde límite excedido. Crear llaves requiere `API_KEYS`; las pruebas de `usageMeteringService` son unitarias/mocked. | Cuota localizada en el acceso autenticado por llave; no cuenta llamadas internas de la app. Falta E2E con llave y tenant QA para límite cero/alcanzado y no consumo en fallo. |
| `ADVANCED_ANALYTICS` | Lectura analítica y alertas de uso exigen el entitlement correspondiente. | Gate localizado en las rutas SaaS revisadas; las métricas visibles deben permanecer alineadas al catálogo. |
| Vencimiento de prueba | `saasFreeTrialExpirationCron.js` selecciona pruebas vencidas bajo `FOR UPDATE`, protege solo suscripciones pagas activas, actualiza el perfil y las sedes vinculadas y deja auditoría. `saasFreeTrialExpiration.integration.test.js` prueba Free Trial, legado, suscripción pagada, fecha futura, sincronización de sede, auditoría e idempotencia con PostgreSQL efímero. | CI `45902457105`: suite aprobada; 4 suites PostgreSQL y 18/18 pruebas aprobadas. No se ejecutó el cron sobre tenants productivos; sigue pendiente una validación controlada con tenant QA productivo. |
| `AURA_QUERIES`, `WHATSAPP_MESSAGES`, `INVOICING_DOCUMENTS`, `SITES`, `CUSTOM_BRANDING` | Hay definiciones de capacidades/cuotas y add-ons en el catálogo, pero no se encontró en las rutas SaaS inspeccionadas un flujo de consumo por tenant para esas métricas. | No certificadas como funciones SaaS operativas. Los add-ons están `available: false` y los niveles con estas ofertas no son contratables; no deben activarse por su mera presencia en el catálogo. |

## Actualización publicada — 26 de noviembre de 2026

- PR [#153](https://github.com/Diegoromerov/glowapp-firebase/pull/153), commit de producción `0c43b72265dccf68d2d3b9a90f91ae7cd8c8c753`, corrigió el contexto RLS independiente de `crearRecurso` y el intento de bloquear con `FOR UPDATE` un perfil que la app solo puede leer. La serialización del cupo usa ahora `pg_advisory_xact_lock` por salón dentro de la misma transacción.
- Backend CI `45906440782` terminó SUCCESS: 5 suites PostgreSQL, 20/20 pruebas; la prueba de ruta HTTP autenticada verificó propietario autorizado, usuario ajeno rechazado y concurrencia por el último cupo con exactamente cinco recursos.
- Railway producción desplegó API y cron en el commit `0c43b72`. `/api/health` respondió `OK`, PostgreSQL disponible, modo `postgres`, sin datos simulados. El cron `saas-trial-lifecycle` quedó en SUCCESS. No se escribieron filas de QA en producción.
- El endpoint HTTP y el contexto RLS quedan verificados en PostgreSQL efímero; eso no sustituye el recorrido manual con un tenant QA real.

## Consecuencias y trabajo siguiente

1. Validar con un tenant QA controlado la expiración real de prueba en producción; la integración de CI aprobada no se debe presentar como prueba de producción.
2. Crear una matriz QA aislada para reservas y API que cubra cuota cero, cuota alcanzada, rollback/reintento y concurrencia. El servicio de reservas debe probar ambos orígenes sin crear citas de clientes reales.
3. Completar un recorrido controlado de recursos con tenant QA en producción; CI cubre la ruta HTTP autenticada, el rechazo de usuario ajeno, RLS y concurrencia con fixtures efímeros.
4. Mantener deshabilitados los complementos e integraciones no disponibles, y no vender niveles propuestos.
5. Antes de implementar cuotas restantes, decidir evento, momento de consumo, reversión ante fallo/reintento y respuesta al agotamiento; ampliar la inspección de rutas heredadas antes de afirmar cobertura global.

## Límites de esta revisión

La evidencia combina inspección estática, CI PostgreSQL y comprobación de salud de producción. La prueba de recursos usa fixtures efímeros y no modifica producción. No se probaron rollback bajo fallos ni todos los canales. Fase 7 continúa abierta.
