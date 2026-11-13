# Plan de construcción — programa de puntos e invitaciones (E1–E5)

**Versión 1.0 — 2026-11-12.** Documento de ingeniería, no de estrategia. La arquitectura y el porqué de
cada regla están en `2026-11-12_arquitectura-programa-puntos.md` (se cita por código: `R-##`, `D-##`).
Nada de esto está escrito en el repo todavía.

Cada entrega se abre con la cadena literal `AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — REFERIDOS-E<n>`. Sin
esa cadena no se escribe código ni se hace push.

---

## 0. Reglas de trabajo que aplican a las cinco entregas

> **Entorno real, medido:** existe **un solo** entorno (`production`, proyecto Railway `glowapp`) y ese
> es el que auto-despliega con cada push a `main`. No hay staging. Por eso toda prueba de comportamiento
> se hace contra Postgres local levantado desde la cadena de migraciones, y la verificación en producción
> es de sólo lectura (`/api/health`, consultas de control). Crear pedidos de prueba en producción cuesta
> dinero real y no se hace sin autorización aparte.

1. **Reconocimiento primero.** `git rev-parse HEAD` y leer los archivos citados antes de tocar. Si algo
   del plan no coincide con el repo, se detiene y se reporta; el repo manda.
2. **TDD con mutación.** Test que falla → implementación → test que pasa → romper a propósito la
   implementación para comprobar que el test muerde → restaurar → commit atómico.
3. **Commit atómico por unidad.** Un commit por migración+servicio, otro por endpoint, otro por cliente.
   Nada de «varios arreglos» en un commit.
4. **Compuertas técnicas antes del push**, desde la raíz del repo:
   ```bash
   cd backend && JWT_SECRET=test-secret npx jest tests/<archivo>.test.js
   cd .. && python3 tools/verificar_contrato_api.py .
   bash backend/scripts/verificar-cadena-migraciones.sh      # TODO VERDE, Docker encendido
   MIGRACIONES_VERIFICADAS=1 git push                         # sólo si hay migración
   ```
5. **`flutter analyze` con 0 líneas `error -`**, contadas con `grep -ciE " error - "` (el prefijo puede
   venir con espacio).
6. **Reporte con E0/E1/E2** y la tabla de comandos. Sin comando no hay afirmación.

Dos trampas que ya costaron tiempo en este repo y que este plan esquiva por diseño:

- El verificador de migraciones se corre **desde la raíz**, no desde `backend/`.
- Existe el guard `tests/migrationsNoDuplicateNumbers.test.js`: el número `142` y los siguientes tienen
  que ser únicos en `backend/migrations/`. Antes de crear una migración se corre ese test.

---

## E1 — Libro de puntos (sin interfaz)

**Cierra cuando:** se puede decir cuántos puntos tiene cada usuaria, de qué origen y hasta cuándo vale
cada lote, y el saldo se calcula sin sumar historia. No hay canje todavía.

### E1.1 Migración `142_puntos_libro.sql`

Dos tablas nuevas. No llevan `tenant_id`, igual que `xp_logs`: son de la persona, no del negocio, y por
eso **no** se les activa RLS (las tablas con RLS son las de 120 y éstas no están en esa lista).

`points_lots` — una fila por acreditación:

| Columna | Tipo | Regla |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `user_id` | INTEGER NOT NULL | FK `usuarios(id) ON DELETE CASCADE` |
| `puntos` | INTEGER NOT NULL | `CHECK (puntos > 0)` |
| `puntos_restantes` | INTEGER NOT NULL | `CHECK (puntos_restantes >= 0 AND puntos_restantes <= puntos)` |
| `origen` | VARCHAR(40) NOT NULL | `referido:compra`, `referido:bienvenida`, `referido:compra:legacy`, `ajuste:manual` |
| `referencia_id` | TEXT | id del pedido (UUID como texto) o del `xp_logs` histórico |
| `motivo` | VARCHAR(255) | texto para la vista de la usuaria |
| `creado_en` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |
| `vence_en` | TIMESTAMPTZ NOT NULL | `creado_en + 12 months` (R-10 del programa) |

- Índice único parcial `(origen, referencia_id) WHERE referencia_id IS NOT NULL`: una compra referida
  acredita una sola vez (R-02).
