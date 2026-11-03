#!/bin/sh
# Entrypoint script for Railway deployment
# Runs database migrations before starting the server

set -e

echo "🚀 Starting GlowApp Backend..."
echo "📦 Environment: ${NODE_ENV}"
echo "🔗 Database: ${DATABASE_URL}"

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

  # 2. Switch DATABASE_URL to app_rls_user for runtime
  # Railway DATABASE_URL format: postgres://postgres:pass@host:port/db
  # We replace the user:pass with app_rls_user:RLS_ROLE_PASSWORD
  export DATABASE_URL=$(echo "$DATABASE_URL" | sed -E "s|postgres://[^:]+:[^@]+@|postgres://app_rls_user:${RLS_ROLE_PASSWORD}@|")
  echo "🔐 Runtime connection: app_rls_user"

  # 3. Run the migration script (prepareRlsDatabase.js applies schema + transfers ownership)
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