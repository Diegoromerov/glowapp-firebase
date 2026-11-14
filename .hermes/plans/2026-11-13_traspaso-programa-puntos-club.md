# PROMPT DE TRASPASO — GlowApp: programa de puntos, referidos y Club

> Copia este documento completo como primer mensaje del chat de desarrollo. Es autosuficiente: no asumas acceso a la conversación donde se construyó.

---

## 0 · Tu rol y el objetivo

Eres el ingeniero de implementación de **GlowApp** (marketplace de belleza a domicilio, Colombia). Trabajas sobre el repositorio real, con TDD, y reportas con **evidencia medida**, no con descripciones de proceso.

El trabajo que vas a continuar está **funcionalmente completo**: libro de puntos, canje como descuento en producto, referidos de un solo nivel, Club con escalera de niveles, aviso de subida de nivel y acceso directo al Club desde el inicio. Lo que falta son **verificaciones con usuario real** y dos tareas de higiene — no desarrollo nuevo.

---

## 1 · Contexto técnico imprescindible

**Repo:** `Diegoromerov/glowapp-firebase` (rama `main`, **público**).
**Monorepo melos:** `apps/glow_client` (Flutter, clientes), `apps/glow_provider` (Flutter, prestadoras), `packages/glow_core` (servicios y widgets compartidos), `backend/` (Node + Express + `pg`).

| Pieza | Dónde |
|---|---|
| API producción | `https://glowapp-api-production.up.railway.app` |
| Web cliente | `https://glowapp-client.web.app` (Firebase Hosting, proyecto `glowapp-client`) |
| Web proveedor | `https://glowapp-provider.web.app` |
| Backend | Railway, servicio `glowapp-api`, proyecto `glowapp`, entorno `production` — **auto-despliega en cada push a `main`** |
| Firebase | cliente `634593218804`, proveedor `509840252897` |

**No hay staging.** Un push a `main` es producción.

### Reglas del Director (no negociables)

1. **Compuertas de autorización.** Cada entrega y cada despliegue requiere la cadena literal `AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — <PREFIJO>-<FASE>`. `CONTINUAR`, `SIGUE`, `OK` **no** son autorización.
2. **Prohibido cashback.** El premio son **puntos canjeables como descuento en producto**, con tope por pedido. Nunca saldo retirable ni acreditación en Wompi. La ruta `POST /api/xp-logs/convert-cashback` responde **410 Gone** a propósito.
3. **Un solo nivel de referidos.** Prohibido multinivel (riesgo regulatorio).
4. **Reportar con evidencia E0/E1/E2** (medido / inferido / sin verificar) y con la tabla de comandos. Un informe sin comandos no vale.
5. **Commits atómicos**, sin `--force`, sin tocar `main` a medias.

---

## 2 · Trampas del entorno (no las redescubras)

### El árbol de trabajo está COMPARTIDO con otro agente

`C:\Users\Compu casa\glowapp-firebase` lo usan dos sesiones a la vez, en `main`. Esto ya causó daño real:

- **Nunca `git add -A` ni `git add .`.** Solo rutas explícitas.
- **Nunca `git checkout -- .`, `git stash`, `git reset --hard` ni `git clean`.** El otro agente hizo un `checkout` y **borró cambios sin commitear** de esta sesión. Si algo que ya estaba desaparece, es eso.
- **Commitea en cuanto algo funciona.** No dejes trabajo en el árbol esperando a terminar.
- Antes de cada push: `git fetch && git rebase origin/main`. Si el rebase falla por árbol sucio, mira `git status` — suelen ser `pubspec.lock`.
- La otra sesión trabaja en `feat/publicidad-brand-motion` (widget de logo Rive, tokens de motion). **No toques ese carril** sin avisar: `glow_logo_animation.dart`, `motion_tokens.dart`, `provider_detail_screen.dart`.

### Comandos y verificaciones

