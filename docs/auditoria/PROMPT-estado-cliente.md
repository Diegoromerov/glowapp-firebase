# PROMPT — Estado de la app CLIENTE (glow_client) y tareas pendientes

> Handoff para un chat nuevo. El agente **no modifica nada** hasta recibir la autorización exacta del Director.

---

## ROL Y CONTEXTO

Eres el ingeniero a cargo de la **app de clientes de GlowApp** (reservas de servicios de belleza). Recibes el estado del proyecto tras una auditoría de prelanzamiento y una primera ronda de correcciones.

**Repositorio:** `C:\Users\Compu casa\glowapp-firebase` (monorepo melos)
**App:** `apps/glow_client` — 72 archivos Dart, ~29.000 líneas
**Compartido:** `packages/glow_core` (servicios y widgets usados por cliente y prestador)
**Backend:** `backend/` → Railway `glowapp-api`
**Producción:** API `https://glowapp-api-production.up.railway.app` · Web `https://glowapp-client.web.app`
**Ramas:** `main` (producción) · `staging` (validación)

**Documentos que debes leer antes de tocar nada:**
- `docs/auditoria/baseline-2026-11-05.json` — 86 ítems, estado inicial
- `docs/auditoria/comparativa-2026-11-05.md` — qué cambió y qué quedó
- `docs/auditoria/PROMPT-ejecucion-plan.md` — plan de correcciones por fases
- `.hermes/plans/2026-11-05_075833-auditoria-prelanzamiento-cliente.md` — auditoría con evidencia

---

## ⛔ REGLA DE ARRANQUE

**No ejecutes nada al recibir este prompt.** Primero: confirma que leíste los documentos, verifica el repositorio y presenta el estado que entiendes + la tarea que propones. Después pide:

```
AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — GLOWAPP-CLIENTE
```

Sin esa cadena exacta no hay commits, despliegues ni cambios de esquema. «Continúa», «sigue», «dale» u «ok» **no** son autorización.

---

## ESTADO ACTUAL (medido)

Auditoría de 86 ítems: **26 PASA · 34 PARCIAL · 8 FALLA · 16 no verificable · 2 no aplica**.

De los 12 bloqueantes de lanzamiento, 9 están en verde.

### Lo que ya funciona y está verificado en producción

| Área | Evidencia |
|---|---|
| Flujo completo de cita | E2E 13/13: reserva → pago Wompi → reprogramación → propina → cancelación |
| Pago | Wompi sandbox: `202` + evento firmado `200` → cita `CONFIRMADA` / `payment_status: paid` |
| Idempotencia de reserva | Dos POST idénticos → `200`, mismo `booking_id`, `idempotente: true`, 1 fila |
| Aislamiento multi-tenant | RLS 37/37 tablas; lectura cross-tenant solo bajo `app_system` con validación en el `WHERE` |
| Autorización por objeto | OTP de una cita ajena → 401/403 |
| Rate limiting | auth 10/15 min · OTP 5/10 min · pagos 20/15 min |
| TLS/HSTS | `strict-transport-security: max-age=31536000` |
| Correo transaccional | Brevo por API HTTP (Railway bloquea SMTP saliente), envío con id verificado |
| `/api/health` | 200 sin `X-App-Audience` (antes 400 y los monitores marcaban caída) |
| Errores al usuario | 11 sitios con `$e` crudo traducidos con `mensajeHumano()` |
| Borrado de cuenta | Pantalla in-app con confirmación escrita → `DELETE /api/auth/delete-account` |
| Privacidad | Pantalla + `https://glowapp-client.web.app/privacy.html` (200, contenido real) |
| Borrado publicado | `https://glowapp-client.web.app/account-deletion.html` (200) |
| Permisos Android | INTERNET, ACCESS_FINE/COARSE_LOCATION, POST_NOTIFICATIONS en el manifiesto de release |
| Contraste de texto | 37 usos del dorado: 2,46:1 → 5,02:1 (`#C5A052` → `#8A6A2F`) |
| Reporte de fallos | `CrashReportingService` propio + errores asíncronos + alerta por correo ante `APP_CRASH` |
| Backups | Drill de restauración: 4 tablas, conteos idénticos, 23 índices (no es `pg_dump`) |
| Base URL | La web apunta a la API real; antes llamaba a su propio hosting y todo moría en `json.decode` |

### Fallas abiertas (8)

| # | Ítem | Qué falta |
|---|---|---|
| 11 | Permisos just-in-time | `geolocator` no solicita el permiso en runtime |
| 14 | Deep links | Sin `app_links` ni `intent-filter`: los enlaces de correo solo abren en web |
| 31 | Recibos / facturas | Sin comprobante descargable ni correo de recibo |
| 41 | Inventario de datos | Sin documento de qué se guarda, dónde y por cuánto |
| 59 | Movimiento reducido | No se consulta la preferencia del sistema |
| 73 | Estado del servicio | Sin página ni canal de estado |
| 78 | Migraciones seguras | La 125 fuera del entrypoint; la 126 tumbó producción |
| 80 | Feature flags | Sin mecanismo para apagar una función sin publicar |

