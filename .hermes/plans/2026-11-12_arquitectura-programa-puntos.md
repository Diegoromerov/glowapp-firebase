# Arquitectura del programa de puntos e invitaciones de GlowApp

**Versión 0.2 — 2026-11-12. Las decisiones D-01 a D-11 quedan APROBADAS por el Director tal como se
recomiendan.** Nada de esto está implementado todavía: el documento fija la arquitectura, no el código.
Base medida: repo `Diegoromerov/glowapp-firebase`, HEAD `344ac913` (= commit que sirve producción hoy).

> **Decisión de alcance:** los puntos que se ganen por reservar, reseñar o navegar **no** entran en
> esta fase. Se diseñan aparte en §16, para revisarlos cuando el canje del programa actual esté cerrado
> y medido.

---

## 0. Cómo leer esto

Describe el programa completo en lenguaje natural, de punta a punta. Cada afirmación normativa lleva un
código `R-##` (regla) y cada punto que necesita tu decisión lleva `D-##` (decisión). Corrige por
referencia: «R-06 mal, el tope es 15%» funciona mejor que reescribir el párrafo.

El orden es: qué es el programa → cómo se comporta un punto en el tiempo → dónde vive el dinero →
las reglas → la economía con números reales → lo que ve la usuaria → los casos raros → medición →
qué se reutiliza y qué se crea → tus decisiones → criterios de aceptación → orden de construcción.

---

## 1. El programa en una frase

Una clienta comparte GlowApp con su círculo; cuando **una de sus invitadas paga su primer pedido de
productos**, la que invitó recibe un fondo de puntos que **sólo** puede gastar como descuento en el
catálogo de GlowShop. La plataforma nunca entrega dinero: entrega margen de su propio catálogo.

Los cinco campos que definen cualquier programa de incentivo:

| Campo | Definición |
|---|---|
| Quién paga | GlowApp, con margen de catálogo. No hay caja, no hay Wompi, no hay saldo retirable. |
| A quién | A la **referente** (la que invita). La invitada recibe algo simbólico (D-02). |
| Cuánto | 500 puntos = $5.000 de valor de catálogo, por invitada que compre. |
| Cuándo | Cuando el pedido de la invitada queda en estado `PAGADO`. Nunca al registrarse, nunca al reservar. |
| Dónde se gasta | Descuento en el checkout de GlowShop, con tope por pedido. |

Lo que el programa **no** es: un programa de puntos de fidelidad general (los puntos no se ganan por
reservar, por reseñar ni por navegar), ni un monedero, ni un sistema multinivel.

---

## 2. Vocabulario vinculante

Los roles se confunden con facilidad y confundirlos cambia el programa entero.

- **Referente / invitadora**: quien comparte su código. Cobra.
- **Invitada / referida**: quien se registra con el código. Compra; no cobra por comprar.
- **Punto**: unidad de cuenta del fondo. **1 punto = $10.** Se canjea en bloques de 100 puntos ($1.000).
- **Lote**: cada acreditación, con su propia fecha de vencimiento y su propio saldo restante.
- **Saldo disponible**: puntos de lotes vigentes que no están comprometidos.
- **En espera**: puntos comprometidos en un pedido que todavía no se pagó.
- **Canje**: uso de puntos como descuento en un pedido concreto.
- **Efecto red**: la invitada, al registrarse, obtiene su propio código y puede invitar. Es de un solo
  nivel: la referente original no cobra nada por las invitadas de su invitada.

Corrección al documento de traspaso: el campo `puntos_por_peso: 100` es ambiguo y se presta a
implementar mal. La relación correcta se expresa como **`valor_punto_cop: 10`** y
**`bloque_canje: 100`**. Con eso, 500 puntos = $5.000 y 100 puntos = $1.000, sin interpretación.

---

## 3. El ciclo de vida de un punto (la decisión central)

El traspaso propone que canjear escriba un asiento negativo y listo. Eso **pierde puntos**: si la
clienta aplica 500 puntos, no paga, y el pedido se abandona, los puntos ya volaron y el reclamo es
indefendible. Un punto no tiene dos estados (tengo / no tengo), tiene seis:

1. **Devengado**: la invitada pagó; nace un lote con 500 puntos y fecha de vencimiento.
2. **Disponible**: el lote está vigente y no comprometido.
3. **En espera**: la clienta lo aplicó a un pedido que aún está `PENDIENTE_PAGO`.
4. **Consumido**: el pedido se pagó; el punto se gastó de verdad.
5. **Liberado**: el pedido se canceló o venció sin pagarse; el punto vuelve íntegro a disponible.
6. **Vencido**: pasaron 12 meses sin usarse; deja de contar para el saldo y se reporta como pasivo
   extinto.

**Regla de oro (R-00): los puntos se comprometen al crear el pedido y se consumen al pagarse.**
Comprometer no es gastar. Esto separa «tengo saldo» de «estoy usando saldo» y es lo que evita que un
carrito abandonado se coma el premio.

---

## 4. Dónde vive el dinero

### 4.1 La decisión (D-01)

Hoy el único libro de puntos es `xp_logs` (migración 023: `id, user_id, xp_amount, reason, metadata,
created_at`) y el saldo se calcula como `SUM(xp_amount)`. El premio de referidos ya escribe ahí.

**Opción A — reutilizar `xp_logs` como libro del dinero.** Cero infraestructura nueva, el saldo ya
funciona con asientos negativos, el premio ya escribe ahí. Problemas: no tiene clave de idempotencia
por pedido (un reintento del cliente gasta dos veces), no tiene vencimiento, mezcla **estado** (XP de
nivel) con **dinero** (pesos canjeables), y no puede responder «cuánto vence y cuándo», que es
exactamente lo que se necesita para provisionar el pasivo. El endpoint viejo que convierte XP en saldo
retirable también lee esa misma suma.