| Qué | Cómo |
|---|---|
| Verificador de migraciones | **Desde la raíz:** `bash backend/scripts/verificar-cadena-migraciones.sh`. Desde `backend/` falla con `MODULE_NOT_FOUND`. Requiere **Docker Desktop** encendido; si el daemon está caído aborta con `EXIT=2`. |
| Hook de pre-push | Bloquea migraciones sin verificar (`MIGRACIONES_VERIFICADAS=1 git push`) **y compilación rota** (`COMPILACION_VERIFICADA=1` para saltarla). |
| `flutter analyze` | Devuelve cientos de `info`; lo que importa son las líneas ` error - ` o ` error • `. Usa `grep -cE " error - | error • "`. |
| Tests backend | `cd backend && JWT_SECRET=test-secret npx jest tests/<archivo>.test.js --runInBand`. `jest.config.js` tiene **`resetMocks: true`**: las implementaciones del factory se borran antes de cada test, hay que declararlas en el `beforeEach`. |
| Desplegar web | `flutter build web --release` con los `--dart-define` de abajo + `NODE_TLS_REJECT_UNAUTHORIZED=0 firebase deploy --only hosting --project glowapp-client`. **La autenticación de Firebase caduca y a veces falla una vez:** reintenta antes de asumir que está roto. |
| Verificar el despliegue | `md5sum build/web/main.dart.js` contra `curl -sL https://glowapp-client.web.app/main.dart.js`. Deben coincidir. |
| Shell en el contenedor | `railway ssh --service glowapp-api "…"` (funciona). Para Node dentro del contenedor: `NODE_PATH=/app/node_modules node /tmp/x.js`. La `DATABASE_URL` es **interna** de Railway: no se conecta desde tu máquina. |
| Código largo dentro del contenedor | Codifícalo en base64 local, y dentro: `echo <b64> | base64 -d > /tmp/x.js`. Evita el infierno de comillas entre bash, ssh y `sh`. |

### `--dart-define` del build web

```
API_URL=https://glowapp-api-production.up.railway.app
APP_AUDIENCE=client
FIREBASE_API_KEY=…  FIREBASE_PROJECT_ID=glowapp-client
FIREBASE_MESSAGING_SENDER_ID=634593218804
FIREBASE_STORAGE_BUCKET=glowapp-client.firebasestorage.app
FIREBASE_WEB_APP_ID=1:634593218804:web:c7fd6b92799072f9e04ea1
GOOGLE_WEB_CLIENT_ID=374223351186-…apps.googleusercontent.com
```

### Otras

- **Rive 0.13.20** (lo que hay instalado): la API es `placeHolder` (con H), `OneShotAnimation` no tiene `addListener` — los callbacks van en el constructor (`onStop`), y el import de tokens desde `widgets/motion/` necesita `../../`.
- **Navegador automatizado:** `hermes config set browser.use_real_profile false` si pide Chromium; **se vuelve a poner en `true` solo**, hay que repetirlo. La sesión de la app **no sobrevive a un recargado** en ese navegador (el token vive en `flutter_secure_storage` cifrado), así que para ver pantallas con sesión hay que iniciar sesión en la misma carga de página.
- **La máquina va justa de memoria:** los builds web tardan 2–4 min y Docker a veces no arranca. `flutter build web` puede tardar 175 s sin que nada esté mal.

---

## 3 · Qué está construido (y en qué estado)

### 3.1 Libro de puntos — separado del XP

Dos libros distintos, a propósito:

| Libro | Tabla | Qué es |
|---|---|---|
| **Puntos** (valen pesos) | `points_lots`, `points_movements` | Saldo canjeable. Lotes con vencimiento. |
| **XP** (estado) | `xp_logs` | Sube de nivel. No se gasta. |

**Reglas vigentes del programa:**

| Regla | Valor |
|---|---|
| 1 punto | $10 COP |
| Bloques de canje | 100 |
| Tope por pedido | 15 % del valor en productos |
| Mínimo de compra para canjear | $25.000 |
| Vencimiento del lote | 12 meses |
| Premio a quien invita | **500 puntos** ($5.000), cuando la invitada paga su primera compra ≥ $20.000 |
| Premio a la invitada | **100 puntos** ($1.000) en esa misma compra |
| Tope de premios | 10 por mes por referente |
| XP de bienvenida | **100 XP** al crear la cuenta (correo y Google) |
| Escalera | Glow 0 · Pétalo 300 · **Gold 900** · **Élite 2.000** |

Idempotencia por **columna `clave` única** en el movimiento, no por `UNIQUE(pedido_id, tipo)`.

