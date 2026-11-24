# Onboarding SaaS — Fase 3: planes y límites

**Estado:** implementación local lista para revisión y publicación; todavía no está desplegada.
**Avance estimado:** 85 %.
**Corte de verificación:** 24 de noviembre de 2026.

## Objetivo y criterio de cierre

Presentar los niveles disponibles con beneficios y cuotas comprensibles, y hacer que la API aplique los mismos límites y módulos del catálogo. La fase se cierra al integrar los cambios, desplegar el cliente y el API en producción y verificar catálogo, cuotas y bloqueos de capacidades.

## Oferta publicada que se verificó en producción

El endpoint `GET /api/saas/catalog` de producción respondió HTTP 200 con el catálogo V2. Los únicos niveles habilitados para contratación son:

| Nivel | Precio mensual | Personas | Reservas directas al mes | Estado |
| --- | ---: | ---: | ---: | --- |
| Prueba Gratis | $0 | 3 | 150 | Disponible por 14 días |
| Freemium | $0 | 1 | 30 | Disponible permanentemente |
| Básico | $99.000 COP | 5 | Ilimitadas | Disponible |

Crecimiento, Profesional y Empresarial siguen figurando como propuestas o compatibilidad con cuentas previas; la app no los ofrece como planes contratables. Los complementos del catálogo tienen `available: false`.

## Cambios de esta fase

- El selector del onboarding usa los planes del catálogo del API. Si el catálogo no carga, muestra solo Prueba Gratis, Freemium y Básico con precios y límites locales alineados al catálogo.
- La pantalla presenta cuotas de equipo y reservas, beneficios del catálogo, precios propuestos separados del precio activo y una señal de que los planes no contratables todavía no se pueden activar.
- El modelo Flutter conserva límites ilimitados (`null`) y ya refleja todas las cuotas publicadas de los tres niveles activos.
- Se ampliaron los entitlements centrales y se añadieron verificaciones de plan a Caja, Inventario, Recursos, Recetas, diagnóstico/cumplimiento y fidelización en las rutas de clientes.
- La creación de recursos comprueba el cupo dentro de la misma transacción que bloquea el perfil de negocio y crea el registro, evitando que solicitudes concurrentes superen el máximo.
- Las reservas directas ya aplican la cuota del plan en una transacción; las invitaciones del equipo ya aplican el máximo de personas. Se verificó el código de ambas rutas existentes y sus valores contra el catálogo.

## Validación realizada

- 23 pruebas Node de catálogo, paridad Flutter, disponibilidad comercial, entitlements, rutas de módulos y cupo transaccional de recursos: **23/23 aprobadas**.
- `node --check` en los controladores y rutas modificadas: aprobado.
- Análisis Dart del onboarding: sin errores de compilación; quedaron avisos de estilo/deprecaciones ya presentes.
- Análisis general del proveedor: terminó sin errores bloqueantes al permitir avisos; reportó 1.346 avisos/infos del proyecto.
- La suite Flutter completa no terminó: la primera ejecución se quedó sin espacio en C:; al mover temporales a D:, la VM falló al crear threads por falta de memoria. La CI del repositorio debe completar esta comprobación antes de publicar.
- El catálogo en producción coincide con los límites documentados, pero esto no demuestra que las nuevas compuertas de módulos o el cupo de recursos ya estén en producción.

## Pendiente para cerrar la fase

1. Ejecutar CI en la rama del cambio y resolver cualquier regresión.
2. Integrar el cambio en `main`; el API de Railway sigue esa rama.
3. Publicar `glow_provider` a Firebase Hosting con el workflow manual, app `prestador`, canal `live` y `deploy=true`.
4. Comprobar después del despliegue el selector del onboarding, catálogo servido, cuotas y respuestas 403 para módulos que el plan no incluye. No cambiar planes ni datos de salones existentes durante las pruebas.
5. Adjuntar los IDs de ejecución, commit y despliegues de Railway/Firebase a este documento.

## Diferencia entre el estado de producción y este cambio

Producción ya sirve el catálogo V2 y los valores correctos de Prueba Gratis, Freemium y Básico. Los cambios de presentación y compuertas descritos aquí están solo en el checkout de trabajo hasta que pasen CI, entren en `main` y se publiquen por los dos canales.
