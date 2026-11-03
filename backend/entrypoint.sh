#!/bin/sh
# Entrypoint script for Railway deployment
# Runs database migrations before starting the server

set -e

echo "🚀 Starting GlowApp Backend..."
echo "📦 Environment: ${NODE_ENV}"
# Solo host/puerto, sin credenciales
echo "🔗 Database host: $(printf '%s' "$DATABASE_URL" | sed -E 's#^postgres(ql)?://[^@]*@##; s#/.*##')"

# Run database migrations if DATABASE_URL is set
if [ -n "$DATABASE_URL" ]; then
  echo "🗄️  Running database migrations..."

  # Use the admin URL for migrations (same as DATABASE_URL for Railway)
  export DATABASE_URL_ADMIN="$DATABASE_URL"
  if [ -z "$RLS_ROLE_PASSWORD" ]; then
    echo "❌ RLS_ROLE_PASSWORD is required but not set"
    exit 1
  fi

  # 1. Create/verify RLS roles (idempotent)
  echo "👤 Setting up RLS roles..."
  if node -e "
    const { Client } = require('pg');
    const fs = require('fs');
    const path = require('path');
    const sql = fs.readFileSync(path.join(__dirname, 'scripts', 'setupRlsRole.sql'), 'utf8');
    const client = new Client({ connectionString: process.env.DATABASE_URL_ADMIN });
    client.connect().then(() => client.query(sql)).then(() => {
      console.log('✅ RLS roles configured');
      client.end();
    }).catch(e => {
      console.error('❌ RLS roles failed:', e.message);
      process.exit(1);
    });
  "; then
    echo "✅ RLS roles ready"
  else
    echo "❌ RLS roles setup failed"
    exit 1
  fi

  # 2. Cambiar el rol de runtime a app_rls_user.
  #    Railway entrega la URL con esquema postgresql://; aceptar los dos y
  #    ABORTAR si la cadena no cambió: antes el sed solo entendía postgres://,
  #    no reescribía nada y el contenedor seguía conectando como superusuario
  #    mientras el log decía lo contrario.
  URL_RUNTIME=$(printf '%s' "$DATABASE_URL" \
    | sed -E "s#^postgres(ql)?://[^@]+@#postgresql://app_rls_user:${RLS_ROLE_PASSWORD}@#")
  if [ "$URL_RUNTIME" = "$DATABASE_URL" ]; then
    echo "❌ No se pudo reescribir DATABASE_URL a app_rls_user (esquema no reconocido)"
    exit 1
  fi
  export DATABASE_URL="$URL_RUNTIME"

  # 3. Verificar el rol en vez de anunciarlo
  echo "🔐 Verificando el rol de runtime..."
  if ! node -e "
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    c.connect()
      .then(() => c.query('SELECT current_user AS u, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass'))
      .then((r) => {
        const { u, bypass } = r.rows[0];
        console.log('   rol:', u, '| bypassrls:', bypass);
        if (u !== 'app_rls_user') { console.error('❌ runtime no es app_rls_user'); process.exit(1); }
        if (bypass) { console.error('❌ app_rls_user tiene BYPASSRLS: RLS no se aplicaría'); process.exit(1); }
        console.log('✅ runtime como app_rls_user sin BYPASSRLS');
      })
      .catch((e) => { console.error('❌ no se pudo conectar como app_rls_user:', e.message); process.exit(1); })
      .finally(() => c.end().catch(() => {}));
  "; then
    exit 1
  fi

  # 4. Run the migration script (prepareRlsDatabase.js applies schema + transfers ownership)
  if node scripts/prepareRlsDatabase.js; then
    echo "✅ Database migrations completed successfully"
  else
    echo "❌ Database migrations failed"
    exit 1
  fi
else
  echo "⚠️  DATABASE_URL not set, skipping migrations"
fi

# Start the application
echo "🌐 Starting server on port ${PORT:-8080}..."
exec node index.js