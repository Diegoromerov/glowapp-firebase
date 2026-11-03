# Diagnóstico FASE 0 / 0B — Pools, PIN y Concurrencia de Stock (Provider/Booking)

**Fecha:** 2026-08-18
**Estado:** APROBADO (diagnóstico; sin implementación)
**Alcance:** bookingController.js — riesgo P0 pools/PIN + concurrencia stock en createBooking

---

## 1. Premisa original

El prompt de FASE 0 afirmaba que `bookingController.js` usa dos mecanismos de
conexión que "no comparten locks": pool `pg` crudo en la mayoría de funciones
(createBooking, startService, updateBookingStatus, cancelBooking, payBooking) y
`sequelize.transaction()` con `FOR UPDATE` sobre `productos` en
`exports.wompiWebhook` (~L561). Riesgo de oversell Citas↔Tienda, a resolver vía
`productService` compartido (T-101).

## 2. Evidencia encontrada (código verificado)

| Función | Mecanismo | ¿Toca `productos.stock`? |
|---|---|---|
| `createBooking` (L163) | `sequelize.transaction` | Solo **lectura sin lock** (L85-98) |
| `payBooking` (L465) | `sequelize.transaction` + **FOR UPDATE** | Sí (L492, L507) |
| `wompiWebhook` (L579) | `sequelize.transaction` + **FOR UPDATE** | Sí (L610, L625) |
| `startService`/`updateBookingStatus`/`cancelBooking`/`reviewCheck` | pool `pg` crudo | No |
| Tienda `orderController.createOrder` (L66) | pool `pg` crudo + **FOR UPDATE** + BEGIN/COMMIT | Sí (L106) |

- `productService`/T-101: **no existe** en `backend/src/` (grep exhaustivo).
- Los únicos dos escritores de stock en booking usan el **mismo** `sequelize`
  (config/database.js) → mismo pool. La tienda usa pool crudo **con FOR UPDATE**.
- Los locks `FOR UPDATE` de PostgreSQL son a nivel de base de datos: dos pools
  distintos **sí se serializan** entre sí sobre la misma fila.

## 3. Corrección de la premisa

1. La afirmación "payBooking usa pool pg crudo" es **incorrecta**: usa
   `sequelize.transaction` con FOR UPDATE.
2. El "mismatch de pools" **no produce oversell** entre payBooking y
   wompiWebhook (mismo mecanismo + FOR UPDATE), ni entre booking y tienda
   (ambos con FOR UPDATE → serialización a nivel BD).
3. **Decisión tomada: NO unificar pools.**
4. El PIN (L149) era `Math.floor(1000 + Math.random()*9000)` → **corregido a
   `crypto.randomInt(1000, 10000)`** (FASE 0, aplicado y verificado; sin otras
   regeneraciones de PIN de booking).

## 4. Riesgo real

**`createBooking` valida stock SIN lock y SIN transacción (L85-98), y no
reserva inventario al crear la cita** (INSERT con estado `PENDIENTE_PAGO`,
L163-201). El decremento ocurre recién en el pago (`payBooking`/webhook) o en
la tienda, siempre con FOR UPDATE.

Consecuencia: **N+1 solicitudes concurrentes de booking pueden validar y
crearse con stock = N** (todas ven `stock >= cantidad`). Solo N podrán pagar;
la booking N+1 queda `PENDIENTE_PAGO` inpagable ("Stock insuficiente" al
pagar). No hay stock negativo ni doble decremento (el FOR UPDATE + re-check lo
impide), pero sí **sobre-reserva de citas no pagables** (inconsistencia de
negocio reproducible).

## 5. Resultado de la prueba (PostgreSQL real, descartable)

Contenedor `postgis/postgis:16-3.4` descartable (PG 16.4), tablas mínimas
fieles a los paths reales (`productos`, `bookings`), patrón SQL exacto de los
controllers:

| Escenario | Resultado |
|---|---|
| A: stock=1, 2 createBooking concurrentes (validación sin lock) | **2 bookings creadas** (ambas vieron stock=1) → sobre-reserva |
| B: stock=1, 2 payBooking concurrentes (FOR UPDATE) | Sesión 2 bloqueada hasta COMMIT de sesión 1, vio stock=0, ROLLBACK (throw "Stock insuficiente"). stock final 0. **Sin oversell en pago** |
| C: stock=2, 3 createBooking + 3 payBooking | **3 bookings** creadas; **2 pagos OK, 1 rechazado** ("Stock insuficiente"); stock final 0, sin negativos |

**Veredicto: BUG CONFIRMADO (sobre-reserva reproducible)** — la validación
sin lock de createBooking permite N+1 bookings con stock N; el pago las
serializa pero la N+1 queda inpagable.

## 6. Decisión recomendada

(Requiere arbitraje — NO implementada en este diagnóstico.)

1. **Reservar stock en createBooking**: mover la validación + un
   `SELECT ... FOR UPDATE` (o `UPDATE ... SET stock = stock - qty WHERE stock >= qty
   RETURNING`) **dentro** de la transacción de creación (L163), o
   alternativa de diseño: reservar al crear (stock_pendiente) y confirmar en pago.
2. **Tratar el rechazo de pago por stock**: devolver el error de forma
   explícita (409) y cancelar la booking N+1 automáticamente, o permitir al
   cliente elegir otro producto.
3. Evaluar en otra fase: OTP (`authController.js:551`) y códigos
   (`paymentRoutes.js:23`) con `Math.random` → `crypto.randomInt`.

## Archivos tocados por el diagnóstico

- **Código:** solo `bookingController.js` (fix PIN, L149).
- **Docs:** este archivo. Ningún otro cambio productivo.