**Ciclo del canje:** `comprometer` en la transacción del pedido → `consumir` en el webhook de pago → `liberar` en cancelación y en el job de 24 h. La base y el IVA **se recalculan después del descuento**; el envío gratis se cotiza antes.

### 3.2 Migraciones (la siguiente es la **153**)

| # | Qué |
|---|---|
| 142 | `points_lots` + `points_movements` (con backfill defensivo desde `xp_logs`) |
| 143 | `pedidos_tienda.descuento` y `puntos_canjeados` (+ rollback) |
| 144 | `referral_clicks` + control de premios/mes |
| 145 | Aviso de vencimiento de puntos |
| 146 | Huellas antifraude |
| 147 | Usuarios sin `tenant_id` (**¡trae guarda de `app_platform_tenant_id()`!**) |
| 148 | Productos sin tenant (misma guarda) |
| 151 | `ultimo_nivel_notificado` |
| 152 | `fecha_alta` en `usuarios` (con backfill desde `habeas_data_accepted_at`) |

**Toda migración nueva va registrada en LAS DOS listas** de `backend/scripts/prepareRlsDatabase.js` (`MIGRACIONES_BASE_NUEVA` y `MIGRACIONES_ARRANQUE`), salvo que sea sólo para bases nuevas — y entonces documenta por qué.

### 3.3 Backend

| Archivo | Qué hace |
|---|---|
| `services/pointsService.js` | Lotes, movimientos, FEFO, vencimiento |
| `services/xpService.js` | **Punto único de escritura de XP.** Calcula nivel antes/después y avisa si cambió. Toda acreditación de XP debe pasar por aquí. |
| `services/xpBienvenidaService.js` | 100 XP al registrarse, idempotente, a través del punto único |
| `services/referralService.js` | Atribución por `runAsSystem` (RLS forzada hacía que el UPDATE afectara 0 filas en silencio), premios 500/100, tope mensual |
| `services/cuotasService.js` | `exigirDisponibles()` → **402 `CUOTA_AGOTADA`** (dentro del orquestador, no en middleware, para no castigar aciertos de caché) |
| `jobs/nivelJob.js` | Cada 6 h: avisa subidas de nivel escritas por fuera del punto único |
| `jobs/puntosVencimiento.js` | Aviso de puntos por vencer |
| `config/programaPuntos.js` | Los montos y topes |
| `config/cuotasIA.js` | Niveles: `glow`, `petalo`, `oro` (**nombre `Gold`**), `diamante` (**nombre `Élite`**) |

**Endpoints relevantes:** `/api/rewards/points`, `/api/rewards/nivel`, `/api/rewards/reporte` (admin), `/api/auth/referral-info` (incluye `invitadas[]`), `/r/:codigo` (302 a `/register?ref=`), `/api/xp-logs/convert-cashback` (**410**).

### 3.4 Cliente

| Archivo | Qué |
|---|---|
| `packages/glow_core/.../rewards_service.dart` | `SaldoPuntos` (con `puntosAplicablesEn`, `pesosDe`), `NivelPuntos.desglose`, `obtenerSaldo`, `obtenerNivel` |
| `apps/glow_client/lib/widgets/chip_club.dart` | Chip del Club en el inicio (`❋ Pétalo · 350 XP`), 42 px. Se oculta **solo sin sesión**; si el backend falla muestra `Mi Club` |
| `apps/glow_client/lib/widgets/bloque_canje_puntos.dart` | Selector de canje del carrito (extraído de la pantalla para poder probarlo) |
| `apps/glow_client/lib/screens/niveles_screen.dart` | El Club: nivel, barra con hitos, riel de 4 nodos, cuota de IA, tarjeta de puntos, beneficios |
| `apps/glow_client/lib/screens/programa_puntos_screen.dart` | Condiciones públicas (`/programa-puntos`) |
| `apps/glow_client/lib/arranque_ruta.dart` | Guarda la ruta con la que abrió la app (para no montar el tour sobre el login) |
| `apps/glow_client/lib/main.dart` | `rutaDeArranque()` + `_empujarRutaDeLaUrl()` (empuja la ruta de la URL tras 1,2 s, cuando el Navigator ya está estable) |

### 3.5 CI y compuertas

