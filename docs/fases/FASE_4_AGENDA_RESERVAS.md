# Fase 4 — Agenda y reservas como módulo SaaS

**Fecha:** 23 de noviembre de 2026  
**Estado:** implementación local en curso; sin despliegue.

## 1. Objetivo y alcance ejecutado

Vincular servicios y reservas al negocio SaaS y a su sede cuando la relación sea conocida; mostrar disponibilidad coherente con el calendario colombiano; exigir selección de sede en negocios con varias sedes y proteger creación de citas ante solicitudes simultáneas.

El trabajo de esta fase no se ha desplegado ni está cerrado. Staging no contiene aún las fases 1–3, así que no se considera entorno preparado para validar la migración 191.

## 2. Qué se hizo

- `backend/migrations/191_booking_tenant_salon_scope.sql`: añade `business_profile_id` y `salon_id` a servicios y reservas; agrega claves foráneas `NOT VALID` e índices. El backfill completa solo relaciones inequívocas y no deja que datos legados sin conciliar bloqueen el despliegue.
- `backend/src/utils/bookingCalendar.js`: centraliza día, día de semana y hora local en `America/Bogota`.
- Modelos `Service` y `Booking`: incorporan `salon_id` nullable.
- `bookingController`: comprueba que los servicios pertenezcan a un mismo negocio/sede y que la sede esté autorizada para el dueño o miembro activo; registra ambas identidades. Bloquea por prestador/día local dentro de la misma transacción que valida que la cita sea futura, respete horario semanal, intervalo de 30 minutos y cierre de jornada, comprueba solapamiento y crea la reserva. La medición de uso se conserva por reserva lógica principal.
- El panel de reservas permite a miembros activos con rol canónico `OWNER`, `ADMIN`, `MANAGER`, `MEMBER` o `VIEWER` consultar citas SaaS de su negocio, aunque la cuenta base tenga rol global de cliente. La autorización usa `memberships.role`; `VIEWER` solo puede leer, `MEMBER` puede confirmar/iniciar/completar mediante `CONFIRM_BOOKING`, y cancelar o actualizar exige `UPDATE`. El cliente autenticado de la reserva confirma el OTP final. La app proveedor pasa la sede SaaS activa en `x-active-salon-id`; el backend comprueba que corresponda al negocio y a la reserva. Los registros legados sin perfil/sede siguen visibles al prestador titular.
- El permiso compartido de reservas se centralizó en `backend/src/utils/bookingAccess.js` y se reutiliza en agenda, check-in GPS e inicio/emisión del OTP; las operaciones transaccionales vuelven a comprobar el permiso dentro de su transacción. La ruta genérica de estado queda limitada a escalar una cita como `EN_DISPUTA`; las transiciones con pagos, OTP o reembolso usan las rutas específicas.
- La reprogramación conserva el límite de una vez y 24 horas. En reservas con varios servicios, bloquea y mueve el grupo completo en secuencia, comprueba duración total, sede/negocio y colisiones bajo `FOR UPDATE` y el bloqueo del prestador/día colombiano; el cliente consulta disponibilidad con todos los servicios y la sede de origen, y envía la hora con offset `-05:00`.
- Cancelación de cliente, cancelación de prestador y reporte de no-show mantienen la autorización por titular o `client_id`; si la compra tiene varios servicios, resuelven y bloquean el grupo completo en orden estable, cancelan todos sus bloques y generan reembolso, reversión de inventario, sanción o compensación una sola vez sobre la reserva principal. Sus operaciones financieras y sanciones se ejecutan con RLS de sistema dentro de la transacción que cambia el estado, para no dejar asientos parciales al fallar una escritura.
- `providerController`: ofrece servicios y sedes de negocio a prestadores/membresías activas, presenta ficha de sede y calcula la agenda y «disponible hoy» con el día, el horario semanal y la hora de Colombia. Rechaza fechas imposibles y evita reservar servicios sin negocio asignado en cuentas SaaS. El endpoint público de slots lee servicios, horarios y reservas con el rol de sistema tras filtrar por prestador y validar la sede, para que el RLS del cliente no oculte la disponibilidad del proveedor.
- `serviceController`: permite crear/actualizar servicio con sede asociada y devuelve el campo de sede.
- Flutter cliente y `glow_core`: pasan la sede al pedir disponibilidad y crear reservas; la pantalla permite elegir sede y restringe la selección de servicios a esa sede. La fecha/hora se transmite con offset explícito `-05:00` para no depender de la zona horaria configurada en el dispositivo o el servidor.
- `backend/src/tests/bookingCalendar.phase4.nodetest.js`: cubre conversión horaria, rango diario, fechas calendario imposibles, entradas inválidas, solapamientos y horario de cierre.