### Deudas parciales que pesan

- **27 Pago real**: solo verificado en sandbox; falta una transacción con dinero real.
- **30 Reembolsos**: el estado no se muestra al usuario.
- **76/77 Rollback y backups**: sin procedimiento cronometrado ni restauración real de un binario.
- **55/56 Accesibilidad**: escalado a 200 % sin probar; etiquetas solo en pantallas principales.
- **84 Push**: `firebase-admin` y `PushService` listos, ningún dispositivo ha registrado token.
- **16 Versionado mínimo**: el backend publica `minimum_app_version`; la app no lo consume.
- **41 inventario**, **44 logs sin PII**, **39 MASVS**: sin auditar a fondo.

### Deuda estructural (fuera de la lista, no tocar sin autorización específica)

- Cita huérfana `ce334fab` bloqueada por el trigger `enforce_append_only` de `wallet_transactions`.
- `app_usuario_por_email` (migración 125) existe en producción pero no en bases nuevas.
- Producción conecta como `postgres`; el aislamiento depende de `SET LOCAL ROLE`, no del rol.
- Staging conecta como superusuario: **RLS inerte allí**.
- `DATABASE_URL` del contenedor = superusuario; verificar antes de asumir aislamiento.

---

## TAREAS PENDIENTES, EN ORDEN

### Bloque A — Fallas de auditoría (media jornada en total)

1. **11** — Pedir permiso de ubicación antes de abrir el mapa; manejar `permanentlyDenied` con acceso a ajustes. Archivo: `lib/screens/providers_screen.dart`.
2. **59** — Respetar `MediaQuery.disableAnimations`: duración cero en animaciones de mapa y paneles. Archivo: `lib/main.dart`, `providers_screen.dart`.
3. **73** — Página `web/status.html` con monitor externo y canal de soporte; enlace desde soporte.
4. **41** — `docs/privacidad/inventario-datos.md`: dato, finalidad, base legal, retención, ubicación.
5. **78** — Reincorporar migración 125 al entrypoint solo si es idempotente; prueba de arranque con base vacía.

### Bloque B — Funcionalidad de producto

6. **14** — Deep links (`app_links` + `intent-filter`) hacia `/booking-tracking/:id`, `/provider-detail/:id`, `/auth/accept-invitation`.
7. **31 + 30** — Recibo descargable y por correo; `refund_status` visible en «Mis citas».
8. **80** — Feature flags: `GET /api/config/flags` + servicio en `glow_core`, gobernando propinas y GlowStore.
9. **16** — Consumir `minimum_app_version` y forzar actualización.

### Bloque C — Cierre comercial

10. **27** — Una transacción real de extremo a extremo y su conciliación manual contra Wompi.
11. **84** — Verificar que un dispositivo registra token FCM y recibe un push de prueba.
12. **76/77** — Rollback cronometrado y restauración real de backup en staging.

---

## REGLAS DE TRABAJO

1. **Evidencia primero**: E3 producción · E2 ejecución · E1 código · E0 no verificable. Sin salida de comando no hay afirmación.
2. **Nunca inventes resultados**; si falla, el error exacto.
3. Producción no es terreno de pruebas: nada de `ALTER TABLE`, `REINDEX` ni borrados sin autorización específica.
4. Commits atómicos en español; push a `main` **y** `staging`.
5. Despliegue web solo con `./scripts/desplegar-web.sh glow_client glowapp-client`. **Nunca** `flutter build | tail && firebase deploy`: la tubería oculta el fallo y publica el bundle anterior (pasó ya una vez).
6. Antes de desplegar: `dart analyze lib` con 0 errores y `flutter test` en verde.
7. Secretos siempre `[REDACTADO]`.
8. No tocar `ce334fab`, ni `enforce_append_only`, ni el rol de conexión de producción.
9. Un bloque por autorización. Al terminar: para y reporta.

---

## FORMATO DEL REPORTE

```
BLOQUE <A|B|C> — <título>
Autorización: AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — GLOWAPP-CLIENTE

Cambios
- archivo:línea — qué y por qué

Verificación
- comando → salida (0 / 200 / n filas)
- bundle desplegado → texto comprobado

Ítems
- <n> <título>: ANTES → AHORA (E<nivel>)

Pendientes nuevos
- ...

Siguiente bloque propuesto: <...> — esperando autorización
```

## PRIMER PASO

Lee los documentos, verifica el repo y presenta tu lectura del estado + el plan del **Bloque A**. Luego pide:

```
AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — GLOWAPP-CLIENTE
```

No modifiques archivos ni ejecutes comandos de escritura antes de eso.
