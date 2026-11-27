# Fase 7 — Puntos por resolver

**Estado:** Fase 7 en curso. Catálogo V4, conservación de derechos heredados, corrección de lectura de cuotas e informes administrativos desplegados en producción; la cobertura PostgreSQL/RLS de inventario se amplió el 27 de noviembre de 2026.
**Fecha de elaboración:** 23 de noviembre de 2026. **Última conciliación técnica:** 27 de noviembre de 2026.
**Contexto:** plan comercial SaaS de GlowApp para salones. El trabajo se publica directamente en producción, sin usar staging, conforme a la instrucción del usuario.

## Propósito

Consolidar los asuntos pendientes para que catálogo, cobro, límites técnicos y oferta comercial describan el mismo producto. Este documento registra trabajo por resolver; no implica que los puntos ya estén aprobados o implementados.

La auditoría estática de cobertura actual está en [FASE_7_AUDITORIA_TECNICA_LIMITES.md](FASE_7_AUDITORIA_TECNICA_LIMITES.md); distingue compuertas/cuotas encontradas de funciones que aún no tienen flujo de consumo verificable.

**Actualización posterior:** PR [#172](https://github.com/Diegoromerov/glowapp-firebase/pull/172) quedó integrada en `main` como `89b8afdc`. Backend CI `45918524098` pasó. Añade tres pruebas HTTP que verifican que el checkout COP/USD falla cerrado ante configuración incompleta y que el cambio directo de plan no evita la confirmación de pago. No cambia el backend desplegable; producción sigue saludable en `7a2a62cb`. Las pruebas de cobro sandbox/producción y la activación comercial siguen pendientes.

**Actualización multi-sede:** PR [#175](https://github.com/Diegoromerov/glowapp-firebase/pull/175), CI `45919515848` SUCCESS, quedó integrado y desplegado como `cd4fdea4`. Empresarial no hereda `MULTI_SITE`; su oferta propuesta conserva tres sedes como dato comercial separado. Railway y el endpoint del catálogo confirmaron producción saludable, plan no disponible y límite operativo actual de una sede.

**Actualización de Caja:** PR [#177](https://github.com/Diegoromerov/glowapp-firebase/pull/177) quedó integrada como `90cc6b8`; CI de backend y Flutter pasó. El workflow `45932800849` compiló y publicó el portal del prestador en Firebase Hosting live. La API Railway y los archivos del portal fueron verificados en producción. La distinción funcional entre caja Freemium y planes pagos queda pendiente de definición, por lo que no se cambiaron permisos.

**Actualización de entitlements:** PR [#179](https://github.com/Diegoromerov/glowapp-firebase/pull/179) quedó integrada y desplegada como `9b2b52f`. CI `45934737990` pasó las pruebas de integración PostgreSQL/RLS. Las compuertas de salón ya usan `business_profiles.saas_plan` dentro del contexto RLS; el plan heredado solo se consulta para salones públicos sin perfil empresarial. Esto corrige un riesgo de acceso a módulos tras cambios de plan y no activa nuevas capacidades comerciales.

**Actualización de operaciones RLS:** PR [#182](https://github.com/Diegoromerov/glowapp-firebase/pull/182), CI `45936379472`, quedó integrada y desplegada como `ef55cae`. Inventario, recetas, recursos y alquileres ahora usan el tenant `business_profiles.tenant_id` verificado en la transacción autenticada. Una prueba PostgreSQL/RLS por HTTP valida que los módulos siguen el plan canónico aun con `salones.plan_saas` desactualizado. Railway API, dashboard y cron están `SUCCESS`; `/api/health` confirma PostgreSQL disponible.

## Lista de pendientes

| N.º | Punto por resolver | Decisión o trabajo requerido | Resultado esperado |
|---:|---|---|---|
| 1 | Vencimiento de Prueba Gratis | Bootstrap guarda fechas; facturación muestra vencimiento; el job independiente de Railway corre a diario y cambia a Freemium. Solo un plan pago `active` protege el tenant; `incomplete`, `trialing` y `past_due` no extienden la prueba. CI `45902457105` aprobó expiración normal/legada, plan pago activo, fecha futura, sincronización de sede, auditoría e idempotencia. PR #213 agregó alcance opcional y aislamiento PostgreSQL. PR #229 corrigió la validación para IDs reales heredados de perfil de hasta 36 caracteres y el paso de argumentos desde el entrypoint; CI `46044105483` pasó y API/cron desplegaron el merge `3fb1856`. | El aislamiento PostgreSQL está probado y la ejecución limitada ya reconoce IDs heredados. Falta un downgrade real controlado con tenant QA aislado; el QA Salón Fase 2 conserva su fecha vigente y no se ha modificado. |
| 2 | WhatsApp, Aura, marca y soporte prioritario | No ofrecer WhatsApp, Aura para negocio ni marca personalizada en altas nuevas hasta tener flujo SaaS, integración, métrica y soporte verificables. Posicionamiento de soporte/SLA empresarial sigue pendiente. | Capacidades implementadas y medibles antes de incorporarlas a una oferta contratada. |
| 3 | Caja, inventario, recetas y recursos | La caja es un libro manual con constancias internas; ya se corrigieron sus rótulos visibles sin cambiar accesos. Freemium conserva constancias internas de ingresos no fiscales; la API rechaza gastos y la pantalla explica esta limitación. Básico y Prueba mantienen caja completa. CI `45939638345` prueba inventario bajo RLS: lectura OWNER/ADMIN/MANAGER/MEMBER, escritura de ADMIN/MANAGER, bloqueo de escritura de MEMBER, stock inicial y movimientos. Esa prueba detectó y llevó a corregir el cambio prematuro del contexto RLS en escrituras. CI `45940586113` amplió recetas (lectura de MEMBER, escritura de ADMIN, bloqueo de escritura de MEMBER); CI `45941216010` cubrió alquileres (aislamiento por miembro y cierre solo por OWNER). En producción, el 27 nov. las lecturas autenticadas OWNER al inventario, recursos, alquileres y caja del tenant QA respondieron HTTP 200; las listas revisadas estaban vacías. Falta aceptación de escritura en tenant QA y ampliar matriz a rutas y roles restantes. | Catálogo describe la función real y cada plan tiene capacidades/cuotas diferenciadas aplicadas y probadas en backend. |
| 4 | Fidelización propia del salón | Elegir entre incluirla en planes, venderla como complemento o ejecutarla como piloto. Definir costos, límites y reglas; mantenerla separada de los puntos globales GlowApp. | Oferta comercial y técnica clara para el programa de puntos del salón. |
| 5 | Multi-sede | La propuesta V3 indica 1 sede para Profesional y 3 para Empresarial. Esos valores quedan separados en `proposedOffer`; el entitlement actual heredado no se amplía. El medidor `SITES` ahora cuenta las sedes vinculadas reales y QA confirmó 1/1, pero la oferta no es contratable: falta aprobarla comercialmente y construir creación/administración de sedes adicionales, permisos por sede, consolidación y enforcement para altas atómicas. | Alta y operación multi-sede con permisos aislados, límite validado atómicamente y panel consolidado; activar solo tras aprobación comercial y pruebas de tenant. |
| 6 | Procesos de integración | **Bloqueo técnico cerrado para la API de solo lectura:** `GET /api/integrations/v1/services` cuenta cada solicitud autenticada por API key en la misma transacción, aplica tope atómico y devuelve HTTP 429 al agotarlo. CI `45911101915` probó PostgreSQL/RLS, aislamiento y carrera por el último cupo. PR #196 confirmó que una llave vencida recibe 401 y no consume cuota. PR #200 restringió la emisión/edición de scopes a `read`: escritura, webhooks y administración no tienen endpoints publicados; la UI ya no los ofrece y señala como no habilitados los scopes heredados. CI de PR y `main` pasó; el portal quedó publicado en Firebase Hosting live. Sigue pendiente aceptar una llamada válida con llave de un tenant QA productivo y decidir si se venderán excedentes; hoy no se cobran. | El API actual solo expone lectura de servicios; cuotas, scopes y respuesta al límite coinciden con lo implementado. Añadir escrituras/webhooks requiere diseñar/autenticar cada endpoint antes de ofrecer esos permisos. No se activan excedentes sin decisión comercial. |
| 7 | Paridad integral de catálogo y respaldo | **Cerrado para la paridad del catálogo y estado del checkout.** El catálogo remoto usa precio, periodicidad, unidades y `checkoutAvailable` dinámico, sin caché; el respaldo Flutter compara en CI disponibilidad, compra habilitada, nombre, descripción, precio, beneficios visibles y todas las cuotas declaradas para Prueba Gratis, Freemium y Básico. PR #232 hace que el onboarding no prometa contratación mientras el checkout esté pausado; backend/Firebase CI y Hosting live pasaron (`a631c508`, workflows `46046353917` y `46046713443`). | CI debe seguir bloqueando divergencias de la oferta activa y la interfaz debe reflejar el estado operativo. La activación de pagos, la venta, la conciliación y los planes propuestos siguen pendientes. |
| 8 | Facturación, cambios de plan y piloto | Definir excedentes, upgrade/downgrade, textos de facturación y alcance del piloto. Instrumentar métricas y preparar un mecanismo de rollback antes de ampliar el lanzamiento. | Flujo de contratación y cambio de plan comprensible, medible y reversible. |
| 9 | Verificación integral de límites | La matriz técnica registra gates y cuotas por capacidad. Equipo/asientos, recursos, recetas, alquileres y Aura B2B tienen cobertura PostgreSQL/RLS en CI. PR #194 probó el controlador real de reservas: rollback, cupo 29→30/429 y exclusión de marketplace; CI `45946611097` y `45946792869` pasaron. PR #213 probó vencimiento dirigido que deja intacto otro tenant vencido. El medidor `SITES` cuenta sedes reales (QA 1/1); la capacidad concurrente llena da `warning` y solo supera a `exceeded` si rebasa el límite. CI `46050757763` y Hosting live `46057891147` pasaron. La app proveedor conserva y presenta uso/límite de reservas y abre Facturación al agotarse. Sigue pendiente completar rutas/roles y aceptación QA de escrituras. WhatsApp y facturación electrónica no tienen consumo SaaS verificado, ni existe alta multi-sede; alertas email/webhook externas siguen deshabilitadas y el dashboard conserva aviso local al 80 %. | Evidencia de permisos/cuotas por flujo y respuesta comprensible al agotamiento; capacidades sin consumo verificable siguen fuera de la oferta contratable. |

## Corrección de reporte de cuotas — 26 de noviembre de 2026

- El panel del proveedor ahora interpreta `DIRECT_BOOKINGS` como reservas directas y ya no clasifica métricas desconocidas como llamadas API.
- El valor `0` se muestra como «No incluido»; «Ilimitado» solo aparece cuando la API entrega explícitamente esa condición o el catálogo declara límite nulo.
- La cuota API se presenta como «Procesos de integración», con explicación de que cuenta solicitudes externas autenticadas con llave API. Los actos normales dentro de GlowApp no cuentan.
- El reporte SuperAdmin queda alineado al período calendario `America/Bogota`, igual al medidor de cuotas. Esta corrección no verifica todas las rutas ni la política de excedentes; el punto 9 sigue abierto.
- La cuota de API abierta ya se aplica con bloqueo atómico y HTTP 429 al agotarse. CI `45911101915` verifica el último cupo concurrente en PostgreSQL/RLS; no hay cobro automático de excedentes. La decisión comercial sobre compra de excedentes permanece pendiente.

## Cancelación de renovación Wompi sin pérdida anticipada del plan — 27 de noviembre de 2026

- La revisión del servicio encontró que cancelar “ahora” cambiaba inmediatamente la suscripción a Freemium, aunque existiera un período ya pagado. Eso retiraba acceso antes de `current_period_end`.
- La cancelación ahora siempre marca `cancel_at_period_end`; detiene la siguiente renovación y conserva plan/acceso durante el período cubierto. El job de renovación/downgrade procesa Freemium al alcanzar la fecha final, sin iniciar otro cobro.
- PR [#212](https://github.com/Diegoromerov/glowapp-firebase/pull/212), CI Backend `45959229138` SUCCESS, quedó integrada en `main` como `52630da969204c6b6a1b625b36147d7675da4d16`. Las pruebas focalizadas de ruta/servicio pasaron 11/11.
- Railway producción desplegó API, dashboard y cron; los tres servicios reportaron SUCCESS. `/api/health` respondió `OK`, PostgreSQL disponible y commit `52630da`. Esto valida la lógica y despliegue, no un cobro real con Wompi.

## Expiración de prueba limitada a tenant QA — 27 de noviembre de 2026

- PR #213 añadió el `tenantId` opcional; al probarlo contra el perfil heredado de producción se encontró que la validación UUID no correspondía al tipo real de `business_profiles.id` (`VARCHAR(36)`) y el cron no reenviaba el parámetro.
- El cron diario continúa llamando el servicio sin tenant y mantiene el comportamiento global programado; la nueva capacidad solo se usa al invocar explícitamente el servicio con un identificador.
- PR [#229](https://github.com/Diegoromerov/glowapp-firebase/pull/229) admite IDs legados y UUID de hasta 36 caracteres, los transmite por `entrypoint.sh` y conserva el cron global cuando no se especifica ID. CI Backend `46044105483` pasó la prueba PostgreSQL/RLS con un ID legado: el tenant vencido objetivo pasa a Freemium y otro tenant vencido permanece intacto.
- PR [#213](https://github.com/Diegoromerov/glowapp-firebase/pull/213), integrada en `main` como `b963def11976b42b406d938abab7cf78b0305cf8`. Railway API, dashboard y cron SUCCESS. Health de producción devolvió `OK`, PostgreSQL disponible, sin datos simulados y 79 migraciones.
- El merge `3fb1856` se desplegó con SUCCESS en Railway API (`4d6b96ef-635d-4a34-b28c-e9f96331cfd8`) y cron (`e43dd903-c79c-45d9-a3d8-1b233353310f`).
- No se ejecutó downgrade en el QA Salón Fase 2: su vencimiento es futuro y se conservó el plan. Aún falta un tenant QA aislado con vencimiento controlado para comprobar el downgrade productivo real.

## Orden sugerido de resolución

1. Resolver P0: expiración real de la prueba y checkout productivo/conciliación segura.
2. Completar el mapa de rutas, entitlements, cuotas y resultados ante exceso (puntos 2, 3, 4, 5, 6 y 9).
3. Ampliar la comprobación de paridad más allá de disponibilidad (punto 7).
4. Acordar oferta/condiciones que no estén definidas todavía; no habilitar precios V3 ni complementos por inferencia.
5. Iniciar el piloto gradual con métricas, rollback y documentación de resultados (punto 8).

## Criterio para cerrar estos pendientes

La Fase 7 podrá cerrarse cuando cada plan tenga una descripción comercial coincidente con el catálogo y el checkout, cada capacidad exclusiva tenga control backend verificable, las cuotas tengan una política de agotamiento definida, el onboarding y la facturación presenten esa información con claridad y el piloto disponga de resultados y procedimiento de reversión documentados.

## Relación con el informe de Fase 7

Este documento amplía la sección de asuntos pendientes del [informe principal de Fase 7](FASE_7_PAQUETES_Y_LANZAMIENTO.md). La tabla original conserva los nueve puntos levantados; algunos ya tienen avances parciales registrados abajo. Los faltantes vigentes y su prioridad están consolidados en «Faltantes prioritarios — aplazados».

## Especificación comercial recibida

El usuario compartió la [Propuesta Comercial V3](FASE_7_PROPUESTA_COMERCIAL_V3.md) con una matriz completa de seis niveles, servicios, cuotas, complementos y comportamientos al límite. Por tanto, los pendientes ya cuentan con una propuesta concreta de asignación para orientar el trabajo técnico. Permanecen abiertos la validación de hipótesis comerciales, los controles backend/UI que faltan, la integración de facturación electrónica y las pruebas de aceptación. Los nuevos precios y cobros son propuestas y aún no están activados en producción.

## Implementación publicada

Se publicó el catálogo SaaS V2 en el backend de producción y la pantalla de onboarding del proveedor en Firebase Hosting (canal live). La API responde con PostgreSQL disponible; las 67 migraciones existentes siguen aplicadas, sin migración nueva para esta entrega.

Cambios que sí quedaron activos:

- El catálogo muestra los seis niveles, sus capacidades/cuotas y marca los cobros complementarios como no disponibles mientras falten los proveedores y la configuración de cobro correspondientes.
- Solo el plan de prueba tiene 14 días; Freemium no los hereda por una regla implícita.
- La cuota nueva usa el contador `DIRECT_BOOKINGS`. Las reservas creadas desde la app del salón se identifican en el servidor; las solicitudes desde la app cliente/marketplace no consumen esa cuota. El histórico sin origen no se clasifica artificialmente como directo.
- Se conservan los derechos y precios vigentes de Profesional y Empresarial para las cuentas existentes. Las nuevas condiciones V3 de Crecimiento, Profesional y Empresarial quedan marcadas como propuesta no contratable hasta versionar los contratos y configurar la pasarela. El precio anual de Básico también figura como propuesto.

Verificación de esta publicación: pruebas de SaaS (56 casos), análisis y pruebas del proveedor en GitHub Actions, build web, estado saludable del API y lectura del catálogo V2 en producción. La prueba directa de reserva con una cuenta real queda pendiente para no crear ni alterar datos de clientes durante el despliegue.

Los puntos sobre el proveedor tecnológico DIAN, facturación real, complementos, habilitación de las nuevas ofertas pagas y medición integral de cada cuota siguen abiertos. Esta publicación no significa que esos servicios ya se cobren o presten en producción.

## Avance ejecutado el 24 de noviembre de 2026

- El backend exige el entitlement `LOYALTY` en las rutas administrativas del programa de puntos del salón. Sigue separado del programa global GlowApp.
- El respaldo local del catálogo Flutter ahora ofrece solamente Prueba Gratis, Freemium y Básico, que son los niveles activos para nuevas altas/contratación en el catálogo de producción. Growth, Pro y Empresarial no aparecen como opciones disponibles cuando falla el API.
- Se agregó una prueba cruzada que compara los niveles disponibles y contratables del catálogo Node con los getters de disponibilidad y compra en Dart. El CI backend ejecuta esta prueba junto a las pruebas de origen de reservas.
- Se extrajo la política de origen de reservas a una función compartida y se agregaron pruebas: solo `provider` consume la cuota de reservas directas; `client` se marca `MARKETPLACE` y no consume esa cuota.
- Verificación local: 6 pruebas Node y la prueba Flutter de disponibilidad pasan; `node --check` y `git diff --check` pasan.
- Se agregó una prueba de middleware: Básico recibe 403 para `LOYALTY` y Prueba Gratis pasa el gate. La prueba Jest correspondiente pasó (16 pruebas del archivo).
- Publicado en producción en el commit `f93cfb90f44a029a04a8e8193b392925396ed45d`. Backend CI y pipeline de calidad/build Flutter pasaron; Firebase Hosting live del proveedor se desplegó correctamente. `/api/health` confirma PostgreSQL disponible y el portal proveedor responde HTTP 200.

Pendiente todavía: la paridad de fallback ya está cubierta para los planes activos; sigue pendiente completar el mapa de rutas/roles alternos de inventario, POS, recursos, facturación, Aura, WhatsApp y multi-sede antes de afirmar cobertura integral. La cuota directa ya tiene prueba PostgreSQL de controlador y feedback de UI, pero no se ejecutó una reserva real en producción. No se configuró proveedor DIAN ni cobro recurrente; no se activan capacidades sin proveedor ni condiciones comerciales aprobadas.

## Faltantes prioritarios — fase reanudada

La corrección desplegada conserva en `FREE_TRIAL_LEGACY` las capacidades concedidas a los tenants existentes; los nuevos registros reciben una prueba con módulos que tienen flujos operativos en la aplicación. Railway registra como exitosa la migración 203 y el catálogo V4 se verificó en la API productiva. Básico ya no incluye `INVOICING_ADDON`, que permanece no disponible.

También quedaron desplegados el catálogo V4, la migración 203, la compatibilidad con fechas de vencimiento y el respaldo Flutter. CI de backend y workflow live de Firebase pasaron. La API está saludable, responde V4 y el Hosting del proveedor devuelve HTTP 200. `dart analyze` enfocado no encontró errores; el análisis completo del proveedor reporta avisos preexistentes en otras pantallas.

**Estado de trabajo:** fase reanudada. Resolver en paralelo las brechas técnicas seguras; mantener bloqueados precios propuestos, cobros reales y módulos no configurados hasta contar con decisiones y proveedores necesarios.

### Evidencia añadida — lectura de inventario, 27 de noviembre de 2026

- La base efímera de CI no aplicaba la migración 194 ni su dependencia 116; por ello el GET autenticado de inventario no se ejecutaba en las pruebas PostgreSQL/RLS.
- PR [#184](https://github.com/Diegoromerov/glowapp-firebase/pull/184), commit `02d542ad982d32fa4a0d124f750f780c759a2c1b`, agregó esas migraciones al esquema de CI y amplió la regresión HTTP para comprobar inventario y recursos con discrepancias entre plan canónico y heredado en ambos sentidos.
- Backend CI `45937406028` pasó, incluidos preparación y reejecución del esquema RLS e integración PostgreSQL completa. Railway API producción desplegó el commit; `/api/health` responde `OK`, PostgreSQL disponible, sin fallback de datos ficticios y con 77 migraciones registradas.
- La evidencia cubre lectura autenticada de OWNER y gates de plan; siguen pendientes roles adicionales y pruebas de escritura/recetas/alquileres con sus flujos reales.

**Avance publicado el 26 de noviembre:** el commit `2cb857b` alinea las descripciones activas del catálogo y el respaldo Flutter; el formateador remoto presenta las cuotas comerciales. PR #144 agrega comprobación CI para nombre, descripción, precio, beneficios, cuotas y disponibilidad/compra de los planes activos. CI backend/Flutter y Hosting live pasaron. La paridad de catálogo activa queda cerrada; permanece la auditoría de rutas/entitlements y límites operativos.

| Prioridad | Faltante | Trabajo pendiente al retomarlo | Condición para cerrarlo |
|---|---|---|---|
| P0 | Decisiones comerciales | Aprobar precios y niveles finales; ciclo de cuotas; anualidad; excedentes; reglas de mejora/reducción y período de gracia. El vencimiento base de Prueba Gratis es 14 días y ya está implementado; las reglas posteriores de gracia/retención no se deben inferir. | Oferta comercial aprobada y coherente con contratos, catálogo, onboarding y facturación. |
| P0 | Cobro de suscripciones | Integrar y validar cobro recurrente, renovaciones, cancelaciones, pagos rechazados, webhooks, reintentos y conciliación de suscripciones existentes. Los endpoints de checkout y cambio de plan fallan cerrados si falta configuración o confirmación por webhook. FREE_TRIAL nuevo ya no crea suscripciones Stripe; falta inventariar de forma agregada si quedaron registros históricos de prueba en Stripe y definir conciliación segura sin cancelar o cobrar automáticamente. | Pruebas completas con credenciales y productos configurados en la pasarela, sin cobrar importes propuestos antes de su aprobación; registros históricos conciliados con evidencia y sin cambios remotos no autorizados. |
| P0 | Facturación electrónica | Elegir e integrar proveedor tecnológico habilitado; completar configuración del salón/NIT, ambiente de pruebas, emisión, notas y errores. Confirmar costos y obligaciones aplicables. | Emisión y consulta probadas con el proveedor; funciones fiscales reales no se presentan como disponibles antes de esa validación. |
| P1 | Entitlements por plan | Completar la auditoría de cada ruta de lectura/escritura y pantalla para inventario, caja/POS, recursos, recetas, analítica, Aura, WhatsApp, equipo y multi-sede. Gates existentes se han localizado para varios módulos; no hay evidencia de cobertura integral ni de que todos los módulos anunciados estén operativos. | Matriz V3 reflejada en backend y UI, con pruebas de acceso permitido y denegado por nivel. |
| P1 | Cuotas y medición | API_CALLS está medido, bloquea atómicamente con 429 y devuelve el contrato estructurado con uso/límite/plan/ruta de facturación (PR #218; CI PostgreSQL `46035778354`). Reservas directas cuentan bajo transacción, distinguen marketplace y muestran el uso/límite más acceso a Facturación al agotarse; recursos y asientos aplican límites y ahora presentan un diálogo de orientación hacia Facturación en la app del proveedor. Se alinearon período Bogotá, historial y deduplicación de reservas agrupadas. Aura B2B consume según membresía, entitlement y cuota mensual; CI PostgreSQL/RLS `45957368969` pasó y la función está desplegada. Restan documentos, sedes y WhatsApp; API no cobra excedentes y falta decisión comercial. | Cada cuota ofrecida tiene evento de consumo verificable, contador reconciliable y comportamiento de agotamiento probado; las funciones sin medición permanecen fuera de la oferta activa. |
| P1 | Reservas directas | La política de origen y contador transaccional están implementados; falta recorrido controlado en producción que cubra reservas del salón frente al marketplace, reintentos, reservas agrupadas y concurrencia. | Evidencia de integración sin alterar reservas reales de clientes. |
| P2 | Piloto y salida comercial | Definir salones piloto, instrumentación, soporte, comunicación, monitoreo, procedimiento de reversión y criterios de expansión. | Piloto medido y aprobado antes de ampliar disponibilidad de niveles o complementos. |

### Punto de trabajo actual

La oferta V3 orienta el análisis, pero sus precios e hipótesis no se consideran aprobados por estar documentados. Se avanza primero en paridad y comportamiento técnico; checkout, política de excedentes y piloto requieren configuración/comercialización verificable.

## Paridad de catálogo activo — 26 de noviembre de 2026

- PR [#144](https://github.com/Diegoromerov/glowapp-firebase/pull/144), commit `9740d7f`, quedó integrado en `main`.
- `saasCommercialCatalog.nodetest.js` compara Prueba Gratis, Freemium y Básico entre el catálogo backend y el respaldo Flutter: nombre, descripción, precio, beneficios visibles, todas las cuotas declaradas y banderas de disponibilidad/compra.
- El texto local de Prueba Gratis quedó alineado a 150 reservas mensuales y se normalizaron unidades de cuota. El E2E de catálogo reintenta disponibilidad de API mientras inicia el esquema, evitando la carrera de arranque observada en CI.
- Backend CI del PR y de `main` #45897948551 pasó; Flutter CI #45897948635 pasó. Firebase live #45898280790 terminó SUCCESS; el hosting proveedor responde HTTP 200.
- Se cierra el punto 7 para la oferta activa de nueva contratación. Los niveles propuestos permanecen sin venta y los módulos/cuotas operativos siguen sujetos a la auditoría del punto 9.

## Recetas y alquileres bajo RLS — 27 de noviembre de 2026

- PR [#188](https://github.com/Diegoromerov/glowapp-firebase/pull/188), CI `45940586113`, pasó integración PostgreSQL/RLS: un miembro lee recetas; ADMIN puede crear/actualizar; MEMBER no puede escribir. La prueba usa el plan FREE_TRIAL porque BASIC no ofrece `RECIPES`, y restablece el plan al terminar.
- PR [#189](https://github.com/Diegoromerov/glowapp-firebase/pull/189), CI `45941216010`, pasó integración PostgreSQL/RLS para alquileres: cada miembro ve solo su alquiler, OWNER ve ambos y solo OWNER puede finalizarlo.
- Ambas pruebas están integradas en `main` (`2ae222ae4847bd21e00ec1806c93f2d79d3ed894`). Railway producción desplegó API, dashboard y cron. `/api/health` confirmó `OK`, PostgreSQL disponible, sin datos simulados y 77 migraciones.
- El resultado valida estas rutas y roles en fixtures PostgreSQL aislados; no afirma cobertura completa de cada pantalla/ruta ni aceptación funcional con salones reales.

## Cuota de reservas desde el controlador real — 27 de noviembre de 2026

- PR [#194](https://github.com/Diegoromerov/glowapp-firebase/pull/194), commit `244a4c05f2015b610725137e5be635bb663ba91e`, quedó integrada en `main`; CI del PR `45946611097` y de `main` `45946792869` terminaron SUCCESS.
- PostgreSQL real en CI ejercita `createBooking`: un fallo de inserción revierte la cuota y no crea una reserva parcial; la reserva directa alcanza el cupo de 30 y la siguiente falla con HTTP 429; una reserva marketplace no consume la cuota directa.
- Railway producción desplegó el commit `244a4c0`, deployment `91a23716-f278-46dc-8860-e6377274c341` SUCCESS. Health confirmó API `OK`, PostgreSQL disponible y sin datos fabricados. Los logs confirmaron aplicación de migraciones `097`, `098`, `099`, `198` y `206`.
- Estado del subtema: **cerrado en código, CI y despliegue**. La aceptación de UI con tenant QA sigue pendiente; la Fase 7 en conjunto continúa abierta.

## Resumen de uso coherente con estados de cuota — 27 de noviembre de 2026

- PR [#223](https://github.com/Diegoromerov/glowapp-firebase/pull/223) quedó integrada en `main` como `e6b7cc1443e6e0cce2a1385ad883e1b9fb26257b`. El resumen de `GET /api/saas/usage` ahora cuenta `caution` además de `ok`, `warning` y `exceeded`, para que las métricas cautelares no queden fuera de la suma.
- CI Backend del PR `46040104125` terminó SUCCESS. Railway producción desplegó API, panel administrativo y job de ciclo de prueba; el estado de Railway confirma los nueve servicios activos, cero fallos recientes y cero trabajo pendiente.
- Health productivo `GET https://glowapp-api-production.up.railway.app/api/health` respondió `OK`, commit exacto `e6b7cc1443e6e0cce2a1385ad883e1b9fb26257b`, PostgreSQL activo, sin datos fabricados y 79 migraciones registradas.
- El endpoint autenticado no se volvió a consultar durante esta ejecución porque no había una sesión QA persistente disponible; por eso se registra la corrección y el despliegue como verificados, y la aceptación del resumen sobre un tenant QA como pendiente. No se modificaron datos del salón, no se enviaron invitaciones ni se crearon reservas o cobros.
- Railway muestra el proceso diario `saas-trial-lifecycle` en estado Ready, programado a las 06:00 hora de Bogotá; esto acredita disponibilidad del job, no una expiración de prueba ejecutada en esta verificación.

## Colores de cuota alineados con el servidor — 27 de noviembre de 2026

- La revisión encontró que la app coloreaba el uso en 75 % y 90 %, mientras `GET /api/saas/usage` clasifica `caution` desde 60 %, `warning` desde 80 % y `exceeded` desde 100 %. Así, la interfaz podía marcar rojo antes del agotamiento real.
- PR [#225](https://github.com/Diegoromerov/glowapp-firebase/pull/225) quedó integrada en `main` como `5305746af185ef397dcbe3284d1fc24428064f53`. Analyze & Tests del proveedor y la compilación web terminaron SUCCESS en el workflow `46041308156`.
- Firebase Hosting live del prestador se publicó con éxito en el workflow `46041815863`. La portada y `main.dart.js` responden HTTP 200 con `Last-Modified: 2026-11-27 17:30:32 UTC`.
- El indicador ahora cambia a naranja desde 60 %, ámbar desde 80 % y rojo al alcanzar 100 %. Se alineó tanto la tarjeta de consumo como la tabla de límites. No se modificaron los límites del plan ni datos de salones.

## Aceptación autenticada del resumen de uso — 27 de noviembre de 2026

- Posterior al despliegue de PR #223, se inició sesión con la cuenta QA propietaria, seleccionando el salón 17 (**QA Salón Fase 2**) mediante `X-Active-Salon-Id`. Se hizo únicamente `GET /api/saas/usage`; no se modificó información ni se generaron operaciones.
- La API productiva devolvió `totalFeatures=14`, `ok=13`, `caution=1`, `warning=0`, `exceeded=0`. La suma de estados coincide con el total.
- La única métrica en cautela es `TEAM_SEATS`: 2 de 3 personas, 67 %. Esto confirma en el tenant QA el estado que la app proveedor ahora colorea desde el 60 %.
- El login respondió correctamente para la identidad QA; la consulta fue de lectura. La contraseña no se registra aquí.
- Con esta observación queda cerrada la aceptación de lectura del resumen de uso y de su conteo por estado. No cierra expiración/downgrade QA, cobro, integridad de todas las cuotas restantes ni piloto comercial.

## Métricas de consumo frente a capacidades del plan — 27 de noviembre de 2026

- **Código, producción y aceptación autenticada: cerrado.** PR [#234](https://github.com/Diegoromerov/glowapp-firebase/pull/234), commit `ab60bbc`, elimina capacidades booleanas del consumo cuantitativo; siguen indicándose como incluidas o no incluidas según el plan.
- La consulta de solo lectura al tenant QA `salon-17` devolvió 9 métricas, todas cuotas; no incluyó `MAP_VISIBILITY` ni otras capacidades booleanas. Resumen consistente: 9 total, 8 `ok`, 1 `caution` (`TEAM_SEATS`, 2/3), 0 `warning` y 0 `exceeded`.
- Este subtema queda cerrado para contrato y comportamiento productivo consultado. La matriz de medición/agotamiento de todas las cuotas sigue pendiente en el punto correspondiente; no se afirma que cada cuota haya sido ejercitada.
