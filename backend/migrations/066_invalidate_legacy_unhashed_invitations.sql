-- ==============================================================================
-- Migración 066: Invalidación de Invitaciones Legadas con Tokens en Texto Plano
-- ==============================================================================
-- Motivo: Al pasar la columna token_invitacion a almacenar exclusivamente el hash
-- SHA-256 de 64 caracteres hex, las invitaciones creadas antes de este cambio
-- contienen el token original en texto plano (32 hex). Invalidamos las invitaciones
-- activas para forzar la emisión de un nuevo enlace con hashing seguro.
--
-- Idempotencia: UPDATE condicional que expira registros activos.
-- ==============================================================================

DO $$
BEGIN
    UPDATE salon_invitaciones
       SET expires_at = NOW()
     WHERE usado = false
       AND expires_at > NOW()
       AND length(token_invitacion) = 32;

    RAISE NOTICE '✅ Migración 066: Invitaciones pendientes legadas invalidadas exitosamente.';
END $$;
