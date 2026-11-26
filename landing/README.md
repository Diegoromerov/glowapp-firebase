# GlowApp Landing — baseline técnico

Última revisión: 26 de noviembre de 2026. Este documento describe el estado real del checkout y de Railway staging. No implica que los cambios locales estén desplegados.

## Repositorio y estado de trabajo

- Repositorio: `Diegoromerov/glowapp-firebase` (`origin`).
- Checkout local: `C:\dev\glowapp-landing` (Git Bash: `/c/dev/glowapp-landing`).
- Rama: `feat/landing`.
- HEAD verificado: `fe4ef8c` (`fix(railway): isolate landing build context`).
- Hay una modificación local sin commit en `landing/public/index.html`. Preservarla; contiene el prototipo de intro en video y Firebase Storage descrito abajo.
- `landing/node_modules/` y los archivos `landing/landing.config.json.bak` y `landing/public/app.js.bak` están sin seguimiento. No asumir que son parte del producto ni eliminarlos sin autorización.
- No hacer commit, push ni deploy sin autorización explícita.

## Landing

Sitio servido por Node.js y JavaScript vanilla, sin framework. `server.js` usa `node:http` nativo (no Express), sirve los archivos de `public/`, expone `/healthz` y escucha en `process.env.PORT` (8080 por defecto).

| Archivo | Responsabilidad |
|---|---|
| `server.js` | Servidor HTTP, archivos estáticos, `/healthz`, CSP y otros headers |
| `landing.config.json` | API por entorno, roles/botones, Turnstile público y enlaces de privacidad |
| `public/index.html` | Landing y diálogo del formulario |
| `public/app.js` | Init, listeners, Turnstile, analítica y envío del formulario |
| `public/styles.css` | Estilos de la landing y del diálogo |
| `test/landing.test.js` | Prueba Playwright de botones y fallos de config/Turnstile |

Comandos: `npm start` inicia el servidor; `npm test` ejecuta el test automatizado. Playwright está en `devDependencies`. En este Windows el test puede requerir `CHROME_PATH` con la ruta local a Chrome.

### Landing en video (trabajo local)

La entrada de la landing ahora intenta cargar `intro.mp4` desde `gs://glow-web-b39a6.firebasestorage.app/intro.mp4`. `app.js` obtiene el media URL usando Firebase Storage REST y la API key runtime `LANDING_FIREBASE_API_KEY`; no se incluye una clave en los archivos versionados. Si falta la variable, el objeto no es público o falla la reproducción, aparece el fallback estático con los botones de cliente, profesional y salón. El botón “Saltar” y un toque/clic sobre el intro llevan al mismo fallback; desde ahí los botones conservan el flujo actual del formulario.

La CSP permite Firebase Storage en `connect-src` y `media-src`. Antes de desplegar, configurar `LANDING_FIREBASE_API_KEY` en el servicio Railway y verificar que las reglas de Storage permitan leer el video públicamente. No incluir secretos en la landing. Validar navegador, móvil y fallback antes de publicar.

### Contrato del formulario

La landing envía `POST /api/public/leads` al API configurado por entorno. Campos: `role` (`client`, `professional`, `salon`), `name`, `contactType` (`email`, `whatsapp`), `contact`, `city`, `neighborhood` para client/professional, `businessName` para salon, `referralCode` opcional, consentimiento, `consentTextVersion`, `turnstileToken`, honeypot `website` y `utm` opcional. No cambiar el contrato ni modificar `/backend` durante una tarea limitada a la landing.

Turnstile: la site key pública vive en `landing.config.json` por entorno; el secret solo vive como variable del backend. No imprimir valores de claves. El hostname del widget staging debe coincidir con el dominio público staging de la landing.

La URL de privacidad se resuelve desde `privacyUrl` en `landing.config.json`. Verificar HTTP 200 para cada entorno antes de cambiar destinos.

## Railway staging

- Proyecto `glowapp`, workspace `diegoromerov's Projects`.
- Servicio `glowapp-landing-staging`, URL `https://glowapp-landing-staging-staging.up.railway.app`, puerto 8080.
- Configuración verificada del servicio: Root Directory `/landing`, builder Nixpacks, build command `echo 'static site - no build needed'`, start command `node server.js`, healthcheck `/healthz` (100 s), restart On Failure (10 intentos).
- El último deployment verificado, `8e2aa29e-af7e-464a-ae94-813bf96ffc6c`, terminó `SUCCESS`; `/healthz` respondió 200.
- `.railwayignore` está en la raíz del monorepo para reducir el snapshot. `landing/railway.json` queda en el repo, pero Railway indicó que Config as Code está deprecado; la configuración efectiva se estableció directamente en el servicio.
- El deploy que funcionó fue `cd /c/dev/glowapp-landing/landing` y `railway up --environment staging`. Railway construyó desde `/landing` y el build detectó Node 18 con `npm ci`.
- El deploy anterior `railway up --path-as-root landing` se ejecutó cuando el servicio tenía otra configuración. No alternar entre ambos flujos sin emparejarlo con Root Directory: el servicio ahora tiene `/landing`.
- Railway anunció que `railway.json`/`railway.toml` siguen funcionando hasta el 1 de diciembre de 2026. El aviso no se refería al builder Nixpacks.

El servicio no está conectado a un repositorio GitHub para autodeploy; el código se sube con Railway CLI. Ejecutar `railway status` antes de desplegar para verificar proyecto, ambiente y servicio seleccionados.

### Diferencia entre checkout local y staging

En la última verificación anterior a este cambio, staging aún devolvía el hero anterior. Los cambios actuales de video son locales y todavía no están desplegados.

## Reglas para trabajo futuro

1. Leer los archivos reales y `git status --short` antes de editar; preservar el cambio local en `index.html` y los artefactos preexistentes.
2. No exponer claves, tokens ni secretos en código, logs o respuestas; usar `[REDACTED]` si hace falta referirse a ellos.
3. No hacer commit, push, deploy ni modificar `/backend` sin autorización explícita.
4. Marcar como ejecutado solo lo que se comprobó; anotar los comandos y resultados relevantes.
