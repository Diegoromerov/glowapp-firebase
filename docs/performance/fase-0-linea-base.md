# Fase 0 — Línea base de rendimiento GlowApp

**Fecha de inspección:** 2026-11-19
**Commit de producción revisado inicialmente:** `9555502b9e1be803140b9784ee73159673c4cfbd`
**Commit actual de `main`:** `c326f958cfc682f2a337d5fd8db2dce5822b4acd` (documentación de Fase 0)
**Alcance:** app cliente Flutter, app proveedor Flutter, panel Next.js, API Node.js/PostgreSQL en Railway.

## Resultado ejecutivo

Producción respondió correctamente durante la inspección: `GET /api/health` devolvió HTTP 200, estado `OK` y conexión PostgreSQL disponible; el panel de administración devolvió HTTP 200. Railway reportó el commit de `main` activo en `glowapp-api` y `admin-dashboard`.

Esto valida disponibilidad básica, pero **no establece todavía una línea base de rendimiento representativa**. El endpoint Prometheus de la API tenía solo seis muestras HTTP en memoria desde el arranque. El histograma ubica ese pequeño conjunto por debajo del bucket de 100 ms, pero las solicitudes incluyen sondas de esta inspección y no sirven para inferir latencia de usuarios. La consulta de logs HTTP históricos de Railway no devolvió filas.

La documentación de Fase 0 se añadió a `main` en `c326f95`; Railway lanzó despliegues de API y panel debido al cambio. Ambos terminaron en `SUCCESS`. Tras el despliegue, la API y el panel devolvieron HTTP 200; la API reportó PostgreSQL disponible y 53 migraciones registradas. No hubo cambios de código de aplicación ni de configuración productiva.

## Evidencia disponible

| Señal | Observación | Lectura |
|---|---|---|
| API `/api/health` | HTTP 200, `OK`, PostgreSQL disponible | Liveness y estado de datos sanos en la consulta |
| Panel admin | HTTP 200 | La ruta raíz responde; no sustituye una prueba de sesión ni de navegación autenticada |
| Railway | `glowapp-api` y `admin-dashboard` ejecutan `9555502` con despliegues exitosos | Producción contiene el commit de `main` revisado |
| `/metrics` | HTTP 200; seis solicitudes contabilizadas en el proceso | Muestra demasiado pequeña y contaminada por sondas para estimar p95 real |
| Histograma HTTP | Bucket p95 observado `<= 100 ms` para seis muestras | No usar como SLA ni como comparación antes/después |
| Logs HTTP Railway | La consulta de hasta 200 filas devolvió cero registros | No prueba ausencia de tráfico; la fuente/retención no aportó una muestra utilizable |
| API, 5 GET secuenciales a `/api/health` | 5/5 HTTP 200; RTT externo 393.7–1,714.8 ms; mediana 480 ms | Muestra puntual, incluye red/TLS/proxy y no equivale a duración interna ni a p95 de usuarios |
| Panel, 5 GET secuenciales a `/` | 5/5 HTTP 200; RTT externo 579–905 ms; mediana 643 ms | Ruta pública sin sesión; RTT incluye red/TLS/proxy, no mide navegación autenticada ni Core Web Vitals |

## Instrumentación y herramientas ya presentes

- `backend/src/metrics/prometheus.js` registra contador y duración HTTP por ruta normalizada, estado de PostgreSQL y métricas de proceso. `/metrics` no requiere autenticación y sus rutas tienen cardinalidad acotada.
- `backend/src/instrumentation.ts` instrumenta HTTP, Express, PostgreSQL y Redis con OpenTelemetry. El exportador de trazas cae en `http://localhost:4318/v1/traces` si no se configura un endpoint OTLP; no se leyó ni se expuso ningún secreto de Railway para verificar el valor de producción.
- `backend/index.js` activa `compression()` y expone el healthcheck.
- `backend/src/config/db.js` ya usa `pg.Pool` con tiempos de espera y límites.
- `backend/src/routes/adminUploadRoutes.js` contempla R2 y el dominio CDN para archivos subidos.
- El cliente y proveedor incluyen listas lazy (`ListView.builder`/`GridView.builder`) y algunos cargadores shimmer.
- Existen pruebas de carga bajo `backend/load-test/`, pero necesitan saneamiento antes de usarlas como protocolo vigente.

