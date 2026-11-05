# Auditoría de prelanzamiento — app de clientes (glow_client)

**Fecha:** 2026-11-05 · **Alcance:** `apps/glow_client` + API de producción `glowapp-api` · **Sin cambios de código**

Escala de evidencia:

| Nivel | Significado |
|---|---|
| **E3** | Comprobado contra producción (API real o bundle desplegado) |
| **E2** | Comprobado ejecutando (tests, analizador, scripts) |
| **E1** | Comprobado leyendo el código |
| **E0** | No verificable en este entorno (requiere dispositivo, tienda o medición) |

Veredictos: **PASA** · **PARCIAL** (existe pero incompleto) · **FALLA** · **N/V** (no verificable) · **N/A**

---

## Resumen

| Bloque | PASA | PARCIAL | FALLA | N/V | N/A |
|---|---|---|---|---|---|
| A. Acceso y cuenta | 5 | 2 | 2 | 0 | 1 |
| B. Onboarding y permisos | 1 | 3 | 2 | 0 | 0 |
| C. Flujos críticos | 2 | 4 | 2 | 1 | 0 |
| D. Dinero | 2 | 4 | 1 | 1 | 1 |
| E. Seguridad y privacidad | 4 | 3 | 2 | 0 | 0 |
| F. Legal y tiendas | 1 | 1 | 3 | 3 | 0 |
| G. Accesibilidad | 0 | 2 | 3 | 2 | 0 |
| H. Rendimiento | 0 | 1 | 0 | 6 | 0 |
| I. Observabilidad | 1 | 3 | 3 | 0 | 0 |
| J. Operación | 3 | 2 | 3 | 1 | 0 |
| K. Comunicación | 1 | 3 | 0 | 1 | 0 |
| **Total (86)** | **20** | **28** | **21** | **15** | **2** |

**Lectura:** el núcleo transaccional (reserva → pago → servicio → propina) está sólido y verificado en producción. Lo que falta es la capa de **cumplimiento, accesibilidad y observabilidad** que exige una tienda de aplicaciones.

---

## A. Acceso y cuenta

| # | Ítem | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Registro con email | PASA | `register_screen.dart` + `POST /api/auth/register`; validación en ambos lados (E1) |
| 2 | Login social | PARCIAL | Google verificado en servidor; hoy corregido el destino de la API en web. **Apple ausente** (E1) |
| 3 | Apple Sign-In | N/A | iOS no se publica (sin suscripción Apple Developer) |
| 4 | Recuperación de contraseña | PASA | `forgot_password_screen.dart` + `/api/auth/forgot-password` y `reset-password` (E1) |
| 5 | Verificación de email | PARCIAL | Existe `verification-pending`, pero no hay bloqueo de funciones por cuenta sin verificar (E1) |
| 6 | Sesión persistente | PASA | Token en `SecureStorageService`, refresco por expiración (E1) |
| 7 | Logout real | PASA | `AuthService.logout()` + `clearAll()` + `pushNamedAndRemoveUntil('/auth/login')` (E1) |
| 8 | Borrado de cuenta in-app | **FALLA** | Backend tiene `DELETE /api/auth/delete-account`, **la app no ofrece el botón**. El onboarding promete «puedes eliminar tu cuenta en cualquier momento» (E1) |
| 9 | Cambio de contraseña | PARCIAL | `changePassword` en API y campos en el perfil, flujo no probado (E1) |
| 10 | Fuerza bruta | PASA | `authLimiter` 10/15 min; headers `ratelimit-*` visibles en producción (E3) |

## B. Onboarding y permisos

| # | Ítem | Veredicto | Evidencia |
|---|---|---|---|
| 11 | Permisos just-in-time | **FALLA** | `AndroidManifest.xml` de release **no declara ningún permiso** (ni INTERNET ni ubicación); solo debug/profile lo tienen (E1) |
| 12 | Denegación manejada | PARCIAL | Hay manejo de permiso denegado en el mapa, sin recorrido completo verificado (E1) |
| 13 | Notificaciones opt-in | PARCIAL | Switch en `settings_screen.dart` + `PushService`; token FCM por dispositivo aún sin registrar en producción (E1) |
| 14 | Deep links | **FALLA** | Sin `app_links`/`uni_links` ni `intent-filter` de esquema: los enlaces de correo solo funcionan en web (E1) |
| 15 | Estados vacíos | PARCIAL | Existen en historial y catálogo; varios listados aún muestran vacío sin explicación (E1) |
| 16 | Versionado mínimo | PARCIAL | El backend publica `minimum_app_version`; la app no lo consume (E1/E3) |

