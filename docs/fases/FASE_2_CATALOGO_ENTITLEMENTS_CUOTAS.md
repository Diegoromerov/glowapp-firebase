# Fase 2 — Catálogo comercial, entitlements y cuotas

**Fecha:** 23 de noviembre de 2026

**Estado:** publicada en producción el 23 de noviembre de 2026.

## 1. Objetivo y alcance ejecutado

Centralizar los planes, capacidades y límites de GlowApp para que backend, onboarding y pantalla de uso consulten una oferta coherente. Se consolidaron los límites actuales, se instrumentaron reservas e integraciones, se hizo explícito el acceso a llaves API y se vinculó el control de asientos con las membresías activas y pendientes.

Quedan fuera de esta fase una migración comercial masiva de planes existentes, los complementos de pago y las notificaciones externas de consumo.

## 2. Qué se hizo

- Se creó `backend/src/config/saasCatalog.js`, catálogo versionado v1 de planes, capacidades booleanas, métricas, cuotas, precios, períodos y complementos. No hay complementos definidos todavía.
- `saasEntitlements`, `usageMeteringService` y `usageTracker` derivan sus decisiones del catálogo, retirando límites duplicados.
- Se agregó el endpoint público `GET /api/saas/catalog` y el detalle `GET /api/saas/catalog/:planId`. No exponen información de salones.
- Las reservas nuevas verifican y consumen el cupo mensual dentro de la misma transacción que crea la reserva, con clave de idempotencia ya existente y conteo histórico de respaldo.
- Las llaves API requieren la capacidad `API_KEYS`; las solicitudes autorizadas consumen la cuota mensual de procesos de integración y reciben `429` cuando se agota.
- Las invitaciones y reactivaciones de miembros consultan el cupo del plan incluyendo personas activas y pendientes. El alta y el conteo se serializan por salón para evitar exceder el cupo con invitaciones simultáneas.
- `/api/saas/usage` presenta nombres comerciales de métricas y el número real de personas del equipo. `/api/saas/usage/limits` también devuelve catálogo y versión.
- El onboarding consume el catálogo disponible y solo permite iniciar con Prueba Gratis o Freemium. Los planes pagos siguen activándose desde Facturación; no se confía en un plan pagado enviado en el cuerpo del alta.
- La pantalla Flutter de uso y el modelo compartido presentan etiquetas y cuotas del backend. Se actualizaron los valores de respaldo para funcionar sin conexión.
- Facturación, suscripciones e invoices usan el catálogo como fuente de identificadores y precios.

### Matriz comercial implementada

| Plan | Precio mensual COP | Personas | Reservas en línea/mes | Procesos de integración/mes | Capacidades principales |
|---|---:|---:|---:|---:|---|
| Prueba Gratis | $0 por 14 días | 3 | 50 | 1.000 | Presencia en mapa, equipo, reservas y marca personalizada |
| Freemium | Gratis permanente | 1 | 20 | 500 | Reservas en línea |
| Básico | $99.000 | 5 | 200 | 10.000 | Mapa, equipo y reservas |
| Profesional | $249.000 | 20 | Sin límite | 100.000 | Analítica avanzada, marca e integraciones con otros sistemas |
| Empresarial | $599.000 | Sin límite | Sin límite | Sin límite | Analítica, marca, integraciones, WhatsApp y punto de venta |

Las cuotas de reservas y procesos son controles técnicos internos aunque el onboarding no muestre “llamadas API” como beneficio comercial. Los precios USD previos se conservan en el catálogo (25/65/150 USD para Básico/Profesional/Empresarial); no se implementó conversión de moneda ni se cambió el mecanismo de cobro.

## 3. Cómo funciona ahora

El backend determina el plan y resuelve sus capacidades desde el catálogo versionado. Las capacidades booleanas —por ejemplo, WhatsApp— se autorizan como permisos; las cuotas —reservas, personas e integraciones— se cuentan por su período. Las pantallas consultan el mismo catálogo y muestran los límites recibidos del servidor, con valores de respaldo cuando no hay conexión.

La medición de reservas se aplica al crear una reserva y es parte de esa transacción. Los procesos API se cuentan al autenticar una llave con alcance válido. Las personas activas y las invitaciones pendientes ocupan asiento; el backend bloquea la fila del salón durante el conteo y alta.

## 4. Decisiones tomadas

