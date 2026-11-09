# Plan de corrección — app CLIENTE (`apps/glow_client`)

**Base:** auditoría del 2026-11-09 · rama `main` @ `78fb1070` · bundle desplegado idéntico al build local
**Estado medido:** 24 PASA · 34 PARCIAL · 9 FALLA · 17 N/V · 2 N/A = **48,8 % de ejecución** (61,2 % sobre lo medible)
**Objetivo:** llegar a **0 FALLA**, **0 bloqueantes en PARCIAL** y **0 críticos en rojo** en `tools/auditoria_cliente.py`.
**Regla de oro:** nada de esto se ejecuta sin `AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — GLOWAPP-F<NN>`. Rama de trabajo propia, commits atómicos, `main` intacta hasta la fase autorizada.

---

## Fase 0 — Dos hallazgos que cambian la conversación (antes de tocar código)

| | Hallazgo | Evidencia | Decide |
|---|---|---|---|
| 0.1 | **GlowShop está vacío en producción**: los 16 productos tienen `tenant_id = 2` (Demo) y el catálogo anónimo corre con el tenant de plataforma `1` bajo RLS | `GET /api/products` → `count:0`; sonda en el contenedor: 16 productos, tenant 2; `tenants` 1 = plataforma, 2 = Demo; `productos` con `relforcerowsecurity` | Director: mover el catálogo al tenant 1 **o** marcar tenants con catálogo público (P-122) |
| 0.2 | **La API sigue conectando como superusuario**: `current_user = postgres`, `rolsuper` y `rolbypassrls` = true | Sonda en `glowapp-api`; P-092 se reportó cerrado, P-112/115/116 siguen abiertos (P-123) | Si se arregla 0.1 solo con datos, RLS sigue decorativa fuera de las rutas envueltas |

Sin decisión en 0.1, C-05 y C-06 se hacen sobre un catálogo que no se ve.

---

## Fase 1 — P0: lo que el usuario ve hoy (1 sesión)

| ID | Cambio | Archivo | Criterio de aceptación | Esf. |
|---|---|---|---|---|
| **C-01** | Sacar `/api/analytics/events` de `authMiddleware` y ponerle límite por IP (reusar `otpLimiter` a 60/min); el controller ya guarda `user_id: null`, la autenticación no aporta aislamiento | `backend/src/routes/analyticsRoutes.js:9` | `POST /api/analytics/events` sin token → 2xx; `auditoria_cliente.py` E4 en PASA | 0,5 h |
| **C-02** | No llamar endpoints autenticados sin sesión: `bookings/client` (home), `users/delivery-addresses`, `chat/conversations`, `analytics` | `providers_screen.dart` (carga inicial), `user_profile.dart`, `chat_list_screen.dart` | carga anónima sin 401 en consola (`sonda_web_cliente.py`); P-124 | 1 h |
| **C-03** | Errores humanos: sustituir `'Error de conexión: $_error'` y `'Error al cargar chats: $_error'`, y los 3 `$e` por `mensajeHumano(e)`; si no hay sesión, ofrecer «Iniciar sesión» en vez de error | `client_bookings_screen.dart:1272`, `chat_list_screen.dart:188`, `otp_confirm_screen.dart:100`, `store_screen.dart:92,757` | `auditoria_cliente.py` B1 en PASA (0 directos, 0 por variable); P-126 | 1,5 h |
| **C-04** | Quitar `fallbackSlots` y `fallbackProducts`: ante fallo, estado de error con «Reintentar». Un horario inventado se convierte en una reserva rechazada | `booking_screen.dart:218-240, 267-277` | grep sin `09:00`/`10:30`/`14:00` hardcodeados; test de widget que simula fallo y exige el mensaje de error; P-127 | 2 h |
| **C-05** | ~~Catálogo~~ **Diferida (D-GL-029):** los 16 productos son mock y el entorno es simulación (Wompi sandbox). Solo se ejecuta si hay demo comercial o se carga catálogo real: alinear `productos.tenant_id` al tenant 1 | — | — | 0 h (1 h si se reabre) |
| **C-06** | ~~Rol de runtime: `app_rls_user`~~ **Ya resuelto (verificado 2026-11-09):** el entrypoint reescribe `postgres(ql)://`, aborta si no cambia y verifica `app_rls_user` sin BYPASSRLS; `pg_stat_activity` lo confirma tras tráfico real. No requiere sesión | — | — (cierra P-112/P-113/P-123) | 0 h |