- Índice `(user_id, vence_en)` para el saldo y el consumo FEFO.
- `CHECK (vence_en > creado_en)`.

`points_movements` — el rastro de cada transición, con clave de idempotencia propia:

| Columna | Tipo | Regla |
|---|---|---|
| `id` | UUID PK | |
| `lot_id` | UUID NOT NULL | FK `points_lots(id) ON DELETE RESTRICT` |
| `user_id` | INTEGER NOT NULL | FK `usuarios(id) ON DELETE CASCADE` |
| `pedido_id` | UUID | FK `pedidos_tienda(id) ON DELETE SET NULL` |
| `tipo` | VARCHAR(20) NOT NULL | `CHECK (tipo IN ('compromiso','consumo','liberacion','reversion','vencimiento','ajuste'))` |
| `puntos` | INTEGER NOT NULL | **siempre positivo**; el signo lo pone el tipo (ver tabla de efectos) |
| `clave` | VARCHAR(120) NOT NULL UNIQUE | idempotencia explícita |
| `motivo` | VARCHAR(255) | |
| `creado_en` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |

Tabla de efectos — esto es el contrato del servicio, y va escrito en el comentario de la migración:

| `tipo` | Efecto sobre `puntos_restantes` | Cuándo |
|---|---|---|
| `compromiso` | resta | al crear el pedido que usa puntos |
| `consumo` | **no cambia** | al confirmarse el pago: convierte la espera en gasto |
| `liberacion` | suma | pedido cancelado o vencido a las 24 h |
| `reversion` | suma | reembolso del pedido que originó el lote |
| `vencimiento` | resta hasta cero | sólo el job de reporte, nunca para calcular el saldo |
| `ajuste` | suma o resta | corrección manual con motivo |

Claves de idempotencia que usará el servicio:
`ref:<order_id>:credito` · `canje:<pedido_id>:compromiso:<lot_id>` · `canje:<pedido_id>:consumo:<lot_id>` ·
`canje:<pedido_id>:liberacion:<lot_id>` · `venc:<lot_id>`.

> Por qué una `clave` y no `UNIQUE(pedido_id, tipo)`: un canje puede consumir dos lotes y entonces hay
> dos filas de compromiso para el mismo pedido. La clave por `lot_id` permite eso y sigue siendo
> idempotente fila por fila.

### E1.2 Backfill del historial

Los puntos que ya existen viven en `xp_logs` con `reason = 'referido:compra'` (uno por conversión, 500
cada uno). La migración los convierte en lotes para que nadie pierda saldo al cambiar de libro:

```sql
INSERT INTO points_lots (user_id, puntos, puntos_restantes, origen, referencia_id, motivo, creado_en, vence_en)
SELECT user_id, xp_amount, xp_amount, 'referido:compra:legacy',
       id::text, 'Premio de referidos (histórico)', created_at, created_at + INTERVAL '12 months'
  FROM xp_logs
 WHERE reason = 'referido:compra' AND xp_amount > 0;
```

Idempotente por el índice único `(origen, referencia_id)`. **No se borran** las filas de `xp_logs`: son
el historial de estado y siguen sumando XP de nivel.

Fuera del backfill: los asientos negativos del viejo canje a cashback (no son acreditaciones) y los XP de
compartir (son estado, no dinero).

### E1.3 Servicio `backend/src/services/pointsService.js`

Funciones, todas con `pool` inyectable (mismo patrón que `referralService`):

| Función | Qué hace |
|---|---|
| `acreditar({ userId, puntos, origen, referenciaId, motivo, venceEn, pool })` | crea lote; `ON CONFLICT (origen, referencia_id) DO NOTHING`; devuelve `{ acreditado, lotId }` |
| `saldo({ userId, pool })` | `SUM(puntos_restantes)` de lotes con `vence_en > NOW()`; más `porVencer` (próximos 30 días) y `enEspera` |
| `comprometer({ userId, pedidoId, puntos, pool })` | dentro de transacción del llamador: selecciona lotes `FOR UPDATE ORDER BY vence_en ASC` (FEFO), resta, escribe movimientos; devuelve el desglose por lote |
| `consumir({ pedidoId, pool })` | marca los compromisos del pedido como consumo (no mueve saldo) |
| `liberar({ pedidoId, pool })` | devuelve a cada lote lo comprometido y no consumido |
| `revertir({ origen, referenciaId, pool })` | devuelve al lote de origen hasta lo que quede |
| `lotesDe({ userId, pool })` | lista para la app: puntos, restantes, vence_en |

