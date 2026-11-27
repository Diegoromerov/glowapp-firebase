# Ubicación y fuente del backend GlowApp

**Conclusión para búsquedas futuras:** el backend activo de GlowApp vive en
`Diegoromerov/glowapp-firebase/backend/` y se despliega en Railway. No está
implementado como Firebase Functions. `Diegoromerov/belleza-app/backend/` es la
copia del monorepo original y se conserva como histórico; no es la fuente
actual del servicio que consumen las apps.

## Evidencia contrastada en GitHub

1. El workflow [`backend-ci.yml`](../.github/workflows/backend-ci.yml) del repo
   `glowapp-firebase` declara que desde el 2026-11-02 `glowapp-api` se despliega
   desde este repositorio, con raíz `/backend`, y que `belleza-app` queda como
   histórico. Corre validaciones y pruebas bajo `backend/`; además comprueba el
   contrato entre las apps y la API.
2. [`backend/Dockerfile`](../backend/Dockerfile) empaqueta el servidor Node.js,
   define el entorno de producción, expone el puerto 8080 y usa
   [`backend/entrypoint.sh`](../backend/entrypoint.sh) como arranque, incluyendo
   las migraciones antes de levantar la API.
3. [`ApiService`](../packages/glow_core/lib/src/services/api_service.dart) usa
   `https://glowapp-api-production.up.railway.app` como host de producción. El
   workflow de apps inyecta URLs de Railway distintas para producción y staging
   con `--dart-define=API_URL`.
4. Al consultar los endpoints públicos `/api/health` el 2026-11-27, producción
   respondió `status: OK`, `service: glowapp-api`, commit
   `40e6a72cca66b7141e4fce86213e33ea45e45827`, PostgreSQL disponible y
   `servingFabricatedData: false`. Staging respondió `status: OK`,
   `service: glowapp-api-staging`, commit
   `b47e6ce1b16d94848e2b78b4a785f2b7ef2822af`, PostgreSQL disponible y
   `servingFabricatedData: false`. La ruta `/api/providers` también respondió
   HTTP 200 con `X-App-Audience: client`.
5. En la fecha de consulta, los commits recientes que modifican `backend/`
   están en `glowapp-firebase` (incluido el commit de producción informado por
   `/api/health`), mientras que el último cambio localizado bajo `backend/` en
   `belleza-app` es del 2026-11-02. Además, el split frontend se documentó como
   extracción de apps/packages en [`EXTRACTION.md`](../EXTRACTION.md); la API se
   incorporó después y por eso la primera documentación quedó contradictoria.
6. `belleza-app` conserva `backend/` y [`railway.json`](https://github.com/Diegoromerov/belleza-app/blob/main/railway.json),
   y su documento [`SPLIT_ARCHITECTURE_FINAL.md`](https://github.com/Diegoromerov/belleza-app/blob/main/docs/SPLIT_ARCHITECTURE_FINAL.md)
   describe el diseño original Railway + Firebase Hosting. Esto prueba la
   historia y explica la confusión, pero no demuestra que ese repo siga siendo
   fuente del despliegue actual.

## Qué significa Firebase aquí

- Firebase Hosting publica los bundles web de `glow_client` y `glow_provider`.
- Firebase Auth, FCM, Firestore y Storage son servicios usados por las apps.
- La API central es una aplicación Node.js/Express con PostgreSQL y Redis,
  desplegada en Railway.
- Los archivos Firebase de estos repos no configuran `functions`; no hay
  evidencia de que la API central se haya migrado a Firebase Functions.

## Nota sobre dominios

El host de Railway de producción y los hosts Railway de staging respondían al
momento de la comprobación. `api.glowapp.com` no resolvió DNS entonces, así que
no debe documentarse como endpoint funcional confirmado sin volver a verificarlo.

## Cuidado con documentación antigua

El README inicial del split decía que el backend vivía en `belleza-app` y que
`glowapp-firebase` no lo contenía. Esa afirmación quedó obsoleta cuando el
backend se incorporó a este repo. Si otra documentación contradice esta nota,
priorizar como evidencia actual el workflow `backend-ci.yml`, el `ApiService`,
los artefactos de despliegue de `backend/` y la respuesta viva de `/api/health`.
