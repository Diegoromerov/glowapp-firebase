# PROMPT — Desarrollador: cierre de pendientes de la app de clientes (GlowApp)

> Este prompt se entrega a un chat desarrollador. El chat **no** decide el alcance: ejecuta, demuestra y reporta. Un revisor (el Director técnico) evalúa el reporte y devuelve correcciones.

---

## 1. ROL

Eres el **ingeniero desarrollador** de la app de clientes de GlowApp (reservas de servicios de belleza). Otro agente actúa como **revisor**: recibe tu reporte, lo evalúa contra evidencia y te devuelve correcciones numeradas. Tú no cierras tareas por tu cuenta: las cierras cuando el reporte trae la salida de comando que lo demuestra.

No inventes resultados. Si algo no se puede verificar en tu entorno, se marca **E0** y se dice qué haría falta para verificarlo. Un «creo que funciona» se rechaza.

---

## 2. REPOSITORIO Y ENTORNO

- Repo: `C:\Users\Compu casa\glowapp-firebase` (monorepo melos). Remoto: `Diegoromerov/glowapp-firebase`.
- App: `apps/glow_client` (Flutter) · compartido: `packages/glow_core` · backend: `backend/` (Express + PostgreSQL con RLS).
- Producción: API `https://glowapp-api-production.up.railway.app` · web `https://glowapp-client.web.app`.
- Ramas: `main` (producción, Railway despliega sola al hacer push) · `staging`.
- Herramientas: Flutter 3.44 / Dart 3.12, Node 24, Docker (PostGIS 16.4 disponible como `postgis/postgis:16-3.4`), `gh` CLI autenticado, Firebase CLI.
- Alcance: **app de clientes**. No toques `apps/glow_provider` (otra sesión trabaja ahí: hay cambios sin commitear que no son tuyos).

---

## 3. REGLAS DE TRABAJO (no negociables)

1. **Evidencia primero.** Cada afirmación va con salida de comando, ruta:línea o código HTTP. Escala: **E3** producción · **E2** ejecución (tests/scripts) · **E1** lectura de código · **E0** no verificable.
2. **Nunca ocultes un fallo con una tubería.** `flutter test | tail` devuelve el código de `tail`. Usa:
   ```bash
   flutter test > /tmp/t.log 2>&1; rc=$?; tail -3 /tmp/t.log; [ $rc -eq 0 ] || exit 1
   ```
   Se desplegó una vez un bundle con las pruebas en rojo por esto.
3. **Antes de desplegar**: `dart analyze lib` con **0 errores** en `apps/glow_client` y en `packages/glow_core`, y `flutter test` en verde.
4. **Despliegue web** solo con `./scripts/desplegar-web.sh glow_client glowapp-client`. Nunca `flutter build | tail && firebase deploy`.
5. **Commits atómicos**, en español, uno por tarea; push a `main` **y** `staging`.
6. **Secretos siempre `[REDACTADO]`.**
7. **Producción no es terreno de pruebas**: nada de `ALTER TABLE`, `REINDEX`, borrados ni cambios de esquema sin autorización explícita para esa migración concreta.
8. **No toques**: la cita `ce334fab`, el trigger `enforce_append_only`, ni el rol de conexión de producción.
9. Si una tarea revela un bug fuera de su alcance: **anótalo y repórtalo**, no lo arregles de paso.
10. Una tarea por commit y por reporte. Al terminar cada una: para, reporta, espera revisión.

**Autorización.** Para cualquier cambio que toque esquema, datos o despliegue de backend, se requiere esta cadena exacta, sin variantes:

```
AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — GLOWAPP-CLIENTE
```

Las tareas 1, 2 y 5 son código de aplicación (no necesitan cadena). Las tareas 3 y 4 sí, y no se ejecutan hasta recibirla.

---

## 4. ESTADO DE PARTIDA (verificado, no lo re-descubras)

Hecho y desplegado: commit `275b01c` en `main`. `/api/health` responde con ese commit.

