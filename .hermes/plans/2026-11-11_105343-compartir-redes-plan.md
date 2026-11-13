# Compartir en redes (TikTok / Instagram / Facebook) — plan de corrección e implementación

> **Para Hermes:** ejecutar con `subagent-driven-development`, una tarea por subagente, revisión de cumplimiento y luego de calidad. No avanzar de fase sin el gate.

**Objetivo:** que compartir desde GlowApp produzca un enlace que (a) abra el contenido correcto, (b) se vea con imagen y título en WhatsApp/Instagram, (c) quede medido (quién comparte, qué, cuántos clics, cuántas conversiones) y (d) se use en los puntos donde aporta adquisición o retención.

**Arquitectura:** el botón es `share_plus` (share sheet del sistema) + tarjeta 9:16 generada en el cliente con `RepaintBoundary`; el enlace apunta a una **página de compartir HTML del backend** (`/s/...`) que lleva las etiquetas OG y redirige a la app. La atribución se cierra con `POST /api/social/log-share` y con el código de referido de `usuarios.referral_code`.

**Stack:** Flutter 3.47 (cliente y proveedor), `share_plus ^12.0.2`, `glow_core` (servicios compartidos), Express + pg (`backend/index.js`, Jest), Firebase Hosting (rewrite catch-all ya configurado).

**Baseline:** `main` = `35f1f5bc1fbbb3cd65f6b0f58855da2ab58ff80e`. Cualquier tarea mutante re-ejecuta la comprobación de premisas (Tarea 0) y **se detiene si cambió**.

---

## Veredicto

Hoy compartir no funciona en ningún punto salvo uno, y ese uno pierde al receptor:

1. El único share real (`provider_detail_screen.dart:164`) genera un enlace que **abre el home** o **queda en blanco** (medido con CDP sobre producción).
2. Los botones de TikTok/Instagram del pasaporte (`results_screen.dart:285-340`) **no abren el share sheet** y llaman a `POST /api/social/log-share`, ruta que **no existe** en el backend.
3. El botón de compartir del lookbook (`makeup_lookbook_screen.dart:275`) solo muestra un modal de consentimiento y no hace nada más.
4. El programa de referidos está completo del lado servidor (`authRoutes.js:26`, `usuarios.referral_code`, mensaje con $10.000 COP) y **no tiene ninguna entrada en el cliente**; además `register` no lee `?ref=`.
5. No hay `og:image` ni `og:url` (`web/index.html:35-36`): todo enlace se ve igual en WhatsApp/IG.

Por eso el orden del plan no es "sumar botones": primero los cuatro habilitadores (F0), después los puntos de contenido (F1-F2), después el dinero (F3).

## Contexto verificado

| Hecho | Evidencia |
|---|---|
| Link con path cae en home | E0: `https://glowapp-client.web.app/provider-detail/3` → home (captura `deeplink-provider3.png`) |
| Link con hash queda en blanco | E0: `https://glowapp-client.web.app/#/provider-detail/3` → pantalla vacía |
| `/provider-detail` exige `arguments` | E1: `apps/glow_client/lib/main.dart:361-368` |
| `DeepLinkService` ya sabe mapear el path | E1: `apps/glow_client/lib/services/deep_link_service.dart:88-100` (`case 'provider-detail'`) |
| `log-share` inexistente | E1: `glow_core/lib/src/services/social_share_service.dart:14` vs `grep -rn "api/social" backend` = 0 resultados |
| TikTok/IG sin share sheet | E1: `share_plus` se importa solo en `provider_detail_screen.dart:6` |
| Referidos del lado servidor | E1: `backend/src/controllers/authController.js:591-617`, `backend/src/routes/authRoutes.js:26` |
| Tabla `referidos` con `conversiones` sin escritor | E1: `backend/migrations/012_skincare_planner_reengineering.sql:62-69`; `grep conversiones backend/src` = 0 |
| `redirectReferral` redirige a la API | E1: `backend/src/controllers/designsController.js:1153` (`res.redirect('/')`) |
| XP disponible | E1: `app.use('/api/xp-logs', xpLogRoutes)` en `backend/index.js:522`; tabla `xp_logs(user_id, xp_amount, reason)` |
| Backend ya sirve HTML | E1: `backend/index.js:431-436`, `245` (`express.static`, `sendFile`) |
| OG actual incompleto | E1: `apps/glow_client/web/index.html:35-36` |
| Hosting con rewrite catch-all | E1: `apps/glow_client/firebase.json` (`"source": "**" → /index.html`) |
| Confirmación de la regla de tema | `35f1f5bc`: pantallas claras salvo selector Hombres (no se toca en este plan) |

