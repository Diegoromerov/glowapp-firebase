# Brief de verificación visual — programa de puntos GlowApp

**Para el agente que sí abre Chromium.** El entregable es un **informe con evidencia**, no un
cambio de código. Tú no arreglas nada: si algo falla, lo documentas y paras.

---

## 0. Estado de partida (contrástalo antes de empezar; si no coincide, DETENTE)

| Dato | Valor esperado | Cómo comprobarlo |
|---|---|---|
| Backend en producción | commit `2a3b04ad`, 16 migraciones, `dbMode: postgres` | `curl -s -H "X-App-Audience: client" https://glowapp-api-production.up.railway.app/api/health` |
| Bundle web publicado | `md5 = a9dac24ad933cf23b0a7bf6905e7e492`, 5.326.836 bytes | `curl -s https://glowapp-client.web.app/main.dart.js \| md5sum` |
| App del cliente | `https://glowapp-client.web.app` | — |
| API | `https://glowapp-api-production.up.railway.app` | — |

Si el md5 del bundle no es `a9dac24a…` o el commit no es `2a3b04ad`, **detente y repórtalo**: estarías
verificando otra versión y el informe no serviría.

---

## 1. Tu rol

Eres el verificador visual. Abres la aplicación publicada en un navegador real, ejecutas los pasos de
abajo y devuelves un informe con capturas y respuestas crudas. **No modificas código, no haces push,
no despliegas, no siembras datos fuera de lo que dice el paso V5.**

---

## 2. Alcance: exactamente cuatro comprobaciones (V5 opcional)

### V1 — Condiciones del programa (público, sin sesión)

1. Abre `https://glowapp-client.web.app/#/programa-puntos` en una ventana privada.
2. Captura la pantalla completa (scroll incluido si hace falta) con el nombre `V1-condiciones.png`.
3. Copia el texto visible de los cinco bloques.

**Pasa si:** se ve el título «Programa de puntos» y aparecen literalmente estos cinco datos:
`500 puntos`, `$20.000`, `100 puntos de bienvenida`, `15%`, `$25.000`, `10 premios por mes`,
`12 meses`, `no se retiran`.

**Falla si:** la ruta redirige al login, queda en blanco, o falta cualquiera de esos datos.

### V2 — Recompensas muestra el saldo real (requiere sesión)

1. Inicia sesión con la cuenta de prueba que te hayan dado (o crea **una** cuenta marcada, ver §5).
2. Ve a Recompensas (`/#/rewards`).
3. Captura `V2-recompensas.png`.

**Pasa si:** hay una tarjeta «PUNTOS PARA DESCUENTOS» con un número de puntos y su equivalencia en
pesos, y un enlace «Cómo funcionan los puntos» que abre V1.

**Falla si:** no aparece la tarjeta, o el número no coincide con lo que devuelve
`GET /api/rewards/points` (pídelo con el token de esa sesión y pega el JSON).

### V3 — Sin saldo, el checkout no ofrece canje (requiere sesión sin puntos)

1. Con una cuenta de **0 puntos**, añade un producto al carrito y abre el resumen del pedido.
2. Captura `V3-checkout-sin-puntos.png`.

**Pasa si:** el bloque de puntos **no aparece** y el total es el de siempre (productos + IVA + envío).

**Falla si:** aparece un bloque de canje con saldo 0, o el total cambia sin puntos aplicados.

### V4 — La aritmética del canje coincide con el servidor (requiere sesión, NO requiere puntos)

Es la comprobación más importante, porque no depende de tener saldo. El servidor calcula y devuelve
cuántos puntos caben; la app debe mostrar lo mismo.

Con el token de la sesión, ejecuta estas cuatro peticiones y pega el JSON completo de cada una:

```bash
API=https://glowapp-api-production.up.railway.app
TOKEN=<token de la sesión, sin comillas>

# 1) Producto de $55.000 ("Mascarilla de Queratina 200 g"), pedir 500 puntos
curl -s -X POST "$API/api/store/envio/cotizacion" \
  -H "Content-Type: application/json" -H "X-App-Audience: client" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"items":[{"producto_id":<ID>,"cantidad":1}],"direccion_entrega":"Calle 100 # 7-21","ciudad_entrega":"Bogota","puntos_a_canjear":500}'

# 2) Mismo producto, pedir 100
# 3) Producto de $18.000 ("Aceite de cutícula 15 ml"), pedir 500  -> debe rechazar por mínimo
# 4) Producto de $32.000 ("Labial mate de larga duración"), pedir 500 -> debe recortar
```

Obtén los `producto_id` con
`curl -s -H "X-App-Audience: client" "$API/api/products"`.

| Caso | Producto | Pides | `puntos.aplicados` esperado | `descuento` esperado |
|---|---|---|---|---|
| 1 | $55.000 | 500 | **500** | **5.000** |
| 2 | $55.000 | 100 | **100** | **1.000** |
| 3 | $18.000 | 500 | — | HTTP **400** con `PEDIDO_MINIMO` |
| 4 | $32.000 | 500 | **400** | **4.000** |

Además, `total_con_descuento` debe ser exactamente `total − descuento` en cada caso.

**Pasa si:** los cuatro coinciden y `tope_porcentaje: 15`, `minimo_pedido: 25000`,
`bloque_canje: 100`, `valor_punto_cop: 10` aparecen en la respuesta.

**Falla si:** cualquier número difiere. Pega el JSON crudo aunque falle.