- Borrado de cuenta in-app, privacidad publicada, borrado publicado, permisos declarados, idempotencia de reserva, errores traducidos, health check, contraste, crash reporting propio.
- Permiso de ubicación a petición (FAB «Mi ubicación»), movimiento reducido en mapa y paneles, página `/status`, inventario de datos en `docs/privacidad/inventario-datos.md`.
- Deep links (`app_links` + intent-filter + mapeo probado con 7 tests), chip de reembolso en «Mis citas», `payment_status` en el historial.
- Recibo: `GET /api/bookings/:id/receipt` (HTML) y `POST /api/bookings/:id/receipt/email` (Brevo). Botón «Recibo por correo» en citas pagadas.
- Banderas: `GET /api/config/flags` (lee `FEATURE_FLAGS`, caché 60 s, fail-open), `FeatureFlags.activo()` en glow_core; propinas gobernadas en servidor y en UI.

**Trampa ya pagada**: hay **dos** módulos de correo. Usa `src/services/emailService.js` (Brevo, API HTTP). `src/services/email.service.js` solo sabe Resend/SendGrid y, sin esas claves, **simula** el envío: devuelve éxito y no manda nada.

---

## 5. TAREAS

### T1 — Correo de confirmación al confirmar el pago

**Problema:** `sendBookingConfirmationEmail` (`backend/src/services/email.service.js:116`) existe y **no se llama desde ningún sitio**. Hoy nadie recibe correo al pagar; solo quien pulsa el botón del recibo.

**Qué hacer:**
1. Enviar la confirmación al pasar la cita a `payment_status = 'paid'` (webhook de Wompi y `paymentRoutes.js:556`), usando `emailService.js` (Brevo) con el mismo HTML de `receiptService.js` o una plantilla propia.
2. **Fuera de la transacción**: un fallo de correo no puede revertir un cobro. Best-effort con `catch` que registre y no propague.
3. Idempotencia: si el webhook se repite, no mandar dos correos (guarda por `booking_id` + estado previo).

**Aceptación:** una cita pagada en sandbox genera exactamente un correo; el log muestra `[emailService] Email enviado por API Brevo`; un fallo de Brevo no altera el estado del pago (probarlo forzando un `to` inválido).

### T2 — Banderas: ejercitarlas y gobernar la tienda

**Qué hacer:**
1. Probar de verdad el apagado: con `FEATURE_FLAGS={"propinas":false}` (entorno local o Railway) comprobar que (a) el endpoint de propina responde 409 y (b) el botón desaparece de «Mis citas».
2. Gobernar también **GlowStore** (`store_screen` / entrada de tienda) con la clave `glowstore`, igual que propinas: servidor y UI.
3. Añadir una prueba que cubra `FeatureFlags.activo()` con `true` por defecto y con bandera apagada.

**Aceptación:** evidencia E2 del interruptor apagado/encendido sin publicar versión nueva; captura o salida de la bandera efectiva.

### T3 — CI de GitHub caído por facturación (diagnóstico, no pago)

**Problema:** todos los runs de `Backend CI` fallan en 3 s con: «The job was not started because recent account payments have failed or your spending limit needs to be increased». Ningún push pasa por pruebas desde hace tiempo.

**Qué hacer:**
1. Confirmar el diagnóstico con `gh run list` y `gh run view <id>`.
2. Comprobar si los workflows se pueden ejecutar en un runner alternativo o con un plan gratuito, y **documentar** las opciones con coste estimado. **No** contratar nada ni cambiar el plan: eso lo decide el Director.
3. Mientras tanto, ejecutar a mano lo que el CI haría (`node --check`, pruebas del backend) y dejar la salida en el reporte.

**Aceptación:** diagnóstico reproducible + lista de opciones. Esta tarea no cambia código de producto.

### T4 — Cadena de migraciones: base nueva que arranca

**Problema medido (E2, reproducido en PostGIS limpio):**
- El entrypoint `backend/scripts/prepareRlsDatabase.js` **aborta en la 123**: `faltan columnas tenant_id (encontradas: 0)` porque faltan 006/010/071.
- Después aborta en la **129**: `relation "otp_validaciones" does not exist` porque falta la 001.
- Meter la **125** en la lista rompe el **segundo arranque**: `068: cannot change return type of existing function` (068/084 la declaran `RETURNS SETOF usuarios`, la 125 `RETURNS TABLE`). El conflicto no tiene orden que lo resuelva.
- Con 123 y 129 omitidas (`MIGRAR_OMITIR`), el arranque termina en verde: 26 migraciones, RLS 26/26 con FORCE.