**Opción B — libro propio del fondo de puntos (recomendada).** Dos tablas nuevas y `xp_logs` queda
intacto para lo que ya hace (niveles, insignias, gamificación):

- **`points_lots`** — las acreditaciones. Una fila por premio: `user_id`, `puntos`, `puntos_restantes`,
  `origen` (`referido:compra`, `referido:bienvenida`, `ajuste:manual`), `referencia_id` (el pedido que
  lo causó), `creado_en`, `vence_en`. Clave única por `(origen, referencia_id)`: una compra referida
  acredita una sola vez, y esa restricción vive en la base, no en el código.
- **`points_movements`** — los movimientos. `lot_id`, `pedido_id`, `puntos`, `tipo`
  (`compromiso`, `consumo`, `liberacion`, `vencimiento`, `reversion`), `creado_en`, `motivo`.
  Clave única por `(pedido_id, tipo)`: un pedido no compromete dos veces.

Con eso:

- **Saldo disponible** = `SUM(puntos_restantes)` de lotes con `vence_en > now()`. Una sola consulta,
  sin sumar historia.
- **En espera** = movimientos de tipo `compromiso` sin `consumo` ni `liberacion`. Es informativo, no
  se suma al saldo (los puntos ya salieron de `puntos_restantes`).
- **Vencimiento** = una condición, no un proceso: lo vencido simplemente no cuenta. El trabajo
  periódico sólo sirve para reportar y para avisar antes de que venza.
- **Consumo sin doble gasto** = `SELECT ... FOR UPDATE` sobre los lotes dentro de la misma transacción
  del pedido. Dos pestañas abiertas no pueden gastar el mismo punto.
- **Reversión** = si hay que devolver un premio, se devuelve a `puntos_restantes` del lote de origen,
  hasta lo que quede. Nunca se muestra saldo negativo.

Costo de la Opción B: dos tablas y un servicio de ~250 líneas con tests. A cambio, el dinero tiene
libro propio, auditoría por lote, vencimiento real y clave de idempotencia. La Opción A sale más
barata hoy y se paga después con un incidente de doble gasto o una provisión que nadie puede calcular.

### 4.2 Qué NO se toca

`xp_logs`, `socialController.log-share`, `user_levels` y las insignias siguen como están. El canje de
puntos **no** resta XP ni puede bajar de nivel a nadie (R-14).

---

## 5. Reglas del programa

### 5.1 Acreditación

- **R-01.** El premio nace únicamente de un pedido de la invitada que llegó a `PAGADO`. El disparador
  es el webhook de Wompi, en el mismo punto donde hoy ya se llama `acreditarCompraReferida`.
- **R-02.** Un pedido acredita una sola vez, garantizado por `UNIQUE(origen, referencia_id)` en
  `points_lots`. Un reintento del webhook no duplica.
- **R-03.** El premio es de la referente. La invitada no cobra por comprar; al registrarse obtiene su
  propio código y pasa a ser referente de otras (efecto red de un solo nivel).
- **R-04.** Un solo nivel. Prohibido pagar por la actividad de las invitadas de la invitada.
- **R-05.** Tope de **10 conversiones premiadas por referente por mes calendario** (mes en hora de
  Bogotá). La conversión 11 del mes se registra igual, con 0 puntos y motivo `tope_mensual`, para no
  perder la traza ni el dato.
- **R-06.** Si el pedido que generó el premio se reembolsa dentro de los 30 días siguientes, el premio
  se revierte sobre el lote de origen hasta lo que quede sin gastar. Si ya se gastó, se marca para
  revisión manual y no se descuenta nada a la usuaria (nunca saldo negativo).

### 5.2 Canje

- **R-07.** El canje aplica **sólo a productos** de GlowShop. No aplica a reservas de servicio, ni al
  envío, ni a propinas (D-05).
- **R-08.** El descuento máximo por pedido es el **15% del valor de los productos con IVA incluido**
  (es decir, `subtotal + iva` del pedido), nunca del total que incluye envío (D-06, aprobada; ver §6
  para el porqué del 15% y no del 20%).
- **R-09.** El canje va en bloques de 100 puntos ($1.000). Se redondea hacia abajo: si el 15% de un
  pedido de $25.000 permite $3.750, se aplican 300 puntos ($3.000), no 375.
- **R-10.** Pedido mínimo para usar puntos: **$25.000 de productos** (D-04, aprobada). Por debajo, el
  bloque «pagar con puntos» no aparece y el backend responde 400 si se intenta. Consecuencia directa:
  en el mínimo se gastan 300 de los 500 puntos del premio; para gastar el premio entero hace falta un
  pedido de $33.334 o más. La app debe decir cuánto queda, no ocultarlo.
- **R-11.** Los puntos se comprometen dentro de la transacción que crea el pedido, con bloqueo de fila.
  El precio que se cobra en Wompi es el `total` del pedido ya descontado, leído de la base
  (`payOrder` ya toma `expectedAmount` de `pedidos_tienda.total`; no confía en el cliente).
- **R-12.** Un pedido no puede canjear dos veces. Crear un pedido con puntos y volver a canjear sobre
  él responde **409**.
- **R-13.** El descuento queda escrito en el pedido (`descuento`, `puntos_canjeados`). Hoy la columna
  `descuento` **no existe** (ver anexo A): hay que crearla o la factura y el detalle del pedido siguen
  mostrando cero.