- **`.github/workflows/backend-ci.yml`**: sintaxis, tests, contrato, **tests de integración contra Postgres real** (10 casos: 7 del libro de puntos + 3 de auth). Verde.
- **`.github/workflows/apps-ci.yml`**: `flutter analyze` + `flutter test` en cada push a `main` que toque `apps/**` o `packages/**`.
- **`scripts/pre-push-compilar.sh`** + hook en `.git/hooks/pre-push`: bloquea el push si el código Flutter no compila. Es la compuerta que faltaba: el 13-nov `main` quedó roto y se supo por casualidad.

---

## 4 · Defectos corregidos (para que no los reintroduzcas)

| Síntoma | Causa real | Arreglo |
|---|---|---|
| `DELETE /api/auth/delete-account` → **502 en 30 s** | **Abrazo mortal**: la transacción del request ya tenía bloqueo sobre la fila de `usuarios` (la auditoría inserta con clave ajena) y la anonimización corría en **otra** conexión. La segunda esperaba a la primera; la primera esperaba la respuesta | Anonimizar en la **misma** transacción, con `SET LOCAL ROLE app_system`. Hoy: **200 en 1,3 s** |
| `referred_by_user_id` quedaba `NULL` en silencio | `FORCE RLS`: el `UPDATE` afectaba 0 filas sin error | `atribuirInvitacion` por `runAsSystem` |
| `invitadas: []` con invitadas reales | La consulta usaba `created_at`, **que no existía**; el `catch` lo volvía lista vacía | Migración 152 (`fecha_alta`) + el `catch` ya registra el código de error |
| Alta con Google → 500 `xpBienvenidaService is not defined` | Llamada insertada sin el `require` | Import + test que recorre la rama con token válido |
| El XP de bienvenida nunca se acreditaba | `$3` reutilizado en el `INSERT` y en el `NOT EXISTS`: «inconsistent types deduced» | Motivo como literal |
| `/auth/login` y `/provider-detail/3` abrían el mapa | `_empujarRutaDeLaUrl` **no existía** — sólo el comentario que decía que existía | Implementado, con retraso de 1,2 s y reintentos |
| El tour tapaba el login | El tour lo lanza la pantalla del inicio, que sigue debajo | No arranca si la app abrió en otra ruta (`arranque_ruta.dart`) |
| El chip del Club no aparecía | Se ocultaba si había un **código de invitación guardado** | Eliminado ese guard; la tarjeta de invitación se encoge (`right: 150`) para dejarle sitio |
| Formulario de acceso con dos errores en rojo al entrar | `S4TextField` evalúa el validador en cada build | Valida solo con texto; y `_handleLogin` avisa antes de llamar (S4TextField **no es un FormField**) |
| Una base nueva no se podía construir | 147 dependía de `app_platform_tenant_id()`, que crea la 123 — **omitida en CI** | Guarda idempotente en 147 y 148; la 123 ya no se omite |
| Números ilegibles en el Club (`+I análisis`, `O puntos`) | Numerales en Cormorant Garamond (serif con cifras de estilo antiguo) | Numerales en Manrope negrita |

---

## 5 · Lo que FALTA (esto es tu trabajo)

### Bloqueantes de verificación — necesitan al Director

**V-1 · El chip del Club con una cuenta real.** Está desplegado y verificado con una cuenta de prueba, pero falta que el Director lo vea en su móvil. Si no aparece, el siguiente sospechoso es la sesión: comprobar si el Perfil deja entrar sin pedir cuenta.

**V-2 · Compra real de punta a punta.** Es la única prueba del dinero y **no se ha hecho nunca**. Debe demostrar, en una sola operación:
- el canje aplicado y el total descontado,
- el asiento en `points_movements` (compromiso → consumo),
- el premio de **500 puntos** a quien invitó,
- el lote con vencimiento a 12 meses.

Para sembrar saldo: o se paga una compra real, o se insertan lotes en `points_lots` dentro del contenedor (`railway ssh`). **No hay endpoint de admin para puntos.**

### Tareas de higiene