## C. Flujos críticos

| # | Ítem | Veredicto | Evidencia |
|---|---|---|---|
| 17 | Camino feliz completo | PASA | E2E 13/13: reserva → pago → reprogramación → propina → cancelación (E2) |
| 18 | Doble toque / idempotencia | **FALLA** | El middleware `idempotency.js` existe pero **no se aplica a reservas ni pagos** (E1) |
| 19 | Timeouts y reintentos | PASA | `requestTimeout` 15 s + backoff con cortocircuito en 5xx (E1) |
| 20 | Errores traducidos | **FALLA** | `mensajeHumano()` existe, pero **29 sitios** aún pintan `$e` crudo (E2) |
| 21 | Sin conexión | PARCIAL | `SocketException` traducido; un solo punto usa `connectivity` (E1) |
| 22 | Estados de carga | PARCIAL | Indicadores en flujos principales; listas sin esqueleto (E1) |
| 23 | Datos obsoletos | PARCIAL | Pull-to-refresh en algunas listas, no en todas (E1) |
| 24 | Navegación coherente | PASA | 25 rutas declaradas; `pushNamed` sin destinos muertos tras retirar la invitación. Botón sin acción del perfil eliminado hoy (E1) |
| 25 | Confirmar/deshacer | PARCIAL | Cancelación de cita soportada; acciones destructivas sin confirmación uniforme (E1) |
| 26 | Multi-dispositivo | N/V | Requiere dos dispositivos con la misma cuenta (E0) |

## D. Dinero

| # | Ítem | Veredicto | Evidencia |
|---|---|---|---|
| 27 | Pago real | PARCIAL | Flujo completo verificado en **sandbox** (pay 202 + evento firmado 200 → `CONFIRMADA/paid`); falta una transacción con dinero real (E3) |
| 28 | Webhooks verificados | PASA | Firma SHA-256 con secreto, idempotente, con despacho a reservas y a pedidos (E3) |
| 29 | Conciliación | N/V | No hay job de cuadre diario identificable (E1) |
| 30 | Reembolsos | PARCIAL | La cancelación genera asiento en `reembolsos` y cambio a `CANCELADA`; el usuario no ve estado del reembolso (E2) |
| 31 | Recibos/facturas | **FALLA** | No hay comprobante descargable ni correo de recibo (E1) |
| 32 | Fallo de pago | PARCIAL | La cita queda en `PENDIENTE_PAGO` con botón «Ir a pagar»; 3DS y abandono no probados (E1) |
| 33 | Precios y moneda | PASA | COP, importes desde backend, sin precios en el cliente (E1) |
| 34 | Compras in-app | N/A | Servicios físicos/presenciales: IAP de la tienda no aplica |

## E. Seguridad y privacidad

| # | Ítem | Veredicto | Evidencia |
|---|---|---|---|
| 35 | TLS en todo | PASA | HTTPS obligatorio; `strict-transport-security: max-age=31536000` (E3) |
| 36 | Sin secretos en el cliente | PARCIAL | Solo client IDs públicos (Google/Firebase) en el bundle; no hay barrido completo de claves (E2) |
| 37 | Autorización por objeto | PASA | OTP de una cita ajena → 401/403 con token de otro usuario (E3) |
| 38 | Aislamiento multi-tenant | PASA | RLS 37/37 tablas con FORCE y política; consultas cross-tenant en `app_system` con validación en el `WHERE` (E3) |
| 39 | MASVS básico | PARCIAL | Token en almacenamiento seguro; sin ofuscación ni verificación de integridad (E1) |
| 40 | Rate limiting | PASA | Auth 10/15 min, OTP 5/10 min, pagos 20/15 min (E1/E3) |
| 41 | Inventario de datos | **FALLA** | No existe documento de qué se guarda, dónde y por cuánto (E1) |
| 42 | Política de privacidad | **FALLA** | No hay pantalla ni URL publicada; solo menciones dentro de Términos y del onboarding (E1) |
| 43 | Consentimientos | PARCIAL | Habeas Data y biometría tienen pantalla propia; marketing/telemetría en ajustes (E1) |
| 44 | Logs sin PII | PARCIAL | `debugPrint` en debug; no se auditó qué escribe producción (E1) |

## F. Legal y tiendas

