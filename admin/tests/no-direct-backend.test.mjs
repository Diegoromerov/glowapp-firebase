import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const srcRoot = join(import.meta.dirname, '..', 'src');

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx|js|jsx)$/.test(name) ? [path] : [];
  });
}

test('el cliente no configura URL pública ni conserva tokens de GlowApp en TSX', () => {
  const files = sourceFiles(srcRoot);
  const contents = files.map((path) => ({ path, source: readFileSync(path, 'utf8') }));

  assert.deepEqual(
    contents.filter(({ source }) => source.includes('NEXT_PUBLIC_API_URL')).map(({ path }) => path),
    [],
    'NEXT_PUBLIC_API_URL no debe aparecer en admin/src'
  );
  assert.deepEqual(
    contents.filter(({ path, source }) => path.endsWith('.tsx') && source.includes('glow_token')).map(({ path }) => path),
    [],
    'los componentes TSX no deben leer glow_token'
  );
});

test('las llamadas fetch de la app no apuntan a URLs absolutas de backend', () => {
  const appRoot = join(srcRoot, 'app');
  const absoluteFetch = /\bfetch\s*\(\s*(?:['"]https?:\/\/|`https?:\/\/)/g;
  const violations = sourceFiles(appRoot).flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    return [...source.matchAll(absoluteFetch)].map((match) => `${path}:${source.slice(0, match.index).split('\n').length}`);
  });

  assert.deepEqual(violations, [], 'fetch debe usar rutas relativas y pasar por el BFF');
});