Reglas duras del servicio, cada una con su test:

- Nunca deja `puntos_restantes` negativo (R-02 del §4 del doc de arquitectura).
- `saldo` no cuenta lo vencido ni lo comprometido.
- `comprometer` con saldo insuficiente lanza un error tipado (`SALDO_INSUFICIENTE`), no devuelve 0.
- Todo dentro de la transacción del llamador: el servicio **no** abre `BEGIN` propio cuando recibe un
  cliente ya transaccionado (mismo criterio que `acreditarCompraReferida` con el webhook).

### E1.4 Refactor de `referralService.js`

`acreditarCompraReferida` deja de escribir en `xp_logs` y llama a `pointsService.acreditar` con
`origen='referido:compra'`, `referencia_id=orderId`. Mantiene la firma, el `try/catch` best-effort y el
`UNIQUE(invitee_user_id)` de `referral_conversions`. Añade la bienvenida de la invitada (D-02) en la
misma transacción: lote de 100 puntos con `origen='referido:bienvenida'`, `referencia_id=inviteeId`.

### E1.5 Endpoint `GET /api/rewards/points`

Nuevo archivo `backend/src/routes/rewardsRoutes.js` y `rewardsController.js`; se monta en `index.js`
junto a `/api/xp-logs`. `authMiddleware` obligatorio; `X-App-Audience` lo exige el middleware global de
`/api` que ya está montado.

Respuesta (R-08/R-09/R-10 fijadas por decisión):

```json
{
  "saldo": 1200,
  "en_espera": 0,
  "valor_punto_cop": 10,
  "bloque_canje": 100,
  "tope_porcentaje": 15,
  "minimo_pedido": 25000,
  "saldo_en_pesos": 12000,
  "por_vencer": [{ "puntos": 500, "vence_en": "2027-11-12T00:00:00Z" }]
}
```

Sin sesión → 401. Usuaria sin puntos → 200 con `saldo: 0` (no es un error).

### E1.6 Tests

| Archivo | Qué prueba | Cómo |
|---|---|---|
| `backend/tests/pointsService.test.js` | acreditar calcula `vence_en` a 12 meses; idempotencia por origen+referencia; saldo excluye vencidos y comprometidos; `comprometer` es FEFO; saldo insuficiente lanza `SALDO_INSUFICIENTE`; nunca deja restantes negativos | pool simulado, se inspecciona el SQL y los parámetros |
| `backend/tests/referralService.test.js` (existente) | el premio ahora crea lote y **no** escribe `referido:compra` en `xp_logs`; la bienvenida se acredita una sola vez | se actualiza al nuevo contrato |
| `backend/tests/pointsLedger.integration.test.js` | FEFO real y concurrencia: dos compromisos simultáneos con el mismo saldo, uno gana; los lotes se consumen del que vence antes | Postgres real vía `DATABASE_URL_ADMIN`, con `describe.skip` cuando no hay base (patrón de `rlsPoliticasSinContexto.test.js`) |

Mutaciones obligatorias para comprobar que los tests muerden: cambiar `12 months` por `12 days` (debe
fallar el test de vencimiento), quitar `ON CONFLICT` (debe fallar el de idempotencia), invertir el
`ORDER BY vence_en` (debe fallar el de FEFO).

### E1.7 Compuertas y despliegue

```bash
cd backend && JWT_SECRET=test-secret npx jest tests/pointsService.test.js tests/referralService.test.js
JWT_SECRET=test-secret npx jest tests/migrationsNoDuplicateNumbers.test.js
cd .. && python3 tools/verificar_contrato_api.py .
bash backend/scripts/verificar-cadena-migraciones.sh
MIGRACIONES_VERIFICADAS=1 git push
```

Después del despliegue automático: `curl /api/health` y confirmar que el campo `commit` es el nuevo.
E1 **no** cambia lo que ve la usuaria: si algo se rompe, se rompe en el backend.

Riesgo principal y su mitigación: el backfill. Se comprueba con una consulta de control antes y después
(`SELECT SUM(xp_amount) FROM xp_logs WHERE reason='referido:compra'` contra
`SELECT SUM(puntos) FROM points_lots`) y debe coincidir exactamente.