---

## Decisiones de diseño

1. **Un solo mecanismo de referido.** Se usa `usuarios.referral_code` y se retira de escena la tabla `referidos` (legado de diseños). `GET /api/designs/share/go/:code` deja de usarse; no se borra en este plan (solo se documenta la deprecación).
2. **Enlace compartido = página del backend, no del hosting.** `https://glowapp-api-production.up.railway.app/s/<tipo>/<id>` sirve HTML con OG y redirige a `https://glowapp-client.web.app/#/...`. Motivo: el hosting es estático y no puede variar OG por entidad sin Cloud Functions; el backend ya sirve HTML y está desplegado.
3. **La app resuelve el path al arrancar.** El redirect del backend usa `/#/` (hash), que es la forma que la app entiende hoy sin tocar el arranque; además se arregla el path limpio porque el share de correo y los enlaces ya enviados lo usan.
4. **Tarjeta 9:16 en el cliente.** `RepaintBoundary` + `toImage(pixelRatio: 3)` → `share_plus.shareXFiles`. Sin SDK nativo de TikTok/Instagram: publicar directo exige revisión de app y no es necesario para el 90% del valor.
5. **Consentimiento Ley 1581 reutilizado.** `SocialShareService.showConsentModal` ya existe y se mantiene obligatorio solo para contenido con imagen de la persona (colorimetría, lookbook, evolución). Para perfil de prestador y producto no aplica.

## Gates (se detiene en seco en cada uno)

| Gate | Cuándo | Cadena literal |
|---|---|---|
| **G0** | Antes de la primera tarea mutante de F0 | `AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — COMPARTIR-F0` |
| **G1** | Antes de tocar `provider_detail` | `AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — COMPARTIR-F1` |
| **G2** | Antes de tarjetas 9:16 | `AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — COMPARTIR-F2` |
| **G3** | Antes de tocar registro/referidos (migración) | `AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — COMPARTIR-F3` |
| **G4** | Antes de cualquier deploy a producción | `AUTORIZACIÓN EXPLÍCITA DEL DIRECTOR — COMPARTIR-DEPLOY` |

`CONTINUAR`, `SIGUE`, `OK` **no** son gates.

---

## F0 — Habilitadores (sin esto, todo lo demás es decorativo)

### Tarea 0: comprobar premisas y dejar la sonda

**Objetivo:** confirmar baseline y tener una sonda repetible que mida el link compartido.

**Archivos:**
- Crear: `tools/sonda_compartir.js`
- Test: no aplica (herramienta)

**Pasos:**
1. Ejecutar y comparar: `cd ~/glowapp-firebase && git rev-parse HEAD` → debe imprimir `35f1f5bc1fbbb3cd65f6b0f58855da2ab58ff80e`. Si difiere, **detenerse** y marcar el plan OBSOLETO arriba con el SHA nuevo.
2. Crear `tools/sonda_compartir.js` copiando el patrón de `probe_gis_opacity.js` usado en esta sesión (Chrome headless + CDP, sin dependencias): recibe URL y ruta de captura, imprime `title`, `og:image`, `og:url` y guarda PNG.
3. Ejecutar contra el link actual y guardar salida en `work/sonda-compartir-baseline.txt`.
4. `git add tools/sonda_compartir.js && git commit -m "test(tools): sonda para medir el enlace de compartir"`

**Expected:** la sonda imprime `og:image: (vacío)` y la captura muestra el home — el defecto queda fotografiado antes de tocar código.

### Tarea 1: el path limpio abre el perfil

**Objetivo:** `/#/provider-detail/<id>` y `/provider-detail/<id>` renderizan el perfil del prestador.

**Archivos:**
- Modificar: `apps/glow_client/lib/main.dart:361-369` (tolerar `settings.name` con segmento)
- Modificar: `apps/glow_client/lib/widgets/deep_link_host.dart` (procesar la URL inicial en web)
- Test: `apps/glow_client/test/deep_link_service_test.dart`

**Paso 1 — test que falla**

```dart
test('un enlace con path y uno con hash llevan al mismo prestador', () {
  for (final url in [
    'https://glowapp-client.web.app/provider-detail/3',
    'https://glowapp-client.web.app/#/provider-detail/3',
  ]) {
    final destino = DeepLinkService.mapear(Uri.parse(url));
    expect(destino?.ruta, '/provider-detail', reason: url);
    expect(destino?.argumentos['providerId'], '3', reason: url);
  }
});

test('onGenerateRoute arma el id desde el nombre de la ruta', () {
  // '/provider-detail/3' sin arguments no debe abrir la pantalla con id vacío
});
```

