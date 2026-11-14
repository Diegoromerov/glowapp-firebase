-- 155_vitrina_publica_proveedor.sql
--
-- T-077 de D-GL-031 (Modo Exploración).
--
-- Un proveedor que aún no está habilitado necesita algo que mostrar: la vitrina
-- es su perfil público, compartible por enlace, con el sello "perfil en
-- preparación · aún no recibe reservas" y SIN botón de reserva. No aparece en
-- búsquedas ni en el directorio: sólo se llega por el enlace.
--
-- El slug se deriva del nombre y es único por proveedor. Se guarda y no se
-- recalcula en cada petición porque forma parte del enlace que el proveedor
-- comparte; cambiarlo rompería sus publicaciones.
--
-- Idempotente.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS slug VARCHAR(60);

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_slug_unique
  ON usuarios (LOWER(slug))
  WHERE slug IS NOT NULL;

COMMENT ON COLUMN usuarios.slug IS
  'Identificador legible del perfil público (/p/<slug>). Único y estable: cambiarlo rompe los enlaces compartidos.';
