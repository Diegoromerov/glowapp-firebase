#!/usr/bin/env bash
# Despliegue de una app Flutter web a Firebase Hosting.
#
# Las tuberias (`flutter build | tail`) devuelven el codigo de salida de `tail`,
# asi que un fallo de compilacion se veia como exito y `firebase deploy`
# publicaba el bundle anterior. Aqui se corta en el primer error.
#
#   ./scripts/desplegar-web.sh glow_client glowapp-client
set -euo pipefail

APP="${1:?uso: desplegar-web.sh <glow_client|glow_provider> <proyecto-firebase>}"
PROYECTO="${2:?falta el proyecto de Firebase}"

cd "$(dirname "$0")/../apps/$APP"

echo "-> compilando $APP"
flutter build web --release

if [ ! -f build/web/main.dart.js ]; then
  echo "X no se genero build/web/main.dart.js; se aborta el despliegue" >&2
  exit 1
fi

echo "-> publicando en $PROYECTO"
firebase deploy --only hosting --project "$PROYECTO"
echo "OK $APP desplegado"
