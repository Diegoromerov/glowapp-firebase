# Onboarding SaaS — Fase 3: planes y límites

**Estado:** cerrada y verificada en producción.
**Avance:** 100 %.
**Corte de verificación:** 24 de noviembre de 2026.

## Objetivo y criterio de cierre

Presentar los niveles disponibles con beneficios y cuotas comprensibles, y hacer que la API aplique los mismos límites y módulos del catálogo. La fase se cierra al integrar los cambios, desplegar el cliente y la API en producción y verificar el catálogo y la pantalla de oferta.

## Oferta publicada que se verificó en producción

El endpoint `GET /api/saas/catalog` de producción respondió HTTP 200 con el catálogo V2. Los únicos niveles habilitados para contratación son:

| Nivel | Precio mensual | Personas | Reservas directas al mes | Estado |
| --- | ---: | ---: | ---: | --- |
| Prueba Gratis | $0 | 3 | 150 | Disponible por 14 días |
| Freemium | $0 | 1 | 30 | Disponible permanentemente |
| Básico | $99.000 COP | 5 | Ilimitadas | Disponible |

Crecimiento, Profesional y Empresarial se muestran como propuestas aún no disponibles. Los complementos del catálogo tienen `available: false`.

## Cambios de esta fase

- El selector del onboarding usa los planes del catálogo del API. Si el catálogo no carga, muestra solo Prueba Gratis, Freemium y Básico con precios y límites locales alineados al catálogo.
- La pantalla presenta cuotas de equipo y reservas, beneficios del catálogo, precios propuestos separados del precio activo y una señal de que los planes no contratables todavía no se pueden activar.
- El modelo Flutter conserva límites ilimitados (`null`) y refleja las cuotas publicadas de los tres niveles activos.
- Se ampliaron los entitlements centrales y se añadieron verificaciones de plan a Caja, Inventario, Recursos, Recetas, diagnóstico/cumplimiento y fidelización.
- La creación de recursos comprueba el cupo dentro de la misma transacción que bloquea el perfil de negocio y crea el registro.
- Las reservas directas aplican la cuota del plan en una transacción; las invitaciones del equipo aplican el máximo de personas.

## Validación y publicación

- Pruebas Node focalizadas de catálogo, paridad Flutter, entitlements, middleware y cupos: **23/23 aprobadas**.
- Backend CI aprobó sintaxis, pruebas, aislamiento/RLS y contrato API.
- CI del proveedor aprobó análisis y pruebas y generó el build web.
- El catálogo de producción respondió HTTP 200 con `X-App-Audience: provider`; se confirmó visualmente que el onboarding publicado presenta los planes activos, sus límites y las propuestas marcadas como no disponibles.
- Commit de producción: `766a3bba6a36330aecd25fd09e16029437ab1a5b`, integrado mediante [PR #70](https://github.com/Diegoromerov/glowapp-firebase/pull/70).
- Despliegue Railway: `1f6da2a2-7af8-4026-922a-f333eea3186f`, estado `SUCCESS`, commit `766a3bb`.
- Workflow Firebase Hosting: [45502082810](https://github.com/Diegoromerov/glowapp-firebase/actions/runs/45502082810), estado `success`, publicación de `glow_provider` en `live`.

La suite Flutter completa no terminó en el entorno local por límites de espacio y memoria; la CI oficial sí aprobó las pruebas de `glow_core` y `glow_provider`. No se forzaron respuestas de bloqueo contra cuentas de clientes en producción; los controles se verificaron mediante pruebas automatizadas y CI.

## Resultado

La oferta, sus límites y las compuertas SaaS están integradas y publicadas en producción. La fase 3 queda cerrada.