| # | Ítem | Veredicto | Evidencia |
|---|---|---|---|
| 45 | Términos y condiciones | PASA | `terms_conditions_screen.dart` (147 líneas) accesible sin login (E1) |
| 46 | Ficha de tienda | N/V | La app no está publicada en ninguna tienda (E0) |
| 47 | Privacidad nutricional | N/V | Depende de la ficha (E0) |
| 48 | Data safety | N/V | Depende de la ficha (E0) |
| 49 | Edad y contenido | N/V | Depende de la ficha (E0) |
| 50 | URL de soporte | PARCIAL | Existe pantalla de soporte y FAQ, pero el número aparece **enmascarado** (`+573****8899`) en la FAQ (E1) |
| 51 | Permisos declarados | **FALLA** | Manifiesto de release sin permisos declarados (E1) |
| 52 | Borrado de cuenta publicado | **FALLA** | Sin enlace web de borrado, exigido por Play (E1) |

## G. Accesibilidad

| # | Ítem | Veredicto | Evidencia |
|---|---|---|---|
| 53 | Contraste | **FALLA** | El dorado de marca `#C5A052` sobre blanco ronda 2.6:1 (mínimo 4.5:1) y se usa en textos de 11–13 px (E1) |
| 54 | Área táctil | PARCIAL | FABs de 56 px correctos; iconos de 14–18 px dentro de contenedores de 38 px (E1) |
| 55 | Escalado de texto | **FALLA** | Cero usos de `textScaler`; muchas alturas y tamaños fijos (E2) |
| 56 | Lector de pantalla | **FALLA** | 9 `Semantics(` en 29.280 líneas; iconos sin etiqueta (E2) |
| 57 | No depender del color | PARCIAL | Estados con texto además de color en citas; no en todas las listas (E1) |
| 58 | Foco y teclado (web) | N/V | Requiere recorrido manual con teclado (E0) |
| 59 | Movimiento reducido | **FALLA** | No se consulta la preferencia del sistema (E1) |

## H. Rendimiento y estabilidad

| # | Ítem | Veredicto | Evidencia |
|---|---|---|---|
| 60 | Crash-free ≥ 99.5 % | N/V | Sin crash reporting integrado: no hay dato (E1) |
| 61 | Arranque en frío | N/V | Sin medición en dispositivo (E0) |
| 62 | Fluidez | N/V | Sin perfilado (E0) |
| 63 | Peso | PARCIAL | Bundle web 5,22 MB medido; APK no construido/medido (E2) |
| 64 | Red lenta | N/V | Sin prueba con latencia simulada (E0) |
| 65 | Memoria | N/V | Sin prueba de ciclos (E0) |
| 66 | Batería y GPS | N/V | Sin auditoría de listeners en segundo plano (E0) |

## I. Observabilidad y soporte

| # | Ítem | Veredicto | Evidencia |
|---|---|---|---|
| 67 | Crash reporting | **FALLA** | Sin Sentry/Crashlytics en `pubspec.yaml` (E1) |
| 68 | Analítica de embudo | PARCIAL | `AnalyticsService` propio con 44 puntos de instrumentación; sin panel que lo consume (E1) |
| 69 | Health checks | PARCIAL | `/api/health` responde 200… **solo con `X-App-Audience`**; un monitor externo recibe 400 (E3) |
| 70 | Errores 5xx visibles | PARCIAL | Logs de Railway; sin panel ni alertas (E1) |
| 71 | Soporte con SLA | **FALLA** | Número enmascarado en la FAQ y sin horario ni tiempo de respuesta publicado (E1) |
| 72 | FAQ y autoservicio | PASA | `faq_screen.dart` con 10 preguntas sobre pagos, seguridad y citas (E1) |
| 73 | Estado del servicio | **FALLA** | No existe página ni canal de estado (E1) |

## J. Operación y release

| # | Ítem | Veredicto | Evidencia |
|---|---|---|---|
| 74 | Entornos separados | PASA | producción `postgres-postgis-prod` y staging separados. **Salvedad:** staging conecta como superusuario, RLS inerte allí (E3) |
| 75 | CI/CD | PASA | `apps-ci.yml` (verify + deploy a Firebase) y `backend-ci.yml` 4/4 verdes (E2) |
| 76 | Rollback | PARCIAL | Railway permite redeploy de un commit anterior; procedimiento nunca ejecutado ni cronometrado (E1) |
| 77 | Backups + restore probado | **FALLA** | Sin evidencia de copia automática ni de restauración (E0) |
| 78 | Migraciones seguras | **FALLA** | La 125 quedó aplicada a medias (`permission denied`) y la 126 tumbó producción (E3) |
| 79 | Versionado | PARCIAL | `1.0.0+1`; no hay changelog ni política de incremento (E1) |
| 80 | Feature flags | **FALLA** | No existe mecanismo para apagar una función sin publicar (E1) |
| 81 | Canales de prueba | N/V | Sin beta cerrada configurada (E0) |

