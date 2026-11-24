# Fase 7 — Paquetes comerciales y lanzamiento gradual

**Estado:** En curso; auditoría de catálogo y alcance comercial iniciada el 23 de noviembre de 2026.

**Entorno objetivo:** producción directa, por instrucción expresa del usuario; no se usa staging.

## Objetivo

Hacer que la oferta para salones coincida con el catálogo, los cobros, los límites realmente medidos y los módulos autorizados. El despliegue comercial debe empezar de forma gradual y poder detenerse sin perder la operación.

## Línea base verificada

El catálogo backend `backend/src/config/saasCatalog.js` es la fuente declarativa pública consumida por el onboarding de proveedor mediante `GET /api/saas/catalog`. Los precios COP de los planes pagos coinciden con los valores mostrados en el onboarding de referencia y con los precios de `SaasPlanTier` en `glow_core`.

| Plan actual | Precio mensual | Límites declarados | Capacidades anunciadas |
|---|---:|---|---|
| Prueba Gratis | $0 | 14 días, 3 asientos, 50 reservas/mes, 1.000 procesos de integración/mes | Mapa, equipo, reservas en línea, marca personalizada |
| Freemium | $0 | Permanente, 1 asiento, 20 reservas/mes, 500 procesos de integración/mes | Reservas en línea |
| Básico | $99.000 | 5 asientos, 200 reservas/mes, 10.000 procesos de integración/mes | Mapa, equipo y reservas |
| Profesional | $249.000 | 20 asientos, reservas ilimitadas, 100.000 procesos/mes | Analítica avanzada, marca personalizada e integraciones |
| Empresarial | $599.000 | Asientos, reservas y procesos ilimitados | Analítica, integraciones, WhatsApp, POS y soporte prioritario |

Los precios de pago se derivan también del catálogo en `invoiceService`. El proveedor carga desde el backend el catálogo, pero el selector de alta solo muestra Prueba Gratis y Freemium, de acuerdo con la regla actual del endpoint de bootstrap: los planes pagos se activan desde Facturación.

## Hallazgos y brechas

| Tema | Estado observado | Resolución requerida |
|---|---|---|
| Prueba de planes pagos | `subscriptionService.createSubscription` calcula 30 días de prueba para todo plan con precio mayor que cero, aunque el catálogo define `trialDays: 0` para Básico, Profesional y Empresarial. Las pruebas existentes también describen 30 días para Empresarial. | Alinear catálogo, checkout, pasarela y condiciones mostradas. No cambiar la política de cobro hasta confirmar si los 30 días fueron intencionales. |
| WhatsApp, POS y soporte prioritario | Empresarial los anuncia; el catálogo declara capacidades, pero la revisión encontró solo cuotas booleanas y no encontró un SLA comercial definido. | Confirmar si se ofrecen hoy, definir alcance y soporte/SLA, y aplicar entitlement backend antes de venderlos como beneficios exclusivos. |
| Operación del salón | Caja, inventario, recetas y recursos existen, pero no todos tienen capacidades/cuotas específicas en el catálogo de planes. | Decidir cuáles se incluyen por nivel y activar control común en backend. |
| Fidelización | Se desplegó en `0388dea`, con reglas por salón y acreditación manual; no está incluida en el catálogo ni condicionada por plan. | Definir si es módulo incluido, complemento pago o piloto; determinar costos y límites antes de venderlo. |
| Multi-sede | La oferta objetivo para empresas incluye varias sedes y consolidación, pero no aparece como cuota/capacidad explícita en el catálogo actual. | Definir número de sedes y permisos por plan; comprobar límites en backend y contratos. |
| Procesos de integración | API_CALLS se expresa al usuario como procesos de integración, pero se consume al usar llaves API; la métrica no debe confundirse con reservas ni interacciones ordinarias del salón. | Mantener una explicación comprensible, confirmar qué operaciones cuentan y definir qué ocurre al agotar la cuota. |
| Catálogo Flutter local | `saas_api_service.dart` usa el catálogo backend y conserva una tabla local como fallback sin conexión. | Mantener fallback para disponibilidad, con comprobación de paridad automatizada para prevenir divergencias. |

## Comprobación inicial de aplicación de límites

