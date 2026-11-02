# Deprecación de `portafolio_servicios` (JSONB) — GlowApp Backend

**Fecha:** 2026-08-18
**Fase:** FASE 1 — Consolidar fuente única de servicios
**Estado:** DEPRECADO (candidato a DROP en migración futura separada)

## Qué se deprecó

El campo `portafolio_servicios JSONB DEFAULT '[]'::jsonb` de la tabla
`perfiles_prestador` dejó de ser una fuente de verdad para los servicios
que ofrece un proveedor.

## Por qué

Auditoría exhaustiva de referencias (Paso 1 de la FASE 1) clasificó el
campo como **HUÉRFANO CONFIRMADO**:

| Ubicación | Tipo de referencia |
|---|---|
| `backend/init.sql:65` | Definición de schema |
| `backend/schema.sql:68` | Definición de schema |
| `backend/seed/prestador-demo.sql` | Escritura en seed legacy (removida) |
| `backend/src/**` (controllers, services, routes) | **0 referencias** |
| `backend/migrations/**` | **0 referencias** |
| `frontend/lib/**` (Dart) | **0 referencias** (el "portafolio" del frontend son fotos de `portfolio_items`) |
| `railway_seed.sql`, `seed.sql`, admin, ai_worker, docs | **0 referencias** |

Ningún controlador, servicio o ruta lee o escribe el campo en runtime.
El frontend consume servicios exclusivamente desde la tabla normalizada:

- `GET /api/providers/:id` → `services` + `portfolio_items` (providerController)
- `GET /api/services/provider` → tabla `services` (serviceController)
- `provider_services_screen.dart` → `ApiService.fetchProviderServices()` → `/services/provider`

## Fuente de verdad única (a partir de ahora)

- **Servicios ofrecidos:** tabla `services` (FK `bookings.service_id → services.id`).
- **Portafolio visual (fotos):** tabla `portfolio_items`.

## Cambios aplicados en esta fase

1. `backend/seed/prestador-demo.sql` — se eliminó la columna y el valor
   JSONB del INSERT de `perfiles_prestador` (el seed sigue creando los
   servicios en la tabla `services`, sección 4 del mismo archivo).
2. `backend/init.sql` — comentario de deprecación
   sobre la definición de la columna. (`backend/schema.sql` se eliminó en el
   fix P0 `t_fix_tenant_01`: era un volcado pg_dump UTF-16 divergente de
   `init.sql`; la fuente única de verdad del esquema es `init.sql` +
   `backend/migrations/*.sql`.)

## NO aplicado (requiere decisión explícita)

- **DROP COLUMN** de `portafolio_servicios`: prohibido por el alcance de
  esta fase. Debe ejecutarse en una migración separada y posterior.