## K. Comunicación transaccional

| # | Ítem | Veredicto | Evidencia |
|---|---|---|---|
| 82 | Correos transaccionales | PASA | Brevo por API HTTP; envío verificado con id de mensaje (E3) |
| 83 | Entregabilidad | PARCIAL | Se envía desde un correo personal (hotmail), **sin dominio propio ni DKIM** propio (E3) |
| 84 | Push | PARCIAL | `firebase-admin` y `PushService` listos; falta que un dispositivo registre token (E1) |
| 85 | Plantillas con marca | PARCIAL | Remitente «GlowApp Colombia»; plantillas sin revisar una a una (E1) |
| 86 | Baja de comunicaciones | N/V | No se localizó enlace de baja en marketing (E1) |

---

## Los 12 bloqueantes de lanzamiento

| Ítem | Estado |
|---|---|
| 8. Borrado de cuenta in-app | **FALLA** — backend listo, UI ausente, y hay una promesa falsa en el onboarding |
| 27. Pago real conciliado | PARCIAL — solo sandbox |
| 28. Webhooks firmados | **PASA** |
| 37. Autorización por objeto | **PASA** |
| 38. Aislamiento multi-tenant | **PASA** |
| 36. Sin secretos en el cliente | PARCIAL |
| 20. Errores traducidos | **FALLA** — 29 sitios con `$e` |
| 60. Crash-free | N/V — sin crash reporting, no hay dato |
| 77. Restauración de backup | **FALLA** — sin evidencia |
| 76. Rollback | PARCIAL |
| 42. Privacidad publicada | **FALLA** |
| 71. Soporte con SLA | **FALLA** |

**5 PASA · 4 PARCIAL · 3 FALLA + 1 N/V.**

---

## Plan de remediación (propuesto, por orden de bloqueo)

### Fase 1 — Bloqueantes de tienda (≈2 días)
1. Pantalla «Eliminar mi cuenta» en ajustes → `DELETE /api/auth/delete-account`, con confirmación escrita y explicación de qué se conserva. Quitar o corregir la promesa del onboarding.
2. Política de privacidad: pantalla en la app + URL pública; enlazarla desde Términos, ajustes y ficha de tienda.
3. Permisos en `AndroidManifest.xml` de release: `INTERNET`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `POST_NOTIFICATIONS` (Android 13+).
4. Número de soporte real (sin asteriscos) y horario de atención en la FAQ y en soporte.

### Fase 2 — Dinero y confianza (≈2 días)
5. Una transacción real de extremo a extremo y su conciliación manual contra Wompi.
6. Comprobante de pago descargable y por correo.
7. Estado del reembolso visible en «Mis citas».

### Fase 3 — Robustez (≈2 días)
8. Sustituir los 29 `$e` por `mensajeHumano()`.
9. Idempotencia en `POST /bookings` y en los endpoints de pago.
10. Excluir `/api/health` del middleware `X-App-Audience` y conectarlo a un monitor externo.

### Fase 4 — Accesibilidad (≈3 días)
11. Contraste: oscurecer el dorado para texto (`#8A6A2F` ≈ 4.6:1) y subir tamaños mínimos a 13 px.
12. `Semantics` en iconos y botones de las 10 pantallas principales.
13. Respetar el escalado de texto del sistema en las pantallas de lista y perfil.

### Fase 5 — Observabilidad (≈1 día)
14. Crash reporting (Sentry o Crashlytics) con símbolos y alerta.
15. Panel de la analítica ya instrumentada (44 eventos) y alerta de 5xx.

### Fase 6 — Operación (≈1 día)
16. Documentar y **ejecutar** un restore de backup en staging.
17. Procedimiento de rollback cronometrado.
18. Feature flag mínimo para apagar el pago o el catálogo sin publicar versión.

---

## Riesgos y observaciones

- **La app cliente hoy no compila un APK funcional**: sin `INTERNET` en el manifiesto de release, el binario no alcanza la red. Todo el trabajo reciente se validó en web.
- **Accesibilidad es el bloque más débil** (0 de 7 PASA): es también el más visible en una revisión de tienda.
- **La observabilidad no existe**: sin crash reporting ni alertas, el ítem 60 no se puede declarar cumplido nunca.
- Los 15 N/V no son deuda: son huecos de medición. Cada uno necesita un instrumento (dispositivo, tienda, monitor) antes de poder aprobarse.