## 3. Cómo funciona ahora

Para un perfil con varias sedes, el cliente debe escoger una antes de buscar horarios. El servidor valida la selección en la consulta y de nuevo al reservar; el cliente no define la pertenencia. Los horarios y conflictos se evalúan usando el día calendario de Bogotá. La escritura transaccional serializa los intentos del mismo prestador en el mismo día y vuelve a comprobar que la cita sea futura, respete horario semanal, cierre e intervalo publicado, y no tenga conflictos antes de insertar. La reprogramación usa el mismo bloqueo y las mismas reglas de jornada/intervalo para evitar carreras con reservas nuevas. En la agenda SaaS de un miembro, una cita por sede se muestra/gestiona con esa sede activa; sin una sede activa solo se devuelven registros generales o legados sin sede.

### Contrato de estados y rutas

El ciclo usa `estado` como estado de operación y `payment_status` como estado del pago, sin mezclarlos. Estados operativos vigentes: `PENDIENTE_PAGO` → `CONFIRMADA` → `CHECKIN_REALIZADO` → `EN_PROGRESO` → `FINALIZADA_PRESTADOR`/`ESPERANDO_OTP` → `COMPLETADA`; las salidas excepcionales son `EN_DISPUTA` o `CANCELADA`. El webhook de Wompi es quien confirma el pago; el OTP confirma la finalización. La ruta genérica de estado solo escala a disputa.

| Ruta actual | Uso y control aplicado |
| --- | --- |
| `POST /api/bookings` | Crea reserva, valida negocio/sede, jornada, colisiones e idempotencia; consume cuota lógica. |
| `GET /api/providers/:id/slots` | Devuelve disponibilidad para fecha, servicios y sede. |
| `GET /api/bookings/provider` / `GET /api/bookings/client` | Agenda por permisos y sede; historial limitado al cliente autenticado. |
| `PATCH /api/bookings/:id/reschedule` | Una reprogramación, máximo 24 h antes; mueve el grupo de servicios completo. |
| `PATCH /api/bookings/:id/cancel` / `PATCH /api/bookings/:id/cancel-provider` | Cancelan el grupo; reembolso/inventario/sanción se calcula una vez desde la reserva principal. |
| `POST /api/bookings/:id/no-show` | Solo el cliente titular; compensa y cancela el grupo una vez. |
| `POST /api/bookings/:id/pay`, `POST /api/payments/wompi-webhook` | Pago real y confirmación por evento firmado; Wompi no depende del cliente para marcar pagado. |
| `PATCH /api/bookings/:id/start`, `POST /api/bookings/:id/checkin`, `POST /api/bookings/:id/confirm-otp` y `PATCH /api/bookings/:id/status` | Inicio y cierre autenticados por miembro operativo; estado genérico reservado a disputa. |
| `GET /api/bookings/:id/receipt`, `/receipt/link`, `/receipt/download`, `/receipt/email`, `POST /api/bookings/:id/review` | Recibo y reseña permanecen limitados al cliente propietario de la reserva. |

### Recordatorios: módulo y medición aparte

Los recordatorios no consumen `ONLINE_BOOKING`: esa métrica cuenta una reserva lógica, no cada mensaje. El cron de pagos abandonados ahora se ejecuta cada 15 minutos y limita el envío a reservas con un `business_profile_id` explícito; los grupos de varios servicios producen un recordatorio desde su reserva primaria. La tabla `booking_reminder_deliveries` registra por reserva lógica/tipo/canal el proveedor, el estado, el ID externo y el error. El claim persistido evita envíos simultáneos y no reenvía una entrega confirmada. Si el proveedor acepta el mensaje y el proceso cae antes de guardar la respuesta, el resultado queda ambiguo; un reintento puede duplicarlo porque los proveedores actuales no comparten clave de idempotencia. Push y correo son dos unidades de mensaje independientes; las entregas simuladas o los correos sin proveedor configurado no se cuentan como enviados. La tabla no guarda destinatario ni contenido.

