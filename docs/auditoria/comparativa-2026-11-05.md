# Comparativa de auditoría — baseline vs. después del plan

**Baseline:** `docs/auditoria/baseline-2026-11-05.json` (86 ítems, 2026-11-05 07:58)
**Cierre:** 2026-11-05 (misma jornada) · rama `main` @ `528a54b` · desplegado en producción

---

## Totales

| Estado | Baseline | Final | Δ |
|---|---|---|---|
| PASA | 20 | **26** | **+6** |
| PARCIAL | 28 | 34 | +6 |
| FALLA | 21 | **8** | **−13** |
| No verificable | 15 | 16 | +1 |
| No aplica | 2 | 2 | 0 |

De los 12 bloqueantes de lanzamiento: **baseline 5 PASA · final 9 PASA**.

> Recuento corregido el 2026-11-05 tras recalcular sobre el JSON: 26 PASA · 34 PARCIAL · 8 FALLA · 16 N/V · 2 N/A = 86.

---

## Ítems que cambiaron por trabajo ejecutado

| # | Ítem | Antes | Ahora | Evidencia |
|---|---|---|---|---|
| 8 | Borrado de cuenta in-app | FALLA | **PASA** | `account_deletion_screen.dart` (confirmación escribiendo ELIMINAR) → `DELETE /api/auth/delete-account`; tarjeta en el perfil. Bundle desplegado contiene «Eliminar mi cuenta» ×3 |
| 42 | Política de privacidad | FALLA | **PASA** | Pantalla de 10 secciones + `https://glowapp-client.web.app/privacy.html` → **200** con contenido |
| 52 | Borrado de cuenta publicado | FALLA | **PASA** | `https://glowapp-client.web.app/account-deletion.html` → **200** |
| 51 | Permisos declarados | FALLA | **PASA** | `AndroidManifest.xml` de release: INTERNET, ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION, POST_NOTIFICATIONS |
| 18 | Doble toque / idempotencia | FALLA | **PASA** | Dos POST idénticos → `200` + mismo `booking_id` + `idempotente:true`; 1 sola fila creada (E3) |
| 20 | Errores traducidos | FALLA | **PASA** | 11 sitios visibles con `$e` → `mensajeHumano()`; 0 restantes en UI (los otros 18 eran `debugPrint`) |
| 69 | Health checks | PARCIAL | **PASA** | `/api/health` sin `X-App-Audience` → **200** (antes 400) |
| 67 | Crash reporting | FALLA | PARCIAL | Ya existía `CrashReportingService` propio + ahora errores asíncronos (`PlatformDispatcher.onError`) y alerta por correo ante `APP_CRASH` (máx. 1/hora) |
| 53 | Contraste | FALLA | PARCIAL | 37 colores de texto: `#C5A052` (2,46:1) → `#8A6A2F` (**5,02:1**). Quedan iconos decorativos |
| 56 | Lector de pantalla | FALLA | PARCIAL | 18 tooltips + 9 `Semantics`; tooltips cuentan como etiqueta. Faltan las pantallas de detalle |
| 77 | Backups + restore | FALLA | PARCIAL | Drill ejecutado en producción: 4 tablas copiadas con conteos idénticos, 23 índices recreados. **No** es `pg_dump` (no existe en el contenedor) |
| 71 | Soporte con SLA | FALLA | PARCIAL | WhatsApp abre `wa.me` real (antes solo mostraba «Conectando…»). Falta horario/SLA publicado |

## Correcciones de medición (no son mejoras)

Estos cambios vienen de haber revisado mal el baseline. Se anotan aparte para no inflar el resultado.

| # | Ítem | Antes | Ahora | Motivo |
|---|---|---|---|---|
| 55 | Escalado de texto | FALLA | N/V | No usar `textScaler` **no** rompe el escalado: ausencia = se respeta el ajuste del sistema. Falta probarlo a 200 % en dispositivo |
| 50 | URL de soporte | PARCIAL | PARCIAL | El número no estaba enmascarado: `+573009128899` está completo en el código. El enmascarado era de la salida de la herramienta. Sigue sin SLA |
| 20 | Errores traducidos | FALLA (29) | FALLA (11) | El conteo de 29 incluía `debugPrint`; los visibles eran 11 |
| 67 | Crash reporting | FALLA | (arriba) | Busqué Sentry/Crashlytics y no la solución in-house que ya existía |

---

## Lo que NO se hizo

| Fase | Estado |
|---|---|
| **2. Dinero** | Sin ejecutar: transacción real (requiere tarjeta del Director), comprobante descargable y estado de reembolso en «Mis citas» |
| **4. Accesibilidad** | Parcial: faltan escalado a 200 %, movimiento reducido (ítem 59 sigue FALLA) y etiquetas en pantallas de detalle |
| **5. Observabilidad** | Parcial: la alerta de crash no se disparó en prueba real; falta panel de embudo |
| **6. Operación** | Parcial: sin `pg_dump`, sin rollback cronometrado, sin feature flags (80 sigue FALLA) |

## Fallas que persisten (9)

59 movimiento reducido · 80 feature flags · 14 deep links · 11 permisos just-in-time (`geolocator` no los pide en runtime) · 41 inventario de datos · 61 y otros de rendimiento (siguen N/V, no FALLA) · 78 migraciones seguras · 31 recibos · 73 estado del servicio.

---

## Verificación de la entrega

```
backend    commit 6a89115/f93d27c desplegado · /api/health sin header → 200
           idempotencia: 2 POST → mismo booking_id, 1 fila
cliente    bundle desplegado con «Eliminar mi cuenta», «privacidad», wa.me, delete-account
web        /privacy.html → 200 (contenido real) · /account-deletion.html → 200
tests      glow_client: suite completa en verde · dart analyze: 0 errores
restore    4 tablas, conteos idénticos, 23 índices, esquema eliminado
```