**Puerta F1:** `python tools/auditoria_cliente.py --json ...` sin críticos B1/C3/E4; una carga anónima limpia (0 respuestas 401). E3 (catálogo) es informativo desde D-GL-029: dato mock, no bloquea.

---

## Fase 2 — Build y despliegue (media sesión)

| ID | Cambio | Archivo | Criterio | Esf. |
|---|---|---|---|---|
| **C-07** | `desplegar-web.sh` pasa `--dart-define FIREBASE_API_KEY/PROJECT_ID/MESSAGING_SENDER_ID/STORAGE_BUCKET/WEB_APP_ID/GOOGLE_WEB_CLIENT_ID`, y aborta si faltan (misma guarda que ya tiene para `API_URL`) | `scripts/desplegar-web.sh:45` | bundle publicado con `AIzaSy` > 0 (`auditoria_cliente.py` C3 PASA); FCM obtiene token | 0,5 h |
| **C-08** | Cargar `CLIENT_FIREBASE_API_KEY` y `FCM_VAPID_KEY` (P-001/P-002) — depende del Director | Firebase Console / GitHub Secrets | idem | — |
| **C-09** | CI de apps: arreglar `GOOGLE_SERVICES_JSON` (hoy malformado) o sacar el job APK hasta tenerlo; disparar `apps-ci` en push a `main` con `paths: apps/** packages/**` | `.github/workflows/apps-ci.yml:250` | `gh run list --workflow=apps-ci.yml` en verde sobre `main`; P-128 | 1 h |

**Puerta F2:** el deploy deja de ser manual y el artefacto publicado lleva Firebase.

---

## Fase 3 — Accesibilidad y marca (1 sesión)

| ID | Cambio | Criterio | Esf. |
|---|---|---|---|
| **C-10** | `Semantics` en detalle de prestador, reserva, pago, chat y perfil (hoy 8 en 29.118 líneas); `tooltip` en los 27 `IconButton` sin etiqueta | B2 en PASA; recorrido con lector de pantalla en dispositivo | 4 h |
| **C-11** | Contraste: `#D4AF37`/`#C5A052`/`#E05A47`/`#C88A68` solo como relleno; texto → `#8A6A2F` (5,02:1) o `#7A6A5A` (5,2:1) | B3 en PASA (0 colores < 4,5:1) | 2 h |
| **C-12** | `themeMode` desde el sistema + respetar `MediaQuery.disableAnimations`; `Locale` no forzado (`es` por defecto, `en` alcanzable) | B4 en PASA | 1 h |
| **C-13** | `index.html`: título «GlowApp», descripción real, `theme-color`, manifest; publicar `/terms` con contenido (hoy devuelve el shell) | C1 y D3 en PASA; P-129 | 1 h |

---

## Fase 4 — Cerrar los PARCIAL que bloquean lanzamiento (1-2 sesiones)

| ID | Ítem | Qué falta | Criterio |
|---|---|---|---|
| C-14 | #31 recibos | Comprobante descargable de reserva y de pedido | PDF/HTML servido y enlazado desde «Mis citas» |
| C-15 | #27 pago real conciliado | Conciliar una reserva pagada (no solo tienda) | Transacción real ↔ reserva ↔ recibo, con evidencia |
| C-16 | #71 soporte | Horario y SLA publicados en la app y en la web | Texto visible + prueba de respuesta |
| C-17 | #68/#70 observabilidad | Panel de embudo y errores 5xx con contexto | Consulta que devuelve eventos por pantalla |
| C-18 | #77/#76 operación | `pg_dump` real y rollback cronometrado | Restore y rollback ejecutados, con tiempos |
| C-19 | #11/#13/#14/#16 permisos, push y deep links | JIT real, opt-in tras valor, cold/warm link | Prueba en dispositivo (Android APK de C-09) |

---

## Fase 5 — Instrumentar los 17 N/V (necesita dispositivo o monitor)

Crash-free %, arranque en frío, fluidez, red lenta, memoria, batería/GPS, ficha de tienda, data safety, edad, baja de comunicaciones, multi-dispositivo, foco/teclado web, escalado a 200 %, reconciliación diaria. **Son gaps de instrumento, no deuda**: sin medidor no se pueden aprobar ni rechazar.

---

## Orden y dependencias

