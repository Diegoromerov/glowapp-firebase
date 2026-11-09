#!/usr/bin/env bash
# Despliegue de una app Flutter web a Firebase Hosting.
#
# Las tuberias (`flutter build | tail`) devuelven el codigo de salida de `tail`,
# asi que un fallo de compilacion se veia como exito y `firebase deploy`
# publicaba el bundle anterior. Aqui se corta en el primer error.
#
#   ./scripts/desplegar-web.sh glow_client glowapp-client staging
#   ./scripts/desplegar-web.sh glow_client glowapp-client production
set -euo pipefail

APP="${1:?uso: desplegar-web.sh <glow_client|glow_provider> <proyecto-firebase>}"
PROYECTO="${2:?falta el proyecto de Firebase}"
ENTORNO="${3:-staging}"

case "$APP" in
  glow_client) AUDIENCE=client; PROYECTO_ESPERADO=glowapp-client ;;
  glow_provider) AUDIENCE=provider; PROYECTO_ESPERADO=glowapp-provider ;;
  *) echo "X app desconocida: $APP (usa glow_client o glow_provider)" >&2; exit 2 ;;
esac

# Guarda contra el error real ya cometido: llamarlo con 2 argumentos
# (`desplegar-web.sh glow_client production`) deja ENTORNO=staging y compila el
# bundle contra la API de staging para publicarlo en un proyecto de produccion.
if [ "$PROYECTO" != "$PROYECTO_ESPERADO" ]; then
  echo "X el proyecto Firebase de $APP es '$PROYECTO_ESPERADO', se recibio '$PROYECTO'" >&2
  echo "  uso: desplegar-web.sh $APP $PROYECTO_ESPERADO <staging|production>" >&2
  exit 2
fi

case "$ENTORNO" in
  staging) API_URL=https://glowapp-api-staging-staging.up.railway.app ;;
  production) API_URL=https://glowapp-api-production.up.railway.app ;;
  *) echo "X entorno desconocido: $ENTORNO (usa staging o production)" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/../apps/$APP"

echo "-> compilando $APP"
flutter build web --release \
  --dart-define=API_URL="$API_URL" \
  --dart-define=APP_AUDIENCE="$AUDIENCE"

if [ ! -f build/web/main.dart.js ]; then
  echo "X no se genero build/web/main.dart.js; se aborta el despliegue" >&2
  exit 1
fi

echo "-> publicando en $PROYECTO"
firebase deploy --only hosting --project "$PROYECTO"
echo "OK $APP desplegado"