- **R-14.** El canje no toca `xp_logs`, ni el nivel, ni el saldo del monedero de la prestadora.
- **R-15.** Nada de dinero: sin retiro, sin abono a Wompi, sin transferencia entre usuarias.

### 5.3 Ciclo del pedido

- **R-16.** Pedido `PENDIENTE_PAGO` con puntos comprometidos: si se cancela, o si pasan 24 horas sin
  pago, los puntos se liberan automáticamente (job reutilizando `paymentJobs`).
- **R-17.** Pedido pagado y luego reembolsado: se devuelven los puntos usados y se reembolsa **sólo el
  dinero efectivamente cobrado**. Nunca las dos cosas: sería devolver dos veces.
- **R-18.** Pedido despachado o entregado: no se devuelven puntos por devolución posterior; se maneja
  como garantía, no como canje.

### 5.4 Veracidad del mensaje

- **R-19.** El texto que se comparte no puede prometerle a la invitada un premio que la invitada no
  cobra. Hoy dice «Gana $5.000 COP por cada amiga que compre», en boca de la referente: correcto. Si
  se aprueba D-02, se añade la línea del beneficio de la invitada.
- **R-20.** El monto que aparece en pantalla debe ser el vigente. La web publicada hoy sigue mostrando
  «$10.000 COP de regalo» (anexo A). Publicar el programa sin republicar el cliente es prometer un
  monto que el backend ya no paga.
- **R-21.** El crédito se promete como **valor en puntos**, no como descuento de una sola compra:
  «hasta $5.000 en puntos», no «$5.000 de descuento en tu próxima compra». Con tope del 15%, un
  premio de 500 puntos entra completo a partir de un pedido de $33.334; por debajo, la app dice
  cuántos puntos caben en **este** pedido y cuántos quedan para el siguiente (D-13).

---

## 6. Economía con los números reales del catálogo

Medido hoy contra producción: 8 productos visibles, precios de $18.000 a $89.000, **mediana $50.000**,
media $52.625, con IVA incluido. El envío es aparte y no se descuenta.

**Lo que cuesta un peso de descuento.** El precio de lista incluye IVA (19%) y el costo de compra es
el precio prestador, 65% de la lista (migración 010; lo tomo como supuesto, E1). Sobre un pedido de
$50.000: base $42.017, IVA $7.983, costo $32.500, **margen neto $9.517 (19,0% de la lista)**.

Cada peso de descuento reduce el precio y, con él, el IVA que se causa: **cuesta $0,84 de margen, no
$1,00**. De ahí:

| Descuento aplicado | Margen que queda (pedido de $50.000) |
|---|---|
| 0% | $9.517 (19,0%) |
| 10% (un premio de 500 puntos) | $5.315 (10,6%) |
| **15% (tope aprobado)** | **$3.214 (6,4%)** |
| 20% (tope original del traspaso, descartado) | $1.114 (2,2%) |

**El tope del 20% que proponía el traspaso dejaba el pedido con 2,2% de margen: no pierde, pero vende
al borde.**
En el producto más barato ($18.000) el 20% son $3.600 y el margen cae a **$401**; con el **15%
aprobado (D-06)** el descuento máximo son $2.700 y el margen queda en **$1.157** — casi el triple.

Con el mínimo de **$25.000 (D-04)** y el tope del 15% conviven dos cosas que la app tiene que explicar
sin rodeos: en el mínimo se aplican 300 puntos ($3.000) y sobran 200; para gastar un premio completo de
500 puntos hace falta un pedido de **$33.334** o más. En el pedido mediano de $50.000 el premio entra
entero y el margen baja a $5.315.

**Costo por clienta adquirida.** 500 puntos = $5.000 de valor de catálogo ≈ **$4.202 de margen** si se
canjea en un pedido mediano. La primera compra de esa invitada deja $9.517 de margen. Conclusión: **el
programa se autofinancia** siempre que el canje ocurra sobre un pedido de $25.000 o más; si la invitada
compra lo más barato y canjea al tope, la adquisición queda en cero.

**Pasivo.** Los puntos emitidos y no canjeados son una obligación latente: 0,84 × valor nominal. Con
tope de 10 premios por mes y por referente, el techo por usuaria es 5.000 puntos ($50.000 de catálogo,
~$42.000 de margen por mes). El reporte mensual de emisión, canje y vencimiento no es un adorno
contable: es lo único que impide que el pasivo crezca a ciegas.

**Viralidad.** Con 10% de clientas que invitan, 5 invitaciones cada una y 20% de conversión:
K = 0,1 × 5 × 0,2 = **0,1 compras por clienta**. Es un amplificador, no un motor: no promete
crecimiento exponencial. Lo que sí entrega es una clienta que compra por $4.202 de margen, con un
techo de costo conocido.

---

## 7. Lo que ve la usuaria

1. **Compartir contenido (prestadora, producto, look, pasaporte de colorimetría).** Ya existe y sigue
   igual: registra el share, da XP de estado, **no** atribuye referidos (D-08). Son dos enlaces de
   naturaleza distinta y mezclarlos convertiría cada share en una invitación monetaria.
2. **Pantalla de invitación (`/invite`, ya existe).** Añade: enlace corto con contador de clics,
   marcador real (invitadas, convertidas, puntos ganados, puntos por vencer), y enlace a condiciones.
3. **Registro con `?ref=CÓDIGO` (ya existe).** Debe sobrevivir al paso por la web y por el enlace
   corto. La atribución ocurre una sola vez y no se puede cambiar después.
4. **Checkout de GlowShop.** Un bloque nuevo, antes de pagar: «Tienes 1.200 puntos = $12.000. Aplicar
   [selector]. Te queda en $X». El total mostrado tiene que ser el que cobra el backend, no un cálculo
   del cliente.
