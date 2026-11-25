# GlowApp landing

Sitio estático ligero, sin framework ni dependencias npm. `npm start` sirve `public/` en `PORT` (8080 por defecto) y expone `/healthz`.

## Railway

- Crear un servicio independiente con root directory `/landing`.
- Watch paths: `/landing/**`.
- Start command: `node server.js` (el `package.json` también define `npm start`).
- Healthcheck path: `/healthz`.
- Configurar `RAILWAY_PUBLIC_DOMAIN` (Railway) o `LANDING_SITE_URL` para poblar `robots.txt` y `sitemap.xml` con el dominio real.
- Configurar `landing.config.json` con la site key pública Turnstile por entorno (`turnstileSiteKey.development`, `.staging`, `.production`). La clave secreta va solo como `TURNSTILE_SECRET` en el backend.

Antes del lanzamiento, añadir el origen de esta landing a `ALLOWED_ORIGINS` en cada entorno backend y crear Turnstile con los hostnames de staging y producción. El API base por entorno vive en `landing.config.json`; los formularios no acceden directamente a Postgres.

## Fase 1

La experiencia funciona en modo estático sin video. La intro animada y los clips se incorporan en la Fase 2. Los botones que no tengan redirect configurado abren el formulario local del rol.

## Bloqueantes de producción

- **Privacidad**: `landing/public/privacidad.html` contiene un marcador **PENDIENTE**. El texto legal definitivo debe ser provisto por el equipo legal y reemplazar el contenido actual antes de cualquier despliegue a producción. El enlace en el formulario apunta a `/privacidad` (servido estáticamente por la landing), no a la API.
