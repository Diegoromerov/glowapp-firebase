#!/usr/bin/env bash
# Puerta de compilación del pre-push.
#
# Por qué existe: el 13-nov-2026 `main` quedó con `glow_core` sin compilar
# (imports rotos en el widget de motion). GitHub Actions sí corre `flutter
# analyze` y `flutter test` en cada push a main, pero **no bloquea nada** y nadie
# mira la pestaña de Actions: el repo se rompió y se supo por casualidad. Este
# repo se publica con push directo a main, así que la compuerta tiene que estar
# donde se hace el push, no en un panel que hay que recordar abrir.
#
# Qué hace: si el push toca código Flutter, corre `flutter analyze` en los
# paquetes afectados y bloquea si hay líneas de ERROR. Los `info` y `warning` no
# bloquean: el repo tiene cientos y no son deuda de este paso.
#
# Escape: COMPILACION_VERIFICADA=1 git push ... (para cuando ya lo corriste).
#
# Uso manual:  bash scripts/pre-push-compilar.sh
# Desde el hook: bash scripts/pre-push-compilar.sh --desde-hook <archivos...>

set -uo pipefail

raiz=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "  No se pudo localizar la raíz del repo." >&2
  exit 0
}
cd "$raiz" || exit 0

if [ "${COMPILACION_VERIFICADA:-0}" = "1" ]; then
  echo "  Compilación: omitida (COMPILACION_VERIFICADA=1)."
  exit 0
fi

# ── Qué cambió ────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--desde-hook" ]; then
  shift
  # Uno por línea: con "$*" todo queda en una sola línea y los anclajes ^ de los
  # grep de abajo solo casan con el primer archivo.
  archivos=$(printf '%s\n' "$@")
else
  base=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo '')
  if [ -n "$base" ]; then
    archivos=$(git diff --name-only "$base" HEAD 2>/dev/null || true)
  else
    archivos=$(git diff --name-only origin/main HEAD 2>/dev/null || git show --name-only --format='' HEAD)
  fi
fi

if ! echo "$archivos" | grep -qE '^(apps/(glow_client|glow_provider)/|packages/glow_core/)'; then
  exit 0
fi

if ! command -v flutter >/dev/null 2>&1; then
  echo "  ⚠️  flutter no está en el PATH: no puedo verificar la compilación." >&2
  echo "      Instálalo o publica con COMPILACION_VERIFICADA=1 si ya lo corriste." >&2
  exit 0
fi

# ── Qué paquetes mirar ────────────────────────────────────────────────────────
paquetes=()
echo "$archivos" | grep -qE '^packages/glow_core/' && paquetes+=("packages/glow_core")
# glow_core se compila siempre que se toque cualquier app: es su dependencia.
echo "$archivos" | grep -qE '^apps/glow_client/|^packages/glow_core/' && paquetes+=("apps/glow_client")
echo "$archivos" | grep -qE '^apps/glow_provider/' && paquetes+=("apps/glow_provider")
[ ${#paquetes[@]} -eq 0 ] && exit 0

fallos=0
for paquete in "${paquetes[@]}"; do
  echo "  Compilando $paquete…"
  salida=$(cd "$paquete" && timeout 420 flutter analyze 2>&1)
  errores=$(echo "$salida" | grep -cE " error - | error • ")
  if [ "$errores" -gt 0 ]; then
    echo "" >&2
    echo "  ✗ $paquete tiene $errores error(es) de compilación:" >&2
    echo "$salida" | grep -E " error - | error • " | head -8 | sed 's/^/      /' >&2
    fallos=$((fallos + 1))
  else
    echo "    ✓ $paquete sin errores"
  fi
done

if [ "$fallos" -gt 0 ]; then
  echo "" >&2
  echo "  Push BLOQUEADO: el código no compila." >&2
  echo "  Esto es lo que dejó main roto el 13-nov: GitHub no bloquea y nadie mira Actions." >&2
  echo "  Corrige los errores de arriba; si ya verificaste a mano:" >&2
  echo "      COMPILACION_VERIFICADA=1 git push ..." >&2
  echo "" >&2
  exit 1
fi

exit 0
