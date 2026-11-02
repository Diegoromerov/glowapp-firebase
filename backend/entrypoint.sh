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
  
  # Run the migration script
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