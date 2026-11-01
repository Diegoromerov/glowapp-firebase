# GlowApp — Apps (client + provider)

Aplicaciones Flutter del split GlowApp: dos apps sobre un núcleo compartido.

| Ruta | Qué es |
|---|---|
| `apps/glow_client` | App del usuario final (`APP_AUDIENCE=client`) |
| `apps/glow_provider` | App del salón/proveedor (`APP_AUDIENCE=provider`) |
| `packages/glow_core` | Núcleo compartido (tema, modelos, cliente API) |

El **backend** vive en el repo matriz (`Diegoromerov/belleza-app`).
Este repo no lo contiene: consume `https://api.glowapp.com`.

## Arranque

```bash
dart pub global activate melos 6.2.0
melos bootstrap
melos run analyze
melos run test
```

## CI/CD

`.github/workflows/apps-ci.yml` — jobs: `monorepo-setup`, `glow-client-verify`,
`glow-provider-verify`, `deploy-client-firebase`, `deploy-provider-firebase`.
No depende del backend: los `needs:` de los deploy apuntan solo a su verify.

## Firestore

| Proyecto | Config | Reglas | Índices |
|---|---|---|---|
| `glowapp-client` | `firebase.client.json` | `firestore-client.rules` | `firestore-client.indexes.json` |
| `glowapp-provider` | `firebase.provider.json` | `firestore-provider.rules` | `firestore-provider.indexes.json` |

## Origen

Extraído de `Diegoromerov/belleza-app` @ `4099472a` (`main`), filtrando por ruta
`apps/` + `packages/` + archivos de build. Ver `EXTRACTION.md`.