| Límite/capacidad | Evidencia de backend | Cobertura observada |
|---|---|---|
| Asientos de equipo | Invitaciones pasan por `requireEntitlement('TEAM_MANAGEMENT')`; `saasMembershipService` limita miembros activos y pendientes con `TEAM_SEATS`. | Aplicado en invitación y conteo. |
| Reservas mensuales | `bookingController` consulta el plan y el uso mensual antes de crear reservas y registra el consumo en transacción. | Aplicado en el flujo de reserva inspeccionado; requiere verificar todos los canales de creación/reintento en pruebas de integración antes del cierre. |
| Analítica | `/api/saas/analytics` requiere `ADVANCED_ANALYTICS` y rol `MANAGER` o superior. | Aplicado. |
| Llaves de integración | Crear una llave y usarla requieren `API_KEYS`; el consumo actual de `API_CALLS` se registra al autenticar solicitudes de llave. | Aplicado a la API key; no equivale a todo tráfico de la aplicación. |
| Mapa público | Los controladores de proveedor/salón filtran la visibilidad por `MAP_VISIBILITY`. | Aplicado en los controladores inspeccionados. |
| WhatsApp, POS y marca personalizada | Existen definiciones de capacidad en el catálogo; la búsqueda de rutas mostró usos reales para varias capacidades, pero no controles integrados para WhatsApp/POS ni un gate comercial claro para marca personalizada. | No considerar garantizado como diferencial de plan hasta encontrar e integrar los flujos y su control backend. |

Esta es una inspección de código, no un resultado de prueba de producción ni una demostración de todos los casos de uso.

## Decisiones de esta etapa

- No cambiar precios ni añadir límites por mera inferencia: los precios actuales se conservan como línea base mientras se cotejan condiciones de checkout y pasarela.
- No anunciar más beneficios exclusivos hasta que una ruta del backend aplique su permiso y exista una definición operativa verificable.
- Mantener la selección inicial de opciones gratuitas. Para mostrar contratación paga en el onboarding se deberá diseñar y validar el paso de pago; el bootstrap rechaza actualmente planes pagos.
- La fidelización propia del salón permanece conceptualmente separada de puntos globales GlowApp. Su nivel comercial sigue pendiente.
- El selector de plan en onboarding ahora incluye los días de prueba, personas y reservas mensuales usando los límites del catálogo recibido. Falta publicar este cambio para marcarlo como disponible en producción.

## Siguiente trabajo de Fase 7

1. Conciliar trialDays entre catálogo y checkout y resolver la política comercial antes de modificar cobros.
2. Mapear cada capacidad de los cinco planes a middleware/rutas de backend y verificar el efecto de cambiar de plan, incluido el exceso de cuotas.
3. Definir el paquete por escala para caja, inventario, fidelización, automatizaciones y multi-sede, separando lo ya productivo de pilotos y servicios externos.
4. Actualizar el onboarding y facturación con límites, excedentes, downgrade y copy legible, derivado del catálogo backend.
5. Ejecutar el piloto productivo con métricas y rollback, y publicar el informe de cierre solo cuando la oferta, el catálogo, el cobro y la UI coincidan.

## Verificación y despliegue

- Inspección estática del catálogo, entitlements, checkout, facturación, onboarding Flutter y endpoints de uso; no se modificaron rutas de cobro ni precios en esta etapa.
- Cambio local de onboarding: añade los términos visibles `días de prueba`, `personas` y `reservas al mes`, generados a partir de `SaasPlan.trialDays` y `SaasPlan.limits`.
- El backend responde catálogo público y el onboarding Flutter lo consume; los sitios web cliente/proveedor responden HTTP 200 en producción desde el commit `0388dea`.
- `flutter build web --release --no-wasm-dry-run` en `apps/glow_provider`: compilación correcta (88,9 s).
- `flutter analyze --no-pub lib/screens/auth/onboarding_screen.dart`: 42 hallazgos informativos existentes (imports redundantes, deprecaciones y estilo); no reporta errores en la lógica añadida. El comando devuelve código 1 por hallazgos del archivo.
- El cambio de onboarding aún no se ha desplegado; no se afirma todavía que esté publicado.
- No se cambió el comportamiento comercial de cobro ni los precios.

## Riesgos y rollback

Cambiar precios, días de prueba o capacidades puede alterar cobros, renovaciones y accesos de tenants ya existentes. Toda futura modificación deberá conservar suscripciones y límites históricos, ser aditiva, probarse con pasarelas de forma controlada y contar con un interruptor/rollback antes de expandirse. No hay rollback automático de cambios de precio ya cobrados.

## Pendientes y fase siguiente

La Fase 7 continúa abierta. Las cifras actuales son la línea base observada, no una nueva aprobación comercial ni la afirmación de que todas las capacidades están disponibles. La Fase 6 también permanece abierta por validaciones autenticadas de fidelización y otros complementos indicados en su informe.
