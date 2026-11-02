'use strict';

/**
 * FIX-FLUTTER-06 (P1 · API drift) — política de versión mínima soportada por la app.
 *
 * Módulo PURO (sin BD, sin red, sin Express) que traduce el entorno en la política
 * que publica `GET /api/health`:
 *
 *   { minimum_app_version: '1.4.0', latest_app_version: '1.6.2' }
 *
 * La app compara su versión instalada (`pubspec.yaml` → `version:`) contra
 * `minimum_app_version`: si es menor, bloquea con el diálogo de actualización
 * forzada. `latest_app_version` permite ofrecer una actualización recomendada
 * sin bloquear.
 *
 * Reglas duras:
 *   - `MINIMUM_APP_VERSION` / `LATEST_APP_VERSION` son las únicas fuentes de
 *     verdad (variables de entorno). No hay versión hardcodeada en la ruta.
 *   - Un valor ilegible cae al default en vez de publicar basura: un mínimo
 *     corrupto bloquearía a TODOS los usuarios.
 *   - `latest` nunca se publica por debajo de `minimum` (política incoherente).
 */

const DEFAULT_MINIMUM_APP_VERSION = '1.0.0';

// Semver laxo: v opcional, 1-3 componentes numéricos, prerelease y build opcionales.
const VERSION_RE =
  /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

/**
 * Parsea una versión semántica. Devuelve null si no es legible; nunca lanza.
 * @param {unknown} raw
 * @returns {{major:number,minor:number,patch:number,prerelease:string|null,build:string|null}|null}
 */
function parseVersion(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;

  const text = String(raw).trim();
  if (!text) return null;

  const match = VERSION_RE.exec(text);
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2] || 0),
    patch: Number(match[3] || 0),
    prerelease: match[4] || null,
    build: toBuildNumber(match[5]),
  };
}

/** Build metadata: numérico cuando es numérico, tal cual cuando no lo es. */
function toBuildNumber(rawBuild) {
  if (rawBuild === undefined || rawBuild === null || rawBuild === '') return null;
  const numeric = Number(rawBuild);
  return Number.isNaN(numeric) ? String(rawBuild) : numeric;
}

/**
 * Compara dos versiones: -1 (a<b) | 0 (iguales) | 1 (a>b).
 * Si alguna es ilegible devuelve 0: no comparables ⇒ no se bloquea a nadie.
 */
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;

  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  // Una prerelease ordena antes que su release (1.2.0-beta < 1.2.0).
  if (Boolean(left.prerelease) !== Boolean(right.prerelease)) {
    return left.prerelease ? -1 : 1;
  }
  return 0;
}

/**
 * true solo si AMBAS versiones son legibles y `current` < `minimum`.
 * Fail-open: ante cualquier duda devuelve false (nunca bloquea).
 */
function isBelowMinimum(current, minimum) {
  if (!parseVersion(current) || !parseVersion(minimum)) return false;
  return compareVersions(current, minimum) < 0;
}

/**
 * Resuelve la política publicada a partir del entorno.
 * @param {Record<string,string|undefined>} [env]
 * @returns {{minimum_app_version:string, latest_app_version:string}}
 */
function resolveAppVersionPolicy(env = process.env) {
  const source = env || {};

  const rawMinimum =
    typeof source.MINIMUM_APP_VERSION === 'string' ? source.MINIMUM_APP_VERSION.trim() : '';
  const rawLatest =
    typeof source.LATEST_APP_VERSION === 'string' ? source.LATEST_APP_VERSION.trim() : '';

  const minimum = parseVersion(rawMinimum) ? rawMinimum : DEFAULT_MINIMUM_APP_VERSION;
  let latest = parseVersion(rawLatest) ? rawLatest : minimum;

  // Política incoherente (latest < minimum) se corrige hacia arriba.
  if (compareVersions(latest, minimum) < 0) latest = minimum;

  return {
    minimum_app_version: minimum,
    latest_app_version: latest,
  };
}

module.exports = {
  DEFAULT_MINIMUM_APP_VERSION,
  parseVersion,
  compareVersions,
  isBelowMinimum,
  resolveAppVersionPolicy,
};
