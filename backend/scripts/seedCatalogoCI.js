// backend/scripts/seedCatalogoCI.js
//
// PROPÓSITO
// ---------
// Siembra un catálogo mínimo para que el step E2E de backend-ci.yml pueda
// comprobar de verdad que la API sirve proveedores con el rol restringido
// (app_rls_user) y el contexto de tenant de plataforma.
//
// Sin esto, la base de CI está vacía, `count` es siempre 0 y la aserción
// "catálogo no vacío" fallaría por falta de datos, no por un fallo de RLS:
// mediría el fixture, no el código.
//
// Se ejecuta como ADMIN (postgres, superusuario: bypassa RLS a propósito).
// El dato siembra el tenant de plataforma porque el catálogo público le
// pertenece (ver src/middleware/publicTenantContext.js).
//
// Idempotente: se puede correr las veces que haga falta.

const { Client } = require('pg');

const SQL = `
DO $$
DECLARE t integer;
BEGIN
  -- Tenant de plataforma: el catálogo público cuelga de él.
  SELECT id INTO t FROM tenants ORDER BY es_plataforma DESC, id ASC LIMIT 1;

  IF t IS NULL THEN
    INSERT INTO tenants (name, slug) VALUES ('Plataforma', 'plataforma') RETURNING id INTO t;
  END IF;

  UPDATE tenants SET es_plataforma = true WHERE id = t;

  -- Proveedor verificado con ubicación: es lo que lista el catálogo público.
  INSERT INTO usuarios (id, email, nombre, auth_provider, provider_id, password_hash,
                        rol, is_active, onboarding_completo, tenant_id)
  VALUES (900001, 'ci-provider@glowapp.local', 'CI Provider', 'LOCAL', 'ci-900001', 'x',
          'PRESTADOR', true, true, t)
  ON CONFLICT (id) DO UPDATE
    SET is_active = true, tenant_id = t;

  INSERT INTO perfiles_prestador (id, business_name, is_active, estatus_verificacion,
                                  ubicacion, tenant_id)
  VALUES (900001, 'CI Salon', true, 'APROBADO',
          ST_SetSRID(ST_MakePoint(-74.0721, 4.7110), 4326)::geography, t)
  ON CONFLICT (id) DO UPDATE
    SET is_active = true,
        tenant_id = t,
        estatus_verificacion = 'APROBADO',
        ubicacion = EXCLUDED.ubicacion;
END $$;
`;

async function main() {
  const connectionString = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Falta DATABASE_URL_ADMIN (o DATABASE_URL) para sembrar el catálogo');
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(SQL);
    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM perfiles_prestador WHERE is_active = true"
    );
    const { rows: diagnostico } = await client.query(`
      SELECT t.id AS tenant_plataforma_id,
             p.tenant_id AS tenant_proveedor_id,
             p.is_active,
             p.estatus_verificacion,
             p.ubicacion IS NOT NULL AS tiene_ubicacion
        FROM tenants t
        LEFT JOIN perfiles_prestador p ON p.id = 900001
       WHERE t.es_plataforma IS TRUE
       ORDER BY t.id
       LIMIT 1
    `);
    console.log(
      `catálogo de prueba sembrado: ${rows[0].n} proveedor(es) activo(s); ` +
      `tenant plataforma/proveedor=${diagnostico[0]?.tenant_plataforma_id ?? '—'}/` +
      `${diagnostico[0]?.tenant_proveedor_id ?? '—'}, ` +
      `activo=${diagnostico[0]?.is_active ?? '—'}, ` +
      `verificación=${diagnostico[0]?.estatus_verificacion ?? '—'}, ` +
      `ubicación=${diagnostico[0]?.tiene_ubicacion ?? '—'}`
    );

    const appConnectionString = process.env.DATABASE_URL;
    if (appConnectionString && diagnostico[0]?.tenant_plataforma_id != null) {
      const appClient = new Client({ connectionString: appConnectionString });
      await appClient.connect();
      try {
        await appClient.query('BEGIN');
        await appClient.query("SELECT set_config('app.tenant_id', $1, true)", [
          String(diagnostico[0].tenant_plataforma_id),
        ]);
        const { rows: visibles } = await appClient.query(`
          SELECT count(*)::int AS n
            FROM perfiles_prestador
           WHERE id = 900001
             AND is_active = true
             AND estatus_verificacion = 'APROBADO'
             AND ubicacion IS NOT NULL
        `);
        await appClient.query('COMMIT');
        console.log(`visibilidad RLS del proveedor sembrado con tenant explícito: ${visibles[0].n}`);
      } catch (error) {
        await appClient.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        await appClient.end();
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('ERROR sembrando catálogo de CI:', err.message);
  process.exit(1);
});