## Riesgos de medición detectados

1. `backend/load-test/glowapp_masive_load.js` tiene como destino por defecto un dominio antiguo y comprueba un campo de health (`db`) que no coincide con el contrato actual (`database`). Además escala hasta 500 usuarios virtuales. **No ejecutar en producción.**
2. `backend/scripts/smoke_test_prod.js` no es un smoke test inocuo: consulta un estado de consentimiento con ID fijo y envía un POST biométrico con credenciales ficticias. **No ejecutar contra producción.**
3. No se encontró instrumentación `web-vitals`/RUM en el panel; las métricas de servidor no reflejan LCP/INP/CLS ni tiempos percibidos dentro de Flutter.
4. Las métricas Prometheus actuales son en memoria del proceso. Sin scraping persistente y retención, un reinicio pierde la ventana histórica necesaria para comparar.
5. `backend/monitoring/prometheus.yml` y `alerts.yml` están versionados, pero no hay evidencia de que Prometheus esté desplegado y reteniendo datos. Su target (`glowapp-backend:8080`) debe validarse contra la red y el puerto reales de producción.
6. La alerta `GlowAppHighHttpErrorRate` divide tasas sin proteger el denominador cero. Debe validarse y protegerse ese caso antes de depender de ella para operaciones.
7. `backend/src/instrumentation.ts` deja activo el exportador local `:9464/metrics` cuando falta `PROMETHEUS_REMOTE_WRITE_URL`; hay que verificar que no colisiona con el proceso y que los exportadores de producción llegan a un colector real. No se inspeccionaron valores secretos.

## Protocolo propuesto

### Servidor y API

- Configurar/revisar un colector Prometheus u OTLP con retención; confirmar el endpoint de exportación sin exponer tokens.
- Capturar al menos siete días representativos, segmentados por servicio, ruta normalizada, método y código HTTP.
- Reportar volumen, tasa 4xx/5xx, p50/p95/p99 de latencia, disponibilidad de PostgreSQL y uso de CPU/memoria/event loop.
- Separar endpoints de lectura, autenticación, pagos y operaciones pesadas; no mezclar pagos con una carga sintética general.

### Panel web

- Medir LCP, INP y CLS en percentil 75, junto con errores de navegación y tamaño de recursos.
- Los umbrales web de referencia de “bueno” son LCP <= 2.5 s, INP <= 200 ms y CLS <= 0.1 en p75; usarlos como referencia, no como resultado medido. [Core Web Vitals](https://web.dev/articles/vitals)

### Apps Flutter

- Seleccionar recorridos: inicio, búsqueda de prestador, detalle/portafolio, reserva, tienda/checkout y fulfillment del proveedor.
- Medir tiempo hasta contenido útil, errores/reintentos de red y bytes de imagen en Android de gama media/baja y perfiles de red lenta.
- Usar cuentas y datos sintéticos en staging; no simular pagos ni escrituras productivas.

### Prueba de carga

- Corregir destino, contrato de health, perfiles de carga y umbrales en un cambio separado.
- Ejecutar primero contra staging con datos sintéticos y rampa baja; detener si suben errores, conexiones DB o latencia.
- No usar los 500 usuarios virtuales actuales como primer escalón ni dirigirlos a producción.

## Criterio de salida de fase 0

1. Ventana de datos de servidor con suficiente volumen y sin contar las sondas manuales como tráfico real.
2. p95/p99 por rutas críticas y tasa de errores documentadas.
3. Métricas de experiencia web y un protocolo repetible para los recorridos Flutter.
4. Script de carga saneado y ejecutado en staging con un perfil conservador.
5. Objetivos de mejora acordados después de ver la línea base, antes de cambiar código de rendimiento.

**Estado:** salud básica y RTT externo puntual confirmados; línea base global pendiente por falta de muestras persistentes y de RUM cliente. No se modificó configuración de producción ni se generó carga.
