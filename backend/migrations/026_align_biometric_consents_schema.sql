-- backend/migrations/026_align_biometric_consents_schema.sql
-- Corrección de esquema: biometric_consents (producción) vs. código del backend
--
-- ============================================================================
-- CONTEXTO PARA ANTIGRAVITY — LEER ANTES DE EJECUTAR
-- ============================================================================
--
-- QUÉ PASÓ:
-- La tabla `biometric_consents` que existe HOY en la base de datos de
-- producción (Railway) NO coincide con las columnas que las migraciones
-- 020 y 021 dicen que deberían existir, ni con las columnas que usa
-- `backend/src/routes/biometricConsentRoutes.js` en sus queries SQL.
--
-- Verificado directamente contra producción con:
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'biometric_consents'
--   ORDER BY ordinal_position;
--
-- Columnas REALES en producción ahora mismo:
--   id, user_id, consent_type, is_active, ip_address, device_info,
--   created_at, active
--
-- Columnas que el CÓDIGO espera (routes + migraciones 020/021):
--   id, user_id, version, accepted_at, ip, user_agent, revoked_at, active
--
-- No coinciden: version, ip, user_agent, accepted_at, revoked_at
-- simplemente NO EXISTEN en la tabla real.
--
-- POR QUÉ IMPORTA (impacto funcional, no solo cosmético):
-- Las queries en biometricConsentRoutes.js hacen INSERT/SELECT referenciando
-- columnas que no existen físicamente. Contra Postgres real, esto lanza
-- un error del tipo `column "version" does not exist`, que las rutas
-- capturan en su try/catch y devuelven como HTTP 500. Es decir:
--   - POST /api/consent        -> probablemente 500 en producción ahora mismo
--   - GET  /api/consent/status/:userId -> probablemente 500 en producción ahora mismo
-- Como el frontend interpreta cualquier error en hasConsent() como "false"
-- y cualquier error en saveConsent() como excepción visible al usuario,
-- el flujo completo de consentimiento biométrico (Pantalla 0, obligatoria
-- bajo Ley 1581 antes de cualquier escaneo facial/de manos) puede estar
-- roto en producción para usuarios nuevos que nunca han dado consentimiento.
--
-- Hay al menos UN registro real en la tabla (user_id = 1, creado el
-- 2026-07-06) que representa evidencia de consentimiento bajo Ley 1581.
-- Por eso esta migración usa RENAME en vez de DROP + CREATE: no se puede
-- perder esa fila ni su auditoría (ip, fecha, user agent).
--
-- QUÉ HACE ESTA MIGRACIÓN:
-- 1. Renombra las columnas reales a los nombres que el código ya usa,
--    en vez de tocar el código de las rutas. Se eligió este sentido
--    (esquema -> código) porque el código representa el contrato "oficial"
--    documentado en las migraciones 020/021, y porque cambiar nombres de
--    columna es más simple y más seguro que reescribir queries SQL.
-- 2. Agrega `revoked_at`, que no existe en ningún lado todavía pero SÍ lo
--    usa el endpoint POST /api/consent/revoke (`UPDATE ... SET revoked_at = NOW()`).
--    Sin esta columna, la revocación de consentimiento también fallaría.
-- 3. Los tipos de dato ya son compatibles entre ambos esquemas, así que
--    los RENAME son seguros y no requieren conversión (varchar -> varchar,
--    text -> text, timestamptz -> timestamptz). No hay pérdida de datos.
-- 4. Verifica/crea el índice único parcial de la migración 021
--    (`unique_active_consent`), por si el DROP/CREATE manual que se hizo
--    en un entorno de desarrollo (Docker local) no se refleja en Railway.
--
-- QUÉ NO HACE (a propósito):
-- - No toca `consent_type` vs `version` como two-way merge: `consent_type`
--   se renombra directo a `version`. Si en producción hay registros con
--   consent_type distinto de 'standard'/'1.0', revisar antes de aplicar.
-- - No borra ni modifica la fila existente de user_id = 1.
--
-- ANTES DE EJECUTAR EN RAILWAY (obligatorio):
-- 1. Backup de la tabla completa:
--      pg_dump -h <host> -U <user> -d <db> -t biometric_consents > biometric_consents_backup_pre026.sql
-- 2. Confirmar que ninguna otra parte del código (fuera de este repo,
--    ej. admin-dashboard o algún script no versionado) lea/escriba
--    directamente `consent_type`, `ip_address`, `device_info` o `is_active`
--    contra esta tabla. (Se buscó en todo este repositorio y no se
--    encontró ningún otro consumidor, pero Antigravity puede tener
--    contexto adicional de integraciones externas.)
-- 3. Ejecutar primero en un entorno de staging si existe, o en horario
--    de bajo tráfico si se aplica directo en producción.
--
-- ============================================================================

BEGIN;

-- 1. Renombrar columnas al contrato que espera el código actual (de forma idempotente)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'consent_type') THEN
        ALTER TABLE biometric_consents RENAME COLUMN consent_type TO version;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'ip_address') THEN
        ALTER TABLE biometric_consents RENAME COLUMN ip_address TO ip;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'device_info') THEN
        ALTER TABLE biometric_consents RENAME COLUMN device_info TO user_agent;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'biometric_consents' AND column_name = 'created_at') THEN
        ALTER TABLE biometric_consents RENAME COLUMN created_at TO accepted_at;
    END IF;
END $$;

-- 2. Agregar la columna que falta por completo (usada por /api/consent/revoke)
ALTER TABLE biometric_consents ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP WITH TIME ZONE;

-- 3. `is_active` queda como columna legado sin uso por el código actual.
--    No se elimina en esta migración por seguridad (evitar pérdida de datos
--    irreversible). Se puede limpiar en una migración futura una vez
--    confirmado que nada la lee. `active` es la columna que el código
--    realmente usa y ya existe con el tipo correcto — no se toca.

-- 4. Re-crear el índice único parcial (garantiza un solo consentimiento
--    activo por usuario), por si el entorno de producción nunca lo tuvo
--    o se perdió en el drift de esquema.
DROP INDEX IF EXISTS unique_active_consent;
CREATE UNIQUE INDEX unique_active_consent ON biometric_consents (user_id) WHERE active = TRUE;

COMMIT;
