# GlowApp — Apps (client + provider)

Monorepo actual de GlowApp: apps Flutter, núcleo compartido, panel admin y API backend.

## Ubicación del backend (fuente actual)

El backend activo está en **este repositorio**, dentro de [`backend/`](backend/),
y se despliega en Railway como `glowapp-api` (producción) y
`glowapp-api-staging` (staging). Firebase aloja las apps web y presta servicios
como Auth/FCM/Firestore/Storage; **la API REST no corre en Firebase Functions**.

`Diegoromerov/belleza-app` fue el monorepo matriz y conserva copias/configuración
históricas. No lo tomes como fuente de despliegue actual del backend. La
documentación antigua que aún dice que el backend vive allí está obsoleta.
La evidencia operativa y el historial del split están resumidos en
[`docs/UBICACION_BACKEND.md`](docs/UBICACION_BACKEND.md).

| Ruta | Qué es |
|---|---|
| `apps/glow_client` | App del usuario final (`APP_AUDIENCE=client`) |
| `apps/glow_provider` | App del salón/proveedor (`APP_AUDIENCE=provider`) |
| `packages/glow_core` | Núcleo compartido (tema, modelos, cliente API) |
| `backend/` | API Node.js/Express, PostgreSQL y Redis |
| `admin/` | Panel administrativo web |

Las apps consumen la API de Railway; revisa `ApiService` y `.github/workflows/apps-ci.yml`
para los hosts configurados en producción y staging.

## Arranque

```bash
dart pub global activate melos 6.2.0
melos bootstrap
melos run analyze
melos run test
```

## CI/CD

`.github/workflows/apps-ci.yml` valida/compila/publica las apps en Firebase.
`.github/workflows/backend-ci.yml` valida el backend desde `backend/` y comprueba
el contrato app/API. Son flujos separados.

## Firestore

| Proyecto | Config | Reglas | Índices |
|---|---|---|---|
| `glowapp-client` | `firebase.client.json` | `firestore-client.rules` | `firestore-client.indexes.json` |
| `glowapp-provider` | `firebase.provider.json` | `firestore-provider.rules` | `firestore-provider.indexes.json` |

## Origen

Las apps y `packages/glow_core` se extrajeron originalmente de
`Diegoromerov/belleza-app` @ `4099472a` (`main`), filtrando `apps/` + `packages/`
y archivos de build. Después, el backend también se incorporó y su fuente activa
pasó a ser este repositorio. Ver [`EXTRACTION.md`](EXTRACTION.md) y
[`docs/UBICACION_BACKEND.md`](docs/UBICACION_BACKEND.md).
