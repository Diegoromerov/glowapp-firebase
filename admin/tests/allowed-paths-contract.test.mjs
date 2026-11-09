import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const adminRoot = join(import.meta.dirname, '..');
const srcRoot = join(adminRoot, 'src');
const routePath = join(srcRoot, 'app', 'api', '[...path]', 'route.ts');
const gapsPath = join(adminRoot, 'KNOWN_GAPS.md');

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx|js|jsx)$/.test(name) ? [path] : [];
  });
}

function apiPaths(source) {
  return [...source.matchAll(/\/api\/([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_$.-]+)*)/g)]
    .map((match) => match[1].replace(/\/$/, '').replace(/\/\$$/, '').replace(/\/+$/, ''))
    .filter((path) => path && !path.startsWith('$'));
}

test('las rutas de admin, glow-admin, metrics y v1/business están cubiertas por ALLOWED_PATH_PREFIXES', () => {
  const routeSource = readFileSync(routePath, 'utf8');
  const allowlistMatch = routeSource.match(/ALLOWED_PATH_PREFIXES\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(allowlistMatch, 'route.ts debe declarar ALLOWED_PATH_PREFIXES');
  const prefixes = [...allowlistMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const protectedPrefixes = ['admin/', 'glow-admin/', 'metrics/', 'v1/business/'];
  const paths = sourceFiles(srcRoot)
    .filter((path) => path !== routePath)
    .flatMap((path) => apiPaths(readFileSync(path, 'utf8')));
  const requiredPaths = [...new Set(paths)].filter((path) => protectedPrefixes.some((prefix) => path.startsWith(prefix)));
  const uncovered = requiredPaths.filter((path) => !prefixes.some((prefix) => path.startsWith(prefix) || path === prefix.replace(/\/$/, '')));

  assert.deepEqual(uncovered, [], 'cada ruta de esos grupos debe pasar el allowlist del BFF');
});

test('las demás rutas API están cubiertas o constan en KNOWN_GAPS.md', () => {
  const routeSource = readFileSync(routePath, 'utf8');
  const allowlistMatch = routeSource.match(/ALLOWED_PATH_PREFIXES\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(allowlistMatch, 'route.ts debe declarar ALLOWED_PATH_PREFIXES');
  const prefixes = [...allowlistMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const gaps = readFileSync(gapsPath, 'utf8');
  const paths = [...new Set(sourceFiles(srcRoot)
    .filter((path) => path !== routePath)
    .flatMap((path) => apiPaths(readFileSync(path, 'utf8'))))];
  const uncovered = paths.filter((path) => {
    const allowed = prefixes.some((prefix) => path.startsWith(prefix) || path === prefix.replace(/\/$/, ''));
    const documented = gaps.includes(`/api/${path}`) || gaps.includes(`/api/${path.split('/')[0]}`);
    return !allowed && !documented;
  });

  assert.deepEqual(uncovered, [], 'toda ruta fuera del allowlist debe quedar documentada');
});