5. **Recompensas (`rewards_xp_screen`).** Hoy muestra «350 XP» escrito a mano (anexo A). Pasa a mostrar
   el saldo real en pesos, el desglose por lote y la fecha del próximo vencimiento.
6. **Condiciones del programa.** Una pantalla, enlazada desde invitación, checkout y recompensas:
   monto, condición de compra, tope, mínimo, vencimiento, cómo se canjea, qué pasa si se cancela.
7. **Avisos.** «Tu invitada compró: ganaste 500 puntos», «tus 500 puntos vencen en 30 días», «se
   liberaron tus puntos porque el pedido no se pagó».

---

## 8. Los casos raros, resueltos de antemano

| Caso | Qué hace el sistema |
|---|---|
| La clienta aplica puntos y abandona el pago | Los puntos quedan **en espera**, no gastados. A las 24 h se liberan. |
| Paga a las 25 h, después de la liberación | La pasarela rechaza el cobro por pedido vencido; se libera y se le pide reintentar. El descuento no se honra sobre un saldo que ya no existe. |
| Dos pestañas aplican el mismo saldo | La segunda transacción espera el bloqueo de fila y falla con 409 al no encontrar saldo. |
| Reintento de red al crear el pedido | Clave idempotente por pedido: no se crean dos pedidos ni se comprometen dos veces. |
| La invitada compra tres veces | Sólo la primera compra acredita (`UNIQUE` por invitada en `referral_conversions` y por pedido en `points_lots`). |
| La referente llega a 11 conversiones en el mes | La 11 se registra con 0 puntos y motivo `tope_mensual`. |
| Los puntos vencen entre el checkout y el pago | Al confirmar el pago se recalcula; si el lote venció, el pedido se rechaza con un mensaje claro antes de cobrar. |
| Se cancela el pedido que consumió puntos | Se liberan los puntos y se reembolsa sólo el dinero cobrado (R-17). |
| La invitada pide devolución tras recibir | No se devuelven puntos; va por garantía (R-18). |
| Pedido asociado a una reserva (envío en cita) | Aplica igual: el descuento es sobre productos. El envío ya es cero y no entra en la base del tope. |
| Código inválido o inexistente en el registro | El registro continúa sin atribución. Nunca se bloquea una cuenta por un código malo. |
| Autoinvitación | Bloqueada hoy en `atribuirInvitacion` (`r.id <> u.id`). |
| Dos cuentas desde la misma IP o dispositivo | Se marcan y no se acredita automáticamente; el premio queda en revisión (D-09). |
| Se borra la cuenta de la referente | Las conversiones caen con `CASCADE`; los puntos ya acreditados en un libro propio sobreviven si son de otra usuaria. Definir política de borrado antes de producción. |

---

## 9. Antifraude (mínimo viable, no teórico)

- Autoinvitación bloqueada (ya existe).
- Una sola conversión por invitada y por pedido, en la base (ya existe + R-02).
- Tope de 10 premios por mes (R-05).
- Misma IP o mismo dispositivo entre referente e invitada: la conversión se registra, el premio queda
  **pendiente de revisión** y no se acredita solo.
- Compra mínima: el premio sólo cuenta si el pedido pagado supera $20.000 de productos, para que no se
  fabriquen conversiones con el producto más barato.
- Reversión por reembolso dentro de 30 días (R-06).
- Revisión manual con una vista simple: conversiones pendientes, motivo, y dos botones (aprobar,
  rechazar). Sin esto, el antifraude es una tabla que nadie mira.

---

## 10. Medición: el embudo completo

Un programa sin el primer escalón no se puede gestionar: se ve el resultado y no el canal.

1. **Enlace generado** — cuántas invitaciones se emiten.
2. **Clic** — cuántas se abren (`referral_clicks`, ruta pública `/r/:codigo` que cuenta y redirige).
3. **Registro atribuido** — cuántos se registran con el código (ya se mide, `usuarios.referred_by_user_id`).
4. **Conversión** — cuántas invitadas pagan (ya se mide en `referral_conversions`).
5. **Canje** — cuántos premios se gastan. Este escalón es el que dice si el programa sirve: un premio
   que nadie gasta no es un incentivo, es una promesa.

Métricas de gestión mensuales: puntos emitidos, canjeados, vencidos y vivos (pasivo); costo en margen
por clienta adquirida; K-factor; tasa de canje por lote.

---

## 11. Qué se reutiliza, qué se crea, qué se retira

### Se reutiliza tal cual o con cambios menores

- `usuarios.referred_by_user_id`, `referral_converted_at`, tabla `referral_conversions` (139/141).
- `atribuirInvitacion` y el enganche en el webhook de Wompi (`acreditarCompraReferida`).
- `GET /api/auth/referral-info` (código, enlace, mensaje, convertidas) — se le añade saldo y vencimiento.
- El patrón `runAsSystem` / `comoSistema` y `paymentJobs` para el job de liberación y vencimiento.
- `share_prestador_service`, `ShareCard`, `deep_link_service`, el script `desplegar-web.sh`.
- `verificar-cadena-migraciones.sh`, `verificar_contrato_api.py`, y la disciplina de tests que ya existe.

### Se crea

- `points_lots`, `points_movements`, `referral_clicks`; columnas `descuento` y `puntos_canjeados` en
  `pedidos_tienda` (la primera no existe hoy).
