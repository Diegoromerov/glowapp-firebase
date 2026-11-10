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

# ─── Firebase en el build ────────────────────────────────────────────────────
# Sin apiKey el try/catch de main.dart apaga Firebase en silencio y el push web
# no funciona (el bundle sale con 0 claves AIza). Esos valores NO van al repo:
# backend/scripts/verifyNoVersionedSecrets.js prohíbe una clave AIza versionada.
#
# Orden de resolución:
#   1. variables de entorno (CI o sesión del Director)
#   2. init.json público del propio proyecto, que es el mismo objeto que
#      Firebase sirve a su web: no es un secreto, es la configuración del app.
FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID:-$PROYECTO}"
if [ -z "${FIREBASE_API_KEY:-}" ] && command -v curl >/dev/null 2>&1; then
  _init=$(curl -fsS "https://${PROYECTO}.firebaseapp.com/__/firebase/init.json" 2>/dev/null || true)
  if [ -n "$_init" ]; then
    _leer() { printf '%s' "$_init" | python -c "import sys,json;print(json.load(sys.stdin).get('$1',''))" 2>/dev/null || true; }
    FIREBASE_API_KEY="${FIREBASE_API_KEY:-$(_leer apiKey)}"
    FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID:-$(_leer projectId)}"
    FIREBASE_MESSAGING_SENDER_ID="${FIREBASE_MESSAGING_SENDER_ID:-$(_leer messagingSenderId)}"
    FIREBASE_STORAGE_BUCKET="${FIREBASE_STORAGE_BUCKET:-$(_leer storageBucket)}"
    FIREBASE_WEB_APP_ID="${FIREBASE_WEB_APP_ID:-$(_leer appId)}"
  fi
fi

FALTAN=""
[ -n "${FIREBASE_API_KEY:-}" ] || FALTAN="$FALTAN FIREBASE_API_KEY"
[ -n "${FIREBASE_PROJECT_ID:-}" ] || FALTAN="$FALTAN FIREBASE_PROJECT_ID"
[ -n "${FIREBASE_MESSAGING_SENDER_ID:-}" ] || FALTAN="$FALTAN FIREBASE_MESSAGING_SENDER_ID"
[ -n "${FIREBASE_WEB_APP_ID:-}" ] || FALTAN="$FALTAN FIREBASE_WEB_APP_ID"
if [ -n "$FALTAN" ]; then
  echo "X Firebase incompleto en el build:$FALTAN" >&2
  echo "  exportalos en el entorno, o revisa que ${PROYECTO}.firebaseapp.com responda." >&2
  exit 1
fi

# El push web necesita la clave VAPID (Firebase Console → Cloud Messaging →
# Web Push certificates). Sin ella el build funciona pero FCM no da token, y el
# sintoma es un push que nunca llega: se avisa aqui y no mas tarde.
if [ -z "${FCM_VAPID_KEY:-}" ]; then
  echo "AVISO: sin FCM_VAPID_KEY el push web no obtiene token (Pub/Sub no llegara)."
fi

# Un `--dart-define=X=""` NO equivale a no pasarlo: pisa el defaultValue del
# codigo. Asi se quedo sin clientId el login y el boton de Google dejo de servir.
: "${GOOGLE_WEB_CLIENT_ID:=374223351186-0fukntsog02r0p1tofd2aju3c7lsr86j.apps.googleusercontent.com}"

echo "-> compilando $APP (Firebase: proyecto $FIREBASE_PROJECT_ID)"
flutter build web --release \
  --dart-define=API_URL="$API_URL" \
  --dart-define=APP_AUDIENCE="$AUDIENCE" \
  --dart-define=FIREBASE_API_KEY="$FIREBASE_API_KEY" \
  --dart-define=FIREBASE_PROJECT_ID="$FIREBASE_PROJECT_ID" \
  --dart-define=FIREBASE_MESSAGING_SENDER_ID="$FIREBASE_MESSAGING_SENDER_ID" \
  --dart-define=FIREBASE_STORAGE_BUCKET="${FIREBASE_STORAGE_BUCKET:-}" \
  --dart-define=FIREBASE_WEB_APP_ID="$FIREBASE_WEB_APP_ID" \
  --dart-define=GOOGLE_WEB_CLIENT_ID="${GOOGLE_WEB_CLIENT_ID:-}" \
  --dart-define=FCM_VAPID_KEY="${FCM_VAPID_KEY:-}"

if [ ! -f build/web/main.dart.js ]; then
  echo "X no se genero build/web/main.dart.js; se aborta el despliegue" >&2
  exit 1
fi

echo "-> publicando en $PROYECTO"
firebase deploy --only hosting --project "$PROYECTO"
echo "OK $APP desplegado"
