# Traspaso — Programa de puntos y niveles GlowApp

Cierre de sesión del 12 de noviembre de 2026. Estado medido, no estimado.

---

## 1. Qué está publicado

| Pieza | Estado | Commit |
|---|---|---|
| Backend en producción | `d5b70fd1`, 20 migraciones | — |
| Web del cliente | `e8f0b2a0…` (md5 del bundle) | `dd195f81` |

Producción: `https://glowapp-api-production.up.railway.app` · `https://glowapp-client.web.app`

## 2. Qué se construyó

**Libro de puntos** (`points_lots` / `points_movements`, migración 142): lotes con
vencimiento a 12 meses, FEFO, consumo parcial, idempotencia por `clave` única.
Separado de `xp_logs`, que sigue siendo estado (nivel), no dinero.

**Canje en checkout** (143): 1 punto = $10, bloques de 100, tope 15 % del valor de
productos con IVA, mínimo de pedido $25.000. Se compromete en la transacción,
se consume en el webhook de pago y se libera a las 24 h si no se paga.

**Referidos**: 500 puntos ($5.000) al referente cuando la invitada compra ≥ $20.000,
100 de bienvenida a la invitada, tope de 10 premios/mes, atribución por
`referred_by_user_id`, medición de clics en `/r/:codigo`, y **antifraude**: misma
IP o dispositivo ⇒ la conversión se registra con 0 puntos en `EN_REVISION`.

**Niveles y cuotas de IA** (E5): 0 / 300 / 900 / 2.000 XP (Glow · Pétalo · Gold ·
Élite). La cuota **cuelga del uso**: 1 al registrarse, +1 por reserva completada,
+1 por compra pagada, tope 3 por concepto al mes, y bono mensual del nivel
(0/1/3/6). Diamante sin compras recibe 6 lecturas, no 25.

**Medición de costo** (`ai_usage_events`, 149): una fila por llamada con proveedor,
modelo, tokens o puntos, costo en COP y `trace_id`. La escribe el orquestador
biométrico tras cada análisis nuevo (un acierto de caché no se cobra).

**Guardia de cuota**: `exigirDisponibles()` corta con 402 `CUOTA_AGOTADA` y el
desglose. Vive dentro del orquestador, después de calcular la huella de la foto,
para no castigar a quien repite la misma imagen.

**Pantalla del club** (`/#/niveles`, `NivelesScreen`): nivel en oro, riel de cuatro
nodos, cuota de IA con desglose, puntos con botón honesto, invitar y beneficios.
Todo desde `GET /api/rewards/nivel` y `/api/rewards/points`. Reemplazó tres `const`
que mostraban «350 XP · Gold» a todas las usuarias.

## 3. Costos unitarios que gobiernan el diseño

| Concepto | Costo |
|---|---|
| Lectura YouCam SD (9 pts) | $1.440 COP |
| Lectura YouCam HD (12 pts) | $1.920 COP |
| Análisis completo (DeepSeek + Gemini) | ~$10 COP |
| Techo mensual por usuaria (Élite, 12 lecturas) | $23.040 COP |

YouCam es 145–193× el costo del LLM: **el 99 % del costo es la lectura**, no el
modelo. Cualquier cuota futura debe pensarse en lecturas, no en «análisis».

## 4. Aparcado por decisión del Director

1. **`DELETE /api/auth/delete-account` → 502.** Requisito Apple 5.1.1(v). Depende
   de tener cuenta de desarrollador de Apple, que no existe. Necesita
   instrumentación fina (log al entrar y salir del handler): la lógica mide 261 ms
   en el contenedor, el fallo está en la capa HTTP.
2. **Envío de Bogotá cae en zona comodín** (`$16.400` en vez de `$9.200`). Depende
   de un sistema de rutas y repartición que se construirá más adelante.
3. **`ai_usage_events` en 0 filas.** Nadie analizará hasta terminar el módulo de
   visualización y lectura de rostro, hoy en construcción.

## 5. Deuda técnica identificada

**Migraciones que documentan columnas inexistentes.** Dos casos en un día
(`productos.tenant_id NULL`, `usuarios.referral_code`). La cadena de migraciones
valida RLS, orden y duplicados, pero no que el código consulte columnas que
existan. Los tests usan mocks sin esquema y no lo detectan nunca.

Propuesta: verificador que extraiga las columnas usadas en los controladores y las
confronte contra el esquema resultante de la cadena.

## 6. Cómo se trabaja aquí (lo que funcionó)

- Comprobar el esquema REAL por `railway ssh` + `node -` con base64; no fiarse de
  las migraciones.
- `flutter build web` tarda ~2 min y necesita memoria; si `desplegar-web.sh` muere
  con `exit 127` y un volcado del compilador, compilar a mano y publicar con
  `firebase deploy --only hosting` desde `apps/glow_client`.
- Tras publicar: md5 local == remoto, y 2–3 cadenas ASCII nuevas en el bundle.
- Para ver una pantalla con datos sin desplegar: servir el build **y** los
  endpoints desde el mismo origen (CORS bloquea `localhost`).
- Antes de cada push con migraciones: `bash backend/scripts/verificar-cadena-migraciones.sh`
  desde la raíz, y `MIGRACIONES_VERIFICADAS=1 git push`.