---

## E2 — Canje en el checkout (backend)

**Cierra cuando:** un pedido puede pagarse con puntos, el total baja exactamente lo prometido, la
factura cuadra y un carrito abandonado devuelve los puntos a las 24 h.

### E2.1 Migración `143_canje_puntos_pedido.sql`

```sql
ALTER TABLE pedidos_tienda ADD COLUMN IF NOT EXISTS descuento NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE pedidos_tienda ADD COLUMN IF NOT EXISTS puntos_canjeados INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pedidos_tienda ADD CONSTRAINT pedidos_tienda_descuento_positivo CHECK (descuento >= 0);
```

`descuento` **no existe hoy** (anexo A1 del doc de arquitectura): `orderController.js:1140` ya la lee y
la convierte en cero con `|| 0`. Esta migración es la que hace que la factura diga la verdad. Si la
restricción ya existiera con otro nombre, se usa `IF NOT EXISTS` sobre el índice y se documenta.

### E2.2 `createOrder` acepta `puntos_a_canjear`

Cambios en `backend/src/controllers/orderController.js`, dentro de la transacción que ya existe:

1. Leer `puntos_a_canjear` del body (entero, opcional, default 0).
2. Con `totalProductos = subtotal + iva` ya calculado: si `puntos_a_canjear > 0` y
   `totalProductos < 25000` → 400 «El pedido mínimo para usar puntos es $25.000».
3. Tope: `descuentoMaximo = floor(totalProductos * 0.15)`; `puntosMaximos = floor(descuentoMaximo / 10)`
   redondeado hacia abajo a múltiplo de 100. Si lo pedido excede, **se aplica el máximo, no se rechaza**
   (decisión de UX del §14: aplicar el máximo es más útil que un error).
4. `descuento = puntosAplicados / 10`. El descuento reduce el precio con IVA incluido, así que se
   recalcula el desglose para que la factura siga cuadrando:
   `precioFinal = totalProductos - descuento`, `subtotal = precioFinal / 1.19`, `iva = precioFinal - subtotal`.
   El envío **no** se descuenta.
5. `pointsService.comprometer` con el cliente transaccionado. Si no hay saldo → 400 con el saldo actual.
6. INSERT del pedido con `descuento`, `puntos_canjeados`, `subtotal`, `iva`, `total` ya ajustados.

`payOrder` no cambia: ya toma `expectedAmount = parseFloat(order.total)` de la base (anexo A9), así que
la pasarela cobra el total descontado sin que el cliente pueda alterarlo.

### E2.3 Ciclo del pedido

| Punto del código | Cambio |
|---|---|
| webhook Wompi, rama `PAGADO` (`orderController.js` ~948-990) | añadir `pointsService.consumir({ pedidoId })` junto a `acreditarCompraReferida` |
| `cancelOrder` (~1304) | `pointsService.liberar({ pedidoId })` antes del COMMIT |
| `payOrder` sobre pedido vencido | ya rechaza por estado; el job lo cancela a las 24 h |
| job nuevo en `src/jobs/paymentJobs.js` | cada hora: pedidos `PENDIENTE_PAGO` con `puntos_canjeados > 0` y más de 24 h → cancelar y liberar. `DISABLE_BACKGROUND_JOBS=true` lo desactiva en CI |

### E2.4 Modificación del endpoint de cotización

`POST /api/store/envio/cotizacion` (existe, sólo lectura) devuelve además `puntos_disponibles`,
`descuento_maximo` y `total_con_descuento` cuando se le pasa `puntos_a_canjear`. Así el checkout muestra
el número del servidor y no uno calculado en el cliente (la app ya confía en este endpoint para el envío).

### E2.5 Tests

| Archivo | Qué prueba |
|---|---|
| `backend/tests/rewardsCanje.test.js` (nuevo) | tope del 15% aplicado hacia abajo en bloques de 100; mínimo de $25.000; total exacto; 401 sin sesión; 409 al canjear dos veces sobre el mismo pedido; 400 con saldo insuficiente |
| `backend/tests/rewardsCanje.integration.test.js` (nuevo) | con Postgres real: dos peticiones concurrentes, una gana y el saldo no queda negativo; los puntos quedan en espera al crear y se consumen al pagar |
| `backend/tests/storeWebhook.contract.test.js` (existente) | el webhook sigue siendo idempotente **y** ahora consume el canje una sola vez |
| `backend/tests/orderController.test.js` (existente) | el pedido sin puntos conserva exactamente los valores de antes (no hay regresión) |
| `backend/tests/storeOrderIva.test.js` (existente) | base + IVA + envío − descuento = total |

