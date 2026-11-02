-- Rollback de 087_add_provider_rut_responsibility.sql
--
-- OJO: revierte el esquema y las constraints, pero NO restaura el valor anterior
-- de `responsable_iva` (la migración no guarda el valor previo). Si se necesita
-- volver atrás el comportamiento, hay que decidir explícitamente qué se presume
-- para quien no ha declarado — no se puede adivinar.
--
-- No hay pérdida de dinero: `responsable_iva` sólo decide cómo se desglosa un
-- precio que ya incluye el impuesto. Lo que se pierde es la declaración de los
-- prestadores que ya la hubieran hecho.

DROP INDEX IF EXISTS idx_usuarios_responsabilidad_sin_declarar;

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS fk_usuarios_responsabilidad_cambiada_por;

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS chk_usuarios_responsabilidad_fuente;

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS chk_usuarios_rut_responsabilidad;

ALTER TABLE usuarios
  DROP COLUMN IF EXISTS rut_numero,
  DROP COLUMN IF EXISTS rut_responsabilidad_codigo,
  DROP COLUMN IF EXISTS responsable_iva_override,
  DROP COLUMN IF EXISTS responsabilidad_iva_fuente,
  DROP COLUMN IF EXISTS responsabilidad_iva_actualizada_at,
  DROP COLUMN IF EXISTS responsabilidad_iva_cambiada_por;