El costo queda `NULL` cuando FCM/Brevo/SMTP no lo reportan; no se presenta un costo ficticio. Si se conoce el costo unitario contractual, operaciones puede configurar `REMINDER_COST_COP_PER_FCM`, `REMINDER_COST_COP_PER_BREVO` o `REMINDER_COST_COP_PER_SMTP`; cada entrega aceptada conserva el valor y el origen de esa configuración. Los cargos potenciales de intentos fallidos no se estiman y requieren conciliación con la factura del proveedor. El endpoint suma los costos por moneda, sin mezclar COP con otras divisas. WhatsApp y un panel/cuota comercial de mensajes no se implementan aquí. La tabla tiene RLS por negocio; el job la procesa vía `runAsSystem` y filtra explícitamente el tenant elegible.

El endpoint autenticado `GET /api/saas/usage/reminders` resume por canal y proveedor los mensajes aceptados, los intentos, fallos, omisiones y costos conocidos del mes en curso. Su consulta se filtra por el perfil SaaS resuelto desde la membresía, nunca por un tenant recibido libremente en el query string. `ONLINE_BOOKING` continúa independiente.

## 4. Decisiones tomadas

- Se mantienen reservas y servicios en el monolito modular y en las tablas existentes.
- Los datos históricos ambiguos permanecen sin sede/perfil; no se asigna una sede arbitraria.
- Se usa `America/Bogota` como zona horaria inicial del producto.
- Las sedes comparten el horario semanal configurado para el prestador en `perfiles_prestador`; esta fase no añade horarios independientes por sede.
- La cuota de `ONLINE_BOOKING` mide cada reserva lógica creada correctamente una sola vez, aunque incluya varios servicios almacenados como bloques vinculados. Una reprogramación o reintento idempotente no vuelve a consumirla; cancelar no restituye la unidad porque la reserva ya fue creada y procesada.

## 5. Verificación

- `node --check` pasó en los siete archivos JavaScript de reservas, disponibilidad, permisos y rutas, tras los cambios de reprogramación, cancelación y no-show grupales.
- La ejecución registrada de `node --test backend/src/tests/bookingCalendar.phase4.nodetest.js` pasó 10 verificaciones (día de Bogotá, límites UTC del día, fechas imposibles, día de semana/hora local, entradas inválidas, solapamientos, cierre de jornada y medianoche). Esa suite precede a los cambios de autorización de membresía y reprogramación grupal; no se ejecutó de nuevo.
- `node --check` pasó para `backend/index.js`, el cron de recordatorios, el servicio Push y la ruta de métricas SaaS.
- Alineación RBAC del panel y ciclo operativo: `node --check` pasó en helper, controlador y rutas tras separar permisos `UPDATE`/`CONFIRM_BOOKING`, añadir `VIEWER` a lectura y habilitar miembros SaaS (sin exigir rol global `PRESTADOR`) para check-in e inicio/emisión de OTP. La consulta y las políticas RLS aún requieren integración en staging.
- Inspección de PostgreSQL de staging (23 de noviembre de 2026), por SSH desde `glowapp-api-staging`, con consultas en transacción `READ ONLY`: base `railway`, rol de inspección `postgres`; no se leyó información de usuarios ni se cambió estado. `app_rls_user` no tiene `BYPASSRLS`, `app_system` sí. `bookings` y `services` tienen RLS habilitado y forzado con `tenant_isolation` (`tenant_id = app_current_tenant_id()`); comprobación bajo `app_rls_user` con un tenant sin asignar confirmó cero filas en ambas tablas. `memberships` no tiene RLS habilitado en este esquema.
- La misma inspección halló cero filas de migraciones `189`–`192` en `schema_migrations`; `bookings.salon_id` y `services.salon_id` no existen y tampoco existe `booking_reminder_deliveries`. `EXPLAIN` en transacción de solo lectura rechazó las consultas de alcance por sede de `bookings`, `services` y membresía con SQLSTATE `42703` (columna inexistente), y rechazó el ledger con `42P01` (relación inexistente). Por ello **la compatibilidad de las consultas/RLS de Fase 4 no pasa en el staging actual** y las pruebas de Fase 4 requieren primero una línea base con fases 1–3 y migraciones 191–192 aplicadas.
- `git diff --check` pasó; Git solo informó normalización LF/CRLF en algunos archivos editados.
- `dart format --output=none` pudo parsear las ocho unidades Flutter modificadas; reportó diferencias de formato y advertencias por falta de `flutter_lints`, y no escribió archivos. El análisis estático de tipos sigue pendiente por ausencia de `.dart_tool/package_config.json`.
- `dart analyze` no es concluyente en este checkout: falta `.dart_tool/package_config.json`, por lo que el analizador no puede resolver Flutter ni los paquetes locales; no se realizó `pub get` ni se modificaron dependencias.
- Se intentó ejecutar `e2e-saas-verification.test.js` con Jest; `npx` no encontró dependencias instaladas y la descarga falló por un error TLS (`ERR_SSL_WRONG_VERSION_NUMBER`), así que esa suite no llegó a ejecutarse.
- No se ejecutó integración contra PostgreSQL; migraciones 191–192, RLS, la carrera de reservas y el ledger de recordatorios siguen pendientes de staging.