**Paso 2 — correr y ver fallar:** `cd apps/glow_client && flutter test test/deep_link_service_test.dart -v` → FAIL en el segundo caso (`providerId` vacío).

**Paso 3 — implementación mínima:** en `onGenerateRoute`, `case '/provider-detail'` acepta también `settings.name` con `/` (parsea el último segmento como id cuando `arguments` es nulo); en `DeepLinkHost`, en web, procesa `Uri.base` al montar.

**Paso 4 — correr y ver pasar:** mismo comando → 4 pasan (los 2 nuevos + los existentes).

**Paso 5 — sonda E0:** `node tools/sonda_compartir.js "https://<sitio-de-prueba>/provider-detail/3" work/paso1.png` sobre el build local servido en `:8099`. Expected: captura con el nombre del prestador, no el mapa.

**Paso 6 — commit:** `git commit -m "fix(deeplink): el enlace del perfil abre el prestador, no el home"`

### Tarea 2: `POST /api/social/log-share` con XP idempotente

**Objetivo:** registrar cada share y entregar XP una sola vez por contenido y día.

**Archivos:**
- Crear: `backend/migrations/124_social_shares.sql`
- Crear: `backend/src/controllers/socialController.js`
- Crear: `backend/src/routes/socialRoutes.js`
- Modificar: `backend/index.js` (montar `app.use('/api/social', socialRoutes)` junto al resto de mounts)
- Test: `backend/tests/socialShare.test.js`

**Esquema (124):**

```sql
CREATE TABLE IF NOT EXISTS social_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
  platform VARCHAR(20) NOT NULL,
  content_type VARCHAR(40) NOT NULL,
  share_reference_id VARCHAR(120),
  ip_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS social_shares_dia
  ON social_shares (user_id, content_type, share_reference_id, (created_at::date));
```

**Paso 1 — test que falla** (`backend/tests/socialShare.test.js`, patrón de mocks de pool usado en `backend/tests/`): POST sin token → 401; POST válido → 201 `{success:true, xp_awarded:50}`; segundo POST mismo contenido/día → 200 `{xp_awarded:0, duplicate:true}`.

**Paso 2 — correr:** `cd backend && npx jest tests/socialShare.test.js` → FAIL (ruta inexistente).

**Paso 3 — implementar** con `authMiddleware`, `INSERT ... ON CONFLICT DO NOTHING`, y si insertó, `INSERT INTO xp_logs (user_id, xp_amount, reason) VALUES ($1, 50, 'share:' || $2)`.

**Paso 4 — correr:** mismo comando → 3 pasan. Y en el CI: `python3 tools/verificar_contrato_api.py .` → OK (la ruta debe declararse también en OpenAPI si el contrato la exige).

**Paso 5 — commit:** `git commit -m "feat(social): log-share real con XP idempotente"`

### Tarea 3: página de compartir con OG (backend)

**Objetivo:** `GET /s/provider/:id` devuelve HTML con `og:title`, `og:description`, `og:image`, `og:url` y redirige a la app.

**Archivos:**
- Crear: `backend/src/routes/sharePagesRoutes.js`
- Modificar: `backend/index.js` (montar **antes** del bloque `/api`, sin `X-App-Audience`)
- Test: `backend/tests/sharePages.test.js`

**Pasos:**
1. Test que falla: `GET /s/provider/3` → 200, `content-type: text/html`, contiene `og:image` con la foto del prestador y `og:url` con el id; `GET /s/provider/999999` → 404 con HTML (no JSON).
2. Correr: `npx jest tests/sharePages.test.js` → FAIL (404 del router).
3. Implementar: consulta `perfiles_prestador` + `usuarios` (misma SQL que `providerController.getProviderById`), arma HTML con `escapeHtml`, `Cache-Control: public, max-age=300`, y `<meta http-equiv="refresh" content="0;url=https://glowapp-client.web.app/#/provider-detail/<id>">` más un enlace visible por si el refresh falla.
4. Correr → pasa. Verificar a mano: `curl -s https://glowapp-api-production.up.railway.app/s/provider/3 | grep -i "og:image"`.
5. Commit: `feat(share): páginas de compartir con tarjeta OG`.

### Tarea 4: el cliente comparte el enlace con OG

**Objetivo:** `_shareProfile` usa `/s/provider/<id>` en lugar del path crudo.

