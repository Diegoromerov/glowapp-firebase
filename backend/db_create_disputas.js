const { pool } = require('./src/config/db');

async function createDisputas() {
  try {
    console.log('Creating disputas table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS disputas (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id      UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
        iniciado_por    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
        tipo_actor      VARCHAR(20) NOT NULL CHECK (tipo_actor IN ('CLIENTE','PRESTADOR','SISTEMA')),
        tipo            VARCHAR(50) NOT NULL,
        descripcion     TEXT,
        evidencia_urls  TEXT[] DEFAULT '{}',
        monto_disputado NUMERIC(12,2) NOT NULL,
        estado          VARCHAR(20) NOT NULL DEFAULT 'ABIERTA',
        resuelto_por    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        resolucion      VARCHAR(50),
        porcentaje_prestador NUMERIC(5,2),
        nota_resolucion TEXT,
        creado_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actualizado_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resuelto_at     TIMESTAMPTZ,
        sla_limite_at   TIMESTAMPTZ
      );
    `);

    console.log('Creating indexes for disputas...');
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_disputas_booking ON disputas(booking_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_disputas_estado ON disputas(estado, creado_at DESC);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_disputas_sla ON disputas(sla_limite_at) WHERE estado IN ('ABIERTA','EN_REVISION');`);

    console.log('Creating SLA trigger function...');
    await pool.query(`
      CREATE OR REPLACE FUNCTION set_disputa_sla()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.sla_limite_at IS NULL THEN
          NEW.sla_limite_at = NEW.creado_at + INTERVAL '48 hours';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    console.log('Binding SLA trigger to disputas table...');
    await pool.query(`DROP TRIGGER IF EXISTS trg_disputa_sla ON disputas;`);
    await pool.query(`
      CREATE TRIGGER trg_disputa_sla
      BEFORE INSERT ON disputas
      FOR EACH ROW EXECUTE FUNCTION set_disputa_sla();
    `);

    console.log('Binding updated_at trigger to disputas table...');
    await pool.query(`DROP TRIGGER IF EXISTS trg_disputa_updated_at ON disputas;`);
    await pool.query(`
      CREATE TRIGGER trg_disputa_updated_at
      BEFORE UPDATE ON disputas
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    console.log('✅ TABLE disputas AND TRIGGERS CREATED SUCCESSFULY!');
  } catch (err) {
    console.error('❌ Error creating disputas table:', err);
  } finally {
    pool.end();
  }
}

createDisputas();