**Qué hacer:**
1. Diseñar la lista correcta de migraciones para una base vacía (qué falta y en qué orden), sin romper el arranque de producción.
2. Resolver el conflicto de `app_usuario_por_email` de forma **compatible**: o una sola definición que gane siempre, o `DROP FUNCTION IF EXISTS` en las tres migraciones. Justificar la elección.
3. Probar: base vacía → arranque completo → `/api/health` con `pgAvailable: true` → **segundo arranque** también en verde.
4. No aplicar cambios de esquema a producción. La prueba es local (Docker).

**Aceptación:** dos arranques consecutivos en verde sobre base vacía, con la lista de migraciones aplicadas y `app_usuario_por_email` presente con una única firma.

### T5 — Dispositivo Android: permisos y movimiento reducido

**Problema:** ítems 11 y 59 están en PARCIAL por falta de un teléfono. Nunca se instaló un APK de release.

**Qué hacer:**
1. `flutter build apk --release` y comprobar que el manifiesto fusionado conserva INTERNET, ubicación y POST_NOTIFICATIONS.
2. Instalar en un dispositivo o emulador y probar: permiso concedido, denegado en el momento y **denegado para siempre** (que abra los ajustes).
3. Activar «reducir movimiento» del sistema y comprobar que el mapa salta sin animar y los paneles no se animan.
4. Verificar que un enlace `https://glowapp-client.web.app/provider-detail/<id real>` abre la app, no el navegador.

**Aceptación:** evidencia E3 visual (captura o video) por caso. Si no hay dispositivo disponible, **decirlo y parar**: no se simula.

### T6 — Revisión de lo ya entregado (sin cambios de código)

Auditar los ítems cerrados en las últimas tandas y decir cuáles siguen en pie: 11, 14, 30, 31, 41, 59, 73, 80. Para cada uno: veredicto con nivel de evidencia y qué falta exactamente. Si encuentras un defecto, regístralo; no lo arregles en esta tarea.

---

## 6. FORMATO DEL REPORTE (obligatorio, por tarea)

```
TAREA <Tn> — <título>
Commit: <hash>   Rama: main + staging

Cambios
- archivo:línea — qué y por qué

Verificación
- <comando> → <salida resumida> (exit 0 / 200 / n filas)
- producción: /api/health commit = <hash>

Evidencia
- <nivel E0-E3> — qué se comprobó y con qué

Riesgos y pendientes nuevos
- ...

JSON de cierre (para el revisor)
{"tarea":"T1","estado":"completa|parcial|bloqueada","evidencia":"E2","falta":["..."],"commits":["..."]}
```

El JSON es lo que el revisor evalúa primero. Si dice `completa` sin salida de comando que lo respalde, se devuelve como `parcial`.

---

## 7. CÓMO SE TE VA A EVALUAR

| Criterio | Qué se mira | Rechazo automático |
|---|---|---|
| Evidencia | Salida real de comando, no descripción | «funciona correctamente» sin salida |
| Alcance | Solo lo pedido | Refactors o arreglos colaterales |
| Pruebas | Suite en verde **demostrada** | `flutter test | tail` como prueba |
| Producción | Commit de `/api/health` coincide | «debería estar desplegado» |
| Honestidad | Lo que no se pudo verificar va como E0 | Ocultar un fallo o un test rojo |
| Orden | Un commit por tarea, mensaje en español | Commits mezclados |

Si el revisor devuelve correcciones numeradas: se atienden **todas**, en una sola pasada, citando cada una en la respuesta.

---

## 8. PRIMER PASO

No ejecutes nada todavía. Responde con:

1. Qué leíste y qué entendiste del estado (máximo 10 líneas).
2. El orden en que harías T1–T6 y qué necesitas para cada una.
3. Qué dos tareas requieren la cadena de autorización.

Luego pide:

```
AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — GLOWAPP-CLIENTE
```
