-- ============================================================================
-- Migración 070: vocabulario de roles completo (SALON, ADMIN)
-- ============================================================================
-- POR QUÉ VA SOLA
--   `usuarios.rol` es del tipo enumerado `tipo_rol`, y hoy ese enum solo admite
--   CLIENTE y PRESTADOR. Consecuencia medida: un usuario SALON o ADMIN no se
--   puede guardar, y las ramas SALON/ADMIN de toApiRole (config/jwt.js:16-17)
--   son código muerto. El rol "salón" existe hoy únicamente como tipo de
--   trabajador (tipo_trabajador.ADMIN_SALON).
--
-- POR QUÉ NO ESTÁ EN 071
--   PostgreSQL 16 permite ALTER TYPE ... ADD VALUE dentro de una transacción,
--   pero prohíbe USAR el valor nuevo en esa misma transacción. El runner envía
--   el archivo completo como una sola consulta (backend/index.js:1666), así que
--   el alta de valores va en su propio archivo y ningún archivo posterior a
--   éste puede usar los valores dentro de la misma transacción que los crea.
--   Mismo patrón que 010:4 con tipo_wallet_tx.
-- ============================================================================

ALTER TYPE tipo_rol ADD VALUE IF NOT EXISTS 'SALON';
ALTER TYPE tipo_rol ADD VALUE IF NOT EXISTS 'ADMIN';

DO $$
BEGIN
  RAISE NOTICE '070: tipo_rol = %', (
    SELECT string_agg(enumlabel, ' | ' ORDER BY enumsortorder)
      FROM pg_enum WHERE enumtypid = 'tipo_rol'::regtype
  );
END $$;