- Se conservaron los límites existentes para evitar cambiar silenciosamente contratos comerciales.
- Se alinearon capacidades visibles con la propuesta actual: analítica avanzada y llaves de integración son Profesional o Empresarial; WhatsApp y POS son Empresarial. La llave API ya no se habilita por tener marca personalizada.
- El onboarding solo provisiona planes gratuitos. Una selección pagada debe pasar por el flujo de Facturación y su confirmación; el cliente no puede elevarse de plan alterando el payload.
- Se usan períodos mensuales de calendario en `America/Bogota`, tanto para consumir cuotas como para presentar el uso en SaaS y en los reportes administrativos.
- La cuota `API_CALLS` cuenta solicitudes externas autenticadas mediante una llave API GlowApp; las acciones normales dentro de las aplicaciones no consumen esa cuota.
- Las reservas se cuentan por cita/solicitud, no por cada servicio de una cita con varios servicios.
- No se creó migración de base de datos: el contador usa `usage_metrics` existente y reconstruye el punto de partida desde reservas históricas cuando falta el registro del mes.

## 5. Verificación

- Se ejecutó `node --check` sobre los módulos JavaScript backend modificados después del ajuste transaccional de invitaciones; todos pasaron.
- `git diff --check` y `git diff --cached --check` pasaron para los cambios de esta fase.
- GitHub Actions, ejecución [45215955186](https://github.com/Diegoromerov/glowapp-firebase/actions/runs/45215955186), pasó `Analyze & Tests`, la compilación web de `glow_provider` y el despliegue de Firebase Hosting de producción. El análisis/pruebas de Flutter de proveedor y las pruebas `GlowGuide Video Mapping` pasaron.
- Se comprobó `GET https://glowapp-provider.web.app` con respuesta HTTP 200.
- Se comprobó `GET https://glowapp-api-production.up.railway.app/api/saas/catalog` con `X-App-Audience: provider`: catálogo versión 1 y cinco planes (`FREE_TRIAL`, `FREEMIUM`, `BASIC`, `PRO`, `ENTERPRISE`).
- Los despliegues Railway del commit de backend `fa96bf7` quedaron en `SUCCESS`: `glowapp-api` (`cab649c3-e749-4e73-894e-2318f0bf1b5c`) y `admin-dashboard` (`6e02fe66-c883-4453-8d09-59ea8e0bf3cf`).
- No se ejecutaron pruebas de integración contra PostgreSQL ni una conciliación de tenants reales; la comprobación HTTP confirma disponibilidad del catálogo, no la corrección de todas las cuotas para cada cuenta.

## 6. Datos y despliegue

No hay migración pendiente. El backend, el panel administrativo y la app web del proveedor están desplegados. Los cambios SaaS del backend se publicaron en `fa96bf7`; los ajustes de compilación de la app de proveedor en `1decdca`. El flujo de Hosting se ejecutó contra `main` y finalizó correctamente. Esta fase no modifica planes existentes mediante migración masiva.

Las llaves API de tenants en Prueba Gratis, Freemium o Básico que antes podían autorizarse por el chequeo indirecto de marca personalizada dejan de cumplir el contrato nuevo, que requiere Profesional o Empresarial. Antes de una migración comercial más amplia, revisar las llaves existentes y avisar a tenants afectados.

## 7. Riesgos y rollback

- Los controles de cuotas de reserva y equipo dependen de que el esquema desplegado tenga `business_profiles`, `memberships` y `usage_metrics`, presentes en la arquitectura posterior a la Fase 1.
- La instrumentación de integraciones cubre las solicitudes autenticadas por middleware de llaves. Otras integraciones que no usen esas llaves aún deben agregarse en una fase posterior.
- El backend devuelve el estado/cuota y la app presenta avisos; no se añadieron envíos de correo, push ni alertas automáticas al alcanzar 80/100 %.
- Para revertir, volver a la versión anterior del backend y los clientes. No borrar `usage_metrics`: conserva historial y no requiere cambio de esquema.
- La selección de plan de onboarding queda limitada a opciones gratuitas, como protección contra autoasignación de planes pagos; el cobro pagado continúa en Facturación.

## 8. Pendientes y fase siguiente

- Ejecutar pruebas de integración de cuotas en PostgreSQL y cubrir reintentos/concurrencia.
- Revisar los planes actuales de tenants y acordar la transición comercial; verificar llaves API afectadas.
- No se implementaron alertas externas de consumo ni complementos.

La Fase 3 unificará membresías, roles y permisos operativos con el modelo SaaS; en particular, correo de invitación, auditoría y política de tokens. Estos pendientes no bloquean que el código de la Fase 2 desplegado quede registrado como publicado, pero deben revisarse como parte de la preparación comercial y de integración.