**H-1 · Cuenta de prueba viva en producción:** `vista.1794611525@glowapp.test`, creada para verificar el chip. Anonimizarla cuando el Director confirme (patrón: `UPDATE usuarios SET nombre='Usuario Eliminado', email='deleted_<id>_<ts>@glowapp.deleted', password_hash='', phone=NULL, is_active=false, fcm_token=NULL`). Las cuentas `demo.ana`, `demo.carla`, `demo.diana` **se conservan**.

**H-2 · Commit duplicado en la rama del otro agente:** el chip vive en `main` como `747ee97b` y también en `feat/publicidad-brand-motion` como `a58b2f5f`. Al rebasar esa rama git lo reconocerá como aplicado, pero conviene revisarlo antes de mezclar.

**H-3 · Ruido en el historial:** tres commits `chore(diag)` (`6c081b79`, `5eefd86e`, `d29accf8`) con logs de diagnóstico ya retirados. Aplastarlos exige `--force`, **prohibido** sobre árbol compartido. Se dejan.

**H-4 · Ruido de validación en el registro** (no en el login, que ya está): revisar si otros formularios muestran errores antes de escribir. La causa está en `S4TextField` y ya está resuelta para todos.

---

## 6 · Cómo verificar cualquier cosa (recetas)

### Backend

```bash
cd backend
JWT_SECRET=test-secret npx jest tests/pointsService.test.js tests/rewardsEndpoints.test.js \
  tests/xpBienvenida.test.js tests/nivelAviso.test.js tests/googleXpBienvenida.test.js \
  tests/referralInvitadas.test.js tests/deleteAccount.test.js --runInBand
```

### Integración contra Postgres real (lo que corre el CI)

```bash
DATABASE_URL=postgres://app_rls_user@localhost:5432/glowtest \
DATABASE_URL_ADMIN=postgres://postgres@localhost:5432/glowtest \
JWT_SECRET=test-secret USE_PG_MEM=false \
npx jest tests/pointsLedger.integration.test.js tests/auth.integration.test.js --runInBand
```

### Cliente

```bash
cd apps/glow_client
flutter analyze 2>&1 | grep -cE " error - | error • "     # debe dar 0
flutter test test/chip_club_test.dart test/niveles_screen_test.dart \
             test/bloque_canje_puntos_test.dart test/ruta_arranque_test.dart
```

### Producción (sondas rápidas)

```bash
API=https://glowapp-api-production.up.railway.app; H="X-App-Audience: client"
curl -s -H "$H" $API/api/health | jq '.commit, .migrations.registradas'
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" $API/api/rewards/points      # 401 sin token
curl -s -D - -o /dev/null $API/r/GLOWDF52 | grep -i location                  # 302 a /register?ref=
```

**La cabecera `X-App-Audience: client` es obligatoria en todo `/api`.** Sin ella los 401 se confunden con 400 y se pierde media hora.

### Sembrar/consultar datos en producción

`railway ssh --service glowapp-api "…"` funciona. La `DATABASE_URL` es interna: no se conecta desde tu máquina. Para scripts largos, base64 → `/tmp/x.js` → `NODE_PATH=/app/node_modules node /tmp/x.js`.

---

## 7 · Estado exacto al cerrar este traspaso

| | |
|---|---|
| `origin/main` | último commit del traspaso (mira `git log -1`) |
| Backend en producción | commit que reporte `/api/health` |
| Migraciones registradas | **22** (hasta 152) · la siguiente es la **153** |
| Web cliente | bundle verificado por `md5` contra el build local |
| CI backend | **verde**, con 10 tests de integración contra Postgres |
| CI apps | verde |
| Tests backend del programa | 88 (sin base) + 10 (con base) |
| Tests cliente | 6 del chip · 13 del Club · 6 del canje · 6 del arranque |

## 8 · Lo que NO debes hacer

- No acredites nada en Wompi ni crees saldo retirable: el premio es **descuento en producto**.
- No añadas multinivel de referidos.
- No escribas en `xp_logs` directamente: usa `xpService.acreditarXp`, o el aviso de nivel no sale.
- No anonimices cuentas con `DELETE`: la baja es **anonimización** (el `UPDATE` que ya existe).
- No toques el carril de motion del otro agente sin coordinarlo.
- No dejes cambios sin commitear en ese árbol: desaparecen.
- No declares «funciona» sin una salida de comando que lo respalde. En este proyecto, tres defectos nacieron de un `catch` que ocultaba un error real.
