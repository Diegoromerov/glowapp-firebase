# Onboarding SaaS — Fase 2: configuración inicial del salón

**Estado:** implementación y backend publicados en producción; verificaciones funcionales autenticadas completadas. Pendiente únicamente la inspección visual manual final en móvil y escritorio.  
**Alcance:** recopilar y mantener datos básicos, ubicación y horario comercial de una sede, y permitir completar su catálogo de servicios desde el módulo existente.

## Implementación

- El alta captura nombre, identificación tributaria, dirección, ciudad, teléfono y ubicación.
- El onboarding incorpora editor opcional del horario comercial por día. Se guarda después del bootstrap idempotente usando el salon_id canónico.
- La migración 198 agrega `salones.horario_atencion` JSONB nullable.
- `GET /api/salon/:salonId/profile` y `PATCH /api/salon/:salonId/profile` requieren autenticación y rol de propietario/administrador; validan campos y horario.
- La pantalla «Perfil del salón», accesible desde «Más», permite editar nombre, NIT, ciudad, dirección, teléfono y horario sin crear otra sede.
- El horario de la sede es independiente del horario individual de cada profesional (`perfiles_prestador.weekly_schedule`).
- El catálogo de servicios existente sigue siendo el lugar para crear y administrar servicios.

## Despliegue

- Backend: Railway producción, despliegue `fff6d537-3bc6-4d9e-a1d6-0f5b77506d2b` SUCCESS (25 nov 2026 00:06 UTC); PostgreSQL saludable.
- Migración 198 aplicada en producción.
- Cliente proveedor: publicado en Firebase Hosting `https://glowapp-provider.web.app`; despliegue confirmado con HTTP 200 y `Last-Modified: Wed, 25 Nov 2026 00:22:38 GMT`.
- El cambio de cliente se integró en `main` mediante PR #72. El build Flutter web release terminó con advertencias preexistentes de WebAssembly y una referencia ausente al directorio de assets `packages/glow_core/assets/motion`; el build produjo `build/web` y ese artefacto fue desplegado.

## Verificación funcional en producción

- Propietario QA inició sesión, leyó el perfil, guardó datos y horario y volvió a leerlos; el horario persistió.
- Repetir la creación devolvió el mismo salón (`created=false`, ID 17); no duplicó la sede.
- Repetir el bootstrap SaaS devolvió el perfil existente.
- Acceso anónimo al perfil: HTTP 401.
- Cuenta PRESTADOR sin membresía en ese salón: GET y PATCH devolvieron HTTP 403. El nombre y datos del salón no cambiaron.
- Se creó un servicio QA inactivo (borrador); la API devolvió HTTP 201 y apareció en el catálogo del propietario.
- Cuenta y salon de QA, datos de acceso y evidencia detallada: `docs/fases/QA_SALON_FASE_2.md`.

## Criterios de cierre y pendiente

- [x] Alta inicial con horario y datos básicos, con tenant válido.
- [x] Reintentos idempotentes sin duplicar salón ni perfil SaaS.
- [x] Edición y persistencia del perfil/horario.
- [x] Restricción de acceso por rol y autenticación.
- [x] Catálogo operativo: crear y listar un servicio QA en borrador.
- [x] Backend, migración y cliente desplegados.
- [ ] Inspección visual manual final en escritorio y móvil, incluyendo siete días, días cerrados y validación de horarios. Esta sesión no dispone de navegador interactivo; las capturas headless no fueron fiables.

**Cierre:** desarrollo y verificación funcional completados; la fase queda pendiente solo de la revisión visual manual para marcarla cerrada al 100%.