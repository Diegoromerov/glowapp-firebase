#!/usr/bin/env bash
# Verifica la cadena de migraciones en tres escenarios.
# Uso:  backend/scripts/verificar-cadena-migraciones.sh
# Requiere Docker con la imagen postgis/postgis:16-3.4.
set -uo pipefail

IMG="postgis/postgis:16-3.4"
CT="glowapp-verify"
PORT="${PORT:-55434}"
PASS="test_rls_password"
FALLOS=0

solo_si_docker() {
  command -v docker >/dev/null || { echo "X docker no está en el PATH"; exit 2; }
  docker info >/dev/null 2>&1 || { echo "X el daemon de Docker no responde"; exit 2; }
}

levantar() {
  docker rm -f "$CT" >/dev/null 2>&1
  docker run -d --name "$CT" -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=glowtest -e POSTGRES_HOST_AUTH_METHOD=trust \
    -p "${PORT}:5432" "$IMG" >/dev/null || return 1
  # La imagen postgis arranca un servidor temporal durante initdb y luego lo
  # reinicia: una consulta exitosa ahi no garantiza que el servidor final este
  # listo (fallaba con "Connection terminated unexpectedly"). Exigimos dos
  # exitos consecutivos separados por 3s.
  # La imagen postgis levanta un servidor temporal durante initdb y lo reinicia
  # al terminar: hay DOS "ready to accept connections" en el log. Esperar solo a
  # que responda una consulta daba ECONNRESET a mitad de la cadena.
  for _ in $(seq 1 90); do
    listo=$(docker logs "$CT" 2>&1 | grep -c "database system is ready to accept connections" || true)
    if [ "${listo:-0}" -ge 2 ]; then
      sleep 2
      docker exec "$CT" psql -U postgres -d glowtest -tAc "select 1" >/dev/null 2>&1 && return 0
    fi
    sleep 2
  done
  return 1
}

limpiar() { docker exec "$CT" psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS glowtest;" \
            -c "CREATE DATABASE glowtest;" >/dev/null 2>&1; }

solo_si_docker
export DATABASE_URL_ADMIN="postgres://postgres@127.0.0.1:${PORT}/glowtest"
export RLS_ROLE_PASSWORD="$PASS"
unset MIGRAR_OMITIR

echo "== Escenario 1: base vacía, cadena completa =="
levantar || { echo "X no arrancó postgres"; exit 2; }
node backend/scripts/prepareRlsDatabase.js > /tmp/esc1.log 2>&1
[ $? -eq 0 ] && echo "  OK arranque 1" || { echo "  X arranque 1 falló"; tail -5 /tmp/esc1.log; FALLOS=$((FALLOS+1)); }

echo "== Escenario 2: segundo arranque sobre la misma base (idempotencia) =="
node backend/scripts/prepareRlsDatabase.js > /tmp/esc2.log 2>&1
[ $? -eq 0 ] && echo "  OK arranque 2" || { echo "  X arranque 2 falló"; tail -5 /tmp/esc2.log; FALLOS=$((FALLOS+1)); }

echo "== Escenario 3: arranque sobre base ya poblada (simulación de producción) =="
limpiar
MIGRAR_OMITIR="123_checkout_tenant_wompi.sql,129_otp_codigo_cifrado.sql" \
  node backend/scripts/prepareRlsDatabase.js > /tmp/esc3a.log 2>&1   # construye "producción"
node backend/scripts/prepareRlsDatabase.js > /tmp/esc3.log 2>&1       # arranca encima
[ $? -eq 0 ] && echo "  OK arranque sobre base poblada" || { echo "  X arranque sobre base poblada falló"; tail -5 /tmp/esc3.log; FALLOS=$((FALLOS+1)); }

echo "== Comprobaciones de esquema =="
n=$(docker exec "$CT" psql -U postgres -d glowtest -tAc \
  "select count(*) from pg_proc where proname='app_usuario_por_email'")
[ "$n" = "1" ] && echo "  OK app_usuario_por_email con una sola firma" || { echo "  X firmas de app_usuario_por_email: $n"; FALLOS=$((FALLOS+1)); }

otp=$(docker exec "$CT" psql -U postgres -d glowtest -tAc "select to_regclass('public.otp_validaciones')")
[ -n "$otp" ] && echo "  OK otp_validaciones existe" || { echo "  X falta otp_validaciones"; FALLOS=$((FALLOS+1)); }

svc_id=$(docker exec "$CT" psql -U postgres -d glowtest -tAc \
  "select data_type from information_schema.columns where table_name='services' and column_name='id'")
[ "$svc_id" = "uuid" ] && echo "  OK services.id es uuid (como produccion)" || { echo "  X services.id es '$svc_id' y produccion usa uuid"; FALLOS=$((FALLOS+1)); }

contrato=$(docker exec "$CT" psql -U postgres -d glowtest -tAc \
  "select valor from schema_contracts where nombre='services.id'")
[ "$contrato" = "uuid" ] && echo "  OK schema_contracts registra services.id=uuid" || { echo "  X contrato de services.id: '$contrato'"; FALLOS=$((FALLOS+1)); }

rls=$(docker exec "$CT" psql -U postgres -d glowtest -tAc \
  "select count(*) from pg_class where relrowsecurity and relname in ('precios_producto','listas_precios','precios_historial')")
[ "$rls" = "3" ] && echo "  OK RLS en las tres tablas de precios" || { echo "  X RLS en tablas de precios: $rls/3"; FALLOS=$((FALLOS+1)); }

TEST_DATABASE_URL="postgres://app_owner@127.0.0.1:${PORT}/glowtest" \
  node backend/scripts/verifyTenantIsolation.js > /tmp/esc4.log 2>&1
[ $? -eq 0 ] && echo "  OK verifyTenantIsolation" || { echo "  X verifyTenantIsolation falló"; tail -5 /tmp/esc4.log; FALLOS=$((FALLOS+1)); }

echo
if [ "$FALLOS" -eq 0 ]; then
  echo "TODO VERDE ($(date)) — puedes publicar con MIGRACIONES_VERIFICADAS=1"
  exit 0
fi
echo "FALLOS: $FALLOS — no publiques"
exit 1