- `GET /api/rewards/points`, `POST /api/rewards/canjear`, `GET /r/:codigo`.
- Servicio `pointsService` (acreditar, saldo, comprometer, consumir, liberar, revertir).
- Bloque de canje en el checkout, saldo real en recompensas, pantalla de condiciones, marcador.
- Job de liberación a las 24 h y de aviso de vencimiento a los 30 días.
- Para el plan de niveles (17): `feature_usage` (cuotas de IA por usuaria y mes), middleware
  `requiereNivel`, servicio `nivelService`, y las pantallas de nivel y de servicios bloqueados.

### Se retira o neutraliza

- `POST /api/xp-logs/convert-cashback`: convierte puntos en `perfiles_prestador.saldo_disponible`, que
  es saldo retirable. Contradice la regla 2 y sigue montado en producción. Propuesta: responde 410 y
  se deja el historial intacto (D-03).
- El «350 XP» escrito a mano en `rewards_xp_screen`.
- El texto de la web publicada que aún promete $10.000.

---

## 12. Decisiones (aprobadas el 2026-11-12)

Todas quedan aprobadas en el sentido recomendado. La tabla se conserva como registro: si alguna se
cambia más adelante, se cambia aquí y se ajustan las reglas que dependen de ella.

| # | Decisión | Estado | Costo de equivocarse |
|---|---|---|---|
| **D-01** | Libro propio con lotes, no `xp_logs` | APROBADA (opción B) | Con `xp_logs`: doble gasto en reintentos y un pasivo que no se puede calcular |
| **D-02** | 100 puntos a la invitada al pagar su primer pedido | APROBADA | Sin doble lado el programa depende de la relación personal: convierte mucho menos |
| **D-03** | `convert-cashback` responde 410 | APROBADA | Dejarlo vivo permite retirar dinero por una puerta lateral |
| **D-04** | Pedido mínimo de $25.000 de productos | APROBADA | Con $18.000 y 20% el margen queda en $401 |
| **D-05** | Canje sólo sobre productos, nunca sobre reservas | APROBADA | Canjear sobre servicios descuenta la comisión de la prestadora y rompe su payout |
| **D-06** | Tope de canje del 15% del valor de productos | APROBADA | Con 20% el pedido queda con 2,2% de margen |
| **D-07** | Reversión por reembolso dentro de 30 días | APROBADA | Sin esto, comprar, cobrar el premio y devolver es un exploit |
| **D-08** | Compartir contenido no atribuye referidos | APROBADA | Atribuir todo convierte cada share en un premio monetario |
| **D-09** | Misma IP o dispositivo: marcar, no acreditar | APROBADA | Acreditar deja la puerta abierta a granjas de cuentas |
| **D-10** | Vencimiento 12 meses por lote, consumo FEFO | APROBADA | Sin vencimiento el pasivo crece sin techo |
| **D-11** | 100 puntos por primera reserva completada | APROBADA, se ejecuta en §16 | Meterlo ahora duplica el alcance antes de que el canje exista |
| **D-12** | Dos capas, y el XP de participación desbloquea servicios de la app | APROBADA (opción 1 + enmienda) | Una sola moneda obliga a provisionar emisión sin margen y convierte el canje en descuento permanente |
| **D-13** | Cómo se cuenta el premio: valor en puntos + tope uniforme del 15%, sin excepción para el primer canje | **PENDIENTE** (recomendado lo primero) | Prometer «$5.000 de descuento» y entregar $3.750 en el pedido mínimo genera reclamo; una excepción para el primer canje es una regla que nadie recuerda y que se puede replicar abriendo cuentas |

## 13. Lo que no se construye (sin autorización expresa)

Multinivel o comisiones en cascada. Saldo retirable o acreditación en Wompi. Puntos transferibles entre
usuarias. Cupones o códigos de descuento genéricos. Reescritura de `xp_logs` o del sistema de niveles.

La emisión de puntos por reservar, reseñar o navegar no está prohibida: está **fuera de esta fase** y
se diseña en §16, porque cambia la naturaleza de la moneda y el respaldo del pasivo.

---

## 14. Criterios de aceptación (en lenguaje natural, antes de ser tests)

**Acreditación**
- Una invitada paga su primer pedido: la referente recibe un lote de 500 puntos con vencimiento a 12
  meses. Repetir el webhook no crea un segundo lote.
- La invitada compra tres veces: sólo la primera acredita.
- La referente llega a 11 conversiones en el mes: la 11 se registra con 0 puntos y motivo visible.

**Canje**
- Un pedido con 500 puntos aplicados baja el total exactamente $5.000, y el saldo baja 500.
- Intentar aplicar más del 15% del valor de productos aplica el máximo permitido en bloques de 100,
  no rechaza el pedido. En un pedido de $25.000 se aplican 300 puntos y la app muestra que sobran 200.
- Aplicar puntos y no pagar: a las 24 h el saldo vuelve a estar completo.
- Canjear dos veces sobre el mismo pedido: 409. Sin sesión: 401. Sin saldo: 400 con mensaje claro.
- El total que cobra la pasarela es el del pedido descontado, leído de la base.

**Integridad**
- Dos peticiones simultáneas con el mismo saldo: una gana, la otra falla. El saldo nunca queda negativo.
- La suma de lotes menos movimientos cuadra con el saldo que muestra la app.
- La factura del pedido cuadra: base + IVA + envío − descuento = total.

**Medición**
- Un clic real en el enlace incrementa el contador y el registro posterior queda atribuido.
- El reporte mensual muestra emitido, canjeado, vencido y vivo.

---

## 15. Orden de construcción propuesto

Cinco entregas, cada una con su compuerta. La regla es no abrir la siguiente sin cerrar la anterior.
El detalle de archivos, migraciones, pruebas y comandos de cada entrega está en
`2026-11-12_plan-construccion.md`.

