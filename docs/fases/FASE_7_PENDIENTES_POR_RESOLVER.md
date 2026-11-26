# Fase 7 — Puntos por resolver

**Estado:** auditoría actualizada contra `main` el 26 de noviembre de 2026; faltantes priorizados.
**Fecha de elaboración:** 23 de noviembre de 2026. **Última conciliación técnica:** 26 de noviembre de 2026.
**Contexto:** plan comercial SaaS de GlowApp para salones. El trabajo se publica directamente en producción, sin usar staging, conforme a la instrucción del usuario.

## Propósito

Consolidar los asuntos pendientes para que catálogo, cobro, límites técnicos y oferta comercial describan el mismo producto. Este documento registra trabajo por resolver; no implica que los puntos ya estén aprobados o implementados.

## Lista de pendientes

| N.º | Punto por resolver | Decisión o trabajo requerido | Resultado esperado |
|---:|---|---|---|
| 1 | Vencimiento de Prueba Gratis | El catálogo declara 14 días. El bootstrap normal persiste `saas_plan`, pero no crea suscripción ni fecha de inicio/fin; el job de vencimiento solo procesa `subscriptions.trial_end`. Implementar fecha, aviso y paso idempotente a Freemium, con transición segura para tenants existentes. Los planes pagos hoy declaran 0 días y Stripe checkout usa 0. | Prueba de 14 días que realmente vence y política comunicada; ninguna degradación inesperada de salones existentes. |
| 2 | WhatsApp, POS y soporte prioritario | Precisar si están disponibles hoy para Empresarial, definir alcance, responsables y SLA; integrar los controles de acceso backend que falten. | Beneficios que puedan entregarse, medirse y sostenerse de acuerdo con lo anunciado. |
| 3 | Caja, inventario, recetas y recursos | Definir qué herramientas operativas corresponden a cada plan y establecer capacidades/cuotas donde hagan falta. | Matriz por plan y límites efectivos en backend. |
| 4 | Fidelización propia del salón | Elegir entre incluirla en planes, venderla como complemento o ejecutarla como piloto. Definir costos, límites y reglas; mantenerla separada de los puntos globales GlowApp. | Oferta comercial y técnica clara para el programa de puntos del salón. |
| 5 | Multi-sede | Definir el número de sedes, permisos y funciones de consolidación por plan, especialmente para Empresas. | Límites de sedes explícitos en catálogo, contratos y backend. |
| 6 | Procesos de integración | Explicar qué operaciones consumen la cuota API mensual y qué ocurre al agotarla (bloqueo, aviso, compra de excedente u otra regla). | Métrica entendible y política de excedentes aplicada de forma consistente. |
| 7 | Paridad integral de catálogo y respaldo | Ya hay comprobación automatizada de disponibilidad/contratación entre Node y Dart. Extenderla a precio vigente, límites, capacidades y texto del fallback; no duplicar como faltante el control de disponibilidad existente. | Cambios de precios, límites o capacidades divergentes fallan CI; sin catálogo API el cliente no inventa oferta. |
| 8 | Facturación, cambios de plan y piloto | Definir excedentes, upgrade/downgrade, textos de facturación y alcance del piloto. Instrumentar métricas y preparar un mecanismo de rollback antes de ampliar el lanzamiento. | Flujo de contratación y cambio de plan comprensible, medible y reversible. |
| 9 | Verificación integral de límites | Ejecutar pruebas de integración en producción controlada para verificar reservas, invitaciones/asientos, API y capacidades en todos los canales de creación, reintento y cambio de plan. | Evidencia por flujo de que el backend aplica correctamente cuotas y permisos. |

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

Pendiente todavía: la comprobación cubre la paridad de disponibilidad/contratación, no la matriz completa de cuotas y descripciones. El resto de herramientas (inventario, POS, recursos, facturación, Aura, WhatsApp y multi-sede) requiere mapear cada ruta de escritura/lectura con sus entitlements antes de afirmar que todos sus límites están aplicados. No se ejecutó una reserva real en producción ni se configuró un proveedor DIAN o cobro recurrente, para no alterar datos ni activar condiciones comerciales sin configuración.

## Faltantes prioritarios — aplazados

**Estado de trabajo:** no ejecutar en esta etapa. El usuario cambia de tarea y retomará estos puntos más adelante. No se activan nuevos precios, cobros ni módulos hasta reanudar y resolver los bloqueos que correspondan.

| Prioridad | Faltante | Trabajo pendiente al retomarlo | Condición para cerrarlo |
|---|---|---|---|
| P0 | Decisiones comerciales | Aprobar precios y niveles finales; días de prueba; ciclo de cuotas; anualidad; excedentes; reglas de mejora/reducción; período de gracia y comportamiento al vencer la prueba. | Oferta comercial aprobada y coherente con contratos, catálogo, onboarding y facturación. |
| P0 | Cobro de suscripciones | Integrar y validar cobro recurrente, renovaciones, cancelaciones, pagos rechazados, webhooks, reintentos y conciliación de suscripciones existentes. | Pruebas completas con credenciales y productos configurados en la pasarela, sin cobrar importes propuestos antes de su aprobación. |
| P0 | Facturación electrónica | Elegir e integrar proveedor tecnológico habilitado; completar configuración del salón/NIT, ambiente de pruebas, emisión, notas y errores. Confirmar costos y obligaciones aplicables. | Emisión y consulta probadas con el proveedor; funciones fiscales reales no se presentan como disponibles antes de esa validación. |
| P1 | Entitlements por plan | Auditar rutas y pantallas de inventario, caja/POS, recursos, recetas, analítica, Aura, WhatsApp, equipo y multi-sede; aplicar gates y cuotas backend donde falten. El gate `LOYALTY` ya fue publicado; faltan los demás módulos. | Matriz V3 reflejada en backend y UI, con pruebas de acceso permitido y denegado por nivel. |
| P1 | Cuotas y medición | Definir los eventos que consumen API, documentos, recursos, sedes, Aura y WhatsApp; implementar contadores independientes, umbrales del 80/100% y respuesta al agotamiento. Completar paridad de cuotas, capacidades y descripciones; hoy solo se compara disponibilidad/contratación. | Contadores reconciliables y límites que coinciden entre API, Flutter y la oferta comercial. |
| P1 | Reservas directas | Completar una prueba integral segura que confirme que las reservas de la app del salón consumen cuota y las del marketplace no, incluyendo reintentos, reservas agrupadas y concurrencia. | Evidencia de integración sin crear o modificar reservas reales de clientes sin autorización operativa específica. |
| P2 | Piloto y salida comercial | Definir salones piloto, instrumentación, soporte, comunicación, monitoreo, procedimiento de reversión y criterios de expansión. | Piloto medido y aprobado antes de ampliar disponibilidad de niveles o complementos. |

### Punto de reanudación

Al retomar Fase 7, comenzar por las decisiones P0. Después, revisar entitlements/cuotas P1 y cerrar con pruebas y piloto. La oferta comercial V3 sirve como propuesta base; sus precios e hipótesis no se consideran aprobados por estar documentados aquí.