Mutaciones: quitar el tope (debe fallar el test del 15%), no recalcular el IVA (debe fallar el de la
factura), no llamar a `liberar` en la cancelación (debe fallar el de los 24 h).

### E2.6 Criterio de factura

El invariante que se verifica en test y en la consulta de control después del despliegue:

```
subtotal + iva + envio - descuento = total      (|error| < 0.01)
```

Y para pedidos sin puntos, `descuento = 0` y los valores idénticos a los de hoy.

---

## E3 — Interfaz del cliente

**Cierra cuando:** la clienta ve su saldo real, lo aplica en el checkout, entiende cuánto le queda y las
condiciones están escritas y enlazadas. Incluye republicar la web.

### E3.1 Archivos

| Archivo | Cambio |
|---|---|
| `packages/glow_core/lib/src/services/rewards_service.dart` (nuevo) | `obtenerPuntos()`, `canjear()`, modelos `SaldoPuntos` y `ResultadoCanje`; mismo patrón de errores que los servicios existentes |
| `apps/glow_client/lib/screens/store_screen.dart` (~líneas 900-940, resumen del pedido) | bloque nuevo: «Tienes N puntos = $X», selector en bloques de 100, aviso cuando el tope recorta, y el total recalculado **desde el servidor** |
| `apps/glow_client/lib/screens/rewards_xp_screen.dart` (línea 105: «350 XP» fijo) | saldo real; dos tarjetas separadas: **Nivel (XP)** y **Puntos ($)**, con fecha de próximo vencimiento |
| `apps/glow_client/lib/screens/invite_friends_screen.dart` | marcador real (invitadas, convertidas, puntos), enlace a condiciones |
| `apps/glow_client/lib/screens/programa_puntos_screen.dart` (nuevo) | condiciones publicadas: monto, condición de compra, topes, vencimiento, canje (R-19/R-20) |
| `apps/glow_client/lib/main.dart` | ruta `/programa-puntos` |

Nada de esto cambia el flujo de pago existente cuando el saldo es 0: el bloque no aparece y el checkout
se comporta como hoy.

### E3.2 Verificación

```bash
cd apps/glow_client && flutter analyze | grep -ciE " error - "     # debe dar 0
flutter test test/store_canje_test.dart                            # nuevo
flutter test test/rewards_saldo_test.dart                          # nuevo
```

En los tests, `setSurfaceSize` **dentro** del `testWidgets` y superficie alta (1080×2400): el resumen del
pedido no cabe en 800×600 y el test falla por recorte, no por lógica.

### E3.3 Publicación

```bash
bash scripts/desplegar-web.sh glow_client glowapp-client production
```

Verificación de que se publicó de verdad, no de que el script no falló:
`md5` del bundle local contra el remoto, y `grep` de una cadena nueva en `main.dart.js` descargado. Hoy
el bundle publicado sigue diciendo «$10.000 COP de regalo» (anexo A6): la cadena que se busca es
«por cada amiga que compre» y el número «15%» o el texto de condiciones.

---

## E4 — Medición y control

**Cierra cuando:** se puede responder cuántos clics, cuántos registros atribuidos, cuántas conversiones y
cuántos canjes hubo en el mes, y el sistema frena el abuso obvio sin intervención.

| Pieza | Dónde |
|---|---|
| `144_referral_clicks.sql`: tabla `referral_clicks(id, codigo, ip_hash, user_agent_hash, creado_en)` | migración |
| `GET /r/:codigo` público: cuenta y redirige a `/#/register?ref=CODIGO` | ruta nueva, fuera de `/api`, sin `authMiddleware` |
| Tope de 10 premios por mes calendario (Bogotá) dentro de `acreditarCompraReferida` | `referralService.js` |
| Marca por IP/dispositivo compartido: la conversión se registra con `estado='EN_REVISION'` y no acredita | `referralService.js` + columna en `referral_conversions` |
| `GET /api/rewards/reporte` (admin) | emitido, canjeado, vencido, vivo |
| Job de aviso a 30 días del vencimiento | `paymentJobs.js` |

