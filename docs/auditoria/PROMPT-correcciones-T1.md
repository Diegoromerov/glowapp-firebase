# PROMPT — Correcciones de T1 (devolución del revisor)

> Devuelve este bloque íntegro al chat desarrollador. Es una revisión, no una tarea nueva: se atienden **los cuatro puntos** en una sola pasada y se reporta citando cada uno.

---

## Contexto

Revisado el commit `6cd9ab6` («T1: Envío de correo de confirmación al pagar la cita»).

Confirmado: está en `origin/main`, está en `staging`, y producción sirve ese commit (`/api/health` → `6cd9ab66eb438a6480caa2aab8ab76d282272e20`). El helper usa el módulo de Brevo (`emailService.js`), no el simulado: eso está bien. El envío va después del `COMMIT` y con `catch` que no propaga: bien. El early-return por `existingTx.status === 'paid'` existe, así que la idempotencia del webhook se sostiene.

**Veredicto: PARCIAL.** El camino principal del webhook no envía ningún correo, y ninguna de las pruebas presentadas lo habría detectado.

---

## Correcciones (obligatorias, todas)

### D1 — BLOQUEANTE: el `include` del webhook usa alias que no existen

**Dónde:** `backend/src/controllers/bookingController.js:1562-1569`

```js
include: [
  { model: require('../models').Usuario, as: 'cliente',   attributes: ['email','nombre'] },
  { model: require('../models').Usuario, as: 'prestador', attributes: ['nombre'] },
  { model: require('../models').Service, as: 'servicio',  attributes: ['name'] },
]
```

**Por qué falla:** los alias declarados son otros (`backend/src/models/index.js:30,34,38`):

```js
Booking.belongsTo(User,    { foreignKey: 'client_id',   as: 'client' });
Booking.belongsTo(User,    { foreignKey: 'provider_id', as: 'provider' });
Booking.belongsTo(Service, { foreignKey: 'service_id',  as: 'service' });
```

Sequelize lanza `EagerLoadingError: Usuario is not associated to Booking`. El `try/catch` lo traga y escribe «Error enviando correo (no bloquea)». Consecuencia: **todo pago confirmado por Wompi termina sin correo y sin error visible**.

**Qué hacer:**
1. Usar `client`, `provider` y `service` (los alias reales), o declarar los alias nuevos en `models/index.js` — pero entonces corregir también los consumidores.
2. Añadir una **prueba que ejecute la consulta con el `include`** contra la base de pruebas (no solo el render del template). Debe fallar si el alias vuelve a estar mal.

### D2 — El enlace del correo apunta a una ruta inexistente

**Dónde:** `backend/src/services/emailService.js:230`

```js
const receiptUrl = `${frontendBase}/#/bookings/${bookingId}/receipt`;
```

**Por qué falla:** esa ruta no está declarada en la app. Las existentes son `/my-bookings`, `/booking-tracking` y `/provider-detail`. Quien pulse el botón del correo cae en una pantalla que no existe.

**Qué hacer:** apuntar a `/#/my-bookings` (allí está el botón «Recibo por correo») o quitar el enlace del template. Si eliges mantenerlo, comprueba el texto del botón para que diga lo que realmente hace.

### D3 — Estado mal declarado

El JSON de cierre dice `"estado":"completa"` con `"evidencia":"E2"` y tres pruebas pendientes en `falta`. Según el contrato del prompt original, eso es `parcial`. Corrige el JSON: una tarea no está completa hasta que se ha ejercitado de punta a punta.

### D4 — Menor: datos personales en los logs

Se registra el correo del cliente en claro:

- `bookingController.js:1604` → `Correo de confirmación enviado a ${bookingCompleta.cliente.email}`
- `paymentRoutes.js:687` → `Correo de confirmación enviado a ${booking.cliente_email}`
- `emailService.js:236-238` → preparación con `toEmail`

El ítem 44 de la auditoría está abierto precisamente por esto. **Qué hacer:** registrar `booking_id` y el id de mensaje que devuelve Brevo; nunca la dirección.

---

## Criterios de aceptación (lo que el revisor va a pedir)

1. Log real `[WOMPI WEBHOOK] Correo de confirmación enviado` (sin el email en claro) tras un webhook APPROVED en sandbox, **y** el correo llegando a un buzón, con asunto y fecha de la cita visibles.
2. Lo mismo por la vía de confirmación OTP.
3. Prueba que falle si el `include` vuelve a usar un alias inexistente.
4. Forzar un fallo de Brevo (destinatario inválido o clave temporalmente vacía): el pago sigue `paid`, la cita sigue `CONFIRMADA`, y el error queda en el log sin propagarse.

Se acepta E2 para 3 y 4. Para 1 y 2 hace falta E3 (log de producción y correo recibido). Si no puedes provocar un pago en sandbox, dilo y marca la tarea como `parcial` con lo que falte, en vez de cerrarla.

---

## Formato del reporte de corrección

```
CORRECCIONES T1
Commit: <hash>   Rama: main + staging

D1 — <qué se cambió> · archivo:línea · cómo se comprobó (comando → salida)
D2 — ...
D3 — ...
D4 — ...

Verificación
- <comando> → <salida> (exit 0 / 200 / n filas)
- producción: /api/health commit = <hash>

JSON de cierre
{"tarea":"T1","estado":"completa|parcial","correcciones":{"D1":"hecha","D2":"hecha","D3":"hecha","D4":"hecha"},"evidencia":"E2|E3","falta":["..."]}
```

---

## Reglas que siguen vigentes

- No ocultar fallos con tuberías: `flutter test > log 2>&1; rc=$?; ...` (en backend, lo equivalente con `node --check` / jest).
- Un commit por corrección agrupada, mensaje en español; push a `main` **y** `staging`.
- No tocar `apps/glow_provider`.
- No empezar **T2** hasta que esta revisión esté cerrada.
- Si una corrección revela otro defecto, se anota y se reporta; no se arregla de paso.
