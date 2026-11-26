# Fase 7 — Auditoría técnica de entitlements y cuotas

**Estado:** auditoría estática parcial del código en `main` (`1621e3e`, 26 de noviembre de 2026). No equivale a pruebas de integración en producción ni a certificación de todas las variantes.

**Evidencia CI revisada:** Backend CI `45897948551` ejecutó la suite `tests/saasMembershipConcurrency.integration.test.js` contra un contenedor PostGIS/PostgreSQL efímero y reportó PASS; dentro de esa ejecución pasaron 17 pruebas de las tres suites PostgreSQL seleccionadas. Es evidencia de integración en PostgreSQL de CI, no de Railway producción.

**Verificación adicional de autenticación QA en producción:** el primer POST sin `X-App-Audience` recibió `400 BAD_REQUEST` («Header X-App-Audience requerido»). Con `X-App-Audience: provider`, el login QA y `GET /api/auth/session` respondieron correctamente tras desplegar `0b55181`. Railway confirma que la cuenta corresponde al rol `PRESTADOR`, no `CLIENTE`; no se creó reserva ni se intentó pagar. La cuenta no sirve para el recorrido del cliente, pero sí permitió corregir y verificar el endpoint de sesión.

## Hallazgos por capacidad

| Capacidad / métrica | Evidencia observada en backend | Evaluación actual |
|---|---|---|
| `TEAM_MANAGEMENT` / `TEAM_SEATS` | `salonRoutes.js` y `saasTeamRoutes.js` verifican la capacidad en invitaciones y cambios de rol. `saasMembershipService.js` serializa los cambios por tenant y limita invitaciones, reactivaciones y reenvíos considerando miembros activos y pendientes. `backend/tests/saasMembershipConcurrency.integration.test.js` cubre PostgreSQL real, competencia por el último asiento, reactivación y aislamiento entre dos salones; CI #45897948551 reportó PASS. | Gate y cuota implementados; concurrencia/RLS con PostgreSQL de CI verificados. No se encontró evidencia de que la suite se ejecute contra Railway producción ni de recorrido completo con la cuenta QA. |
| `DIRECT_BOOKINGS` | `bookingController.createBooking` aplica el límite dentro de la transacción, bloquea la fila del tenant, cuenta el histórico al inicializar el medidor y solo consume para origen `SALON_DIRECT`. `bookingOrigin.saas.nodetest.js` verifica el mapeo provider/cliente, no la transacción de cuota. | Código de medición/bloqueo localizado; prueba de origen únicamente. Falta E2E que demuestre cuota al límite, rollback/reintento, reservas agrupadas y concurrencia, con ambos orígenes. |
| `RESOURCES` | `salonRoutes.js` exige `RESOURCES` en lectura/escritura; `salonOpsController.crearRecurso` bloquea el perfil, cuenta recursos y detiene la creación al alcanzar la cuota. `salonResourceQuota.nodetest.js` cubre los casos con DB simulada y comprueba rollback/no inserción. | Gate y cuota localizados; prueba unitaria presente, no integración con PostgreSQL. Falta validar límite concurrente y la semántica de cantidad configurada en producción QA. |
| `INVENTORY` | Cuatro rutas de inventario en `salonRoutes.js` exigen el entitlement; `saasSalonModuleEntitlements.nodetest.js` verifica estáticamente esos gates. | Gate y comprobación estática presentes. El catálogo no declara cuota numérica; falta prueba runtime de permisos/alcance por rol y tenant. |
| `POS_INTEGRATION` / `POS_RECEIPTS_ONLY` | Las cuatro rutas de caja exigen al menos una de las dos capacidades. | Gate localizado; falta confirmar que operaciones fiscales, integraciones de POS y recibos no fiscales se separan según el beneficio prometido. |
| `RECIPES` | Lectura y actualización de insumos de servicio exigen `RECIPES`. | Gate localizado. No se anuncia una cuota numérica. Falta probar efecto del consumo al finalizar una cita y acceso por rol. |
| `COMPLIANCE` | Las rutas de diagnóstico, tareas y documentos en `businessRoutes.js` exigen `COMPLIANCE`. | Gate localizado en las rutas revisadas; no se certificó cobertura de todo endpoint alternativo o legado. |
| `LOYALTY` | Rutas administrativas SaaS aplican `router.use(requireEntitlement('LOYALTY'))`; saldo, catálogo y canje del cliente exigen `requireSalonEntitlement('LOYALTY')`. Pruebas nodetest inspeccionan los gates. | Gate localizado en administración y cliente; prueba estática presente. Se mantiene separado de puntos globales GlowApp. Falta recorrido E2E multiparte y permisos por tenant. |
| `API_CALLS` | Middleware de API key ejecuta `consumeUsage` antes de procesar la solicitud autenticada y responde límite excedido. Crear llaves requiere `API_KEYS`; las pruebas de `usageMeteringService` son unitarias/mocked. | Cuota localizada en el acceso autenticado por llave; no cuenta llamadas internas de la app. Falta E2E con llave y tenant QA para límite cero/alcanzado y no consumo en fallo. |
| `ADVANCED_ANALYTICS` | Lectura analítica y alertas de uso exigen el entitlement correspondiente. | Gate localizado en las rutas SaaS revisadas; las métricas visibles deben permanecer alineadas al catálogo. |
| `AURA_QUERIES`, `WHATSAPP_MESSAGES`, `INVOICING_DOCUMENTS`, `SITES`, `CUSTOM_BRANDING` | Hay definiciones de capacidades/cuotas y add-ons en el catálogo, pero no se encontró en las rutas SaaS inspeccionadas un flujo de consumo por tenant para esas métricas. | No certificadas como funciones SaaS operativas. Los add-ons están `available: false` y los niveles con estas ofertas no son contratables; no deben activarse por su mera presencia en el catálogo. |

## Consecuencias y trabajo siguiente

1. Ejecutar las suites existentes contra PostgreSQL efímero de CI y conservar el resultado por commit; no tratarlas como pruebas de producción.
2. Crear una matriz QA aislada para reservas y API que cubra cuota cero, cuota alcanzada, rollback/reintento y concurrencia. El servicio de reservas debe probar ambos orígenes sin crear citas de clientes reales.
3. Añadir integración PostgreSQL para recursos concurrentes; la prueba actual solo usa DB simulada.
4. Mantener deshabilitados los complementos e integraciones no disponibles, y no vender niveles propuestos.
5. Antes de implementar cuotas restantes, decidir evento, momento de consumo, reversión ante fallo/reintento y respuesta al agotamiento; ampliar la inspección de rutas heredadas antes de afirmar cobertura global.

## Límites de esta revisión

La evidencia combina inspección estática con lectura de las suites y el log CI existente citado arriba; esta ejecución no lanzó pruebas. La suite PostgreSQL de membresías pasó en CI, pero no se atribuye a producción. No se probaron runtime productivo, rollback bajo fallos ni todos los canales. No se ejecutaron escrituras ni llamadas que cambien datos en producción. Fase 7 continúa abierta.