## 6. Datos y despliegue

La migración 191 es aditiva y se aplica por el runner al iniciar el backend. Antes de desplegar se requiere preparar staging con fases 1–3, aplicar la migración y validar tanto filas conciliadas como relaciones que permanecen ambiguas. No se ha aplicado en staging ni producción.

Verificación de infraestructura Railway y HTTP (23 de noviembre de 2026): `glowapp-api-staging` tiene su último despliegue exitoso el 19 de noviembre, desde `staging` en `65534a40`; su `/api/health` informó PostgreSQL activo y 178 migraciones registradas, aunque declara `env=production` a pesar de ser el servicio de staging (anomalía de configuración que conviene corregir). La inspección directa confirmó que no están registradas las migraciones 189–192 y faltan las columnas/tablas que necesitan las consultas Fase 4. La Fase 1–3 todavía no está en staging. Producción ejecuta `main` en `a8e105f1` y los despliegues de API y panel (`ae440089` y `96b3963a`) finalizaron `SUCCESS` el 23 de noviembre. El `/api/health` productivo respondió HTTP 200, PostgreSQL activo, sin datos simulados, commit `a8e105f1` y 62 migraciones registradas por el runner en ese arranque; los logs confirman que la migración 190 se aplicó y señalan deriva de checksum en las migraciones históricas 147, 148 y 173, que debe revisarse por separado. Las migraciones 191–192 de Fase 4 no se han desplegado.

Las ramas divergen desde `3546b44a`: staging tiene 17 commits propios y está 125 commits detrás de main, incluidos cambios logísticos que no están en main. Una simulación de merge en una copia local encontró seis conflictos en migración/registry, preparación RLS, pedidos, devoluciones y sus pruebas. El entorno también tiene un parche de cuatro cambios de configuración pendiente en la fuente del servicio API (`glowapp-api-staging`), sin relación con esta fase. No se aceptó el parche ni se alteró ningún recurso de Railway. Por tanto, la comprobación confirma que las fases 1–3 están en producción, pero no están en staging; Fase 4 permanece solo en el checkout local.

## 7. Riesgos y rollback

- El esquema permanece nullable para compatibilidad; los datos históricos ambiguos requieren reconciliación antes de exigir sede en todas las reservas.
- Las horas de agenda son compartidas entre sedes del mismo prestador; horarios por sede quedan fuera de esta fase.
- Rollback operativo: desplegar la versión anterior de API y apps. Mantener las columnas e índices añadidos; no eliminar los campos porque podrían tener datos nuevos.

## 8. Pendientes y fase siguiente

- Revisar SQL y contrato Flutter; `node --check` y `git diff --check` pasan. Dart 3.13.7 pudo parsear los archivos con `dart format --output=none`, pero reportó diferencias de formato; no se escribieron cambios.
- Resolver la deriva entre staging y main y llevar las fases 1–3 a staging; no se deben aceptar los cuatro cambios pendientes de configuración sin revisarlos aparte.
- Aplicar 191–192 en staging y repetir `EXPLAIN`/integración PostgreSQL para cada consulta y rol. La inspección actual confirma que el tenant RLS legado filtra `bookings`/`services`, pero el esquema no permite validar el nuevo alcance por sede ni el ledger.
- Verificar disponibilidad en distintas fechas, rechazo de sede ajena, límites SaaS y carrera de reservas contra PostgreSQL.
- Publicar y cerrar la fase solo después de validación de staging y documentación de sus resultados.

La Fase 5 permanece pendiente hasta cerrar la Fase 4.