- **E1 — Libro de puntos.** Tablas, servicio, acreditación refactorizada sobre el webhook, saldo.
  Sin interfaz. Cierra: se puede decir cuánto tiene cada usuaria y de dónde vino.
- **E2 — Canje en el checkout (backend).** Compromiso, consumo, liberación, tope, idempotencia,
  columnas del pedido, job de 24 h. Cierra: un pedido puede pagarse con puntos y el premio se gasta.
- **E3 — Interfaz.** Checkout, recompensas reales, condiciones, marcador, textos. Cierra: la usuaria ve
  y usa el programa. Incluye republicar el cliente web.
- **E4 — Medición y control.** Clics, antifraude, tope mensual, avisos de vencimiento, reporte.
- **E5 — Niveles y desbloqueo de servicios** (§17). Independiente del dinero: podría empezar antes si
  se quiere, pero compite por el mismo equipo y por los mismos endpoints de IA. Se arranca con **una
  sola función en piloto** (recetas GlowStore), no con el catálogo completo.

---

## 16. Apartado aparte: puntos por reservar, reseñar y navegar (v2)

Fuera de esta fase por decisión del Director. Se deja aquí diseñado para revisarlo cuando el canje esté
cerrado y medido. **No entra en E1–E5.**

Ojo con la frontera: lo que queda diferido aquí es **emitir puntos canjeables** por reservar, reseñar o
navegar. La parte de **XP que desbloquea servicios** ya quedó aprobada y se construye en E5 (§17). Son
dos cosas distintas y no se pisan: una emite dinero, la otra abre puertas.

### 16.1 Por qué no entra ahora

El programa actual emite puntos sólo cuando entra margen: una compra pagada. Reservar, reseñar o
navegar **no generan margen**. Si emiten la misma moneda canjeable, el pasivo crece sin respaldo: se
promete descuento sobre ventas que no dejaron utilidad. Es la única razón por la que este apartado
necesita una decisión de moneda antes que una decisión de monto.

### 16.2 La pregunta que lo define: ¿una moneda o dos? — **DECIDIDA: opción 1**

**Opción 1 — dos capas (APROBADA el 2026-11-12).** El XP de participación no sólo da nivel e insignias:
**desbloquea servicios de la aplicación**. El plan completo está en §17.

- **XP de participación**: reservar, reseñar, navegar, completar perfil. Vive en `xp_logs`, que ya
  existe. Da nivel, insignias y desbloqueos. **No se canjea por pesos.**
- **Puntos canjeables**: sólo nacen de margen — compra referida, bienvenida de la invitada, y si algún
  día se aprueba, un porcentaje acotado de la comisión de una reserva completada.
- Ventaja: el pasivo siempre tiene respaldo y el canje no compite con el premio de referidos.
- Costo: dos cifras en la app. Hay que nombrarlas distinto y no mezclarlas en la misma tarjeta, o la
  usuaria va a intentar gastar XP y va a encontrar que no vale nada.
- **Aprobada con una enmienda de alcance:** el XP no se queda en nivel e insignias; es la moneda de
  acceso a servicios. Ver §17.

**Opción 2 — una sola moneda.**
- Reservar y reseñar emiten puntos canjeables, sólo sobre acciones completadas y pagadas, con
  presupuesto mensual de emisión y tope por usuaria.
- Ventaja: una sola cifra, mensaje simple.
- Costo: hay que provisionar emisión sin margen directo, y el canje empieza a competir con el premio de
  referidos por el mismo saldo. Sube el riesgo de que el programa se vuelva un descuento permanente.

### 16.3 Lo que falta medir antes de decidir

Para valorar una reserva necesito el **ticket medio** y la **comisión que retiene la plataforma** en
servicios. Hoy no los tengo medidos con evidencia (E2). Sin esos dos números, cualquier monto por
reserva es una suposición disfrazada de diseño. Es la primera tarea de este apartado, y es de medición,
no de código.

### 16.4 Riesgos por acción

| Acción | Cómo se abusa | Mitigación mínima |
|---|---|---|
| Reservar | Reservar y cancelar; reservas entre conocidas; reservas de bajo ticket | Sólo reservas `COMPLETADA` y pagadas; tope mensual; monto proporcional a la comisión, no fijo |
| Reseñar | Reseñas de una línea, reseñas pagadas por la prestadora, cuentas nuevas | Sólo reseña verificada con reserva completada; una por reserva; se retira el punto si se retira la reseña |
| Navegar | Se paga por una acción que no deja margen y se puede automatizar | Si se hace, XP de estado con tope diario. **Nunca pesos** |

### 16.5 Secuencia recomendada

1. Cerrar el canje del programa actual (E1–E3) y medir 60–90 días de emisión, canje y vencimiento.
2. Medir ticket medio y comisión de reservas.
3. Decidir moneda (16.2).
4. Sólo entonces abrir la emisión por reserva completada: los 100 puntos de D-11, en ese momento y con
   el mismo libro, lote y vencimiento que todo lo demás.

### 16.6 Lo que este apartado no cambia

R-07 (canje sólo productos), R-14 (no se toca `xp_logs` para dinero), el tope del 15 %, el mínimo de
$25.000 y el vencimiento a 12 meses. Cualquier punto que se emita en el futuro entra al mismo libro, con
lote propio y fecha de vencimiento: la regla de oro R-00 no se negocia por tipo de acción.

---

## 17. Plan de estímulo: XP que desbloquea servicios

Aprobado en §16.2 (opción 1). El XP de participación **no se gasta y no vale pesos**: abre puertas. Es
un umbral acumulado, no un saldo, y eso simplifica todo — no hay libro de consumo, no hay vencimiento,
no hay ansiedad de perder lo acumulado.