```
0.1 decisión de datos ──► C-05 ──► E3 verde
C-01 ──► E4 verde ──► C-17 (embudo)
C-02 + C-03 ──► consola limpia
C-04 ──► reserva honesta ──► C-15
C-07 + C-08 + C-09 ──► C-19 (dispositivo) ──► Fase 5
C-06 ──► aislamiento real (antes de cualquier dato multi-tenant)
```

## Seguimiento (tabla viva — actualizar al cerrar cada tarea)

Gantt visual: [`plan-seguimiento.html`](plan-seguimiento.html) (760 px, abre en el panel de preview).
Leyenda: **hecho** · **siguiente** (F9.1) · **pendiente** · **bloqueado** (tercero) · **diferido** (disparador).

| ID | Fase | Tarea | h | Estado | Verificación |
|---|---|---|---|---|---|
| — | F0 | Diagnóstico + D-GL-029 + brief G-1 | 0 | **hecho** | linter PASS, 97 archivos |
| C-01 | F1 | Analítica pública con rate limit | 0,5 | **hecho** (`9f294ae4`) | E4 PASA: POST sin token → 201 |
| C-02 | F1 | No llamar endpoints privados sin sesión | 1 | **hecho** | sonda: 0 respuestas 401 |
| C-03 | F1 | Errores humanos en citas y chat | 1,5 | **hecho** | B1 PASA (0 sitios) |
| C-04 | F1 | Quitar horarios y productos inventados | 2 | **hecho** | invariante de fuente 4/4 |
| C-05 | — | Catálogo mock (tenant) | 0 | **diferido** | D-GL-029, disparador |
| C-06 | — | Rol `app_rls_user` | 0 | **hecho** | `pg_stat_activity` |
| C-07 | F2 | `desplegar-web.sh` pasa `FIREBASE_*` | 0,5 | pendiente | C3 PASA |
| C-08 | F2 | Cargar API key y VAPID | — | **bloqueado** (Director) | idem |
| C-09 | F2 | CI de apps verde en push | 1 | pendiente | `gh run list` success |
| C-10 | F3 | Semantics + tooltips | 4 | pendiente | B2 PASA |
| C-11 | F3 | Contraste | 2 | pendiente | B3 PASA |
| C-12 | F3 | Tema del sistema + reduce-motion | 1 | pendiente | B4 PASA |
| C-13 | F3 | Marca y `/terms` | 1 | pendiente | C1 y D3 PASA |
| C-14 | F4 | Recibos | 2 | pendiente | ítem 31 PASA |
| C-15 | F4 | Pago real conciliado | — | **diferido** | llaves `pub_prod_` |
| C-16 | F4 | Soporte con SLA | 1 | pendiente | ítem 71 |
| C-17 | F4 | Embudo y 5xx | 3 | pendiente | ítems 68/70 |
| C-18 | F4 | Backup + rollback | 3 | pendiente | ítems 77/76 |
| C-19 | F4 | Permisos, push, deep links | 4 | pendiente | ítems 11/13/14/16 |
| F5 | F5 | Instrumentar 17 N/V | — | pendiente | primera medición por ítem |

**Total activo:** 12 tareas · **≈22,5 h** · críticos en rojo hoy: B2, B3, C3 (3). F1 cerrada 2026-11-09.

## Cómo se re-verifica (lo que queda guardado)

```bash
# 1. Medible, ~3 min con analyze+tests, 30 s en --rapido
python tools/auditoria_cliente.py --json docs/auditoria/auditoria-cliente-$(date +%F).json \
                                  --md   docs/auditoria/auditoria-cliente-$(date +%F).md
#    sale 1 si queda algún crítico (B1, B2, B3, C3, E3, E4) y compara con el último estado guardado

# 2. Lo que ve el usuario: home, guide, lista, perfil, reserva + consola y red
python tools/sonda_web_cliente.py --guia --pasos "Ver lista|Ver Perfil" \
       --salida docs/auditoria/shots/cliente

# 3. Estado por ítem (86) para el informe: docs/auditoria/estado-cliente-2026-11-09.json
```

## Qué NO se hace en este plan

- No se reescribe `booking_screen` (1.759 líneas): se recortan los fallbacks y se añade estado de error.
- No se toca `main` ni se despliega a producción sin la autorización y la verificación de las fases previas.
- No se "arregla" RLS cambiando solo el rol: primero C-05 (datos) y prueba en staging, porque el PR #17 ya tumbó producción 10 minutos.
- No se declaran PASA los N/V: se instrumentan o se reportan como gap.
