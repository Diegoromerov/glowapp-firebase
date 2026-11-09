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
          ST_SetSRID(ST_MakePoint(-74.1422, 4.6735), 4326)::geography, t)
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
    console.log(`catálogo de prueba sembrado: ${rows[0].n} proveedor(es) activo(s)`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('ERROR sembrando catálogo de CI:', err.message);
  process.exit(1);
});