### 17.1 Los cinco principios

1. **El XP abre acceso y cuotas; nunca descuentos.** El descuento es de los puntos canjeables (§4). Dos
   objetos distintos, dos nombres, dos iconos, dos tarjetas separadas.
2. **No se le quita nada a nadie.** Sólo se desbloquea lo que hoy **no existe** o lo que **cuesta
   tokens** (las funciones de IA). Bajar a un usuario algo que ya usaba gratis es la forma más rápida
   de perderlo y de que la app hable mal de sí misma.
3. **Lo esencial jamás se bloquea.** Reservar, pagar, chatear con la prestadora, soporte, disputas,
   pedidos, datos personales, habeas data y borrado de cuenta quedan en el nivel cero. Bloquear el
   acceso a datos personales o al borrado de cuenta no es gamificación: es un problema legal.
4. **El servidor es la verdad cuando cuesta dinero.** Las funciones de IA se controlan en el backend
   (`/api/v1/beauty-scan`, `/api/nia-beauty`, `/api/biometric/analyze`, worker de VTO), no sólo
   ocultando el botón. El cliente oculta; el servidor rechaza.
5. **Las cuotas son control de costo, no castigo.** Cada llamada a IA tiene un costo unitario real. La
   cuota por nivel es la forma de que el programa se pague solo, y es el número que hay que calibrar
   primero con la factura de Gemini y del ai-worker, no con una corazonada.

### 17.2 Cómo se gana XP

Sólo comportamiento propio. Nada de dinero, nada de invitar (eso paga en puntos canjeables, §5.1).

| Acción | XP | Tope | Por qué |
|---|---|---|---|
| Reserva completada (no cancelada) | 100 | 3 al mes | Es el uso real de la app: hay que premiarlo, no sólo la compra de producto |
| Reseña verificada (con reserva completada) | 50 | 1 por reserva, 3 al mes | Genera contenido que reduce el riesgo de la siguiente clienta |
| Compartir contenido (prestadora, producto, look) | 50 | 1 por tipo y por día (ya existe) | Ya está implementado en `socialController` |
| Perfil completo (foto, ciudad, tipo de piel) | 50 | una sola vez | Mejora el matching y la logística |
| Primera reserva | +100 | una sola vez | Onboarding: el primer paso es el que más cuesta |

**Nota de contabilidad:** la primera reserva pagada acredita **dos cosas distintas** en dos libros
distintos: 100 puntos canjeables (D-11, dinero) y 100 XP (estado). No es doble conteo: son dos
propósitos. Los reportes los separan siempre.

Un perfil activo (2 reservas, 2 reseñas, algún share al mes) suma ~350 XP al mes.

El mecanismo de reseña **ya existe** y está ligado a la reserva: tabla `reviews` con
`booking_id NOT NULL REFERENCES bookings(id)` (054:68-76) y aspectos cerrados (127). Lo que falta es la
regla de XP, no la infraestructura. La verificación «sólo con reserva completada» es una condición en
la consulta, no una tabla nueva.

### 17.3 Los niveles y lo que abren

Los umbrales son **hipótesis de arranque**, no dogma: se recalibran a los 60 días con la distribución
real. Un nivel que nadie alcanza es decoración; uno que todos alcanzan la primera semana no motiva nada.

| Nivel | XP | Qué abre |
|---|---|---|
| **Glow** | 0 | Todo lo esencial: reservar, pagar, chat, soporte, disputas, pedidos, invitar, datos. GlowStore completo. |
| **Pétalo** | 300 | **1 análisis NIA al mes** · **recetas GlowStore** (las que arman rutina con lo que ya compró) · lookbook hasta 3 looks · GlowGuide introductorio |
| **Oro** | 900 | **3 análisis NIA al mes** · **3 escaneos de producto al mes** · lookbook ilimitado · **VTO de uñas y maquillaje con exportación en HD y sin marca de agua** · acceso anticipado **24 h** a la agenda de la semana siguiente · GlowGuide avanzado |
| **Diamante** | 2.000 | **1 análisis NIA por semana** · **VTO ilimitado** · prioridad en la cola de soporte · acceso anticipado a lanzamientos y ediciones limitadas de GlowStore · revisión de rutina mensual generada por NIA |

Tres decisiones de diseño detrás de la tabla:

- **El acceso anticipado a la agenda no roba cupos**: abre antes la misma oferta. Si se interpreta como
  "las Diamante se quedan con los horarios buenos", se rompe la relación con las prestadoras y con las
  clientas nuevas.
- **Lo que se desbloquea en Pétalo es contenido, no potencia.** El análisis NIA existe y cuesta tokens:
  dar uno al mes desde el primer nivel hace que la usuaria pruebe la función que después va a querer.
- **Diamante no incluye nada humano caro** (asesorías 1:1, regalos físicos). Si más adelante se quiere,
  se diseña como beneficio con cupo y costo unitario conocido; hoy sería un pasivo abierto.

### 17.4 Cómo se aplica (y qué se reutiliza)

- **El nivel se calcula, no se guarda.** `SUM(xp_amount)` de `xp_logs` con los umbrales en un solo
  archivo de configuración. No se toca `user_levels`: su `CHECK` sólo admite `novice/intermediate/
  advanced/expert` (migración 023), así que meterle `petalo` obligaría a una migración para cambiar una
  restricción, y el nivel pasaría a tener dos fuentes de verdad. Una sola: la suma de XP.
- **Un middleware `requiereNivel('oro')`** delante de los endpoints de IA. Responde 403 con un cuerpo
  útil: nivel actual, XP que falta, qué abre ese nivel. La app no adivina nunca por qué no puede.