La revisión manual necesita su vista mínima (lista, motivo, aprobar/rechazar) o el antifraude es una
tabla que nadie mira.

---

## E5 — Niveles y desbloqueo de servicios

**Cierra cuando:** una clienta ve su nivel, sabe qué le falta para el siguiente y una función de IA
responde 403 con motivo cuando el nivel no alcanza — probado en el servidor, no sólo escondido en la UI.

| Pieza | Dónde |
|---|---|
| `145_feature_usage.sql`: `feature_usage(user_id, funcion, periodo, usos)` con `UNIQUE(user_id, funcion, periodo)` | migración |
| `nivelService.js`: XP acumulado → nivel (`glow`/`petalo`/`oro`/`diamante`), umbrales en un solo archivo de configuración | servicio nuevo |
| `requiereNivel('oro')` y `requiereCuota('nia_analisis')` | middleware nuevo |
| Montaje en `/api/v1/beauty-scan`, `/api/nia-beauty`, `/api/biometric/analyze` | `index.js` |
| Pantalla de nivel y catálogo de servicios bloqueados | cliente |
| Acreditación de XP por reserva completada y reseña verificada | `bookingController` / `reviews` |

Piloto: **una sola función** (recetas GlowStore) durante dos semanas antes de abrir el catálogo. Si el
piloto no mueve el uso, el problema es el beneficio, no el código.

Ajuste obligatorio antes de fijar cuotas: medir el costo unitario de una llamada a Gemini y al
`ai-worker`. Sin ese número, las cuotas son una adivinanza (§17.1, principio 5).

---

## 6. Orden, dependencias y qué se puede paralelizar

```
E1 ──> E2 ──> E3 ──> E4
        │
        └──> E5 (sólo comparte los endpoints de IA; puede ir en paralelo con E2/E3 si hay manos)
```

- **E1 bloquea todo.** Sin libro no hay canje ni saldo.
- **E2 no necesita E3** para probarse: se valida con `curl` y con tests.
- **E3 no puede empezar antes de E2**: la UI necesita el endpoint y el tope reales.
- **E4 y E5 son independientes** del dinero y pueden solaparse, pero compiten por el mismo equipo.

Estimación gruesa, en jornadas de una persona con el repo ya entendido: E1 3-4 · E2 4-5 · E3 3-4 ·
E4 2-3 · E5 3-4. La incertidumbre está en E2 (el IVA del descuento) y en E5 (el costo de la IA).

---

## 7. Lo que este plan no toca

- La ruta DIAN (`generarFacturaDianPedido`) más allá de que `descuento` exista: sus otras columnas
  fantasma (`cargo_envio`, `precio_unitario`) son deuda preexistente y necesitan su propia autorización
  (anexo A2).
- `xp_logs` como libro de estado, `user_levels`, insignias y `convert-cashback` más allá de apagarlo
  (D-03): se apaga, no se borra.
- El flujo de reservas, pagos de servicios y payouts de prestadoras.
- Cualquier forma de multinivel, retiro de dinero o puntos transferibles.

---

## 8. Evidencia que se entrega al cerrar cada fase

| Entrega | Tabla de evidencia mínima |
|---|---|
| E1 | salida de Jest (tests nuevos + existentes), `verificar-cadena-migraciones.sh` en TODO VERDE, `commit` nuevo en `/api/health`, y el control de suma `xp_logs` vs `points_lots` |
| E2 | tests de canje; invariante de factura verificado sobre la base que arma `verificar-cadena-migraciones.sh` con un pedido descontado de prueba (no hay entorno de staging: producción es el único Railway); consulta de control sobre pedidos reales; y `curl` mostrando 401/400/409 |
| E3 | `flutter analyze` con 0 errores, tests de widget, `md5` local vs remoto y la cadena nueva encontrada en el bundle publicado |
| E4 | reporte mensual con las cuatro cifras y un clic real verificado |
| E5 | 403 del servidor con el nivel insuficiente, cuota agotada, y el costo medido por llamada de IA |

Cada fila lleva **E0** (comando ejecutado y su salida) o **E1** (inferido, con el motivo). Ninguna
afirmación sin comando.