**Archivos:**
- Modificar: `apps/glow_client/lib/screens/provider_detail_screen.dart:164-192`
- Test: `apps/glow_client/test/share_enlace_test.dart`

**Pasos:**
1. Test que falla: extraer la construcción del enlace a una función pura `enlaceCompartirPrestador(id, hostBase)` en `glow_core` o en el propio archivo y afirmar `https://glowapp-api-production.up.railway.app/s/provider/3`.
2. Correr y ver fallar.
3. Implementar con el host del backend desde `ApiService.baseUrl` (no hardcodear producción en el widget).
4. Correr y ver pasar; commit `feat(share): el perfil se comparte con enlace que trae tarjeta`.

**Cierre de F0:** `flutter analyze` = 0 errores; `npx jest` del backend verde; `python3 tools/verificar_contrato_api.py .` OK; sonda sobre el enlace nuevo muestra `og:image` no vacío.

---

## F1 — Perfil del prestador (adquisición por recomendación)

### Tarea 5: botón de compartir en el resultado de búsqueda y en el portafolio

**Archivos:** `apps/glow_client/lib/screens/results_screen.dart`, `provider_detail_screen.dart` (portafolio), test en `test/share_enlace_test.dart`.

**Pasos:** test que falla (el enlace sale de la misma función de la Tarea 4) → correr → implementar → correr → commit `feat(share): compartir prestador desde resultados y portafolio`.

### Tarea 6: registrar el share (cliente → backend)

**Archivos:** `provider_detail_screen.dart:178-192`, `glow_core/.../social_share_service.dart`, test `test/share_log_test.dart`.

**Pasos:** test que falla (tras un share con `ShareResultStatus.success` se llama `logShare(platform: 'SISTEMA', contentType: 'PROVIDER_PROFILE', shareReferenceId: id)`) → correr → implementar (no bloquear si el log falla, pero tampoco mostrar un mensaje falso) → correr → commit.

### Tarea 7 (proveedor): compartir mi perfil desde el panel

**Archivos:** `apps/glow_provider/lib/screens/owner/owner_dashboard_screen.dart`, test `apps/glow_provider/test/share_perfil_test.dart`.

**Beneficio:** cada prestador publica su perfil en su propia audiencia; es el canal más barato de adquisición.
**Pasos:** mismo ciclo TDD; el enlace es el mismo `/s/provider/<id>`.

---

## F2 — Pasaporte de colorimetría y lookbook (UGC)

### Tarea 8: tarjeta 9:16 exportable

**Archivos:** crear `packages/glow_core/lib/src/widgets/share_card.dart`; usar en `results_screen.dart`.
**Pasos:** test de widget (la tarjeta mide 1080×1920 a `pixelRatio: 3` y contiene el nombre del prestador y el logo) → correr → implementar con `RepaintBoundary` → correr → commit.

### Tarea 9: TikTok e Instagram reales en el pasaporte

**Archivos:** `apps/glow_client/lib/screens/results_screen.dart:285-340`.
**Pasos:** reemplazar el SnackBar falso por `SharePlus.instance.shareXFiles([XFile(png)], text: deepLink)`; llamar `logShare(platform: 'TIKTOK'|'INSTAGRAM', contentType: 'AI_COLORIMETRY', shareReferenceId: resultId)` y mostrar el XP **que devuelve el backend**, no un texto fijo. Test con `share_plus` mockeado → commit `feat(share): TikTok e Instagram reales en el pasaporte`.

### Tarea 10: lookbook

**Archivos:** `apps/glow_client/lib/screens/makeup_lookbook_screen.dart:275-284`.
**Pasos:** mismo patrón: consentimiento → tarjeta → share sheet → log. Test → commit.

---

## F3 — Referidos (dinero, no alcance)

### Tarea 11: entrada de invitación en el cliente

**Archivos:** crear `apps/glow_client/lib/screens/invite_friends_screen.dart`; entrada desde `rewards_xp_screen.dart` y `user_profile.dart`; ruta `/invite` en `main.dart`.
**Pasos:** consume `GET /api/auth/referral-info` (ya existe, `authRoutes.js:26`), muestra código y `share_message`, botón "Compartir" con `share_plus`. Test de widget con el servicio mockeado → commit.

### Tarea 12: el registro lee `?ref=`

**Archivos:** `apps/glow_client/lib/screens/auth/register_screen.dart`, `backend/src/controllers/authController.js:46`, migración `125_referral_attribution.sql`.
**Pasos:**
1. Test backend que falla: `POST /api/auth/register` con `ref: 'GLOWAB12'` guarda `referred_by_user_id` del referidor; con `ref` inválido no falla el registro (se ignora).
2. Test cliente que falla: `RegisterScreen` con `Uri` `#/register?ref=GLOWAB12` envía `ref` en el body.
3. Implementar y correr ambos.
4. Commit `feat(referidos): el registro atribuye quién invitó`.

