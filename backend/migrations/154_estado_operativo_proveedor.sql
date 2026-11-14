-- 154_estado_operativo_proveedor.sql
--
-- T-075 de D-GL-031 (Modo Exploración).
--
-- Hoy `onboarding_completo` responde tres cosas a la vez: quién es el usuario,
-- si sus documentos son válidos y si puede cobrar. Eso obliga a subir cédula,
-- RUT y certificado ANTES de ver la aplicación, y la mayoría abandona ahí.
--
-- Este campo separa la tercera pregunta: `estado_operativo` dice qué puede HACER
-- la cuenta, no qué documentos tiene.
--
--   EXPLORACION     — entró sin verificar: arma su negocio, no transacciona
--   EN_VERIFICACION — subió documentos, el equipo los revisa
--   HABILITADO      — documentos y RUT aprobados: publica, cobra, factura
--   SUSPENDIDO      — congelada (fraude, queja o documentos vencidos)
--
-- ABUELO (leer antes de aplicar): quien ya está operando NO puede quedar en
-- exploración, o se le corta la venta el día del despliegue. Por eso el backfill
-- marca HABILITADO a todo el que ya completó el onboarding, y EXPLORACION queda
-- como default sólo para las cuentas nuevas.
--
-- Idempotente: el runner aplica este archivo en cada despliegue.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS estado_operativo VARCHAR(16) NOT NULL DEFAULT 'EXPLORACION',
  ADD COLUMN IF NOT EXISTS estado_operativo_desde TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estado_operativo_motivo TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_usuarios_estado_operativo') THEN
    ALTER TABLE usuarios
      ADD CONSTRAINT chk_usuarios_estado_operativo
      CHECK (estado_operativo IN ('EXPLORACION', 'EN_VERIFICACION', 'HABILITADO', 'SUSPENDIDO'));
  END IF;
END $$;

-- Backfill: nadie que ya opera pierde el acceso. Sólo se toca la primera vez
-- (`estado_operativo_desde IS NULL`), así un cambio posterior no se pisa.
UPDATE usuarios
   SET estado_operativo = 'HABILITADO',
       estado_operativo_desde = NOW(),
       estado_operativo_motivo = 'Backfill de la migración 154: cuenta que ya operaba antes de Modo Exploración.'
 WHERE estado_operativo_desde IS NULL
   AND (onboarding_completo = true OR rol IN ('ADMIN', 'SUPERADMIN', 'admin', 'superadmin'));

UPDATE usuarios
   SET estado_operativo_desde = NOW()
 WHERE estado_operativo_desde IS NULL;

-- Bitácora append-only: quién movió el estado, cuándo y por qué. Sin esto no se
-- puede defender ante un reclamo "yo ya estaba habilitado".
CREATE TABLE IF NOT EXISTS estado_operativo_historial (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  estado_anterior VARCHAR(16),
  estado_nuevo VARCHAR(16) NOT NULL,
  motivo TEXT,
  cambiado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_estado_operativo_historial_usuario
  ON estado_operativo_historial (usuario_id, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_usuarios_estado_operativo
  ON usuarios (estado_operativo)
  WHERE estado_operativo <> 'HABILITADO';

COMMENT ON COLUMN usuarios.estado_operativo IS
  'Qué puede hacer la cuenta (D-GL-031): EXPLORACION no transacciona, HABILITADO sí. Independiente de onboarding_completo.';
COMMENT ON COLUMN usuarios.estado_operativo_desde IS
  'Cuándo se movió por última vez el estado operativo. Arranca la caducidad de 30 días de exploración.';
COMMENT ON COLUMN usuarios.estado_operativo_motivo IS
  'Por qué está en ese estado (backfill, aprobación de documentos, suspensión).';
COMMENT ON TABLE estado_operativo_historial IS
  'Bitácora append-only de cambios de estado operativo (D-GL-031).';
