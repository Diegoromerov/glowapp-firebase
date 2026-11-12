# Compartir en redes y enlaces con tarjeta

Este documento describe el sistema de compartir de GlowApp: que se comparte, por
donde viaja el enlace, como se registra y como se verifica.

## Idea en una frase

El cliente **no comparte el path de la app**: comparte una **pagina del backend**
que lleva las etiquetas Open Graph (titulo, descripcion, imagen) y que redirige a
la app. El registro del compartir ocurre **despues** de que la hoja del sistema se
completa, y el XP que se anuncia es el que el backend confirma.

## Por que asi

- **El hosting es estatico.** `index.html` no puede cambiar `og:image` segun que se
  comparte; sin pagina intermedia todos los enlaces se ven iguales en WhatsApp,
  Instagram o TikTok.
- **La hoja del sistema basta.** Publicar directo en el feed exige SDK nativo y
  revision de app; `share_plus` cubre el 90% del valor sin esa dependencia.
- **Nada encima del control que debe responder.** Un iframe tapado no recibe clics
  (lo aprendimos con el boton de Google).

## Que se comparte

| Entidad | Enlace | `content_type` | Desde |
|---|---|---|---|
| Prestador | `<api>/s/provider/:id` | `PROVIDER_PROFILE` | Ficha, tarjeta del catalogo, Mi Perfil del proveedor, Mis Citas al terminar |
| Producto | `<api>/s/product/:id` | `PRODUCT` | Ficha rapida de GlowShop |
| Pasaporte de colorimetria | tarjeta 9:16 + `https://glowapp-client.web.app` | `AI_COLORIMETRY` | Resultados |
| Lookbook | tarjeta 9:16 + la web | `VTO_LOOK` | Lookbook IA |
| Certificado de Academy | — | `ACADEMY_CERT` | Reservado, sin usar |

## Piezas del cliente

- `packages/glow_core/lib/src/services/share_prestador_service.dart`
  - `enlacePrestador(...)`, `enlaceProducto(...)`
  - `compartirPrestador(...)`, `compartirProducto(...)`: abren la hoja y **solo si
    el usuario compartio** llaman a `logShare`. Devuelven el XP real; `0` si el
    backend no otorgo nada.
  - `idPublicoDelToken(token)`: id del usuario desde el JWT (app del proveedor).
- `packages/glow_core/lib/src/widgets/share_card.dart`
  - `ShareCard`: pieza 9:16 con marca, titulo, lineas y pie.
  - `exportarTarjetaPng(key, pixelRatio: 3)`: PNG 1080x1920; devuelve `null` si el
    arbol no esta montado, nunca una imagen vacia.

## Registro del compartir

`POST /api/social/log-share` (sesion requerida)

```json
{ "platform": "TIKTOK|INSTAGRAM|FACEBOOK|WHATSAPP|SISTEMA",
  "content_type": "AI_COLORIMETRY|VTO_LOOK|ACADEMY_CERT|PROVIDER_PROFILE|PRODUCT",
  "share_reference_id": "3" }
```

- `201` primera vez del dia: `{ success: true, xp_awarded: 50 }` y fila en
  `xp_logs` con `reason = 'share:<TIPO>'`.
- `200` repetido: `{ duplicate: true, xp_awarded: 0 }`. La idempotencia la impone
  la base: indice unico por `(user_id, content_type, COALESCE(referencia,''), dia)`.
- `400` plataforma o tipo invalido; `401` sin sesion; `500` sin mentir sobre el XP.

Tabla `social_shares_log` (migracion 008), con `dia` e indices de la 138 y el CHECK
de tipos ampliado en la 140.

## Paginas con Open Graph

`backend/src/routes/sharePagesRoutes.js`, montadas en `/s` **antes** del catch-all
del SPA:

- `GET /s/provider/:id`: nombre comercial, rating y opiniones en el titulo, foto del
  prestador como `og:image`, `og:url` canonica y redireccion a
  `/#/provider-detail/:id`.
- `GET /s/product/:id`: nombre y descripcion, `imagen_url` como `og:image`,
  redireccion a `/#/store`.
- `Cache-Control: public, max-age=300`. Id invalido -> `400` en HTML; inexistente ->
  `404` en HTML, nunca JSON (lo abre una persona).
- **La consulta va con `runAsSystem`**: la API trabaja con RLS y sin contexto de
  tenant el `SELECT` devuelve 0 filas. El sintoma fue "prestador no encontrado"
  para un prestador que si existia.

## Deep link del perfil

El enlace abre la ficha **sin sesion** (el catalogo es publico). Tres cosas lo
hacen posible: la URL se captura en `main()` antes de que el router la reescriba,
`DeepLinkService.rutasPublicas` exime `provider-detail`, y el tour de bienvenida no
arranca cuando la entrada es un enlace (su primera accion hace `popUntil('/home')`).

## Como se verifica

```bash
curl -s https://<api>/s/provider/3 | grep -oE 'og:(title|image|url)" content="[^"]*'
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://<api>/s/provider/999999
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "X-App-Audience: client" \
  -H "Content-Type: application/json" -d '{"platform":"SISTEMA","content_type":"PROVIDER_PROFILE"}' \
  https://<api>/api/social/log-share
SONDA_SIN_CORS=1 node tools/sonda_compartir.js "http://localhost:8099/provider-detail/3" out.png
```

## Trampas conocidas

- El verificador de migraciones se corre **desde la raiz** del repo.
- El hook de pre-push exige `MIGRACIONES_VERIFICADAS=1` si el push toca migraciones.
- Probar un build local de release contra la API exige `--disable-web-security`
  (CORS solo acepta origenes publicados).
- En Dart, `'$5.000'` interpola: hay que escapar `'\$5.000'`.

## Pendiente

- **Canje de puntos en el checkout** con tope por pedido: hoy los puntos no tienen
  donde gastarse. En ejecucion en otro frente.
- **Medicion de clics** del enlace de invitacion, para CAC y K-factor.