### Tarea 13: conversión del referido

**Archivos:** `backend/src/controllers/bookingController.js` (al confirmar la primera reserva), migración `126_referral_conversion.sql`.
**Pasos:** test que falla (la primera reserva de un usuario referido escribe `referral_conversions` y marca `usuarios.referral_converted_at`) → correr → implementar → correr → commit.

---

## F4 — Post-servicio y GlowShop

### Tarea 14: pedir reseña y compartir el look al completar la cita
**Archivos:** `apps/glow_client/lib/screens/booking_tracking_screen.dart`.
**Beneficio:** convierte satisfacción en adquisición y alimenta `reviews` (hoy vacía, P-105).
**Pasos:** TDD; el botón solo aparece si `estado == COMPLETADA`; enlace `/s/provider/<id>`; commit.

### Tarea 15: producto y receta compartibles
**Archivos:** `apps/glow_client/lib/screens/store_screen.dart`, `glowstore_recipe_screen.dart`; backend `sharePagesRoutes.js` gana `/s/product/:id`.
**Pasos:** test de la página OG de producto → share en la ficha → commit.

---

## Evidencia a llenar al cierre

| Invariante | Comando | Esperado | Fase |
|---|---|---|---|
| Baseline intacto | `git rev-parse HEAD` | SHA de la tabla de arriba | F0 |
| Un enlace abre el perfil | sonda CDP sobre `/s/provider/3` | captura con el nombre del prestador | F0 |
| OG presente | `curl -s <api>/s/provider/3 \| grep -c og:image` | `1` | F0 |
| `log-share` existe | `curl -s -o /dev/null -w "%{http_code}" -X POST <api>/api/social/log-share` | `401` sin token | F0 |
| Contrato app↔API | `python3 tools/verificar_contrato_api.py .` | `OK` | F0-F4 |
| Cliente sin errores | `cd apps/glow_client && flutter analyze` | `0 errores` | cada fase |
| Backend verde | `cd backend && npx jest` | sin fallos nuevos | cada fase |
| Bundle publicado = local | `md5sum build/web/main.dart.js` vs `curl` | hashes iguales | deploy |
| Conversión de referido | `SELECT count(*) FROM referral_conversions` tras un registro+reserva de prueba | `1` | F3 |

Clasificar cada fila como **E0** (medida en esta sesión), **E1** (inferida) o **E2** (sin verificar) en el informe de cierre.

## Rollback por fase

| Fase | Cómo se revierte | Coste |
|---|---|---|
| F0 | `git revert <sha>` de las tareas 1-4 + `firebase hosting:rollback` + borrar ruta `/s` del backend | 15 min; los enlaces `/s` ya compartidos dejan de servir OG |
| F1 | revert de tareas 5-7; los botones desaparecen, los enlaces `/s` siguen vivos | 5 min |
| F2 | revert de tareas 8-10; las tarjetas dejan de generarse | 10 min |
| F3 | revert de tareas 11-13 + migraciones 125/126 con `DROP COLUMN`/`DROP TABLE` (aditivas, sin pérdida de datos existentes) | 20 min; los referidos ya atribuidos se pierden |
| F4 | revert de tareas 14-15 | 10 min |

## Riesgos y preguntas abiertas

1. **Dominio del enlace:** `/s/...` vive en `glowapp-api-production.up.railway.app`. Si el Director quiere un dominio corto (`glow.app/s/...`), entra DNS y certificado: decidir antes de F0.
2. **Imagen OG:** se usa la foto del prestador/producto ya subida. Para el pasaporte no hay imagen pública; opción A: generar PNG en el cliente y que el usuario lo adjunte (el enlace solo aporta texto), opción B: render server-side (más caro). El plan asume A.
3. **Staging primero:** por P-118, el backend va a staging y se mide con datos antes de producción.
4. **Registro de pendientes:** estos cinco defectos deben entrar en `~/glowapp-split/PENDIENTES.md` como P-131…P-135 con su evidencia; C-10 y el resto del backlog no se tocan.
5. **No entra en este plan:** publicación directa en el feed por API (requiere SDK nativo y revisión de TikTok/Meta), comunidad y eventos (el detalle exige login, `eventRoutes.js:46`), y monetización del share (cupones por compartir).