### V5 — Opcional, sólo si tienes acceso a la base de producción

Sin esto no se puede ver el bloque de canje **con saldo real**, que es la única parte que aún no está
capturada. Si no tienes `DATABASE_URL_ADMIN`, escribe «V5: NO EJECUTADA — sin acceso a base» y sigue.

1. Identifica el `id` de tu cuenta de prueba: `SELECT id, email FROM usuarios WHERE email = '<tu correo de prueba>';`
2. Siembra un lote de prueba (queda identificable y se borra en el paso 4):

```sql
INSERT INTO points_lots (user_id, puntos, puntos_restantes, origen, referencia_id, motivo, vence_en)
VALUES (<ID>, 500, 500, 'ajuste:manual', 'verificacion-visual-f2',
        'Lote de verificación visual', NOW() + INTERVAL '6 months');
```

3. Recarga Recompensas y el checkout con un producto de $55.000. Captura
   `V5a-checkout-con-puntos.png` sin aplicar y `V5b-checkout-aplicado.png` con el switch activado.
   **No pulses «Pagar»**: crearías un pedido real. Con el switch activado basta.
4. Limpieza obligatoria al terminar:

```sql
DELETE FROM points_movements WHERE lot_id IN
  (SELECT id FROM points_lots WHERE origen='ajuste:manual' AND referencia_id='verificacion-visual-f2');
DELETE FROM points_lots WHERE origen='ajuste:manual' AND referencia_id='verificacion-visual-f2';
```

**Pasa si:** el bloque muestra `500 puntos`, al activarlo dice que aplica 500 puntos (−$5.000) y el
total baja exactamente $5.000 respecto de V5a.

---

## 3. Prohibiciones (cada una es un parón, no una preferencia)

1. **No modifiques código, no hagas commit, no hagas push, no despliegues.** El repo y producción no
   se tocan en esta tarea.
2. **No pulses «Pagar» en ningún flujo.** Crear un pedido real compromete puntos y stock.
3. **No siembres datos** salvo el `INSERT` exacto de V5, con el `referencia_id` indicado, y bórralo.
4. **No uses cuentas de usuarias reales.** Sólo la cuenta de prueba.
5. **No inventes resultados.** Si un paso no se pudo ejecutar, se reporta `NO EJECUTADA` con el
   motivo; un `PASS` sin captura ni JSON no se acepta.
6. **No cambies el tamaño ni el dispositivo del navegador a mitad de una captura.** Anota el viewport
   usado (por ejemplo 1440×900) en el informe.
7. **No abras el panel de administración ni el reporte** (`/api/rewards/reporte`): es información del
   negocio y no hace falta para esta verificación.

---

## 4. Protocolo de parada

Si para completar una comprobación necesitas violar una prohibición, **detente** y reporta: qué
necesitas, por qué es imprescindible y cuál es la alternativa más pequeña. No improvises.

Si el backend no responde o el bundle no coincide con el md5, detente antes de empezar: verificar una
versión distinta produce un informe inútil.

---

## 5. Cuenta de prueba

- Si te dan credenciales, úsalas y no las escribas en el informe.
- Si tienes que crearla: usa el correo `verif.puntos+<fecha>@glowapp.test`, un nombre «Verificación
  puntos», y **bórrala al terminar** desde la propia app (Perfil → Eliminar cuenta). Repórtalo.
- Nunca uses el teléfono ni el correo de una persona real.

---

## 6. Informe que debes devolver

Una tabla con una fila por comprobación:

| ID | Comprobación | Resultado | Evidencia |
|---|---|---|---|
| V1 | Condiciones públicas | PASS / FAIL / NO EJECUTADA | `V1-condiciones.png` + los datos literales encontrados |
| V2 | Saldo real en Recompensas | … | `V2-recompensas.png` + JSON de `/api/rewards/points` |
| V3 | Sin saldo no hay canje | … | `V3-checkout-sin-puntos.png` + el total mostrado |
| V4 | Aritmética del canje | … | los 4 JSON crudos |
| V5 | Canje con saldo (opcional) | … | `V5a`/`V5b` + los totales de cada uno |

Debajo de la tabla, y en este orden:

1. **Estado**: commit de `/api/health`, `migrations.registradas`, y el `md5` del bundle que
   descargaste.
2. **Viewport y navegador** usados.
3. **Errores de consola** del navegador (pegar tal cual, o «ninguno»).
4. **Datos de la cuenta de prueba**: sólo el `id` numérico y si la borraste.
5. **Lo que no pudiste verificar y por qué.**

---

## 7. Qué voy a validar yo del informe

- Que el `md5` del bundle que reportas sea `a9dac24a…` y el commit `2a3b04ad`: si no, la evidencia es
  de otra versión y no cuenta.
- La aritmética de V4 la recalculo contra el catálogo real: `puntos.aplicados` debe ser
  `min(saldo, floor(0,15 × productos / 10 / 100) × 100)` y `descuento = aplicados × 10`. Cualquier
  número que no salga de esa fórmula, lo devuelvo.
- Que `total_con_descuento = total − descuento` en los cuatro casos.
- Que las capturas muestren los textos que citas (los reviso yo, no me fío de la transcripción).
- En V5, que el `INSERT` y el `DELETE` sean los del brief (mismo `referencia_id`) y que el saldo
  vuelva a quedar como estaba.

Un informe con `PASS` pero sin JSON ni captura se devuelve como `NO EJECUTADA`.
