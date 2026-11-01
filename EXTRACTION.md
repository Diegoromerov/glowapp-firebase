# Procedencia de la extracción

Extraído de `Diegoromerov/belleza-app` (repo matriz) el 2026-11-01.

| Dato | Valor |
|---|---|
| Commit fuente | `4099472a3811b167de39aa6a9c3173f87fb19343` (`main`, 2026-10-31) |
| Commits filtrados | 51 (los de `main` que tocan `apps/` o `packages/`) |
| Criterio | ruta, no mensaje de commit ni nombre de rama |
| Rutas conservadas | `apps/`, `packages/`, `melos.yaml`, `pubspec.yaml`, `pubspec.lock`, `.gitattributes` |
| Rutas descartadas | `backend/` (2.294 archivos), `frontend/`, `admin-dashboard/`, `ai_worker/`, `docs/`, `tools/`, `.secrets/`, `.dart_tool/`, `.hermes/`, `coverage/`, `railway_deploy/` |
| Verificación | `verify_split_v2.sh` — 12 invariantes; `apps/` y `packages/` idénticos por tree-hash |
| Tamaño del object store | 5,82 MiB (los objetos de la matriz se purgan con `gc --prune=now`) |

## Cómo se agregó lo que no venía en `main`

- `firebase.json`, `firebase.client.json`, `firebase.provider.json`: copiados de `main`.
- `firestore-*.rules` / `firestore-*.indexes.json`: no estaban versionados en ningún repo;
  vivían solo en `.secrets/` de un clon de auditoría. Se versionan aquí porque son código
  de seguridad, no credenciales.
- `.github/workflows/apps-ci.yml`: recortado del workflow mezclado `glowapp-firebase-deploy.yml`
  (jobs `monorepo-setup`, `glow-client-verify`, `glow-provider-verify`, `deploy-*-firebase`),
  con los `needs:` de los deploy desacoplados de `backend-ci`.
- `README.md` y `.gitignore`: nuevos.

## Reversión

La matriz no se tocó. Su `main` sigue en `4099472a` y la rama
`feat/split-client-provider-apps` sigue en `1cc86949` como archivo histórico.
Borrar este repo no afecta al repo matriz.
