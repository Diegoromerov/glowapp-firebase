# Fase 7 — Auditoría técnica de entitlements y cuotas

**Estado:** auditoría estática parcial del código en `main` (`1621e3e`, 26 de noviembre de 2026). No equivale a pruebas de integración en producción ni a certificación de todas las variantes.

## Hallazgos por capacidad

| Capacidad / métrica | Evidencia observada en backend | Evaluación actual |
|---|---|---|
| `TEAM_MANAGEMENT` / `TEAM_SEATS` | `salonRoutes.js` y `saasTeamRoutes.js` verifican la capacidad en invitaciones y cambios de rol. `saasMembershipService.js` serializa los cambios por tenant y limita invitaciones, reactivaciones y reenvíos considerando miembros activos y pendientes. | Gate y cuota implementados en las rutas revisadas. Falta recorrido controlado de concurrencia y ciclo completo de invitación en producción. |
| `DIRECT_BOOKINGS` | `bookingController.createBooking` aplica el límite dentro de la transacción, bloquea la fila del tenant, cuenta el histórico al inicializar el medidor y solo consume para origen `SALON_DIRECT`. Las reservas del marketplace no consumen esta métrica por diseño vigente. | Medición y bloqueo transaccional localizados. Falta prueba E2E de ambos orígenes, reintento, grupos y concurrencia con tenant QA. |
| `RESOURCES` | `salonRoutes.js` exige `RESOURCES` en lectura/escritura de recursos/alquileres; `salonOpsController.crearRecurso` bloquea el perfil de negocio, cuenta los recursos y detiene la creación al alcanzar la cuota. | Gate y cuota concurrente localizados. Falta prueba E2E y comprobar estados de recursos que cuentan como activos contra la definición comercial. |
| `INVENTORY` | Cuatro rutas de inventario en `salonRoutes.js` exigen el entitlement. | Gate localizado. El catálogo no declara cuota numérica de inventario; no se debe mostrar un máximo por plan. Falta validar permisos/alcance de lectura y escritura con roles. |
| `POS_INTEGRATION` / `POS_RECEIPTS_ONLY` | Las cuatro rutas de caja exigen al menos una de las dos capacidades. | Gate localizado; falta confirmar que operaciones fiscales, integraciones de POS y recibos no fiscales se separan según el beneficio prometido. |
| `RECIPES` | Lectura y actualización de insumos de servicio exigen `RECIPES`. | Gate localizado. No se anuncia una cuota numérica. Falta probar efecto del consumo al finalizar una cita y acceso por rol. |
| `COMPLIANCE` | Las rutas de diagnóstico, tareas y documentos en `businessRoutes.js` exigen `COMPLIANCE`. | Gate localizado en las rutas revisadas; no se certificó cobertura de todo endpoint alternativo o legado. |
| `LOYALTY` | Rutas administrativas SaaS aplican `router.use(requireEntitlement('LOYALTY'))`; saldo, catálogo y canje del cliente exigen `requireSalonEntitlement('LOYALTY')`. | Gate localizado en administración y cliente. Se mantiene separado de puntos globales GlowApp. Falta prueba E2E multiparte y permisos. |
| `API_CALLS` | Middleware de API key ejecuta `consumeUsage` antes de procesar la solicitud autenticada y responde límite excedido. Crear llaves requiere `API_KEYS`. | Cuota localizada en el acceso autenticado por llave; no cuenta llamadas internas de la app. Falta una comprobación de límite con llave QA y límite cero/alcanzado. |
| `ADVANCED_ANALYTICS` | Lectura analítica y alertas de uso exigen el entitlement correspondiente. | Gate localizado en las rutas SaaS revisadas; las métricas visibles deben permanecer alineadas al catálogo. |
| `AURA_QUERIES`, `WHATSAPP_MESSAGES`, `INVOICING_DOCUMENTS`, `SITES`, `CUSTOM_BRANDING` | Hay definiciones de capacidades/cuotas y add-ons en el catálogo, pero no se encontró en las rutas SaaS inspeccionadas un flujo de consumo por tenant para esas métricas. | No certificadas como funciones SaaS operativas. Los add-ons están `available: false` y los niveles con estas ofertas no son contratables; no deben activarse por su mera presencia en el catálogo. |

## Consecuencias y trabajo siguiente

1. No añadir contadores artificiales a módulos que no tienen una ruta operativa o definición estable del evento facturable.
2. Mantener deshabilitados los complementos e integraciones no disponibles, y no vender niveles propuestos.
3. Preparar una matriz de pruebas QA por canal para asientos, reservas, recursos y API, usando un tenant aislado y sin tocar salones reales.
4. Antes de implementar cuotas restantes, decidir qué evento se mide, cuándo se incrementa, cómo se revierte ante fallo/reintento, y qué respuesta recibe el cliente al agotarse.
5. Ampliar búsqueda y pruebas sobre rutas heredadas/alternativas antes de afirmar cobertura global de gates.

## Límites de esta revisión

La evidencia es una inspección estática de las rutas, servicios y catálogo; no prueba runtime productivo, políticas RLS/PostgreSQL, rollback de transacciones bajo fallos ni todos los canales de la app. No se ejecutaron escrituras ni llamadas que cambien datos en producción. Fase 7 continúa abierta.
