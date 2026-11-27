# Fase 7 — Puntos por resolver

**Estado:** Fase 7 en curso. Catálogo V4, conservación de derechos heredados, corrección de lectura de cuotas e informes administrativos desplegados en producción el 26 de noviembre de 2026.
**Fecha de elaboración:** 23 de noviembre de 2026. **Última conciliación técnica:** 26 de noviembre de 2026.
**Contexto:** plan comercial SaaS de GlowApp para salones. El trabajo se publica directamente en producción, sin usar staging, conforme a la instrucción del usuario.

## Propósito

Consolidar los asuntos pendientes para que catálogo, cobro, límites técnicos y oferta comercial describan el mismo producto. Este documento registra trabajo por resolver; no implica que los puntos ya estén aprobados o implementados.

La auditoría estática de cobertura actual está en [FASE_7_AUDITORIA_TECNICA_LIMITES.md](FASE_7_AUDITORIA_TECNICA_LIMITES.md); distingue compuertas/cuotas encontradas de funciones que aún no tienen flujo de consumo verificable.

**Actualización posterior:** PR [#172](https://github.com/Diegoromerov/glowapp-firebase/pull/172) quedó integrada en `main` como `89b8afdc`. Backend CI `45918524098` pasó. Añade tres pruebas HTTP que verifican que el checkout COP/USD falla cerrado ante configuración incompleta y que el cambio directo de plan no evita la confirmación de pago. No cambia el backend desplegable; producción sigue saludable en `7a2a62cb`. Las pruebas de cobro sandbox/producción y la activación comercial siguen pendientes.

**Actualización multi-sede:** PR [#175](https://github.com/Diegoromerov/glowapp-firebase/pull/175), CI `45919515848` SUCCESS, quedó integrado y desplegado como `cd4fdea4`. Empresarial no hereda `MULTI_SITE`; su oferta propuesta conserva tres sedes como dato comercial separado. Railway y el endpoint del catálogo confirmaron producción saludable, plan no disponible y límite operativo actual de una sede.

**Actualización de Caja:** PR [#177](https://github.com/Diegoromerov/glowapp-firebase/pull/177) quedó integrada como `90cc6b8`; CI de backend y Flutter pasó. El workflow `45932800849` compiló y publicó el portal del prestador en Firebase Hosting live. La API Railway y los archivos del portal fueron verificados en producción. La distinción funcional entre caja Freemium y planes pagos queda pendiente de definición, por lo que no se cambiaron permisos.

## Lista de pendientes

| N.º | Punto por resolver | Decisión o trabajo requerido | Resultado esperado |
|---:|---|---|---|
| 1 | Vencimiento de Prueba Gratis | Bootstrap guarda fechas; facturación muestra vencimiento; el job independiente de Railway corre a diario y cambia a Freemium. Solo un plan pago `active` protege el tenant; `incomplete`, `trialing` y `past_due` no extienden la prueba. Integración PostgreSQL efímera aprobada en CI `45902457105` (4 suites, 18/18 pruebas): expiración normal/legada, plan pago activo, fecha futura, sincronización de sede, auditoría e idempotencia. | Falta validar el cron con un tenant QA controlado en producción. CI no tocó tenants productivos ni sustituye esta prueba. |
| 2 | WhatsApp, Aura, marca y soporte prioritario | No ofrecer WhatsApp, Aura para negocio ni marca personalizada en altas nuevas hasta tener flujo SaaS, integración, métrica y soporte verificables. Posicionamiento de soporte/SLA empresarial sigue pendiente. | Capacidades implementadas y medibles antes de incorporarlas a una oferta contratada. |
| 3 | Caja, inventario, recetas y recursos | La caja es un libro manual con constancias internas; ya se corrigieron sus rótulos visibles sin cambiar accesos. Las capacidades `POS_INTEGRATION` y `POS_RECEIPTS_ONLY` actualmente permiten las mismas operaciones. Aclarar qué significa “recibos solamente” antes de restringir Freemium; auditar acceso/cuotas de inventario, recetas y recursos por rol y tenant. | Catálogo describe la función real y cada plan tiene capacidades/cuotas diferenciadas aplicadas y probadas en backend. |
| 4 | Fidelización propia del salón | Elegir entre incluirla en planes, venderla como complemento o ejecutarla como piloto. Definir costos, límites y reglas; mantenerla separada de los puntos globales GlowApp. | Oferta comercial y técnica clara para el programa de puntos del salón. |
| 5 | Multi-sede | La propuesta V3 indica 1 sede para Profesional y 3 para Empresarial. Esos valores quedan separados en `proposedOffer`; el entitlement actual heredado no se amplía. La oferta no es contratable: falta aprobarla comercialmente y construir creación/administración de sedes adicionales, permisos por sede, consolidación y enforcement de cuota en backend. | Alta y operación multi-sede con permisos aislados, límite validado atómicamente y panel consolidado; activar solo tras aprobación comercial y pruebas de tenant. |
| 6 | Procesos de integración | **Bloqueo técnico cerrado:** `GET /api/integrations/v1/services` cuenta cada solicitud autenticada con API key dentro de la misma transacción, aplica el tope atómico y devuelve HTTP 429 al agotarlo. CI `45911101915` probó PostgreSQL/RLS, aislamiento y dos llamadas concurrentes por el último cupo: una 200 y una 429, sin exceder el contador. Coincide con la regla de la propuesta V3. Queda pendiente decidir comercialmente si habrá compra de excedentes y cómo se avisará antes del límite; no existe facturación por sobreconsumo. | Sin excedentes activados, la cuota se detiene en el límite y responde 429; cualquier cambio a cobro adicional requiere decisión comercial y controles antes de habilitarlo. |
| 7 | Paridad integral de catálogo y respaldo | **Cerrado para los planes activos de contratación.** El catálogo remoto usa precio, periodicidad y unidades de API; el respaldo Flutter compara en CI disponibilidad, compra habilitada, nombre, descripción, precio, beneficios visibles y todas las cuotas declaradas para Prueba Gratis, Freemium y Básico. | CI debe seguir bloqueando divergencias de la oferta activa. Los planes propuestos/no contratables no se presentan como oferta activa ni se incluyen en esta validación de fallback. |
| 8 | Facturación, cambios de plan y piloto | Definir excedentes, upgrade/downgrade, textos de facturación y alcance del piloto. Instrumentar métricas y preparar un mecanismo de rollback antes de ampliar el lanzamiento. | Flujo de contratación y cambio de plan comprensible, medible y reversible. |
| 9 | Verificación integral de límites | La matriz técnica registra gates y cuotas por capacidad. Equipo/asientos y recursos tienen concurrencia verificada con PostgreSQL efímero; reservas cubren cuota, reintento idempotente, agrupación y rollback en CI. Aún faltan recorridos HTTP autenticados para límites y tenant QA, completar revisión de rutas alternas/heredadas y decisiones de producto. Aura, WhatsApp, facturación electrónica y sedes no tienen consumo SaaS verificado. Las alertas email/webhook no tenían entrega; PR #168 las deshabilitó explícitamente en producción, mientras el dashboard conserva el aviso local al 80 %. | Evidencia de permisos y cuotas por flujo; funciones sin consumo verificable siguen fuera de la oferta contratable y ninguna alerta externa se presenta como activa sin entrega real. |

## Corrección de reporte de cuotas — 26 de noviembre de 2026

- El panel del proveedor ahora interpreta `DIRECT_BOOKINGS` como reservas directas y ya no clasifica métricas desconocidas como llamadas API.
- El valor `0` se muestra como «No incluido»; «Ilimitado» solo aparece cuando la API entrega explícitamente esa condición o el catálogo declara límite nulo.
- La cuota API se presenta como «Procesos de integración», con explicación de que cuenta solicitudes externas autenticadas con llave API. Los actos normales dentro de GlowApp no cuentan.
- El reporte SuperAdmin queda alineado al período calendario `America/Bogota`, igual al medidor de cuotas. Esta corrección no verifica todas las rutas ni la política de excedentes; el punto 9 sigue abierto.
- La cuota de API abierta ya se aplica con bloqueo atómico y HTTP 429 al agotarse. CI `45911101915` verifica el último cupo concurrente en PostgreSQL/RLS; no hay cobro automático de excedentes. La decisión comercial sobre compra de excedentes permanece pendiente.

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

Pendiente todavía: la paridad de fallback ya está cubierta para los planes activos; sigue pendiente mapear cada ruta de escritura/lectura de inventario, POS, recursos, facturación, Aura, WhatsApp y multi-sede con sus entitlements antes de afirmar cobertura integral. No se ejecutó una reserva real en producción ni se configuró un proveedor DIAN o cobro recurrente, para no alterar datos ni activar condiciones comerciales sin configuración.

## Faltantes prioritarios — fase reanudada

La corrección desplegada conserva en `FREE_TRIAL_LEGACY` las capacidades concedidas a los tenants existentes; los nuevos registros reciben una prueba con módulos que tienen flujos operativos en la aplicación. Railway registra como exitosa la migración 203 y el catálogo V4 se verificó en la API productiva. Básico ya no incluye `INVOICING_ADDON`, que permanece no disponible.

También quedaron desplegados el catálogo V4, la migración 203, la compatibilidad con fechas de vencimiento y el respaldo Flutter. CI de backend y workflow live de Firebase pasaron. La API está saludable, responde V4 y el Hosting del proveedor devuelve HTTP 200. `dart analyze` enfocado no encontró errores; el análisis completo del proveedor reporta avisos preexistentes en otras pantallas.

**Estado de trabajo:** fase reanudada. Resolver en paralelo las brechas técnicas seguras; mantener bloqueados precios propuestos, cobros reales y módulos no configurados hasta contar con decisiones y proveedores necesarios.

**Avance publicado el 26 de noviembre:** el commit `2cb857b` alinea las descripciones activas del catálogo y el respaldo Flutter; el formateador remoto presenta las cuotas comerciales. PR #144 agrega comprobación CI para nombre, descripción, precio, beneficios, cuotas y disponibilidad/compra de los planes activos. CI backend/Flutter y Hosting live pasaron. La paridad de catálogo activa queda cerrada; permanece la auditoría de rutas/entitlements y límites operativos.

| Prioridad | Faltante | Trabajo pendiente al retomarlo | Condición para cerrarlo |
|---|---|---|---|
| P0 | Decisiones comerciales | Aprobar precios y niveles finales; ciclo de cuotas; anualidad; excedentes; reglas de mejora/reducción y período de gracia. El vencimiento base de Prueba Gratis es 14 días y ya está implementado; las reglas posteriores de gracia/retención no se deben inferir. | Oferta comercial aprobada y coherente con contratos, catálogo, onboarding y facturación. |
| P0 | Cobro de suscripciones | Integrar y validar cobro recurrente, renovaciones, cancelaciones, pagos rechazados, webhooks, reintentos y conciliación de suscripciones existentes. Los endpoints de checkout y cambio de plan fallan cerrados si falta configuración o confirmación por webhook. FREE_TRIAL nuevo ya no crea suscripciones Stripe; falta inventariar de forma agregada si quedaron registros históricos de prueba en Stripe y definir conciliación segura sin cancelar o cobrar automáticamente. | Pruebas completas con credenciales y productos configurados en la pasarela, sin cobrar importes propuestos antes de su aprobación; registros históricos conciliados con evidencia y sin cambios remotos no autorizados. |
| P0 | Facturación electrónica | Elegir e integrar proveedor tecnológico habilitado; completar configuración del salón/NIT, ambiente de pruebas, emisión, notas y errores. Confirmar costos y obligaciones aplicables. | Emisión y consulta probadas con el proveedor; funciones fiscales reales no se presentan como disponibles antes de esa validación. |
| P1 | Entitlements por plan | Completar la auditoría de cada ruta de lectura/escritura y pantalla para inventario, caja/POS, recursos, recetas, analítica, Aura, WhatsApp, equipo y multi-sede. Gates existentes se han localizado para varios módulos; no hay evidencia de cobertura integral ni de que todos los módulos anunciados estén operativos. | Matriz V3 reflejada en backend y UI, con pruebas de acceso permitido y denegado por nivel. |
| P1 | Cuotas y medición | API_CALLS está medido y bloquea atómicamente con 429; reservas directas cuentan bajo transacción y distinguen marketplace; recursos y asientos aplican límites. Ya se alinearon período Bogotá, historial y deduplicación de reservas agrupadas entre dashboard y contador. Restan los contadores/consumos de documentos, sedes, Aura y WhatsApp, y definir su respuesta comercial/UI antes de ofrecerlos. Para API queda decidir si se venderán excedentes; actualmente no se cobran. | Cada cuota ofrecida tiene evento de consumo verificable, contador reconciliable y comportamiento de agotamiento probado; las funciones sin medición permanecen fuera de la oferta activa. |
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