- **Cuotas con tabla propia.** `feature_usage(user_id, funcion, periodo, usos)` con
  `UNIQUE(user_id, funcion, periodo)`: se incrementa con `ON CONFLICT DO UPDATE` y se compara contra la
  cuota del nivel. Sin esa restricción, dos peticiones simultáneas pasan las dos.
- **Se reutiliza** `xp_logs` (fuente), `socialController` (share ya acredita 50 XP), el patrón
  `authMiddleware` + `wrapRouterAsync`, y los endpoints de IA que ya existen. No se inventa una moneda
  nueva ni un libro paralelo.

### 17.5 Integridad

- Sólo reservas **completadas** (no `CANCELADA`, no `PENDIENTE_PAGO`) dan XP; la cancelación revierte el
  XP si se detecta después.
- Reseña verificada: una por reserva, y si se retira la reseña se retira el XP.
- Compartir ya tiene tope diario por tipo y referencia (idempotente, `social_shares_log`, migración 138).
- XP nunca baja por usar un servicio: usar no consume. Sólo un ajuste administrativo puede restar, y
  queda en `xp_logs` con motivo visible.
- El XP no se transfiere, no se vende y no se convierte en pesos. El día que alguien lo intente, la
  respuesta es no.

### 17.6 Cómo se mide si sirve

- Distribución por nivel (si el 90% está en Glow, los umbrales están altos; si el 90% está en Diamante,
  no hay nada que desbloquear).
- Uso de cada servicio desbloqueado por nivel: si Pétalo abre el análisis NIA y nadie lo usa, el
  beneficio está mal elegido.
- Retención y frecuencia de reserva por nivel: la pregunta real es si subir de nivel cambia el
  comportamiento, no si la gente colecciona XP.
- Costo de IA por usuaria y por nivel contra la cuota: el programa tiene que costar menos de lo que
  retiene.

### 17.7 Qué no se construye aquí

Nada de niveles pagados (comprar XP o saltar de nivel con dinero). Nada de XP que expire: el estado no
caduca, sólo caduca el dinero. Nada de beneficios con costo humano abierto. Y nada de bloquear reservas,
pagos, soporte ni derechos sobre los datos, en ningún nivel.

---

## Anexo A — Hallazgos medidos hoy (E0) que obligan a cambiar el plan del traspaso

| # | Hallazgo | Comando / fuente | Consecuencia |
|---|---|---|---|
| A1 | `pedidos_tienda` **no tiene columna `descuento`** en toda la cadena de migraciones | `010_implement_glowstore_schema.sql:54-69` + `grep descuento migrations/` | La migración debe crearla. Hoy `orderController.js:1140` lee un campo que no existe y lo convierte en 0 |
| A2 | `pedidos_tienda` tiene `envio`, no `cargo_envio`; `detalles_pedido_tienda` tiene `precio_unitario_pagado`, no `precio_unitario` | mismo archivo, 010:54-80 | La ruta DIAN (`generarFacturaDianPedido`) leería `NaN` si se activa. Deuda preexistente, no se toca sin autorización |
| A3 | `xp_logs` real: `id, user_id, xp_amount, reason, metadata, created_at`; sin vencimiento ni claves únicas | `migrations/023_glow_academy_pro.sql:27-34` | Confirma D-01: no sirve como libro del dinero sin columnas nuevas |
| A4 | No existe nada de `rewards`, `points_redemptions`, `puntos_canjeados` ni `referral_clicks` | `grep -rn` sobre backend completo | El canje es greenfield; no hay código que reutilizar del lado del gasto |
| A5 | `convert-cashback` está montado y activo: 500 XP = $5.000 a `perfiles_prestador.saldo_disponible` | `xpLogRoutes.js:45`, `xpLogController.js:44-101` | Viola la regla 2 en producción (D-03) |
| A6 | La web publicada sigue en $10.000: el bundle contiene `"Invitar amigas · $10.000 COP de regalo"` | descarga de `main.dart.js` publicado | Republicar antes de anunciar el programa (R-20) |
| A7 | `rewards_xp_screen` muestra «350 XP» fijo, no lee el saldo | `rewards_xp_screen.dart:105-113` | La pantalla de recompensas es maqueta |
| A8 | El catálogo visible son 8 productos, $18.000–$89.000, mediana $50.000 | `/api/products` con `X-App-Audience: client` | Base de toda la economía de §6 |
| A9 | `payOrder` toma el monto de `pedidos_tienda.total` en base, no del cliente | `orderController.js:660-700` | El descuento aplicado al crear el pedido llega bien a la pasarela |
| A10 | Existe infraestructura de jobs (`paymentJobs`, `comoSistema`, `DISABLE_BACKGROUND_JOBS`) | `src/jobs/paymentJobs.js:396-443` | El job de liberación y el de vencimiento se enganchan ahí, no se inventan |
| A11 | Las reseñas existen y cuelgan de la reserva: `reviews.booking_id NOT NULL` | `054_create_core_tables.sql:68-76`, `127_review_aspectos.sql` | El XP por reseña verificada no necesita infraestructura nueva |
| A12 | Las funciones de IA existen y consumen proveedor externo (Gemini, ai-worker) | `src/services/geminiService.js`, `src/routes/v1/beautyScanRoutes.js` (`AI_WORKER_URL`) | Bloquearlas por nivel es también control de costo: el gate se paga solo |
| A13 | `user_levels.level` tiene `CHECK (novice/intermediate/advanced/expert)` | `023_glow_academy_pro.sql` | Por eso el nivel se calcula al vuelo y no se escribe en esa tabla (§17.4) |
